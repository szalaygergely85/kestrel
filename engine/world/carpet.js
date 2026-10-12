// OB-073-D2a (arch 38.52 item 6): near-field grass carpet config check + class map. Derived render data:
// never serialized, never hashed, never read by the sim. Pure JS, no render code (D2b+ consume the map).
export const CARPET_MAX_VARIANTS = 15;
export const CARPET_DEFAULTS = { cellM: 0.10, radiusM: 12, patchM: 6, classCellM: 2, classJitterM: 0.8, gustM: 5, travelM: 1.5, bladeW: 0.06, swayGain: 1 };
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
  if (cfg.cutGround !== undefined && (!Array.isArray(cfg.cutGround) || cfg.cutGround.some((n) => typeof n !== 'string' || !typeNames || typeNames.indexOf(n) < 0))) fail('cutGround', 'must be an array of known ground type names');
  if (cfg.mask != null && typeof cfg.mask !== 'function' && typeof cfg.mask.sample !== 'function') fail('mask', 'must be null, a function (x, y) => 0..1 or an object with sample(x, y)');
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
          if (vs[v].areas && !inAreas(vs[v].areas, x, y)) continue;
          id = v + 1; break;
        }
      }
      map[i + j * w] = id;
    }
  }
  return res;
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

/**
 * Near-band density mask 0..255 (= 0..1) over the class-map window, cell `CARPET_MASK_CELL`:
 * `m = paint * (1 - stamp)`. Stamps (no grass): every structure bbox (buildings, meshes), tree trunk discs (trunkR + 0.3 m)
 * and near-band cells whose ground type is in `cfg.cutGround`; the stamp is dilated (max) then box-blurred by the feather
 * so a stamp core stays exactly 0 and only its outside edge ramps. `paint` = null (1 everywhere), `(x,y)=>0..1` or `{sample(x,y)->0..1}`.
 * `rect` ({x0,y0,x1,y1} metres) limits the work to that area (editor stroke end); omitted = whole window.
 * `out` (a previous result) is reused when the size matches: a repeat build allocates nothing.
 * @returns {{data:Uint8Array,x0:number,y0:number,w:number,h:number,cellM:number}|null} null before `terrain.nearReady`
 */
