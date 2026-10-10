// CH1-09: headless real-browser check of the chapter card state machine (dim 50 %, typed lines, journal hand-off, flags,
// input lock, once) via game/js/quest/chapterCard.preview.html. CDP helpers from capture-browser.mjs, shape of
// verify-chest-hook.mjs. Run: node tools/verify-chapter-card.mjs {port} [webgpu]   (port+1 = CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-chapter-card-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 500, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(250); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/js/quest/chapterCard.preview.html` });
  let ready = false;
  for (let i = 0; i < 60; i++) { await pause(250); if (await evaluate(cdp, '!!window.__chapterCardPreview')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  const P = '__chapterCardPreview';
  assert.equal(await evaluate(cdp, `${P}.card.isLocked()`), false);
  assert.equal(await evaluate(cdp, `${P}.card.trigger()`), true);
  await evaluate(cdp, `${P}.step(0.5)`);
  assert.ok(Math.abs(await evaluate(cdp, `${P}.dim.all`) - 0.75) < 0.02, 'half dim at 0.5 s');
  await evaluate(cdp, `${P}.step(1.5)`);
  assert.equal(await evaluate(cdp, `${P}.dim.all`), 0.5);
  assert.equal(await evaluate(cdp, `${P}.card.isLocked()`), true);
  await shot('chapter-card-typing-' + backend);
  await evaluate(cdp, `${P}.step(1.0)`); await evaluate(cdp, `${P}.step(1.2)`);
  const txt = await evaluate(cdp, 'document.getElementById("out").textContent');
  assert.ok(/CHAPTER COMPLETE/.test(txt) && /Beyond the Wall/.test(txt) && /Next chapter: The River and the Forgotten/.test(txt), txt);
  await shot('chapter-card-full-' + backend);
  await evaluate(cdp, `${P}.step(2.2)`);
  assert.deepEqual(await evaluate(cdp, `${P}.opened`), ['journalCh1']);
  await evaluate(cdp, `${P}.closeNote()`); await evaluate(cdp, `${P}.step(0.2)`);
  assert.equal(await evaluate(cdp, `${P}.card.isLocked()`), false);
  assert.equal(await evaluate(cdp, `${P}.card.trigger()`), false, 'shows once');
  assert.deepEqual(await evaluate(cdp, `({d:${P}.world.state["chapter.ch1.done"],n:${P}.world.state["chapter.next"]})`), { d: true, n: 'ch2' });
  assert.deepEqual(errors, []);
  console.log('Chapter card: dim 50 %, typed 3 lines, journal hand-off, flags, input lock, once PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
}
