// OB-073 D2b: JS reference trace of the grass carpet (architecture.md 38.52). Pure Node, no world needed:
// the class map is an in-test fixture with the 38.52 data shape (D2a builds the real one).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groundFootprint } from './terrainShade.js';
import { NMAX, makeCarpetCtx, makeCarpetHit, traceCarpet, traceCarpetIn, loadInput, traceCarpetBrute, bladeAtCell, FADE_FP0, FADE_FP1, FADE_R0 } from './carpet.js';

// AC6 needs gc(): re-spawn once with --expose-gc
if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---- fixture: 40 m x 40 m class map (2 m cells): west = meadow(1), east = straw(2), a path strip (0) at y in [-1,1]
const W = 20, H = 20, X0 = -20, Y0 = -20;
const classMap = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const y = Y0 + j * 2 + 1;
  classMap[j * W + i] = Math.abs(y) < 1 ? 0 : (i < 10 ? 1 : 2);
}
const cfg = (radiusM) => ({ seed: 7, radiusM, variants: [
  { name: 'meadow', ground: ['grass'], density: 0.9, heightM: [0.10, 0.22], ramp: ['a', 'b'] },
  { name: 'straw', ground: ['grassTall'], density: 0.8, heightM: [0.35, 0.55], bladeW: 0.07, ramp: ['a', 'b'] },
] });
const groundZ = (x, y) => 0.03 * Math.sin(x * 0.3) + 0.02 * y;
const windOf = (mx, my) => (q) => { q[3] = mx; q[4] = my; };
const groundQ = (q) => { q[2] = 0.03 * Math.sin(q[0] * 0.3) + 0.02 * q[1]; }; // same as groundZ, inlined: a call with double args would box (test-side alloc)
const mk = (radiusM, wind) => makeCarpetCtx({ cfg: cfg(radiusM), classMap, x0: X0, y0: Y0, w: W, h: H }, groundQ, wind || null);

/** terrain hit distance by marching + bisection */
function terrainT(e, d) {
  let t = 0.02, prev = 0;
  for (; t < 40; prev = t, t += 0.04) {
    if (e[2] + d[2] * t < groundZ(e[0] + d[0] * t, e[1] + d[1] * t)) {
      let a = prev, b = t;
      for (let k = 0; k < 24; k++) { const m = 0.5 * (a + b); if (e[2] + d[2] * m < groundZ(e[0] + d[0] * m, e[1] + d[1] * m)) b = m; else a = m; }
      return 0.5 * (a + b);
    }
  }
  return Infinity;
}
function dirOf(yawDeg, pitchDeg, out) {
  const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
  out[0] = Math.cos(p) * Math.cos(y); out[1] = Math.cos(p) * Math.sin(y); out[2] = Math.sin(p);
  return out;
}

// ---- AC6: zero allocation over 10k traces (calm and windy). Runs first: the other sections feed the JIT other shapes.
{
  for (const wind of [null, windOf(2, 1)]) {
    const ctx = mk(6, wind), out = makeCarpetHit(), d = [0, 0, 0], e = [-3, 3, 1.5], r = rng(9);
    const rays = [], ts = new Float64Array(10000);
    for (let n = 0; n < 10000; n++) { const v = [0, 0, 0]; dirOf(r() * 360, -90 + r() * 70, v); rays.push(v); ts[rays.length - 1] = terrainT(e, v); }
    const inp = ctx.inp;
    const run = (tm) => { for (let n = 0; n < 10000; n++) { const v = rays[n]; inp[0] = e[0]; inp[1] = e[1]; inp[2] = e[2]; inp[3] = v[0]; inp[4] = v[1]; inp[5] = v[2]; inp[6] = ts[n]; inp[7] = tm; traceCarpetIn(ctx, out); } };
    for (let w = 0; w < 6; w++) run(w); // JIT warm-up
    global.gc();
    const h0 = process.memoryUsage().heapUsed;
    run(0.5); run(0.7); run(0.9); // 30k traces: the fixed cost of memoryUsage() itself (~90 kB) is spread out
    const dh = process.memoryUsage().heapUsed - h0;
    console.log(`  (info) AC6 ${wind ? 'wind' : 'calm'}: ${(dh / 30000).toFixed(1)} B/trace over 30k traces (target < 8)`);
    check(dh < 8 * 30000, `AC6 ${wind ? 'wind' : 'calm'}: < 8 B/trace (2-variant sloped fixture)`);
  }
}

