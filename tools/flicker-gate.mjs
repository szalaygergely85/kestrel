// tools/flicker-gate.mjs (FLICKER-GATE-01): glyph-flicker regression gate.
// This is the AA-05 / future render-change regression gate for OB-208.
//
// Run (needs a browser; use a port from your range):
//   node tools/flicker-gate.mjs --port 9725 --save      # record docs/test-reports/flicker-baseline.json
//   node tools/flicker-gate.mjs --port 9725             # compare against that baseline, exit 1 on FAIL
//   node tools/flicker-gate.mjs --port 9725 --baseline other.json [--query <raw>]
// It runs `tools/capture-browser.mjs --mode flicker --variant live --stable --rays 4 --port N`,
// then reads the newest docs/test-reports/captures/*-flicker-live-grid.json (rows[0].metrics).
// FD-01: --path default|stable (default `default` = stable pass off, D-119; own baseline flicker-baseline-default.json; FAIL when a pose is > 0.3 above it); --diag adds the per-class table.
// FAIL (stable path) when any pose glyphOnly > baseline*1.15 + 0.3, or avg glyphOnly > baseline avg*1.10 + 0.2
// (run-to-run noise is about +-0.3 %). A pose missing from the run also FAILs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuery } from './capture-browser.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const CAPTURES = path.join(ROOT, 'docs', 'test-reports', 'captures');
export const DEFAULT_BASELINE = path.join(ROOT, 'docs', 'test-reports', 'flicker-baseline.json'); // --path stable
export const DEFAULT_PATH_BASELINE = path.join(ROOT, 'docs', 'test-reports', 'flicker-baseline-default.json'); // --path default (FD-01)

export const POSE_MARGIN = { rel: 1.15, abs: 0.3 };
export const AVG_MARGIN = { rel: 1.10, abs: 0.2 };
// FD-01 (38.9y): default path = no pose worse than its baseline + 0.3 abs (no relative slack; noise is about +-0.3 %).
export const DEFAULT_POSE_MARGIN = { rel: 1, abs: 0.3 };
export const DEFAULT_AVG_MARGIN = { rel: 1, abs: 0.2 };
// FD-01: the capture query. The default path still builds the pipeline with stable=1 (that allocates shade's texLevel target; main.js stays untouched);
// `flickerdef=1` makes flickerLive switch the stable PASS off before measuring, so the frames are the D-119 default path. --diag adds flickerdiag=1.
export function gateQuery(pathMode, diag) {
  return buildQuery('flicker', { variant: 'live', rays: 4, stable: true }) + (pathMode === 'default' ? '&flickerdef=1' : '') + (diag ? '&flickerdiag=1' : '');
}

// metrics -> { poses: {name: {totalPct, glyphOnlyPct}}, avg: {totalPct, glyphOnlyPct} }
export function extractPoses(metrics) {
  const m0 = metrics || {};
  const poses = {};
  for (const k of Object.keys(m0)) {
    const m = /^poses\.([^.]+)\.(totalPct|glyphOnlyPct|glyphOnlyRawPct|shiftPct)$/.exec(k);
    if (m) (poses[m[1]] ||= {})[m[2]] = m0[k];
  }
  const avg = { totalPct: m0['avg.totalPct'] ?? m0.avgTotalPct, glyphOnlyPct: m0['avg.glyphOnlyPct'], glyphOnlyRawPct: m0['avg.glyphOnlyRawPct'], shiftPct: m0['avg.shiftPct'] };
  return { poses, avg };
}

