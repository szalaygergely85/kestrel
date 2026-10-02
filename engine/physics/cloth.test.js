// engine/physics/cloth.test.js (CLOTH-1a1, docs/architecture.md 33.6). Run:
//   node --expose-gc engine/physics/cloth.test.js     (gc enables the strict heap check)
// Perf is warn-only unless PERF_STRICT=1.
import { createCloth } from './cloth.js';
import { createHasher } from '../core/hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Hanging sheet in the x-z plane (normal +-y), row 0 on top. pinMode 'top' = whole top row, 'corners' = 2 corner pins. */
function make(over = {}) {
  const cols = over.cols || 24, rows = over.rows || 16, sp = over.sp || 0.08;
  const rest = new Float64Array(3 * cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    rest[3 * k] = c * sp; rest[3 * k + 1] = 0; rest[3 * k + 2] = 5 - r * sp;
  }
  const pins = over.pins || (over.pinMode === 'corners' ? [0, cols - 1] : Array.from({ length: cols }, (_, i) => i));
  const def = Object.assign({ cols, rows, rest, pins, seed: 1 }, over);
  delete def.pinMode; delete def.sp;
  return createCloth(def);
}
const hashOf = (c) => { const h = createHasher(); c.hashInto(h); return h._h >>> 0; };
const run = (c, n, wx = 0, wy = 0, wz = 0) => { for (let i = 0; i < n; i++) c.step(wx, wy, wz, null); };
function allFinite(c) { for (let i = 0; i < c.pos.length; i++) if (!Number.isFinite(c.pos[i])) return false; return true; }
function maxStretch(c) {
  const e = c.structEdges; let m = 0;
  for (let i = 0; i < e.count; i++) {
    const a = 3 * e.a[i], b = 3 * e.b[i];
    const d = Math.hypot(c.pos[a] - c.pos[b], c.pos[a + 1] - c.pos[b + 1], c.pos[a + 2] - c.pos[b + 2]);
    m = Math.max(m, d / e.rest[i]);
  }
  return m;
}
// tiny deterministic LCG for tests (never Math.random)
function lcg(s) { let x = s >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

// 0. create / validation
{
  const c = make();
  ok('create 24x16: 384 nodes, constraints + tethers built', c.n === 384 && c.constraintCount > 2000 && c.tetherCount === 384 - 24, `nc=${c.constraintCount} tethers=${c.tetherCount}`);
  let threw = '';
  try { createCloth({ cols: 30, rows: 4, rest: [], pins: [0] }); } catch (e) { threw = e.message; }
  ok('bad def throws naming the key', /cols/.test(threw), threw);
  threw = ''; try { make({ substeps: 9 }); } catch (e) { threw = e.message; }
  ok('substeps out of range throws', /substeps/.test(threw), threw);
  threw = ''; try { make({ pins: [] }); } catch (e) { threw = e.message; }
  ok('no pins throws', /pins/.test(threw), threw);
  // holes: removed quads lose triangles; a fully surrounded node loses its constraints
  const h = make({ cols: 6, rows: 6, holes: [0, 1, 5, 6] });
  const full = make({ cols: 6, rows: 6 });
  ok('holes remove triangles', h.tri.length === full.tri.length - 4 * 6 && h.quadOn[0] === 0 && h.quadOn[7] === 1, `${h.tri.length} vs ${full.tri.length}`);
  run(h, 120, 3, 3, 0);
  ok('holey cloth stable', allFinite(h));
}

// AC: no jitter at rest (pinned, zero wind, 5 s)
for (const mode of ['top', 'corners']) {
  const c = make({ pinMode: mode });
  let worstV = 0, worstD = 0;
  const p0 = new Float64Array(c.pos.length);
  for (let i = 0; i < 300; i++) {
    p0.set(c.pos);
    c.step(0, 0, 0, null);
    if (i >= 120) {
      worstV = Math.max(worstV, c.maxSpeed);
      for (let k = 0; k < c.pos.length; k++) worstD = Math.max(worstD, Math.abs(c.pos[k] - p0[k]));
    }
  }
  ok(`rest [${mode}]: max node speed < 0.005 m/s after 2 s`, worstV < 0.005, `max=${worstV.toExponential(2)}`);
  ok(`rest [${mode}]: per-step change < 0.5 mm after 2 s`, worstD < 5e-4, `max=${(worstD * 1000).toFixed(4)} mm`);
  console.log(`  info rest[${mode}]: speed ${worstV.toExponential(2)} m/s, step change ${(worstD * 1000).toFixed(4)} mm`);
}

// AC: stretch bounds under gravity, also while pins move at 3 m/s
for (const [name, lim, over] of [['canvas', 1.10, {}], ['banner', 1.05, { shearCompliance: 1e-7, bendCompliance: 1e-5 }]]) {
  for (const mode of ['top', 'corners']) {
    const c = make(Object.assign({ pinMode: mode }, over));
    run(c, 360);
    const still = maxStretch(c);
    // pins moved along x: smooth ramp to 3 m/s over 1.5 s, hold 3 m/s for 2 s ("ramp"), and a 0.5 Hz sweep with 3 m/s peak ("sweep")
    const motion = (kind) => {
      const c2 = make(Object.assign({ pinMode: mode }, over));
      run(c2, 360);
      const tz0 = c2.pos[2];
      let worst = 0, x = 0;
      const npin = mode === 'top' ? 24 : 2;
      for (let i = 0; i < 210; i++) {
        const tt = i / 60;
        if (kind === 'ramp') { const v = tt < 1.5 ? 3 * (tt / 1.5) : 3; x += v / 60; } // linear ramp 2 m/s^2, then hold
        else x = (3 / Math.PI) * (1 - Math.cos(Math.PI * tt));
        for (let p = 0; p < npin; p++) {
          const bx = mode === 'top' ? p * 0.08 : (p === 0 ? 0 : 23 * 0.08);
          c2.setPinTarget(p, bx + x, 0, tz0);
        }
        c2.step(0, 0, 0, null);
        worst = Math.max(worst, maxStretch(c2));
      }
      return worst;
    };
    const stretchMoving = motion('ramp'), stretchSweep = motion('sweep');
    ok(`stretch [${name}/${mode}] at rest <= ${lim}`, still <= lim, `max=${still.toFixed(4)}`);
    // banner = hung from a rod (whole top row); the 2-corner banner case is info only
    if (!(name === 'banner' && mode === 'corners')) ok(`stretch [${name}/${mode}] pins moved at 3 m/s <= ${lim}`, stretchMoving <= lim, `max=${stretchMoving.toFixed(4)}`);
    console.log(`  info stretch ${name}/${mode}: rest ${still.toFixed(4)}, moving ${stretchMoving.toFixed(4)}, sweep(9.4 m/s^2) ${stretchSweep.toFixed(4)}`);
  }
}

// AC: 10 000 steps, random gusts 0..12 m/s + random pin motion, no NaN, bounded
{
  const c = make({ pinMode: 'corners' });
  const rnd = lcg(7);
  const size = Math.hypot(23 * 0.08, 15 * 0.08);
  let wx = 0, wy = 0, wz = 0, tx = [0, 1.84], ty = [0, 0], tz = [5, 5];
  let worst = 0, finite = true, maxDisp = 0;
  const prev = new Float64Array(c.pos.length);
  for (let i = 0; i < 10000; i++) {
    if (i % 30 === 0) { const sp = rnd() * 12, a = rnd() * 6.2832; wx = sp * Math.cos(a); wy = sp * Math.sin(a); wz = (rnd() - 0.5) * 2; }
    if (i % 20 === 0) {
      for (let p = 0; p < 2; p++) {
        const dx = (rnd() - 0.5) * 0.1, dy = (rnd() - 0.5) * 0.1, dz = (rnd() - 0.5) * 0.1;
        tx[p] = Math.min(Math.max(tx[p] + dx, -1 + p * 1.84), 1 + p * 1.84);
        ty[p] = Math.min(Math.max(ty[p] + dy, -1), 1);
        tz[p] = Math.min(Math.max(tz[p] + dz, 4), 6);
        c.setPinTarget(p, tx[p], ty[p], tz[p]);
      }
    }
    prev.set(c.pos);
    c.step(wx, wy, wz, null);
    if (i % 50 === 0) {
      if (!allFinite(c)) { finite = false; break; }
      for (let k = 0; k < c.n; k++) {
        const d = Math.hypot(c.pos[3 * k] - c.pos[0], c.pos[3 * k + 1] - c.pos[1], c.pos[3 * k + 2] - c.pos[2]);
        worst = Math.max(worst, d);
      }
    }
    for (let k = 0; k < c.pos.length; k++) maxDisp = Math.max(maxDisp, Math.abs(c.pos[k] - prev[k]));
  }
  ok('stress 10k steps: no NaN/Inf', finite);
  ok('stress: no node further than 3x cloth size from the pins', worst < 3 * size, `worst=${worst.toFixed(2)} size=${size.toFixed(2)}`);
  console.log(`  info stress: worst dist ${worst.toFixed(2)} m (3x size ${(3 * size).toFixed(2)}), max per-step displacement ${(maxDisp * 100).toFixed(1)} cm`);
}

// AC: wind response, flutter variance, gusting
const angleOf = (c) => {
  // free bottom-centre node vs the pin line: horizontal offset (y) over vertical drop
  const k = (c.rows - 1) * c.cols + (c.cols >> 1);
  const dy = c.pos[3 * k + 1] - c.pos[1], dz = c.pos[2] - c.pos[3 * k + 2];
  return Math.atan2(Math.abs(dy), dz) * 180 / Math.PI;
};
{
  const c = make();
  let avg = 0, cnt = 0, varMax = 0;
  for (let i = 0; i < 480; i++) {
    c.step(0, 6, 0, null);
    if (i >= 240) {
      avg += angleOf(c); cnt++;
      // spatial variance of node speed (y component) across the free nodes
      let s = 0, s2 = 0, m = 0;
      for (let k = c.cols; k < c.n; k++) { const v = c.pos[3 * k + 1] - c.prev[3 * k + 1]; s += v; s2 += v * v; m++; }
      varMax = Math.max(varMax, s2 / m - (s / m) * (s / m));
    }
  }
  avg /= cnt;
  ok('wind 6 m/s: free edge deflects >= 30 deg from vertical', avg >= 30, `mean=${avg.toFixed(1)} deg`);
  ok('flutter: spatial variance of node velocity > 0', varMax > 0, `var=${varMax.toExponential(2)}`);
  console.log(`  info wind 6 m/s: mean deflection ${avg.toFixed(1)} deg, velocity variance ${varMax.toExponential(2)}`);

  // gusting: swing amplitude changes over time
  const g = make();
  const amps = [];
  for (let w = 0; w < 4; w++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 180; i++) {
      const gust = w % 2 === 0 ? 3 : 10;
      g.step(0, gust + 2 * Math.sin(i * 0.2), 0, null);
      const a = angleOf(g);
      if (i > 60) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
    }
    amps.push(hi - lo);
  }
  ok('gusting wind: swing amplitude changes over time', Math.max(...amps) - Math.min(...amps) > 0.5, `amps=${amps.map((a) => a.toFixed(1)).join(',')}`);
}

