// ENV-01a (architecture 38.62): JS twin / source of truth of the GPU decor scatter.
// DECOR_WGSL (ENV-01c) is built from the constants exported here. Integer-only
// decisions (Math.imul / >>> / i32), positions in integer cm; no trig, no
// Math.random, no wall clock, no f32 in any keep/species/LOD/fade/carpet decision.
// Stand-alone (imports nothing): the hash is the 38.52 hashFast family copied
// bit-for-bit (terrainShade.hashFastU) with the extra key `k` folded into `s`.

// ---- hash keys (k) --------------------------------------------------------
export const K_RANK = 0, K_JX = 1, K_JY = 2, K_SPECIES = 3, K_YAW = 4, K_SCALE = 5, K_FADE = 6;
export const KEY_MUL = 0x632be5ab; // folds k into the seed word

// ---- packed layout (Uint32Array `words`) ------------------------------------
// header: [W_MAGIC, nLayers]; then per layer a LAYER_WORDS header at layerOff(l):
export const DECOR_MAGIC = 0xdec0a001;
export const L_SEED = 0, L_CELL_CM = 1, L_JIT_CM = 2, L_DRAW_CM = 3, L_NSPECIES = 4, L_SPECIES_OFF = 5, L_DENSITY_Q8 = 6;
export const LAYER_WORDS = 8;
// per species SPECIES_WORDS: cum16 (cumulative weight, 0..65536, last = 65536),
// lodCm (>= this distance -> LOD1; >= maxCm means never), maxCm, flags,
// scaleMinMilli, scaleMaxMilli (scale = (min + (max-min)*q/255)/1000, q 8 bit).
export const S_CUM16 = 0, S_LOD_CM = 1, S_MAX_CM = 2, S_FLAGS = 3, S_SCALE_MIN = 4, S_SCALE_MAX = 5;
export const SPECIES_WORDS = 6;
export const SP_GRASS_LIKE = 1;
export const MASK_PROB_MASK = 127, MASK_CARPET_BIT = 128;
export const MAX_DIST_CM = 46000;     // d^2 stays exact in i32
export const FADE_Q8_MIN = 205;       // fade factor 0.8 .. 0.996 (205 + hash8*51>>8) / 256
export const FADE_Q8_SPAN = 51;
export const DEFAULT_DENSITY_Q8 = 256;

// ---- out / list layout --------------------------------------------------------
// `out` (Int32Array(DECOR_OUT_WORDS)) filled by decorCell when it returns 1|2:
export const O_SPECIES = 0, O_XCM = 1, O_YCM = 2, O_JQX = 3, O_JQY = 4, O_YAWQ = 5, O_SCALEQ = 6, O_DIST2 = 7;
export const DECOR_OUT_WORDS = 8;
// decorFrame lists: LIST_STRIDE ints per kept placement = out[O_XCM..] subset
export const LIST_STRIDE = 6; // xcm, ycm, yawQ, scaleQ, ix, iy

