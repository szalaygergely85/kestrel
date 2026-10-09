// @ts-check
// engine/mesh/hzb.js - S8-B2-09: CPU twin (oracle) of the HZB depth pyramid kernel `wgsl/hzb.wgsl.js`.
// Depth convention: larger = farther; every level texel is the MAX of the source texels it covers (conservative occluder depth).
// Level sizes: max(1, floor(size / 2)); the last column/row of a level also covers the odd leftover source column/row.

/** @param {number} n @returns {number} size of the next pyramid level */
export function hzbNextSize(n) { return Math.max(1, n >> 1); }

/** Sizes of all levels from (w, h) down to 1x1. @param {number} w @param {number} h @returns {{w: number, h: number}[]} */
export function hzbLevelSizes(w, h) {
  const out = [{ w, h }];
  while (w > 1 || h > 1) { w = hzbNextSize(w); h = hzbNextSize(h); out.push({ w, h }); }
  return out;
}

/** One destination texel (twin of WGSL hzbTexel). @param {Float32Array} src @param {number} srcW @param {number} srcH @param {number} x @param {number} y @param {number} [pitch] words per src row (default srcW; twin of HzbU.srcPitch) */
export function hzbTexel(src, srcW, srcH, x, y, pitch = srcW) {
  const dstW = hzbNextSize(srcW), dstH = hzbNextSize(srcH);
  const x0 = 2 * x, y0 = 2 * y;
  const x1 = x + 1 === dstW ? srcW - 1 : x0 + 1;
  const y1 = y + 1 === dstH ? srcH - 1 : y0 + 1;
  let m = src[y0 * pitch + x0];
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) m = Math.max(m, src[yy * pitch + xx]);
  return m;
}

/** One level down. @param {Float32Array} src @param {number} srcW @param {number} srcH @param {Float32Array} [dst] @param {number} [pitch] @returns {Float32Array} */
export function hzbDownsample(src, srcW, srcH, dst, pitch = srcW) {
  const dw = hzbNextSize(srcW), dh = hzbNextSize(srcH);
  const out = dst || new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) out[y * dw + x] = hzbTexel(src, srcW, srcH, x, y, pitch);
  return out;
}

/** Whole pyramid; level 0 is `depth` itself. @param {Float32Array} depth @param {number} w @param {number} h @returns {{w: number, h: number, data: Float32Array}[]} */
export function buildHzb(depth, w, h) {
  const levels = [{ w, h, data: depth }];
  while (w > 1 || h > 1) {
    const prev = levels[levels.length - 1];
    const data = hzbDownsample(prev.data, prev.w, prev.h);
    w = hzbNextSize(w); h = hzbNextSize(h);
    levels.push({ w, h, data });
  }
  return levels;
}
