#!/usr/bin/env node
// tools/capture-browser.mjs (US-059, docs/backlog.md row 30c)
//
//   node tools/capture-browser.mjs --mode gpucompare|voxelbench|bench [--grid 240x90] --port <95xx> [--variant shade] [--rays 2]
//   node tools/capture-browser.mjs --import <file>            (reads stdin if <file> is omitted)
//   node tools/capture-browser.mjs ... --diff <old.json>       (combine with either of the above)
//
// Drives a real headless Chrome/Edge over the Chrome DevTools Protocol
// (CDP) using Node's built-in `WebSocket` (confirmed working against a
// real CDP endpoint in this environment - see the header comment on
// `connectCdp` below) to run `?gpucompare=1|shade`, `?bench=present` or
// `?voxelbench=1` and read the page's own result global:
//   - gpucompare: `window.__gpuCompare` (game/js/main.js lines ~1005, 1543)
//   - bench:      `window.__bench`      (game/js/main.js line ~1724, only
//                 set by `?bench=present` - the `?bench=1` in-game-loop
//                 profiler path does NOT expose a window global)
//   - voxelbench: `window.__voxelBench` (game/js/main.js line ~1811)
// These are real, pre-existing hooks - confirmed by reading the file, not
// invented. No `game/`/`engine/` edits were needed for this story.
//
// Writes docs/test-reports/captures/<date>-<shortsha>-<mode>-<grid>.json
// and prints a summary table. `--import` parses the plain text the owner
// can select/copy out of the on-screen debug overlay (`overlay.el.
// textContent` - there is no literal "copy button" widget in the game,
// see the exact per-mode text templates in game/js/main.js around lines
// 987-997, 1507-1527, 1730-1735 and 1817-1820) from a REAL non-headless
// run, into the same JSON shape (`headless: false`), and does not launch
// a browser. `--diff <old.json>` prints per-row changes vs a prior
// capture, PASS->FAIL changes first.
//
// Only ever starts/stops the python server and browser THIS process
// itself spawned (tracked pids only - see `cleanup()`); never touches
// port 8000 or any other browser instance. Refuses any --port outside
// the PC-B 9500-9999 range.
//
// Node built-ins only (no npm deps).

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..');
export const CAPTURES_DIR = path.join(ROOT, 'docs', 'test-reports', 'captures');

const PC_B_PORT_MIN = 9500;
const PC_B_PORT_MAX = 9999;

// ---------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = {
    mode: null, grid: null, port: null, variant: null, rays: null,
    import: undefined, // string path, or true meaning "read stdin"
    diff: null, timeoutMs: 120000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--mode') opts.mode = next();
    else if (a === '--grid') opts.grid = next();
    else if (a === '--port') opts.port = Number(next());
    else if (a === '--variant') opts.variant = next();
    else if (a === '--rays') opts.rays = Number(next());
    else if (a === '--import') {
      // `--import` alone (no path following, or followed by another flag)
      // means "read stdin".
      const n = argv[i + 1];
      if (n && !n.startsWith('--')) { opts.import = next(); }
      else opts.import = true;
    } else if (a === '--diff') opts.diff = next();
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next());
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

export function validatePcbPort(port) {
  if (!Number.isInteger(port) || port < PC_B_PORT_MIN || port > PC_B_PORT_MAX) {
    throw new Error(
      `--port ${port} is outside the PC-B range ${PC_B_PORT_MIN}-${PC_B_PORT_MAX} ` +
      `(see CLAUDE.md "Two PCs": PC-A uses 9000-9499, PC-B uses 9500-9999, 8000 is the owner's server).`
    );
  }
}

// ---------------------------------------------------------------------
// Mode -> query string / result global
// ---------------------------------------------------------------------

