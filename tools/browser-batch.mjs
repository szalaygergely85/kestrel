#!/usr/bin/env node
// tools/browser-batch.mjs (PC-B 5x token rule, 2026-10-09). Runs the gate's browser checks ONE AT A TIME (one GPU, no
// contention) and prints one PASS/FAIL line per check, so programmers stay Node-only and the main session reads a short
// summary instead of driving Chrome itself.
//   node tools/browser-batch.mjs [--port-base 9540] [--baseline <file>] [--no-default] [--presets [--gpu intel]] [--log-dir <dir>] ["<cmd with {port}>" ...]
// Default checks: gpucompare (webgpu, --baseline) and the browser route walk. Extra checks are whole command lines with a
// `{port}` placeholder, e.g. "node tools/verify-chest-hook.mjs {port} webgpu". Each check gets its own port (base + 2*i,
// so tools that also open port+1 for CDP never collide). Full output of every check goes to <log-dir>/<n>.log; on FAIL the
// last lines are printed. Exit 1 if any check fails. Writes <log-dir>/summary.json.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_BASELINE = 'docs/test-reports/gpucompare-baseline-webgpu-intel.json';
const TAIL_LINES = 12;
// GFX-04-pc: gpucompare under each quality preset. `?quality=<p>` is the existing preset URL knob (== "preset=<p>"): on a capture
// page it applies the preset's shadows/scatter/lodScale while ?gpucompare=1 still forces 160x60 + rays 1 (parity contract) and
// thresholds are never touched. Baselines are per preset: gpucompare-baseline-webgpu-<gpu>-<preset>.json.
export const PRESETS = ['low', 'medium', 'high', 'ultra'];
export const presetBaselinePath = (gpu, preset) => `docs/test-reports/gpucompare-baseline-webgpu-${gpu}-${preset}.json`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { portBase: 9540, baseline: DEFAULT_BASELINE, defaults: true, presets: false, gpu: 'intel', logDir: path.join(os.tmpdir(), 'kestrel-browser-batch'), extra: /** @type {string[]} */ ([]) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port-base') o.portBase = Number(argv[++i]);
    else if (a === '--baseline') o.baseline = argv[++i];
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
    for (const p of PRESETS) list.push({ name: `gpucompare webgpu ${p}`, cmd: `node tools/capture-browser.mjs --mode gpucompare --backend webgpu --port {port} --timeout-ms 900000 --query "gpucompare=1&quality=${p}" --baseline ${presetBaselinePath(o.gpu, p)}` });
  } else if (o.defaults) {
    list.push({ name: 'gpucompare webgpu', cmd: `node tools/capture-browser.mjs --mode gpucompare --backend webgpu --port {port} --timeout-ms 900000 --baseline ${o.baseline}` });
    list.push({ name: 'route walk (browser)', cmd: 'node tools/route-walk-browser.mjs --port {port}' });
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
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { writeFileSync(logFile, out); resolve({ code: code ?? 1, out, ms: Date.now() - t0 }); });
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
    const r = await run(c.cmd, log);
    const ok = r.code === 0;
    results.push({ name: c.name, cmd: c.cmd, ok, code: r.code, s: Math.round(r.ms / 1000), log });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} (${Math.round(r.ms / 1000)} s)${ok ? '' : ` exit ${r.code} - ${log}`}`);
    if (!ok) for (const line of r.out.trimEnd().split('\n').slice(-TAIL_LINES)) console.log(`  | ${line.slice(0, 200)}`);
  }
  writeFileSync(path.join(o.logDir, 'summary.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\nbrowser-batch: ${results.length - fails}/${results.length} PASS (logs: ${o.logDir})`);
  process.exit(fails ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