// ---- AC1: world-anchored (same cell = same root/height/variant for any eye)
{
  const ctx = mk(6), out = makeCarpetHit(), d = [0, 0, 0], e = [0, 0, 0], r = rng(1), b = new Float64Array(4);
  const seen = new Map();
  let hits = 0, bad = 0, mism = 0;
  for (let k = 0; k < 50; k++) {
    e[0] = -4 + r() * 8; e[1] = 2 + r() * 3; e[2] = 1.4 + r() * 0.4;
    for (let n = 0; n < 200; n++) {
      dirOf(r() * 360, -90 + r() * 70, d);
      const t = terrainT(e, d);
      if (!traceCarpet(e, d, t, ctx, 0, out)) continue;
      hits++;
      bladeAtCell(ctx, out.ix, out.iy, b);
      const g = groundZ(b[0], b[1]);
      if (Math.abs(out.h01 * b[2] - (out.z - g)) > 1e-6 || out.variant !== b[3]) bad++;
      const key = out.ix + ',' + out.iy, sig = b[0] + ',' + b[2] + ',' + b[3];
      if (seen.has(key) && seen.get(key) !== sig) mism++;
      seen.set(key, sig);
    }
  }
  check(hits > 200 && bad === 0 && mism === 0, `AC1 world-anchored: ${hits} hits from 50 eyes, ${bad} inconsistent, ${mism} changed identity`);
}

// ---- AC2: eye shift, wind 0, synthetic 240x90 view at k = 1/240 m per m
{
  const ctx = mk(12), out = makeCarpetHit(), d = [0, 0, 0];
  ctx.fpK = -1 / 240;
  const COLS = 240, ROWS = 90, tanH = Math.tan(35 * Math.PI / 180), tanV = tanH * ROWS / COLS * 2;
  const ray = (cx, cy, o) => { // camera looks +x, pitch -22 deg
    const px = (cx + 0.5) / COLS * 2 - 1, py = 1 - (cy + 0.5) / ROWS * 2;
    const f = [Math.cos(0.38), 0, -Math.sin(0.38)], rt = [0, -1, 0], up = [Math.sin(0.38), 0, Math.cos(0.38)];
    const x = f[0] + rt[0] * px * tanH + up[0] * py * tanV, y = f[1] + rt[1] * px * tanH + up[1] * py * tanV, z = f[2] + rt[2] * px * tanH + up[2] * py * tanV;
    const l = Math.hypot(x, y, z); o[0] = x / l; o[1] = y / l; o[2] = z / l;
  };
  const measure = (shift) => {
    const A = [-5, -4, 1.6], B = [-5, -4 + shift, 1.6];
    let diff = 0, total = 0, hitsA = 0, front = 0;
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
      ray(cx, cy, d); const tA = terrainT(A, d); const hA = traceCarpet(A, d, tA, ctx, 0, out);
      const tB = terrainT(B, d); const hB = traceCarpet(B, d, tB, ctx, 0, out);
      if (!(tA < Infinity)) continue;
      // exclude the fade front (widest blade 0.07 m) and the radius ramp
      const q = groundFootprint(tA, ctx.fpK) / 0.07, rr = tA * Math.hypot(d[0], d[1]) / 12;
      if ((q > FADE_FP0 * 0.7 && q < FADE_FP1 * 1.3) || rr > FADE_R0 * 0.9) { front++; continue; }
      total++; if (hA) hitsA++;
      if (hA !== hB) diff++;
    }
    return { total, hitsA, front, frac: diff / total };
  };
  const big = measure(0.1), small = measure(0.001);
  console.log(`  (info) AC2 shift 0.1 m: ${big.total} cells (front excluded ${big.front}), ${big.hitsA} carpet hits, ${(100 * big.frac).toFixed(1)} % flipped (true parallax, info only)`);
  check(small.hitsA > 100 && small.frac < 0.02, `AC2a eye shift 0.001 m (sub-cell): ${(100 * small.frac).toFixed(2)} % of ${small.total} cells flipped (< 2 %)`);
  // AC2b: at pose B every DDA hit == brute-force hit (same lattice id), and no blade is re-rolled (hit identity == its lattice identity)
  const B = [-5, -4.1, 1.6], ref = makeCarpetHit(), bb = new Float64Array(4);
  let n = 0, same = 0, hitsB = 0, reroll = 0;
  for (let cy = 1; cy < ROWS; cy += 7) for (let cx = 3; cx < COLS; cx += 7) {
    ray(cx, cy, d); const t = terrainT(B, d);
    const h1 = traceCarpet(B, d, t, ctx, 0, out), h2 = traceCarpetBrute(B, d, t, ctx, 0, ref);
    n++; if (h1) hitsB++;
    if (h1 === h2 && (!h1 || (out.ix === ref.ix && out.iy === ref.iy))) same++;
    if (h1) { bladeAtCell(ctx, out.ix, out.iy, bb); if (out.variant !== bb[3] || Math.abs(out.h01 * bb[2] - (out.z - groundZ(bb[0], bb[1]))) > 1e-6) reroll++; }
  }
  check(hitsB > 20 && same === n && reroll === 0, `AC2b eye shift 0.1 m: DDA == brute at the new pose on ${same}/${n} sampled rays (${hitsB} hits), ${reroll} re-rolled blades`);
}

