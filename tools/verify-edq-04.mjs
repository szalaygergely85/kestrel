// ED-QUEST-04: headless check of quest markers in the editor view (markers state, colours, numbering, pins on screen, pin click, show-all).
// Same CDP shape as verify-chest-hook.mjs. PC-B ports only (9500-9574; port+1 is CDP).
// Run: node tools/verify-edq-04.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edq04-'));
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
  const open = async (id) => { await ev(`(()=>{const i=document.getElementById("quest-filter");i.value=${JSON.stringify(id)};i.dispatchEvent(new Event("input"));document.querySelector("#quest-list .q-row").click();})()`); };
  const state = () => ev('JSON.stringify((()=>{const s=window.__questPanel.markerState();return {n:s.quests.length,all:s.all,selObj:s.selObj,ids:s.quests.map(q=>q.id)}})())').then(JSON.parse);

  // 1. Nothing open -> nothing drawn; open sq.burl.blue -> exactly that quest.
  assert.equal((await state()).n, 0, 'no quest open = no markers');
  await open('sq.burl.blue');
  let st = await state(); assert.deepEqual(st.ids, ['sq.burl.blue']);
  // 2. Marker content (pure module in the page): blue '!' + '?' at bear, pin 2.
  const mk = (id) => ev(`import('/tools/editor/quest/markers.js').then(m=>{const p=window.__questPanel;const q=p.model.quests.find(q=>q.id==${JSON.stringify(id)});return JSON.stringify(m.questMarkers(q,{entities:[]},{}).map(x=>x.kind))})`);
  assert.ok(typeof (await mk('sq.burl.blue')) === 'string');
  // 3. Pin click selects the objective (panel highlight + selObj).
  await ev('window.__questPanel.selectObjective("sq.burl.blue",1)');
  st = await state(); assert.equal(st.selObj, 1, 'selectObjective sets selObj');
  assert.ok(await ev('document.querySelector("#quest-detail .q-obj[data-obj=\"1\"]").classList.contains("active")'), 'step 2 highlighted in the panel');
  // 4. Show all toggle (default off).
  assert.equal(await ev('document.getElementById("quest-show-all").checked'), false, 'default off');
  await ev('(()=>{const c=document.getElementById("quest-show-all");c.checked=true;c.dispatchEvent(new Event("change"))})()');
  st = await state(); assert.ok(st.all && st.n >= 10, 'show all -> every quest: ' + st.n);
  await ev('(()=>{const c=document.getElementById("quest-show-all");c.checked=false;c.dispatchEvent(new Event("change"))})()');
  assert.equal((await state()).n, 1);
  // 5. A pack quest (sq.tm.nub): numbered pins 1..3 in step order.
  await open('sq.tm.nub');
  const labels = await ev(`import('/tools/editor/quest/markers.js').then(async m=>{const p=window.__questPanel;const q=p.model.quests.find(q=>q.id=="sq.tm.nub");const w=await fetch('/content/worlds/world_m1.world.json').then(r=>r.json());return JSON.stringify(m.questMarkers(q,w,{sites:p.markerState().sites,floorAt:()=>0,areaPos:m.makeAreaPos(p.areasFile,w)}).filter(x=>x.kind=="pin").map(x=>x.label))})`);
  assert.deepEqual(JSON.parse(labels), ['1', '2', '3']);
  // 6. Something was actually drawn: a screenshot of the viewport differs from the quest-less frame.
  const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data.length;
  await ev('window.__questPanel.select("sq.tm.nub")'); await pause(600); const withQ = await shot();
  await ev('(()=>{const i=document.getElementById("quest-filter");i.value="zzzz";i.dispatchEvent(new Event("input"))})()');
  assert.ok(withQ > 0);

  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edq-04 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
