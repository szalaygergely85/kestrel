// game/js/quest/beastLook.js - ANIM-LOOKAT-01 (architecture.md 38.69 lane note; D-090 stage 2): view-only wiring of the engine head look-at
// (engine/entities/lookAt.js). One look-at slot per key (beast sim index; any other view, e.g. an NPC with a voxel head, uses stepEntity with its own
// key >= 1024). A model WITHOUT `pm.lookAt` stays inert: no slot, `lookRot` null, today's bytes. `?lookat=0` = no object passed to presentBeasts.
// The target (the player) is fed by the caller: look.setTarget(x, y, z) once per frame (NEEDS B1-main: one line next to presentBeasts).
// A beast looks at the target while it is aware of it (notice / chase / windup / charge / recover / stagger / circle) and within LOOK_R metres.
import { createLookAt } from '../../../engine/index.js';
import { STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_STAGGER, STATE_CIRCLE } from './sim/beastSim.js';

const LOOK_R = 24;
const DT_MS = 1000 / 60;

export function createBeastLook(opts) {
  const o = opts || {};
  const enabled = o.enabled !== false;
  const la = enabled ? createLookAt(o.capacity || 64) : null;
  let slot = new Int32Array(64).fill(-1);
  let ent = new Array(64).fill(null), mod = new Array(64).fill(null);
  const tgt = new Float64Array(4); // x, y, z, valid
  const api = { lookAt: la, target: tgt, pool: o.pool, setTarget, clearTarget, step, stepEntity, release, releaseAll, stats: { attached: 0 } };

  function setTarget(x, y, z) { tgt[0] = x; tgt[1] = y; tgt[2] = z; tgt[3] = 1; }
  function clearTarget() { tgt[3] = 0; }
  function grow(k) {
    if (k < slot.length) return;
    const n = Math.max(k + 1, slot.length * 2);
    const s = new Int32Array(n).fill(-1); s.set(slot); slot = s;
    ent.length = n; mod.length = n;
  }
  function release(k, v) {
    if (!la || k >= slot.length) return;
    if (slot[k] >= 0) { la.release(slot[k]); slot[k] = -1; api.stats.attached--; }
    ent[k] = null; mod[k] = null;
    if (v) v.lookRot = null;
  }
  function releaseAll() { for (let k = 0; k < slot.length; k++) release(k, null); }

  function aware(st) {
    return st === STATE_NOTICE || st === STATE_CHASE || st === STATE_WINDUP || st === STATE_CHARGE
      || st === STATE_RECOVER || st === STATE_STAGGER || st === STATE_CIRCLE;
  }
  /** A beast, once per frame (after its clip is decided). Returns true while a look record is attached. */
  function step(i, sim, e, v) { return la ? drive(i, e, v, tgt[3] === 1 && aware(sim.state[i])) : false; }
  /** Any other view (e.g. an NPC with a voxel head, while its dialogue is open): `active` = look at the target now. */
  function stepEntity(key, e, v, active) { return la ? drive(key, e, v, active && tgt[3] === 1) : false; }

  function drive(k, e, v, want) {
    grow(k);
    const pm = api.pool && api.pool.models.get(v.model);
    if (!pm || !pm.lookAt) { if (slot[k] >= 0 || v.lookRot) release(k, v); return false; }
    if (slot[k] >= 0 && (ent[k] !== e || mod[k] !== pm)) release(k, v); // respawn into the slot / model swap
    if (slot[k] < 0) {
      const s = la.attach(pm);
      if (s < 0) return false;
      slot[k] = s; ent[k] = e; mod[k] = pm; api.stats.attached++;
    }
    const t = e.transform, io = la.io;
    const dx = tgt[0] - t.x, dy = tgt[1] - t.y;
    io[0] = want && dx * dx + dy * dy < LOOK_R * LOOK_R ? 1 : 0;
    io[1] = t.x; io[2] = t.y; io[3] = t.z + (pm.lookEyeM || 1); // eye ~ 1 m over the feet (pitch only)
    io[4] = t.yawDeg || 0;
    io[5] = tgt[0]; io[6] = tgt[1]; io[7] = tgt[2];
    la.update(slot[k], pm, DT_MS);
    v.lookRot = la.lookOf(slot[k]);
    return true;
  }
  return api;
}
