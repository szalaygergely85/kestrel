// OB-103b / D-075 G1: grass carpet ON per quality preset. Loads game/index.html with each preset (+ ?carpet=0|1 overrides) and reads
// world.carpet (built?) + world.carpetQuality (on, radiusScale, densScale); then switches preset live through the Settings path
// (applyCarpetPreset) and re-reads. Same CDP approach as tools/verify-ob112.mjs. PC-B range only (9500-9574; port+1 is CDP).
// Run: node tools/verify-ob103b.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob103b-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// expected [built, on, radiusScale, densScale] per case (D-075 / proposal G1 section 6)
const CASES = [
  ['quality=low', [true, false, 0.5, 0.6]], ['quality=medium', [true, true, 0.5, 0.6]], ['quality=high', [true, true, 1, 1]],
  ['quality=ultra', [true, true, 1.4, 1.25]], ['quality=high&carpet=0', [false, false, 1, 1]], ['quality=low&carpet=1', [true, true, 0.5, 0.6]],
];
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  const read = () => evaluate(cdp, '(() => { const w = window.__debug.engine.world; const q = w && w.carpetQuality; return w ? [!!w.carpet, q.on, q.radiusScale, q.densScale] : null; })()');
  for (const [query, want] of CASES) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&autoquality=0&${query}` });
    let got = null;
    for (let i = 0; i < 120 && !got; i++) { await pause(500); try { got = await evaluate(cdp, '(() => { const w = window.__debug && window.__debug.engine && window.__debug.engine.world; return w && w.terrain ? 1 : 0; })()') ? await read() : null; } catch { /* page still loading */ } }
    assert.ok(got, `${query}: world loaded ${JSON.stringify(errors)}`);
    // `on` is only meaningful when the carpet was built; with ?carpet=0 the world has no carpet at all
    assert.deepEqual(got, want, `${query}: [built,on,radiusScale,densScale]`);
    console.log('PASS', query, JSON.stringify(got));
  }
  // live Settings path: ultra -> low -> medium, no reload
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&autoquality=0&quality=ultra` });
  for (let i = 0; i < 120; i++) { await pause(500); try { if (await evaluate(cdp, '!!(window.__debug && window.__debug.engine.world && window.__debug.engine.world.carpet)')) break; } catch { /* loading */ } }
  const live = async (n) => evaluate(cdp, `(async () => { const m = await import('/game/js/ui/gfxPresets.js'); m.applyCarpetPreset(${JSON.stringify(n)}, window.__debug.engine.world, ''); const q = window.__debug.engine.world.carpetQuality; return [q.on, q.radiusScale, q.densScale]; })()`);
  assert.deepEqual(await live('low'), [false, 0.5, 0.6]); assert.deepEqual(await live('medium'), [true, 0.5, 0.6]);
  console.log('PASS live preset change low/medium');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('OB-103b verify PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
