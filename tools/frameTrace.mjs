// S8-B1-14: pure frame-time trace stats, shared by tools/route-walk-browser.mjs (the
// headless --route walker, ME-12) and its Node test. No I/O, no DOM/CDP - just turns a flat
// array of per-frame records (one leg-tagged sample per frame: { leg, frame, simMs, jsMs,
// gpuMs, intervalMs, draws, shadowDraws, ... }) into per-leg p50/p95/p99/max per field and a
// worst-frame list, plus formatters for the optional JSON/CSV files the walker writes
// alongside its existing out.perf summary. Percentiles use the same nearest-rank method as
// route-walk-browser.mjs's own `pct()` (sort ascending, index = floor(n*p), clamped) so the
// two stay consistent.

export function pct(values, p) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

// Stats for one field within one leg's records. Returns nulls (not NaN/throw) when the leg
// has no finite samples for that field, e.g. a leg nothing was sampled for.
export function fieldStats(records, legName, field) {
  const vals = records.filter((r) => r.leg === legName).map((r) => r[field]);
  const finite = vals.filter(Number.isFinite);
  return { p50: pct(vals, 0.5), p95: pct(vals, 0.95), p99: pct(vals, 0.99), max: pct(vals, 1), n: finite.length };
}

const DEFAULT_FIELDS = ['simMs', 'jsMs', 'gpuMs', 'intervalMs'];

// Builds the fixed-schema trace object: { frames, legs: { <legName>: { <field>: stats } }, worst }.
// `legs` (leg name order) defaults to the distinct leg tags seen in `records`, in first-seen
// order, so a leg with zero records still only appears if named explicitly via opts.legs.
export function buildFrameTrace(records, opts = {}) {
  const fields = opts.fields || DEFAULT_FIELDS;
  const worstField = opts.worstField || 'intervalMs';
  const worstN = opts.worstN ?? 10;
  const legNames = opts.legs || [...new Set(records.map((r) => r.leg))];
  const legs = {};
  for (const leg of legNames) {
    legs[leg] = {};
    for (const f of fields) legs[leg][f] = fieldStats(records, leg, f);
  }
  const worst = records.filter((r) => Number.isFinite(r[worstField]))
    .slice().sort((a, b) => b[worstField] - a[worstField]).slice(0, worstN);
  return { frames: records.length, fields, worstField, legs, worst };
}

// CSV of the raw per-frame records (one row per frame) - the thing an out-file writer saves
// next to the JSON trace for spreadsheet/plot use. Pure string building, no fs.
export function toCSV(records, fields = ['leg', 'frame', ...DEFAULT_FIELDS]) {
  const header = fields.join(',');
  const rows = records.map((r) => fields.map((f) => (r[f] ?? '')).join(','));
  return [header, ...rows].join('\n');
}
