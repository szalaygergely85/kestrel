// S8-B2-13b NEEDS B1-main (docs/architecture.md 38.14 "Owners", B1 kestrel-1 item): headless check that the
// `?dev=1` window.__kestrel.ripple(x, y, amp) dev hook (game/js/main.js) no longer throws. Before this story it
// called the removed `world.water.addRipple` (TypeError); now it calls the module-scope `ripples.add(...)`
// (engine/fx/ripples.js) and hands the ring buffer to the renderer via `fb.ripples`. Same CDP approach as
// tools/verify-device-lost.mjs, reusing capture-browser.mjs's exported helpers - PC-B lane B1 port range only
// (9500-9574).
// Run: node tools/verify-ripple-hook.mjs 9513 (webgpu, default)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9513);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ripple-hook-'));
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

  // `?dev=1` is required for window.__kestrel.ripple(...) to exist. `?voxelbench=0` keeps the real
  // wake-then-play timeline out of the way (no title menu/pause overlay).
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&voxelbench=0&grid=400x150&backend=${backend}`)}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'world:loaded never fired: ' + JSON.stringify(errors));
  console.log('[1/3] world:loaded fired');

  assert.equal(await evaluate(cdp, 'typeof window.__kestrel?.ripple'), 'function', '?dev=1 did not expose window.__kestrel.ripple()');
  console.log('[2/3] dev hook present');

  // Before this story this threw (removed world.water.addRipple). Call it a few times, including a bad
  // (non-finite) amp that ripples.add() must reject silently rather than throw.
  await evaluate(cdp, 'window.__kestrel.ripple(1480.0, 1018.0, 0.8); window.__kestrel.ripple(1481.5, 1019.2, 1.4); window.__kestrel.ripple(0, 0, NaN);');
  await pause(100);
  assert.deepEqual(errors, [], 'console exceptions calling __kestrel.ripple: ' + JSON.stringify(errors));
  console.log('[3/3] ripple(x, y, amp) called with no console exception');

  console.log('Ripple dev hook (S8-B2-13b NEEDS B1-main): window.__kestrel.ripple(x, y, amp) no longer throws, real-GPU PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
