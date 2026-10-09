// engine/world/water.js (US-055a1, docs/architecture.md 32.2): water regions as world DATA + the point query.
// Content, not state: built once by World.load from `def.water` (world coords) and every placed structure's
// `level.def.water` (level-local, converted through the structure frame). No rendering here (US-055a2).
// Regions are flat (one z): axis-aligned rects and circles only (a level yawSteps keeps rects axis-aligned).
import { localToWorld, localDirToWorld } from '../core/transform.js';
import { buildWaveTables, createWaveClock } from './waves.js';

export const WATER_MAX = 32;
// S8-B2-13 (38.14): splash ripples, a composite-only presentation ring buffer owned by the water sim clock below.
// No geometry displacement (water.wgsl.js / waterLayer.js / rasterWaterTri / waterMesh.js are untouched). Never in
// saveState()/hashInto() (cosmetic; World.load always starts with 0 live rings, see the ripT0 sentinel below).
export const RIPPLE_MAX = 8;
export const RIPPLE_LIFE = 2; // seconds
export const RIPPLE_SPEED = 1.5; // m/s
export const RIPPLE_R0 = 0.2; // m
export const RIPPLE_HALF_W = 0.25; // m
/** Sentinel `ripT0` (tick) for a never-used ring slot: age is huge and positive forever, so a fresh table has 0 live rings. */
const RIPPLE_SENTINEL_TICK = -1000000000;
/** Max flow speed (m/s) of a region's `flow` / `flowRadial` (US-141a, architecture.md 35.1). */
export const FLOW_MAX = 6;
/** US-143a (architecture.md 35.1): `waves` region key + world `seaState` default. */
export const WAVES_SET = new Set(['none', 'calm', 'breezy', 'storm', 'sea']);
export const SEA_STATES = new Set(['calm', 'breezy', 'storm']);
const LOOK_MAX = 255;
const KIND_RECT = 0, KIND_CIRCLE = 1;
const _p = { x: 0, y: 0, z: 0 }, _q = { x: 0, y: 0, z: 0 }, _d = [0, 0];

const num = (v) => typeof v === 'number' && isFinite(v);
const bad = (id, msg) => { throw new Error(`World.load: water "${id}": ${msg}`); };

/** Validates one raw region (throws naming it). `tag` is the display id (structure-prefixed for level blocks). */
function validateOne(r, tag) {
  if (!r || typeof r !== 'object') bad(tag, 'entry must be an object');
  if (r.shape === 'rect') {
    const a = r.rect;
    if (!Array.isArray(a) || a.length !== 4 || !a.every(num)) bad(tag, '"rect" must be [x0, y0, x1, y1] (finite numbers)');
    if (!(a[2] > a[0]) || !(a[3] > a[1])) bad(tag, '"rect" needs x1 > x0 and y1 > y0');
  } else if (r.shape === 'circle') {
    if (!Array.isArray(r.c) || r.c.length !== 2 || !r.c.every(num)) bad(tag, '"c" must be [x, y] (finite numbers)');
    if (!num(r.r) || r.r <= 0) bad(tag, '"r" must be a finite number > 0');
  } else bad(tag, `unknown shape "${r.shape}" (rect | circle)`);
  if (!num(r.z)) bad(tag, '"z" must be a finite number');
  if (r.look !== undefined && (typeof r.look !== 'string' || !r.look)) bad(tag, '"look" must be a non-empty string');
  if (r.flow !== undefined) {
    if (!Array.isArray(r.flow) || r.flow.length !== 2 || !r.flow.every(num)) bad(tag, '"flow" must be [fx, fy]');
    if (Math.hypot(r.flow[0], r.flow[1]) > FLOW_MAX) bad(tag, `"flow" speed must be <= ${FLOW_MAX} m/s`);
  }
  if (r.flowRadial !== undefined) {
    if (r.shape !== 'circle') bad(tag, '"flowRadial" is only valid on a circle');
    if (!num(r.flowRadial) || Math.abs(r.flowRadial) > FLOW_MAX) bad(tag, `"flowRadial" must be a finite number with |s| <= ${FLOW_MAX} m/s`);
  }
  if (r.waves !== undefined && (typeof r.waves !== 'string' || !WAVES_SET.has(r.waves))) bad(tag, '"waves" must be "none" | "calm" | "breezy" | "storm" | "sea"');
  if (r.waveDirDeg !== undefined && !num(r.waveDirDeg)) bad(tag, '"waveDirDeg" must be a finite number');
  if (r.seed !== undefined && !Number.isInteger(r.seed)) bad(tag, '"seed" must be an integer');
}