// ---- AC3 + AC4: no hit past fp > 2w or dXY > radius; never a partial trace past NMAX
{
  const ctx = mk(6), out = makeCarpetHit(), d = [0, 0, 0], e = [0, 0, 0], r = rng(3);
  let hits = 0, badFp = 0, badR = 0, badSteps = 0, over = 0;
  for (let n = 0; n < 20000; n++) {
    e[0] = -6 + r() * 12; e[1] = 3 + r() * 4; e[2] = 0.8 + r() * 1.2;
    dirOf(r() * 360, -90 + r() * 88, d);
    const t = terrainT(e, d);
    const h = traceCarpet(e, d, t, ctx, 0, out);
    if (out.steps > NMAX) { over++; if (h) badSteps++; }
    if (!h) continue;
    hits++;
    const w = ctx.bw[out.variant] * 0.5;
    if (groundFootprint(out.t) > 2 * w) badFp++;
    if (out.t * Math.hypot(d[0], d[1]) > ctx.radiusM) badR++;
    if (out.steps > NMAX) badSteps++;
  }
  check(hits > 100 && badFp === 0 && badR === 0, `AC3 ${hits} hits, ${badFp} with fp > 2w, ${badR} beyond radiusM`);
  check(over > 0 && badSteps === 0, `AC4 ${over} rays needed > ${NMAX} steps, ${badSteps} returned a (partial) hit`);
  // a grazing ray over dense meadow: far more than NMAX steps -> nothing, even though it passes through blades
  const g = [0, 0, 0]; dirOf(0, -2, g); const eg = [-8, -4, 0.3];
  const tg = terrainT(eg, g);
  check(traceCarpet(eg, g, tg, mk(30), 0, out) === 0 && out.steps > NMAX, `AC4 grazing ray: ${out.steps} steps -> no hit`);
}

// ---- AC5: DDA vs brute force over every lattice cell in the disc
{
  const rngA = rng(11);
  for (const [name, wind, tol] of [['wind 0', null, 0], ['wind 2 m/s', windOf(1.6, 1.2), 0.02]]) {
    const ctx = mk(2.5, wind), out = makeCarpetHit(), ref = makeCarpetHit(), d = [0, 0, 0], e = [0, 0, 0];
    let n = 0, agree = 0, hits = 0, tDiff = 0, tSum = 0, tWorst = 0, sSum = 0;
    for (; n < 10000; n++) {
      e[0] = -9 + rngA() * 4; e[1] = 3 + rngA() * 3; e[2] = 0.5 + rngA() * 0.6; // meadow/straw boundary near x -1.. left side is meadow; both ctx share the map
      e[0] = -8 + rngA() * 14;
      dirOf(rngA() * 360, -90 + rngA() * 75, d);
      const t = terrainT(e, d), tm = n * 0.01;
      const a = traceCarpet(e, d, t, ctx, tm, out), bb = traceCarpetBrute(e, d, t, ctx, tm, ref);
      if (a) hits++;
      if (out.steps > 0 && out.steps <= NMAX) { const pc = out.tests / out.steps; tSum += out.tests; sSum += out.steps; if (pc > tWorst) tWorst = pc; }
      if (a === bb && (!a || Math.abs(out.t - ref.t) < 1e-9)) agree++; else if (a && bb) tDiff++;
    }
    console.log(`  (info) AC5 ${name}: tests/cell mean ${(tSum / sSum).toFixed(2)}, worst trace ${tWorst.toFixed(2)} (3x3 undeduped = 9)`);
    check(hits > 300 && (n - agree) / n <= tol, `AC5 ${name}: ${hits} hits, DDA == brute on ${agree}/${n} rays (${tDiff} nearer-blade differences)`);
  }
}

// ---- wind: calm = no lean; wind leans downwind and stays within the cap
{
  const ctx0 = mk(6), ctx1 = mk(6, windOf(30, 0)), o0 = makeCarpetHit(), o1 = makeCarpetHit(), d = [0, 0, 0], e = [-3, 3, 1.5], r = rng(5);
  let leanMax = 0, calm = 0;
  for (let n = 0; n < 3000; n++) {
    dirOf(r() * 360, -90 + r() * 60, d);
    const t = terrainT(e, d);
    if (traceCarpet(e, d, t, ctx0, 1, o0) && o0.lean !== 0) calm++;
    if (traceCarpet(e, d, t, ctx1, 1, o1) && Math.abs(o1.lean) > leanMax) leanMax = Math.abs(o1.lean);
  }
  check(calm === 0 && leanMax > 0.1 && leanMax <= 1.0000001, `wind: calm lean 0 (${calm} violations); 30 m/s max |lean| ${leanMax.toFixed(3)} <= 1 (cap)`);
}

if (fails) { console.log(`carpet.test: ${fails} FAILED`); process.exit(1); }
console.log('carpet.test: all passed');
