// ED-QUEST-06: headless check of the dialogue line editor in the editor's Quests tab (counter, 56 cap, add/delete, undo, changed list).
// PC-B ports only (9500-9574; port+1 is CDP). Run: node tools/verify-edq-06.mjs {port}   e.g. node tools/verify-edq-06.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574 + 1) throw new Error('PC-B range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edq06-'));
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
  const ev = (js) => evaluate(cdp, js);

  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { await pause(300); ready = await ev('!!document.querySelector(\'[data-dock-tab="quests"]\')'); }
  assert.ok(ready, 'editor did not boot: ' + JSON.stringify(errors));
  for (let i = 0; i < 60 && !(await ev('!!window.__questPanel')); i++) { await ev("document.querySelector('[data-dock-tab=quests]').click()"); await pause(500); }   // main.js boots lazily: re-click until mounted
  let rows = 0;
  for (let i = 0; i < 50 && rows < 10; i++) { await pause(200); rows = await ev('document.querySelectorAll("#quest-list .q-row").length'); }
  assert.ok(rows >= 10, 'quest list rows: ' + rows);
  const open = (id) => ev(`(()=>{const i=document.getElementById("quest-filter");i.value=${JSON.stringify(id)};i.dispatchEvent(new Event("input"));document.querySelector("#quest-list .q-row").click();})()`);
  const count = () => ev('document.querySelectorAll("#quest-lines .q-line").length');
  const type = (n, text) => ev(`(()=>{const i=document.querySelectorAll("#quest-lines .q-line input")[${n}];i.value=${JSON.stringify(text)};i.dispatchEvent(new Event("input"));return i.value.length})()`);
  const commit = (n) => ev(`document.querySelectorAll("#quest-lines .q-line input")[${n}].dispatchEvent(new Event("change"))`);

  // 1. A pack quest shows its lines with n / 56 counters.
  await open('sq.tm.nub');
  const n0 = await count(); assert.ok(n0 >= 4, 'pack quest lines: ' + n0);
  assert.match(await ev('document.querySelector("#quest-lines .q-count").textContent'), /^\d+ \/ 56$/);
  // 2. Typing past 56 is refused in the input (clamped) and the counter follows.
  assert.equal(await type(0, 'x'.repeat(70)), 56, 'input clamped to 56');
  assert.equal(await ev('document.querySelector("#quest-lines .q-count").textContent'), '56 / 56');
  // 3. A valid edit is one undoable command; Undo restores the original line.
  const orig = await ev('window.__questPanel.model.quests.find(q=>q.id=="sq.tm.nub").raw.lines.offer[0]');
  await type(0, 'Hello there.'); await commit(0);
  assert.equal(await ev('window.__questPanel.model.quests.find(q=>q.id=="sq.tm.nub").raw.lines.offer[0]'), 'Hello there.');
  assert.match(await ev('document.getElementById("quest-changed").textContent'), /now: Hello there\./);
  // 4. Add + delete line.
  await ev('[...document.querySelectorAll("#quest-lines .ed-btn")].find(b=>/^Add line/.test(b.textContent)).click()');
  assert.equal(await count(), n0 + 1, 'line added');
  await ev('[...document.querySelectorAll("#quest-lines .q-line .ed-btn")].filter(b=>b.textContent=="Delete").pop().click()');
  assert.equal(await count(), n0, 'line deleted');
  // 5. Undo everything -> original text, changed list empty.
  for (let i = 0; i < 4; i++) await ev('[...document.querySelectorAll("#quest-detail .q-tools .ed-btn")].find(b=>b.textContent=="Undo").click()');
  assert.equal(await ev('window.__questPanel.model.quests.find(q=>q.id=="sq.tm.nub").raw.lines.offer[0]'), orig, 'undo restores the line');
  assert.match(await ev('document.getElementById("quest-changed").textContent'), /No changed lines/);
  // 6. A dialogue-file quest (Rook's river road) lists rows from content/dialogue/rook.dialogue.json with speaker Rook.
  await open('mq.river.road');
  assert.ok(await ev('[...document.querySelectorAll("#quest-lines .q-line")].some(r=>r.dataset.key=="rook.dialogue.json#rook.road.1")'), 'dialogue rows listed');
  assert.ok(await ev('document.querySelector("#quest-lines .q-speaker").textContent.length>0'));
  assert.equal(await ev('window.__questPanel.dialogues.files.has("rook.dialogue.json")'), true);

  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edq-06 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
