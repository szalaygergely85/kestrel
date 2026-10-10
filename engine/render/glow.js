// EMIS-03/04 (architecture.md 38.12 (2)+(3), owner ask 2026-10-08): emissive BLEED + HALO. JS twin / oracle of
// gpu/wgsl/glow.wgsl.js (D-017); the WGSL builds its constants from this file so both sides share one definition.
//
// SIMPLIFICATION vs 38.12 (the spec leaves the pass placement open enough to pick the simplest): ONE screen-space pass
// over the FINAL cells (after edge / stable, before sprites) instead of two separable passes before shade + a halo inside
// edge. Why: no MatF GLOW column, no shade binding, no edge change, no timer-slot move; the glow colour is simply the
// source cell's own final fg colour (what the player sees). Cost: 1 pass, (2R+1)^2 taps at cell resolution, High R=3, Ultra R=4.
//
// Per destination cell c (not itself an emissive voxel cell):
//   for every source cell s within R (kind != sky/terrain, material emissive >= GLOW_EMIS_MIN):
//     w = (1 - r^2 / (R+1)^2)^2          (r = cell distance, 0 beyond the radius)
//     g = exp(-|ds - dc| / (GLOW_DEPTH_K * dc + GLOW_DEPTH_EPS))   solid destinations only: no leak across a silhouette
//     sumW += w*g*e ; acc += w*g*e * colN(s)     colN = fg rgb / max(fg rgb)  (hue of the source, brightness-free)
//   a = min(1, sumW), glow = acc / sumW
//   solid destination (kind != 0, glyph != space): additive bleed   bg += glow*255*a*gain ; fg += ... *0.5
//   sky / space-glyph destination: halo   bg = mix(bg, glow*255, a*haloBg) ; if a >= haloMin and the glyph is a space
//        the glyph becomes HALO_RAMP[round(a*(n-1))] (a drawn glyph is never replaced)
// Zero allocation: scalar loops only; the caller owns the output arrays. Passthrough cells (bg.a == 0) are copied.
import { KIND_TERRAIN } from './GBuffer.js';

export const GLOW_EMIS_MIN = 0.3;      // material emissive that counts as a light source (38.12: GLOW.w >= 0.3)
export const GLOW_DEPTH_K = 0.12;      // depth gate width relative to the destination depth (38.12)
export const GLOW_DEPTH_EPS = 0.05;    // metres, keeps the gate finite at dc ~ 0
export const GLOW_FG_K = 0.5;          // fg receives this fraction of the bg bleed
export const HALO_RAMP = " .':*";      // glyphRamps.halo default (designer may override later); index 0 = space = no glyph
export const HALO_GLYPHS = Object.freeze(Array.from(HALO_RAMP, (c) => c.charCodeAt(0) - 32)); // glyph-atlas bytes (code - 32)
export const GLOW_RADIUS_MAX = 6;

/** Quality presets (38.12 knob): off / derived (no pass) / full. radius in cells. */
export const GLOW_LEVELS = Object.freeze({
  low: null, medium: null,
  high: Object.freeze({ radius: 3, gain: 0.35, haloBg: 0.55, haloMin: 0.25 }),
  ultra: Object.freeze({ radius: 4, gain: 0.35, haloBg: 0.55, haloMin: 0.25 }),
});

/** Shared scalar kernel pieces (the WGSL repeats exactly these expressions). */
export function glowWeight(dx, dy, radius) {
  const r2 = dx * dx + dy * dy, R = radius + 1;
  const t = 1 - r2 / (R * R);
  return t > 0 ? t * t : 0;
}
export function glowDepthGate(ds, dc) { return Math.exp(-Math.abs(ds - dc) / (GLOW_DEPTH_K * dc + GLOW_DEPTH_EPS)); }

const sw = new Float64Array(5); // scratch: [sumW, accR, accG, accB, unused] - module-level, never reallocated

/**
 * Gathers the glow around cell (x, y). Returns sumW (0 = nothing); glow colour (0..1, hue only) lands in `out[0..2]`.
 * @param {number} x @param {number} y @param {number} cols @param {number} rows
 * @param {Uint8Array|Uint16Array|Uint32Array|number[]} kind @param {ArrayLike<number>} mat @param {Float32Array} depth
 * @param {Float32Array} emis emissive by material id @param {Uint8Array} fg RGBA8 (final fg, a = glyph byte)
 * @param {{radius:number}} P @param {Float64Array|number[]} out
 */
