// @ts-check
// engine/render/waterFinish.js - WATER-FINISH-01a (docs/architecture.md 38.77): screen-space reflection of the far bank + shallow
// caustic flicker for the water composite. JS twin; the WGSL text at the bottom is informative for 01b (it owns bindings + the
// compileFn parity probe), same style as contactAO.js. All keys default to 0 -> every existing output is byte-identical.
// The keys live in their own 8-float row per water slot (NOT in the WL_STRIDE row, so the GPU uniform layout is untouched):
//   0 causticK (0..1 hit probability, 0 = off) | 1 causticDepth (m) | 2..4 causticRGB | 5 causticGlyph code (ASCII-32)
//   6 reflScreenK (0..1 share of the screen reflection, 0 = off) | 7 reflDim (0..1 multiplier on the mirrored shaded bg)
import { hashFastU } from './terrainShade.js';
/** Slot count of the JS-twin water table (== waterLook.js WF_SLOTS; literal here to avoid an import cycle). */
export const WF_SLOTS = 14;

/** First river-ribbon slot (== water.js WATER_RIVER_SLOT0; literal here to avoid an import cycle). */
const RIVER_SLOT0 = 12;
export const WF_STRIDE = 8;
export const WF_CAUSTIC_K = 0, WF_CAUSTIC_DEPTH = 1, WF_CAUSTIC_R = 2, WF_CAUSTIC_GLYPH = 5, WF_REFL_K = 6, WF_REFL_DIM = 7;
/** Reflected cell must lie this far (m) behind the water point, else the sky reflection stays (38.77 A). */
export const REFL_MIN_BEHIND = 1;
/** Caustic hash cell size (m) and flicker rate (Hz): shared with SWIM-04 `underwater.js` (hashFastU(floor(P/0.7), floor(t*3))). */
export const CAUSTIC_CELL = 0.7, CAUSTIC_HZ = 3;

export const DEFAULT_WATER_FINISH = Object.freeze({
  causticK: 0, causticDepth: 0.8, causticRGB: [180, 230, 255], causticGlyph: '~', reflScreenK: 0, reflDim: 0.8,
});

function bad(name, msg) { throw new Error(`waterFinish "${name}": ${msg}`); }

/** Validates + packs the finish keys of a look (load time, allocates). @param {string} name @param {any} look @returns {Float32Array} */
export function packWaterFinish(name, look) {
  const L = { ...DEFAULT_WATER_FINISH, ...(look || {}) };
  if (!(L.causticK >= 0 && L.causticK <= 1)) bad(name, '"causticK" must be 0..1');
  if (!(L.causticDepth > 0 && L.causticDepth < Infinity)) bad(name, '"causticDepth" must be finite and > 0');
  if (!Array.isArray(L.causticRGB) || L.causticRGB.length !== 3 || L.causticRGB.some((c) => typeof c !== 'number' || !(c >= 0 && c <= 255))) bad(name, '"causticRGB" must be [r,g,b] in 0..255');
  if (typeof L.causticGlyph !== 'string' || L.causticGlyph.length !== 1 || L.causticGlyph.charCodeAt(0) < 33 || L.causticGlyph.charCodeAt(0) > 126) bad(name, '"causticGlyph" must be one printable ASCII glyph (no space)');
  if (!(L.reflScreenK >= 0 && L.reflScreenK <= 1)) bad(name, '"reflScreenK" must be 0..1');
  if (!(L.reflDim >= 0 && L.reflDim <= 1)) bad(name, '"reflDim" must be 0..1');
  const r = new Float32Array(WF_STRIDE);
  r[0] = L.causticK; r[1] = L.causticDepth; r[2] = L.causticRGB[0]; r[3] = L.causticRGB[1]; r[4] = L.causticRGB[2];
  r[5] = L.causticGlyph.charCodeAt(0) - 32; r[6] = L.reflScreenK; r[7] = L.reflDim;
  return r;
}

/** Copies each selected slot's finish row into `out` (WF_SLOTS * WF_STRIDE floats, zeroed first; river/sheet slots stay 0). Zero alloc. */
export function fillWaterFinishTable(sel, world, looks, out) {
  out.fill(0);
  const byName = looks && looks.finishByName;
  if (!byName) return out;
  const wt = world.water, fb = looks.finishFallback;
  const n = sel.count < WF_SLOTS ? sel.count : WF_SLOTS;
  for (let s = 0; s < n; s++) {
    const ri = sel.region[s];
    out.set(byName.get(wt.lookNames[wt.look[ri]]) || fb, s * WF_STRIDE);
  }
  const rc = sel.riverCount || 0; // WATER-FINISH-01b: river ribbons (slots 12..13, waterLook.js RIVER_SLOT0) take their look's finish row too (ford shallows)
  for (let k = 0; k < rc && RIVER_SLOT0 + k < WF_SLOTS; k++) {
    const s = RIVER_SLOT0 + k, ri = sel.region[s];
    out.set(byName.get(wt.lookNames[wt.look[ri]]) || fb, s * WF_STRIDE);
  }
  return out;
}

