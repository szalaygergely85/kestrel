// CH1-04a: headless capture of the notice banner via game/js/ui/noticeView.preview.html (2D canvas, no GPU backend needed).
// Run: node tools/verify-notice.mjs 9575 [backend]   (PC-B kestrel-2 range 9575-9649; next port is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'canvas2d';
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-notice-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 320, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/js/ui/noticeView.preview.html` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(200); if (await evaluate(cdp, '!!window.__noticePreview')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, '__noticePreview.push("relay")');
  await pause(1200); // past the 0.3 s fade-in
  assert.equal(await evaluate(cdp, '__noticePreview.view.alpha'), 1);
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(out, 'notice-' + backend + '.png'), Buffer.from(s.data, 'base64'));
  await evaluate(cdp, '__noticePreview.hidden = true'); await pause(300);
  assert.equal(await evaluate(cdp, '__noticePreview.view.alpha'), 1, 'timer paused while hidden');
  assert.deepEqual(errors, []);
  console.log('Notice view: shown at full alpha, timer paused while hidden, screenshot saved PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
