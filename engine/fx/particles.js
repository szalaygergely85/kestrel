// engine/fx/particles.js (US-053a, docs/architecture.md 32.0/32.1).
//
// Pooled particle sim: SoA typed arrays, ring-head allocation (the slot under
// the head is always the oldest spawn, so "recycle the oldest when full" is
// O(1)), emitters in a fixed 64-slot table. Zero allocation after create. No
// drawing (US-053b reads the arrays), no world/physics access: wind reaches
// the sim as plain numbers or a duck-typed `field.sampleInto`.
//
// Determinism (rule 15): fixed STEP, integer timers, slot/emitter-index
// iteration, own presentation RNG stream, no trig / Math.random / clock.
import { createRng } from '../core/rng.js';
import { STEP } from '../core/loop.js';
import { compileEmitterDef, basisInto, D, DEF_STRIDE, MAX_RAMP, HZ } from './emitterDef.js';

export const PARTICLE_CAP = 2048;
export const MAX_EMITTERS = 64;
export const MAX_PARTICLE_DEFS = 32;
const SLOT_BITS = 6; // handle = (generation << 6) | slot

/**
 * @param {{capacity?:number, seed?:number}} [opts]
 */
export function createParticles(opts = {}) {
  const cap = opts.capacity === undefined ? PARTICLE_CAP : opts.capacity | 0;
  if (!(cap >= 1)) throw new Error(`createParticles: capacity must be >= 1, got ${opts.capacity}`);
  const seed = opts.seed === undefined ? 1 : opts.seed;
  let rng = createRng(seed);

  // ---- particle SoA ----
  const px = new Float64Array(cap), py = new Float64Array(cap), pz = new Float64Array(cap);
  const vx = new Float64Array(cap), vy = new Float64Array(cap), vz = new Float64Array(cap);
  const kz = new Float64Array(cap).fill(-Infinity);
  const age = new Int32Array(cap), life = new Int32Array(cap);
  const def = new Uint8Array(cap);
  const em = new Int16Array(cap);
  const alive = new Uint8Array(cap);
  let head = 0;

  // ---- def tables ----
  const defRec = new Float64Array(MAX_PARTICLE_DEFS * DEF_STRIDE);
  const defGlyphs = new Uint16Array(MAX_PARTICLE_DEFS * MAX_RAMP);
  const defColors = new Uint8Array(MAX_PARTICLE_DEFS * MAX_RAMP * 3);
  const defKeys = new Map(); // load-time only
  let defCount = 0;

  // ---- emitter table (SoA) ----
  const E = MAX_EMITTERS;
  const eUsed = new Uint8Array(E), eOn = new Uint8Array(E), eReleased = new Uint8Array(E);
  const eTransient = new Uint8Array(E), eHasWind = new Uint8Array(E);
  const eDef = new Uint8Array(E);
  const eGen = new Uint32Array(E);
  const ex = new Float64Array(E), ey = new Float64Array(E), ez = new Float64Array(E);
  const eAxis = new Float64Array(E * 3), eAB = new Float64Array(E * 6);
  const eAcc = new Float64Array(E);
  const eLive = new Int32Array(E), ePending = new Int32Array(E);
  const eWx = new Float64Array(E), eWy = new Float64Array(E), eWz = new Float64Array(E);
  let gwx = 0, gwy = 0, gwz = 0;
  const windScratch = new Float64Array(3);

  const stats = { live: 0, spawned: 0, recycled: 0, dropped: 0 };

  function slotOf(h) {
    if (!(h >= 0)) return -1;
    const s = h & (E - 1);
    return eUsed[s] && eGen[s] === (h >>> SLOT_BITS) ? s : -1;
  }

  function allocEmitter(defId, x, y, z) {
    for (let s = 0; s < E; s++) {
      if (eUsed[s]) continue;
      eUsed[s] = 1; eOn[s] = 0; eReleased[s] = 0; eTransient[s] = 0; eHasWind[s] = 0;
      eDef[s] = defId; ex[s] = x; ey[s] = y; ez[s] = z;
      const o = defId * DEF_STRIDE;
      eAxis[s * 3] = defRec[o + D.DIR_X]; eAxis[s * 3 + 1] = defRec[o + D.DIR_Y]; eAxis[s * 3 + 2] = defRec[o + D.DIR_Z];
      for (let i = 0; i < 6; i++) eAB[s * 6 + i] = defRec[o + D.A_X + i];
      eAcc[s] = 0; eLive[s] = 0; ePending[s] = 0;
      return s;
    }
    stats.dropped++;
    return -1;
  }

  function setAxis(s, dx, dy, dz) {
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 0)) return;
    dx /= l; dy /= l; dz /= l;
    eAxis[s * 3] = dx; eAxis[s * 3 + 1] = dy; eAxis[s * 3 + 2] = dz;
    basisInto(dx, dy, dz, eAB, s * 6);
  }

  /** Spawns one particle for emitter s (def offset o). Fixed RNG draw order (32.1). */
  function spawn(s, o) {
    const slot = head;
    head = head + 1 === cap ? 0 : head + 1;
    if (alive[slot]) { eLive[em[slot]]--; stats.recycled++; stats.live--; }
    const lMin = defRec[o + D.LIFE_MIN], lMax = defRec[o + D.LIFE_MAX];
    const l = lMin + Math.floor(rng.nextFloat() * (lMax - lMin + 1));
    const sp = defRec[o + D.SPEED_MIN] + rng.nextFloat() * (defRec[o + D.SPEED_MAX] - defRec[o + D.SPEED_MIN]);
    const jx = (2 * rng.nextFloat() - 1) * defRec[o + D.BOX_X];
    const jy = (2 * rng.nextFloat() - 1) * defRec[o + D.BOX_Y];
    const jz = (2 * rng.nextFloat() - 1) * defRec[o + D.BOX_Z];
    const tan = defRec[o + D.SPREAD_TAN];
    const a3 = s * 3, b6 = s * 6;
    let dx = eAxis[a3], dy = eAxis[a3 + 1], dz = eAxis[a3 + 2];
    if (tan > 0) {
      // disk rejection (no trig): <= 8 tries, else the axis itself
      let u = 0, v = 0;
      for (let t = 0; t < 8; t++) {
        const uu = 2 * rng.nextFloat() - 1, vv = 2 * rng.nextFloat() - 1;
        if (uu * uu + vv * vv <= 1) { u = uu; v = vv; break; }
      }
      dx += (u * eAB[b6] + v * eAB[b6 + 3]) * tan;
      dy += (u * eAB[b6 + 1] + v * eAB[b6 + 4]) * tan;
      dz += (u * eAB[b6 + 2] + v * eAB[b6 + 5]) * tan;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx *= inv; dy *= inv; dz *= inv;
    }
    px[slot] = ex[s] + jx; py[slot] = ey[s] + jy; pz[slot] = ez[s] + jz;
    vx[slot] = dx * sp; vy[slot] = dy * sp; vz[slot] = dz * sp;
    const kb = defRec[o + D.KILL_BELOW];
    kz[slot] = kb === kb ? ez[s] - kb : -Infinity; // NaN = no kill plane
    age[slot] = 0; life[slot] = l;
    def[slot] = eDef[s]; em[slot] = s; alive[slot] = 1;
    eLive[s]++; stats.live++; stats.spawned++;
  }

  return {
    cap, px, py, pz, vx, vy, vz, kz, age, life, def, em, alive,
    defRec, defGlyphs, defColors, DEF_STRIDE, MAX_RAMP,
    /** emitter table for the draw (per-emitter lighting) */
    emitters: { used: eUsed, def: eDef, x: ex, y: ey, z: ez, live: eLive },
    stats,

    defineEmitter(key, d) {
      const c = compileEmitterDef(key, d);
      let id = defKeys.get(key);
      if (id === undefined) {
        if (defCount >= MAX_PARTICLE_DEFS) throw new Error(`defineEmitter("${key}"): more than ${MAX_PARTICLE_DEFS} defs`);
        id = defCount++;
        defKeys.set(key, id);
      }
      defRec.set(c.rec, id * DEF_STRIDE);
      defGlyphs.fill(0, id * MAX_RAMP, (id + 1) * MAX_RAMP);
      defGlyphs.set(c.glyphs, id * MAX_RAMP);
      defColors.fill(0, id * MAX_RAMP * 3, (id + 1) * MAX_RAMP * 3);
      defColors.set(c.colors, id * MAX_RAMP * 3);
      return id;
    },
    /** @returns {number} defId, or -1 */
    defIdOf(key) { const i = defKeys.get(key); return i === undefined ? -1 : i; },

    /** @returns {number} handle, or -1 when all 64 emitter slots are used (stats.dropped++) */
    createEmitter(defId, x, y, z) {
      if (!(defId >= 0 && defId < defCount)) throw new Error(`createEmitter: unknown defId ${defId}`);
      const s = allocEmitter(defId, x, y, z);
      return s < 0 ? -1 : ((eGen[s] << SLOT_BITS) | s);
    },
    isValid(h) { return slotOf(h) >= 0; },
    setEmitterPos(h, x, y, z) { const s = slotOf(h); if (s >= 0) { ex[s] = x; ey[s] = y; ez[s] = z; } },
    setEmitterDir(h, dx, dy, dz) { const s = slotOf(h); if (s >= 0) setAxis(s, dx, dy, dz); },
    setOn(h, on) { const s = slotOf(h); if (s >= 0 && !eReleased[s]) eOn[s] = on ? 1 : 0; },
    burst(h, n) {
      const s = slotOf(h);
      if (s < 0 || eReleased[s]) return;
      ePending[s] += n === undefined ? defRec[eDef[s] * DEF_STRIDE + D.BURST] : n | 0;
    },
    release(h) { const s = slotOf(h); if (s >= 0) { eOn[s] = 0; eReleased[s] = 1; } },
    burstAt(defId, x, y, z, n, dx, dy, dz) {
      if (!(defId >= 0 && defId < defCount)) throw new Error(`burstAt: unknown defId ${defId}`);
      const s = allocEmitter(defId, x, y, z);
      if (s < 0) return;
      eTransient[s] = 1; eReleased[s] = 1;
      ePending[s] = n === undefined ? defRec[defId * DEF_STRIDE + D.BURST] : n | 0;
      if (dx !== undefined) setAxis(s, dx, dy, dz);
    },
    setWind(wx, wy, wz) { gwx = wx; gwy = wy; gwz = wz; },
    setEmitterWind(h, wx, wy, wz) {
      const s = slotOf(h);
      if (s >= 0) { eWx[s] = wx; eWy[s] = wy; eWz[s] = wz; eHasWind[s] = 1; }
    },
    /** US-138: one field sample per used emitter at its position (duck-typed field). */
    sampleWind(field, tick) {
      for (let s = 0; s < E; s++) {
        if (!eUsed[s]) continue;
        field.sampleInto(ex[s], ey[s], ez[s], tick, windScratch);
        eWx[s] = windScratch[0]; eWy[s] = windScratch[1]; eWz[s] = windScratch[2]; eHasWind[s] = 1;
      }
    },

    step() {
      // 1. integrate live slots in slot order
      // MESH-PHYS-02: stop once every slot that was live at entry has been visited (same slots, same order; 0 live = no scan).
      let left = stats.live;
      for (let i = 0; i < cap && left > 0; i++) {
        if (!alive[i]) continue;
        left--;
        const a = age[i] + 1;
        const s = em[i];
        if (a >= life[i]) { alive[i] = 0; eLive[s]--; stats.live--; continue; }
        age[i] = a;
        const o = def[i] * DEF_STRIDE;
        const k = defRec[o + D.DRAG_K], ww = defRec[o + D.WIND];
        let wx = 0, wy = 0, wz = 0;
        if (ww !== 0) {
          if (eHasWind[s]) { wx = eWx[s] * ww; wy = eWy[s] * ww; wz = eWz[s] * ww; }
          else { wx = gwx * ww; wy = gwy * ww; wz = gwz * ww; }
        }
        vx[i] += (wx - vx[i]) * k;
        vy[i] += (wy - vy[i]) * k;
        vz[i] += (wz - vz[i]) * k + defRec[o + D.ACCEL_Z] * STEP;
        px[i] += vx[i] * STEP; py[i] += vy[i] * STEP; pz[i] += vz[i] * STEP;
        if (pz[i] < kz[i]) { alive[i] = 0; eLive[s]--; stats.live--; }
      }
      // 2. spawn + release per emitter, in emitter order
      for (let s = 0; s < E; s++) {
        if (!eUsed[s]) continue;
        const o = eDef[s] * DEF_STRIDE;
        const maxLive = defRec[o + D.MAX_LIVE];
        if (eOn[s]) {
          let acc = eAcc[s] + defRec[o + D.RATE];
          while (acc >= HZ && eLive[s] < maxLive) { spawn(s, o); acc -= HZ; }
          if (eLive[s] >= maxLive && acc > HZ) acc = HZ; // no backlog burst later
          eAcc[s] = acc;
        }
        let n = ePending[s];
        if (n > 0) {
          while (n > 0 && eLive[s] < maxLive) { spawn(s, o); n--; }
          ePending[s] = 0; // the part over maxLive is dropped, never deferred
        }
        if (eReleased[s] && eLive[s] === 0) { eUsed[s] = 0; eGen[s] = (eGen[s] + 1) & 0x1ffffff; }
      }
    },

    /** World load / restart: kills everything, frees every emitter, re-seeds the stream. */
    clear() {
      alive.fill(0); kz.fill(-Infinity);
      eUsed.fill(0); eOn.fill(0); eReleased.fill(0); eTransient.fill(0); eHasWind.fill(0);
      eLive.fill(0); ePending.fill(0); eAcc.fill(0);
      for (let s = 0; s < E; s++) eGen[s] = (eGen[s] + 1) & 0x1ffffff; // old handles go stale (masked: gen << 6 stays positive)
      head = 0; gwx = gwy = gwz = 0;
      rng = createRng(seed);
      stats.live = 0; stats.spawned = 0; stats.recycled = 0; stats.dropped = 0;
    },

    /** Duck-typed hasher (engine/core/hash.js). Live slots + emitter table + rng, fixed order. */
    hashInto(h) {
      h.u32(head);
      h.u32(stats.live); h.u32(stats.spawned); h.u32(stats.recycled); h.u32(stats.dropped);
      for (let i = 0; i < cap; i++) {
        if (!alive[i]) continue;
        h.u32(i);
        h.f64(px[i]); h.f64(py[i]); h.f64(pz[i]);
        h.f64(vx[i]); h.f64(vy[i]); h.f64(vz[i]);
        h.u32(age[i]); h.u32(life[i]); h.u32(def[i]); h.u32(em[i]);
      }
      for (let s = 0; s < E; s++) {
        if (!eUsed[s]) continue;
        h.u32(s); h.u32(eDef[s]); // eGen is handle bookkeeping, not sim state
        h.u32(eOn[s] | (eReleased[s] << 1) | (eTransient[s] << 2));
        h.f64(ex[s]); h.f64(ey[s]); h.f64(ez[s]); h.f64(eAcc[s]);
        h.u32(eLive[s]); h.u32(ePending[s]);
        h.u32(eHasWind[s]); h.f64(eWx[s]); h.f64(eWy[s]); h.f64(eWz[s]);
      }
      h.f64(gwx); h.f64(gwy); h.f64(gwz);
      const st = rng.s;
      h.u32(st[0]); h.u32(st[1]); h.u32(st[2]); h.u32(st[3]);
    },
  };
}
