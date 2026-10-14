// POST-STACK-01a (docs/architecture.md 38.73): data-driven per-cell finish chain, JS twin. Pure numbers, no design/ import.
// Order per cell (fixed): mist -> grade (biome grade composed with the preset grade into ONE set) -> vignette. fg and bg, glyph never changes.
// The grade stage IS gradeCells (atmos.js) fed with the composed values, so identity post + atmos is bit-equal to gradeCells alone.
// Colours in cfg/state (mist.rgb, vignette.rgb) are 0..1. POST_WGSL (01b) is the GPU twin of the same chain (needs ATMOS_GRADE_WGSL spliced before it).
import { ATMOS_LUMA, ATMOS_GRADE_WGSL } from './atmos.js';

/** @typedef {{ bloom: null|{radius:number,gain:number,haloBg:number,haloMin:number},
 *   grade: null|{lift:ArrayLike<number>,gamma:ArrayLike<number>,gain:ArrayLike<number>,sat:number},
 *   vignette: null|{k:number,r0:number,r1:number,rgb:ArrayLike<number>},
 *   mist: null|{rgb:ArrayLike<number>,density:number,start:number,heightK:number} }} PostConfig */

const KEYS = ['bloom', 'grade', 'vignette', 'mist'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
function need(ok, msg) { if (!ok) throw new Error('validatePost: ' + msg); }
function vec3(v, name, lo, hi) {
  need(v && v.length === 3, name + ' must have 3 numbers');
  for (let i = 0; i < 3; i++) need(fin(v[i]) && v[i] >= lo && v[i] <= hi, `${name}[${i}] must be a number in ${lo}..${hi}`);
}

/** Throws (Error 'validatePost: <field> ...') on the first bad field; returns cfg. null/undefined = no post. */
export function validatePost(cfg) {
  if (cfg == null) return cfg;
  need(typeof cfg === 'object', 'config must be an object');
  for (const k of Object.keys(cfg)) need(KEYS.includes(k), 'unknown key ' + k);
  const { bloom, grade, vignette, mist } = cfg;
  if (bloom) for (const k of ['radius', 'gain', 'haloBg', 'haloMin']) need(fin(bloom[k]) && bloom[k] >= 0, 'bloom.' + k + ' must be a number >= 0');
  if (grade) {
    vec3(grade.lift, 'grade.lift', -1, 1);
    vec3(grade.gamma, 'grade.gamma', 1e-3, 10); // > 0
    vec3(grade.gain, 'grade.gain', 0, 10);
    need(fin(grade.sat) && grade.sat >= 0 && grade.sat <= 2, 'grade.sat must be 0..2');
  }
  if (vignette) {
    need(fin(vignette.k) && vignette.k >= 0 && vignette.k <= 0.6, 'vignette.k must be 0..0.6');
    need(fin(vignette.r0) && fin(vignette.r1) && vignette.r0 >= 0 && vignette.r0 < vignette.r1, 'vignette needs 0 <= r0 < r1');
    vec3(vignette.rgb, 'vignette.rgb', 0, 1);
  }
  if (mist) {
    vec3(mist.rgb, 'mist.rgb', 0, 1);
    need(fin(mist.density) && mist.density >= 0 && mist.density <= 0.2, 'mist.density must be 0..0.2');
    need(fin(mist.start) && mist.start >= 0, 'mist.start must be >= 0');
    need(fin(mist.heightK) && mist.heightK >= 0, 'mist.heightK must be >= 0');
  }
  return cfg;
}

/** Preallocated state. `on`/`gradeId`/`gradeStamp`/`_lut*` make it a valid gradeCells state (grade stage reuses that function). */
export function createPostState() {
  return {
    version: 0,
    gradeOn: false, on: false, gradeId: true, gradeStamp: 0, _lut: null, _lutStamp: -1,
    lift: new Float32Array(3), invGamma: new Float32Array([1, 1, 1]), gain: new Float32Array([1, 1, 1]), sat: 1,
    vig: new Float32Array(4), vigRGB: new Float32Array(3),   // vig = (k, r0, r1, on)
    mist: new Float32Array(4), mistRGB: new Float32Array(3), // mist = (density, start, heightK, on)
    _vigTab: null, _vigKey: null,
  };
}

/**
 * Compose the biome grade (atmosState or null/off) with cfg.grade into out; fill vignette + mist words. 0 alloc.
 * lift = a.lift + p.lift; gain = a.gain * p.gain; invGamma = a.invGamma / p.gamma; sat = a.sat * p.sat.
 * Identity post grade -> exactly the atmos values; atmos off -> the post grade alone. Call on an atmos version / config change only.
 */
export function composePost(atmos, cfg, out) {
  const a = atmos && atmos.on && !atmos.gradeId ? atmos : null, p = cfg && cfg.grade;
  let id = true, ch = false;
  for (let i = 0; i < 3; i++) {
    const l = (a ? a.lift[i] : 0) + (p ? p.lift[i] : 0);
    const g = (a ? a.gain[i] : 1) * (p ? p.gain[i] : 1);
    const ig = (a ? a.invGamma[i] : 1) / (p ? p.gamma[i] : 1);
    if (l !== 0 || g !== 1 || ig !== 1) id = false;
    if (out.lift[i] !== l || out.gain[i] !== g || out.invGamma[i] !== ig) ch = true;
    out.lift[i] = l; out.gain[i] = g; out.invGamma[i] = ig;
  }
  const sat = (a ? a.sat : 1) * (p ? p.sat : 1);
  if (sat !== 1) id = false;
  if (out.sat !== sat || out.gradeId !== id) ch = true;
  out.sat = sat; out.gradeId = id; out.gradeOn = out.on = !id;
  if (ch) out.gradeStamp++;
  const v = cfg && cfg.vignette;
  if (v && v.k > 0) { out.vig[0] = v.k; out.vig[1] = v.r0; out.vig[2] = v.r1; out.vig[3] = 1; out.vigRGB[0] = v.rgb[0]; out.vigRGB[1] = v.rgb[1]; out.vigRGB[2] = v.rgb[2]; }
  else out.vig.fill(0);
  const m = cfg && cfg.mist;
  if (m && m.density > 0) { out.mist[0] = m.density; out.mist[1] = m.start; out.mist[2] = m.heightK; out.mist[3] = 1; out.mistRGB[0] = m.rgb[0]; out.mistRGB[1] = m.rgb[1]; out.mistRGB[2] = m.rgb[2]; }
  else out.mist.fill(0);
  out.version++;
  return out;
}

const b8 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);