export function glowGather(x, y, cols, rows, kind, mat, depth, emis, fg, P, out) {
  const R = P.radius | 0, i = y * cols + x, solid = kind[i] !== 0, dc = depth[i];
  let sumW = 0, ar = 0, ag = 0, ab = 0;
  const y0 = y - R < 0 ? 0 : y - R, y1 = y + R >= rows ? rows - 1 : y + R;
  const x0 = x - R < 0 ? 0 : x - R, x1 = x + R >= cols ? cols - 1 : x + R;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const j = yy * cols + xx;
      if (j === i) continue;
      const k = kind[j];
      if (k === 0 || k === KIND_TERRAIN) continue; // terrain carries a terrain type in `mat`, not a material id
      const e = emis[mat[j]];
      if (!(e >= GLOW_EMIS_MIN)) continue;
      let w = glowWeight(xx - x, yy - y, R);
      if (w === 0) continue;
      if (solid) w *= glowDepthGate(depth[j], dc);
      w *= e > 1 ? 1 : e;
      sumW += w;
      const o = j * 4, r = fg[o], g = fg[o + 1], b = fg[o + 2];
      const m = Math.max(r, g, b, 1);
      ar += w * r / m; ag += w * g / m; ab += w * b / m;
    }
  }
  if (sumW > 0) { out[0] = ar / sumW; out[1] = ag / sumW; out[2] = ab / sumW; }
  return sumW;
}

function clampByte(v) { return v > 255 ? 255 : (v < 0 ? 0 : Math.round(v)); }

/**
 * Whole-frame twin. Reads fgIn/bgIn (RGBA8, fg.a = glyph byte, bg.a == 0 = passthrough), writes fgOut/bgOut (same shapes).
 * @param {{kind:ArrayLike<number>, mat:ArrayLike<number>, depth:Float32Array}} g G-buffer arrays (cols*rows)
 * @param {Float32Array} emis @param {{radius:number, gain:number, haloBg:number, haloMin:number}} P
 */
export function glowFrame(g, cols, rows, emis, fgIn, bgIn, fgOut, bgOut, P) {
  const kind = g.kind, mat = g.mat, depth = g.depth, col = sw, n = HALO_GLYPHS.length;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, o = i * 4;
      for (let k = 0; k < 4; k++) { fgOut[o + k] = fgIn[o + k]; bgOut[o + k] = bgIn[o + k]; }
      if (bgIn[o + 3] === 0) continue;
      const kd = kind[i];
      if (kd !== 0 && kd !== KIND_TERRAIN && emis[mat[i]] >= GLOW_EMIS_MIN) continue; // an emissive cell keeps its own colour
      const sumW = glowGather(x, y, cols, rows, kind, mat, depth, emis, fgIn, P, col);
      if (sumW <= 0) continue;
      const a = sumW > 1 ? 1 : sumW;
      const gr = col[0] * 255, gg = col[1] * 255, gb = col[2] * 255;
      const glyph = fgIn[o + 3];
      if (kd === 0 || glyph === 0) { // halo
        const t = a * P.haloBg;
        bgOut[o] = clampByte(bgIn[o] + (gr - bgIn[o]) * t);
        bgOut[o + 1] = clampByte(bgIn[o + 1] + (gg - bgIn[o + 1]) * t);
        bgOut[o + 2] = clampByte(bgIn[o + 2] + (gb - bgIn[o + 2]) * t);
        if (glyph === 0 && a >= P.haloMin) { // the halo glyph is drawn in the glow colour (0.5 + 0.5a)
          const f = 0.5 + 0.5 * a;
          fgOut[o] = clampByte(gr * f); fgOut[o + 1] = clampByte(gg * f); fgOut[o + 2] = clampByte(gb * f);
          fgOut[o + 3] = HALO_GLYPHS[Math.round(a * (n - 1))];
        }
      } else { // bleed
        const t = a * P.gain;
        bgOut[o] = clampByte(bgIn[o] + gr * t); bgOut[o + 1] = clampByte(bgIn[o + 1] + gg * t); bgOut[o + 2] = clampByte(bgIn[o + 2] + gb * t);
        const tf = t * GLOW_FG_K;
        fgOut[o] = clampByte(fgIn[o] + gr * tf); fgOut[o + 1] = clampByte(fgIn[o + 1] + gg * tf); fgOut[o + 2] = clampByte(fgIn[o + 2] + gb * tf);
      }
    }
  }
}
