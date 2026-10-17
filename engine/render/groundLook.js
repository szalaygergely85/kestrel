// ENV-02b (arch 38.63 points 2-3): per-biome ground look, JS twin. No design/ or game/ import: the game hands a plain config
// (game/js/look/groundLookConfig.js buildGroundLookConfig) to packLookTable(); shadeTerrain/shadeGrass read the packed Float32Array,
// so the f32 rounding is the same as the GPU table (ENV-02d WGSL twin). Look id 0 = today's ground (TLOOK path, untouched).
// Everything is keyed by WORLD cells (never a distance-sized or screen cell, 38.50); calm (wind01 = 0) output is time-independent.

// Perf (LOOK-TWIN-PERF): hashFast24(x, y, s) = mix24((imul(x, HX) ^ imul(y, HY)) ^ imul(s, HS)). XOR is associative, so the per-axis / per-salt
// products are hoisted out of the per-cell work (same bits as hashFast24; the dice and the 4 corners of an octave share them).
const HX = 0x27d4eb2d | 0, HY = 0x165667b1 | 0, HS = 0x9e3779b1 | 0;
const SALT_H = new Int32Array(100); for (let i = 0; i < 100; i++) SALT_H[i] = Math.imul(i, HS);
function mix24(h) {
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) >>> 8;
}
const INV24 = 1 / 16777216;

import { fogShapeCtx } from './fogShape.js'; // FD-06
export const LOOK_CELL_M = 0.25;
/** FD-06 (OB-198/208): world lattice (m) of the glyph/colour/accent dice while `aaAlt` is on. Single knob: 0.5 here = the 2x fallback. */
export const GROUND_ALT_M = 0.75;
const INV_CELL = 1 / LOOK_CELL_M, INV_CELL_ALT = 1 / GROUND_ALT_M; // FD-06          // fixed world lattice of the glyph / colour / accent hashes
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
 * Optional in q[21] = 1: skip outputs 15..20 (far grass off). Out (q): 6 tone 0..1, 7..9 fg rgb (linear 0..1, unlit, with the 0.94 + 0.12 h2 variation), 10..12 bg rgb, 13 glyph idx (ascii - 32),
 * 14 anim (1 = the glyph can change with the gust), 15..17 ramp(0.6) rgb (far-grass tint target), 18..20 far-grass glyphs (low / mid / high sg).
 * A look-0 side borrows the other side's look (w forced 0). One inlined body: helpers taking doubles would box per call.
 */
