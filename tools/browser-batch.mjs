#!/usr/bin/env node
// tools/browser-batch.mjs (PC-B 5x token rule, 2026-10-09). Runs the gate's browser checks ONE AT A TIME (one GPU, no
// contention) and prints one PASS/FAIL line per check, so programmers stay Node-only and the main session reads a short
// summary instead of driving Chrome itself.
//   node tools/browser-batch.mjs [--port-base 9540] [--baseline <file>] [--quick] [--no-default] [--presets [--gpu intel]] [--log-dir <dir>] ["<cmd with {port}>" ...]
// Default checks: gpucompare (webgpu; baseline picked by the run adapter, known-FAIL rows print as KNOWN; --baseline forces a file),
// the browser route walk, flicker-gate (default path, OB-208) and far-silhouette ob222 (OB-209). --quick = gpucompare + route walk only. Extra checks are whole command lines with a
// `{port}` placeholder, e.g. "node tools/verify-chest-hook.mjs {port} webgpu". Each check gets its own port (base + 2*i,
// so tools that also open port+1 for CDP never collide). Full output of every check goes to <log-dir>/<n>.log; on FAIL the
// last lines are printed. Exit 1 if any check fails. Writes <log-dir>/summary.json.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { baselineMismatch } from './gpucompare-baseline.mjs';

export const DEFAULT_BASELINE = 'docs/test-reports/gpucompare-baseline-webgpu-intel.json';
const TAIL_LINES = 12;
const BASELINE_DIR = 'docs/test-reports';
/** Baseline file for a WebGPU adapter string (Arc before Intel: "Intel(R) Arc"). Unknown adapter -> the Intel default. */
export function pickBaseline(adapter) {
  const a = String(adapter || '');
  if (/nvidia|rtx|geforce/i.test(a)) return `${BASELINE_DIR}/gpucompare-baseline-webgpu-rtx4060.json`;
  if (/\barc\b/i.test(a)) return `${BASELINE_DIR}/gpucompare-baseline-webgpu-arc.json`;
  return DEFAULT_BASELINE;
}
// Rows that fail on a GPU but are not in its baseline file (gpucompare skill "Known FAIL rows"); substring match on the row name.
export const KNOWN_EXTRA_FAILS = { rtx4060: ['signal tower', 'shaftForestHigh', 'shaftForestUltra', 'decorFord'] };
const gpuKey = (adapter) => (pickBaseline(adapter).match(/webgpu-([a-z0-9]+)\.json$/) || [])[1];
/**
 * Classify a run (rows: name -> 'PASS'|'FAIL') against a baseline object. FAIL rows that are FAIL in the baseline or in the
 * GPU's KNOWN_EXTRA_FAILS list are KNOWN (not a failure); a PASS->FAIL row otherwise is a regression. NEW FAIL rows are listed, not fatal (D-039).
 */
export function classifyGpucompare(baseline, rows, adapter) {
  const extra = (KNOWN_EXTRA_FAILS[gpuKey(adapter)] || []).map((x) => x.toLowerCase());
  const isExtra = (n) => extra.some((x) => n.toLowerCase().includes(x));
  const old = baseline.rows || {};
  const r = { regress: [], known: [], fixed: [], newFail: [], missing: [] };
  for (const [n, v] of Object.entries(rows)) {
    if (v === 'FAIL') {
      if (old[n] === 'FAIL' || isExtra(n)) r.known.push(n);
      else if (old[n] === 'PASS') r.regress.push(n);
      else r.newFail.push(n);
    } else if (old[n] === 'FAIL') r.fixed.push(n);
  }
  for (const n of Object.keys(old)) if (!(n in rows)) r.missing.push(n);
  r.ok = r.regress.length === 0;
  return r;
}
/** Post-process of the auto-baseline gpucompare check: run json (written by capture-browser as a new baseline) -> {ok, lines}. */
export function evaluateGpucompare(runJson, readBaseline = (f) => JSON.parse(readFileSync(f, 'utf8'))) {
  const file = pickBaseline(runJson.adapter);
  let bl;
  try { bl = readBaseline(file); } catch { return { ok: false, lines: [`no baseline ${file} for adapter '${runJson.adapter}'`] }; }
  const mm = baselineMismatch(bl, { backend: runJson.backend, adapter: runJson.adapter });
  if (mm) return { ok: false, lines: [`BASELINE MISMATCH (${file}): ${mm}`] };
  const c = classifyGpucompare(bl, runJson.rows || {}, runJson.adapter);
  const lines = [`baseline ${file}`];
  for (const n of c.regress) lines.push(`PASS->FAIL  ${n}`);
  for (const n of c.newFail) lines.push(`NEW FAIL    ${n}`);
  for (const n of c.known) lines.push(`KNOWN       ${n}`);
  for (const n of c.fixed) lines.push(`FAIL->PASS  ${n}`);
  for (const n of c.missing) lines.push(`MISSING     ${n}`);
  return { ok: c.ok, lines, classes: c };
}
// GFX-04-pc: gpucompare under each quality preset. `?quality=<p>` is the existing preset URL knob (== "preset=<p>"): on a capture
// page it applies the preset's shadows/scatter/lodScale while ?gpucompare=1 still forces 160x60 + rays 1 (parity contract) and
// thresholds are never touched. Baselines are per preset: gpucompare-baseline-webgpu-<gpu>-<preset>.json.
export const PRESETS = ['low', 'medium', 'high', 'ultra'];
export const presetBaselinePath = (gpu, preset) => `docs/test-reports/gpucompare-baseline-webgpu-${gpu}-${preset}.json`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { portBase: 9540, baseline: DEFAULT_BASELINE, defaults: true, quick: false, baselineForced: false, presets: false, gpu: 'intel', logDir: path.join(os.tmpdir(), 'kestrel-browser-batch'), extra: /** @type {string[]} */ ([]) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port-base') o.portBase = Number(argv[++i]);
    else if (a === '--baseline') { o.baseline = argv[++i]; o.baselineForced = true; }
    else if (a === '--quick') o.quick = true;
    else if (a === '--presets') o.presets = true;
    else if (a === '--gpu') o.gpu = argv[++i];
    else if (a === '--no-default') o.defaults = false;
    else if (a === '--log-dir') o.logDir = argv[++i];
    else if (a.startsWith('--')) throw new Error(`browser-batch: unknown argument ${a}`);
    else o.extra.push(a);
  }
  if (!Number.isInteger(o.portBase) || o.portBase < 1024) throw new Error('browser-batch: --port-base must be an integer >= 1024');
  return o;
}