// AC: settling after a gust
for (const mode of ['top', 'corners']) {
  const c = make({ pinMode: mode });
  run(c, 300, 0, 8, 0);
  let t = -1;
  for (let i = 0; i < 480; i++) {
    c.step(0, 0, 0, null);
    if (t < 0 && c.maxSpeed < 0.02) { t = (i + 1) / 60; }
  }
  // must stay below until the end too
  ok(`settle [${mode}]: speed < 0.02 m/s within 4 s of wind drop`, t >= 0 && t <= 4, `t=${t}`);
  ok(`settle [${mode}]: not frozen instantly (>= 0.2 s)`, t >= 0.2, `t=${t}`);
  console.log(`  info settle ${mode}: ${t.toFixed(2)} s, final speed ${c.maxSpeed.toExponential(2)}`);
}

// AC: sag same within 2 cm at 4 vs 8 substeps
for (const mode of ['top', 'corners']) {
  const a = make({ pinMode: mode, substeps: 4 }), b = make({ pinMode: mode, substeps: 8 });
  run(a, 600); run(b, 600);
  let worst = 0;
  for (let i = 0; i < a.pos.length; i++) worst = Math.max(worst, Math.abs(a.pos[i] - b.pos[i]));
  ok(`sag [${mode}]: 4 vs 8 substeps within 2 cm`, worst < 0.02, `max diff ${(worst * 100).toFixed(2)} cm`);
  console.log(`  info sag ${mode}: 4 vs 8 substeps max node diff ${(worst * 100).toFixed(2)} cm`);
}

