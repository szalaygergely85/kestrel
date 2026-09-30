#!/usr/bin/env node
// tools/capture-rts.mjs (RTS-01a) - one headless browser pass over game/rts-test.html.
//   node tools/capture-rts.mjs --port 9110 [--grid 400x150] [--window 1600x900] [--out <dir>]
// Starts its own python server + Chrome/Edge (real GPU, same flags as capture-browser.mjs), opens the page with
// ?f3=1, drives REAL mouse events over CDP (box select, click, shift-box, enemy click, wheel), reads the page's
// `window.__rts` state + F3 stats + console, saves screenshots, prints one JSON summary. Kills only what it
// started. Port must be 9000-9999 and never 8000.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ROOT, validatePort, buildLaunchFlags, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate,
} from './capture-browser.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const port = Number(opt('port', NaN));
const grid = opt('grid', '400x150');
const [winW, winH] = opt('window', '1920x1080').split('x').map(Number);
const outDir = opt('out', path.join(os.tmpdir(), 'rts-capture'));
const query = opt('query', '');
validatePort(port);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const handles = { server: null, browser: null, profile: null };
function cleanup() {
  if (handles.browser && handles.browser.pid) killTree(handles.browser.pid);
  if (handles.server && handles.server.pid) killTree(handles.server.pid);
  if (handles.profile) { try { rmSync(handles.profile, { recursive: true, force: true }); } catch { /* best effort */ } }
}
process.once('SIGINT', () => { cleanup(); process.exit(1); });