/** Caustic flicker hit at the bed point (px, py) at time t (s): deterministic per (cell, 1/3 s tick). Same hash as SWIM-04. */
export function causticHit(px, py, t, k) {
  const h = hashFastU(Math.floor(px / CAUSTIC_CELL), Math.floor(py / CAUSTIC_CELL), Math.floor(t * CAUSTIC_HZ));
  return (h >>> 8) * (1 / 16777216) > 1 - k;
}

/**
 * Mirrored row of a shear-projection water point: exact for distant objects (38.77 A). Integer row (rounded).
 * @param {number} horizonRow @param {number} row
 */
export function shearMirrorRow(horizonRow, row) { return Math.floor(2 * horizonRow - row + 0.5); }

/**
 * Accept test for the mirror cell (38.77 A): on screen, not water, not sky (sky keeps today's sky reflection), and more than
 * REFL_MIN_BEHIND behind the water point.
 * @param {number} rowM @param {number} rows @param {number} waterKindM wt.kind at the mirror cell @param {number} gKindM gbuf.kind at the mirror cell
 * @param {number} depthM raw depth at the mirror cell @param {number} dW
 */
export function reflAccept(rowM, rows, waterKindM, gKindM, depthM, dW) {
  return rowM >= 0 && rowM < rows && waterKindM !== 1 && gKindM !== 0 && depthM > dW + REFL_MIN_BEHIND;
}

/** Pitched mirror cell of a water point (38.77 A; twin of waterComposite.js mirrorPitched = projectDirPitched with the mirrored dz). Scalars only. */
export function pitchedMirrorCol(dx, dy, dz, vd, rX, rY, tanHalfX, cols) {
  const vx = dx * rX + dy * rY;
  return Math.floor((vx / vd / tanHalfX + 1) * (cols / 2) - 0.5 + 0.5);
}
export function pitchedMirrorRow(dx, dy, dz, vd, uX, uY, uZ, tanHalfY, rows) {
  const vy = dx * uX + dy * uY + dz * uZ;
  return Math.floor((1 - vy / vd / tanHalfY) * (rows / 2) + 0.5);
}

// WGSL twin (WATER-FINISH-01b): interpolated into waterComposite.wgsl.js (needs hashFastU from HASH_FAST_WGSL in scope); parity-probed
// against the JS fns above in engine/render/gpu/wgsl/waterFinish.wgsl.test.js. Scalars only so compileFn can run them.
export const WATER_FINISH_WGSL = /* wgsl */`
fn shearMirrorRow(horizonRow: f32, row: i32) -> i32 { return i32(floor(2.0 * horizonRow - f32(row) + 0.5)); }
fn pitchedMirrorCol(dx: f32, dy: f32, dz: f32, vd: f32, rX: f32, rY: f32, tanHalfX: f32, cols: i32) -> i32 {
  let vx = dx * rX + dy * rY;
  return i32(floor((vx / vd / tanHalfX + 1.0) * (f32(cols) / 2.0) - 0.5 + 0.5));
}
fn pitchedMirrorRow(dx: f32, dy: f32, dz: f32, vd: f32, uX: f32, uY: f32, uZ: f32, tanHalfY: f32, rows: i32) -> i32 {
  let vy = dx * uX + dy * uY + dz * uZ;
  return i32(floor((1.0 - vy / vd / tanHalfY) * (f32(rows) / 2.0) + 0.5));
}
fn reflAccept(rowM: i32, rows: i32, waterKindM: u32, gKindM: u32, depthM: f32, dW: f32) -> bool {
  return rowM >= 0 && rowM < rows && waterKindM != 1u && gKindM != 0u && depthM > dW + ${REFL_MIN_BEHIND}.0;
}
fn causticHit(px: f32, py: f32, t: f32, k: f32) -> bool {
  let h = hashFastU(i32(floor(px / ${CAUSTIC_CELL})), i32(floor(py / ${CAUSTIC_CELL})), i32(floor(t * ${CAUSTIC_HZ}.0)));
  return f32(h >> 8u) * (1.0 / 16777216.0) > 1.0 - k;
}`;
