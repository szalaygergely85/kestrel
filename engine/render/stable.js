// @ts-check
// engine/render/stable.js - US-073 step 1 (docs/backlog.md PC-B QUEUE 3 item
// 13, docs/architecture.md 25.6 "US-073 temporal glyph stability").
//
// Pure JS oracle for the future `stable` GPU pass (25.6): given last frame's
// resolved cells ("history") and this frame's freshly-shaded cells, decide,
// per cell, whether to keep blending toward the old glyph/color or to snap
// straight to the new one. This module is NOT wired into the real frame
// render (no GpuDevice import) - it is PC-A's job later to feed it real
// G-buffer snapshots every frame. It is deliberately a free-standing
// algorithm test bed. ARCH CHANGES (2026-09-29 opus batch 2): this module now
// imports the REAL `projTerms`/`unprojectCell` from `engine/render/
// projection.js` (out-params into this module's own module-level scratch, so
// still zero-allocation) instead of a copied/hardcoded-HFOV `fillTerms`/
// `cellRayP` twin - only the inverse `reprojectToCell` (below) stays
// module-local, since no other module needs that direction.
//
// Reprojection: 25.6 says "reproject the current world point (`cellRayP
// (depth)`) with the previous camera uniforms". `cellRayP` (GLSL) / its JS
// twin `unprojectCell` (engine/render/projection.js) maps screen (col, row,
// dist) -> world point for ONE camera. To find which history cell (if any)
// this frame's cell corresponds to, this module inverts that same formula
// algebraically for the PREVIOUS camera's terms (`reprojectToCell` below)
// rather than round-tripping through `shearProjection`/`projectPoint`/
// `windowToCell` (those serve the full sub-pixel raster path and do not
// promise the same `row` convention `unprojectCell` documents - "samples at
// row, 27.15.0 amendment 1" - so re-deriving the exact inverse keeps this
// module self-consistent with `unprojectCell` without depending on that
// convention matching). The algebra: `unprojectCell` computes
//   ex = P.x - eyeX = dist*dirX + (dist*cameraX)*planeX
//   ey = P.y - eyeY = dist*dirY + (dist*cameraX)*planeY
// which is linear in (dist, dist*cameraX) - a 2x2 solve recovers both
// exactly, then `col` from `cameraX` and `row` from the z/slope equation,
// the literal inverse of `unprojectCell`'s own three formulas.
//
// "detail" (the `0.5 / detail` UV-drift threshold) is the same per-material
// texel density `detailShade.js` calls `m.detail` (default 16, "texels per
// UV unit") - `cur.detail[i]` here, defaulting the same way when omitted.
//
// Per-cell inputs mirror a subset of `GBuffer.js`'s own fields (`kind`,
// `planeId`, `u`, `v`, `z`, `rule`) plus the resolved glyph/color a real
// caller would have picked this frame, plus one field `GBuffer.js` does not
// have yet: `playing` - 1 when a kind-8 (`KIND_MODEL`) cell's voxel part
// belongs to a `sprite.anim` that is mid-clip (`anim.playing`, see
// `engine/entities/animation.js` `stepAnimations`/`clipFor`). Wiring that
// bit from the real entity/voxel-instance data is PC-A's job when this lands
// in the real pass; this module just requires it to be supplied per-cell.

import { KIND_NONE, KIND_MODEL } from './GBuffer.js';
import { projTerms, unprojectCell } from './projection.js';

/** Global kill-switch: yaw delta beyond this turns history off for the whole frame (25.6). */
export const YAW_DISABLE_DEG = 3;
/** Per-channel (0-255) snap threshold: bigger jumps skip the 0.5 blend (25.6, "light toggled, door moved"). */
export const CHANNEL_SNAP = 48;
/** Default material texel density when a frame omits per-cell `detail` (matches `detailShade.js`'s `m.detail || 16`). */
export const DEFAULT_DETAIL = 16;

