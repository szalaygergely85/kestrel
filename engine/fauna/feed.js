// engine/fauna/feed.js - WILD-05 (docs/architecture.md 38.31 item 9).
// The `engine.feedVoxels(pool, cam)` hook body: picks the nearest drawable animals and queues them into the
// VoxelPool (pushInstance + blendInstance while a crossfade runs). Animals are not World entities.
//
// Slot contract (spawner slots; the brain owns `cp`):
//   alive, species (index into def.species), model (index into species.models), x, y, z, yaw (deg),
//   cp  optional clip player struct (engine/entities/clipPlayer.js: clip, frame, tMs, fromClip, fromFrame, fromTMs,
//       fadeMs, fadeT). Without `cp` the animal is drawn in the rest pose.
// Candidate = alive, d < species.drawM, and in the view cone (hfov/2 + 10 deg) or closer than NEAR_M.
// Nearest-first via a fixed-array insertion select (like VoxelPool.collect); at most
// min(drawMax, pool.cap - pool.rawCount - spare) are drawn, so `spare` pool slots stay free for gameplay pushes.
// Zero allocation after createFaunaFeed. Imports engine/fauna/** + engine/entities/clipPlayer.js only.

import { clipFromW, clipSetPhase } from '../entities/clipPlayer.js';
import { createLegDriver } from '../entities/legDriver.js';

export const WILD_DRAW_MAX = 20;
export const WILD_SPARE = 4;
export const NEAR_M = 6;
const CONE_MARGIN_RAD = 10 * Math.PI / 180;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * @param {object} def     compileFaunaDef result (species[].drawM, .models)
 * @param {Array}  slots   spawner slots (the array is read live every frame)
 * @param {{drawMax?:number, spare?:number, hfovRad?:number, legIk?:boolean, ground?:{groundAt:Function}}} [opts]  hfovRad defaults to the 75 deg render FOV.
 *   ANIM-C-04: `legIk` (default true; the game passes `?legik=0` as false -> the driver never attaches) and `ground` (anything with groundAt(x, y)).
 *   A model without `pm.legRig` is never attached: that animal's draw is byte-identical to before. Yaw rule: the driver gets the pool yawDeg
 *   UNCHANGED (the same rotation the pose uses, so rest feet land under the model); travel direction comes from the root displacement, so a
 *   model whose nose is model -y (quadruped16) needs no offset. `cam.dtMs` (optional, default 1000/60) is the frame time for the driver.
 */
