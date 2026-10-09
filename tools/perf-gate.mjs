// PERF-GATE-01: perf budget gate (Node only). Exit 1 if any preset's p95 > its budget; a missing preset only warns.
//   node tools/perf-gate.mjs [--table <perf-table-x.md|.json>] [--bench-line <file|->] [--budgets docs/test-reports/perf-budgets.json]
//   node tools/perf-gate.mjs --help
// --table: PERF-TABLE-01 markdown (uses the "frame p95 ms" column) or json ({low:{frameP95|p95Ms|p95}} or {presets:{...}}).
// --bench-line: combat bench output containing `combat bench: p50 .. p95 .. avg .. PASS|FAIL (budget N ms)` ("-" = stdin).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PRESETS = ['low', 'medium', 'high', 'ultra'];

// Markdown table -> { preset: p95 | null }. Finds the "frame p95" column from the header.
export function parseTableMd(text) {
  const out = {};
  let col = -1;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (/^preset$/i.test(cells[0])) { col = cells.findIndex((c) => /frame\s*p95/i.test(c)); if (col < 0) col = cells.findIndex((c) => /p95/i.test(c)); continue; }
    if (col < 0 || !/^[a-z]+$/i.test(cells[0])) continue;
    const v = parseFloat(cells[col]);
    out[cells[0].toLowerCase()] = Number.isFinite(v) ? v : null;
  }
  return out;
}

export function parseTableJson(obj) {
  const src = obj && obj.presets ? obj.presets : obj || {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    const x = [v.frameP95, v.p95Ms, v.p95].find(Number.isFinite);
    out[k.toLowerCase()] = x ?? null;
  }
  return out;
}

export function parseTable(text) {
  const t = text.trim();
  if (t.startsWith('{')) return parseTableJson(JSON.parse(t));
  return parseTableMd(text);
}

// `combat bench: p50 1.2 p95 3.4 avg 2 PASS (budget 8 ms)` -> { p95, budget } | null
export function parseBenchLine(text) {
  const m = /combat bench:[^\n]*?\bp95\s*[=:]?\s*([\d.]+)/i.exec(text);
  if (!m) return null;
  const b = /budget\s*[=:]?\s*([\d.]+)/i.exec(text.slice(m.index));
  return { p95: parseFloat(m[1]), budget: b ? parseFloat(b[1]) : null };
}

// measured: { name: p95|null }, budgets: { name: {p95Ms} } -> { lines, fail, warn }
export function evaluate(measured, budgets) {
  const lines = []; let fail = false, warn = false;
  for (const [name, b] of Object.entries(budgets)) {
    if (name.startsWith('_') || !(name in measured) && !wanted(name, measured)) continue;
    const v = measured[name];
    if (v == null) { lines.push(`WARN ${name}: no p95 measured (budget ${b.p95Ms} ms)`); warn = true; }
    else if (v > b.p95Ms) { lines.push(`FAIL ${name}: p95 ${v.toFixed(2)} ms > budget ${b.p95Ms} ms`); fail = true; }
    else lines.push(`PASS ${name}: p95 ${v.toFixed(2)} ms <= budget ${b.p95Ms} ms`);
  }
  return { lines, fail, warn };
}
// A budgeted preset is expected when a table was given (presets) - handled by the caller seeding nulls.
function wanted() { return false; }

export function run(argv, log = console.log) {
  if (argv.includes('--help')) {
    log('perf-gate: exit 1 if a preset p95 exceeds docs/test-reports/perf-budgets.json.\n  node tools/perf-gate.mjs [--table <md|json>] [--bench-line <file|->] [--budgets <json>]');
    return 0;
  }
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const budgetsPath = arg('--budgets') || fileURLToPath(new URL('../docs/test-reports/perf-budgets.json', import.meta.url));
  const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
  const measured = {};
  const tp = arg('--table');
  if (tp) { if (!existsSync(tp)) { log(`perf-gate: table not found: ${tp}`); return 2; } for (const p of PRESETS) measured[p] = null; Object.assign(measured, parseTable(readFileSync(tp, 'utf8'))); }
  const bp = arg('--bench-line');
  if (bp) { measured.combat = null; const bl = parseBenchLine(readFileSync(bp === '-' ? 0 : bp, 'utf8')); if (bl) measured.combat = bl.p95; }
  const r = evaluate(measured, budgets);
  r.lines.forEach((l) => log(l));
  if (!r.lines.length) log('perf-gate: nothing to check (pass --table and/or --bench-line)');
  return r.fail ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(run(process.argv.slice(2)));