/**
 * @typedef {Object} StableFrame
 * @property {number} cols
 * @property {number} rows
 * @property {Uint16Array} glyph - the real ASCII glyph code per cell (NOT
 *   ramp-ordered - two adjacent brightness-ramp levels can be arbitrarily far
 *   apart as raw codes; use `level` for the "one ramp level" hysteresis rule).
 * @property {Uint8Array} level - ramp level per cell (0..N-1 within its
 *   brightness ramp); ARCH CHANGES: adjacent LEVELS, not adjacent glyph codes,
 *   are what "one ramp level" (US-073) means.
 * @property {Uint32Array} fg - packed 0xRRGGBB per cell
 * @property {Uint32Array} bg - packed 0xRRGGBB per cell
 * @property {Uint8Array} kind - GBuffer.kind codes (KIND_NONE..KIND_MODEL)
 * @property {Int32Array} planeId - GBuffer.planeId
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Float32Array} z - resolved ray distance for this cell (GBuffer.z)
 * @property {Uint8Array} rule - GBuffer.rule (0 = interior/no edge, != 0 = edge cell, always recomputed)
 * @property {Uint8Array} playing - 1 when kind===KIND_MODEL and the voxel part's clip is playing, else 0
 * @property {Float32Array} [detail] - per-cell material texel density; DEFAULT_DETAIL used where omitted
 */

/**
 * @typedef {Object} StableCam
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yawDeg
 * @property {number} pitchDeg
 * @property {number} cols
 * @property {number} rows
 * @property {boolean} [teleport] - true the one frame a teleport/warp happened (25.6: history off)
 * @property {boolean} [gridChanged] - true the one frame `setGrid` changed resolution (25.6: history off)
 */

/**
 * @typedef {Object} StableOut
 * @property {Uint16Array} glyph
 * @property {Uint32Array} fg
 * @property {Uint32Array} bg
 */

// Reused scratch (module-level, never reallocated per call - "no allocation
// per call" AC). Plain objects/typed arrays with fixed numeric fields.
const _curTerms = {
  cols: 0, rows: 0, eyeX: 0, eyeY: 0, eyeZ: 0, dirX: 0, dirY: 0,
  planeX: 0, planeY: 0, tanHalf: 0, planeDistX: 0, planeDistY: 0,
  horizonRow: 0, tanPitch: 0,
};
const _prevTerms = {
  cols: 0, rows: 0, eyeX: 0, eyeY: 0, eyeZ: 0, dirX: 0, dirY: 0,
  planeX: 0, planeY: 0, tanHalf: 0, planeDistX: 0, planeDistY: 0,
  horizonRow: 0, tanPitch: 0,
};
const _P = [0, 0, 0];
const _cellScratch = [0, 0];
// `projTerms`'s `grid` out-param (ARCH CHANGES: real projection.js terms
// instead of a copied/hardcoded-HFOV twin) - mutated in place, never
// reallocated (cols/rows are the same for `cam`/`prevCam` here: a resolution
// mismatch already forces `globallyOff` before this is used).
const _gridScratch = { cols: 0, rows: 0 };

/**
 * Exact algebraic inverse of `cellRayP` for a given camera's terms: world
 * point (x, y, z) -> fractional (col, row). Returns null when the point is
 * degenerate for this camera (zero/negative `dist`, i.e. behind the eye).
 * Writes into `out2` and returns it, or returns null (out2 left untouched).
 * @param {typeof _curTerms} terms
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number[]} out2
 * @returns {number[]|null}
 */
function reprojectToCell(terms, x, y, z, out2) {
  const ex = x - terms.eyeX, ey = y - terms.eyeY;
  const D = terms.dirX * terms.planeY - terms.planeX * terms.dirY;
  if (D === 0) return null;
  // ex = A*dirX + B*planeX, ey = A*dirY + B*planeY, A = dist, B = dist*cameraX
  const A = (ex * terms.planeY - terms.planeX * ey) / D;
  const B = (terms.dirX * ey - ex * terms.dirY) / D;
  if (A <= 0) return null; // behind (or at) the previous camera
  const cameraX = B / A;
  const col = (terms.cols * (cameraX + 1)) / 2 - 0.5;
  const ez = z - terms.eyeZ;
  const slope = ez / A;
  const row = terms.horizonRow - slope * terms.planeDistY;
  out2[0] = col;
  out2[1] = row;
  return out2;
}

/** Smallest signed angular delta between two degree headings, in [0, 180]. */
function yawDeltaDeg(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return Math.abs(d);
}

/** `|a - b| <= 1`, the "within one ramp level" rule (25.6a) - ARCH CHANGES: takes ramp LEVELS (`StableFrame.level`), not raw glyph codes. */
function withinOneRampLevel(prevLevel, curLevel) {
  return Math.abs(curLevel - prevLevel) <= 1;
}

