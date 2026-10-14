// game/js/quest/beastLegs.js - ANIM-C-05 (architecture.md 38.67 section 3): view-only leg IK wiring for the game beasts (bear first).
// One engine leg driver per view; one slot per beast index. Attach on the first visible frame of a beast whose model has a `legRig`
// (others: inert), release when the beast is hidden / gone / swapped. Writes only `components.voxel.legPose` and, while a gait clip
// runs, the clip position (frame/t from the driver phase, not wall time). Never touches the sim. `enabled=false` (?legik=0) never attaches.
import { createLegDriver, clipSetPhase } from '../../../engine/index.js';

const NPC_BASE = 1024; // slot indices of scripted NPCs start here (beast sim indices stay below)
export function createBeastLegs(opts) {
  const o = opts || {};
  const enabled = o.enabled !== false;
  const driver = enabled ? createLegDriver(o.capacity || 48) : null;
  let slot = new Int32Array(64).fill(-1);
  let ent = new Array(64).fill(null);
  let mod = new Array(64).fill(null);
  let phase = new Float64Array(64).fill(-1); // ANIM-BLEND-03: per-slot driver phase of the last step (-1 = legs inactive); the blender reads it
  const scratch = { clip: 0, frame: 0, tMs: 0 };
  const npcKeys = [];
  const api = { driver, pool: o.pool, dtMs: 1000 / 60, stats: { attached: 0 }, get phase() { return phase; }, step, stepNpc, release, releaseAll };

  function grow(i) {
    if (i < slot.length) return;
    const n = Math.max(i + 1, slot.length * 2);
    const s = new Int32Array(n).fill(-1); s.set(slot); slot = s;
    ent.length = n; mod.length = n;
    const ph = new Float64Array(n).fill(-1); ph.set(phase); phase = ph;
  }
  function release(i, v) {
    if (!driver || i >= slot.length) return;
    if (slot[i] >= 0) { driver.release(slot[i]); slot[i] = -1; api.stats.attached--; }
    ent[i] = null; mod[i] = null; if (i < phase.length) phase[i] = -1;
    if (v) v.legPose = null;
  }
  function releaseAll() { for (let i = 0; i < slot.length; i++) release(i, null); }

  /** Per beast, after its clip (v.anim) is decided. Returns true when the clip position was driven from the phase. */
  function step(i, e, v, camX, camY, ground, keepPlaying) {
    if (!driver) return false;
    const pm = api.pool && api.pool.models.get(v.model);
    if (!pm || !pm.legRig) { if (slot[i] >= 0) release(i, v); return false; }
    grow(i);
    if (slot[i] >= 0 && (ent[i] !== e || mod[i] !== pm)) release(i, v); // respawn into the slot / model swap
    if (slot[i] < 0) {
      slot[i] = driver.attach(pm); ent[i] = e; mod[i] = pm;
      if (slot[i] < 0) return false;
      api.stats.attached++;
    }
    const idx = pm.clipIndex && v.anim && Object.prototype.hasOwnProperty.call(pm.clipIndex, v.anim) ? pm.clipIndex[v.anim] : -1;
    const t = e.transform, io = driver.io;
    io[0] = t.x; io[1] = t.y; io[2] = t.z; io[3] = t.yawDeg; io[4] = api.dtMs; io[5] = camX; io[6] = camY; // yaw UNCHANGED (C-04 rule)
    driver.update(slot[i], pm, idx, ground);
    const pose = driver.poseOf(slot[i]);
    phase[i] = io[10] === 1 ? io[8] : -1;
    v.legPose = pose[0] > 0 ? pose : null;
    const lr = pm.legRig;
    if (pose[0] > 0 && idx >= 0 && idx < lr.gaitClip.length && lr.gaitClip[idx] >= 0) {
      scratch.clip = idx; clipSetPhase(scratch, pm, io[8]);
      if (!keepPlaying) v.playing = false;
      v.frame = scratch.frame; v.t = scratch.tMs;
      return true;
    }
    return false;
  }
  /** A scripted NPC (Burl): `key` = entity id. Its walker re-issues `play('walk')` every fixed step, so `playing` is left alone (frame/t are overwritten each render). */
  function stepNpc(key, e, v, camX, camY, ground) {
    let k = npcKeys.indexOf(key);
    if (k < 0) { k = npcKeys.length; npcKeys.push(key); }
    const i = NPC_BASE + k;
    if (v.hidden) { release(i, v); return false; }
    return step(i, e, v, camX, camY, ground, true);
  }
  return api;
}
