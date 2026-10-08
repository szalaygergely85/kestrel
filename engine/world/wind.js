// engine/world/wind.js (US-138, docs/architecture.md 32.5).
//
// A deterministic wind field: a constant base wind (direction + speed) with
// a trig-free, wall-clock-free "gust" ripple that travels downwind, plus up
// to 16 named zones that locally override (`mode: 'set'`) or add to
// (`mode: 'add'`) the base field with a soft edge falloff. Built once by
// `World.load` from the optional `world.wind` JSON block (32.0 item 6:
// content, not state) and sampled every step by consumers (particles, fire,
// future projectiles, the player push) via `sampleInto`/`pushAt`.
//
// No `Math.sin/cos/tan` here (rule 15, docs/architecture.md 28.5): the
// compass bearing is converted to a unit vector exactly once, at create,
// through `forwardOf` (engine/core/transform.js) - the one place trig for
// the compass convention is allowed to live. Everything per-sample is
// integer-tick arithmetic plus the smoothstep polynomial.
import { createRng } from '../core/rng.js';
import { forwardOf } from '../core/transform.js';
import { STEP } from '../core/loop.js';

export const WIND_K_SIZE = 64;
export const WIND_MAX_ZONES = 16;
export const WIND_PUSH_MAX = 1.5; // m/s, architecture.md 32.5

function posMod(a, n) {
  const m = a % n;
  return m < 0 ? m + n : m;
}

/** Signed inside-distance (m): positive inside the shape (growing away from
 * the nearest edge), <= 0 outside. Used for the zone edge-falloff weight. */
function insideDistance(zone, x, y) {
  if (zone.shape === 'circle') {
    const dx = x - zone.cx, dy = y - zone.cy;
    return zone.r - Math.sqrt(dx * dx + dy * dy);
  }
  const dx = Math.min(x - zone.x0, zone.x1 - x);
  const dy = Math.min(y - zone.y0, zone.y1 - y);
  return Math.min(dx, dy);
}

function validateZones(list) {
  if (!list) return [];
  if (list.length > WIND_MAX_ZONES) {
    throw new Error(`createWind: zones (${list.length}) exceeds max ${WIND_MAX_ZONES}`);
  }
  const seen = new Set();
  const out = [];
  const fwdScratch = [0, 0];
  for (const z of list) {
    const id = z && z.id;
    const tag = id ? `"${id}"` : '(no id)';
    if (!id || typeof id !== 'string') throw new Error(`createWind: zone ${tag}: "id" is required`);
    if (seen.has(id)) throw new Error(`createWind: zone ${tag}: duplicate id`);
    seen.add(id);
    const shape = z.shape === 'circle' ? 'circle' : z.shape === 'rect' ? 'rect' : null;
    if (!shape) throw new Error(`createWind: zone ${tag}: "shape" must be "rect" or "circle"`);
    const edge = typeof z.edge === 'number' && z.edge > 0 ? z.edge : 1;
    const mode = z.mode === 'set' ? 'set' : 'add';
    forwardOf(typeof z.dirDeg === 'number' ? z.dirDeg : 0, fwdScratch);
    const zone = {
      id, shape, mode, edge,
      dirX: fwdScratch[0], dirY: fwdScratch[1],
      speed: typeof z.speed === 'number' ? z.speed : 0,
      push: !!z.push,
      x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, r: 0,
    };
    if (shape === 'circle') {
      const c = z.c;
      if (!Array.isArray(c) || c.length < 2) throw new Error(`createWind: zone ${tag}: "c" must be [x, y]`);
      if (typeof z.r !== 'number' || !(z.r > 0)) throw new Error(`createWind: zone ${tag}: "r" must be a finite number > 0`);
      zone.cx = c[0]; zone.cy = c[1]; zone.r = z.r;
    } else {
      const rect = z.rect;
      if (!Array.isArray(rect) || rect.length < 4) throw new Error(`createWind: zone ${tag}: "rect" must be [x0, y0, x1, y1]`);
      zone.x0 = rect[0]; zone.y0 = rect[1]; zone.x1 = rect[2]; zone.y1 = rect[3];
    }
    out.push(zone);
  }
  return out;
}

/**
 * @typedef {Object} WindField
 * @property {(x:number,y:number,z:number,tick:number,out:number[]|Float32Array)=>*} sampleInto
 * @property {(x:number,y:number,tick:number,out:number[]|Float32Array)=>*} pushAt
 * @property {(tick:number,camX:number,camY:number,out:number[]|Float32Array)=>*} uniforms
 * @property {(h:*)=>void} hashInto
 */

/**
 * Builds a `WindField` from the optional world JSON `wind` block.
 * `def` may be null/undefined (a calm field: speed 0, no zones) - every
 * world before this story, and any world that doesn't author wind.
 * @param {Object} [def]
 * @param {number} [seed] RNG seed for the 64-knot gust table (its own
 *   stream, 32.0 item 4 "RNG streams": never shared with particles/fire/the
 *   beast sim). The schema has no `seed` key of its own yet, so this comes
 *   from `def.seed` when present, else the caller's default.
 * @returns {WindField}
 */