/** `mix(prev, cur, 0.5)` per channel, snapping straight to `cur` on any channel where `|delta| > CHANNEL_SNAP` (25.6b). */
function blendPacked(prevPacked, curPacked) {
  const pr = (prevPacked >> 16) & 0xff, pg = (prevPacked >> 8) & 0xff, pb = prevPacked & 0xff;
  const cr = (curPacked >> 16) & 0xff, cg = (curPacked >> 8) & 0xff, cb = curPacked & 0xff;
  const r = Math.abs(cr - pr) > CHANNEL_SNAP ? cr : Math.round((pr + cr) / 2);
  const g = Math.abs(cg - pg) > CHANNEL_SNAP ? cg : Math.round((pg + cg) / 2);
  const b = Math.abs(cb - pb) > CHANNEL_SNAP ? cb : Math.round((pb + cb) / 2);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * Decides, per cell, whether to keep the previous frame's glyph/color
 * (blended) or snap to this frame's fresh values, per 25.6's rules. Writes
 * `out.glyph`/`out.fg`/`out.bg` (caller-owned, same length as `cur`'s
 * arrays) and returns `out`. No allocation when `out` (and `prev`/`cur`) are
 * reused frame to frame.
 * @param {StableFrame} prev - last frame's resolved cells (history)
 * @param {StableFrame} cur - this frame's freshly-shaded cells
 * @param {StableCam} prevCam
 * @param {StableCam} cam
 * @param {StableOut} out
 * @returns {StableOut}
 */
export function stabilizeCells(prev, cur, prevCam, cam, out) {
  const cols = cur.cols, rows = cur.rows;
  const n = cols * rows;

  // Global kill-switches (25.6): the whole frame falls back to `cur` untouched.
  const gridChanged = !!cam.gridChanged || prev.cols !== cols || prev.rows !== rows;
  const globallyOff = !!cam.teleport || gridChanged
    || yawDeltaDeg(prevCam.yawDeg, cam.yawDeg) > YAW_DISABLE_DEG;

  if (globallyOff) {
    for (let i = 0; i < n; i++) {
      out.glyph[i] = cur.glyph[i];
      out.fg[i] = cur.fg[i];
      out.bg[i] = cur.bg[i];
    }
    return out;
  }

  _gridScratch.cols = cols; _gridScratch.rows = rows;
  projTerms(cam, _gridScratch, _curTerms);
  projTerms(prevCam, _gridScratch, _prevTerms);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      // Default: no history this cell (overwritten below when accepted).
      out.glyph[i] = cur.glyph[i];
      out.fg[i] = cur.fg[i];
      out.bg[i] = cur.bg[i];

      if (cur.rule[i] !== 0) continue; // edge cells: always recomputed (25.6)
      if (cur.kind[i] === KIND_MODEL && cur.playing[i]) continue; // playing kind-8 clip (25.6)
      if (cur.kind[i] === KIND_NONE) continue; // ARCH CHANGES: sky - no real depth to reproject
      if (!Number.isFinite(cur.z[i]) || cur.z[i] <= 0) continue; // ARCH CHANGES: degenerate/non-finite depth

      unprojectCell(_curTerms, col, row, cur.z[i], _P);
      const cellPrev = reprojectToCell(_prevTerms, _P[0], _P[1], _P[2], _cellScratch);
      if (!cellPrev) continue; // behind the previous camera

      const colH = Math.round(cellPrev[0]);
      const rowH = Math.round(cellPrev[1]);
      if (colH < 0 || colH >= cols || rowH < 0 || rowH >= rows) continue;
      const h = rowH * cols + colH;

      if (prev.kind[h] !== cur.kind[i] || prev.planeId[h] !== cur.planeId[i]) continue;

      const detail = (cur.detail ? cur.detail[i] : 0) || DEFAULT_DETAIL;
      const du = cur.u[i] - prev.u[h];
      const dv = cur.v[i] - prev.v[h];
      const dUV = Math.sqrt(du * du + dv * dv);
      if (dUV >= 0.5 / detail) continue;

      out.glyph[i] = withinOneRampLevel(prev.level[h], cur.level[i]) ? prev.glyph[h] : cur.glyph[i];
      out.fg[i] = blendPacked(prev.fg[h], cur.fg[i]);
      out.bg[i] = blendPacked(prev.bg[h], cur.bg[i]);
    }
  }
  return out;
}