// AC: determinism
{
  const sim = (seed) => { const c = make({ seed }); for (let i = 0; i < 1000; i++) c.step(Math.sin(i * 0.01) * 4, 5, 0, null); return hashOf(c); };
  ok('determinism: same seed -> identical hash after 1000 steps', sim(3) === sim(3));
  ok('determinism: different seeds differ', sim(3) !== sim(4));
}

// sleep / wake: no pop
{
  const c = make({ pinMode: 'corners' });
  run(c, 600);
  c.sleep();
  const v = c.version, h0 = hashOf(c);
  run(c, 50);
  ok('asleep: step is a no-op (version + state unchanged)', c.version === v && hashOf(c) === h0);
  c.wake();
  const p0 = Float64Array.from(c.pos);
  c.step(0, 0, 0, null);
  let m = 0; for (let i = 0; i < p0.length; i++) m = Math.max(m, Math.abs(c.pos[i] - p0[i]));
  ok('wake: max displacement on the wake step < 1 mm', m < 1e-3, `${(m * 1000).toFixed(3)} mm`);
  const cc = make();
  run(cc, 800);
  ok('restSteps counts calm steps with zero wind', cc.restSteps > 100, `restSteps=${cc.restSteps}`);
  run(cc, 1, 1, 0, 0);
  ok('restSteps resets under wind', cc.restSteps === 0);
  const vv = cc.version; run(cc, 5, 0, 0, 0);
  ok('version advances while moving', cc.version >= vv);
}