/**
 * JS twin of the per-cell chain on a real RenderTarget (fg/bg in rt.cells) or a bare CellBuffer. Replaces the gradeCells call site.
 * depthF32: per-cell scene depth (cols*rows, world units) for mist, or null (mist skipped); zF32: optional per-cell world height for heightK.
 * ONE fused pass (mist -> grade -> vignette per cell); stage results are truncated to bytes between stages exactly like the old
 * three-pass version, so output is bit-identical to it (post.test keeps that reference). Grade LUT shared with gradeCells (state._lut);
 * vignette factors are a per-cell Float64 table rebuilt on resize / vignette change only. Nothing active -> untouched. 0 alloc per frame.
 */
export function postCells(rt, depthF32, state, zF32 = null) {
  const cb = rt.cells || rt;
  const doMist = state.mist[3] > 0 && !!depthF32, doGrade = state.gradeOn && !state.gradeId, doVig = state.vig[3] > 0;
  if (!doMist && !doGrade && !doVig) return;
  const fg = cb.fg, bg = cb.bg;
  const nCells = fg.length >> 2;
  let lut = null, sat = 1, la = 0, lb = 0, ld = 0;
  if (doGrade) { lut = gradeLut(state); sat = state.sat; la = ATMOS_LUMA[0]; lb = ATMOS_LUMA[1]; ld = ATMOS_LUMA[2]; }
  const vf = doVig ? vigTable(rt, cb, state) : null;
  const dens = state.mist[0], start = state.mist[1], hk = state.mist[2], useZ = hk > 0 && !!zF32;
  const mr = state.mistRGB[0] * 255, mg = state.mistRGB[1] * 255, mb = state.mistRGB[2] * 255;
  const vr = state.vigRGB[0] * 255, vg = state.vigRGB[1] * 255, vb = state.vigRGB[2] * 255;
  let lastE = -1, lastF = 0; // depth runs (sky, flat floors) repeat: reuse f when e is unchanged
  // grade memo: last input colour -> last output (runs of equal cells are common; exact, it is the same function of the same input)
  let gfi = -1, gfo = 0, gbi = -1, gbo = 0;
  const nMist = doMist ? Math.min(depthF32.length, nCells) : 0;
  for (let c = 0; c < nCells; c++) {
    const o = c << 2;
    let fr = fg[o], fgg = fg[o + 1], fb = fg[o + 2], br = bg[o], bgg = bg[o + 1], bb = bg[o + 2];
    if (c < nMist) {
      const e = depthF32[c] - start;
      if (e > 0) { // d <= start (or NaN): no mist
        let f;
        if (e === lastE && !useZ) f = lastF;
        else { f = 1 - Math.exp(-dens * e); lastE = e; lastF = f; if (useZ) { f *= Math.exp(-hk * zF32[c]); lastE = -1; } }
        if (f > 0) {
          fr = b8(fr + (mr - fr) * f + 0.5) | 0; fgg = b8(fgg + (mg - fgg) * f + 0.5) | 0; fb = b8(fb + (mb - fb) * f + 0.5) | 0;
          br = b8(br + (mr - br) * f + 0.5) | 0; bgg = b8(bgg + (mg - bgg) * f + 0.5) | 0; bb = b8(bb + (mb - bb) * f + 0.5) | 0;
        }
      }
    }
    if (doGrade) {
      const ki = fr | (fgg << 8) | (fb << 16);
      if (ki === gfi) { fr = gfo & 255; fgg = (gfo >> 8) & 255; fb = gfo >>> 16; }
      else {
        gfi = ki;
        const r = lut[fr], g = lut[256 + fgg], b = lut[512 + fb], y = la * r + lb * g + ld * b;
        let q = (y + (r - y) * sat) * 255 + 0.5; fr = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        q = (y + (g - y) * sat) * 255 + 0.5; fgg = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        q = (y + (b - y) * sat) * 255 + 0.5; fb = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        gfo = fr | (fgg << 8) | (fb << 16);
      }
      const kb = br | (bgg << 8) | (bb << 16);
      if (kb === gbi) { br = gbo & 255; bgg = (gbo >> 8) & 255; bb = gbo >>> 16; }
      else {
        gbi = kb;
        const r = lut[br], g = lut[256 + bgg], b = lut[512 + bb], y = la * r + lb * g + ld * b;
        let q = (y + (r - y) * sat) * 255 + 0.5; br = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        q = (y + (g - y) * sat) * 255 + 0.5; bgg = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        q = (y + (b - y) * sat) * 255 + 0.5; bb = (q < 0 ? 0 : q > 255 ? 255 : q) | 0;
        gbo = br | (bgg << 8) | (bb << 16);
      }
    }
    if (doVig) {
      const f = vf[c];
      if (f > 0) {
        fr = b8(fr + (vr - fr) * f + 0.5); fgg = b8(fgg + (vg - fgg) * f + 0.5); fb = b8(fb + (vb - fb) * f + 0.5);
        br = b8(br + (vr - br) * f + 0.5); bgg = b8(bgg + (vg - bgg) * f + 0.5); bb = b8(bb + (vb - bb) * f + 0.5);
      }
    }
    fg[o] = fr; fg[o + 1] = fgg; fg[o + 2] = fb; bg[o] = br; bg[o + 1] = bgg; bg[o + 2] = bb;
  }
}

