// CHARGEN-17: headless check of the new-game creation screen in the real game (WebGPU).
// Loads game/index.html?dev=1&save=0&backend=webgpu (title menu up), drives window.__debug.menuHost with synthetic key edges:
// New game -> slot -> creation screen opens, Back returns, again -> change skin -> Confirm -> menu closes; 0 console errors.
// Run: node tools/verify-charcreate.mjs <port>   (PC-B lane B1 ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-cc-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.menuHost && window.__debug.menuHost.active)')) { ready = true; break; } }
  assert.ok(ready, 'title menu never appeared: ' + JSON.stringify(errors));
  console.log('[1/4] title menu up');
  const press = (...c) => evaluate(cdp, `(()=>{const q=new Set(${JSON.stringify(c)});window.__debug.menuHost.step((x)=>q.has(x));return [window.__debug.menuHost.createOpen,window.__debug.menuHost.active];})()`);
  await press('Enter'); let s = await press('Enter');
  assert.deepEqual(s, [true, true], 'creation screen should open and keep the menu active');
  await pause(500);
  console.log('[2/4] creation screen open');
  s = await press('Escape'); assert.deepEqual(s, [false, true], 'Back returns to the menu');
  await press('Enter'); await press('Enter'); await press('KeyD');
  for (let i = 0; i < 5; i++) await press('KeyS');
  s = await press('Enter'); assert.deepEqual(s, [false, false], 'Confirm closes the menu: ' + JSON.stringify(errors));
  console.log('[3/4] Back + Confirm ok');
  await pause(1500);
  assert.equal(errors.length, 0, 'console errors: ' + JSON.stringify(errors).slice(0, 600));
  console.log('[4/4] no console errors\nPASS');
} finally {
  cdp?.close();
  if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
