// PERF-TABLE-01: one markdown perf table (presets low/medium/high/ultra) from route-walk traces.
//   node tools/perf-table.mjs --port 95xx [--machine <id>] [--grid 400x150] [--extra "q={preset}"] [--dir <tracedir>]
//   node tools/perf-table.mjs --from <dir> [--machine <id>]     (no browser: rebuild from captured traces)
//   node tools/perf-table.mjs --help
// The browser part is a thin spawn of tools/route-walk-browser.mjs (the S8-B1-14 --route walker,
// which writes <out>.<backend>-<preset>.json) once per preset, one at a time. Everything else
// (parse, percentiles, table) is pure and unit-tested. Output: stdout + docs/test-reports/perf-table-<machine>.md.
// Percentiles: nearest-rank as in frameTrace.mjs pct(): sort ascending, index = min(n-1, floor(n*p)).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRESETS = ['low', 'medium', 'high', 'ultra'];

export function pct(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

const fmt = (x) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(2));

// One trace (route-walk result JSON) -> row stats. Missing/empty trace -> null.
export function summarizeTrace(trace) {
  const recs = trace && Array.isArray(trace.frameRecords) ? trace.frameRecords : [];
  if (!recs.length) return null;
  const col = (f) => recs.map((r) => r[f]);
  const perf = trace.perf || {};
  return {
    frames: recs.length,
    backend: trace.backend || '?',
    adapter: trace.adapter || null,
    frameP50: pct(col('intervalMs'), 0.5), frameP95: pct(col('intervalMs'), 0.95),
    gpuP50: pct(col('gpuMs'), 0.5), gpuP95: pct(col('gpuMs'), 0.95),
    wgP50: Number.isFinite(perf.shadowPassP50) ? perf.shadowPassP50 : null,
    wgP95: Number.isFinite(perf.shadowPassP95) ? perf.shadowPassP95 : null,
  };
}

// traces: { low: traceJson|null, ... } -> markdown. Missing preset -> row of "n/a".
export function buildTable(traces, machine = 'unknown') {
  const lines = [`Machine: ${machine}`, '',
    '| preset | backend | frames | frame p50 ms | frame p95 ms | gpu p50 ms | gpu p95 ms | wg pass p50 ms | wg pass p95 ms |',
    '|---|---|---|---|---|---|---|---|---|'];
  for (const p of PRESETS) {
    const s = summarizeTrace(traces[p]);
    lines.push(s
      ? `| ${p} | ${s.backend} | ${s.frames} | ${fmt(s.frameP50)} | ${fmt(s.frameP95)} | ${fmt(s.gpuP50)} | ${fmt(s.gpuP95)} | ${fmt(s.wgP50)} | ${fmt(s.wgP95)} |`
      : `| ${p} | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |`);
  }
  return lines.join('\n') + '\n';
}

// Machine id: explicit > trace adapter > hostname; filesystem-safe.
export function machineId(explicit, traces) {
  const a = Object.values(traces).map((t) => t && t.adapter).find(Boolean);
  return String(explicit || a || os.hostname() || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

// Reads <dir>/*-<preset>.json (route-walk --out files). Later file wins per preset.
export function loadTraces(dir) {
  const traces = {};
  for (const f of readdirSync(dir).sort()) {
    const m = /-(low|medium|high|ultra)\.json$/.exec(f);
    if (!m) continue;
    try { traces[m[1]] = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { /* skip bad file */ }
  }
  return traces;
}

const HELP = `perf-table: route-walk frame times per preset as one markdown table.
  node tools/perf-table.mjs --port <95xx> [--machine id] [--grid 400x150] [--extra "q={preset}"] [--dir tracedir]
  node tools/perf-table.mjs --from <dir> [--machine id]   rebuild from captured traces, no browser
Presets: ${PRESETS.join(', ')}. --extra gets {preset} substituted and is passed to route-walk-browser.
Percentiles are nearest-rank. Writes docs/test-reports/perf-table-<machine>.md.`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let dir = args.from;
  if (!dir) {
    if (!args.port) { console.error('--port <95xx> or --from <dir> required (see --help)'); process.exit(2); }
    dir = args.dir || mkdtempSync(path.join(os.tmpdir(), 'perf-table-'));
    mkdirSync(dir, { recursive: true });
    for (const p of PRESETS) {
      const a = ['tools/route-walk-browser.mjs', '--port', String(args.port), '--preset', p, '--out', path.join(dir, `trace-${p}.json`)];
      if (args.grid) a.push('--grid', args.grid);
      if (args.extra) a.push('--extra', args.extra.replaceAll('{preset}', p));
      const r = spawnSync(process.execPath, a, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000 });
      if (r.status !== 0) console.error(`preset ${p}: route walk failed (status ${r.status}); row will be n/a`);
    }
  }
  const traces = loadTraces(dir);
  const machine = machineId(args.machine, traces);
  const table = buildTable(traces, machine);
  console.log(table);
  const outDir = path.join(root, 'docs', 'test-reports');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `perf-table-${machine}.md`), `# Perf table\n\n${table}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
