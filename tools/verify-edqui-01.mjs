// ED-QUI-01/02 (kestrel-4): headless still of the Quest tab cards + prereq add/remove. Run: node tools/verify-edqui-01.mjs 9730
// Same CDP shape as verify-chest-hook.mjs. PC-B ports only (9500-9574; port+1 is CDP).
// Run: node tools/verify-edq-05.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edqui01-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html` });

  // Open the Quests tab once the editor's tab bar exists.
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '!!document.querySelector(\'[data-dock-tab="quests"]\')'); }
  assert.ok(ready, 'editor did not boot: ' + JSON.stringify(errors));
  for (let i = 0; i < 60 && !(await evaluate(cdp, '!!window.__questPanel')); i++) { await evaluate(cdp, "document.querySelector('[data-dock-tab=quests]').click()"); await pause(500); }   // main.js boots lazily: re-click until mounted
  let rows = 0;
  for (let i = 0; i < 50 && rows < 10; i++) { await pause(200); rows = await evaluate(cdp, 'document.querySelectorAll("#quest-list .q-row").length'); }
  assert.ok(rows >= 10, 'quest list rows: ' + rows);
  const ev = (js) => evaluate(cdp, js);
  await ev('window.__questPanel.select("burl.boars")'); await pause(200);
  const info = JSON.parse(await ev('JSON.stringify({cards: [...document.querySelectorAll("#quest-detail .q-card-n")].map(e => e.textContent), status: document.getElementById("quest-status").textContent, req: [...document.querySelectorAll("#quest-prereq .q-prow")].map(r => r.textContent)})'));
  assert.deepEqual(info.cards, ['[01]', '[02]', '[03]', '[04]', '[05]', '[06]']);
  await ev('(() => { const s = document.getElementById("quest-req-add"); s.value = "burl.follow"; s.dispatchEvent(new Event("change")); })()'); await pause(150);
  const cyc = await ev('document.querySelectorAll("#quest-prereq .q-prow.bad").length'); // burl.follow requires burl.boars: cycle
  await ev('window.__questPanel.stack.undo(); window.__questPanel.select("burl.boars")'); await pause(150);
  await ev('document.querySelector("#quest-detail").scrollTop = 0');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(path.join(ROOT, 'docs/test-reports/edqui-01.png'), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify(info), 'cycle rows after adding burl.follow:', cyc);
  assert.equal(cyc, 1);
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edqui-01 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