export function buildQuery(mode, { grid, variant, rays } = {}) {
  const parts = [];
  if (mode === 'gpucompare') {
    parts.push(variant === 'shade' ? 'gpucompare=shade' : 'gpucompare=1');
  } else if (mode === 'bench') {
    parts.push('bench=present');
  } else if (mode === 'voxelbench') {
    parts.push('voxelbench=1');
    // voxelbench does not force its own grid (unlike bench/gpucompare -
    // see the comment above runVoxelBenchMode in game/js/main.js), so the
    // gate's own grid must be requested explicitly.
    parts.push(`grid=${grid || '240x90'}`);
    parts.push(`rays=${rays || 2}`);
  } else {
    throw new Error(`unknown --mode '${mode}' (expected gpucompare|voxelbench|bench)`);
  }
  if (grid && mode !== 'voxelbench') parts.push(`grid=${grid}`);
  return parts.join('&');
}

export function resultGlobalFor(mode) {
  if (mode === 'gpucompare') return '__gpuCompare';
  if (mode === 'bench') return '__bench';
  if (mode === 'voxelbench') return '__voxelBench';
  throw new Error(`unknown --mode '${mode}'`);
}

// ---------------------------------------------------------------------
// Normalizing a raw result (from a live window global, or from a parsed
// import) into a common { rows: [{name, pass, metrics}], ok } shape so
// --diff can compare live-vs-live, import-vs-import or live-vs-import.
// ---------------------------------------------------------------------

function flatten(obj, prefix, into) {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') { into[prefix] = obj; return; }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, into);
    else into[key] = v;
  }
}

export function normalizeLiveResult(mode, raw, { variant } = {}) {
  if (mode === 'gpucompare') {
    const rows = (raw.rows || []).map((r) => {
      const metrics = {};
      // dda variant rows carry cmpGeom/cmpCells/cmpLight/k8Ok/isVoxelPose;
      // shade variant rows are flat (glyphMatchPct, fgOutside, ...).
      const { pose, ok, ...rest } = r;
      flatten(rest, '', metrics);
      return { name: pose, pass: !!ok, metrics };
    });
    return { rows, ok: !!raw.ok };
  }
  if (mode === 'bench') {
    const metrics = {};
    flatten(raw, '', metrics);
    const pass = raw.fullFrame ? raw.fullFrame.avgMs <= 8 : null; // overlay's own stated budget
    return { rows: [{ name: 'present', pass, metrics }], ok: pass };
  }
  if (mode === 'voxelbench') {
    const metrics = {};
    flatten(raw, '', metrics);
    // D-019 gate, per the overlay text this mode itself prints.
    const pass = raw.voxelMsP95 <= 0.5 && raw.gpuMsP95 <= 4;
    return { rows: [{ name: 'voxelbench', pass, metrics }], ok: pass };
  }
  throw new Error(`unknown --mode '${mode}'`);
}

// ---------------------------------------------------------------------
// --import: parse the plain overlay text (game/js/main.js's own
// `overlay.el.textContent` templates) copy-pasted from a real,
// non-headless run.
// ---------------------------------------------------------------------

const RE = {
  poseHeader: /^(PASS|FAIL)\s+(.+)$/,
  ddaGeom: /^geometry: kind ([\d.]+)%\s+matEq (\d+)\/(\d+)\s+planeEq (\d+)\/(\d+)\s+depthViol (\d+)\s+uvViol (\d+)\s+holes (\d+) \(must be 0\)\s+edgeKindMismatch (\d+)\/(\d+)$/,
  ddaK8: /^k8 cpu (\d+)\s+gpu (\d+)/,
  ddaShading: /^shading: glyph ([\d.]+)%\s+fgOut (\d+)\s+bgOut (\d+)\s+outside ([\d.]+)% \(<=0\.5%, (\d+) cells\)\s+fgMax (\d+)\s+bgMax (\d+) \(<=64\)\s+poisonedSurvivors (\d+)$/,
  ddaLight: /^light: (OK|MISMATCH)\s+sunlit ([\d.]+)% \(<=0\.5%, (\d+)\/(\d+)\)\s+dLMax ([\d.]+)\s+dLViol (\d+) \(<=1e-3\/chan\)$/,
  shadeGlyph: /^glyph match \(non-edge\): ([\d.]+)%\s+edge cells excluded: (\d+)$/,
  shadeFgBg: /^fg outside \+-4: (\d+)\s+bg outside \+-4: (\d+)\s+fgMax (\d+) bgMax (\d+)$/,
  shadeDepth: /^depth match: (\d+)%\s+mat==0 cells: (\d+)$/,
  benchHead: /^BENCH \((\d+) worst-case frames\)\s+backend: (\S+)$/,
  benchCanvas: /^canvas: (\d+)x(\d+) px\s+\(dpr ([\d.]+), cell (\d+)x(\d+)px\)$/,
  benchPresent: /^present\(\): avg ([\d.]+) ms\s+p95 ([\d.]+) ms\s+max ([\d.]+) ms$/,
  benchFull: /^full frame: avg ([\d.]+) ms\s+p95 ([\d.]+) ms\s+max ([\d.]+) ms$/,
  voxelHead: /^VOXELBENCH \((\d+) frames, (\d+x\d+), rays (\d+), (\d+) instances\)$/,
  voxelPass: /^voxel pass: p50 ([\d.]+) ms\s+p95 ([\d.]+) ms/,
  voxelGpu: /^gpu total:\s+p50 ([\d.]+) ms\s+p95 ([\d.]+) ms/,
};

