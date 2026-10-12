// M4-W1: owner-walk readiness gate. Runs the whole M4 gate chain, takes a headless still at the 10 owner-walk stops
// (docs/sprints/m4-review-2026-10-11.md section 4) and one per `fixed - verify` bugs.md row that has an F3 position,
// then writes docs/test-reports/m4-walk/report.md (one page: step green/red, stills, OB verify table).
// Run: node tools/verify-m4-walk.mjs [--port 9725] [--no-stills] [--stills-only] [--skip-steps]   (exit 1 on the first FAIL step)
// Browser steps (verify-m4-exit, verify-ch12-run) and the stills each start/stop their OWN server on --port (CDP = port+1).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluateAsync, killTree } from './capture-browser.mjs';

export const OUT_DIR = path.join(ROOT, 'docs', 'test-reports', 'm4-walk');
export const GRID = '240x90';

// AC1: fixed order. `port: true` = a browser step that takes the port as argv[2].
export const STEPS = [
  { id: 'run-tests', script: 'run-tests.mjs', args: [] },
  { id: 'check-deps', script: 'check-deps.mjs', args: [] },
  { id: 'validate-content', script: 'validate-content.mjs', args: [] },
  { id: 'quest-sim', script: 'quest-sim.mjs', args: [] },
  { id: 'route-walk', script: 'route-walk.mjs', args: [] }, // all legs
  { id: 'verify-m4-exit', script: 'verify-m4-exit.mjs', args: [], port: true },
  { id: 'verify-ch12-run', script: 'verify-ch12-run.mjs', args: [], port: true },
];

// AC2: the 10 stops. Pose = stand at (x,y[,z]) and look at `look` [x,y] (yaw like T.face: atan2(dx,-dy)) or a fixed yaw;
// npc = stand 1.5 m west of that entity and face it; pose null = the freshly booted page. Coordinates: world_m1.world.json / bugs.md.
export const STOPS = [
  { n: 1, id: 'title', title: 'Title / boot (560x210 variant too)', pose: null, grid2: '560x210' },
  { n: 2, id: 'tower-start', title: 'Tower start: canvas bed, I / C, sword left slot', pose: { x: 1497.15, y: 1027.28, yaw: 265 } },
  { n: 3, id: 'burl-meadow', title: 'Burl and the meadow', npc: 'bear' },
  { n: 4, id: 'boar', title: 'Fight a boar', pose: { x: 1452, y: 1004, look: [1445.5, 1000.5] } },
  { n: 5, id: 'bend-relay', title: 'Bend relay on the ground, dusk lamps', pose: { x: 1266, y: 1038, look: [1262, 1033] } },
  { n: 6, id: 'ford', title: 'Ford: reeds, ferns, rocks, water, deer', pose: { x: 1018, y: 1068, look: [1030, 1068] } },
  { n: 7, id: 'rook-ruin', title: "Crossroads and Rook's ruin", pose: { x: 981, y: 1063, look: [975, 1058] } },
  { n: 8, id: 'smoke-north', title: 'Smoke north', pose: { x: 975, y: 1030, look: [958, 1004] } },
  { n: 9, id: 'sealed-gate', title: 'Sealed Gate leaves, F3 dropped meshes', pose: { x: 250, y: 840, look: [240, 840] } },
  { n: 10, id: 'continue', title: 'Save / quit / Continue (state diff = verify-m4-exit)', pose: { x: 1497.15, y: 1027.28, yaw: 265 } },
];

export function yawToward(from, to) { return Math.atan2(to[0] - from.x, -(to[1] - from.y)) * 180 / Math.PI; }
export function stopPose(stop) {
  const p = stop.pose; if (!p) return null;
  return { x: p.x, y: p.y, z: p.z, yaw: p.yaw !== undefined ? p.yaw : yawToward(p, p.look) };
}