// AA-DIAG-01: metrics `poses.<pose>.why.<reason>` (only with &flickerdiag=1) -> text table, % of counted cells per reason; '' when absent.
export const WHY_REASONS = ['heldChanged', 'edge', 'kind', 'plane', 'mat', 'anim', 'mixed255', 'uvDrift', 'snap255', 'levelJump', 'replayHold'];
export const M255_COLS = ['mixed255', 'lineShift', 'm255:line', 'm255:stip', 'm255:blank', 'm255:other', 'octPop', 'seamShift'];
// AA-14a: lineShift as % of mixed255 (the AA-14b go/no-go is >= 70); '-' when there is no mixed255.
export const shiftShare = (w) => (w && w.mixed255 > 0 ? 100 * (w.lineShift || 0) / w.mixed255 : null);
export function m255Table(metrics) {
  const poses = {};
  for (const k of Object.keys(metrics || {})) { const m = /^poses\.([^.]+)\.why\.([^.]+)$/.exec(k); if (m) (poses[m[1]] ||= {})[m[2]] = metrics[k]; }
  const names = Object.keys(poses); if (!names.length) return '';
  const c = (v, w = 10) => (typeof v === 'number' ? v.toFixed(2) : '-').padStart(w);
  const lines = ['M255 (mixed255 split, % of counted cells; shift% = lineShift / mixed255)', 'pose'.padEnd(14) + 'glyphOnly'.padStart(10) + M255_COLS.map((r) => r.padStart(11)).join('') + 'shift%'.padStart(8)];
  for (const n of names) lines.push(n.padEnd(14) + c(poses[n].glyphOnlyPct) + M255_COLS.map((r) => c(poses[n][r], 11)).join('') + c(shiftShare(poses[n]), 8));
  return lines.join('\n');
}
export function whyTable(metrics) {
  const poses = {};
  for (const k of Object.keys(metrics || {})) { const m = /^poses\.([^.]+)\.why\.([^.]+)$/.exec(k); if (m) (poses[m[1]] ||= {})[m[2]] = metrics[k]; }
  const names = Object.keys(poses); if (!names.length) return '';
  const c = (v) => (typeof v === 'number' ? v.toFixed(2) : '-').padStart(9);
  const lines = ['WHY (glyph-only flips by reason, % of counted cells)', 'pose'.padEnd(14) + 'glyphOnly'.padStart(9) + WHY_REASONS.map((r) => r.slice(0, 9).padStart(10)).join('')];
  for (const n of names) lines.push(n.padEnd(14) + c(poses[n].glyphOnlyPct) + WHY_REASONS.map((r) => c(poses[n][r]).padStart(10)).join(''));
  return lines.join('\n');
}

// FD-01: per-class table of the default path (metrics `poses.<pose>.why.<class>` = % of counted cells, `poses.<pose>.stillPct`):
// glyphOnly, still control, then each class as % of cells and (in brackets) its share of the pose's flips. levelLight/levelTex include their /jump sub-count.
export const DEFAULT_CLASSES = ['edge', 'lineShift', 'linePop', 'lineCode', 'm255:stip', 'm255:blank', 'm255:other', 'anim', 'altSwap', 'levelLight', 'levelTex'];
export function defaultTable(metrics) {
  const poses = {};
  for (const k of Object.keys(metrics || {})) { const m = /^poses\.([^.]+)\.(?:why\.(.+)|(stillPct|glyphOnlyPct))$/.exec(k); if (m) (poses[m[1]] ||= {})[m[2] === 'glyphOnlyPct' ? 'flips' : m[3] === 'glyphOnlyPct' ? 'gated' : (m[2] || m[3])] = metrics[k]; } // why.glyphOnlyPct = ALL flips (incl. lineShift); top-level glyphOnlyPct = the gated value
  const names = Object.keys(poses).filter((n) => typeof poses[n].flips === 'number'); if (!names.length) return '';
  const c = (v, w = 9) => (typeof v === 'number' ? v.toFixed(2) : '-').padStart(w);
  const lines = ['DEFAULT CLASSES (% of counted cells; share % of the pose flips in brackets)',
    'pose'.padEnd(12) + 'glyphOnly'.padStart(10) + 'stillPct'.padStart(9) + DEFAULT_CLASSES.map((r) => r.slice(0, 10).padStart(12)).join('')];
  for (const n of names) {
    const w = poses[n], tot = w.flips || 0;
    lines.push(n.padEnd(12) + c(w.gated, 10) + c(w.stillPct) + DEFAULT_CLASSES.map((r) => (c(w[r], 6) + '(' + (tot > 0 && typeof w[r] === 'number' ? Math.round(100 * w[r] / tot) : 0) + ')').padStart(12)).join(''));
  }
  lines.push('jump sub-counts: ' + names.map((n) => n + ' lvLight ' + c(poses[n]['levelLight/jump'], 0).trim() + ' lvTex ' + c(poses[n]['levelTex/jump'], 0).trim()).join('; '));
  return lines.join('\n');
}

