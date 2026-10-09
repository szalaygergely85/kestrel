// PERF-PASSP95-01: passStats() maths, ring wrap, n/a, unavailable path, zero alloc. Fake timestamp source: _push() directly.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WebGpuTimer, WG_PASS_NAMES, WG_PASS_SLOT } from './WebGpuTimer.js';

const gpu = (on) => ({ features: new Set(on ? ['timestamp-query'] : []),
  createQuerySet: () => ({ destroy() {} }), createBuffer: () => ({ destroy() {} }) });
const c = { buf: { QUERY_RESOLVE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8 }, map: { READ: 1 } };

if (!global.gc && !process.env.PASSSTATS_CHILD) {
  const r = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], { stdio: 'inherit', env: { ...process.env, PASSSTATS_CHILD: '1' } });
  process.exit(r.status ?? 1);
}
{ // unavailable -> {available:false}, no throw
  const t = new WebGpuTimer(gpu(false), c);
  assert.deepEqual(t.passStats(), { available: false });
}
{ // empty: every pass n/a (NaN)
  const t = new WebGpuTimer(gpu(true), c), s = t.passStats();
  assert.equal(s.available, true); assert.equal(s.frames, 0);
  assert.deepEqual(Object.keys(s.passes), [...WG_PASS_NAMES]);
  for (const n of WG_PASS_NAMES) assert.ok(Number.isNaN(s.passes[n].p50) && Number.isNaN(s.passes[n].p95) && Number.isNaN(s.passes[n].last));
}
{ // percentile maths, nearest rank: 1..100 -> p50 = 50, p95 = 95; last = newest by serial
  const t = new WebGpuTimer(gpu(true), c), slot = WG_PASS_SLOT.raster;
  for (let i = 100; i >= 1; i--) t._push(slot, i, 101 - i); // reverse order: sort must handle it; last serial carries ms 1
  let s = t.passStats();
  assert.equal(s.passes.raster.p50, 50); assert.equal(s.passes.raster.p95, 95); assert.equal(s.passes.raster.last, 1);
  assert.equal(s.frames, 100); assert.ok(Number.isNaN(s.passes.hzb.p95), 'missing pass stays n/a');
  // single sample
  t._push(WG_PASS_SLOT.hzb, 2.5, 1); s = t.passStats();
  assert.equal(s.passes.hzb.p50, 2.5); assert.equal(s.passes.hzb.p95, 2.5);
  // ring wrap at 120: push 1..300, only 181..300 remain
  const u = new WebGpuTimer(gpu(true), c), sl = WG_PASS_SLOT.pshadow;
  for (let i = 1; i <= 300; i++) u._push(sl, i, i);
  s = u.passStats();
  assert.equal(s.frames, 120); assert.equal(s.passes.pshadow.p50, 240); assert.equal(s.passes.pshadow.p95, 294); assert.equal(s.passes.pshadow.last, 300);
  // reused object
  assert.equal(u.passStats(), s);
}
{ // zero allocation over 1e5 pushes + stats reads
  const t = new WebGpuTimer(gpu(true), c); t.passStats();
  for (let i = 0; i < 2000; i++) t._push(i % 14, i, i);
  t.passStats(); global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { t._push(i % 14, (i * 7) % 13, 2000 + i); if (i % 50 === 0) t.passStats(); }
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  assert.ok(grew < 200000, `heap grew ${grew}`);
}
console.log('WebGpuTimer.passStats OK');
