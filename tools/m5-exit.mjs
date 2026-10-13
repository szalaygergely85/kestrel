#!/usr/bin/env node
// tools/m5-exit.mjs (WMP-07, arch 38.59 budgets): one command, one PASS/FAIL table for the M5 whole-map exit gates.
//   node tools/m5-exit.mjs [--browser <port>] [--gpu rtx|intel] [--json]      exit 1 if any gate FAILs.
// Node part: tools/map-loop.mjs --json (band:late 0, sync bakes 0, max swap <= 4 ms, cache <= 32 MB, no fall/stuck, save/load poses)
//            tools/bench-life.mjs --poses --scenarios 0 --no-goblin --json (10 far-region poses, JS p95 sum <= 8 ms).
// Browser part (only with --browser): tools/bench-presets.mjs <port> --imp on --quality ultra|high --gpu rtx|intel; GATE line = D-075
// (RTX ultra <= 7.5, Intel high <= 10). UNKNOWN (no timers) counts as FAIL.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LIMITS = { swapMs: 4, cacheMB: 32, poseP95Ms: 8, poses: 10 };

const gate = (name, value, limit, ok) => ({ gate: name, value, limit, verdict: ok ? 'PASS' : 'FAIL' });

/** map-loop --json object -> gate rows. */
export function mapLoopGates(j) {
  if (!j) return [gate('map-loop ran', 'no JSON', 'ok', false)];
  return [
    gate('map-loop band:late', j.bandLate, '0', j.bandLate === 0),
    gate('map-loop sync bakes', j.syncBakes, '0', j.syncBakes === 0),
    gate('map-loop max swap ms', j.maxSwapMs, `<= ${LIMITS.swapMs}`, j.maxSwapMs <= LIMITS.swapMs),
    gate('map-loop cache MB', j.cacheMB, `<= ${LIMITS.cacheMB}`, j.cacheMB <= LIMITS.cacheMB),
    gate('map-loop fall/stuck/save-load', j.ok ? 'ok' : 'FAIL', 'ok', !!j.ok),
  ];
}

/** bench-life --json object -> one gate per far-region pose + a count check. */
export function benchLifeGates(j) {
  const rows = ((j && j.rows) || []).filter((r) => /^pose /.test(r.scenario) && /WM-06/.test(r.label));
  const out = rows.map((r) => gate(`bench-life ${r.scenario} JS p95 sum ms`, +Number(r.value).toFixed(3), `<= ${r.cap ?? LIMITS.poseP95Ms}`, r.verdict === 'PASS'));
  out.push(gate('bench-life pose count', rows.length, `${LIMITS.poses}`, rows.length === LIMITS.poses));
  return out;
}

/** bench-presets text -> gate rows from its "GATE name <= L ms GPU at pose (...): [x ms] PASS|FAIL|UNKNOWN" lines. */
export function presetGates(text) {
  const m = [...String(text).matchAll(/^GATE (.+?) <= ([\d.]+) ms GPU at (\S+).*?: (?:([\d.]+) ms )?(?:no timers )?(PASS|FAIL|UNKNOWN)\s*$/gm)];
  if (!m.length) return [gate('bench-presets GATE line', 'missing', 'present', false)];
  return m.map((x) => gate(`GPU ${x[1]} @${x[3]}`, x[4] ? +x[4] : 'n/a', `<= ${x[2]}`, x[5] === 'PASS'));
}

export function formatTable(rows) {
  const w = (k, h) => Math.max(h.length, ...rows.map((r) => String(r[k]).length));
  const [a, b, c] = [w('gate', 'gate'), w('value', 'value'), w('limit', 'limit')];
  const line = (g, v, l, s) => `${g.padEnd(a)}  ${String(v).padStart(b)}  ${String(l).padEnd(c)}  ${s}`;
  const rule = '-'.repeat(a + b + c + 14);
  const fails = rows.filter((r) => r.verdict !== 'PASS').length;
  return [line('gate', 'value', 'limit', 'verdict'), rule, ...rows.map((r) => line(r.gate, r.value, r.limit, r.verdict)), rule,
    `M5 EXIT: ${fails ? 'FAIL (' + fails + ' of ' + rows.length + ')' : 'PASS (' + rows.length + ' gates)'}`].join('\n');
}

const root = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 << 20 });
  return r.stdout || '';
}
const tryJson = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'))); } catch { return null; } };

if (process.argv[1]?.endsWith('m5-exit.mjs')) {
  const argv = process.argv.slice(2), val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
  const port = val('--browser'), gpu = val('--gpu') || 'rtx', hours = val('--hours') || '1'; // game hours per pose (24 = full day, ~10x slower)
  let rows = [];
  rows = rows.concat(mapLoopGates(tryJson(run([root('tools/map-loop.mjs'), '--json']))));
  rows = rows.concat(benchLifeGates(tryJson(run(['--expose-gc', root('tools/bench-life.mjs'), '--poses', '--hours', hours, '--scenarios', '0', '--no-goblin', '--json']))));
  if (port) {
    const quality = gpu === 'intel' ? 'high' : 'ultra';
    rows = rows.concat(presetGates(run([root('tools/bench-presets.mjs'), port, '--imp', 'on', '--quality', quality, '--gpu', gpu, '--poses', 'roadSouth', '--rays', '1'])));
  }
  console.log(argv.includes('--json') ? JSON.stringify(rows) : formatTable(rows));
  process.exit(rows.every((r) => r.verdict === 'PASS') ? 0 : 1);
}