export function detectImportMode(text) {
  const first = text.split('\n')[0].trim();
  if (first.startsWith('?gpucompare=shade')) return { mode: 'gpucompare', variant: 'shade' };
  if (first.startsWith('?gpucompare=1')) return { mode: 'gpucompare', variant: 'dda' };
  if (first.startsWith('BENCH (')) return { mode: 'bench' };
  if (first.startsWith('VOXELBENCH (')) return { mode: 'voxelbench' };
  return null;
}

export function parseImportText(text, modeHint) {
  const detected = detectImportMode(text);
  const mode = (detected && detected.mode) || modeHint;
  if (!mode) throw new Error('--import: could not detect mode from the pasted text, and no --mode was given');
  const variant = (detected && detected.variant) || null;
  const lines = text.split('\n').map((l) => l.trim());

  if (mode === 'gpucompare') {
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const m = RE.poseHeader.exec(lines[i]);
      if (!m) continue;
      const pass = m[1] === 'PASS';
      const name = m[2];
      const metrics = {};
      if (variant === 'shade') {
        const a = RE.shadeGlyph.exec(lines[i + 1]);
        const b = RE.shadeFgBg.exec(lines[i + 2]);
        const c = RE.shadeDepth.exec(lines[i + 3]);
        if (a) { metrics.glyphMatchPct = Number(a[1]); metrics.edgeCells = Number(a[2]); }
        if (b) { metrics.fgOutside = Number(b[1]); metrics.bgOutside = Number(b[2]); metrics.fgMax = Number(b[3]); metrics.bgMax = Number(b[4]); }
        if (c) { metrics.depthMatchPct = Number(c[1]); metrics.matZeroCount = Number(c[2]); }
      } else {
        const a = RE.ddaGeom.exec(lines[i + 1]);
        const b = RE.ddaK8.exec(lines[i + 2]);
        const c = RE.ddaShading.exec(lines[i + 3]);
        const d = RE.ddaLight.exec(lines[i + 4]);
        if (a) {
          metrics['cmpGeom.kindMatchPct'] = Number(a[1]);
          metrics['cmpGeom.matEqual'] = Number(a[2]); metrics['cmpGeom.matched'] = Number(a[3]);
          metrics['cmpGeom.planeEqual'] = Number(a[4]);
          metrics['cmpGeom.depthViol'] = Number(a[6]); metrics['cmpGeom.uvViol'] = Number(a[7]);
          metrics['cmpGeom.holes'] = Number(a[8]);
          metrics['cmpGeom.edgeKindMismatch'] = Number(a[9]); metrics['cmpGeom.edgeCells'] = Number(a[10]);
        }
        if (b) { metrics['cmpGeom.k8Cpu'] = Number(b[1]); metrics['cmpGeom.k8Gpu'] = Number(b[2]); }
        if (c) {
          metrics['cmpCells.glyphMatchPct'] = Number(c[1]);
          metrics['cmpCells.fgOutside'] = Number(c[2]); metrics['cmpCells.bgOutside'] = Number(c[3]);
          metrics['cmpCells.outsideFrac'] = Number(c[4]) / 100; metrics['cmpCells.cellsOutside'] = Number(c[5]);
          metrics['cmpCells.fgMax'] = Number(c[6]); metrics['cmpCells.bgMax'] = Number(c[7]);
          metrics['cmpCells.poisonedSurvivors'] = Number(c[8]);
        }
        if (d) {
          metrics['cmpLight.pass'] = d[1] === 'OK';
          metrics['cmpLight.sunlitMismatchFrac'] = Number(d[2]) / 100;
          metrics['cmpLight.sunlitMismatch'] = Number(d[3]); metrics['cmpLight.nonSky'] = Number(d[4]);
          metrics['cmpLight.dLMax'] = Number(d[5]); metrics['cmpLight.dLViol'] = Number(d[6]);
        }
      }
      rows.push({ name, pass, metrics });
    }
    const ok = /\nALL PASS/.test('\n' + text) || text.trimEnd().endsWith('ALL PASS');
    return { mode, variant, rows, ok, headless: false };
  }

  if (mode === 'bench') {
    const metrics = {};
    for (const l of lines) {
      let m;
      if ((m = RE.benchHead.exec(l))) { metrics.frames = Number(m[1]); metrics.backend = m[2]; }
      else if ((m = RE.benchCanvas.exec(l))) {
        metrics.canvasPxW = Number(m[1]); metrics.canvasPxH = Number(m[2]);
        metrics.devicePixelRatio = Number(m[3]); metrics.pxCellW = Number(m[4]); metrics.pxCellH = Number(m[5]);
      } else if ((m = RE.benchPresent.exec(l))) {
        metrics['present.avgMs'] = Number(m[1]); metrics['present.p95Ms'] = Number(m[2]); metrics['present.maxMs'] = Number(m[3]);
      } else if ((m = RE.benchFull.exec(l))) {
        metrics['fullFrame.avgMs'] = Number(m[1]); metrics['fullFrame.p95Ms'] = Number(m[2]); metrics['fullFrame.maxMs'] = Number(m[3]);
      }
    }
    const pass = metrics['fullFrame.avgMs'] !== undefined ? metrics['fullFrame.avgMs'] <= 8 : null;
    return { mode, rows: [{ name: 'present', pass, metrics }], ok: pass, headless: false };
  }

  if (mode === 'voxelbench') {
    const metrics = {};
    for (const l of lines) {
      let m;
      if ((m = RE.voxelHead.exec(l))) {
        metrics.frames = Number(m[1]); metrics.grid = m[2]; metrics.rays = Number(m[3]); metrics.instances = Number(m[4]);
      } else if ((m = RE.voxelPass.exec(l))) {
        metrics.voxelMsP50 = Number(m[1]); metrics.voxelMsP95 = Number(m[2]);
      } else if ((m = RE.voxelGpu.exec(l))) {
        metrics.gpuMsP50 = Number(m[1]); metrics.gpuMsP95 = Number(m[2]);
      }
    }
    const pass = metrics.voxelMsP95 !== undefined ? (metrics.voxelMsP95 <= 0.5 && metrics.gpuMsP95 <= 4) : null;
    return { mode, rows: [{ name: 'voxelbench', pass, metrics }], ok: pass, headless: false };
  }

  throw new Error(`unknown mode '${mode}'`);
}

