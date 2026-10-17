// OB-114: stills of the Quaternius Rock_Medium boulders after the moss_cap remap (tools/fix-rock-moss.mjs): stone, moss only on up faces.
// Run: node tools/verify-ob114.mjs <port>  (PC-B 9500-9999; CDP = port+1). Stills -> docs/test-reports/ob114/. Not run in the lane; the main session runs it once.
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9580);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob114-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const out = path.join(ROOT, 'docs/test-reports/ob114'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
let browser, cdp;
async function load(query) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(query)}` });
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { await evaluate(cdp, 'setInterval(() => { if (window.__debug && window.__debug.look) window.__debug.look.locked = true; }, 30), true'); return true; } } // headless: no pointer lock -> sim paused (see verify-swim)
  return false;
}
const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name), Buffer.from(s.data, 'base64')); console.log('   still docs/test-reports/ob114/' + name); };
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  // camera ~5 m west of each boulder (z = ground + 1.7 is applied by the pose), looking east (yaw 0 = +x assumed; adjust if the still faces away)
  const poses = { mdw000: [1423.9, 1021.5, 1.6, 0, 8], rs046: [1276.6, 1052.9, -24.8, 0, 8], rs057: [1187.4, 1045.5, -49.5, 0, 8] };
  for (const [name, p] of Object.entries(poses)) {
    assert.ok(await load(`dev=1&backend=webgpu&at=${p.join(',')}`), name + ': world never ready ' + JSON.stringify(errors));
    await pause(1500); await shot(`ob114-${name}.png`);
  }
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('OB-114 stills written');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
