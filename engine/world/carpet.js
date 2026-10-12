// OB-073-D2a (arch 38.52 item 6): near-field grass carpet config check + class map. Derived render data:
// never serialized, never hashed, never read by the sim. Pure JS, no render code (D2b+ consume the map).
export const CARPET_MAX_VARIANTS = 15;
export const CARPET_DEFAULTS = { cellM: 0.10, radiusM: 12, patchM: 6, classCellM: 2, classJitterM: 0.8, gustM: 5, travelM: 1.5, bladeW: 0.06, swayGain: 1 };
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
  const g = terrain && terrain.near;
  if (!g || !terrain.nearReady) return null;
  const cellM = cfg.classCellM || CARPET_DEFAULTS.classCellM;
  const w = Math.floor(g.w * g.cell / cellM), h = Math.floor(g.h * g.cell / cellM);
  const res = out && out.classMap && out.classMap.length === w * h ? out : { classMap: new Uint8Array(w * h) };
  res.x0 = g.x0; res.y0 = g.y0; res.w = w; res.h = h; res.cellM = cellM;
  const map = res.classMap, vs = cfg.variants, names = terrain.typeNames;
  const biomeAt = recipe && recipe.util && typeof recipe.util.biomeAt === 'function' ? recipe.util.biomeAt : null;
  // Per baked type id: bitmask of variants whose ground list has it (resolved once, no per-cell string work).
  const nv = vs.length, typeMask = new Uint16Array(names.length);
  for (let t = 0; t < names.length; t++) for (let v = 0; v < nv; v++) if (vs[v].ground.indexOf(names[t]) >= 0) typeMask[t] |= 1 << v;
  const needBiome = vs.some((v) => v.biomes);
  for (let j = 0; j < h; j++) {
    const y = g.y0 + (j + 0.5) * cellM;
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
          id = v + 1; break;
        }
      }
      map[i + j * w] = id;
    }
  }
  if (structures && structures.length) {
    let maxH = 0;
    for (const v of vs) { const m = v.heightM[1] * PATCH_MAX * (v.tuft && v.tuft.mul !== undefined ? v.tuft.mul : TUFT_DEFAULT_MUL); if (m > maxH) maxH = m; }
    const jit = cfg.classJitterM == null ? CARPET_DEFAULTS.classJitterM : cfg.classJitterM, grow = jit + LEAN_CAP_M * maxH;
    for (const s of structures) {
      const b = s && s.bbox;
      if (!b || !(isNum(b.x0) && isNum(b.y0) && isNum(b.x1) && isNum(b.y1))) continue;
      // class cell i covers [x0 + i*cellM, x0 + (i+1)*cellM): overlap with the grown rect
      const i0 = Math.max(0, Math.floor((b.x0 - grow - res.x0) / cellM)), i1 = Math.min(w - 1, Math.floor((b.x1 + grow - res.x0) / cellM));
      const j0 = Math.max(0, Math.floor((b.y0 - grow - res.y0) / cellM)), j1 = Math.min(h - 1, Math.floor((b.y1 + grow - res.y0) / cellM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) map[i + j * w] = 0;
    }
  }
  return res;
}
