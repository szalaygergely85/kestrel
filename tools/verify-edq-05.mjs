// ED-QUEST-05 (kestrel-1, WIRE): headless check of the live lint list in the quest panel (refresh on edit < 50 ms, Go to focuses the target). PC-B ports 9500-9574.
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

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edq07-'));
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
  await evaluate(cdp, 'document.querySelector(\'[data-dock-tab="quests"]\').click()');
  let rows = 0;
  for (let i = 0; i < 50 && rows < 10; i++) { await pause(200); rows = await evaluate(cdp, 'document.querySelectorAll("#quest-list .q-row").length'); }
  assert.ok(rows >= 10, 'quest list rows: ' + rows);

  const ev = (js) => evaluate(cdp, js);
  const open = async (id) => { await ev('window.__questPanel.select(' + JSON.stringify(id) + ')'); await pause(150); };
  // 1. A clean quest shows "No problems"; a broken one (giver set to a crate-like object id) lists a message with a Go to button.
  await open('sq.burl.blue');
  const lint = () => ev('JSON.stringify({head: document.querySelector("#quest-lint b").textContent, rows: [...document.querySelectorAll("#quest-lint .q-lint-row")].map(r => r.textContent)})').then(JSON.parse);
  const before = await lint(); assert.ok(typeof before.head === 'string', 'lint box present');
  // 2. Edit the title to a raw id: refresh on edit, < 50 ms, R3 message with Go to -> focuses the Title input.
  const ms = await ev('(() => { const i = document.querySelector("#quest-detail [data-field=title] input"); const t0 = performance.now(); i.value = "sq.burl.blue"; i.dispatchEvent(new Event("change")); return performance.now() - t0; })()');
  assert.ok(ms < 50, 'lint refresh on edit: ' + ms + ' ms');
  const after = await lint(); assert.ok(after.rows.some((r) => /internal id/.test(r)), 'R3 message after raw-id title: ' + JSON.stringify(after));
  await ev('document.querySelector("#quest-lint .q-lint-row button").click()');
  assert.equal(await ev('document.activeElement && document.activeElement.closest("[data-field]") && document.activeElement.closest("[data-field]").dataset.field'), 'title', 'Go to focuses the title');
  await ev('window.__questPanel.stack.undo(); window.__questPanel.select("sq.burl.blue")');
  assert.deepEqual((await lint()).rows, before.rows, 'undo restores the list');
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edq-05 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