/** Integer hash (38.52 hashFast family keyed by ix, iy, seed, k). u32 result. */
export function decorHash(ix, iy, seed, k) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul((seed + Math.imul(k, KEY_MUL)) | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Jitter in [-jitCm, jitCm] (u32 math, no float). */
export function jitterCm(h, jitCm) {
  return (Math.imul(h >>> 16, 2 * jitCm + 1) >>> 16) - jitCm;
}

/**
 * cfg = { layers: [{ seed, cellM, jitterM, drawM, densityQ8?, species: [{ weight, lodM, maxDistM,
 *   grassLike?, scaleMin, scaleMax }] }] } -> { words, nLayers }.
 * Metres -> integer cm once, here. Throws on values that would break exactness.
 */
export function packDecorLayers(cfg) {
  const layers = cfg.layers, n = layers.length;
  let total = 2 + n * LAYER_WORDS;
  for (let i = 0; i < n; i++) total += layers[i].species.length * SPECIES_WORDS;
  const words = new Uint32Array(total);
  words[0] = DECOR_MAGIC; words[1] = n;
  let sOff = 2 + n * LAYER_WORDS;
  for (let l = 0; l < n; l++) {
    const L = layers[l], o = 2 + l * LAYER_WORDS, ns = L.species.length;
    const cell = Math.round(L.cellM * 100), jit = Math.round((L.jitterM || 0) * 100), draw = Math.round(L.drawM * 100);
    if (cell < 1 || jit < 0 || 2 * jit + 1 > 65535) throw new Error('decor layer ' + l + ': bad cell/jitter');
    if (draw < 1 || draw > MAX_DIST_CM) throw new Error('decor layer ' + l + ': drawM must be <= ' + MAX_DIST_CM / 100);
    if (ns < 1) throw new Error('decor layer ' + l + ': no species');
    words[o + L_SEED] = L.seed >>> 0; words[o + L_CELL_CM] = cell; words[o + L_JIT_CM] = jit; words[o + L_DRAW_CM] = draw;
    words[o + L_NSPECIES] = ns; words[o + L_SPECIES_OFF] = sOff; words[o + L_DENSITY_Q8] = L.densityQ8 != null ? L.densityQ8 : DEFAULT_DENSITY_Q8;
    let wsum = 0;
    for (let i = 0; i < ns; i++) wsum += L.species[i].weight;
    if (!(wsum > 0)) throw new Error('decor layer ' + l + ': weights sum to 0');
    let acc = 0;
    for (let i = 0; i < ns; i++) {
      const S = L.species[i], p = sOff + i * SPECIES_WORDS;
      acc += S.weight;
      words[p + S_CUM16] = i === ns - 1 ? 65536 : Math.round(acc / wsum * 65536);
      const mx = Math.round(S.maxDistM * 100), lod = Math.round(S.lodM * 100);
      if (mx < 1 || mx > MAX_DIST_CM) throw new Error('decor layer ' + l + ' species ' + i + ': maxDistM out of range');
      words[p + S_LOD_CM] = Math.min(lod, MAX_DIST_CM); words[p + S_MAX_CM] = mx;
      words[p + S_FLAGS] = S.grassLike ? SP_GRASS_LIKE : 0;
      words[p + S_SCALE_MIN] = Math.round(S.scaleMin * 1000); words[p + S_SCALE_MAX] = Math.round(S.scaleMax * 1000);
    }
    sOff += ns * SPECIES_WORDS;
  }
  return { words, nLayers: n };
}

export const layerOff = (layer) => 2 + layer * LAYER_WORDS;
/** Lattice side (cells) of the per-frame square around the eye, CPU-known. */
export function decorSide(packed, layer) {
  const w = packed.words, o = layerOff(layer);
  return 2 * Math.ceil(w[o + L_DRAW_CM] / w[o + L_CELL_CM]) + 1;
}
export const decorLayerCap = (packed, layer) => { const s = decorSide(packed, layer); return s * s; };

/** Species index for a 16-bit species rank (first cum16 > sp). */
export function decorSpecies(words, o, sp16) {
  const ns = words[o + L_NSPECIES], so = words[o + L_SPECIES_OFF];
  let i = 0;
  while (i < ns - 1 && sp16 >= words[so + i * SPECIES_WORDS + S_CUM16]) i++;
  return i;
}

/**
 * One lattice cell. maskByte: bits 0-6 keep prob, bit 7 carpet. fadeCm: Int32Array per species
 * (distance at which the species' footprint is gone, before the per-placement 0.8..1.0 factor).
 * carpetCutCm: (carpet.radiusM + 2) * 100, 0 = no carpet. Returns 0 none, 1 LOD0, 2 LOD1;
 * on 1|2 fills `out` (Int32Array(DECOR_OUT_WORDS)). Zero allocation.
 */
export function decorCell(packed, layer, ix, iy, maskByte, eyeXcm, eyeYcm, fadeCm, carpetCutCm, out) {
  const w = packed.words, o = 2 + layer * LAYER_WORDS;
  const prob = maskByte & MASK_PROB_MASK;
  if (prob === 0) return 0;
  const seed = w[o + L_SEED];
  // keep: effective prob (clamped 127) vs 16-bit rank, all u32/i32 integer math
  let eff = (prob * w[o + L_DENSITY_Q8]) >>> 8;
  if (eff > MASK_PROB_MASK) eff = MASK_PROB_MASK;
  if (Math.imul(decorHash(ix, iy, seed, K_RANK) >>> 16, 127) >= (eff << 16)) return 0;
  const cell = w[o + L_CELL_CM], jit = w[o + L_JIT_CM];
  const jqx = jitterCm(decorHash(ix, iy, seed, K_JX), jit), jqy = jitterCm(decorHash(ix, iy, seed, K_JY), jit);
  const xcm = Math.imul(ix, cell) + jqx, ycm = Math.imul(iy, cell) + jqy;
  const dx = xcm - eyeXcm, dy = ycm - eyeYcm;
  const d2 = (Math.imul(dx, dx) + Math.imul(dy, dy)) | 0;
  const draw = w[o + L_DRAW_CM];
  if (d2 >= Math.imul(draw, draw)) return 0;
  const sp = decorSpecies(w, o, decorHash(ix, iy, seed, K_SPECIES) >>> 16);
  const p = w[o + L_SPECIES_OFF] + sp * SPECIES_WORDS;
  const maxCm = w[p + S_MAX_CM];
  if (d2 >= Math.imul(maxCm, maxCm)) return 0;
  // footprint fade: one fixed distance per placement
  const fq = FADE_Q8_MIN + ((decorHash(ix, iy, seed, K_FADE) >>> 24) * FADE_Q8_SPAN >>> 8);
  let fadeLim = (fadeCm[sp] * fq) >>> 8;
  if (fadeLim > MAX_DIST_CM) fadeLim = MAX_DIST_CM; // keeps lim^2 exact in i32
  if (d2 >= Math.imul(fadeLim, fadeLim)) return 0;
  // carpet hand-off: grass-like species yield to the carpet inside radius + 2 m
  if ((maskByte & MASK_CARPET_BIT) !== 0 && (w[p + S_FLAGS] & SP_GRASS_LIKE) !== 0 && d2 < Math.imul(carpetCutCm, carpetCutCm)) return 0;
  out[O_SPECIES] = sp; out[O_XCM] = xcm; out[O_YCM] = ycm; out[O_JQX] = jqx; out[O_JQY] = jqy;
  out[O_YAWQ] = decorHash(ix, iy, seed, K_YAW) >>> 24; out[O_SCALEQ] = decorHash(ix, iy, seed, K_SCALE) >>> 24; out[O_DIST2] = d2;
  const lod = w[p + S_LOD_CM];
  return d2 >= Math.imul(lod, lod) ? 2 : 1;
}

/** Scale (float, not a decision) from the 8-bit step. */
export function decorScale(packed, layer, species, q) {
  const w = packed.words, p = w[layerOff(layer) + L_SPECIES_OFF] + species * SPECIES_WORDS;
  return (w[p + S_SCALE_MIN] + (w[p + S_SCALE_MAX] - w[p + S_SCALE_MIN]) * q / 255) / 1000;
}

/** Preallocate lists/counts for one layer: lists[(species*2+lod01)] slab of cap*LIST_STRIDE ints. */
export function makeDecorLists(packed, layer) {
  const ns = packed.words[layerOff(layer) + L_NSPECIES], cap = decorLayerCap(packed, layer);
  return { cap, lists: new Int32Array(ns * 2 * cap * LIST_STRIDE), counts: new Int32Array(ns * 2) };
}

/**
 * Whole per-frame square of one layer around the eye into preallocated lists (counts zeroed here).
 * mask = Uint8Array w*h over lattice cells ix0.., iy0..; cells outside the mask are skipped.
 * Returns total kept. Zero allocation.
 */
export function decorFrame(packed, layer, mask, ix0, iy0, mw, mh, eyeXcm, eyeYcm, fadeCm, carpetCutCm, buf, out) {
  const w = packed.words, o = 2 + layer * LAYER_WORDS, cell = w[o + L_CELL_CM];
  const half = (decorSide(packed, layer) - 1) >> 1;
  const cx = Math.floor(eyeXcm / cell), cy = Math.floor(eyeYcm / cell);
  const counts = buf.counts, lists = buf.lists, cap = buf.cap;
  counts.fill(0);
  let total = 0;
  for (let iy = cy - half; iy <= cy + half; iy++) {
    const my = iy - iy0;
    if (my < 0 || my >= mh) continue;
    for (let ix = cx - half; ix <= cx + half; ix++) {
      const mx = ix - ix0;
      if (mx < 0 || mx >= mw) continue;
      const r = decorCell(packed, layer, ix, iy, mask[my * mw + mx], eyeXcm, eyeYcm, fadeCm, carpetCutCm, out);
      if (r === 0) continue;
      const slot = out[O_SPECIES] * 2 + (r - 1), n = counts[slot]++;
      let b = (slot * cap + n) * LIST_STRIDE;
      lists[b++] = out[O_XCM]; lists[b++] = out[O_YCM]; lists[b++] = out[O_YAWQ]; lists[b++] = out[O_SCALEQ]; lists[b++] = ix; lists[b] = iy;
      total++;
    }
  }
  return total;
}