// ---------------------------------------------------------------------
// --diff: compare two normalized results (each { rows, ok }).
// ---------------------------------------------------------------------

export function diffResults(current, previous) {
  const prevByName = new Map((previous.rows || []).map((r) => [r.name, r]));
  const curByName = new Map((current.rows || []).map((r) => [r.name, r]));
  const changes = [];
  for (const [name, cur] of curByName) {
    const prev = prevByName.get(name);
    if (!prev) { changes.push({ name, kind: 'new', passChange: null, cur, prev: null }); continue; }
    const passChanged = cur.pass !== prev.pass;
    const metricChanges = [];
    const keys = new Set([...Object.keys(cur.metrics || {}), ...Object.keys(prev.metrics || {})]);
    for (const k of keys) {
      const a = prev.metrics ? prev.metrics[k] : undefined;
      const b = cur.metrics ? cur.metrics[k] : undefined;
      if (a !== b) metricChanges.push({ key: k, from: a, to: b });
    }
    if (passChanged || metricChanges.length) {
      changes.push({
        name, kind: 'changed',
        passChange: passChanged ? { from: prev.pass, to: cur.pass } : null,
        metricChanges,
      });
    }
  }
  for (const [name, prev] of prevByName) {
    if (!curByName.has(name)) changes.push({ name, kind: 'removed', prev });
  }
  // PASS->FAIL first, then other pass changes, then metric-only changes, then new/removed.
  const rank = (c) => {
    if (c.passChange && c.passChange.from === true && c.passChange.to === false) return 0;
    if (c.passChange) return 1;
    if (c.kind === 'changed') return 2;
    if (c.kind === 'removed') return 3;
    return 4; // new
  };
  changes.sort((a, b) => rank(a) - rank(b));
  return changes;
}