// AC3: bugs.md rows in `fixed - verify` state. A row is `| OB-045 | date | text | fix note | status |` (older rows have fewer cells):
// id = first cell, status = last cell, text = the middle cells. Position: "x,y[,z] yaw N" (an F3 pose) or "~x,y" (approximate, no yaw).
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const POSE_RE = new RegExp(NUM + '\\s*,\\s*' + NUM + '(?:\\s*,\\s*' + NUM + ')?\\s*,?\\s*yaw\\s*' + NUM, 'i');
const APPROX_RE = /~\s*(\d{3,4})\s*,\s*(\d{3,4})/;
export function extractPosition(text) {
  let m = POSE_RE.exec(text);
  if (m) return { x: +m[1], y: +m[2], z: m[3] !== undefined ? +m[3] : undefined, yaw: +m[4], approx: false };
  m = APPROX_RE.exec(text);
  if (m) return { x: +m[1], y: +m[2], z: undefined, yaw: null, approx: true };
  return null;
}
export function parseBugRows(md) {
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*(OB-\d+)\s*\|/.exec(line); if (!m) continue;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
    const status = cells[cells.length - 1] || '';
    if (!/^fixed - verify/i.test(status)) continue;
    const mid = cells.slice(1, -1); if (mid.length && /^\d{4}-\d\d-\d\d$/.test(mid[0])) mid.shift(); // drop the date cell
    const text = mid.join(' | ');
    rows.push({ id: m[1], text, status, pos: extractPosition(text) });
  }
  return rows;
}

const short = (s, n = 150) => { s = String(s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '~' : s; };
export function renderReport({ date, grid = GRID, steps = [], stops = [], bugs = [], notes = [] }) {
  const L = [`# M4 owner-walk readiness (${date})`, ''];
  const red = steps.filter((s) => s.status === 'FAIL').length;
  L.push(`**${red ? 'RED' : 'GREEN'}** - ${steps.filter((s) => s.status === 'PASS').length}/${steps.length} steps pass. Stills at ${grid} (docs/test-reports/m4-walk/).`, '');
  L.push('## Steps', '', '| Step | Result | Time | Note |', '|---|---|---|---|');
  for (const s of steps) L.push(`| ${s.id} | ${s.status === 'PASS' ? 'green' : s.status === 'FAIL' ? 'RED' : s.status.toLowerCase()} | ${s.secs !== undefined ? s.secs.toFixed(0) + ' s' : ''} | ${short(s.note || '', 120)} |`);
  L.push('', '## Walk stills (m4-review section 4)', '', '| Stop | What to look at | Still |', '|---|---|---|');
  for (const s of stops) L.push(`| ${s.n} ${s.id} | ${short(s.title, 90)} | ${s.files && s.files.length ? s.files.map((f) => `[${f}](${f})`).join(' ') : 'no still'} |`);
  L.push('', '## OB rows in "fixed - verify"', '', '| Row | Bug | Still |', '|---|---|---|');
  for (const b of bugs) L.push(`| ${b.id} | ${short(b.text)} | ${b.file ? `[${b.file}](${b.file})${b.pos && b.pos.approx ? ' (approx. pos)' : ''}` : 'owner check only'} |`);
  if (notes.length) L.push('', '## Notes', '', ...notes.map((n) => '- ' + n));
  return L.join('\n') + '\n';
}

// ---- runner ----
function runStep(step, port) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', step.script), ...step.args, ...(step.port ? [String(port)] : [])], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 25 * 60 * 1000, windowsHide: true });
  const secs = (Date.now() - t0) / 1000, ok = r.status === 0;
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).filter(Boolean);
  return { id: step.id, status: ok ? 'PASS' : 'FAIL', secs, note: ok ? tail[tail.length - 1] || '' : `exit ${r.status}${r.error ? ' ' + r.error.message : ''}: ` + tail.slice(-3).join(' / ') };
}

// page side: teleport like real travel (floor height, clear void-rule safe spot, wait for the band), then aim
const POSE_JS = (p, npc) => `(async () => { const D = window.__debug, w = D.world, t = D.playerHandle.data.transform, c = D.playerHandle.data.components, sl = (ms) => new Promise((r) => setTimeout(r, ms));
  let x = ${p ? p.x : 'null'}, y = ${p ? p.y : 'null'}, z = ${p && p.z !== undefined ? p.z : 'undefined'}, yaw = ${p ? p.yaw : 'null'};
  ${npc ? `const e = w.get(${JSON.stringify(npc)}).data.transform; x = e.x - 1.5; y = e.y; z = undefined; yaw = Math.atan2(e.x - x, -(e.y - y)) * 180 / Math.PI;` : ''}
  let g = w.floorAt(x, y); t.x = x; t.y = y; t.z = z !== undefined ? z : (g == null ? t.z + 3 : g + 0.6); c.body.vx = c.body.vy = c.body.vz = 0; D.vitals.clearSafe(); D.look.locked = true; await sl(1200);
  if (z === undefined) { g = w.floorAt(x, y); if (g != null && Math.abs(t.z - g - 0.6) > 3) t.z = g + 0.6; }
  D.look.yawDeg = yaw; D.look.pitchDeg = -4; t.yawDeg = yaw; t.pitchDeg = -4; await sl(900); return [t.x, t.y, t.z]; })()`;