const limit = (base, mg) => base * mg.rel + mg.abs;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// current/baseline: { poses, avg } -> { ok, rows:[{pose,total,glyphOnly,baseline,limit,verdict}], messages }
export function compare(current, baseline, margins = { pose: POSE_MARGIN, avg: AVG_MARGIN }) {
  const rows = [];
  const messages = [];
  const names = [...new Set([...Object.keys(baseline.poses || {}), ...Object.keys(current.poses || {})])];
  for (const pose of names) {
    const b = baseline.poses?.[pose];
    const c = current.poses?.[pose];
    if (!c || !isNum(c.glyphOnlyPct)) {
      rows.push({ pose, total: null, glyphOnly: null, baseline: b?.glyphOnlyPct ?? null, limit: null, verdict: 'FAIL' });
      messages.push(`pose "${pose}" is in the baseline but missing from this run`);
      continue;
    }
    if (!b || !isNum(b.glyphOnlyPct)) { // new pose: reported, not gated
      rows.push({ pose, total: c.totalPct, glyphOnly: c.glyphOnlyPct, baseline: null, limit: null, verdict: 'NEW' });
      continue;
    }
    const lim = limit(b.glyphOnlyPct, margins.pose);
    const bad = c.glyphOnlyPct > lim;
    rows.push({ pose, total: c.totalPct, glyphOnly: c.glyphOnlyPct, baseline: b.glyphOnlyPct, limit: lim, verdict: bad ? 'FAIL' : 'PASS', raw: c.glyphOnlyRawPct ?? null, shift: c.shiftPct ?? null });
    if (bad) messages.push(`pose "${pose}" glyphOnly ${c.glyphOnlyPct.toFixed(2)} % > limit ${lim.toFixed(2)} % (baseline ${b.glyphOnlyPct.toFixed(2)} %)`);
  }
  const ca = current.avg?.glyphOnlyPct, ba = baseline.avg?.glyphOnlyPct;
  if (!isNum(ca)) {
    rows.push({ pose: 'AVG', total: null, glyphOnly: null, baseline: ba ?? null, limit: null, verdict: 'FAIL' });
    messages.push('avg glyphOnly missing from this run');
  } else if (isNum(ba)) {
    const lim = limit(ba, margins.avg);
    const bad = ca > lim;
    rows.push({ pose: 'AVG', total: current.avg.totalPct ?? null, glyphOnly: ca, baseline: ba, limit: lim, verdict: bad ? 'FAIL' : 'PASS', raw: current.avg.glyphOnlyRawPct ?? null, shift: current.avg.shiftPct ?? null });
    if (bad) messages.push(`avg glyphOnly ${ca.toFixed(2)} % > limit ${lim.toFixed(2)} % (baseline ${ba.toFixed(2)} %)`);
  }
  return { ok: rows.every((r) => r.verdict !== 'FAIL'), rows, messages };
}

const f = (v) => (isNum(v) ? v.toFixed(2) : '-');
export function formatTable(result) {
  const head = ['pose', 'total%', 'glyphOnly%', 'raw%', 'shift%', 'baseline%', 'limit%', 'verdict']; // AA-14b: gated on glyphOnly (line shifts removed); raw = the old definition, always printed
  const lines = result.rows.map((r) => [r.pose, f(r.total), f(r.glyphOnly), f(r.raw), f(r.shift), f(r.baseline), f(r.limit), r.verdict]);
  const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (l) => l.map((c, i) => c.padEnd(w[i])).join('  ');
  const out = [fmt(head), ...lines.map(fmt), '', result.ok ? 'FLICKER GATE: PASS' : 'FLICKER GATE: FAIL'];
  for (const m of result.messages) out.push('  - ' + m);
  return out.join('\n');
}

// FLICKER-METRIC-DET: K runs of extractPoses() -> median per pose/avg (the value gated/saved) + min/max spread of glyphOnly.
const median = (a) => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
export function summarizeRuns(runs) {
  const names = [...new Set(runs.flatMap((r) => Object.keys(r.poses)))];
  const out = { poses: {}, avg: {}, spread: {} };
  const agg = (get, set, key) => {
    for (const k of ['totalPct', 'glyphOnlyPct', 'glyphOnlyRawPct', 'shiftPct']) {
      const v = runs.map((r) => get(r)?.[k]).filter(isNum);
      if (v.length) { set(k, median(v)); if (k === 'glyphOnlyPct') out.spread[key] = { min: Math.min(...v), max: Math.max(...v), spread: Math.max(...v) - Math.min(...v), n: v.length }; }
    }
  };
  for (const n of names) agg((r) => r.poses[n], (k, v) => ((out.poses[n] ||= {})[k] = v), n);
  agg((r) => r.avg, (k, v) => (out.avg[k] = v), 'AVG');
  return out;
}