function checkId(r, where) {
  const id = r && r.id;
  if (!id || typeof id !== 'string') throw new Error(`World.load: water entry in ${where}: "id" is required`);
  return id;
}

/**
 * World `def.water` + each placed structure's `level.def.water` -> validated world-space defs.
 * Level ids are prefixed `<structId>.`; level-local x/y/z go through the frame (rect corners re-normalised).
 * @returns {Object[]} fresh plain objects {id, shape, rect|c+r, z, look, flow, flowRadial}
 */
export function collectWaterDefs(def, structures) {
  const out = [];
  const seen = new Set();
  const push = (o) => {
    if (seen.has(o.id)) bad(o.id, 'duplicate id');
    seen.add(o.id);
    out.push(o);
    if (out.length > WATER_MAX) throw new Error(`World.load: water: more than ${WATER_MAX} regions (at "${o.id}")`);
  };
  for (const r of (def && def.water) || []) {
    const id = checkId(r, 'world');
    validateOne(r, id);
    push({
      id, shape: r.shape, rect: r.rect ? r.rect.slice() : null, c: r.c ? r.c.slice() : null, r: r.r || 0, z: r.z, look: r.look || 'water',
      flow: r.flow ? r.flow.slice() : [0, 0], flowRadial: r.flowRadial || 0,
      waves: r.waves || 'calm', waveDirDeg: typeof r.waveDirDeg === 'number' ? r.waveDirDeg : 0, seed: Number.isInteger(r.seed) ? r.seed : 1,
    });
  }
  for (const s of structures || []) {
    const list = s.level && s.level.def && s.level.def.water;
    for (const r of list || []) {
      const lid = checkId(r, `structure "${s.id}"`);
      const id = `${s.id}.${lid}`;
      validateOne(r, id);
      const f = s.frame;
      let rect = null, c = null;
      if (r.shape === 'rect') {
        localToWorld(f, r.rect[0], r.rect[1], 0, _p);
        localToWorld(f, r.rect[2], r.rect[3], 0, _q);
        rect = [Math.min(_p.x, _q.x), Math.min(_p.y, _q.y), Math.max(_p.x, _q.x), Math.max(_p.y, _q.y)];
      } else {
        localToWorld(f, r.c[0], r.c[1], 0, _p);
        c = [_p.x, _p.y];
      }
      const fl = r.flow || [0, 0];
      localDirToWorld(f, fl[0], fl[1], _d);
      // US-143a (35.1): "a level frame adds 90*yawSteps" to the local waveDirDeg (compass bearing, level-local).
      const waveDirDeg = (typeof r.waveDirDeg === 'number' ? r.waveDirDeg : 0) + 90 * (f.yawSteps || 0);
      push({
        id, shape: r.shape, rect, c, r: r.r || 0, z: r.z + f.z, look: r.look || 'water', flow: [_d[0], _d[1]], flowRadial: r.flowRadial || 0,
        waves: r.waves || 'calm', waveDirDeg, seed: Number.isInteger(r.seed) ? r.seed : 1,
      });
    }
  }
  return out;
}

/**
 * The runtime table (SoA, Float64 geometry). `look` = index into `lookNames` (first-seen order), resolved here
 * so 055a2 can bind the designer look table once. Never mutated after creation.
 */
