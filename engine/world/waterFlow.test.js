// US-141a (architecture.md 35.1, 35.4): water flow data - validation, World#flowAt (rect / circle / radial), save round trip, zero allocation.
// Run: node --expose-gc engine/world/waterFlow.test.js
import { createWater, collectWaterDefs, FLOW_MAX } from './water.js';
import { World } from './World.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const rect = (id, r, z, extra = {}) => ({ id, shape: 'rect', rect: r, z, ...extra });
const circ = (id, c, r, z, extra = {}) => ({ id, shape: 'circle', c, r, z, ...extra });
const mk = (list) => createWater(collectWaterDefs({ water: list }, []));
const bare = (list) => { const w = new World(); w.water = mk(list); return w; };
const f = [0, 0];

// ---- flowAt: rect, circle, radial, stacking, outside ----
{
  const w = bare([rect('river', [0, 0, 10, 4], 1, { flow: [3, -1] }), circ('pool', [-20, 0], 5, 0.5, { flowRadial: 2 }),
    rect('over', [8, 0, 12, 4], 2, { flow: [0, 5] })]);
  ok('rect: inside returns true + the flow', w.flowAt(2, 2, f) === true && f[0] === 3 && f[1] === -1);
  ok('outside water: false and [0,0]', (f[0] = 9, f[1] = 9, w.flowAt(50, 50, f)) === false && f[0] === 0 && f[1] === 0);
  ok('highest-z region wins in an overlap', w.flowAt(9, 2, f) && f[0] === 0 && f[1] === 5);
  ok('still region has [0,0] flow', bare([rect('s', [0, 0, 4, 4], 1)]).flowAt(1, 1, f) === true && f[0] === 0 && f[1] === 0);
  w.flowAt(-20 + 3, 0, f);
  ok('radial: outward (+) along +x, magnitude |s|', near(f[0], 2) && near(f[1], 0));
  w.flowAt(-20, 4, f);
  ok('radial: outward along +y', near(f[0], 0) && near(f[1], 2));
  w.flowAt(-20, 0, f);
  ok('radial: zero at the exact centre (no NaN)', f[0] === 0 && f[1] === 0);
  const wn = bare([circ('sink', [0, 0], 4, 1, { flowRadial: -1.5, flow: [1, 0] })]);
  wn.flowAt(0, 2, f);
  ok('radial: negative = inward and adds to flow', near(f[0], 1) && near(f[1], -1.5));
}

// ---- validation: throws naming the id ----
{
  const t = (r) => threw(() => mk([r]));
  const e1 = t(rect('fast', [0, 0, 4, 4], 1, { flow: [5, 5] }));
  ok('flow |v| > 6 throws naming the id', e1 && e1.includes('"fast"') && e1.includes('flow'), e1);
  ok('flow exactly 6 passes', t(rect('edge', [0, 0, 4, 4], 1, { flow: [6, 0] })) === null && FLOW_MAX === 6);
  ok('flow NaN / wrong arity throws', t(rect('n', [0, 0, 4, 4], 1, { flow: [NaN, 0] })) !== null && t(rect('n', [0, 0, 4, 4], 1, { flow: [1] })) !== null);
  const e2 = t(rect('sq', [0, 0, 4, 4], 1, { flowRadial: 1 }));
  ok('flowRadial on a rect throws naming the id', e2 && e2.includes('"sq"') && e2.includes('flowRadial'), e2);
  const e3 = t(circ('big', [0, 0], 3, 1, { flowRadial: 7 }));
  ok('flowRadial |s| > 6 throws naming the id', e3 && e3.includes('"big"'), e3);
  ok('flowRadial non-number throws', t(circ('s', [0, 0], 3, 1, { flowRadial: 'x' })) !== null);
  // level blocks: id is prefixed by the structure id
  const st = [{ id: 'hall', frame: { x: 0, y: 0, z: 0, yawSteps: 0, cos: 1, sin: 0 }, level: { def: { water: [{ id: 'w', shape: 'rect', rect: [0, 0, 2, 2], z: 0, flow: [9, 0] }] } } }];
  const e4 = threw(() => collectWaterDefs({}, st));
  ok('level block: validated too, id prefixed', e4 && e4.includes('"hall.w"'), e4);
}

// ---- save round trip: waterDef is a raw clone, flow keys survive ----
{
  const def = { water: [circ('rt', [1, 1], 3, 1, { flow: [1, 2], flowRadial: 0.5 })] };
  const w = new World(); w.waterDef = structuredClone(def.water);
  const back = structuredClone(JSON.parse(JSON.stringify(w.waterDef)));
  const w2 = new World(); w2.water = mk(back);
  w2.flowAt(1 + 2, 1, f);
  ok('round trip: flow + flowRadial survive a JSON clone', near(f[0], 1.5) && near(f[1], 2));
}

// ---- zero allocation + speed ----
{
  const list = [];
  for (let i = 0; i < 32; i++) list.push(i % 2 ? rect(`r${i}`, [i * 5, 0, i * 5 + 8, 8], i, { flow: [1, 0] }) : circ(`c${i}`, [i * 5 + 3, 4], 4, i, { flowRadial: 1 }));
  const w = bare(list);
  const run = (n) => { let h = 0; for (let i = 0; i < n; i++) if (w.flowAt((i * 7) % 170, (i * 3) % 9, f)) h++; return h; };
  run(20000);
  const N = 100000, t0 = process.hrtime.bigint();
  const hits = run(N);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`perf: flowAt, 32 regions: ${(ms * 1000).toFixed(3)} us/query`);
  if (ms > 0.005) console.warn(`WARN flowAt ${ms.toFixed(5)} ms > 0.005`);
  ok('perf probe hit', hits > 0);
  if (globalThis.gc) {
    globalThis.gc();
    let grown = Infinity;
    for (let r = 0; r < 3; r++) {
      const m0 = process.memoryUsage().heapUsed;
      run(100000);
      grown = Math.min(grown, process.memoryUsage().heapUsed - m0);
      globalThis.gc();
    }
    ok('zero allocation: 100k queries grow the heap < 64 KB', grown < 65536, `${grown} B`);
  }
}

console.log(`waterFlow.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((x) => console.error('FAIL:', x)); process.exit(1); }