// Grade LUT = gradeCells' (same state._lut / _lutStamp), built only when the composed grade changed.
function gradeLut(state) {
  let lut = state._lut;
  if (!lut) lut = state._lut = new Float32Array(768);
  if (state._lutStamp !== state.gradeStamp) {
    state._lutStamp = state.gradeStamp;
    for (let c = 0; c < 3; c++) {
      const l = state.lift[c], g = state.gain[c], ig = state.invGamma[c];
      for (let i = 0; i < 256; i++) { const x = i / 255, v = g * (x + l * (1 - x)); lut[c * 256 + i] = Math.pow(v > 0 ? v : 0, ig); }
    }
  }
  return lut;
}

// Per-cell vignette factor k * smoothstep(r0, r1, r), r = aspect-corrected radius, 1 at the corners:
// |(x * aspect, y)| / |(aspect, 1)|, x,y in -1..1; aspect = displayed picture ratio. Float64 (not 32) to stay bit-identical.
// Rebuilt only when cols/rows/aspect/k/r0/r1 change; ny^2 and nx^2 are per-row / per-column, one sqrt per cell at build time only.
function vigTable(rt, cb, s) {
  const cols = cb.cols, rows = cb.rows;
  const aspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const k = s.vig[0], r0 = s.vig[1], r1 = s.vig[2];
  const key = s._vigKey || (s._vigKey = new Float64Array(6));
  let tab = s._vigTab;
  if (tab && tab.length === cols * rows && key[0] === cols && key[1] === rows && key[2] === aspect && key[3] === k && key[4] === r0 && key[5] === r1) return tab;
  if (!tab || tab.length !== cols * rows) tab = s._vigTab = new Float64Array(cols * rows);
  key[0] = cols; key[1] = rows; key[2] = aspect; key[3] = k; key[4] = r0; key[5] = r1;
  const inv = 1 / Math.sqrt(aspect * aspect + 1), ir = 1 / (r1 - r0);
  for (let y = 0; y < rows; y++) {
    const ny = ((y + 0.5) / rows) * 2 - 1;
    for (let x = 0; x < cols; x++) {
      const nx = (((x + 0.5) / cols) * 2 - 1) * aspect;
      let t = (Math.sqrt(nx * nx + ny * ny) * inv - r0) * ir;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      tab[y * cols + x] = k * t * t * (3 - 2 * t);
    }
  }
  return tab;
}