export function formatDiff(changes) {
  if (!changes.length) return 'no changes vs the given old result.';
  const lines = [];
  for (const c of changes) {
    if (c.kind === 'new') { lines.push(`+ ${c.name} (new row, pass=${c.cur.pass})`); continue; }
    if (c.kind === 'removed') { lines.push(`- ${c.name} (row removed, was pass=${c.prev.pass})`); continue; }
    let head = `~ ${c.name}`;
    if (c.passChange) head += `  ${c.passChange.from} -> ${c.passChange.to}`;
    lines.push(head);
    for (const mc of c.metricChanges) lines.push(`    ${mc.key}: ${mc.from} -> ${mc.to}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------

export function formatSummary(mode, result) {
  const lines = [`mode=${mode}  headless=${result.headless}  ok=${result.ok}`];
  for (const r of result.rows) {
    lines.push(`  ${r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : '?   '}  ${r.name}`);
    for (const [k, v] of Object.entries(r.metrics || {})) lines.push(`      ${k}: ${v}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------

export function todayStr(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function shortShaSync(cwd = ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'nogit';
  }
}

export function captureFilePath({ date, sha, mode, grid }) {
  const g = (grid || 'grid').replace(/[^\w-]/g, '');
  return path.join(CAPTURES_DIR, `${date}-${sha}-${mode}-${g}.json`);
}

export function writeCapture(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------
// Process management: server + browser, killed only by this process's
// own tracked handles (see cleanup()).
// ---------------------------------------------------------------------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function findBrowserBinary() {
  const envPath = process.env.CHROME_PATH || process.env.EDGE_PATH || process.env.BROWSER_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r) return true;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
    }
  } catch { /* already gone */ }
}

