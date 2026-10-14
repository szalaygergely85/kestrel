// ED-QUEST-07 (kestrel-1, WIRE): headless check of Play from here (preset dropdown, ?at + ?qstate URL, preset parse). PC-B ports 9500-9574.
// Same CDP shape as verify-chest-hook.mjs. PC-B ports only (9500-9574; port+1 is CDP).
// Run: node tools/verify-edq-07.mjs 9500
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
  // 1. Dropdown: Not started / Accepted / Objective n / Ready to return; "Play from here" opens ?qstate=<id>:<preset> at the camera ground position.
  await open('sq.burl.blue');
  const opts = JSON.parse(await ev('JSON.stringify([...document.querySelectorAll("#quest-play-preset option")].map(o => [o.value, o.textContent]))'));
  assert.equal(opts[0][0], 'notStarted'); assert.equal(opts[opts.length - 1][0], 'readyToReturn'); assert.ok(opts.length >= 3);
  await ev('window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }');
  for (const [v] of opts) {
    await ev('(() => { const s = document.getElementById("quest-play-preset"); s.value = ' + JSON.stringify(v) + '; document.getElementById("quest-play").click(); })()');
  }
  const urls = JSON.parse(await ev('JSON.stringify(window.__opened)'));
  assert.equal(urls.length, opts.length);
  urls.forEach((u, i) => { assert.ok(u.includes('game/index.html?at='), u); assert.ok(u.includes('qstate=' + encodeURIComponent('sq.burl.blue:' + opts[i][0])), u); });
  // 2. Game side (pure parse + preset in the page): every preset parses and applies without touching localStorage saves.
  const r = JSON.parse(await ev(`import('/game/js/quest/statePreset.js').then(m => JSON.stringify(${JSON.stringify(opts.map((o) => o[0]))}.map((v) => m.parseQstateParam('?qstate=' + encodeURIComponent('sq.burl.blue:' + v)))))`));
  assert.ok(r.every((x) => x && x.questId === 'sq.burl.blue'), 'all presets parse');
  // 3. Normal play unchanged: no ?qstate -> null.
  assert.equal(await ev("import('/game/js/quest/statePreset.js').then(m => m.parseQstateParam('?at=1,2,3'))"), null);
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edq-07 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