export function buildCarpetMask(terrain, cfg, paint, structures, scatter, out, rect) {
  const g = terrain && terrain.near;
  if (!g || !terrain.nearReady) return null;
  const cellM = CARPET_MASK_CELL;
  const w = Math.floor(g.w * g.cell / cellM), h = Math.floor(g.h * g.cell / cellM);
  const fresh = !(out && out.data && out.data.length === w * h && out._st);
  const res = fresh ? { data: new Uint8Array(w * h), _st: new Uint8Array(w * h), _tmp: new Uint8Array(w * h), _cut: null, _cutSrc: null } : out;
  const moved = res.x0 !== g.x0 || res.y0 !== g.y0;
  res.x0 = g.x0; res.y0 = g.y0; res.w = w; res.h = h; res.cellM = cellM;
  const R = Math.max(1, Math.floor(CARPET_MASK_FEATHER / cellM)), P = 2 * R;
  // output cell window [oi0,oi1)x[oj0,oj1); working window = output + P pad
  let oi0 = 0, oj0 = 0, oi1 = w, oj1 = h;
  if (rect && !fresh && !moved) {
    oi0 = Math.max(0, Math.floor((rect.x0 - g.x0) / cellM)); oj0 = Math.max(0, Math.floor((rect.y0 - g.y0) / cellM));
    oi1 = Math.min(w, Math.floor((rect.x1 - g.x0) / cellM) + 1); oj1 = Math.min(h, Math.floor((rect.y1 - g.y0) / cellM) + 1);
    if (oi1 <= oi0 || oj1 <= oj0) return res;
  }
  const wi0 = Math.max(0, oi0 - P), wj0 = Math.max(0, oj0 - P), wi1 = Math.min(w, oi1 + P), wj1 = Math.min(h, oj1 + P);
  const st = res._st, tmp = res._tmp, data = res.data;
  for (let j = wj0; j < wj1; j++) st.fill(0, wi0 + j * w, wi1 + j * w);
  // ground types in cfg.cutGround -> flag per baked type id
  if (cfg.cutGround && cfg.cutGround.length) {
    const names = terrain.typeNames;
    if (!res._cut || res._cut.length !== names.length || res._cutSrc !== cfg.cutGround) {
      res._cut = new Uint8Array(names.length); res._cutSrc = cfg.cutGround;
      for (let t = 0; t < names.length; t++) if (cfg.cutGround.indexOf(names[t]) >= 0) res._cut[t] = 1;
    }
    const cut = res._cut;
    for (let j = wj0; j < wj1; j++) {
      const row = Math.floor(((j + 0.5) * cellM) / g.cell) * g.w;
      for (let i = wi0; i < wi1; i++) {
        if (cut[g.type[Math.floor(((i + 0.5) * cellM) / g.cell) + row]]) st[i + j * w] = 255;
      }
    }
  }
  const wx0 = g.x0 + wi0 * cellM, wy0 = g.y0 + wj0 * cellM, wx1 = g.x0 + wi1 * cellM, wy1 = g.y0 + wj1 * cellM;
  if (structures) for (let s = 0; s < structures.length; s++) {
    const b = structures[s].bbox;
    if (!b || !(b.x1 >= wx0 && b.x0 <= wx1 && b.y1 >= wy0 && b.y0 <= wy1)) continue;
    stampRect(st, res, wi0, wj0, wi1, wj1, b.x0, b.y0, b.x1, b.y1);
  }
  if (scatter && scatter.count > 0) {
    const tc = terrain.recipe && terrain.recipe.recipe && terrain.recipe.recipe.forest && terrain.recipe.recipe.forest.trees;
    const sp = tc && tc.species;
    for (let k = 0; k < scatter.count; k++) {
      const x = scatter.x[k], y = scatter.y[k], r = (sp && sp[scatter.species[k]] ? sp[scatter.species[k]].trunkR : 0.3) + 0.3;
      if (x + r < wx0 || x - r > wx1 || y + r < wy0 || y - r > wy1) continue;
      stampDisc(st, res, wi0, wj0, wi1, wj1, x, y, r);
    }
  }
  // dilate (max) by R: st -> tmp (H), tmp -> st (V); reads clamp to the working window
  for (let j = wj0; j < wj1; j++) for (let i = wi0; i < wi1; i++) {
    let m = 0; const a = Math.max(wi0, i - R), b = Math.min(wi1 - 1, i + R);
    for (let k = a; k <= b; k++) if (st[k + j * w] > m) m = st[k + j * w];
    tmp[i + j * w] = m;
  }
  for (let j = wj0; j < wj1; j++) for (let i = wi0; i < wi1; i++) {
    let m = 0; const a = Math.max(wj0, j - R), b = Math.min(wj1 - 1, j + R);
    for (let k = a; k <= b; k++) if (tmp[i + k * w] > m) m = tmp[i + k * w];
    st[i + j * w] = m;
  }
  // box blur by R (n = 2R+1 taps; edge taps replicate the working-window edge); H pass st -> tmp, V pass folded into the output
  const n = 2 * R + 1;
  for (let j = wj0; j < wj1; j++) for (let i = wi0; i < wi1; i++) {
    let sum = 0;
    for (let k = i - R; k <= i + R; k++) sum += st[(k < wi0 ? wi0 : k >= wi1 ? wi1 - 1 : k) + j * w];
    tmp[i + j * w] = ((sum + (n >> 1)) / n) | 0;
  }
  const pf = typeof paint === 'function' ? paint : (paint && typeof paint.sample === 'function' ? (x, y) => paint.sample(x, y) : null), hasPaint = !!pf; // MASK-a plugs in as (x, y) => maskAt(layer, x, y)
  for (let j = oj0; j < oj1; j++) for (let i = oi0; i < oi1; i++) {
    let sum = 0;
    for (let k = j - R; k <= j + R; k++) sum += tmp[i + (k < wj0 ? wj0 : k >= wj1 ? wj1 - 1 : k) * w];
    const s = ((sum + (n >> 1)) / n) | 0;
    let p = 1;
    if (hasPaint) { p = pf(g.x0 + (i + 0.5) * cellM, g.y0 + (j + 0.5) * cellM); p = p < 0 ? 0 : p > 1 ? 1 : p; }
    data[i + j * w] = Math.round(p * (255 - s));
  }
  return res;
}
