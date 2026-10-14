// ED-QUEST-03: headless check of Pick mode in the editor's Quests tab (giver/return/target picks, rejection, ground snap, undo).
// Same CDP shape as verify-chest-hook.mjs. PC-B ports only (9500-9574; port+1 is CDP).
// Run: node tools/verify-edq-03.mjs 9500
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edq03-'));
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
  const raw = (id) => ev(`JSON.stringify(window.__questPanel.model.quests.find(q=>q.id===${JSON.stringify(id)}).raw)`);
  const hit = (h) => ev(`window.__questPanel.picker.handle(${JSON.stringify(h)})`);
  const arm = (key) => ev(`document.querySelector('[data-pick="${key}"]').click()`);
  const msg = () => ev('document.getElementById("quest-pick-msg").textContent');

  // 1. Pick Burl as giver of sq.burl.blue: giver.npc = "bear"; one undo step restores it.
  await open('sq.burl.blue');
  const before = await raw('sq.burl.blue');
  await arm('giver');
  assert.ok(await ev('window.__questPanel.picker.armed'), 'Pick arms the picker');
  await hit({ entityId: 'bear' });
  assert.equal(JSON.parse(await raw('sq.burl.blue')).giver.npc, 'bear');
  assert.ok(!(await ev('window.__questPanel.picker.armed')), 'a successful pick disarms');
  await ev('window.__questPanel.stack.undo()');
  assert.equal(await raw('sq.burl.blue'), before, 'undo restores the quest');

  // 2. A notice post for giver/return is rejected with the plain message, nothing changes, picker stays armed.
  for (const key of ['giver', 'return']) {
    await arm(key); await hit({ entityId: 'notePost' });
    assert.equal(await msg(), 'Pick a character, not an object');
    assert.equal(await raw('sq.burl.blue'), before, 'rejected pick must not change the quest');
    assert.ok(await ev('window.__questPanel.picker.armed'));
    await ev('window.__questPanel.picker.cancel()');
  }
  // Esc cancels.
  await arm('giver'); await ev('window.__questPanel.picker.onKey({key:"Escape"})');
  assert.ok(!(await ev('window.__questPanel.picker.armed')), 'Esc cancels pick mode');

  // 3. Ground click on an explore step -> spot x,y,z (z = terrain height at x,y, not the ray z), radius 4.
  await open('sq.tm.nub');
  await arm('obj0');
  await hit({ point: { x: 1428, y: 1040, z: 999 } });
  const spot = JSON.parse(await raw('sq.tm.nub')).steps[0].params.spot;
  assert.ok(spot && spot.r === 4 && spot.x === 1428 && spot.y === 1040, 'spot ' + JSON.stringify(spot));
  assert.ok(spot.z < 900, 'z snapped to terrain, not the ray z: ' + spot.z);
  await ev('window.__questPanel.stack.undo()');
  assert.equal(JSON.parse(await raw('sq.tm.nub')).steps[0].params.spot, undefined, 'undo removes the spot');

  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edq-03 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