export function createWind(def, seed) {
  const d = def || {};
  const gustDef = d.gust || {};
  const dirDeg = typeof d.dirDeg === 'number' ? d.dirDeg : 0;
  const speed = typeof d.speed === 'number' ? d.speed : 0;
  const amp = typeof gustDef.amp === 'number' ? gustDef.amp : 0;
  const periodSec = typeof gustDef.periodSec === 'number' && gustDef.periodSec > 0 ? gustDef.periodSec : 1;
  const travel = typeof gustDef.travel === 'number' && gustDef.travel > 0 ? gustDef.travel : 1;
  const P = Math.max(1, Math.round(periodSec / STEP));

  const rngSeed = typeof d.seed === 'number' ? d.seed : (typeof seed === 'number' ? seed : 1);
  const rng = createRng(rngSeed);
  const K = new Float64Array(WIND_K_SIZE);
  for (let i = 0; i < WIND_K_SIZE; i++) K[i] = rng.nextFloat();

  const dirScratch = [0, 0];
  forwardOf(dirDeg, dirScratch);
  const dirX = dirScratch[0], dirY = dirScratch[1];

  const zones = validateZones(d.zones);

  // Gust knot-interpolation factor g in [0,1] at (x, y, tick), travelling
  // downwind along the base wind direction (architecture.md 32.5).
  function gustG(x, y, tick) {
    const tl = tick - (x * dirX + y * dirY) / (travel * STEP);
    const k = Math.floor(tl / P);
    const fr = (tl - k * P) / P;
    const s = fr * fr * (3 - 2 * fr); // smoothstep
    const k0 = posMod(k, WIND_K_SIZE), k1 = posMod(k + 1, WIND_K_SIZE);
    return K[k0] + (K[k1] - K[k0]) * s;
  }

  function speedAt(baseSpeed, g) {
    return baseSpeed * Math.max(0, 1 + amp * (2 * g - 1));
  }

  /** Base (zone-free) wind vector at (x, y, tick), into caller's out2. */
  function baseInto(x, y, tick, out) {
    const g = gustG(x, y, tick);
    const s = speedAt(speed, g);
    out[0] = dirX * s;
    out[1] = dirY * s;
    return out;
  }

  const field = {};

  /** Full field sample (base + zones) at a world point. z is reserved
   * (vz always 0 - no vertical wind in v1). Zero allocation. */
  field.sampleInto = function sampleInto(x, y, z, tick, out) {
    const g = gustG(x, y, tick);
    const sp = speedAt(speed, g);
    let vx = dirX * sp;
    let vy = dirY * sp;
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const dist = insideDistance(zn, x, y);
      if (dist <= 0) continue;
      const w = dist >= zn.edge ? 1 : dist / zn.edge;
      const zs = speedAt(zn.speed, g);
      const zvx = zn.dirX * zs, zvy = zn.dirY * zs;
      if (zn.mode === 'set') {
        vx = vx + (zvx - vx) * w;
        vy = vy + (zvy - vy) * w;
      } else {
        vx += zvx * w;
        vy += zvy * w;
      }
    }
    out[0] = vx;
    out[1] = vy;
    out[2] = 0;
    return out;
  };

  /** Sum of the `push:true` zones at (x, y, tick), magnitude capped at
   * WIND_PUSH_MAX m/s (direction preserved). Zero allocation. */
  field.pushAt = function pushAt(x, y, tick, out) {
    const g = gustG(x, y, tick);
    let px = 0, py = 0;
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      if (!zn.push) continue;
      const dist = insideDistance(zn, x, y);
      if (dist <= 0) continue;
      const w = dist >= zn.edge ? 1 : dist / zn.edge;
      const zs = speedAt(zn.speed, g);
      px += zn.dirX * zs * w;
      py += zn.dirY * zs * w;
    }
    const mag = Math.sqrt(px * px + py * py);
    if (mag > WIND_PUSH_MAX) {
      const k = WIND_PUSH_MAX / mag;
      px *= k;
      py *= k;
    }
    out[0] = px;
    out[1] = py;
    return out;
  };

  /** Shader-facing summary: base direction + the base wind's speed at the
   * camera, plus a wall-clock-free time value for presentation ripple. */
  field.uniforms = function uniforms(tick, camX, camY, out) {
    const g = gustG(camX, camY, tick);
    out[0] = dirX;
    out[1] = dirY;
    out[2] = speedAt(speed, g);
    out[3] = tick * STEP;
    return out;
  };

  /** Folds the static config + gust table into hasher `h` (determinism
   * checkpoints, 28.5). Zero allocation. */
  field.hashInto = function hashInto(h) {
    h.f64(dirX);
    h.f64(dirY);
    h.f64(speed);
    h.f64(amp);
    h.u32(P >>> 0);
    h.f64(travel);
    for (let i = 0; i < WIND_K_SIZE; i++) h.f64(K[i]);
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      h.f64(zn.dirX);
      h.f64(zn.dirY);
      h.f64(zn.speed);
      h.f64(zn.edge);
      h.u32(zn.mode === 'set' ? 1 : 0);
      h.u32(zn.push ? 1 : 0);
      h.u32(zn.shape === 'circle' ? 1 : 0); // review: zone geometry is part of the hash
      if (zn.shape === 'circle') { h.f64(zn.cx); h.f64(zn.cy); h.f64(zn.r); } else { h.f64(zn.x0); h.f64(zn.y0); h.f64(zn.x1); h.f64(zn.y1); }
    }
  };

  // Exposed for tests/consumers that need the raw base sample without zone
  // layering (e.g. a fixture that wants to check gust continuity in
  // isolation). Not part of the documented API surface in 32.5, but zero
  // allocation and harmless to expose.
  field._baseInto = baseInto;

  // S8-B2-06: the static config the GPU twin needs (engine/mesh/sway.js packs it; WIND_AT_WGSL in common.wgsl.js is the twin of
  // `baseInto`: base vector from forwardOf, gust kernel table K, zones off). Read-only by convention.
  field.params = { dirX, dirY, speed, amp, P, travel, K };

  return field;
}