export function shadeLookCell(GL, lo, hi, q) {
  const T = GL.table, R = LOOK_ROWS * 4;
  const fu = q[0], fv = q[1], fp = q[2];
  let w = q[5];
  if (lo === 0 || hi === 0) { if (lo === 0) lo = hi; else hi = lo; w = 0; } else if (lo === hi) w = 0;
  // Perf: w === 0 (one look, the common case) -> x * 1 + y * 0 = x exactly (table values are finite), so every blend below drops its second side.
  const a = lo * R, b = hi * R, w0 = 1 - w, one = w === 0;
  const ns = one ? T[a + 3] : T[a + 3] * w0 + T[b + 3] * w, ms = one ? T[a + 7] : T[a + 7] * w0 + T[b + 7] * w, ct = one ? T[a + 11] : T[a + 11] * w0 + T[b + 11] * w;
  // tone: 3 value-noise octaves, each faded to its mean by 1 - ss(0.15 s, 0.5 s, fp) (s = octave wavelength)
  let nsum = 0;
  for (let o = 0; o < 3; o++) {
    const cell = o === 0 ? ns : o === 1 ? ns * (1 / LOOK_FINE2) : ms;
    let fd = (fp - 0.15 * cell) / (0.35 * cell); fd = fd < 0 ? 0 : fd > 1 ? 1 : fd;
    const wgt = LOOK_W[o] * (1 - fd * fd * (3 - 2 * fd));
    if (wgt <= 0) continue;
    const lx = fu / cell, ly = fv / cell, ix = Math.floor(lx), iy = Math.floor(ly), salt = LOOK_SALT + o;
    let wx = lx - ix, wy = ly - iy; wx = wx * wx * (3 - 2 * wx); wy = wy * wy * (3 - 2 * wy);
    const sh = SALT_H[salt], x0 = Math.imul(ix, HX), x1 = Math.imul(ix + 1, HX), y0 = Math.imul(iy, HY) ^ sh, y1 = Math.imul(iy + 1, HY) ^ sh;
    const ca = mix24(x0 ^ y0) * INV24, cb = mix24(x1 ^ y0) * INV24, cc = mix24(x0 ^ y1) * INV24, cd = mix24(x1 ^ y1) * INV24;
    nsum += wgt * ((ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy) * 2 - 1);
  }
  let tone = 0.5 + ct * nsum; tone = tone < 0 ? 0 : tone > 1 ? 1 : tone;
  // glyph / colour dice on the fixed world lattice, dither amplitude faded by footprint -> far glyphs depend on the smooth tone only
  const lci = fogShapeCtx.aaAlt ? INV_CELL_ALT : INV_CELL; // FD-06 (OB-198/208): 3x coarser glyph/colour dice lattice (fade unchanged) (twin: lkShade, fogView.w bit 8 = GROUND_ALT_BIT, set from aaAlt alone)
  const cx = Math.floor(fu * lci), cy = Math.floor(fv * lci);
  let df = (fp - 0.5 * LOOK_CELL_M) / (0.5 * LOOK_CELL_M); df = df < 0 ? 0 : df > 1 ? 1 : df;
  const dith = 1 - df * df * (3 - 2 * df);
  const dB = Math.imul(cx, HX) ^ Math.imul(cy, HY);
  const h1 = 0.5 + (mix24(dB ^ SALT_H[70]) * INV24 - 0.5) * dith;
  const h2 = 0.5 + (mix24(dB ^ SALT_H[71]) * INV24 - 0.5) * dith;
  const sel = !one && w > 0.5 + (mix24(dB ^ SALT_H[73]) * INV24 - 0.5) * dith ? hi : lo, s = sel * R; // h4 only matters when two looks blend (w > 0)
  const sv = T[s + 23], lean = sv >= 8, cnt = lean ? sv - 8 : sv;
  let gx = tone * 0.55 + h1 * 0.6 - 0.08; gx = gx < 0 ? 0 : gx > 1 ? 1 : gx;
  const gi = Math.floor(gx * cnt * 0.9999);
  const gv = T[s + 24 + (gi >> 1)] | 0;
  let code = gi & 1 ? gv >> 7 : gv & 127;
  // colour: piecewise-linear ramps mixed by w (a*(1-w) + b*w is symmetric under lo/hi swap at w = 0.5)
  const x3 = tone * 3; let i0 = x3 | 0; if (i0 > 2) i0 = 2;
  const rf = x3 - i0, vr = 0.94 + 0.12 * h2;
  const ampM = one ? T[a + 15] : T[a + 15] * w0 + T[b + 15] * w, sheenM = one ? T[a + 19] : T[a + 19] * w0 + T[b + 19] * w;
  // shimmer: wind01 = 0 skips the branch (calm = byte-identical every frame, no time term anywhere else)
  let kk = 0;
  const wind = GL.wind01;
  if (wind > 0 && ampM > 0) {
    const gxx = fu * (1 / LOOK_GUST_M) - q[4] * LOOK_GUST_SPEED * (0.5 + wind), gyy = fv * (1 / LOOK_GUST_M);
    const ix = Math.floor(gxx), iy = Math.floor(gyy);
    let wx = gxx - ix, wy = gyy - iy; wx = wx * wx * (3 - 2 * wx); wy = wy * wy * (3 - 2 * wy);
    const sh = SALT_H[90], x0 = Math.imul(ix, HX), x1 = Math.imul(ix + 1, HX), y0 = Math.imul(iy, HY) ^ sh, y1 = Math.imul(iy + 1, HY) ^ sh;
    const ca = mix24(x0 ^ y0) * INV24, cb = mix24(x1 ^ y0) * INV24, cc = mix24(x0 ^ y1) * INV24, cd = mix24(x1 ^ y1) * INV24;
    let gu = (ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy - 0.45) * (1 / 0.4); gu = gu < 0 ? 0 : gu > 1 ? 1 : gu;
    kk = ampM * wind * (gu * gu * (3 - 2 * gu));
    q[14] = lean ? 1 : 0;
    if (lean && kk > 0.15 + 0.6 * (0.5 + (mix24(dB ^ SALT_H[72]) * INV24 - 0.5) * dith)) { const lv = T[s + 26 + (gi >> 1)] | 0; code = gi & 1 ? lv >> 7 : lv & 127; }
  } else q[14] = 0;
  const sk = kk * sheenM, farOn = q[21] === 0; q[21] = 0; // q[21] = 1 (one-shot, reset here): the caller does not read the far-grass outputs 15..20 (perf; default 0 = all outputs)
  for (let c = 0; c < 3; c++) {
    const lc = T[a + i0 * 4 + c] + (T[a + i0 * 4 + 4 + c] - T[a + i0 * 4 + c]) * rf;
    const lb = T[a + 16 + c] + (T[a + 20 + c] - T[a + 16 + c]) * tone;
    let col, bgc;
    if (one) {
      col = lc * vr; bgc = lb;
      if (sk > 0) col += (T[a + 12 + c] - col) * sk;
    } else {
      const hc = T[b + i0 * 4 + c] + (T[b + i0 * 4 + 4 + c] - T[b + i0 * 4 + c]) * rf;
      col = (lc * w0 + hc * w) * vr;
      if (sk > 0) col += ((T[a + 12 + c] * w0 + T[b + 12 + c] * w) - col) * sk;
      bgc = lb * w0 + (T[b + 16 + c] + (T[b + 20 + c] - T[b + 16 + c]) * tone) * w;
    }
    q[7 + c] = col; q[10 + c] = bgc;
    // ramp(0.6): stops 1 -> 2 at 0.8
    if (farOn) q[15 + c] = (T[a + 4 + c] + (T[a + 8 + c] - T[a + 4 + c]) * 0.8) * w0 + (T[b + 4 + c] + (T[b + 8 + c] - T[b + 4 + c]) * 0.8) * w;
  }
  // far-grass glyphs of the winning side: glyphs[0], glyphs[n >> 1], glyphs[n - 1]
  if (farOn) {
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
    if (pr > 0 && mix24(dB ^ SALT_H[40 + i]) * INV24 < pr) {
      const r = s + 28 + i * 4;
      q[7] = T[r]; q[8] = T[r + 1]; q[9] = T[r + 2]; code = T[r + 3] | 0;
      break;
    }
  }
  q[6] = tone; q[13] = code;
  return q;
}