export function createWater(defs, seaState = 'calm') {
  const n = defs.length;
  const t = {
    count: n, ids: new Array(n), lookNames: [],
    x0: new Float64Array(n), y0: new Float64Array(n), x1: new Float64Array(n), y1: new Float64Array(n),
    cx: new Float64Array(n), cy: new Float64Array(n), r2: new Float64Array(n), z: new Float64Array(n),
    flow: new Float64Array(n * 2), flowR: new Float64Array(n), kind: new Uint8Array(n), look: new Uint8Array(n),
    // S8-B2-13 (38.14): ripple ring buffer (presentation only, never saved). ripHead is the next slot to write;
    // the 9th addRipple overwrites the oldest (index 0 again, after wrapping through 0..7).
    ripX: new Float64Array(RIPPLE_MAX), ripY: new Float64Array(RIPPLE_MAX),
    ripT0: new Int32Array(RIPPLE_MAX).fill(RIPPLE_SENTINEL_TICK), ripAmp: new Float32Array(RIPPLE_MAX), ripHead: 0,
    /**
     * Adds a splash ripple at ground point (x east, y south), amp clamped to [0,1]. Non-finite x/y/amp: returns
     * false and writes nothing. Deterministic: timed off `this.tick` (the water sim clock), never wall time.
     * @param {number} x @param {number} y @param {number} amp @returns {boolean}
     */
    addRipple(x, y, amp) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(amp)) return false;
      const a = amp < 0 ? 0 : amp > 1 ? 1 : amp;
      const i = this.ripHead;
      this.ripX[i] = x; this.ripY[i] = y; this.ripT0[i] = this.tick; this.ripAmp[i] = a;
      this.ripHead = (i + 1) % RIPPLE_MAX;
      return true;
    },
    /** Highest-z region containing (x, y), or -1 (ties: lower index). Pure, zero allocation. */
    /**
     * US-141a: region `i`'s flow at (x, y) into out[0..1] = `flow` + `flowRadial * unit(p - c)` (circle; 0 at the centre). Zero allocation.
     */
    flowInto(i, x, y, out) {
      let vx = this.flow[i * 2], vy = this.flow[i * 2 + 1];
      const s = this.flowR[i];
      if (s !== 0) {
        const dx = x - this.cx[i], dy = y - this.cy[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-9) { vx += s * dx / d; vy += s * dy / d; }
      }
      out[0] = vx; out[1] = vy;
    },
    find(x, y) {
      let best = -1, bz = -Infinity;
      for (let i = 0; i < this.count; i++) {
        if (x < this.x0[i] || y < this.y0[i]) continue; // AABB reject
        const circle = this.kind[i] === KIND_CIRCLE;
        if (circle ? (x > this.x1[i] || y > this.y1[i]) : (x >= this.x1[i] || y >= this.y1[i])) continue; // circle bbox inclusive (rim counts)
        if (circle) {
          const dx = x - this.cx[i], dy = y - this.cy[i];
          if (dx * dx + dy * dy > this.r2[i]) continue;
        }
        if (this.z[i] > bz) { bz = this.z[i]; best = i; }
      }
      return best;
    },
  };
  for (let i = 0; i < n; i++) {
    const d = defs[i];
    t.ids[i] = d.id;
    t.z[i] = d.z;
    t.flow[i * 2] = d.flow[0]; t.flow[i * 2 + 1] = d.flow[1]; t.flowR[i] = d.flowRadial || 0;
    if (d.shape === 'rect') {
      t.kind[i] = KIND_RECT;
      t.x0[i] = d.rect[0]; t.y0[i] = d.rect[1]; t.x1[i] = d.rect[2]; t.y1[i] = d.rect[3];
    } else {
      t.kind[i] = KIND_CIRCLE;
      t.cx[i] = d.c[0]; t.cy[i] = d.c[1]; t.r2[i] = d.r * d.r;
      t.x0[i] = d.c[0] - d.r; t.x1[i] = d.c[0] + d.r; t.y0[i] = d.c[1] - d.r; t.y1[i] = d.c[1] + d.r;
    }
    let li = t.lookNames.indexOf(d.look);
    if (li < 0) {
      if (t.lookNames.length >= LOOK_MAX) bad(d.id, `more than ${LOOK_MAX} distinct looks`);
      li = t.lookNames.push(d.look) - 1;
    }
    t.look[i] = li;
  }
  // US-143a (35.1/35.2): the wave field + clock, merged onto `t` so `world.water`
  // itself IS the `wt` that `waveSampleInto`/`waveHeight` (waves.js) read, and
  // `world.water.step()`/`setSeaState()`/`hashInto()`/`setTickForTest()` are
  // plain methods on the water table.
  const { wk, wa, seaRegions } = buildWaveTables(defs, seaState);
  createWaveClock(t, wk, wa, seaRegions, seaState); // mutates `t` in place (see waves.js)
  return t;
}
