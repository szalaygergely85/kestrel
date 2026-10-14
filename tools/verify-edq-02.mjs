// ED-QUEST-02: headless check of the editor's Quests tab (list + filter + flow view + one undoable edit).
// Same CDP shape as verify-chest-hook.mjs. PC-B ports only (9500-9574; port+1 is CDP).
// Run: node tools/verify-edq-02.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edq02-'));
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

  // Filter by title (case-insensitive) then by id.
  const setFilter = (v) => evaluate(cdp, `(()=>{const i=document.getElementById("quest-filter");i.value=${JSON.stringify(v)};i.dispatchEvent(new Event("input"));return [...document.querySelectorAll("#quest-list .q-row")].map(r=>r.dataset.qid);})()`);
  assert.deepEqual(await setFilter('THE BLUE ONES'), ['sq.burl.blue']);
  assert.deepEqual(await setFilter('sq.tm.nub'), ['sq.tm.nub']);
  assert.deepEqual(await setFilter('zzzz-no-quest'), []);

  // Open sq.burl.blue: flow text has the plain labels in order, no raw item id.
  await setFilter('sq.burl.blue');
  await evaluate(cdp, 'document.querySelector("#quest-list .q-row").click()');
  const flow = await evaluate(cdp, 'document.getElementById("quest-flow").textContent');
  const at = (s) => flow.indexOf(s);
  const order = ['Giver:', 'Offer: Accept / Exit', '1. Pick six blue sprigs', '2. Bring the sprigs to Burl', 'Return: Take the blue sprigs to Burl', 'Reward:'].map(at);
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), 'flow order: ' + flow);
  assert.ok(!flow.includes('gear.cloak'), 'raw item id leaked into the flow');

  // Open ch12 sq.tm.nub: 3 explore steps + Heart Piece reward.
  await setFilter('sq.tm.nub');
  await evaluate(cdp, 'document.querySelector("#quest-list .q-row").click()');
  const flow2 = await evaluate(cdp, 'document.getElementById("quest-flow").textContent');
  for (const s of ['1. Look for small tracks by the stone', '2. Follow the tracks to the tower door', '3. Follow the wet prints down the road', 'Return: Tell Burl where the tracks went', 'Reward: Heart Piece']) assert.ok(flow2.includes(s), 'missing ' + s);

  // One edit = one undo step: change the title, flow/list update, undo restores it.
  const t0 = await evaluate(cdp, 'window.__questPanel.model.quests.find(q=>q.id==="sq.tm.nub").title');
  await evaluate(cdp, '(()=>{const i=document.querySelector("#quest-detail .q-field input");i.value="Where is Nub?";i.dispatchEvent(new Event("change"));})()');
  assert.equal(await evaluate(cdp, 'window.__questPanel.model.quests.find(q=>q.id==="sq.tm.nub").title'), 'Where is Nub?');
  await evaluate(cdp, 'window.__questPanel.stack.undo()');
  assert.equal(await evaluate(cdp, 'window.__questPanel.model.quests.find(q=>q.id==="sq.tm.nub").title'), t0);
  assert.deepEqual(errors, []);
  console.log('ED-QUEST-02: Quests tab list, filter, flow order/labels and undoable edit PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
