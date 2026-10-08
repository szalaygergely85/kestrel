// BOOT-SPEED-01 step 1: boot-time marks. `mark(label)` stamps performance.now() (ms since navigation start);
// `span(label, t0)` records a duration that started at t0. Both are no-ops after `freeze()` (first frame), so the
// hot paths never pay for it. Read with `bootEntries()` / `bootReport()`; main.js prints it once and shows it in F3.
const entries = [];
let frozen = false;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function mark(label) { if (!frozen) entries.push({ label, t: now(), ms: 0 }); }
/** Duration entry: ms = now - t0 (t0 from `bootNow()`). */
export function span(label, t0) { if (!frozen) { const t = now(); entries.push({ label, t, ms: t - t0 }); } }
export function bootNow() { return now(); }
export function freezeBootMarks() { frozen = true; }
export function bootEntries() { return entries; }

/** Multi-line text: absolute time, delta to the previous entry, and span length where there is one. */
export function bootReport() {
  const lines = []; let prev = 0;
  for (const e of entries) {
    lines.push(`${e.t.toFixed(0).padStart(6)} ms  +${(e.t - prev).toFixed(0).padStart(5)}  ${e.ms ? '[' + e.ms.toFixed(1) + ' ms] ' : ''}${e.label}`);
    prev = e.t;
  }
  return lines.join('\n');
}
