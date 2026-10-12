// OB-073-D2a (arch 38.52 item 6): near-field grass carpet config check + class map. Derived render data:
// never serialized, never hashed, never read by the sim. Pure JS, no render code (D2b+ consume the map).
export const CARPET_MAX_VARIANTS = 15;
export const CARPET_DEFAULTS = { cellM: 0.10, radiusM: 12, patchM: 6, classCellM: 2, classJitterM: 0.8, gustM: 5, travelM: 1.5 };

const fail = (key, msg) => { throw new Error(`carpet.${key}: ${msg}`); };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Throws an Error naming the offending key (e.g. `carpet.variants[2].heightM`). Returns cfg. */
export function validateCarpetConfig(cfg, typeNames) {
  if (!cfg || typeof cfg !== 'object') fail('', 'config must be an object');
  if (!isNum(cfg.seed)) fail('seed', 'must be a finite number');
  for (const k of Object.keys(CARPET_DEFAULTS)) {
    if (cfg[k] !== undefined && !(isNum(cfg[k]) && cfg[k] > 0)) fail(k, 'must be a number > 0');
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
    if (v.glyphs !== undefined) {
      if (!v.glyphs || typeof v.glyphs !== 'object') fail(`${p}.glyphs`, 'must be an object');
      for (const k of ['base', 'mid', 'tip', 'leanL', 'leanR']) if (v.glyphs[k] !== undefined && typeof v.glyphs[k] !== 'string') fail(`${p}.glyphs.${k}`, 'must be a string');
    }
  });
  return cfg;
}

/**
 * Uint8 class grid of `classCellM` over the terrain's baked near band. 0 = none, else 1 + index of the first variant
 * whose `ground` has the cell's ground type name and whose `biomes` (if any) has `recipe.util.biomeAt(x, y)`.
 * Deterministic (no Math.random). `out` (a previous result) is reused when the size matches, so a rebake allocates nothing big.
 * @returns {{classMap: Uint8Array, x0:number, y0:number, w:number, h:number, cellM:number}|null} null before `terrain.nearReady`
 */
export function buildCarpetClassMap(terrain, recipe, cfg, out) {
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
          id = v + 1; break;
        }
      }
      map[i + j * w] = id;
    }
  }
  return res;
}
