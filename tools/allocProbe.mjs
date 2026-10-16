// Shared allocation probe (arch 38.61 point 1). One copy for every alloc test.
// Recipe: >= 2 warm-up windows (optimise), then per window gc();gc(), heapUsed before/after; result = MIN of 5 windows.
// Without --expose-gc the probe SKIPs (never PASS): callers check `r.skipped`.
// Keep windows small (<= ~1 MB expected garbage) so no scavenge hides the allocation.
/**
 * @param {(n:number)=>void} run   runs n iterations of the REAL per-tick call site
 * @param {{n?:number, warm?:number, windows?:number, chunk?:number, settle?:number, limit?:number}} [o]
 *   n = calls per window (default 20000).
 *   chunk (opt-in): call run(chunk) ceil(n/chunk) times per window instead of run(n) once. Use it when run(n) is only
 *     a loop around the call site: one long run(n) per window is OSR-compiled again every window (V8 12.x / Node 24
 *     re-enters it in Maglev/interpreter first and boxes doubles there), so the probe measured its own loop. With
 *     chunks, run itself gets a regular TurboFan compile that persists. Not for run()s that do per-call setup.
 *   settle (opt-in) + limit: after `warm`, run up to `settle` more measured warm-up windows until one is < limit B/call.
 *     Rarely-taken branches (e.g. a request change every 100 steps) tier up late; steady-state garbage never
 *     settles, so this cannot hide a real per-call allocation.
 * @returns {{skipped:boolean, bytes:number, perCall:number, n:number}}
 */
export function allocProbe(run, o = {}) {
  const chunk = o.chunk > 0 ? o.chunk : 0;
  const n = chunk ? Math.ceil((o.n || 20000) / chunk) * chunk : o.n || 20000;
  const warm = Math.max(2, o.warm || 2), windows = o.windows || 5;
  const gc = globalThis.gc;
  if (typeof gc !== 'function') return { skipped: true, bytes: NaN, perCall: NaN, n };
  const win = chunk ? () => { for (let k = 0; k < n; k += chunk) run(chunk); } : () => run(n);
  const measure = () => { gc(); gc(); const h0 = process.memoryUsage().heapUsed; win(); return process.memoryUsage().heapUsed - h0; };
  for (let w = 0; w < warm; w++) win();
  if (o.settle > 0 && o.limit > 0) for (let w = 0; w < o.settle; w++) if (measure() < o.limit * n) break;
  let best = Infinity;
  for (let w = 0; w < windows; w++) {
    const d = measure();
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
