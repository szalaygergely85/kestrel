// WM-10: headless still of the whole-map `M` card in the real game (game/index.html). Run: node tools/verify-wm10.mjs 9500
// Seeds region.seen (tower, ford, whitecombs), presses M, saves docs/test-reports/wm10/map-open.png for the owner look.
// PC-B port range only (9500-9574 for kestrel-1). Same CDP helpers as tools/verify-map-wire.mjs.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
import { withTimeFreeze } from './tool-url.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-wm10-'));
const out = path.join(ROOT, 'docs/test-reports/wm10'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const key = async (code, k = code) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze('voxelbench=0&grid=240x90&backend=webgpu')}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, "window.__debug.world.state['ui.mapCard.dismissed'] === true")) break; }
  await evaluate(cdp, "window.__debug.world.state['region.seen'] = ['tower','ford','whitecombs']");
  await key('KeyM', 'm');
  for (let i = 0; i < 30; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen()')) break; }
  await pause(900); // fade-in
  const info = await evaluate(cdp, '(()=>{const v=window.__debug.getMapChart();return v&&{w:v.art.w,h:v.art.h,opaque:!!v.opaque,pos:v.position};})()');
  assert.ok(info && info.opaque, 'whole-map view active: ' + JSON.stringify(info));
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'map-open.png'), Buffer.from(s.data, 'base64'));
  console.log(JSON.stringify(info), 'errors:', errors.length);
  assert.deepEqual(errors, []);
  console.log('WM-10 whole-map card opened; still in docs/test-reports/wm10/map-open.png PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