// FLICKER-GATE-FIX: pure pick; only captures written at/after startMs count (a failed capture must not compare a stale file).
export function pickFreshCapture(files, startMs) {
  const fresh = files.filter((f) => f.t >= startMs).sort((a, b) => b.t - a.t);
  if (!fresh.length) throw new Error('capture-browser wrote no new *-flicker-live-grid.json since this run started (stale captures ignored)');
  return fresh[0].n;
}
function newestCapture(startMs) {
  const files = readdirSync(CAPTURES).filter((n) => /-flicker-live-grid\.json$/.test(n))
    .map((n) => ({ n, t: statSync(path.join(CAPTURES, n)).mtimeMs }));
  return path.join(CAPTURES, pickFreshCapture(files, startMs));
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') o.port = argv[++i];
    else if (argv[i] === '--save') o.save = true;
    else if (argv[i] === '--baseline') o.baseline = argv[++i];
    else if (argv[i] === '--repeat') o.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === '--timeout-ms') o.timeoutMs = Number(argv[++i]) || 240000;
    else if (argv[i] === '--query') o.query = argv[++i];
    else if (argv[i] === '--path') { o.path = argv[++i]; if (o.path !== 'default' && o.path !== 'stable') throw new Error('--path default|stable'); }
    else if (argv[i] === '--diag') o.diag = true;
    else throw new Error('unknown arg ' + argv[i]);
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.port) throw new Error('--port <N> is required');
  const pathMode = o.path || 'default'; // FD-01: the default path is the gate (D-119); --path stable = the old stable-pass run
  const args = [path.join(ROOT, 'tools', 'capture-browser.mjs'), '--mode', 'flicker', '--variant', 'live', '--rays', '4', '--port', String(o.port), '--timeout-ms', String(o.timeoutMs || 1200000)]; // AA-19: 6 poses (roadWalk) outgrew the 120 s default
  args.push('--query', o.query || gateQuery(pathMode, !!o.diag));
  const K = o.repeat || 1, runs = []; let retries = 0;
  for (let i = 0; i < K; i++) {
    const startMs = Date.now() - 1000; // 1 s slack for coarse file-system mtimes
    let r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    for (let t = 0; t < 2 && r.status !== 0 && K > 1; t++) { // infrastructure hiccup (browser start): retry, counted in the report
      retries++; console.warn('flicker-gate: run ' + (i + 1) + '/' + K + ' exited with ' + r.status + ', retrying (' + retries + ' retries so far)');
      r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    }
    if (r.status !== 0) throw new Error('capture-browser exited with ' + r.status + ' (run ' + (i + 1) + '/' + K + ')');
    const cap = JSON.parse(readFileSync(newestCapture(startMs), 'utf8'));
    if (!cap.rows?.[0]?.metrics) throw new Error('capture has no rows[0].metrics (failed capture)');
    const wt = whyTable(cap.rows?.[0]?.metrics); if (wt) console.log(wt);
    const mt = m255Table(cap.rows?.[0]?.metrics); if (mt) console.log(mt);
    const dt = defaultTable(cap.rows?.[0]?.metrics); if (dt) console.log(dt);
    runs.push({ ...extractPoses(cap.rows?.[0]?.metrics), sha: cap.sha, date: cap.date });
  }
  const cur = K > 1 ? summarizeRuns(runs) : runs[0];
  const cap = runs[runs.length - 1];
  if (K > 1) {
    console.log('REPEAT x' + K + ' (' + retries + ' retried runs): glyphOnly% per run, median, spread (max-min)');
    for (const k of Object.keys(cur.spread)) { const sp = cur.spread[k]; console.log('  ' + k.padEnd(10) + runs.map((r) => f(k === 'AVG' ? r.avg.glyphOnlyPct : r.poses[k]?.glyphOnlyPct)).join('  ') + '   median ' + f(k === 'AVG' ? cur.avg.glyphOnlyPct : cur.poses[k].glyphOnlyPct) + '  spread ' + f(sp.spread)); }
  }
  const blPath = o.baseline || (pathMode === 'default' ? DEFAULT_PATH_BASELINE : DEFAULT_BASELINE);
  if (o.save) {
    writeFileSync(blPath, JSON.stringify({ sha: cap.sha, date: cap.date, repeat: K, poses: cur.poses, avg: cur.avg }, null, 2) + '\n');
    console.log('baseline written: ' + path.relative(ROOT, blPath));
    return;
  }
  if (!existsSync(blPath)) throw new Error('no baseline at ' + blPath + ' (run with --save first)');
  const res = compare(cur, JSON.parse(readFileSync(blPath, 'utf8')), pathMode === 'default' ? { pose: DEFAULT_POSE_MARGIN, avg: DEFAULT_AVG_MARGIN } : undefined);
  console.log(formatTable(res));
  process.exitCode = res.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try { main(); } catch (e) { console.error('flicker-gate: ' + e.message); process.exit(1); }
}
