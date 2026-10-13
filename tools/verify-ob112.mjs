// OB-112: headless check of the ONE inventory screen. Opens it with I at a 480x180 grid and saves a still (tmp/ob112-inventory.png).
// Run ONCE: node tools/verify-ob112.mjs {port}   (PC-B ports 9500-9999; port+1 is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-ob112-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&grid=480x180` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock: pin it
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input
  await pause(500);
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(80); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(400); };
  const state = () => evaluate(cdp, '(() => { const v = window.__debug.invView; return { open: !!(v && v.isOpen), ok: !!(v && v.previewOk) }; })()');
  assert.equal((await state()).open, false, 'closed at start');
  for (const [code, k] of [['KeyI', 'i'], ['KeyC', 'c'], ['Tab', 'Tab']]) { // each of I / C / Tab opens and closes the same screen
    await key(code, k); assert.equal((await state()).open, true, code + ' opens'); await key(code, k); assert.equal((await state()).open, false, code + ' closes');
  }
  await key('KeyI', 'i'); await pause(1200);
  const s = await state(); console.log(JSON.stringify({ s, errors: errors.length }));
  assert.ok(s.open && s.ok, 'screen open with a working Wick preview');
  mkdirSync('tmp', { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp/ob112-inventory.png', Buffer.from(shot.data, 'base64'));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('OB-112 verify PASS - still: tmp/ob112-inventory.png');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
