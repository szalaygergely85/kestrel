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
// min(drawMax, pool.cap - pool._rawCount - spare) are drawn, so `spare` pool slots stay free for gameplay pushes.
// Zero allocation after createFaunaFeed. Imports engine/fauna/** + engine/entities/clipPlayer.js only.

import { clipFromW } from '../entities/clipPlayer.js';

export const WILD_DRAW_MAX = 20;
export const WILD_SPARE = 4;
export const NEAR_M = 6;
const CONE_MARGIN_RAD = 10 * Math.PI / 180;
const DEG2RAD = Math.PI / 180;

/**
 * @param {object} def     compileFaunaDef result (species[].drawM, .models)
 * @param {Array}  slots   spawner slots (the array is read live every frame)
 * @param {{drawMax?:number, spare?:number, hfovRad?:number}} [opts]  hfovRad defaults to the 75 deg render FOV
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
  const stats = { drawn: 0, candidates: 0 };

  function feed(pool, cam) {
    stats.drawn = 0; stats.candidates = 0;
    if (!pool || !cam || drawMax === 0) return 0;
    const room = pool.cap - pool._rawCount - spare;
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
      const cp = s.cp;
      const key = keys[s.species][s.model];
      let r;
      if (cp) {
        r = pool.pushInstance(key, s.x, s.y, s.z, s.yaw, cp.clip, cp.frame, cp.tMs);
        if (r >= 0 && cp.fromClip >= 0 && cp.fadeT < cp.fadeMs) pool.blendInstance(r, cp.fromClip, cp.fromFrame, cp.fromTMs, clipFromW(cp));
      } else {
        r = pool.pushInstance(key, s.x, s.y, s.z, s.yaw, -1, 0, 0);
      }
      if (r >= 0) stats.drawn++;
    }
    return stats.drawn;
  }
  return { feed, stats, drawMax, spare };
}