/* ENV-02d (38.63 step d): WGSL twin of shadeLookCell. Generated from the constants above (no look literals). Needs hashFast (HASH_FAST_WGSL)
 * and, in the host shader, the uniform block fields LOOK_BLOCK_FIELDS appended to ShadeU (`su.lookT` = packLookTable words as vec4s,
 * `su.lookP.x` = wind01). Same op order as the JS body; the look bytes arrive via GA.w of the terrain G-buffer (LOOK_GA_*), so the shade
 * pass needs no extra sampled texture (16 is the WebGPU default limit). Entry: lkShade(fu, fv, fp, t, timeSec, lo, hi, w) -> LookOut. */
export const LOOK_TABLE_WORDS = LOOK_MAX * LOOK_ROWS * 4;
/** Fields appended to the ShadeU block for look pipelines (defineUniformBlock field specs; plain data, no gpu import here). */
export const LOOK_BLOCK_FIELDS = Object.freeze([{ name: 'lookT', type: 'vec4', count: LOOK_MAX * LOOK_ROWS }, { name: 'lookP', type: 'vec4' }]);
/** GA.w of a terrain fragment (look pipelines only): lo | hi << 4 | round(w * 255) << 8; look off writes the old constant (aoD = 1e30). */
export const LOOK_GA_HI_SHIFT = 4, LOOK_GA_W_SHIFT = 8;
const F = (x) => x.toFixed(10), LKR = LOOK_ROWS * 4;
export const GROUND_LOOK_WGSL = `
struct LookOut { tone: f32, fr: f32, fg: f32, fb: f32, br: f32, bg: f32, bb: f32, code: i32, anim: f32, tr: f32, tg: f32, tb: f32, g0: i32, g1: i32, g2: i32 };
fn lkT(i: i32) -> f32 {
  let v = su.lookT[i >> 2u]; let c = i & 3;
  return select(select(select(v.x, v.y, c == 1), v.z, c == 2), v.w, c == 3);
}
fn lkOct(fu: f32, fv: f32, fp: f32, cell: f32, salt: i32, wgt0: f32) -> f32 {
  var fd = clamp((fp - 0.15 * cell) / (0.35 * cell), 0.0, 1.0);
  let wgt = wgt0 * (1.0 - fd * fd * (3.0 - 2.0 * fd));
  if (wgt <= 0.0) { return 0.0; }
  let lx = fu / cell; let ly = fv / cell; let x0 = floor(lx); let y0 = floor(ly);
  let ix = i32(x0); let iy = i32(y0);
  var wx = lx - x0; var wy = ly - y0;
  wx = wx * wx * (3.0 - 2.0 * wx); wy = wy * wy * (3.0 - 2.0 * wy);
  let ca = hashFast(ix, iy, salt); let cb = hashFast(ix + 1, iy, salt); let cc = hashFast(ix, iy + 1, salt); let cd = hashFast(ix + 1, iy + 1, salt);
  return wgt * ((ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy) * 2.0 - 1.0);
}
fn lkAccentHit(i: i32, s: i32, tone: f32, t: f32, dith: f32, cx: i32, cy: i32) -> bool {
  let d = lkT(s + 36 + i * 3);
  if (!(d > 0.0)) { return false; }
  let cl = lkT(s + 37 + i * 3); let md = lkT(s + 38 + i * 3);
  let tf = clamp((t - 0.6 * md) / (0.4 * md), 0.0, 1.0);
  let pt = clamp((tone - 0.4) * 2.5, 0.0, 1.0);
  let pr = d * ((1.0 - cl) + cl * 2.0 * pt * pt * (3.0 - 2.0 * pt)) * (1.0 - tf * tf * (3.0 - 2.0 * tf)) * dith;
  return hashFast(cx, cy, ${40} + i) < pr;
}
fn lkShade(fu: f32, fv: f32, fp: f32, t: f32, timeSec: f32, loIn: i32, hiIn: i32, wIn: f32) -> LookOut {
  var lo = loIn; var hi = hiIn; var w = wIn;
  if (lo == 0 || hi == 0) { if (lo == 0) { lo = hi; } else { hi = lo; } w = 0.0; } else if (lo == hi) { w = 0.0; }
  let a = lo * ${LKR}; let b = hi * ${LKR}; let w0 = 1.0 - w;
  let ns = lkT(a + 3) * w0 + lkT(b + 3) * w; let ms = lkT(a + 7) * w0 + lkT(b + 7) * w; let ct = lkT(a + 11) * w0 + lkT(b + 11) * w;
  var nsum = lkOct(fu, fv, fp, ns, ${LOOK_SALT}, ${F(LOOK_W[0])});
  nsum += lkOct(fu, fv, fp, ns * ${F(1 / LOOK_FINE2)}, ${LOOK_SALT + 1}, ${F(LOOK_W[1])});
  nsum += lkOct(fu, fv, fp, ms, ${LOOK_SALT + 2}, ${F(LOOK_W[2])});
  let tone = clamp(0.5 + ct * nsum, 0.0, 1.0);
  let lcm = select(${F(LOOK_CELL_M)}, ${F(GROUND_ALT_M)}, (u32(su.fogView.w + 0.5) & 8u) != 0u); // FD-06: twin of lcm in shadeLookCell
  let cx = i32(floor(fu * (1.0 / lcm))); let cy = i32(floor(fv * (1.0 / lcm)));
  let df = clamp((fp - ${F(0.5 * LOOK_CELL_M)}) / ${F(0.5 * LOOK_CELL_M)}, 0.0, 1.0);
  let dith = 1.0 - df * df * (3.0 - 2.0 * df);
  let h1 = 0.5 + (hashFast(cx, cy, 70) - 0.5) * dith;
  let h2 = 0.5 + (hashFast(cx, cy, 71) - 0.5) * dith;
  let h3 = 0.5 + (hashFast(cx, cy, 72) - 0.5) * dith;
  let h4 = 0.5 + (hashFast(cx, cy, 73) - 0.5) * dith;
  let s = select(lo, hi, w > h4) * ${LKR};
  let sv = lkT(s + 23); let lean = sv >= 8.0; let cnt = select(sv, sv - 8.0, lean);
  let gxx = clamp(tone * 0.55 + h1 * 0.6 - 0.08, 0.0, 1.0);
  let gi = i32(floor(gxx * cnt * 0.9999));
  let gv = i32(lkT(s + 24 + (gi >> 1u)));
  var code = select(gv & 127, gv >> 7u, (gi & 1) != 0);
  let x3 = tone * 3.0; let i0 = min(i32(x3), 2);
  let rf = x3 - f32(i0); let vr = 0.94 + 0.12 * h2;
  let ampM = lkT(a + 15) * w0 + lkT(b + 15) * w; let sheenM = lkT(a + 19) * w0 + lkT(b + 19) * w;
  var kk = 0.0; var anim = 0.0;
  let wind = su.lookP.x;
  if (wind > 0.0 && ampM > 0.0) {
    let gax = fu * ${F(1 / LOOK_GUST_M)} - timeSec * ${F(LOOK_GUST_SPEED)} * (0.5 + wind); let gay = fv * ${F(1 / LOOK_GUST_M)};
    let gx0 = floor(gax); let gy0 = floor(gay); let gix = i32(gx0); let giy = i32(gy0);
    var wx = gax - gx0; var wy = gay - gy0;
    wx = wx * wx * (3.0 - 2.0 * wx); wy = wy * wy * (3.0 - 2.0 * wy);
    let ca = hashFast(gix, giy, 90); let cb = hashFast(gix + 1, giy, 90); let cc = hashFast(gix, giy + 1, 90); let cd = hashFast(gix + 1, giy + 1, 90);
    let gu = clamp((ca + (cb - ca) * wx + (cc - ca) * wy + (ca - cb - cc + cd) * wx * wy - 0.45) * ${F(1 / 0.4)}, 0.0, 1.0);
    kk = ampM * wind * (gu * gu * (3.0 - 2.0 * gu));
    anim = select(0.0, 1.0, lean);
    if (lean && kk > 0.15 + 0.6 * h3) { let lv = i32(lkT(s + 26 + (gi >> 1u))); code = select(lv & 127, lv >> 7u, (gi & 1) != 0); }
  }
  let sk = kk * sheenM;
  var o: LookOut;
  let ia = a + i0 * 4; let ib = b + i0 * 4;
  var col0 = (lkT(ia) + (lkT(ia + 4) - lkT(ia)) * rf) * w0 + (lkT(ib) + (lkT(ib + 4) - lkT(ib)) * rf) * w;
  var col1 = (lkT(ia + 1) + (lkT(ia + 5) - lkT(ia + 1)) * rf) * w0 + (lkT(ib + 1) + (lkT(ib + 5) - lkT(ib + 1)) * rf) * w;
  var col2 = (lkT(ia + 2) + (lkT(ia + 6) - lkT(ia + 2)) * rf) * w0 + (lkT(ib + 2) + (lkT(ib + 6) - lkT(ib + 2)) * rf) * w;
  col0 *= vr; col1 *= vr; col2 *= vr;
  if (sk > 0.0) {
    col0 += ((lkT(a + 12) * w0 + lkT(b + 12) * w) - col0) * sk;
    col1 += ((lkT(a + 13) * w0 + lkT(b + 13) * w) - col1) * sk;
    col2 += ((lkT(a + 14) * w0 + lkT(b + 14) * w) - col2) * sk;
  }
  o.fr = col0; o.fg = col1; o.fb = col2;
  o.br = (lkT(a + 16) + (lkT(a + 20) - lkT(a + 16)) * tone) * w0 + (lkT(b + 16) + (lkT(b + 20) - lkT(b + 16)) * tone) * w;
  o.bg = (lkT(a + 17) + (lkT(a + 21) - lkT(a + 17)) * tone) * w0 + (lkT(b + 17) + (lkT(b + 21) - lkT(b + 17)) * tone) * w;
  o.bb = (lkT(a + 18) + (lkT(a + 22) - lkT(a + 18)) * tone) * w0 + (lkT(b + 18) + (lkT(b + 22) - lkT(b + 18)) * tone) * w;
  o.tr = (lkT(a + 4) + (lkT(a + 8) - lkT(a + 4)) * 0.8) * w0 + (lkT(b + 4) + (lkT(b + 8) - lkT(b + 4)) * 0.8) * w;
  o.tg = (lkT(a + 5) + (lkT(a + 9) - lkT(a + 5)) * 0.8) * w0 + (lkT(b + 5) + (lkT(b + 9) - lkT(b + 5)) * 0.8) * w;
  o.tb = (lkT(a + 6) + (lkT(a + 10) - lkT(a + 6)) * 0.8) * w0 + (lkT(b + 6) + (lkT(b + 10) - lkT(b + 6)) * 0.8) * w;
  let fs = select(a, b, w > 0.5); let fsv = lkT(fs + 23); let fcnt = i32(select(fsv, fsv - 8.0, fsv >= 8.0));
  let i1 = fcnt >> 1u; let i2 = fcnt - 1;
  let p0 = i32(lkT(fs + 24)); let p1 = i32(lkT(fs + 24 + (i1 >> 1u))); let p2 = i32(lkT(fs + 24 + (i2 >> 1u)));
  o.g0 = p0 & 127; o.g1 = select(p1 & 127, p1 >> 7u, (i1 & 1) != 0); o.g2 = select(p2 & 127, p2 >> 7u, (i2 & 1) != 0);
  var hit = -1;
  if (lkAccentHit(0, s, tone, t, dith, cx, cy)) { hit = 0; } else if (lkAccentHit(1, s, tone, t, dith, cx, cy)) { hit = 1; }
  if (hit >= 0) {
    let r = s + 28 + hit * 4;
    o.fr = lkT(r); o.fg = lkT(r + 1); o.fb = lkT(r + 2); code = i32(lkT(r + 3));
  }
  o.tone = tone; o.code = code; o.anim = anim;
  return o;
}
`;
