// OB-073 D2b: JS reference trace of the grass carpet (architecture.md 38.52). Pure Node, no world needed:
// the class map is an in-test fixture with the 38.52 data shape (D2a builds the real one).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groundFootprint, hashFast24 } from './terrainShade.js';
import { NMAX, makeCarpetCtx, makeCarpetHit, traceCarpet, traceCarpetIn, loadInput, traceCarpetBrute, bladeAtCell } from './carpet.js';

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
      if (out.z - g < -1e-9 || out.z - g > b[2] + 1e-9 || out.variant !== b[3]) bad++; // TUFT-01a: h01 is the stroke fraction; z must sit inside the tuft
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
      // OB-103: exclude the radius ramp (the footprint fade is gone)
      const rr = tA * Math.hypot(d[0], d[1]) / 12;
      if (rr > ctx.fadeStart * 0.9) { front++; continue; }
      total++; if (hA) hitsA++;
      if (hA !== hB) diff++;
    }
    return { total, hitsA, front, frac: diff / total };
  };
  const big = measure(0.1), small = measure(0.001);
  console.log(`  (info) AC2 shift 0.1 m: ${big.total} cells (front excluded ${big.front}), ${big.hitsA} carpet hits, ${(100 * big.frac).toFixed(1)} % flipped (true parallax, info only)`);
  check(small.hitsA > 100 && small.frac < 0.04, `AC2a eye shift 0.001 m (sub-cell): ${(100 * small.frac).toFixed(2)} % of ${small.total} cells flipped (< 4 %; OB-101: was 2 % when only rays <= 24 steps drew, now 5-6 m thin blades alias a little more)`);
  // AC2b: at pose B every DDA hit == brute-force hit (same lattice id), and no blade is re-rolled (hit identity == its lattice identity)
  const B = [-5, -4.1, 1.6], ref = makeCarpetHit(), bb = new Float64Array(4);
  let n = 0, same = 0, hitsB = 0, reroll = 0;
  for (let cy = 1; cy < ROWS; cy += 5) for (let cx = 3; cx < COLS; cx += 5) { // OB-096: stride 5 (narrower blades: fewer hits per sample)
    ray(cx, cy, d); const t = terrainT(B, d);
    const h1 = traceCarpet(B, d, t, ctx, 0, out), h2 = traceCarpetBrute(B, d, t, ctx, 0, ref);
    n++; if (h1) hitsB++;
    if (h1 === h2 && (!h1 || (out.ix === ref.ix && out.iy === ref.iy))) same++;
    if (h1) { bladeAtCell(ctx, out.ix, out.iy, bb); { const zz = out.z - groundZ(bb[0], bb[1]); if (out.variant !== bb[3] || zz < -1e-9 || zz > bb[2] + 1e-9) reroll++; } }
  }
  check(hitsB > 20 && same === n && reroll === 0, `AC2b eye shift 0.1 m: DDA == brute at the new pose on ${same}/${n} sampled rays (${hitsB} hits), ${reroll} re-rolled blades`);
}

// ---- AC3 + AC4: no hit past dXY > radius (OB-103b: the dead fp > 2w check is gone, the fade is density-based now); never a partial trace past NMAX
{
  const ctx = mk(6), out = makeCarpetHit(), d = [0, 0, 0], e = [0, 0, 0], r = rng(3);
  let hits = 0, badR = 0, badSteps = 0, over = 0;
  for (let n = 0; n < 20000; n++) {
    e[0] = -6 + r() * 12; e[1] = 3 + r() * 4; e[2] = 0.8 + r() * 1.2;
    dirOf(r() * 360, -90 + r() * 88, d);
    const t = terrainT(e, d);
    const h = traceCarpet(e, d, t, ctx, 0, out);
    if (out.steps > NMAX) { over++; if (h) badSteps++; }
    if (!h) continue;
    hits++;
    if (out.t * Math.hypot(d[0], d[1]) > ctx.radiusM) badR++;
    if (out.steps > NMAX) badSteps++;
  }
  check(hits > 100 && badR === 0, `AC3 ${hits} hits, ${badR} beyond radiusM`);
}

