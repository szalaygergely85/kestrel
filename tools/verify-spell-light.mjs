// SPELL-05b still: casts Spark and Light Orb in-page at night -> docs/test-reports/spell-spark-night.png, spell-orb-night.png.
// Run: node tools/verify-spell-light.mjs <port> [suffix] (PC-B ports 9500-9999, CDP = port+1). Env: SPOT="x,y,z,yawDeg,pitchDeg" HOUR=23
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9735), suffix = process.argv[3] || ''; validatePort(port);
const hour = Number(process.env.HOUR || 23);
const [sx, sy, sz, syaw, spitch] = (process.env.SPOT || '1440,1004,12,200,5').split(',').map(Number);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-spl-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
const killer = setTimeout(() => { console.error('verify-spell-light timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 260000);
const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(ROOT, 'docs/test-reports', name + suffix + '.png'), Buffer.from(s.data, 'base64')); };
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu', swiftshader: process.env.SWIFT === '1' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=medium&backend=webgpu&title=0&time=${hour}` });
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world && window.__debug.spells && window.__debug.spells.spark)')); } catch { /* navigating */ } }
  if (!ok) throw new Error('never ready');
  await pause(4000);
  await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${sx};t.y=${sy};t.z=${sz};t.yawDeg=${syaw};t.pitchDeg=${spitch};})()`);
  await pause(1500);
  // learn both spells (tier 1) and give mana; cast through the caster so the real dispatcher path is used
  await evaluate(cdp, `(()=>{const s=__debug.spells;s.book.learn('spark');s.book.learn('lightOrb');return 1})()`);
  await evaluate(cdp, `__debug.spells.caster.cast('spark', __debug.playerHandle.data)`);
  await pause(350);
  console.log('spark', await evaluate(cdp, 'JSON.stringify(__debug.spells.view.stats)'));
  await shot('spell-spark-night');
  await pause(2500);
  await evaluate(cdp, `__debug.spells.caster.cast('lightOrb', __debug.playerHandle.data)`);
  await pause(2500);
  console.log('orb', await evaluate(cdp, 'JSON.stringify(__debug.spells.view.stats)'));
  await shot('spell-orb-night');
} finally {
  clearTimeout(killer); cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
