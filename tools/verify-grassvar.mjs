// GRASS-VARIETY-01: real-GPU stills of the 3 grass carpet types (clover / meadow / seed-head) at the start meadow and Burl's home.
// Same CDP shape as tools/verify-chest-hook.mjs / verify-decor.mjs. Saves docs/test-reports/grassvar/{meadow,burl}-<backend>.png; asserts no page exceptions.
// Run: node tools/verify-grassvar.mjs {port} [webgpu]      (PC-B ports 9500-9999; port+1 = CDP; this item: 9575)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(backend === 'webgpu', 'backend must be webgpu');
// x,y,z,yawDeg,pitchDeg (z a little above the ground: the body settles); "start meadow" = the big field west of the tower, Burl's home = (1404,1010)
const POSES = { meadow: '1452,1056,8,200,-14', burl: '1404,1010,8,90,-14' };

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-grassvar-'));
const out = path.join(ROOT, 'docs/test-reports/grassvar'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, failed = false;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  for (const [name, at] of Object.entries(POSES)) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}&at=${at}` });
    let ready = false;
    for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
    assert.ok(ready, 'boot failed at ' + name + ' ' + JSON.stringify(errors));
    await evaluate(cdp, 'window.__debug.look.locked = true');
    await pause(6000); // terrain bake + carpet class map + settle
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, `${name}-${backend}.png`), Buffer.from(shot.data, 'base64'));
    console.log('saved ' + path.join('docs/test-reports/grassvar', `${name}-${backend}.png`));
  }
  assert.deepEqual(errors, [], 'no page exceptions');
  console.log('grassvar stills PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