/**
 * POST-STACK-01b: WGSL twin of the per-cell chain for ONE colour (0..1), spliced into the sprites shader AFTER ATMOS_GRADE_WGSL.
 * Scalar helpers + a vec3 wrapper (probe-able by wgslProbe compileFn). Like postCells every stage result is rounded to a byte
 * (postQ8) so the GPU matches the twin to float noise: input q8 -> mist -> q8 -> grade (composed set, atmosGrade) -> q8 -> vignette -> q8.
 * postMistF: 1 - exp(-density * max(0, d - start)) * exp(-heightK * z) (z = 0 on the GPU: no per-cell height there, heightK ignored in v1).
 * postVigF: k * smoothstep(r0, r1, r), r = |(nx * aspect, ny)| / |(aspect, 1)| at the cell centre uv (0..1).
 * Uniform words (SpritesU, appended at the END): postVig (k, r0, r1, on), postVigRGB (rgb, aspect), postMist (rgb, density), postMistB (start, heightK, on, 0).
 */
export const POST_WGSL = `fn postQ8(x: f32) -> f32 { return floor(clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 255.0; }
fn postMistF(depth: f32, z: f32, density: f32, start: f32, heightK: f32) -> f32 {
  let e = depth - start;
  if (!(e > 0.0)) { return 0.0; }
  var f = 1.0 - exp(-density * e);
  if (heightK > 0.0) { f = f * exp(-heightK * z); }
  return f;
}
fn postVigF(ux: f32, uy: f32, aspect: f32, k: f32, r0: f32, r1: f32) -> f32 {
  let nx = (ux * 2.0 - 1.0) * aspect;
  let ny = uy * 2.0 - 1.0;
  let t = clamp((sqrt(nx * nx + ny * ny) / sqrt(aspect * aspect + 1.0) - r0) / (r1 - r0), 0.0, 1.0);
  return k * t * t * (3.0 - 2.0 * t);
}
fn postFinish(c: vec3f, mf: f32, vf: f32, mc: vec3f, vc: vec3f, gOn: f32, lift: vec3f, ig: vec3f, gain: vec3f, sat: f32) -> vec3f {
  let c0 = vec3f(postQ8(c.x), postQ8(c.y), postQ8(c.z));
  var m = c0;
  if (mf > 0.0) { m = vec3f(postQ8(c0.x + (mc.x - c0.x) * mf), postQ8(c0.y + (mc.y - c0.y) * mf), postQ8(c0.z + (mc.z - c0.z) * mf)); }
  var g = m;
  if (gOn > 0.5) { let a = atmosGrade(m, lift, ig, gain, sat); g = vec3f(postQ8(a.x), postQ8(a.y), postQ8(a.z)); }
  var v = g;
  if (vf > 0.0) { v = vec3f(postQ8(g.x + (vc.x - g.x) * vf), postQ8(g.y + (vc.y - g.y) * vf), postQ8(g.z + (vc.z - g.z) * vf)); }
  return v;
}
`;
