// OB-089: still of the real game at ?pose=roadSouth (mid-distance trees + buildings in front of the hills), for the owner look.
// Run: node tools/verify-ob089.mjs 9725  -> docs/test-reports/captures/ob089-roadSouth.png + ob089-roadSouth-noshadow.png (PC-B port range 9500-9999, CDP = port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob089-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  // OB-089 part 3: wait for the world (poll the same ready flag the other verify scripts use) instead of a blind sleep -> no loading-screen stills
  const READY = '!!(window.__debug && window.__debug.playerHandle && window.__debug.wgPipeline && window.__debug.wgPipeline.ready)';
  async function waitReady() {
    let ok = false;
    for (let i = 0; i < 200 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, READY)); } catch { /* page still navigating */ } }
    if (!ok) throw new Error('world never became ready (loading screen)');
    await pause(6000); // lazy meshes + streaming cells settle
  }
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?pose=roadSouth&gpu=webgpu` });
  await waitReady();
  await shot('ob089-roadSouth');
  // second still with the sun shadows off (gfxBoot ?shadows=off): if trees/buildings turn lit, the dark navy is the shadow term
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?pose=roadSouth&gpu=webgpu&shadows=off` });
  await waitReady();
  await shot('ob089-roadSouth-noshadow');
  console.log('OB-089 still saved: docs/test-reports/captures/ob089-roadSouth.png', JSON.stringify(errors.map((e) => e.text)));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
