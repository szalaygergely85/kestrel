// AUD2-40: shared heap-growth gate helper. Call ensureGcChild() as the FIRST statement of a suite that gates on
// heapUsed deltas: without --expose-gc it re-runs the same file in a fresh `node --expose-gc` child (stdio inherited,
// exit code forwarded), so the measurement has a real gc and a quiet heap even under the parallel runner.
// (no Node import specifier: engine/ forbids them; getBuiltinModule needs Node >= 22.3)

export function ensureGcChild() {
  if (typeof globalThis.gc === 'function' || process.env.ALLOC_GATE_CHILD) return;
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, ALLOC_GATE_CHILD: '1' } });
  process.exit(r.status ?? 1);
}

/** heapUsed growth (bytes) of `fn` after a warm-up call: gc, run, gc. Needs --expose-gc (see ensureGcChild). */
export function heapGrowth(fn, warm = fn) {
  warm();
  globalThis.gc(); globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  fn();
  globalThis.gc(); globalThis.gc();
  return process.memoryUsage().heapUsed - h0;
}
