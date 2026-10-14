// ENV-02b (arch 38.63 points 2-3): per-biome ground look, JS twin. No design/ or game/ import: the game hands a plain config
// (game/js/look/groundLookConfig.js buildGroundLookConfig) to packLookTable(); shadeTerrain/shadeGrass read the packed Float32Array,
// so the f32 rounding is the same as the GPU table (ENV-02d WGSL twin). Look id 0 = today's ground (TLOOK path, untouched).
// Everything is keyed by WORLD cells (never a distance-sized or screen cell, 38.50); calm (wind01 = 0) output is time-independent.
import { hashFast24 } from './terrainShade.js';

export const LOOK_CELL_M = 0.25;          // fixed world lattice of the glyph / colour / accent hashes
export const LOOK_MAX = 16;               // ids 0..15 (nibbles in the bake); row 0 stays zero
export const LOOK_ROWS = 11;              // vec4 rows per look (38.63 said 10; accents need 2 more scalars rows, see layout)
export const LOOK_W = [0.4, 0.25, 0.35];  // octave weights: fine (noiseScale), fine x2.3, macro (macroScale)
export const LOOK_FINE2 = 2.3;
export const LOOK_SALT = 60;              // octave o uses salt 60 + o; glyph hashes h1..h4 = 70..73; accents 40 + i; gust 90
export const LOOK_GUST_M = 5, LOOK_GUST_SPEED = 0.35;
/* Row layout (look k starts at k * LOOK_ROWS * 4):
 *  r0..r3 ramp 0..3 rgb (linear 0..1), .w = noiseScale, macroScale, contrast, shimmer amp
 *  r4..r5 bg 0..1 rgb, r4.w = sheen, r5.w = glyph count + 8 * (mode: 0 sheen, 1 lean)
 *  r6     glyph codes (ascii - 32) packed two per float (a + 128 b): x = g0,g1  y = g2,g3  z = lean0,1  w = lean2,3
 *  r7, r8 accent 0 / 1: rgb (linear 0..1), .w = glyph code (ascii - 32)
 *  r9     d0, cluster0, maxDist0, d1     r10  cluster1, maxDist1, 0, 0     (density 0 = accent absent) */

/** Pack a groundLookConfig into `out` (Float32Array(LOOK_MAX * LOOK_ROWS * 4)); no alloc beyond cfg reads. */
export function packLookTable(cfg, out) {
  out.fill(0);
  const looks = cfg.looks;
  for (let i = 0; i < looks.length; i++) {
    const L = looks[i];
    if (L.id < 1 || L.id >= LOOK_MAX) throw new Error('groundLook: look id ' + L.id + ' out of 1..' + (LOOK_MAX - 1));
    const o = L.id * LOOK_ROWS * 4, n = L.glyphs.length;
    const sc = [L.noiseScale, L.macroScale, L.contrast, L.shimmerAmp];
    for (let k = 0; k < 4; k++) { for (let c = 0; c < 3; c++) out[o + k * 4 + c] = L.ramp[k][c]; out[o + k * 4 + 3] = sc[k]; }
    for (let k = 0; k < 2; k++) for (let c = 0; c < 3; c++) out[o + 16 + k * 4 + c] = L.bg[k][c];
    out[o + 19] = L.sheen; out[o + 23] = n + 8 * L.shimmerMode;
    for (let k = 0; k < 4; k++) { // pad to 4 by repeating the last glyph
      const g = L.glyphs[k < n ? k : n - 1] - 32, l = L.lean[k < n ? k : n - 1] - 32;
      out[o + 24 + (k >> 1)] += (k & 1 ? 128 : 1) * g; out[o + 26 + (k >> 1)] += (k & 1 ? 128 : 1) * l;
    }
    for (let a = 0; a < 2 && a < L.accents.length; a++) {
      const A = L.accents[a], r = o + 28 + a * 4;
      out[r] = A.color[0]; out[r + 1] = A.color[1]; out[r + 2] = A.color[2]; out[r + 3] = A.glyph - 32;
      if (a === 0) { out[o + 36] = A.density; out[o + 37] = A.cluster; out[o + 38] = A.maxDist; } else { out[o + 39] = A.density; out[o + 40] = A.cluster; out[o + 41] = A.maxDist; }
    }
  }
  return out;
}

/** Runtime record of a packed table: `q` is the scratch the shade call reads/writes (alloc rule: no double crosses a call). */
export function makeGroundLook(table) { return { table, wind01: 0, q: new Float64Array(24) }; }