// ---- OB-101: eye 1.7 m over flat meadow with a ~2 m tall-straw layer bound: blades must show at 3 / 6 / 9 m, not only the first 2 m
{
  const FW = 20, FH = 20, fm = new Uint8Array(FW * FH).fill(1);
  const fcfg = { seed: 7, radiusM: 12, variants: [
    { name: 'meadow', ground: ['grass'], density: 0.75, heightM: [0.15, 0.4], ramp: ['a', 'b'] },
    { name: 'straw', ground: ['grass'], density: 0.75, heightM: [0.4, 0.9], bladeW: 0.05, ramp: ['a', 'b'] }] };
  const flat = (q) => { q[2] = 0; };
  const ctx = makeCarpetCtx({ cfg: fcfg, classMap: fm, x0: -20, y0: -20, w: FW, h: FH }, flat, null);
  ctx.fpK = -1 / 240; // a 240-column view
  const out = makeCarpetHit(), ref = makeCarpetHit(), e = [0, 0, 1.7], d = [0, 0, 0], r = rng(5);
  { // a grazing ray over dense meadow needs > NMAX steps: it is truncated and still hits the NEAREST blades (used to draw nothing)
    const g = [0, 0, 0], eg = [-8, -8, 0.2]; dirOf(40, -0.4, g);
    const tg = 0.2 / Math.sin(0.4 * Math.PI / 180), hxy = Math.hypot(g[0], g[1]);
    // TUFT-01a: cellM 0.35 needs only ~49 steps over the 12 m disc, so force fine cells here to exercise the truncation
    const gctx = makeCarpetCtx({ cfg: { ...fcfg, cellM: 0.05 }, classMap: fm, x0: -20, y0: -20, w: FW, h: FH }, flat, null);
    gctx.fpK = ctx.fpK;
    const hg = traceCarpet(eg, g, tg, gctx, 0, out);
    check(hg === 1 && out.steps > NMAX && out.t * hxy <= (NMAX + 3) * gctx.cellM * Math.SQRT2, `AC4 (OB-101) grazing ray: ${out.steps} steps > ${NMAX} -> hit at ${(out.t * hxy).toFixed(2)} m inside the walked cells`);
  }
  const rows = [];
  for (const D of [3, 6, 9]) {
    let hits = 0, hitsBrute = 0, n = 0, over = 0;
    for (let k = 0; k < 600; k++) {
      const gx = D + (r() - 0.5) * 0.4, gy = (r() - 0.5) * 4, dist = Math.hypot(gx, gy);
      const l = Math.hypot(dist, 1.7); d[0] = gx / l; d[1] = gy / l; d[2] = -1.7 / l;
      const t = l; n++;
      if (traceCarpet(e, d, t, ctx, 0, out)) hits++;
      if (out.steps > NMAX) over++;
      else if (traceCarpetBrute(e, d, t, ctx, 0, ref)) hitsBrute++;
    }
    rows.push({ D, hits, n, over, hitsBrute });
    check(hits / n > 0.15, `OB-101 flat meadow, eye 1.7 m, ground ${D} m: ${(100 * hits / n).toFixed(1)} % of ${n} rays hit (${over} walked > ${NMAX} steps; brute ${hitsBrute} on the others)`);
  }
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
    check(tSum / sSum <= (wind ? 3 : 2), `TUFT-01a: tests/cell mean ${(tSum / sSum).toFixed(2)} <= ${wind ? 3 : 2} (worst trace ${tWorst.toFixed(2)})`);
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

// D2e: ramp validation (once, in carpetCtxFor) names the variant and the triplet
{
  const { validateRamps } = await import('./carpet.js');
  let okPass = true; try { validateRamps({ variants: [{ ramp: [[0, 0, 0], [255, 255, 255]] }] }); } catch (e) { okPass = false; }
  let named = 0, total = 0;
  for (const bad of [[[0, 0, 0]], [[0, 0, 0], [1, 2]], [[0, 0, 0], [256, 0, 0]], [[0, 0, 0], [1.5, 0, 0]], [[0, 0, 0], ['a', 'b', 'c']], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]]) {
    total++; try { validateRamps({ variants: [{ ramp: [[1, 1, 1], [2, 2, 2]] }, { ramp: bad }] }); } catch (e) { if (/carpet\.variants\[1\]\.ramp/.test(e.message)) named++; }
  }
  check(okPass && named === total, `ramp validation: valid ramp passes, ${named}/${total} bad ramps throw naming carpet.variants[1].ramp`);
}