export function createFaunaFeed(def, slots, opts) {
  const o = opts || {};
  const drawMax = Math.max(0, o.drawMax === undefined ? WILD_DRAW_MAX : o.drawMax | 0);
  const spare = o.spare === undefined ? WILD_SPARE : o.spare | 0;
  const hfov = o.hfovRad || 75 * DEG2RAD;
  const coneCos = Math.cos(Math.min(Math.PI, hfov / 2 + CONE_MARGIN_RAD));
  const S = def.species.length;
  const drawM2 = new Float64Array(S);
  const keys = new Array(S);                    // keys[species][model] = pool model key
  for (let k = 0; k < S; k++) {
    drawM2[k] = def.species[k].drawM * def.species[k].drawM;
    keys[k] = def.species[k].models.slice();
  }
  const selIdx = new Int32Array(Math.max(1, drawMax));
  const selD2 = new Float64Array(Math.max(1, drawMax));
  const stats = { drawn: 0, candidates: 0, legs: 0 };
  // ANIM-C-04: one driver slot per spawner slot, attached lazily on first draw, released when not drawn / dead / model without a rig
  const legIk = o.legIk !== false, ground = o.ground || null;
  const driver = legIk ? createLegDriver(Math.max(1, drawMax + 8)) : null;
  const legSlot = new Int16Array(slots.length).fill(-1);
  const legStamp = new Uint32Array(slots.length);
  const legModel = new Array(slots.length).fill(null);
  let frameNo = 0;
  const scratch = { clip: -1, frame: 0, tMs: 0 }; // ANIM-C-04b: clipSetPhase target (0 alloc)

  function feed(pool, cam) {
    stats.drawn = 0; stats.candidates = 0; stats.legs = 0;
    frameNo++;
    if (!pool || !cam || drawMax === 0) return 0;
    const room = pool.cap - pool.rawCount - spare;
    const limit = room < drawMax ? room : drawMax;
    if (limit <= 0) return 0;
    const cx = cam.x, cy = cam.y;
    const yaw = (cam.yawDeg || 0) * DEG2RAD;
    const fx = Math.sin(yaw), fy = -Math.cos(yaw);
    let count = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.alive) continue;
      const dx = s.x - cx, dy = s.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= drawM2[s.species]) continue;
      if (d2 >= NEAR_M * NEAR_M && dx * fx + dy * fy < coneCos * Math.sqrt(d2)) continue; // outside view cone
      stats.candidates++;
      if (count < limit) {
        let j = count - 1;
        while (j >= 0 && selD2[j] > d2) { selD2[j + 1] = selD2[j]; selIdx[j + 1] = selIdx[j]; j--; }
        selD2[j + 1] = d2; selIdx[j + 1] = i;
        count++;
      } else if (d2 < selD2[count - 1]) {
        let j = count - 2;
        while (j >= 0 && selD2[j] > d2) { selD2[j + 1] = selD2[j]; selIdx[j + 1] = selIdx[j]; j--; }
        selD2[j + 1] = d2; selIdx[j + 1] = i;
      }
    }
    for (let n = 0; n < count; n++) {
      const s = slots[selIdx[n]];
      // brain slots (WILD-05): clip player in `clip`, yaw = heading in radians (atan2(dy, dx)); pool yawDeg 0 = north (-y)
      const brain = s.cp === undefined && s.clip !== undefined;
      const cp = brain ? s.clip : s.cp;
      const yawDeg = brain ? s.yaw * RAD2DEG + 90 : s.yaw;
      const key = keys[s.species][s.model];
      const si = selIdx[n];
      let r;
      if (cp) {
        r = pool.pushInstance(key, s.x, s.y, s.z, yawDeg, cp.clip, cp.frame, cp.tMs);
        if (r >= 0 && cp.fromClip >= 0 && cp.fadeT < cp.fadeMs) pool.blendInstance(r, cp.fromClip, cp.fromFrame, cp.fromTMs, clipFromW(cp));
      } else {
        r = pool.pushInstance(key, s.x, s.y, s.z, yawDeg, -1, 0, 0);
      }
      if (r >= 0) {
        stats.drawn++;
        if (driver) { if (driver.io) driver.io[3] = yawDeg; legPass(pool, cam, s, si, key, cp, r); } // yaw via the typed io (no boxed double arg)
      }
    }
    if (driver) {
      for (let i = 0; i < legSlot.length; i++) {
        if (legSlot[i] >= 0 && legStamp[i] !== frameNo) { driver.release(legSlot[i]); legSlot[i] = -1; legModel[i] = null; }
      }
    }
    return stats.drawn;
  }
  /** Attach (first draw) / update the driver of spawner slot `si`, then hand its LegPose to the pool. Inert without a legRig. */
  function legPass(pool, cam, s, si, key, cp, r) {
    const pm = pool.models.get(key);
    if (!pm || !pm.legRig) return;
    if (legSlot[si] >= 0 && legModel[si] !== pm) { driver.release(legSlot[si]); legSlot[si] = -1; } // model swap
    if (legSlot[si] < 0) { legSlot[si] = driver.attach(pm); legModel[si] = pm; if (legSlot[si] < 0) return; }
    legStamp[si] = frameNo;
    const io = driver.io;
    io[0] = s.x; io[1] = s.y; io[2] = s.z; io[4] = cam.dtMs || 1000 / 60; io[5] = cam.x; io[6] = cam.y;
    driver.update(legSlot[si], pm, cp ? cp.clip : -1, ground);
    const pose = driver.poseOf(legSlot[si]);
    if (pose[0] > 0) {
      pool.legInstance(r, pose); stats.legs++;
      // ANIM-C-04b (38.67 Clips): a gait clip's position follows the driver's Phi, so head/tail/bob stay in phase with the solved legs
      const lr = pm.legRig, ci = cp ? cp.clip : -1;
      if (ci >= 0 && ci < lr.gaitClip.length && lr.gaitClip[ci] >= 0) {
        scratch.clip = ci; clipSetPhase(scratch, pm, io[8]);
        const ins = pool.raw[r]; ins.frame = scratch.frame; ins.tMs = scratch.tMs;
      }
    }
  }
  return { feed, stats, drawMax, spare, legDriver: driver };
}