async function takeStills(port, bugs, report) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-m4-walk-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp;
  const [gw, gh] = GRID.split('x').map(Number);
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: gw * 4, height: gh * 4, deviceScaleFactor: 1, mobile: false });
    const open = async (grid) => {
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&backend=webgpu&grid=${grid}` });
      for (let i = 0; i < 100; i++) { await pause(400); try { if (await evaluateAsync(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world)')) break; } catch (e) { /* loading */ } }
      await pause(1500);
    };
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(r.data, 'base64')); return name + '.png'; };
    const goto = async (pose, npc) => { await evaluateAsync(cdp, POSE_JS(pose, npc)); };
    await open(GRID);
    for (const stop of STOPS) {
      const rec = { n: stop.n, id: stop.id, title: stop.title, files: [] };
      try {
        if (stop.pose || stop.npc) await goto(stopPose(stop), stop.npc); else await pause(800);
        rec.files.push(await shot(`stop-${String(stop.n).padStart(2, '0')}-${stop.id}`));
        if (stop.grid2) { await open(stop.grid2); rec.files.push(await shot(`stop-${String(stop.n).padStart(2, '0')}-${stop.id}-${stop.grid2}`)); await open(GRID); }
      } catch (e) { report.notes.push(`stop ${stop.n} ${stop.id}: ${short(e.message, 100)}`); }
      report.stops.push(rec);
    }
    for (const b of bugs) {
      if (!b.pos) continue;
      try {
        const p = b.pos.approx ? { x: b.pos.x + 5, y: b.pos.y + 4, yaw: yawToward({ x: b.pos.x + 5, y: b.pos.y + 4 }, [b.pos.x, b.pos.y]) } : b.pos;
        await goto(p); b.file = await shot(b.id.toLowerCase());
      } catch (e) { report.notes.push(`${b.id}: ${short(e.message, 100)}`); }
    }
  } finally {
    try { cdp && cdp.close(); } catch (e) { /* ignore */ }
    if (browser && browser.pid) killTree(browser.pid);
    if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* left behind */ }
  }
}

async function main() {
  const a = process.argv.slice(2), pi = a.indexOf('--port');
  const port = pi >= 0 ? Number(a[pi + 1]) : 9725;
  validatePort(port);
  if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
  mkdirSync(OUT_DIR, { recursive: true });
  const report = { date: new Date().toISOString().slice(0, 10), steps: [], stops: [], bugs: parseBugRows(readFileSync(path.join(ROOT, 'docs', 'bugs.md'), 'utf8')), notes: [] };
  let failed = false;
  if (!a.includes('--stills-only')) {
    for (const step of STEPS) {
      if (failed || a.includes('--skip-steps')) { report.steps.push({ id: step.id, status: 'SKIPPED' }); continue; }
      const r = runStep(step, port); report.steps.push(r);
      console.log(`${r.status} ${r.id} (${r.secs.toFixed(0)} s)${r.status === 'FAIL' ? '  - ' + r.note : ''}`);
      if (r.status === 'FAIL') failed = true;
    }
  }
  if (!failed && !a.includes('--no-stills')) {
    try { await takeStills(port, report.bugs, report); console.log(`stills: ${report.stops.reduce((n, s) => n + s.files.length, 0)} stops, ${report.bugs.filter((b) => b.file).length} OB`); }
    catch (e) { report.notes.push('stills failed: ' + e.message); console.log('FAIL stills - ' + e.message); failed = true; }
  } else if (failed) report.notes.push('stills not taken: a step failed');
  writeFileSync(path.join(OUT_DIR, 'report.md'), renderReport(report));
  console.log('report: docs/test-reports/m4-walk/report.md');
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