/** The ordered check list: [{name, cmd}] with `{port}` already filled in. */
export function buildChecks(o) {
  const list = [];
  if (o.presets) {
    for (const p of PRESETS) list.push({ name: `gpucompare webgpu ${p}`, cmd: `node tools/capture-browser.mjs --mode gpucompare --backend webgpu --port {port} --timeout-ms 300000 --query "gpucompare=1&quality=${p}" --baseline ${presetBaselinePath(o.gpu, p)}` });
  } else if (o.defaults) {
    const gc = 'node tools/capture-browser.mjs --mode gpucompare --backend webgpu --port {port} --timeout-ms 300000 --baseline';
    // forced baseline: capture-browser diffs itself; otherwise it writes this run as a new baseline file and we classify it by adapter
    if (o.baselineForced) list.push({ name: 'gpucompare webgpu', cmd: `${gc} ${o.baseline}` });
    else list.push({ name: 'gpucompare webgpu', cmd: `${gc} ${path.join(o.logDir, 'gpucompare-run.json').split(path.sep).join('/')}`, autoBaseline: path.join(o.logDir, 'gpucompare-run.json') });
    list.push({ name: 'route walk (browser)', cmd: 'node tools/route-walk-browser.mjs --port {port}' });
    if (!o.quick) {
      list.push({ name: 'flicker-gate (default path)', cmd: 'node tools/flicker-gate.mjs --port {port}' });
      list.push({ name: 'far silhouette ob222', cmd: 'node tools/verify-far-silhouette.mjs {port} ob222' });
    }
  }
  for (const c of o.extra) list.push({ name: c.replace(/^node\s+/, '').split(/\s+/)[0], cmd: c });
  return list.map((c, i) => ({ ...c, cmd: c.cmd.split('{port}').join(String(o.portBase + 2 * i)) }));
}

/** @param {string} cmd @param {string} logFile @returns {Promise<{code:number, out:string, ms:number}>} */
function run(cmd, logFile) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: process.cwd() });
    let out = '';
    writeFileSync(logFile, '');
    // stream to the log as the child runs (a hung/killed check still leaves its output)
    const sink = (d) => { out += d; try { appendFileSync(logFile, d); } catch {} };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    child.on('close', (code) => { resolve({ code: code ?? 1, out, ms: Date.now() - t0 }); });
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  mkdirSync(o.logDir, { recursive: true });
  const checks = buildChecks(o);
  const results = [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const log = path.join(o.logDir, `${i + 1}.log`);
    if (c.autoBaseline) try { rmSync(c.autoBaseline, { force: true }); } catch {}
    const r = await run(c.cmd, log);
    let ok = r.code === 0;
    let extraLines = [];
    if (c.autoBaseline && ok) {
      try {
        if (!existsSync(c.autoBaseline)) throw new Error('capture wrote no run json');
        const ev = evaluateGpucompare(JSON.parse(readFileSync(c.autoBaseline, 'utf8')));
        ok = ev.ok; extraLines = ev.lines;
        r.out += '\n' + ev.lines.join('\n');
        appendFileSync(log, '\n' + ev.lines.join('\n') + '\n');
      } catch (e) { ok = false; extraLines = [`gpucompare post-check: ${e.message}`]; }
    }
    results.push({ name: c.name, cmd: c.cmd, ok, code: r.code, s: Math.round(r.ms / 1000), log });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} (${Math.round(r.ms / 1000)} s)${ok ? '' : ` exit ${r.code} - ${log}`}`);
    if (!ok) for (const line of r.out.trimEnd().split('\n').slice(-TAIL_LINES)) console.log(`  | ${line.slice(0, 200)}`);
    else for (const line of extraLines) if (/^(KNOWN|NEW FAIL|FAIL->PASS)/.test(line)) console.log(`  ${line.slice(0, 200)}`);
  }
  writeFileSync(path.join(o.logDir, 'summary.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\nbrowser-batch: ${results.length - fails}/${results.length} PASS (logs: ${o.logDir})`);
  process.exit(fails ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
