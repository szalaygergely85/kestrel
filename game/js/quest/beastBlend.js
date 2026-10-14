// game/js/quest/beastBlend.js - ANIM-BLEND-03 (architecture.md 38.68 step 03; D-090 stage 2; OB-150): view-only wiring of the engine
// animation blender (engine/entities/animBlend.js) for the game beasts and (later) the player view. One blender, one slot per key
// (beast sim index; the player uses PLAYER_KEY). A model WITHOUT `pm.blend` (bear, the player rig today) stays inert: no slot, `animLayers`
// null, today's bytes. `?animblend=0` = presentBeasts gets no blend object (or enabled:false): nothing here runs.
// Per frame, per beast, BEFORE legs.step (38.68 section 4): blender.update(slot, pm, dt, driverIo) writes the blended stride to driver.io[11]
// and v.animLayers, and v.anim = the dominant clip so the leg driver picks the matching footfall pattern. Writes no sim state.
import { createAnimBlender } from '../../../engine/index.js';

export const PLAYER_KEY = 2048;      // player view slot key (beast sim indices stay below; NPC keys start at 1024 in beastLegs)
const SPEED_EMA = 0.25;              // per-frame smoothing of the measured speed (sim steps vs render frames jitter)
const TELEPORT_MPS = 30;             // a faster apparent move is a teleport / respawn: no speed, no fade
const HURT_STEPS = 10;
const DT_MS = 1000 / 60;            // one render frame (module const: no boxed field read per call, 38.61)

export function createBeastBlend(opts) {
  const o = opts || {};
  const enabled = o.enabled !== false;
  const bl = enabled ? createAnimBlender(o.capacity || 64) : null;
  let slot = new Int32Array(64).fill(-1);
  let spd = new Float64Array(64), px = new Float64Array(64), py = new Float64Array(64), hurtPrev = new Float64Array(64);
  let seen = new Uint8Array(64), ent = new Array(64).fill(null), mod = new Array(64).fill(null);
  const dio = new Float64Array(12); // scratch "driver io": [8] phase, [10] active in; [11] stride out
  const api = { blender: bl, pool: o.pool, dtMs: 1000 / 60, stats: { attached: 0 }, has, step, stepEntity, release, releaseAll };

  function grow(k) {
    if (k < slot.length) return;
    const n = Math.max(k + 1, slot.length * 2);
    const s = new Int32Array(n).fill(-1); s.set(slot); slot = s;
    const g = (a) => { const b = new Float64Array(n); b.set(a); return b; };
    spd = g(spd); px = g(px); py = g(py); hurtPrev = g(hurtPrev);
    const sn = new Uint8Array(n); sn.set(seen); seen = sn;
    ent.length = n; mod.length = n;
  }
  /** True when this voxel component's model carries a `blend` block (the view then skips the full hurt clip). */
  function has(v) {
    if (!bl) return false;
    const pm = api.pool && api.pool.models.get(v.model);
    return !!(pm && pm.blend);
  }
  function release(k, v) {
    if (!bl || k >= slot.length) return;
    if (slot[k] >= 0) { bl.release(slot[k]); slot[k] = -1; api.stats.attached--; }
    ent[k] = null; mod[k] = null; seen[k] = 0;
    if (v) v.animLayers = null;
  }
  function releaseAll() { for (let k = 0; k < slot.length; k++) release(k, null); }

  /**
   * One beast, after its final clip name is decided. `drv` = { phase, active } of the leg driver from the previous frame (or null).
   * Returns true when blended (v.animLayers set, v.anim = dominant clip).
   */
  function step(i, sim, e, v, clip, legs) {
    if (!bl) return false;
    const hit = sim.hurtT && sim.hurtT[i] < HURT_STEPS && (!seen[i] || sim.hurtT[i] < hurtPrev[i]) ? 1 : 0;
    const r = drive(i, e, v, clip, hit, legs);
    if (sim.hurtT) hurtPrev[i] = sim.hurtT[i];
    return r;
  }
  /** Any other view (the player): `hit` = 1 on the frame a hit lands. Inert until the model has a `blend` block. */
  function stepEntity(key, e, v, clip, hit) { return bl ? drive(key, e, v, clip, hit ? 1 : 0, null) : false; }

  function drive(k, e, v, clip, hit, legs) {
    grow(k);
    const pm = api.pool && api.pool.models.get(v.model);
    if (!pm || !pm.blend || !pm.clipIndex || !Object.prototype.hasOwnProperty.call(pm.clipIndex, clip)) {
      if (slot[k] >= 0 || v.animLayers) release(k, v);
      if (legs && legs.driver) legs.driver.io[11] = 0;
      return false;
    }
    if (slot[k] >= 0 && (ent[k] !== e || mod[k] !== pm)) release(k, v); // respawn into the slot / model swap
    const t = e.transform;
    let fresh = false;
    if (slot[k] < 0) {
      const s = bl.attach(pm);
      if (s < 0) return false;
      slot[k] = s; ent[k] = e; mod[k] = pm; api.stats.attached++; fresh = true;
      if (!pm.clipNames) pm.clipNames = Object.keys(pm.clipIndex).sort((a, b) => pm.clipIndex[a] - pm.clipIndex[b]);
    }
    if (measure(k, t, fresh)) fresh = true;
    const idx = pm.clipIndex[clip], b = pm.blend;
    const inSet = b.setStart && b.setStart.length > 1 && locoMember(b, idx);
    const io = bl.io;
    io[0] = inSet ? -1 : idx; io[1] = spd[k]; io[2] = -1; io[3] = hit && b.addClips.length ? 0 : -1; io[4] = 1;
    if (fresh) bl.reset(slot[k], io[0]);
    const lastP = legs && legs.phase && k < legs.phase.length ? legs.phase[k] : -1;
    dio[8] = lastP; dio[10] = lastP >= 0 ? 1 : 0; dio[11] = 0;
    bl.update(slot[k], pm, DT_MS, dio);
    if (legs && legs.driver) legs.driver.io[11] = dio[11];
    v.animLayers = bl.layersOf(slot[k]);
    v.anim = pm.clipNames[io[6] | 0]; // dominant clip: the leg driver's gait + footfall pattern
    return true;
  }
  // Measured speed (m/s) from the transform delta, smoothed in spd[k]; true on first sight / teleport (the blender then resets, no fade).
  // Typed-array maths in its own small function (38.61: no boxed doubles on the hot path).
  function measure(k, t, fresh) {
    let reset = false;
    if (!seen[k] || fresh) { spd[k] = 0; seen[k] = 1; }
    else {
      const dx = t.x - px[k], dy = t.y - py[k];
      const inst = Math.sqrt(dx * dx + dy * dy) * 60;
      if (inst > TELEPORT_MPS) { spd[k] = 0; reset = true; } else spd[k] += (inst - spd[k]) * SPEED_EMA;
    }
    px[k] = t.x; py[k] = t.y;
    return reset;
  }
  function locoMember(b, idx) {
    for (let j = b.setStart[0]; j < b.setStart[1]; j++) if (b.setClip[j] === idx) return true;
    return false;
  }
  return api;
}