const consoleLines = [];
async function main() {
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary found (set CHROME_PATH)');
  const debugPort = port + 1; validatePort(debugPort);
  handles.server = spawn('python', ['-m', 'http.server', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  handles.profile = path.join(os.tmpdir(), 'kestrel-rts-profile-' + port);
  handles.browser = spawn(binary, [`--remote-debugging-port=${debugPort}`, '--headless=new', ...buildLaunchFlags({}),
    '--no-sandbox', `--window-size=${winW},${winH}`, `--user-data-dir=${handles.profile}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(debugPort, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
  cdp.onEvent((method, p) => {
    if (method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION ' + JSON.stringify(p.exceptionDetails).slice(0, 400));
    if (method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ');
      consoleLines.push(`${p.type}: ${text.slice(0, 300)}`);
    }
  });
  const loaded = new Promise((res) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') res(); }));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/rts-test.html?f3=1&grid=${grid}${query ? '&' + query : ''}` });
  await loaded;
  const t0 = Date.now();
  while (!(await evaluate(cdp, 'typeof window.__rts !== "undefined"'))) {
    if (Date.now() - t0 > 60000) throw new Error('timed out waiting for window.__rts; console: ' + consoleLines.slice(-8).join(' | '));
    await sleep(300);
  }
  await sleep(2500); // frames + pass timers

  const shot = async (name) => {
    const url = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: '__rts.snap()' });
    const f = path.join(outDir, `${grid}-${name}.png`);
    writeFileSync(f, Buffer.from(url.result.value.split(',')[1], 'base64'));
    return f;
  };
  const rect = JSON.parse(await evaluate(cdp, 'JSON.stringify(document.getElementById("screen").getBoundingClientRect())'));
  const dims = JSON.parse(await evaluate(cdp, 'JSON.stringify({cols: __rts.rt.cols, rows: __rts.rt.rows, backend: __rts.rt.backend, dpr: devicePixelRatio, pxCellW: __rts.rt.pxCellW, pxCellH: __rts.rt.pxCellH})'));
  const cellPx = (col, row) => ({ x: rect.left + (col + 0.5) * rect.width / dims.cols, y: rect.top + (row + 0.5) * rect.height / dims.rows });
  const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
  const press = async (x, y, mod = 0) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1, modifiers: mod }); };
  const release = (x, y, mod = 0) => mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1, modifiers: mod });
  const state = async () => JSON.parse(await evaluate(cdp, 'JSON.stringify(__rts.stats())'));
  const sum = { grid, dims, rect };

  sum.terrain = JSON.parse(await evaluate(cdp, 'JSON.stringify({far: __rts.world.terrain.farReady, prog: __rts.world.terrain.bakeProgress, near: __rts.world.terrain.nearReady})'));
  if (opt('eval', '')) { console.log('EVAL', JSON.stringify(await evaluate(cdp, opt('eval', '')))); cdp.close(); return; }
  sum.idle = await state();
  sum.cells = JSON.parse(await evaluate(cdp, 'JSON.stringify((() => { const o = new Float64Array(3), r = []; for (let i = 0; i < __rts.units.count; i++) { __rts.projectBody(i, o); if (o[2] > 0 && o[0] >= 0 && o[0] < __rts.rt.cols && o[1] >= 0 && o[1] < __rts.rt.rows) r.push([i, Math.round(o[0]), Math.round(o[1])]); } return r; })())'));
  sum.shotIdle = await shot('1-idle');

  // box select: centre 40 % x 40 % of the view
  const a = cellPx(dims.cols * 0.1, dims.rows * 0.1), b = cellPx(dims.cols * 0.9, dims.rows * 0.9);
  await press(a.x, a.y);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6, { buttons: 1 }); await sleep(40); }
  await sleep(200);
  sum.shotBoxDrag = await shot('2-box-drag');
  await release(b.x, b.y);
  await sleep(500);
  sum.afterBox = await state();
  sum.lastBox = JSON.parse(await evaluate(cdp, 'JSON.stringify(__rts.lastBox)'));
  sum.boxOverlay = JSON.parse(await evaluate(cdp, 'JSON.stringify(__rts.ov.stats)'));
  sum.afterBoxEnemySelected = await evaluate(cdp, '(() => { let e = 0; for (let i = 0; i < __rts.units.count; i++) if (__rts.sel.flags[i] && __rts.units.team[i] !== 1) e++; return e; })()');
  sum.shotBox = await shot('3-selected');

  // click one own unit (nearest to the screen centre that is unselected), then one enemy, then shift-click another own
  const pick = async (team, excludeSelected) => JSON.parse(await evaluate(cdp, `JSON.stringify((() => {
    const r = __rts, out = new Float64Array(3); let best = -1, bd = 1e9;
    for (let i = 0; i < r.units.count; i++) {
      if (r.units.team[i] !== ${team}) continue; if (${excludeSelected} && r.sel.flags[i]) continue;
      r.projectBody(i, out); if (out[2] <= 0 || out[0] < 10 || out[0] > r.rt.cols - 10 || out[1] < 10 || out[1] > r.rt.rows - 10) continue;
      const d = Math.hypot(out[0] - r.rt.cols / 2, out[1] - r.rt.rows / 2); if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null; r.projectBody(best, out); return { id: best, col: out[0], row: out[1] };
  })())`));
  const own = await pick(1, true);
  if (own) {
    const p = cellPx(own.col, own.row);
    await mouse('mouseMoved', p.x, p.y); await sleep(300);
    sum.hoverOwn = (await state()).hoverId; sum.hoverOwnExpected = own.id;
    await press(p.x, p.y); await release(p.x, p.y); await sleep(400);
    sum.afterClickOwn = await state();
    sum.clickedId = own.id;
    sum.shotClick = await shot('4-click-own');
  }
  const foe = await pick(2, false);
  if (foe) {
    const p = cellPx(foe.col, foe.row);
    await mouse('mouseMoved', p.x, p.y); await sleep(300);
    sum.hoverEnemy = (await state()).hoverId; sum.hoverEnemyExpected = foe.id;
    await press(p.x, p.y); await release(p.x, p.y); await sleep(400);
    sum.afterClickEnemy = await state(); // enemy never selected: selection unchanged from afterClickOwn
    sum.enemySelected = await evaluate(cdp, `!!__rts.sel.flags[${foe.id}]`);
  }
  const own2 = await pick(1, true);
  if (own2) {
    const p = cellPx(own2.col, own2.row);
    await press(p.x, p.y, 8); await release(p.x, p.y, 8); await sleep(400);
    sum.afterShiftClick = await state();
  }

  // wheel zoom + sample the F3 numbers over a few seconds
  await mouse('mouseMoved', rect.left + rect.width / 2, rect.top + rect.height / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, deltaX: 0, deltaY: 100 });
  await sleep(300);
  sum.zoomAfterWheel = await evaluate(cdp, '__rts.rts.zoom');
  await sleep(3500);
  sum.f3 = await evaluate(cdp, '__rts.hud.f3El.textContent');
  sum.gpu = JSON.parse(await evaluate(cdp, 'JSON.stringify((() => { const s = __rts.gpuPipeline.stats, o = __rts.rt.overlayPassStats; return { instancedDraws: s.instancedDraws, instances: s.instances, voxelDraws: s.voxelDraws, gpuMsP50: s.gpuMsP50, gpuMsP95: s.gpuMsP95, overlayP95: o && o.gpuMsP95, loop: __rts.engine.loop.stats, fps: __rts.engine.loop.fps }; })())'));
  sum.shotFinal = await shot('5-final');
  sum.console = consoleLines.filter((l) => /^(error|warning|EXCEPTION)/.test(l));
  cdp.close();
  console.log(JSON.stringify(sum, null, 1));
}
main().catch((e) => { console.error('capture-rts: ' + e.message); process.exitCode = 1; }).finally(cleanup);
