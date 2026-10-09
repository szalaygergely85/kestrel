// S8-B1-10 (docs/architecture.md 38.10c, docs/sprints/sprint-8-queue.md): headless AC for the device-lost card.
// The Node AC (game/js/deviceLost.test.js) covers the pure freeze/autosave/card logic with a mock device; this
// script drives the REAL game (game/index.html) so `?dev=1`'s `window.__kestrel.loseDevice()` dev hook
// (GpuDeviceWebGPU.js `_forceLost`) exercises the real device.lost wiring in game/js/main.js end to end:
// the card appears within 2 s, R reloads, and the player's position is restored (from the one synchronous
// autosave taken at the moment of loss) within 0.01 m. webgpu only.
// Run: node tools/verify-device-lost.mjs 9512 (webgpu, default)
// PC-B lane B1 port range only (9500-9574).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9512);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-device-lost-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 150, deviceScaleFactor: 1, mobile: false });

  // `?dev=1` is required for window.__kestrel.loseDevice() to exist (38.10c dev hook gate). `?voxelbench=0` keeps
  // the real wake-then-play timeline out of the way (no title menu/pause overlay); `?save=1` forces the autosave
  // path on in this headless browser (main.js's saveEnabled would otherwise see navigator.webdriver and skip it).
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=1&voxelbench=0&grid=400x150&backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'world:loaded never fired: ' + JSON.stringify(errors));
  console.log('[1/5] world:loaded fired');

  assert.equal(await evaluate(cdp, 'typeof window.__kestrel?.loseDevice'), 'function', '?dev=1 did not expose window.__kestrel.loseDevice()');
  console.log('[2/5] dev hook present');

  const posBefore = await evaluate(cdp, '(()=>{const t=window.__debug.playerHandle.data.transform;return {x:t.x,y:t.y,z:t.z};})()');

  const t0 = Date.now();
  await evaluate(cdp, 'window.__kestrel.loseDevice()');
  let cardShown = false;
  while (Date.now() - t0 < 2000) { await pause(100); if (await evaluate(cdp, "!!document.getElementById('device-lost-card')")) { cardShown = true; break; } }
  assert.ok(cardShown, 'device-lost card did not appear within 2 s of loseDevice()');
  console.log('[3/5] card shown within ' + (Date.now() - t0) + ' ms');

  const savedSlot = await evaluate(cdp, "JSON.stringify(window.__debug.saveRelay && window.__debug.saveRelay.lastResult)");
  console.log('[4/5] autosave result: ' + savedSlot);

  // R reloads (the card's own keydown listener calls location.reload(), per docs/architecture.md 38.10c).
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyR', key: 'r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyR', key: 'r' });
  ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'world:loaded never fired after reload');
  const posAfter = await evaluate(cdp, '(()=>{const t=window.__debug.playerHandle.data.transform;return {x:t.x,y:t.y,z:t.z};})()');
  const dist = Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y, posAfter.z - posBefore.z);
  assert.ok(dist <= 0.01, 'player position not restored within 0.01 m after reload: ' + JSON.stringify({ posBefore, posAfter, dist }));
  console.log('[5/5] position restored within 0.01 m: ' + dist.toFixed(4));

  assert.deepEqual(errors, [], 'console exceptions: ' + JSON.stringify(errors));
  console.log('Device lost (S8-B1-10): card within 2 s, reload restores the autosaved position, real-GPU PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
