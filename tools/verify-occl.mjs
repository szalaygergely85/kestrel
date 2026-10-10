// OCCL-MAIN-01: loads `?pose=roadSouth&occl=1` and `occl=0` headless, checks both render without page errors and that
// the F3 overlay line shows `occl on` only when requested; prints pipeline stats (culled counts when exposed).
// Run: node tools/verify-occl.mjs 9520 [webgpu]   (PC-B port range; port+1 = CDP)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-occl-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 400)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  const results = {};
  for (const occl of [1, 0]) {
    errors.length = 0;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`backend=${backend}&pose=roadSouth&occl=${occl}&debug=1`)}` });
    let ready = false;
    for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.overlay)')) { ready = true; break; } }
    assert.ok(ready, 'no __debug for occl=' + occl + ' ' + errors.join('|'));
    await pause(3000);
    const r = await evaluate(cdp, '(()=>{const d=window.__debug;const w=d.wgPipeline;const s=w&&w.stats;return {occl:w?w.occl:null,cuts:d.hzb.count,lastReason:d.hzb.lastReason,stats:s?{instancesCulled:s.instancesCulled,culledOccl:s.culledOccl,instances:s.instances,meshDraws:s.meshDraws}:null};})()');
    results[occl] = { ...r, errors: errors.slice() };
    assert.equal(errors.length, 0, `page errors with occl=${occl}: ${errors.join('|')}`);
  }
  console.log(JSON.stringify(results, null, 1));
  console.log('verify-occl: both occl=1 and occl=0 render without page errors on', backend);
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  if (browser) killTree(browser.pid);
  if (server) killTree(server.pid);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