async function connectCdp(cdpPort, timeoutMs = 10000) {
  const listUrl = `http://127.0.0.1:${cdpPort}/json/list`;
  await waitForHttp(listUrl, timeoutMs);
  let page = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !page) {
    const targets = await (await fetch(listUrl)).json();
    page = targets.find((t) => t.type === 'page');
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('no page target on CDP endpoint');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const eventHandlers = [];
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('CDP websocket error: ' + (e.message || e))));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const h of eventHandlers) h(msg.method, msg.params);
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  function onEvent(handler) { eventHandlers.push(handler); }

  return { ws, send, onEvent, close: () => { try { ws.close(); } catch {} } };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  if (result.exceptionDetails) throw new Error('page eval threw: ' + JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitForGlobal(cdp, globalName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const has = await evaluate(cdp, `typeof window.${globalName} !== 'undefined'`);
    if (has) return evaluate(cdp, `window.${globalName}`);
    await sleep(300);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for window.${globalName} (mode never produced a result - check the page loaded, WebGL2 is available, and the query string is right)`);
}

// ---------------------------------------------------------------------
// Live capture (headless CDP)
// ---------------------------------------------------------------------

export async function runLiveCapture(opts) {
  validatePcbPort(opts.port);
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary found - set CHROME_PATH/EDGE_PATH, or use --import instead');

  const handles = { serverProc: null, browserProc: null };
  const cdpPort = opts.port; // one server port; CDP uses port+1 to avoid clashing with the http server
  const debugPort = opts.port === 65535 ? opts.port - 1 : opts.port + 1;
  validatePcbPort(debugPort);

  const cleanup = () => {
    if (handles.browserProc && handles.browserProc.pid) killTree(handles.browserProc.pid);
    if (handles.serverProc && handles.serverProc.pid) killTree(handles.serverProc.pid);
  };
  const onSignal = () => { cleanup(); process.exit(1); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    handles.serverProc = spawn('python', ['-m', 'http.server', String(opts.port)], {
      cwd: ROOT, stdio: 'ignore',
    });
    await waitForHttp(`http://127.0.0.1:${opts.port}/`, 10000);

    const userDataDir = path.join(ROOT, '.tmp-capture-browser-profile-' + opts.port);
    handles.browserProc = spawn(binary, [
      `--remote-debugging-port=${debugPort}`,
      '--headless=new',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: 'ignore' });

    const cdp = await connectCdp(debugPort, 15000);
    await cdp.send('Page.enable');
    const query = buildQuery(opts.mode, opts);
    // Server is started at the repo root (matches CLAUDE.md's own
    // `python -m http.server 8000` convention) - the entry point lives at
    // game/index.html, not at the root.
    const url = `http://127.0.0.1:${opts.port}/game/index.html?${query}`;
    const navigated = new Promise((resolve) => {
      cdp.onEvent((method) => { if (method === 'Page.loadEventFired') resolve(); });
    });
    await cdp.send('Page.navigate', { url });
    await navigated;

    const globalName = resultGlobalFor(opts.mode);
    const raw = await waitForGlobal(cdp, globalName, opts.timeoutMs);

    const ua = await evaluate(cdp, 'navigator.userAgent');
    const gpuRenderer = await evaluate(cdp,
      `(function(){ try { var c=document.createElement('canvas'); var gl=c.getContext('webgl2')||c.getContext('webgl'); ` +
      `if(!gl) return null; var ext=gl.getExtension('WEBGL_debug_renderer_info'); ` +
      `return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch(e){ return null; } })()`
    );

    cdp.close();
    return { raw, ua, gpuRenderer };
  } finally {
    cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

// ---------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let mode = opts.mode;
  let normalized;
  let headless;
  let grid = opts.grid;

  if (opts.import !== undefined) {
    const text = opts.import === true
      ? readFileSync(0, 'utf8') // stdin
      : readFileSync(opts.import, 'utf8');
    const parsed = parseImportText(text, opts.mode);
    mode = parsed.mode;
    normalized = { rows: parsed.rows, ok: parsed.ok };
    headless = false;
    grid = grid || normalized.rows.find((r) => r.metrics && r.metrics.grid)?.metrics.grid || null;
  } else {
    if (!mode) throw new Error('--mode gpucompare|voxelbench|bench is required (or use --import)');
    if (opts.port == null) throw new Error('--port <95xx> is required for a live capture');
    const { raw, ua, gpuRenderer } = await runLiveCapture(opts);
    normalized = normalizeLiveResult(mode, raw, { variant: opts.variant });
    headless = true;
    let derivedGrid = raw.grid || opts.grid || null;
    if (!derivedGrid && mode === 'voxelbench') derivedGrid = opts.grid || '240x90';
    if (!derivedGrid && mode === 'bench' && raw.canvasPxW && raw.pxCellW) {
      derivedGrid = `${Math.round(raw.canvasPxW / raw.pxCellW)}x${Math.round(raw.canvasPxH / raw.pxCellH)}`;
    }
    grid = grid || derivedGrid;

    const date = todayStr();
    const sha = shortShaSync();
    const payload = {
      date, sha, mode, grid, headless,
      ua, gpuRenderer,
      ok: normalized.ok,
      rows: normalized.rows,
      raw,
    };
    const filePath = captureFilePath({ date, sha, mode, grid });
    writeCapture(filePath, payload);
    console.log(`wrote ${path.relative(ROOT, filePath)}`);
  }

  console.log(formatSummary(mode, { ...normalized, headless }));

  if (opts.diff) {
    const oldPayload = JSON.parse(readFileSync(opts.diff, 'utf8'));
    const changes = diffResults(normalized, oldPayload);
    console.log('\n--- diff vs ' + opts.diff + ' ---');
    console.log(formatDiff(changes));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((err) => {
    console.error('capture-browser: ' + err.message);
    process.exit(1);
  });
}
