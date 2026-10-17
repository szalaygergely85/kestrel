// OB-073-D2a (arch 38.52 item 6): near-field grass carpet config check + class map. Derived render data:
// never serialized, never hashed, never read by the sim. Pure JS, no render code (D2b+ consume the map).
import { maskAt } from './grassMask.js';
export const CARPET_MAX_VARIANTS = 15;
// TUFT-01a: cellM 0.10 -> 0.35 (one tuft per cell); tuftR = tuft half-width / cellM (0.1..0.5)
export const CARPET_DEFAULTS = { cellM: 0.35, radiusM: 12, patchM: 6, classCellM: 2, classJitterM: 0.8, gustM: 5, travelM: 1.5, bladeW: 0.06, swayGain: 1, tuftR: 0.45 };
export const LEAN_CAP_M = 0.6, PATCH_MAX = 1.25; // OB-096: mirror LEAN_CAP / (PATCH_LO + PATCH_RANGE) of render/carpet.js (render imports these; no render import here)
export const TUFT_DEFAULT_P = 0.06, TUFT_DEFAULT_MUL = 1.8;
const ZERO_OK = ['classJitterM', 'travelM']; // 0 = no jitter / no travel is valid

const fail = (key, msg) => { throw new Error(`carpet.${key}: ${msg}`); };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// OB-073-D2f: optional per-variant world areas (content shapes, same vocabulary as recipe.detail.exclude). The keep rect pins
// biomeAt to 0 around all authored places, so ground type + biome alone cannot tell the ford bank or the Outwall from the meadow.
const AREA_KEYS = { disc: ['x', 'y', 'r'], capsule: ['ax', 'ay', 'bx', 'by', 'r'], rect: ['x0', 'y0', 'x1', 'y1'] };
const areaOk = (a) => !!a && !!AREA_KEYS[a.shape] && AREA_KEYS[a.shape].every((k) => isNum(a[k])) && (a.r === undefined || a.r > 0);
function inArea(a, x, y) {
  if (a.shape === 'disc') { const dx = x - a.x, dy = y - a.y; return dx * dx + dy * dy <= a.r * a.r; }
  if (a.shape === 'rect') return x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1;
  const ex = a.bx - a.ax, ey = a.by - a.ay, l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((x - a.ax) * ex + (y - a.ay) * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - a.ax - ex * t, dy = y - a.ay - ey * t; return dx * dx + dy * dy <= a.r * a.r;
}
// GRASS-VARIETY-01: world-space patch picker. A variant may carry `patch: {scaleM, lo, hi, salt}`; it only claims a class cell where the smooth
// value noise at the cell centre (period scaleM metres) lies in [lo, hi). Variants that share ground/areas but own disjoint [lo,hi) bands
// therefore split the field into coherent patches of different grass types. Pure + deterministic: same (x, y) -> same value; no Math.random.
export const PATCH_SALT_DEFAULT = 7919;
function patchHash(ix, iy, salt) { // int32 mix -> 0..1
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}
/** smooth value noise 0..1 at world (x, y), lattice period scaleM metres */
export function grassPatchValue(x, y, scaleM, salt) {
  const fx0 = x / scaleM, fy0 = y / scaleM, ix = Math.floor(fx0), iy = Math.floor(fy0);
  let fx = fx0 - ix, fy = fy0 - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = patchHash(ix, iy, salt), b = patchHash(ix + 1, iy, salt), c = patchHash(ix, iy + 1, salt), d = patchHash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** true when variant patch `p` (or none) claims world (x, y) */
export function inPatch(p, x, y) {
  if (!p) return true;
  const n = grassPatchValue(x, y, p.scaleM, p.salt === undefined ? PATCH_SALT_DEFAULT : p.salt);
  return n >= p.lo && n < p.hi;
}
function inAreas(as, x, y) { for (let k = 0; k < as.length; k++) if (inArea(as[k], x, y)) return true; return false; }

/** Throws an Error naming the offending key (e.g. `carpet.variants[2].heightM`). Returns cfg. */
export function validateCarpetConfig(cfg, typeNames) {
  if (!cfg || typeof cfg !== 'object') fail('', 'config must be an object');
  if (!isNum(cfg.seed)) fail('seed', 'must be a finite number');
  for (const k of Object.keys(CARPET_DEFAULTS)) {
    if (cfg[k] === undefined) continue;
    if (ZERO_OK.indexOf(k) >= 0) { if (!(isNum(cfg[k]) && cfg[k] >= 0)) fail(k, 'must be a number >= 0'); }
    else if (!(isNum(cfg[k]) && cfg[k] > 0)) fail(k, 'must be a number > 0');
  }
  if (cfg.underlay !== undefined && !(isNum(cfg.underlay) && cfg.underlay >= 0 && cfg.underlay <= 1)) fail('underlay', 'must be a number 0..1'); // OB-121b
  if (cfg.tuftR !== undefined && !(isNum(cfg.tuftR) && cfg.tuftR >= 0.1 && cfg.tuftR <= 0.5)) fail('tuftR', 'must be a number 0.1..0.5');
  if (cfg.fadeStart !== undefined && !(isNum(cfg.fadeStart) && cfg.fadeStart >= 0 && cfg.fadeStart <= 0.95)) fail('fadeStart', 'must be a number 0..0.95'); // OB-103
  if (cfg.tuftAtlas !== undefined && (!cfg.tuftAtlas || typeof cfg.tuftAtlas !== 'object')) fail('tuftAtlas', 'must be an object {n,w,h,blades,curl,widthTex}');
  if (cfg.cutGround !== undefined && (!Array.isArray(cfg.cutGround) || cfg.cutGround.some((n) => typeof n !== 'string' || !typeNames || typeNames.indexOf(n) < 0))) fail('cutGround', 'must be an array of known ground type names');
  if (cfg.mask != null && typeof cfg.mask !== 'function' && typeof cfg.mask.sample !== 'function' && !(cfg.mask.chunks instanceof Map)) fail('mask', 'must be null, a GrassMaskLayer, a function (x, y) => 0..1 or an object with sample(x, y)');
  const vs = cfg.variants;
  if (!Array.isArray(vs) || vs.length < 1) fail('variants', 'must be a non-empty array');
  if (vs.length > CARPET_MAX_VARIANTS) fail('variants', `${vs.length} variants (max ${CARPET_MAX_VARIANTS})`);
  vs.forEach((v, i) => {
    const p = `variants[${i}]`;
    if (!v || typeof v !== 'object') fail(p, 'must be an object');
    if (!Array.isArray(v.ground) || v.ground.length < 1) fail(`${p}.ground`, 'must be a non-empty array of ground type names');
    for (const g of v.ground) if (!typeNames || typeNames.indexOf(g) < 0) fail(`${p}.ground`, `unknown ground type "${g}"`);
    if (v.biomes !== undefined && !(Array.isArray(v.biomes) && v.biomes.every((b) => Number.isInteger(b) && b >= 0 && b < 256))) fail(`${p}.biomes`, 'must be an array of u8 biome ids');
    if (!isNum(v.density) || v.density < 0 || v.density > 1) fail(`${p}.density`, 'must be a number 0..1');
    if (!Array.isArray(v.heightM) || v.heightM.length !== 2 || !isNum(v.heightM[0]) || !isNum(v.heightM[1]) || v.heightM[0] <= 0 || v.heightM[1] < v.heightM[0]) fail(`${p}.heightM`, 'must be [min, max] with 0 < min <= max');
    if (v.bladeW !== undefined && !(isNum(v.bladeW) && v.bladeW > 0)) fail(`${p}.bladeW`, 'must be a number > 0');
    if (!Array.isArray(v.ramp) || v.ramp.length < 2 || v.ramp.length > 4) fail(`${p}.ramp`, `length must be 2..4 (got ${Array.isArray(v.ramp) ? v.ramp.length : typeof v.ramp})`);
    if (v.swayGain !== undefined && !isNum(v.swayGain)) fail(`${p}.swayGain`, 'must be a number');
    if (v.areas !== undefined) {
      if (!Array.isArray(v.areas) || v.areas.length < 1) fail(`${p}.areas`, 'must be a non-empty array of shapes');
      v.areas.forEach((a, k) => { if (!areaOk(a)) fail(`${p}.areas[${k}]`, 'must be {shape:"disc",x,y,r} | {shape:"capsule",ax,ay,bx,by,r} | {shape:"rect",x0,y0,x1,y1}'); });
    }
    if (v.patch !== undefined) {
      const q = v.patch;
      if (!q || !isNum(q.scaleM) || q.scaleM < 2 || !isNum(q.lo) || !isNum(q.hi) || q.lo < 0 || q.hi > 1.0001 || q.lo >= q.hi || (q.salt !== undefined && !Number.isInteger(q.salt))) fail(`${p}.patch`, 'must be {scaleM >= 2, lo, hi (0 <= lo < hi <= 1), salt?:int}');
    }
    if (v.tuft !== undefined) {
      if (!v.tuft || typeof v.tuft !== 'object') fail(`${p}.tuft`, 'must be {p, mul}');
      if (v.tuft.p !== undefined && !(isNum(v.tuft.p) && v.tuft.p >= 0 && v.tuft.p <= 1)) fail(`${p}.tuft.p`, 'must be a number 0..1');
      if (v.tuft.mul !== undefined && !(isNum(v.tuft.mul) && v.tuft.mul >= 1)) fail(`${p}.tuft.mul`, 'must be a number >= 1');
    }
    if (v.glyphs !== undefined) {
      if (!v.glyphs || typeof v.glyphs !== 'object') fail(`${p}.glyphs`, 'must be an object');
      for (const k of ['base', 'mid', 'tip', 'leanL', 'leanR']) if (v.glyphs[k] !== undefined && typeof v.glyphs[k] !== 'string') fail(`${p}.glyphs.${k}`, 'must be a string');
    }
  });
  return cfg;
}

const CLASS_ZERO_MIN_SPAN = 4; // m: a structure needs a bbox side >= this to blank class cells (OB-101)
/**
 * Uint8 class grid of `classCellM` over the terrain's baked near band. 0 = none, else 1 + index of the first variant
 * whose `ground` has the cell's ground type name, whose `biomes` (if any) has `recipe.util.biomeAt(x, y)` and whose `areas` (if any)
 * contain the class-cell centre (D2f).
 * OB-096 (38.52 amendment a): with `structures` (placed, each with world `bbox` x0,y0,x1,y1) every class cell overlapping a bbox grown by
 * classJitterM + LEAN_CAP * maxH is zeroed: no blade is rooted in, under or leaning into a structure.
 * Deterministic (no Math.random). `out` (a previous result) is reused when the size matches, so a rebake allocates nothing big.
 * @returns {{classMap: Uint8Array, x0:number, y0:number, w:number, h:number, cellM:number}|null} null before `terrain.nearReady`
 */
export function buildCarpetClassMap(terrain, recipe, cfg, out, structures) {
  const j = new CarpetClassMapJob(terrain, recipe, cfg, out, structures);
  if (!j.res) return null;
  j.step(Infinity);
  return j.res;
}

const clsNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * PERF-05: buildCarpetClassMap as a row-sliced job (~14 ms in one call at a 640x384 m band, the biggest bake-ahead / swap-frame spike).
 * `res` is null when the near band is not baked (buildCarpetClassMap returns null then). `step(ms)` does >= 1 class row (or 64
 * structures) per call and returns true once `res` is final; the bytes equal the one-shot build by construction (same loops, in order).
 */
export class CarpetClassMapJob {
  constructor(terrain, recipe, cfg, out, structures) {
    const g = terrain && terrain.near;
    this.res = null; this.done = false;
    if (!g || !terrain.nearReady) return;
    const cellM = cfg.classCellM || CARPET_DEFAULTS.classCellM;
    const w = Math.floor(g.w * g.cell / cellM), h = Math.floor(g.h * g.cell / cellM);
    const res = out && out.classMap && out.classMap.length === w * h ? out : { classMap: new Uint8Array(w * h) };
    res.x0 = g.x0; res.y0 = g.y0; res.w = w; res.h = h; res.cellM = cellM;
    const vs = cfg.variants, names = terrain.typeNames;
    // Per baked type id: bitmask of variants whose ground list has it (resolved once, no per-cell string work).
    const nv = vs.length, typeMask = new Uint16Array(names.length);
    for (let t = 0; t < names.length; t++) for (let v = 0; v < nv; v++) if (vs[v].ground.indexOf(names[t]) >= 0) typeMask[t] |= 1 << v;
    Object.assign(this, { g, res, cfg, vs, nv, typeMask, structures: structures && structures.length ? structures : null,
      biomeAt: recipe && recipe.util && typeof recipe.util.biomeAt === 'function' ? recipe.util.biomeAt : null,
      needBiome: vs.some((v) => v.biomes), j: 0, k: 0, grow: 0 });
    this.res = res;
  }
  step(ms) {
    if (this.done) return true;
    if (!this.res) return false;
    const t0 = clsNow(), { g, res, vs, nv, typeMask, biomeAt, needBiome } = this, map = res.classMap, w = res.w, h = res.h, cellM = res.cellM;
    while (this.j < h) {
      const j = this.j++, y = g.y0 + (j + 0.5) * cellM;
      for (let i = 0; i < w; i++) {
        const x = g.x0 + (i + 0.5) * cellM;
        const ti = Math.floor((x - g.x0) / g.cell) + Math.floor((y - g.y0) / g.cell) * g.w;
        const m = typeMask[g.type[ti]];
        let id = 0;
        if (m) {
          const b = needBiome && biomeAt ? biomeAt(x, y) : -1;
          for (let v = 0; v < nv; v++) {
            if (!(m & (1 << v))) continue;
            const bs = vs[v].biomes;
            if (bs && (b < 0 || bs.indexOf(b) < 0)) continue;
            if (vs[v].areas && !inAreas(vs[v].areas, x, y)) continue;
            if (vs[v].patch && !inPatch(vs[v].patch, x, y)) continue; // GRASS-VARIETY-01
            id = v + 1; break;
          }
        }
        map[i + j * w] = id;
      }
      if (clsNow() - t0 >= ms) return false;
    }
    const ss = this.structures;
    if (ss) {
      if (this.k === 0) {
        let maxH = 0;
        for (const v of vs) { const m = v.heightM[1] * PATCH_MAX * (v.tuft && v.tuft.mul !== undefined ? v.tuft.mul : TUFT_DEFAULT_MUL); if (m > maxH) maxH = m; }
        const jit = this.cfg.classJitterM == null ? CARPET_DEFAULTS.classJitterM : this.cfg.classJitterM;
        this.grow = jit + LEAN_CAP_M * maxH;
      }
      const grow = this.grow;
      while (this.k < ss.length) {
        const s = ss[this.k++], b = s && s.bbox;
        if (!b || !(isNum(b.x0) && isNum(b.y0) && isNum(b.x1) && isNum(b.y1))) continue;
        // OB-101: small dressing (clumps, flowers, bushes, rocks; both spans < CLASS_ZERO_MIN_SPAN) is excluded by the 0.5 m density mask only: zeroing 2 m class cells grown
        // by ~1.1 m around hundreds of them wiped the whole meadow (class map 99.5 % empty, no blades in play).
        if (b.x1 - b.x0 < CLASS_ZERO_MIN_SPAN && b.y1 - b.y0 < CLASS_ZERO_MIN_SPAN) continue;
        // class cell i covers [x0 + i*cellM, x0 + (i+1)*cellM): overlap with the grown rect
        const i0 = Math.max(0, Math.floor((b.x0 - grow - res.x0) / cellM)), i1 = Math.min(w - 1, Math.floor((b.x1 + grow - res.x0) / cellM));
        const j0 = Math.max(0, Math.floor((b.y0 - grow - res.y0) / cellM)), j1 = Math.min(h - 1, Math.floor((b.y1 + grow - res.y0) / cellM));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) map[i + j * w] = 0;
        if ((this.k & 63) === 0 && clsNow() - t0 >= ms) return false;
      }
    }
    this.done = true;
    return true;
  }
}

// ---- MASK-b (38.52 amendment, OB-096 grass mask): near-band density mask. Derived render data, never serialized/hashed.
export const CARPET_MASK_CELL = 0.5;      // m per mask cell
export const CARPET_MASK_FEATHER = 0.75;  // m, stamp dilate + blur radius (floored to whole cells, min 1)

/** Stamp one world rect (metres) into `st` (255 = no grass) for every mask cell it touches, clipped to cell window [ci0,ci1)x[cj0,cj1). */
function stampRect(st, m, ci0, cj0, ci1, cj1, x0, y0, x1, y1) {
  let i0 = Math.floor((x0 - m.x0) / m.cellM), i1 = Math.floor((x1 - m.x0) / m.cellM);
  let j0 = Math.floor((y0 - m.y0) / m.cellM), j1 = Math.floor((y1 - m.y0) / m.cellM);
  if (i0 < ci0) i0 = ci0; if (j0 < cj0) j0 = cj0; if (i1 > ci1 - 1) i1 = ci1 - 1; if (j1 > cj1 - 1) j1 = cj1 - 1;
  if (i1 < i0) return;
  for (let j = j0; j <= j1; j++) st.fill(255, i0 + j * m.w, i1 + 1 + j * m.w);
}
/** Same for a disc: every cell whose square touches the disc. */
function stampDisc(st, m, ci0, cj0, ci1, cj1, cx, cy, r) {
  let i0 = Math.floor((cx - r - m.x0) / m.cellM), i1 = Math.floor((cx + r - m.x0) / m.cellM);
  let j0 = Math.floor((cy - r - m.y0) / m.cellM), j1 = Math.floor((cy + r - m.y0) / m.cellM);
  if (i0 < ci0) i0 = ci0; if (j0 < cj0) j0 = cj0; if (i1 > ci1 - 1) i1 = ci1 - 1; if (j1 > cj1 - 1) j1 = cj1 - 1;
  for (let j = j0; j <= j1; j++) {
    const ya = m.y0 + j * m.cellM, dy = cy < ya ? ya - cy : cy > ya + m.cellM ? cy - ya - m.cellM : 0;
    for (let i = i0; i <= i1; i++) {
      const xa = m.x0 + i * m.cellM, dx = cx < xa ? xa - cx : cx > xa + m.cellM ? cx - xa - m.cellM : 0;
      if (dx * dx + dy * dy <= r * r) st[i + j * m.w] = 255;
    }
  }
}

/** Paint input -> (x, y) => 0..1 or null. Accepts a GrassMaskLayer (MASK-a, via maskAt), a function or `{sample}` (escape hatches). */
function paintFn(paint) {
  if (!paint) return null;
  if (typeof paint === 'function') return paint;
  if (paint.chunks instanceof Map) return (x, y) => maskAt(paint, x, y);
  if (typeof paint.sample === 'function') return (x, y) => paint.sample(x, y);
  return null;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ST_CLEAR = 0, ST_STAMP = 1, ST_DIL_H = 2, ST_DIL_V = 3, ST_BLUR_H = 4, ST_BLUR_V = 5, ST_DONE = 6;
const ITEMS_PER_UNIT = 256, ROWS_PER_UNIT = 8;

/**
 * Resumable (row-sliced) mask build. `step(msBudget)` does work units (8 rows / 256 stamps) until the budget is spent;
 * returns true when finished (`job.result` is then complete). Stages: clear+cutGround, stamps, dilate H, dilate V, blur H, blur V + paint.
 * The sync `buildCarpetMask` runs the same job with an infinite budget, so sliced == sync bytes. 0 alloc per step.
 */
export class CarpetMaskJob {
  constructor(terrain, cfg, paint, structures, scatter, out, rect) {
    this.done = false; this.result = null; this.units = 0;
    const g = terrain && terrain.near;
    if (!g || !terrain.nearReady) { this.done = true; return; }
    this.terrain = terrain; this.pf = paintFn(paint); this.structures = structures; this.scatter = scatter; this.g = g;
    const cellM = CARPET_MASK_CELL;
    const w = Math.floor(g.w * g.cell / cellM), h = Math.floor(g.h * g.cell / cellM);
    const fresh = !(out && out.data && out.data.length === w * h && out._st);
    const res = fresh ? { data: new Uint8Array(w * h), _st: new Uint8Array(w * h), _tmp: new Uint8Array(w * h), _cut: null, _cutSrc: null } : out;
    const moved = res.x0 !== g.x0 || res.y0 !== g.y0;
    res.x0 = g.x0; res.y0 = g.y0; res.w = w; res.h = h; res.cellM = cellM;
    this.res = res; this.result = res;
    const R = this.R = Math.max(1, Math.floor(CARPET_MASK_FEATHER / cellM)), P = 2 * R;
    let oi0 = 0, oj0 = 0, oi1 = w, oj1 = h; // output cell window; working window = output + P pad
    if (rect && !fresh && !moved) {
      oi0 = Math.max(0, Math.floor((rect.x0 - g.x0) / cellM)); oj0 = Math.max(0, Math.floor((rect.y0 - g.y0) / cellM));
      oi1 = Math.min(w, Math.floor((rect.x1 - g.x0) / cellM) + 1); oj1 = Math.min(h, Math.floor((rect.y1 - g.y0) / cellM) + 1);
      if (oi1 <= oi0 || oj1 <= oj0) { this.done = true; return; }
    }
    this.oi0 = oi0; this.oj0 = oj0; this.oi1 = oi1; this.oj1 = oj1;
    this.wi0 = Math.max(0, oi0 - P); this.wj0 = Math.max(0, oj0 - P); this.wi1 = Math.min(w, oi1 + P); this.wj1 = Math.min(h, oj1 + P);
    if (cfg.cutGround && cfg.cutGround.length) {
      const names = terrain.typeNames;
      if (!res._cut || res._cut.length !== names.length || res._cutSrc !== cfg.cutGround) {
        res._cut = new Uint8Array(names.length); res._cutSrc = cfg.cutGround;
        for (let t = 0; t < names.length; t++) if (cfg.cutGround.indexOf(names[t]) >= 0) res._cut[t] = 1;
      }
      this.cut = res._cut;
    } else this.cut = null;
    this.stage = ST_CLEAR; this.row = this.wj0; this.item = 0;
  }

  /** Work for ~`msBudget` ms (Infinity = to the end). @returns {boolean} finished */
  step(msBudget) {
    if (this.done) return true;
    const t0 = msBudget === Infinity ? 0 : now();
    while (this.stage !== ST_DONE) {
      this._unit(); this.units++;
      if (this.stage !== ST_DONE && msBudget !== Infinity && now() - t0 >= msBudget) return false;
    }
    this.done = true;
    return true;
  }

  /** One work unit; advances stage/row. */
  _unit() {
    const { res, g, R, wi0, wj0, wi1, wj1, oi0, oj0, oi1, oj1 } = this;
    const w = res.w, cellM = res.cellM, st = res._st, tmp = res._tmp, data = res.data;
    switch (this.stage) {
      case ST_CLEAR: {
        const end = Math.min(wj1, this.row + ROWS_PER_UNIT);
        for (let j = this.row; j < end; j++) {
          st.fill(0, wi0 + j * w, wi1 + j * w);
          if (this.cut) {
            const row = Math.floor(((j + 0.5) * cellM) / g.cell) * g.w;
            for (let i = wi0; i < wi1; i++) if (this.cut[g.type[Math.floor(((i + 0.5) * cellM) / g.cell) + row]]) st[i + j * w] = 255;
          }
        }
        this.row = end;
        if (end >= wj1) { this.stage = ST_STAMP; this.item = 0; }
        break;
      }
      case ST_STAMP: {
        const wx0 = g.x0 + wi0 * cellM, wy0 = g.y0 + wj0 * cellM, wx1 = g.x0 + wi1 * cellM, wy1 = g.y0 + wj1 * cellM;
        const S = this.structures, nS = S ? S.length : 0, sc = this.scatter, nT = sc && sc.count > 0 ? sc.count : 0;
        if (this.item < nS) { // structures first, then trunks
          const end = Math.min(nS, this.item + ITEMS_PER_UNIT);
          for (let s = this.item; s < end; s++) {
            const b = S[s].bbox;
            if (!b || !(b.x1 >= wx0 && b.x0 <= wx1 && b.y1 >= wy0 && b.y0 <= wy1)) continue;
            stampRect(st, res, wi0, wj0, wi1, wj1, b.x0, b.y0, b.x1, b.y1);
          }
          this.item = end;
        } else if (this.item < nS + nT) {
          const k0 = this.item - nS, end = Math.min(nT, k0 + ITEMS_PER_UNIT);
          const tc = this.terrain.recipe && this.terrain.recipe.recipe && this.terrain.recipe.recipe.forest && this.terrain.recipe.recipe.forest.trees;
          const sp = tc && tc.species;
          for (let k = k0; k < end; k++) {
            const x = sc.x[k], y = sc.y[k], r = (sp && sp[sc.species[k]] ? sp[sc.species[k]].trunkR : 0.3) + 0.3;
            if (x + r < wx0 || x - r > wx1 || y + r < wy0 || y - r > wy1) continue;
            stampDisc(st, res, wi0, wj0, wi1, wj1, x, y, r);
          }
          this.item = nS + end;
        }
        if (this.item >= nS + nT) { this.stage = ST_DIL_H; this.row = wj0; }
        break;
      }
      case ST_DIL_H: { // dilate (max) by R: st -> tmp (H); reads clamp to the working window
        const end = Math.min(wj1, this.row + ROWS_PER_UNIT);
        for (let j = this.row; j < end; j++) for (let i = wi0; i < wi1; i++) {
          let m = 0; const a = Math.max(wi0, i - R), b = Math.min(wi1 - 1, i + R);
          for (let k = a; k <= b; k++) if (st[k + j * w] > m) m = st[k + j * w];
          tmp[i + j * w] = m;
        }
        this.row = end; if (end >= wj1) { this.stage = ST_DIL_V; this.row = wj0; }
        break;
      }
      case ST_DIL_V: { // tmp -> st (V)
        const end = Math.min(wj1, this.row + ROWS_PER_UNIT);
        for (let j = this.row; j < end; j++) for (let i = wi0; i < wi1; i++) {
          let m = 0; const a = Math.max(wj0, j - R), b = Math.min(wj1 - 1, j + R);
          for (let k = a; k <= b; k++) if (tmp[i + k * w] > m) m = tmp[i + k * w];
          st[i + j * w] = m;
        }
        this.row = end; if (end >= wj1) { this.stage = ST_BLUR_H; this.row = wj0; }
        break;
      }
      case ST_BLUR_H: { // box blur by R (n = 2R+1 taps; edge taps replicate the working-window edge): st -> tmp
        const n = 2 * R + 1, end = Math.min(wj1, this.row + ROWS_PER_UNIT);
        for (let j = this.row; j < end; j++) for (let i = wi0; i < wi1; i++) {
          let sum = 0;
          for (let k = i - R; k <= i + R; k++) sum += st[(k < wi0 ? wi0 : k >= wi1 ? wi1 - 1 : k) + j * w];
          tmp[i + j * w] = ((sum + (n >> 1)) / n) | 0;
        }
        this.row = end; if (end >= wj1) { this.stage = ST_BLUR_V; this.row = oj0; }
        break;
      }
      case ST_BLUR_V: { // V blur folded into the output, times the paint
        const n = 2 * R + 1, pf = this.pf, end = Math.min(oj1, this.row + ROWS_PER_UNIT);
        for (let j = this.row; j < end; j++) for (let i = oi0; i < oi1; i++) {
          let sum = 0;
          for (let k = j - R; k <= j + R; k++) sum += tmp[i + (k < wj0 ? wj0 : k >= wj1 ? wj1 - 1 : k) * w];
          const s = ((sum + (n >> 1)) / n) | 0;
          let p = 1;
          if (pf) { p = pf(g.x0 + (i + 0.5) * cellM, g.y0 + (j + 0.5) * cellM); p = p < 0 ? 0 : p > 1 ? 1 : p; }
          data[i + j * w] = Math.round(p * (255 - s));
        }
        this.row = end; if (end >= oj1) this.stage = ST_DONE;
        break;
      }
      default: this.stage = ST_DONE;
    }
  }
}

/**
 * Near-band density mask 0..255 (= 0..1) over the class-map window, cell `CARPET_MASK_CELL`:
 * `m = paint * (1 - stamp)`. Stamps (no grass): every structure bbox (buildings, meshes), tree trunk discs (trunkR + 0.3 m)
 * and near-band cells whose ground type is in `cfg.cutGround`; the stamp is dilated (max) then box-blurred by the feather
 * so a stamp core stays exactly 0 and only its outside edge ramps. `paint` = null (1 everywhere), a GrassMaskLayer (MASK-a),
 * `(x,y)=>0..1` or `{sample(x,y)->0..1}`.
 * `rect` ({x0,y0,x1,y1} metres) limits the work to that area (editor stroke end); omitted = whole window.
 * `out` (a previous result) is reused when the size matches: a repeat build allocates nothing. Synchronous; band swaps use `CarpetMaskJob`.
 * @returns {{data:Uint8Array,x0:number,y0:number,w:number,h:number,cellM:number}|null} null before `terrain.nearReady`
 */
export function buildCarpetMask(terrain, cfg, paint, structures, scatter, out, rect) {
  const job = new CarpetMaskJob(terrain, cfg, paint, structures, scatter, out, rect);
  if (!job.result) return null;
  job.step(Infinity);
  return job.result;
}
