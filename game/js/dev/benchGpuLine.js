// COMBAT-BENCH-02: pure gpu line + budget for the combat bench, from WebGpuTimer.passStats() output
// ({available:false} | {available:true, frames, passes:{raster,shadow,light,shade,..:{p50,p95,last}}}).
// OWNER: gpu budget pending - evalGpuBudget(stats) with no limit reports numbers only (pass = null).
export const GPU_PASSES = ['raster', 'shadow', 'light', 'shade'];

const f = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

/** Frame gpu time = sum of the listed passes' values (NaN passes skipped; all NaN -> NaN). */
function sumPass(stats, key) {
  let s = 0, any = false;
  for (const n of GPU_PASSES) { const e = stats.passes && stats.passes[n]; if (e && Number.isFinite(e[key])) { s += e[key]; any = true; } }
  return any ? s : NaN;
}

export function formatGpuLine(stats) {
  if (!stats || !stats.available) return 'gpu n/a';
  const per = GPU_PASSES.map((n) => { const e = stats.passes && stats.passes[n]; return `${n} ${f(e ? e.p50 : NaN)}`; }).join(', ');
  return `gpu p50 ${f(sumPass(stats, 'p50'))} p95 ${f(sumPass(stats, 'p95'))} (passes: ${per})`;
}

/** Like evalBudget: pass when summed p95 <= p95Max. No limit (owner pending) or unavailable -> pass null. */
export function evalGpuBudget(stats, { p95Max } = {}) {
  if (!stats || !stats.available) return { pass: null, p50: NaN, p95: NaN };
  const p50 = sumPass(stats, 'p50'), p95 = sumPass(stats, 'p95');
  if (!(p95Max > 0) || !Number.isFinite(p95)) return { pass: null, p50, p95 };
  return { pass: p95 <= p95Max, p50, p95 };
}
