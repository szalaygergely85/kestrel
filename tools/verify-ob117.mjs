// OB-117: picture is fixed to the chosen aspect ratio (default 16:9). Loads the game per ?quality= preset and resizes the window via CDP; prints the canvas CSS aspect each time.
// Run ONCE: node tools/verify-ob117.mjs {port}   (PC-B ports 9500-9999; port+1 is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-ob117-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  // Cases: default 16:9 at 4 presets x 5 windows; then a saved aspect (needs the boot line `NEEDS B1-main` in the lane entry).
  const cases = [['low', null, 16 / 9], ['high', null, 16 / 9], ['ultra', null, 16 / 9], ['extreme', null, 16 / 9], ['high', '4:3', 4 / 3], ['high', 'fill', null]];
  for (const [q, saved, ratio] of cases) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&autoquality=0&quality=${q}` });
    await pause(1500);
    await evaluate(cdp, saved ? `(() => { const s = JSON.parse(window.localStorage.getItem('kestrel.settings') || '{}'); s.aspect = ${JSON.stringify(saved)}; window.localStorage.setItem('kestrel.settings', JSON.stringify(s)); })()` : 'window.localStorage.removeItem("kestrel.settings")');
    await cdp.send('Page.reload');
    for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, "(() => { const e = window.__debug && window.__debug.rt; const c = e && e.canvas; return !!(c && c.style.width); })()")) break; } // wait for the game render target canvas to be sized (not a 300x150 helper canvas)
    for (const [w, h, dpr] of [[1280, 720, 1], [1920, 1080, 1], [1366, 768, 1.25], [1326, 638, 1], [900, 900, 1]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
      await pause(700);
      const r = await evaluate(cdp, '(() => { const e = window.__debug && window.__debug.rt; const c = (e && e.canvas) || document.querySelector("canvas"); const b = c.getBoundingClientRect(); return { iw: innerWidth, ih: innerHeight, cw: b.width, ch: b.height }; })()');
      const aspect = r.cw / r.ch, want = ratio ?? r.iw / r.ih;
      console.log(`${q}/${saved || 'default'} ${w}x${h}@${dpr}: css ${r.cw.toFixed(1)}x${r.ch.toFixed(1)} aspect ${aspect.toFixed(4)} want ${want.toFixed(4)}`);
      assert.ok(Math.abs(aspect / want - 1) < 0.005, `aspect ${aspect} != ${want}`);
      assert.ok(r.cw <= r.iw + 1 && r.ch <= r.ih + 1 && (Math.abs(r.cw - r.iw) < 1 || Math.abs(r.ch - r.ih) < 1), 'largest box in the window');
    }
  }
  console.log('OB-117 verify PASS - canvas CSS aspect == chosen ratio (default 16:9, 4:3, fill)');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
