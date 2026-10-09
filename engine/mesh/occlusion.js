// @ts-check
// engine/mesh/occlusion.js - S8-B2-10a: CPU twin (oracle) of the HZB occlusion test of the cull kernel (architecture.md 38.20).
// Depth convention (hzb.js): LARGER = FARTHER, +Inf = sky (never occludes). An instance is culled only when its conservative NEAR depth zN
// is beyond the max-depth HZB value of EVERY texel its (padded) screen rect covers: "never wrongly culled" is a hard rule.
// Margins (normative, kernel == twin): R' = R + swayPad; rect = floor(min)-1 .. ceil(max)+1 texels; zN = (dot(t-eye,fwd)-R')*(1-1e-3)-m
// (m = frame.margin, default 0.05 m); any corner with clip.w <= 1e-6 or zN <= 0 -> visible (no test).
// Scratch is preallocated: no allocation per call after warm-up.

const W_EPS = 1e-6;
const DEPTH_REL = 1 - 1e-3;
const f32 = Math.fround;

/**
 * @typedef {object} OcclusionFrame
 * @property {ArrayLike<number>} vp  - viewProj, column-major (clip = vp[0]*x + vp[4]*y + vp[8]*z + vp[12]), same as DrawList viewProj
 * @property {ArrayLike<number>} eye - camera position [x, y, z]
 * @property {ArrayLike<number>} fwd - unit view forward [x, y, z]
 * @property {number} [margin] - depth margin m in metres (default 0.05)
 * @property {number} hzbOn - 0 = never cull (invalid HZB: first frame / cut / teleport / resize)
 * @property {number} hzbW - HZB level-0 width (= raster target cells x rays)
 * @property {number} hzbH - level-0 height
 */

/** Screen rect scratch: [xmin, ymin, xmax, ymax] level-0 texels, inclusive. */
export function createRect() { return new Int32Array(4); }

/**
 * Project the 8 corners of t +- R through viewProj (raster VS mapping: y flipped, viewport = hzbW x hzbH) into `out` (+-1 texel, clamped).
 * @param {ArrayLike<number>} vp @param {number} w @param {number} h @param {number} tx @param {number} ty @param {number} tz @param {number} R
 * @param {Int32Array} out
 * @returns {number} 1 = rect valid; 0 = a corner is behind/at the eye or the rect is off-screen (caller treats as visible)
 */
export function projectAabbRect(vp, w, h, tx, ty, tz, R, out) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let c = 0; c < 8; c++) {
    const x = tx + ((c & 1) ? R : -R), y = ty + ((c & 2) ? R : -R), z = tz + ((c & 4) ? R : -R);
    const cw = f32(vp[3] * x + vp[7] * y + vp[11] * z + vp[15]);
    if (!(cw > W_EPS)) return 0;
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const sx = f32((cx / cw * 0.5 + 0.5) * w), sy = f32((0.5 - cy / cw * 0.5) * h);
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1), y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(w - 1, Math.ceil(maxX) + 1), y1 = Math.min(h - 1, Math.ceil(maxY) + 1);
  if (x0 > x1 || y0 > y1) return 0;
  out[0] = x0; out[1] = y0; out[2] = x1; out[3] = y1;
  return 1;
}

/** Smallest level L whose texels cover the rect with <= 2x2 texels, clamped to levels - 1. @param {Int32Array} rect @param {number} levels */
export function hzbMipPick(rect, levels) {
  let L = 0;
  while (L < levels - 1 && ((rect[2] >> L) - (rect[0] >> L) > 1 || (rect[3] >> L) - (rect[1] >> L) > 1)) L++;
  return L;
}

/**
 * Conservative nearest view depth of a sphere t +- R' (valid for view-z and ray-length depth). <= 0 means "no test".
 * @param {OcclusionFrame} f @param {number} tx @param {number} ty @param {number} tz @param {number} Rp
 */
export function nearDepth(f, tx, ty, tz, Rp) {
  const d = (tx - f.eye[0]) * f.fwd[0] + (ty - f.eye[1]) * f.fwd[1] + (tz - f.eye[2]) * f.fwd[2];
  return f32(f32((d - Rp) * DEPTH_REL) - (f.margin === undefined ? 0.05 : f.margin));
}

/**
 * Occluded iff zN > hzb[L][texel] for ALL covered texels of the picked level (+Inf never occludes).
 * @param {{w: number, h: number, data: Float32Array}[]} levels pyramid from hzb.js buildHzb @param {number} hzbW @param {number} hzbH
 * @param {Int32Array} rect @param {number} zN
 */
export function aabbOccluded(levels, hzbW, hzbH, rect, zN) {
  if (!(zN > 0)) return false;
  const L = hzbMipPick(rect, levels.length), lv = levels[L], d = lv.data;
  // clamp BOTH ends: the last (odd-leftover) texel covers every level-0 texel beyond it, so x >> L >= lv.w maps to lv.w - 1 (an empty loop would wrongly say occluded)
  const x0 = Math.min(rect[0] >> L, lv.w - 1), x1 = Math.min(rect[2] >> L, lv.w - 1), y0 = Math.min(rect[1] >> L, lv.h - 1), y1 = Math.min(rect[3] >> L, lv.h - 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!(zN > d[y * lv.w + x])) return false;
  return true;
}

const _rect = createRect();
/** Full per-instance test (kernel body). @returns {boolean} true = occluded (cull) @param {OcclusionFrame} f @param {{w:number,h:number,data:Float32Array}[]} levels */
export function instanceOccluded(f, levels, tx, ty, tz, R, swayPad) {
  if (!f.hzbOn) return false;
  const Rp = R + swayPad;
  if (!projectAabbRect(f.vp, f.hzbW, f.hzbH, tx, ty, tz, Rp, _rect)) return false;
  const zN = nearDepth(f, tx, ty, tz, Rp);
  return aabbOccluded(levels, f.hzbW, f.hzbH, _rect, zN);
}

/**
 * One occlusion phase over a group (instance floats at ib.f32 with stride, translation in words 3, 7, 11 as compactGroup).
 * Phase 1: every instance in `candidates` (or 0..count-1) is tested against the PREVIOUS frame's HZB: visible -> out.visible, occluded ->
 * out.pending and occl[i] = 1. Phase 2 (levels = this frame's HZB): only i with occl[i] & 1 are re-tested; survivors -> out.visible, rest dropped.
 * hzbOn 0: phase 1 keeps everything, phase 2 has nothing pending.
 * @param {{count: number, ib: {f32: Float32Array}}} g @param {number} stride words per instance
 * @param {OcclusionFrame} f @param {{w:number,h:number,data:Float32Array}[]} levels @param {Uint32Array} occl
 * @param {1|2} phase @param {number} R @param {number} swayPad
 * @param {{visible: Uint32Array, pending: Uint32Array, nVisible: number, nPending: number}} out
 */
export function occlusionPass(g, stride, f, levels, occl, phase, R, swayPad, out) {
  const s = g.ib.f32;
  let nv = 0, np = 0;
  for (let i = 0; i < g.count; i++) {
    if (phase === 2 && !(occl[i] & 1)) continue;
    const o = i * stride;
    const occ = instanceOccluded(f, levels, s[o + 3], s[o + 7], s[o + 11], R, swayPad);
    if (phase === 1) { occl[i] = occ ? 1 : 0; if (occ) out.pending[np++] = i; else out.visible[nv++] = i; }
    else if (!occ) out.visible[nv++] = i;
  }
  out.nVisible = nv; out.nPending = np;
  return out;
}