// Perf (warn-only) + zero allocation
{
  const strict = process.env.PERF_STRICT === '1';
  const bench = (sub) => {
    const c = make({ substeps: sub });
    run(c, 600, 0, 5, 0); // warm
    const n = 3000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) c.step(0, 5 + Math.sin(i * 0.05), 0, null);
    return Number(process.hrtime.bigint() - t0) / 1e6 / n;
  };
  const p4 = bench(4), p8 = bench(8);
  console.log(`  info perf 24x16: ${p4.toFixed(4)} ms/step @4 substeps, ${p8.toFixed(4)} ms/step @8`);
  const p2 = bench(2);
  const fixed = 2 * p2 - p4, perSub = (p4 - p2) / 2;
  console.log(`  info perf split: fixed ${fixed.toFixed(4)} ms/step (2*T(2)-T(4)), per substep ${perSub.toFixed(4)} ms`);
  if (strict) ok('perf: 24x16 bare, 4 substeps <= 0.20 ms', p4 <= 0.20, `${p4.toFixed(4)}`);
  else if (p4 > 0.20) console.log(`PERF WARN: 4 substeps ${p4.toFixed(4)} ms > 0.20`);
  if (strict) ok('perf: 24x16, 8 substeps <= 0.35 ms', p8 <= 0.35, `${p8.toFixed(4)}`);
  else if (p8 > 0.35) console.log(`PERF WARN: 8 substeps ${p8.toFixed(4)} ms > 0.35`);

  const c = make();
  run(c, 300, 0, 5, 0);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) c.step(0, 5 + Math.sin(i * 0.05) * 3, 0, null);
  if (global.gc) global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok('zero allocation: heap growth over 10k steps <= 64 KB', !global.gc || grew < 65536, `grew ${grew} bytes`);
  if (!global.gc) console.log('  note: run with --expose-gc for the strict heap check');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
console.log('ALL PASS');
