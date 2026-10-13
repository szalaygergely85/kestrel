#!/usr/bin/env node
// tools/shot-browser.mjs - headless PNG of the live game page (own server + headless Chrome over CDP, ports 9500-9999).
//   node tools/shot-browser.mjs --port 9652 --backend webgpu|webgl2 --query "save=0&grid=240x90" --out shot.png
//        [--eval "<js run after the page is ready, before the shot>"] [--frames 6]
// Prints a JSON line with the PNG path and `evalResult` (the value of --eval). Used by BUG-WEBGPU-EYELID-01 / FARTERRAIN-01 checks.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import { withTimeFreeze, parseTimeArg } from './tool-url.mjs'; // DN-04a
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((v) => (/^--time=/.test(v) ? ['--time', v.slice(7)] : v)).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port); validatePort(port);
const backend = args.backend || 'webgl2';
const url = `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`backend=${backend}&${args.query || 'save=0'}`, parseTimeArg(args.time))}`;
const handles = {};
function cleanup() {
  if (handles.b) killTree(handles.b.pid);
  if (handles.s) killTree(handles.s.pid);
  if (handles.dir) { try { rmSync(handles.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
const killer = setTimeout(() => { console.error('shot-browser: overall timeout'); cleanup(); process.exit(2); }, Number(args.timeout || 80) * 1000);
process.once('SIGINT', () => { cleanup(); process.exit(1); });
const WAIT = (frames) => `(async () => { for (let i = 0; i < 4000 && !(window.__debug && window.__debug.playerHandle && window.__debug.world); i++) await new Promise((r) => setTimeout(r, 50));
  const fr = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < ${frames}; i++) await fr(); return true; })()`;
async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 2000));
  return r.result.value;
}
let evalResult, errors = [];
try {
  const binary = findBrowserBinary();
  handles.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  handles.dir = path.join(os.tmpdir(), 'kestrel-shot-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({ backend }), '--no-sandbox', '--window-size=1280,720', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (args.log && m === 'Runtime.consoleAPICalled') console.error('[page ' + p.type + '] ' + (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  if (args.viewport) { const [vw, vh] = args.viewport.split('x').map(Number); await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false }); } // optional --viewport WxH
  const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url });
  await loaded;
  await evalIn(cdp, WAIT(Number(args.frames || 6)));
  if (args.eval) evalResult = await evalIn(cdp, args.eval);
  await evalIn(cdp, WAIT(Number(args.frames || 6)));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(args.out, Buffer.from(shot.data, 'base64'));
  cdp.close();
} finally { clearTimeout(killer); cleanup(); }
console.log(JSON.stringify({ url, out: args.out, evalResult, errors }));
