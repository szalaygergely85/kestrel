// Shared allocation probe (arch 38.61 point 1). One copy for every alloc test.
// Recipe: >= 2 warm-up windows (optimise), then per window gc();gc(), heapUsed before/after; result = MIN of 5 windows.
// Without --expose-gc the probe SKIPs (never PASS): callers check `r.skipped`.
// Keep windows small (<= ~1 MB expected garbage) so no scavenge hides the allocation.
/**
 * @param {(n:number)=>void} run   runs n iterations of the REAL per-tick call site
 * @param {{n?:number, warm?:number, windows?:number}} [o]  n = calls per window (default 20000)
 * @returns {{skipped:boolean, bytes:number, perCall:number, n:number}}
 */
export function allocProbe(run, o = {}) {
  const n = o.n || 20000, warm = Math.max(2, o.warm || 2), windows = o.windows || 5;
  const gc = globalThis.gc;
  if (typeof gc !== 'function') return { skipped: true, bytes: NaN, perCall: NaN, n };
  for (let w = 0; w < warm; w++) run(n);
  let best = Infinity;
  for (let w = 0; w < windows; w++) {
    gc(); gc();
    const h0 = process.memoryUsage().heapUsed;
    run(n);
    const d = process.memoryUsage().heapUsed - h0;
    if (process.env.ALLOC_DEBUG) console.log(`  [allocProbe] window ${w}: ${d} B`);
    if (d < best) best = d;
  }
  return { skipped: false, bytes: best, perCall: best / n, n };
}

/** Prints `SKIP (no --expose-gc)` and returns true when the probe was skipped. */
export function skipNote(r, name) {
  if (r.skipped) console.log(`SKIP ${name} (no --expose-gc)`);
  return r.skipped;
}
