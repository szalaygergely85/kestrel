// POST-STACK-01a (docs/architecture.md 38.73): data-driven per-cell finish chain, JS twin. Pure numbers, no design/ import.
// Order per cell (fixed): mist -> grade (biome grade composed with the preset grade into ONE set) -> vignette. fg and bg, glyph never changes.
// The grade stage IS gradeCells (atmos.js) fed with the composed values, so identity post + atmos is bit-equal to gradeCells alone.
// Colours in cfg/state (mist.rgb, vignette.rgb) are 0..1. 01b adds POST_WGSL from the same constants.
import { gradeCells } from './atmos.js';

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
 * Nothing active -> buffers untouched. 0 alloc.
 */
export function postCells(rt, depthF32, state, zF32 = null) {
  const cb = rt.cells || rt;
  if (state.mist[3] > 0 && depthF32) mistPass(cb, depthF32, zF32, state);
  if (state.gradeOn) gradeCells(rt, state);
  if (state.vig[3] > 0) vignettePass(rt, cb, state);
}

function mistPass(cb, depth, z, s) {
  const dens = s.mist[0], start = s.mist[1], hk = s.mist[2];
  const mr = s.mistRGB[0] * 255, mg = s.mistRGB[1] * 255, mb = s.mistRGB[2] * 255;
  const fg = cb.fg, bg = cb.bg, n = Math.min(depth.length, fg.length >> 2);
  for (let c = 0; c < n; c++) {
    const e = depth[c] - start;
    if (!(e > 0)) continue; // d <= start (or NaN): no mist
    let f = 1 - Math.exp(-dens * e);
    if (hk > 0 && z) f *= Math.exp(-hk * z[c]);
    if (f <= 0) continue;
    const o = c << 2;
    fg[o] = b8(fg[o] + (mr - fg[o]) * f + 0.5); fg[o + 1] = b8(fg[o + 1] + (mg - fg[o + 1]) * f + 0.5); fg[o + 2] = b8(fg[o + 2] + (mb - fg[o + 2]) * f + 0.5);
    bg[o] = b8(bg[o] + (mr - bg[o]) * f + 0.5); bg[o + 1] = b8(bg[o + 1] + (mg - bg[o + 1]) * f + 0.5); bg[o + 2] = b8(bg[o + 2] + (mb - bg[o + 2]) * f + 0.5);
  }
}

// r = aspect-corrected radius, 1 at the corners: |(x * aspect, y)| / |(aspect, 1)|, x,y in -1..1; aspect = displayed picture ratio.
function vignettePass(rt, cb, s) {
  const cols = cb.cols, rows = cb.rows;
  const aspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const inv = 1 / Math.sqrt(aspect * aspect + 1);
  const k = s.vig[0], r0 = s.vig[1], r1 = s.vig[2], ir = 1 / (r1 - r0);
  const vr = s.vigRGB[0] * 255, vg = s.vigRGB[1] * 255, vb = s.vigRGB[2] * 255;
  const fg = cb.fg, bg = cb.bg;
  for (let y = 0; y < rows; y++) {
    const ny = ((y + 0.5) / rows) * 2 - 1;
    for (let x = 0; x < cols; x++) {
      const nx = (((x + 0.5) / cols) * 2 - 1) * aspect;
      let t = (Math.sqrt(nx * nx + ny * ny) * inv - r0) * ir;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const f = k * t * t * (3 - 2 * t); // k * smoothstep(r0, r1, r)
      if (f <= 0) continue;
      const o = (y * cols + x) << 2;
      fg[o] = b8(fg[o] + (vr - fg[o]) * f + 0.5); fg[o + 1] = b8(fg[o + 1] + (vg - fg[o + 1]) * f + 0.5); fg[o + 2] = b8(fg[o + 2] + (vb - fg[o + 2]) * f + 0.5);
      bg[o] = b8(bg[o] + (vr - bg[o]) * f + 0.5); bg[o + 1] = b8(bg[o + 1] + (vg - bg[o + 1]) * f + 0.5); bg[o + 2] = b8(bg[o + 2] + (vb - bg[o + 2]) * f + 0.5);
    }
  }
}