// ---- OB-096 (38.52 amendment): structure mask, near screen-width cap, tuft share, width variety
{
  const allOne = new Uint8Array(W * H).fill(1);
  const cf = (v) => ({ seed: 11, radiusM: 8, classJitterM: 0, variants: [{ name: 'a', ground: ['grass'], density: 1, heightM: [0.2, 0.2], ramp: ['a', 'b'], ...v }] });
  const flat0 = (q) => { q[2] = 0; };
  const mk1 = (v, cm) => makeCarpetCtx({ cfg: { ...cf(v), ...(v && v.tufts !== undefined ? { tufts: v.tufts } : {}) }, classMap: cm || allOne, x0: X0, y0: Y0, w: W, h: H }, flat0, null);
  // (a) a cleared class area: rays looking down from inside it hit nothing; the same rays over the full map do hit
  const cleared = allOne.slice();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const x = X0 + i * 2, y = Y0 + j * 2; if (x >= -6 && x < 6 && y >= -6 && y < 6) cleared[j * W + i] = 0; }
  const cA = mk1({}, cleared), cB = mk1({}), o1 = makeCarpetHit(), dd = [0, 0, 0], ee = [0, 0, 0.4], rr = rng(3);
  let hitsC = 0, hitsF = 0;
  for (let n = 0; n < 4000; n++) {
    ee[0] = -3 + rr() * 6; ee[1] = -3 + rr() * 6; dirOf(rr() * 360, -90 + rr() * 20, dd); // short steep rays: they end inside the cleared 12 m square
    const t = 0.4 / -dd[2];
    if (traceCarpet(ee, dd, t, cA, 0, o1)) hitsC++;
    if (traceCarpet(ee, dd, t, cB, 0, o1)) hitsF++;
  }
  check(hitsC === 0 && hitsF > 20, `OB-096a: ${hitsC} hits inside a cleared class area (full map: ${hitsF})`);
  // (b) near blade (0.6 m): hit width <= WMAX_CELLS * 0.5 * fp, far blade keeps its true width
  // rays along -y: |ex - rootX| of every hit blade (axis vertical, no wind) is its lateral reach; it must stay <= 1.25 * 0.5 * fp(t) (true half-width >= 0.175)
  const cW = mk1({ bladeW: 0.5, heightM: [0.3, 0.3], tufts: false }) /* blade-mode regression (the WGSL twin) */, bb2 = new Float64Array(4), oh = makeCarpetHit(), ew = [0, 0, 0.1], dw = [0, -1, 0];
  cW.fpK = 0.05; // fixed footprint 0.05 m -> cap 0.03125 m, far below the true half-width
  let nearBad = 0, nearN = 0, ratioMax = 0;
  for (let n = 0; n < 20000; n++) {
    ew[0] = -8 + rr() * 8; ew[1] = 3.6;
    if (traceCarpet(ew, dw, 2, cW, 0, oh)) { // tHit 2 m: <= NMAX lattice steps
      bladeAtCell(cW, oh.ix, oh.iy, bb2); nearN++;
      const cap = 1.25 * 0.5 * groundFootprint(oh.t, cW.fpK), reach = Math.abs(ew[0] - bb2[0]);
      if (reach > cap + 1e-6) nearBad++; if (reach / cap > ratioMax) ratioMax = reach / cap;
    }
  }
  check(nearN > 500 && nearBad === 0 && ratioMax > 0.8, `OB-096b: ${nearN} near hits, ${nearBad} wider than 1.25 footprints (max reach/cap ${ratioMax.toFixed(2)}; uncapped half-width would be >= 0.175 m)`);
  // (c) tuft share ~6 % over 10k lattice cells (heights 0.2 * patch 0.75..1.25: plain <= 0.25, tuft >= 0.27) and width variety 0.7..1.3
  const cT = mk1({}), ob = new Float64Array(4);
  let tall = 0, N10 = 0;
  for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) { bladeAtCell(cT, i - 50, j - 50, ob); N10++; if (ob[2] > 0.26) tall++; }
  check(Math.abs(100 * tall / N10 - 6) <= 1.2, `OB-096c: tuft share ${(100 * tall / N10).toFixed(2)} % of ${N10} cells (6 +- 1.2)`);
  check(cT.maxH >= 0.2 * 1.25 * 1.8 - 1e-9 && cT.wMax >= 0.03 * 1.3 - 1e-9, `OB-096c: maxH ${cT.maxH.toFixed(3)} / wMax ${cT.wMax.toFixed(4)} include tuftMul and the 1.3 width factor`);
  const cN = mk1({ tuft: { p: 0, mul: 1 } });
  let tall0 = 0; for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) { bladeAtCell(cN, i - 50, j - 50, ob); if (ob[2] > 0.26) tall0++; }
  check(tall0 === 0, 'OB-096c: tuft {p:0} gives no tall blade');
}

