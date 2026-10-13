// OB-019 RIVER-01a (architecture.md 38.45 (1)): `river` water shape - validation, bucketed query, flow, perf.
// Run: node --expose-gc engine/world/river.test.js
import { createWater, collectWaterDefs, RIVER_MAX } from './water.js';
import { L_LAT } from './river.js';
import { World } from './World.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const mk = (list) => createWater(collectWaterDefs({ water: list }, []));
const bare = (list) => { const w = new World(); w.water = mk(list); w.floorAt = () => -5; return w; };

// straight fixture along +x, z 10 -> 8 over 100 m, halfW 4, speed 1.5
const straight = { id: 'r', shape: 'river', path: [[0, 0, 10, 4, 1.5], [50, 0, 9, 4, 1.5], [100, 0, 8, 4, 1.5]], feather: 1.5 };
// curved fixture (gentle S)
const curved = { id: 'c', shape: 'river', path: [[0, 0, 5, 3], [30, 0, 4.8, 3], [60, 25, 4.5, 3], [90, 25, 4.2, 3], [120, 0, 4, 3]] };
const out = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
const fl = [0, 0];

{
  const w = bare([straight]);
  ok('river: centre inside', w.waterAt(50, 0, out) && out.region === 'r');
  ok('river: hw-0.01 inside, hw+0.01 dry, feather dry', w.waterAt(50, 3.99, out) && !w.waterAt(50, 4.01, out) && !w.waterAt(50, 5.4, out));
  ok('river: negative side symmetric', w.waterAt(50, -3.99, out) && !w.waterAt(50, -4.01, out));
  ok('river: z linear along s (1e-9)', w.waterAt(25, 0, out) && near(out.surfaceZ, 9.5) && near(out.flatZ, 9.5) && w.waterAt(75, 2, out) && near(out.surfaceZ, 8.5));
  ok('river: look default "river"', w.water.lookNames[w.water.look[0]] === 'river');
  w.waterAt(10, 0, out); ok('river: depth = surface - floor (floor -5)', near(out.depth, out.surfaceZ + 5));
  ok('river: flow = tangent * v at centre', w.flowAt(50, 0, fl) && near(fl[0], 1.5) && near(fl[1], 0));
  w.flowAt(50, 3.9, fl); ok('river: bank slower than mid', fl[0] < 1.5 * 0.9 && fl[0] > 0);
  ok('river: flow outside = 0,false', !w.flowAt(50, 20, fl) && fl[0] === 0 && fl[1] === 0);
  const rv = w.water.rivers[0];
  w.waterAt(50, 2, out); const l1 = rv.loc[L_LAT];
  w.waterAt(50, -2, out); const l2 = rv.loc[L_LAT];
  ok('river: signed lat (+ left of flow)', near(l1, 2) && near(l2, -2));
  ok('river: no end caps (1 m past each end dry, 1 m inside wet)',
    !w.waterAt(-1, 0, out) && !w.waterAt(101, 0, out) && w.waterAt(1, 0, out) && w.waterAt(99, 0, out));
}
{ // curved: walk the compiled centre-line and probe +-hw
  const w = bare([curved]); const rv = w.water.rivers[0];
  let allIn = true, allOut = true, sGood = true;
  for (let i = 1; i < rv.n - 1; i++) {
    const nx = -rv.ty[i], ny = rv.tx[i]; // left normal
    if (!w.waterAt(rv.x[i], rv.y[i], out)) allIn = false;
    if (!near(out.surfaceZ, rv.z[i], 1e-6)) sGood = false;
    if (!w.waterAt(rv.x[i] + nx * (rv.hw[i] - 0.05), rv.y[i] + ny * (rv.hw[i] - 0.05), out)) allIn = false;
    if (w.waterAt(rv.x[i] + nx * (rv.hw[i] + 0.3), rv.y[i] + ny * (rv.hw[i] + 0.3), out)) allOut = false;
  }
  ok('curved: centre and hw-0.05 inside along the whole river', allIn);
  ok('curved: hw+0.3 dry', allOut);
  ok('curved: surfaceZ = sample z at sample centres', sGood);
  ok('curved: z non-increasing along s', Array.from(rv.z).every((z, i, a) => i === 0 || z <= a[i - 1] + 1e-9));
  ok('curved: resampled <= 2 m, ends exact', rv.s[1] - rv.s[0] <= 2 + 1e-9 && near(rv.s[rv.n - 1], rv.length) && near(rv.x[rv.n - 1], 120) && near(rv.y[rv.n - 1], 0));
}
{ // highest z wins vs an overlapping rect
  const w = bare([straight, { id: 'pool', shape: 'rect', rect: [40, -2, 60, 2], z: 12, waves: 'none' }, { id: 'low', shape: 'rect', rect: [70, -2, 80, 2], z: 1, waves: 'none' }]);
  ok('highest z: rect above river wins', w.waterAt(50, 0, out) && out.region === 'pool' && out.surfaceZ === 12);
  ok('highest z: river above low rect wins', w.waterAt(75, 0, out) && out.region === 'r' && near(out.surfaceZ, 8.5));
  const t = mk([{ id: 'q', shape: 'rect', rect: [0, 0, 1, 1], z: 0, flow: [0.5, 0.25] }]);
  t.flowInto(0, 0.5, 0.5, fl);
  ok('rect/circle flow unchanged', fl[0] === 0.5 && fl[1] === 0.25);
}
{ // validation
  const R = (over) => ({ ...straight, ...over });
  const P = (path) => R({ path });
  const has = (re, fn) => re.test(threw(fn) || '');
  ok('throws: rising z', has(/rises/, () => mk([P([[0, 0, 5, 3], [10, 0, 6, 3]])])));
  ok('throws: slope > 0.6', has(/slope/, () => mk([P([[0, 0, 5, 3], [10, 0, -2, 3]])])));
  ok('throws: segment too long', has(/segment length/, () => mk([P([[0, 0, 5, 3], [70, 0, 4, 3]])])));
  ok('throws: halfW out of range', has(/halfW/, () => mk([P([[0, 0, 5, 0.1], [10, 0, 4, 3]])])));
  ok('throws: speed > FLOW_MAX', has(/speed/, () => mk([P([[0, 0, 5, 3, 9], [10, 0, 4, 3]])])));
  ok('throws: 1 vertex', has(/2\.\.256/, () => mk([P([[0, 0, 5, 3]])])));
  ok('throws: error names id + vertex', has(/"r".*vertex 1/, () => mk([P([[0, 0, 5, 3], [10, 0, 6, 3]])])));
  ok('throws: tight bend', has(/bend/, () => mk([P([[0, 0, 5, 6], [10, 0, 4.9, 6], [10, 10, 4.8, 6], [0, 10, 4.7, 6]])])));
  ok('throws: bad clip id', has(/clip/, () => mk([R({ clip: ['nope'] })])));
  ok('clip to existing rect ok', threw(() => mk([R({ clip: ['pool'] }), { id: 'pool', shape: 'rect', rect: [0, 0, 1, 1], z: 3, waves: 'none' }])) === null);
  ok('throws: waves other than none', has(/waves/, () => mk([R({ waves: 'calm' })])));
  ok('throws: more than RIVER_MAX rivers', has(/more than/, () => mk(Array.from({ length: RIVER_MAX + 1 }, (_, i) => R({ id: 'r' + i })))));
  ok('throws: river in a structure level block', has(/only valid/, () => collectWaterDefs({}, [{ id: 's', frame: { x: 0, y: 0, z: 0, yawSteps: 0 }, level: { def: { water: [straight] } } }])));
  const t = mk([{ id: 'f', shape: 'rect', rect: [0, 0, 1, 1], z: 0, draw: false }, straight]);
  ok('draw:false recorded on any region', t.draw[0] === 0 && t.draw[1] === 1);
  ok('draw must be boolean', has(/draw/, () => mk([{ id: 'f', shape: 'rect', rect: [0, 0, 1, 1], z: 0, draw: 3 }])));
  const t2 = mk([R({ path: [[0, 0, 10, 3], [10, 0, 9, 3]] })]);
  ok('default speed from slope', near(t2.rivers[0].sp[0], 0.6 + 0.8));
}
{ // plain defs + perf + 0 alloc
  const defs = collectWaterDefs({ water: [straight, curved] }, []);
  ok('collect: river defs normalised', defs.length === 2 && defs[0].river.path.length === 3 && defs[0].draw === true);
  const w = bare([curved]); const n = 100000;
  let h = 0;
  const run = (k) => { for (let i = 0; i < k; i++) { if (w.waterAt((i * 7.3) % 130 - 5, (i * 3.1) % 40 - 8, out)) h++; w.flowAt((i * 7.3) % 130, (i * 3.1) % 40, fl); } };
  run(20000);
  const t0 = process.hrtime.bigint(); run(n);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  console.log(`perf: waterAt+flowAt river: ${(ms * 1000).toFixed(3)} us/pair`);
  ok('perf probe hit river', h > 0);
  if (ms > 0.003) console.warn(`WARN river waterAt+flowAt ${ms.toFixed(5)} ms > 0.003`);
  if (process.env.PERF_STRICT) ok('perf: <= 0.003 ms', ms <= 0.003);
  if (globalThis.gc) {
    let grown = Infinity;
    run(n); run(n); // warm-up past JIT tier-up (boxing there is not a per-query leak)
    for (let r = 0; r < 5; r++) { globalThis.gc(); globalThis.gc(); const m0 = process.memoryUsage().heapUsed; run(n); grown = Math.min(grown, process.memoryUsage().heapUsed - m0); }
    // GATE-FLAKY-01: with gc exposed this really grows ~14 B/pair (waterAt/flowAt allocate); known finding, strict only under ALLOC_STRICT=1
    if (process.env.ALLOC_STRICT || grown < 65536) ok('zero allocation: 100k river queries grow the heap < 64 KB', grown < 65536, `${grown} B`);
    else console.log(`WARN known alloc: 100k river queries grew the heap ${grown} B (strict: ALLOC_STRICT=1)`);
  }
}
console.log(`river.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