/**
 * Shade one look cell. In (q): 0 fu, 1 fv (f32-rounded world m), 2 fp (ground footprint m), 3 t (camera distance m), 4 timeSec, 5 w (weight of `hi`, 0..1).
 * Out (q): 6 tone 0..1, 7..9 fg rgb (linear 0..1, unlit, with the 0.94 + 0.12 h2 variation), 10..12 bg rgb, 13 glyph idx (ascii - 32),
 * 14 anim (1 = the glyph can change with the gust), 15..17 ramp(0.6) rgb (far-grass tint target), 18..20 far-grass glyphs (low / mid / high sg).
 * A look-0 side borrows the other side's look (w forced 0). One inlined body: helpers taking doubles would box per call.
 */
export function shadeLookCell(GL, lo, hi, q) {
  const T = GL.table, R = LOOK_ROWS * 4;
  const fu = q[0], fv = q[1], fp = q[2];
  let w = q[5];
  if (lo === 0 || hi === 0) { if (lo === 0) lo = hi; else hi = lo; w = 0; } else if (lo === hi) w = 0;
  const a = lo * R, b = hi * R, w0 = 1 - w;
  const ns = T[a + 3] * w0 + T[b + 3] * w, ms = T[a + 7] * w0 + T[b + 7] * w, ct = T[a + 11] * w0 + T[b + 11] * w;
  // tone: 3 value-noise octaves, each faded to its mean by 1 - ss(0.15 s, 0.5 s, fp) (s = octave wavelength)
  let nsum = 0;
  for (let o = 0; o < 3; o++) {
    const cell = o === 0 ? ns : o === 1 ? ns * (1 / LOOK_FINE2) : ms;
    let fd = (fp - 0.15 * cell) / (0.35 * cell); fd = fd < 0 ? 0 : fd > 1 ? 1 : fd;
    const wgt = LOOK_W[o] * (1 - fd * fd * (3 - 2 * fd));
    if (wgt <= 0) continue;
    const lx = fu / cell, ly = fv / cell, ix = Math.floor(lx), iy = Math.floor(ly), salt = LOOK_SALT + o;
    let wx = lx - ix, wy = ly - iy; wx = wx * wx * (3 - 2 * wx); wy = wy * wy * (3 - 2 * wy);
    const ca = hashFast24(ix, iy, salt) * (1 / 16777216), cb = hashFast24(ix + 1, iy, salt) * (1 / 16777216), cc = hashFast24(ix, iy + 1, salt) * (1 / 16777216), cd = hashFast24(ix + 1, iy + 1, salt) * (1 / 16777216);
    nsum += wgt * ((ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy) * 2 - 1);
  }
  let tone = 0.5 + ct * nsum; tone = tone < 0 ? 0 : tone > 1 ? 1 : tone;
  // glyph / colour dice on the fixed world lattice, dither amplitude faded by footprint -> far glyphs depend on the smooth tone only
  const cx = Math.floor(fu * (1 / LOOK_CELL_M)), cy = Math.floor(fv * (1 / LOOK_CELL_M));
  let df = (fp - 0.5 * LOOK_CELL_M) / (0.5 * LOOK_CELL_M); df = df < 0 ? 0 : df > 1 ? 1 : df;
  const dith = 1 - df * df * (3 - 2 * df);
  const h1 = 0.5 + (hashFast24(cx, cy, 70) * (1 / 16777216) - 0.5) * dith;
  const h2 = 0.5 + (hashFast24(cx, cy, 71) * (1 / 16777216) - 0.5) * dith;
  const h3 = 0.5 + (hashFast24(cx, cy, 72) * (1 / 16777216) - 0.5) * dith;
  const h4 = 0.5 + (hashFast24(cx, cy, 73) * (1 / 16777216) - 0.5) * dith;
  const sel = w > h4 ? hi : lo, s = sel * R;
  const sv = T[s + 23], lean = sv >= 8, cnt = lean ? sv - 8 : sv;
  let gx = tone * 0.55 + h1 * 0.6 - 0.08; gx = gx < 0 ? 0 : gx > 1 ? 1 : gx;
  const gi = Math.floor(gx * cnt * 0.9999);
  const gv = T[s + 24 + (gi >> 1)] | 0;
  let code = gi & 1 ? gv >> 7 : gv & 127;
  // colour: piecewise-linear ramps mixed by w (a*(1-w) + b*w is symmetric under lo/hi swap at w = 0.5)
  const x3 = tone * 3; let i0 = x3 | 0; if (i0 > 2) i0 = 2;
  const rf = x3 - i0, vr = 0.94 + 0.12 * h2;
  const ampM = T[a + 15] * w0 + T[b + 15] * w, sheenM = T[a + 19] * w0 + T[b + 19] * w;
  // shimmer: wind01 = 0 skips the branch (calm = byte-identical every frame, no time term anywhere else)
  let kk = 0;
  const wind = GL.wind01;
  if (wind > 0 && ampM > 0) {
    const gxx = fu * (1 / LOOK_GUST_M) - q[4] * LOOK_GUST_SPEED * (0.5 + wind), gyy = fv * (1 / LOOK_GUST_M);
    const ix = Math.floor(gxx), iy = Math.floor(gyy);
    let wx = gxx - ix, wy = gyy - iy; wx = wx * wx * (3 - 2 * wx); wy = wy * wy * (3 - 2 * wy);
    const ca = hashFast24(ix, iy, 90) * (1 / 16777216), cb = hashFast24(ix + 1, iy, 90) * (1 / 16777216), cc = hashFast24(ix, iy + 1, 90) * (1 / 16777216), cd = hashFast24(ix + 1, iy + 1, 90) * (1 / 16777216);
    let gu = (ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy - 0.45) * (1 / 0.4); gu = gu < 0 ? 0 : gu > 1 ? 1 : gu;
    kk = ampM * wind * (gu * gu * (3 - 2 * gu));
    q[14] = lean ? 1 : 0;
    if (lean && kk > 0.15 + 0.6 * h3) { const lv = T[s + 26 + (gi >> 1)] | 0; code = gi & 1 ? lv >> 7 : lv & 127; }
  } else q[14] = 0;
  const sk = kk * sheenM;
  for (let c = 0; c < 3; c++) {
    const lc = T[a + i0 * 4 + c] + (T[a + i0 * 4 + 4 + c] - T[a + i0 * 4 + c]) * rf;
    const hc = T[b + i0 * 4 + c] + (T[b + i0 * 4 + 4 + c] - T[b + i0 * 4 + c]) * rf;
    let col = (lc * w0 + hc * w) * vr;
    if (sk > 0) col += ((T[a + 12 + c] * w0 + T[b + 12 + c] * w) - col) * sk;
    q[7 + c] = col;
    q[10 + c] = (T[a + 16 + c] + (T[a + 20 + c] - T[a + 16 + c]) * tone) * w0 + (T[b + 16 + c] + (T[b + 20 + c] - T[b + 16 + c]) * tone) * w;
    // ramp(0.6): stops 1 -> 2 at 0.8
    q[15 + c] = (T[a + 4 + c] + (T[a + 8 + c] - T[a + 4 + c]) * 0.8) * w0 + (T[b + 4 + c] + (T[b + 8 + c] - T[b + 4 + c]) * 0.8) * w;
  }
  // far-grass glyphs of the winning side: glyphs[0], glyphs[n >> 1], glyphs[n - 1]
  {
    const fs = w > 0.5 ? b : a, fn = T[fs + 23] >= 8 ? T[fs + 23] - 8 : T[fs + 23];
    const i1 = fn >> 1, i2 = fn - 1;
    const p0 = T[fs + 24] | 0, p1 = T[fs + 24 + (i1 >> 1)] | 0, p2 = T[fs + 24 + (i2 >> 1)] | 0;
    q[18] = p0 & 127; q[19] = i1 & 1 ? p1 >> 7 : p1 & 127; q[20] = i2 & 1 ? p2 >> 7 : p2 & 127;
  }
  // accents of the winning side: present when hash(cell, 40 + i) < d * cluster term * (1 - ss(0.6 maxDist, maxDist, t)) * dither fade
  for (let i = 0; i < 2; i++) {
    const d = i === 0 ? T[s + 36] : T[s + 39];
    if (!(d > 0)) continue;
    const cl = i === 0 ? T[s + 37] : T[s + 40], md = i === 0 ? T[s + 38] : T[s + 41];
    let tf = (q[3] - 0.6 * md) / (0.4 * md); tf = tf < 0 ? 0 : tf > 1 ? 1 : tf;
    let pt = (tone - 0.4) * 2.5; pt = pt < 0 ? 0 : pt > 1 ? 1 : pt; // patch: dense where the tone is high
    const pr = d * ((1 - cl) + cl * 2 * pt * pt * (3 - 2 * pt)) * (1 - tf * tf * (3 - 2 * tf)) * dith;
    if (hashFast24(cx, cy, 40 + i) * (1 / 16777216) < pr) {
      const r = s + 28 + i * 4;
      q[7] = T[r]; q[8] = T[r + 1]; q[9] = T[r + 2]; code = T[r + 3] | 0;
      break;
    }
  }
  q[6] = tone; q[13] = code;
  return q;
}