// ---- TUFT-01a (38.52 amendment, tuft atlas): per-stroke width cap, masked root, determinism, calm frames
{
  const allOne = new Uint8Array(W * H).fill(1);
  const flat0 = (q) => { q[2] = 0; };
  const cfT = { seed: 11, radiusM: 8, classJitterM: 0, variants: [{ name: 'a', ground: ['grass'], density: 1, heightM: [0.3, 0.3], bladeW: 0.5, ramp: ['a', 'b'] }] };
  const mkT = (c, mask) => makeCarpetCtx({ cfg: c, classMap: allOne, x0: X0, y0: Y0, w: W, h: H, mask }, flat0, null);
  // (a) near tuft (t = 0.5 m): the hit run across one stroke is <= 1.25 footprints. Rays run along plane 1's normal (so plane 2 is parallel
  // and skipped), swept across the tuft along the plane tangent at a fixed height.
  const cT = mkT(cfT); cT.fpK = 0.01;
  const ob = new Float64Array(4), oh = makeCarpetHit(), eT = [0, 0, 0], dT = [0, 0, 0];
  const step = 0.0005, fpM = 0.01, texM = 2 * cT.tuftR * cT.cellM * 1.3 / cT.atlas.w; // the cap decides by texel centre: the hit is quantised to whole texels (19.7 mm at R 0.157 m); near fp < texel => 1 texel per stroke
  // NOTE (01b): a sub-texel cap needs a sign/offset bit in the atlas g byte; the spec formula is implemented as written
  let runs = 0, worst = 0, tuftsHit = 0; const widths = [];
  for (let n = 0; n < 40; n++) {
    const ix = n * 3 - 60, iy = 5 + (n % 7);
    bladeAtCell(cT, ix, iy, ob);
    const ang = (hashFast24(ix, iy, cT.seed + 113) / 16777216) * Math.PI, cs = Math.cos(ang), sn = Math.sin(ang);
    dT[0] = cs; dT[1] = sn; dT[2] = 0;
    let run = 0, any = 0;
    for (let sx = -0.3; sx <= 0.3; sx += step) {
      eT[0] = ob[0] - cs * 0.5 - sn * sx; eT[1] = ob[1] - sn * 0.5 + cs * sx; eT[2] = 0.1;
      const hit = traceCarpet(eT, dT, 2, cT, 0, oh) === 1 && oh.ix === ix && oh.iy === iy;
      if (hit) { run++; any = 1; if (run * step > worst) worst = run * step; } else if (run > 0) { runs++; widths.push(run * step); run = 0; }
    }
    tuftsHit += any;
  }
  widths.sort((a, b) => a - b);
  const med = widths[widths.length >> 1], p90 = widths[Math.floor(widths.length * 0.9)];
  // single strokes are capped at 1.25 fp; strokes that touch at the fanned base merge into one run (reported, bounded by 3 strokes)
  console.log(`  (info) TUFT-01a width: median ${(med * 1000).toFixed(1)} mm, p90 ${(p90 * 1000).toFixed(1)} mm, widest ${(worst * 1000).toFixed(1)} mm (fp ${fpM * 1000} mm)`);
  check(tuftsHit >= 30 && runs > 40 && med <= Math.max(1.25 * fpM, texM) + 2 * step && p90 <= 3 * Math.max(1.25 * fpM, texM) + 2 * step, `TUFT-01a width: ${tuftsHit}/40 tufts hit, ${runs} stroke runs, median ${(med * 1000).toFixed(1)} mm <= max(1.25 fp, 1 texel = ${(texM * 1000).toFixed(1)} mm), p90 <= 3`);
  // (b) masked root: a mask of 0 over the whole window -> no tuft at all; a half mask scales the height, never above the unmasked one
  const zero = { data: new Uint8Array(64 * 64), x0: -16, y0: -16, w: 64, h: 64, cellM: 0.5 };
  const cZ = mkT(cfT, zero), cN = mkT(cfT), rr = rng(21), eM = [0, 0, 0.5], dM = [0, 0, 0];
  let hz = 0, hn = 0;
  for (let n = 0; n < 6000; n++) {
    eM[0] = -4 + rr() * 8; eM[1] = -4 + rr() * 8; dirOf(rr() * 360, -90 + rr() * 30, dM);
    const t = 0.5 / -dM[2];
    if (traceCarpet(eM, dM, t, cZ, 0, oh)) hz++;
    if (traceCarpet(eM, dM, t, cN, 0, oh)) hn++;
  }
  check(hz === 0 && hn > 100, `TUFT-01a mask: ${hz} hits with an all-zero mask (unmasked ${hn})`);
  // (c) determinism + calm frames bit-identical: two fresh contexts, different clock times, same output
  const cD1 = mkT(cfT), cD2 = mkT(cfT), o1 = makeCarpetHit(), o2 = makeCarpetHit();
  let diff = 0, hD = 0;
  for (let n = 0; n < 12000; n++) {
    eM[0] = -4 + rr() * 8; eM[1] = -4 + rr() * 8; dirOf(rr() * 360, -90 + rr() * 30, dM);
    const t = 0.5 / -dM[2], a = traceCarpet(eM, dM, t, cD1, 0, o1), b = traceCarpet(eM, dM, t, cD2, n * 0.016, o2);
    if (a) hD++;
    if (a !== b || (a && (o1.t !== o2.t || o1.h01 !== o2.h01 || o1.ix !== o2.ix || o1.iy !== o2.iy || o1.z !== o2.z || o1.lean !== o2.lean))) diff++;
  }
  check(hD > 100 && diff === 0, `TUFT-01a determinism: ${hD} hits, ${diff} differences between fresh contexts / frame times (calm)`);
  // (d) the stroke fraction is a real height fraction: r codes run 0..1 along the tuft
  let lo = 1, hi = 0;
  for (let n = 0; n < 6000; n++) {
    eM[0] = -4 + rr() * 8; eM[1] = -4 + rr() * 8; dirOf(rr() * 360, -60 + rr() * 50, dM);
    if (traceCarpet(eM, dM, 0.5 / -dM[2], cD1, 0, o1)) { if (o1.h01 < lo) lo = o1.h01; if (o1.h01 > hi) hi = o1.h01; }
  }
  check(lo >= 0 && hi <= 1 && lo < 0.2 && hi > 0.8, `TUFT-01a h01 range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
}

// RE-PINNED OB-103: fade model changed (footprint fade removed, min stroke width + LOD cut, radius fade from fadeStart). Before: GOLD_CALM [1340636530, 3523949449, 1144344956], GOLD_WIND [3165381766, 2244530883, 2258403597].
const GOLD_CALM = [2579676716, 973560348, 1751570053], GOLD_WIND = [1849014812, 4292197613, 743443586];
// ---- TUFT-PERF-01b golden: FNV hash of (hit, t bits, ix, iy) over the AC2 240x90 grid (poses A + B), the OB-101 flat field and the AC5 random rays, calm + wind.
// Pinned from the code BEFORE the exact culls (maxHNear / tFade / ascending clip / leanMaxR); every cull must leave it unchanged.
{
  const fb = new Float64Array(1), fu = new Uint32Array(fb.buffer);
  let H = 0;
  const mix = (v) => { H = Math.imul(H ^ (v | 0), 16777619) >>> 0; };
  const mixHit = (h, o) => { mix(h ? 1 : 0); if (h) { fb[0] = o.t; mix(fu[0]); mix(fu[1]); mix(o.ix); mix(o.iy); } };
  const goldenSets = (wind) => {
    const res = [];
    { // AC2 grid
      const ctx = mk(12, wind), out = makeCarpetHit(), d = [0, 0, 0];
      if (wind) ctx.windMax = 2; ctx.fpK = -1 / 240; H = 2166136261;
      const COLS = 240, ROWS = 90, tanH = Math.tan(35 * Math.PI / 180), tanV = tanH * ROWS / COLS * 2;
      for (const shift of [0, 0.1]) {
        const A = [-5, -4 + shift, 1.6];
        for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
          const px = (cx + 0.5) / COLS * 2 - 1, py = 1 - (cy + 0.5) / ROWS * 2;
          const x = Math.cos(0.38) + Math.sin(0.38) * py * tanV, y = -px * tanH, z = -Math.sin(0.38) + Math.cos(0.38) * py * tanV, l = Math.hypot(x, y, z);
          d[0] = x / l; d[1] = y / l; d[2] = z / l;
          mixHit(traceCarpet(A, d, terrainT(A, d), ctx, 0, out), out);
        }
      }
      res.push(H);
    }
    { // OB-101 flat field, eye 1.7 m
      const fm = new Uint8Array(400).fill(1), flat = (q) => { q[2] = 0; };
      const fcfg = { seed: 7, radiusM: 12, variants: [
        { name: 'meadow', ground: ['grass'], density: 0.75, heightM: [0.15, 0.4], ramp: ['a', 'b'] },
        { name: 'straw', ground: ['grass'], density: 0.75, heightM: [0.4, 0.9], bladeW: 0.05, ramp: ['a', 'b'] }] };
      const ctx = makeCarpetCtx({ cfg: fcfg, classMap: fm, x0: -20, y0: -20, w: 20, h: 20 }, flat, wind || null);
      if (wind) ctx.windMax = 2; ctx.fpK = -1 / 240; H = 2166136261;
      const out = makeCarpetHit(), e = [0, 0, 1.7], d = [0, 0, 0], r = rng(5);
      for (const D of [3, 6, 9, 12]) for (let k = 0; k < 600; k++) {
        const gx = D + (r() - 0.5) * 0.4, gy = (r() - 0.5) * 4, l = Math.hypot(Math.hypot(gx, gy), 1.7);
        d[0] = gx / l; d[1] = gy / l; d[2] = -1.7 / l;
        mixHit(traceCarpet(e, d, l, ctx, 0, out), out);
      }
      // ascending rays (trees / hills) and a high eye
      for (let k = 0; k < 600; k++) { e[2] = 1.7 + (k % 3); dirOf(r() * 360, -10 + r() * 40, d); mixHit(traceCarpet(e, d, 3 + r() * 30, ctx, 0, out), out); }
      res.push(H);
    }
    { // AC5 random rays
      const ctx = mk(2.5, wind), out = makeCarpetHit(), d = [0, 0, 0], e = [0, 0, 0], rA = rng(11);
      if (wind) ctx.windMax = 2; H = 2166136261;
      for (let n = 0; n < 10000; n++) {
        e[0] = -8 + rA() * 14; e[1] = 3 + rA() * 3; e[2] = 0.5 + rA() * 0.6; rA(); rA();
        dirOf(rA() * 360, -90 + rA() * 75, d);
        mixHit(traceCarpet(e, d, terrainT(e, d), ctx, n * 0.01, out), out);
      }
      res.push(H);
    }
    return res;
  };
  const GOLD = { calm: GOLD_CALM, wind: GOLD_WIND };
  const got = { calm: goldenSets(null), wind: goldenSets(windOf(1.6, 1.2)) };
  if (GOLD.calm === null) console.log('GOLDEN ' + JSON.stringify(got));
  else for (const k of ['calm', 'wind']) check(JSON.stringify(got[k]) === JSON.stringify(GOLD[k]), `TUFT-PERF-01b golden hash ${k} (AC2 grid / OB-101 field / AC5 rays) ${got[k].join(' ')}`);
}

if (fails) { console.log(`carpet.test: ${fails} FAILED`); process.exit(1); }
console.log('carpet.test: all passed');

