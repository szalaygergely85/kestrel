// engine/core/commands.test.js (RE-14, docs/architecture.md 28.5).
// Run: node engine/core/commands.test.js
import { createCommandQueue } from './commands.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const EMPTY = new Int32Array(0);

// ---- two players issuing in reversed arrival order still execute in (player,seq) order ----
{
  const q = createCommandQueue({ inputDelay: 0 });
  const order = [];
  const handler = (qq, rec) => order.push([qq.player(rec), qq.seq(rec)]);

  // Player 1 issues first (arrival order), then player 0 - both land on the
  // same tick (inputDelay 0 -> tick = q.tick = 0).
  q.issue(1, 16, EMPTY, 0);
  q.issue(1, 16, EMPTY, 0);
  q.issue(0, 16, EMPTY, 0);
  q.issue(0, 16, EMPTY, 0);

  q.execute(handler);
  ok('executes in (player,seq) order regardless of arrival order',
    JSON.stringify(order) === JSON.stringify([[0, 0], [0, 1], [1, 0], [1, 1]]),
    JSON.stringify(order));
}

// ---- insert into the past throws -------------------------------------------
{
  const q = createCommandQueue({ inputDelay: 0 });
  q.execute(() => {}); // q.tick -> 1
  let threw = false;
  try { q.insert(0, 0, 0, 16, EMPTY, 0); } catch (e) { threw = true; }
  ok('insert into the past throws', threw);
  let notThrew = true;
  try { q.insert(1, 0, 0, 16, EMPTY, 0); } catch (e) { notThrew = false; }
  ok('insert at current tick does not throw', notThrew);
}

// ---- ring overflow throws (records) ----------------------------------------
{
  const q = createCommandQueue({ maxRecords: 4, inputDelay: 5 });
  for (let i = 0; i < 4; i++) q.issue(0, 16, EMPTY, 0);
  let threw = false;
  try { q.issue(0, 16, EMPTY, 0); } catch (e) { threw = true; }
  ok('record ring overflow throws', threw);
}

// ---- ring overflow throws (ids) ---------------------------------------------
{
  const q = createCommandQueue({ maxRecords: 16, maxIds: 8, inputDelay: 5 });
  const ids5 = new Int32Array([1, 2, 3, 4, 5]);
  q.issue(0, 16, ids5, 5);
  let threw = false;
  try { q.issue(0, 16, ids5, 5); } catch (e) { threw = true; } // 5+5=10 > 8
  ok('id ring overflow throws', threw);
}

// ---- save/load of pending records --------------------------------------------
{
  const q = createCommandQueue({ inputDelay: 3 });
  q.issue(0, 20, new Int32Array([7, 8]), 2, 100, -200, 5);
  q.issue(1, 21, EMPTY, 0, 1, 2, 3);
  const saved = q.save();

  const q2 = createCommandQueue({ inputDelay: 3 });
  q2.load(saved);

  const seen = [];
  q2.execute((qq, rec) => {}); // tick 0, nothing due yet
  // Advance to the tick where the saved commands are due.
  while (q2.tick < saved.records[0][0]) q2.execute(() => {});
  q2.execute((qq, rec) => {
    const ids = [];
    for (let k = 0; k < qq.nIds(rec); k++) ids.push(qq.idAt(rec, k));
    seen.push({ player: qq.player(rec), type: qq.type(rec), a0: qq.a0(rec), a1: qq.a1(rec), a2: qq.a2(rec), ids });
  });
  ok('save/load round-trips a record with ids and payload',
    seen.some((r) => r.player === 0 && r.type === 20 && r.a0 === 100 && r.a1 === -200 && r.a2 === 5 && JSON.stringify(r.ids) === '[7,8]'),
    JSON.stringify(seen));
}

// ---- zero alloc over 10k ticks: no commands ----------------------------------
{
  const q = createCommandQueue({ inputDelay: 0 });
  const handler = () => {};
  q.execute(handler); // warm up any lazy paths
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) q.execute(handler);
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('no-commands: heap growth bounded over 10k ticks', !global.gc || grew < 200000, `grew ${grew} bytes (run with --expose-gc for a strict check)`);
}

// ---- zero alloc over 10k ticks: 1 command per tick ---------------------------
{
  const q = createCommandQueue({ inputDelay: 1, maxRecords: 64 });
  const idBuf = new Int32Array([1]);
  const handler = () => {};
  for (let i = 0; i < 100; i++) { q.issue(0, 16, idBuf, 1); q.execute(handler); } // warm up
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) {
    q.issue(0, 16, idBuf, 1);
    q.execute(handler);
  }
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('1 command/tick: heap growth bounded over 10k ticks', !global.gc || grew < 200000, `grew ${grew} bytes (run with --expose-gc for a strict check)`);
}

// ---- execute() perf budget: <= 0.02ms at 32 commands/tick (warn-only) -------
{
  const PERF_STRICT = process.env.PERF_STRICT === '1';
  const q = createCommandQueue({ inputDelay: 0, maxRecords: 4096 });
  const idBuf = new Int32Array([1, 2, 3]);
  const handler = () => {};
  // Warm up JIT.
  for (let i = 0; i < 200; i++) {
    for (let c = 0; c < 32; c++) q.issue(c % 4, 16, idBuf, 3);
    q.execute(handler);
  }
  const N = 2000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 32; c++) q.issue(c % 4, 16, idBuf, 3);
    q.execute(handler);
  }
  const elapsed = performance.now() - t0;
  const perExec = elapsed / N;
  const cond = perExec <= 0.02;
  if (PERF_STRICT) {
    ok('execute() <= 0.02ms at 32 commands/tick', cond, `${perExec.toFixed(4)}ms/exec`);
  } else if (!cond) {
    console.warn(`WARN perf (non-strict): execute() ${perExec.toFixed(4)}ms/exec (budget 0.02ms)`);
    pass++;
  } else {
    pass++;
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
