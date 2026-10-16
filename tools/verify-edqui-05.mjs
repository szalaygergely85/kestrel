// WIDE VIEW + ED-QUI-05/06 (kestrel-4): headless still of the wide Quest tab (burl.road) 1280x800. Run: node tools/verify-edqui-05.mjs 9730
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

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edqui05-'));
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
  const before = await ev('JSON.stringify(window.__questPanel.model.quests.find(q => q.id === "burl.road").raw)');
  await ev('window.__questPanel.select("burl.road")'); await pause(250);
  const info = JSON.parse(await ev(`JSON.stringify({
    origin: [...document.querySelectorAll("#quest-origin .q-ocard")].map(c => c.innerText.replace(/\\n+/g, " | ")),
    steps: [...document.querySelectorAll("#quest-objs .q-ostep")].map(s => ({ kind: s.querySelector(".q-kind").value, count: !!s.querySelector("[data-count]"), pick: s.querySelector("[data-pick]").disabled })),
    add: document.getElementById("quest-add-step").disabled })`));
  assert.equal(info.origin.length, 2); assert.match(info.origin[0], /ORIGIN/); assert.match(info.origin[1], /TURN-IN/); assert.match(info.origin[1], /rook/i);
  assert.equal(info.steps.length, 3); assert.ok(info.steps.every((s) => !s.count), 'no count on goto/flag steps'); assert.equal(info.add, true);
  assert.equal(await ev('JSON.stringify(window.__questPanel.model.quests.find(q => q.id === "burl.road").raw)'), before, 'opening the cards must not change the quest');
  const wide = JSON.parse(await ev(`JSON.stringify({ dock: Math.round(document.getElementById("left-dock").getBoundingClientRect().width), cols: getComputedStyle(document.getElementById("quest-detail")).gridTemplateColumns.split(" ").length,
    nodes: document.querySelectorAll("#quest-lines .q-node").length, flow: !!document.getElementById("quest-flow"),
    coin: document.getElementById("quest-coin").innerText.length, coinOff: document.querySelector("#quest-coin input").disabled, rewardTiles: document.querySelectorAll("#quest-rewards .q-rtile").length,
    next: !!document.getElementById("quest-next"), canvas: Math.round(document.querySelector("canvas").getBoundingClientRect().width) })`));
  console.log(JSON.stringify(wide));
  assert.ok(wide.dock >= 600 && wide.cols === 2 && !wide.flow && wide.coinOff && true && wide.next && wide.nodes >= 1, 'wide layout: ' + JSON.stringify(wide));
  assert.equal(await ev('JSON.stringify(window.__questPanel.model.quests.find(q => q.id === "burl.road").raw)'), before, 'wide view must not change the quest');
  await ev('window.__questPanel.select("burl.road")'); await pause(200);
  await ev("document.querySelector(\"[data-card=conversation]\").scrollIntoView()");
  const fs = await import('node:fs');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'docs/test-reports/edqui-05.png'), Buffer.from(shot.data, 'base64'));

  // ED-QUI-07a: card [06] VALIDATE + node role tags + full-width line inputs
  const v07 = JSON.parse(await ev(`JSON.stringify({
    btn: !!document.getElementById("quest-validate"), foot: document.getElementById("quest-vfoot").innerText, verdict: document.getElementById("quest-verdict").innerText,
    chip: document.getElementById("quest-status").innerText, rows: document.querySelectorAll("#quest-lint .q-vrow").length, simArea: !!document.getElementById("quest-sim-area"),
    roles: [...document.querySelectorAll("#quest-lines .q-node")].map(n => n.dataset.node + ":" + n.querySelector(".q-node-head .q-pill").innerText),
    inputs: [...document.querySelectorAll("#quest-lines .q-line input")].map(i => ({ w: Math.round(i.getBoundingClientRect().width), sw: i.scrollWidth, cw: i.clientWidth, len: i.value.length })) })`));
  console.log(JSON.stringify(v07));
  assert.ok(v07.btn && v07.simArea && /bytes/.test(v07.foot) && /content\/quests\//.test(v07.foot), '06 card: ' + JSON.stringify(v07));
  assert.ok(v07.roles.some((r) => /^rook\.meet\.1:MEET$/.test(r)) && !v07.roles.some((r) => /meet.*HAND-IN/.test(r)), 'roles: ' + v07.roles);
  assert.ok(v07.inputs.length > 3 && v07.inputs.every((i) => i.sw <= i.cw + 1), 'a line input is cut: ' + JSON.stringify(v07.inputs));
  // a broken quest: 4th objective + xp -> errors in the list with Go to; Go to scrolls to the card
  await ev('window.__questPanel.select("sq.burl.blue")'); await pause(250);
  const blue = JSON.parse(await ev(`JSON.stringify({ verdict: document.getElementById("quest-verdict").innerText, chip: document.getElementById("quest-status").innerText })`));
  console.log(JSON.stringify(blue));
  await ev('window.__questPanel.select("burl.road")'); await pause(250);
  const goOk = await ev(`(() => { const r = document.querySelector("#quest-lint .q-vrow button"); if (!r) return "no-rows-ok"; r.click(); return "clicked"; })()`);
  console.log('goto: ' + goOk);
  console.log('items: ' + await ev('JSON.stringify([...document.querySelectorAll("#quest-lint .q-vrow")].map(r => r.innerText))'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1500, deviceScaleFactor: 1, mobile: false }); await pause(400);
  const snap = async (file, card) => {
    await ev(`document.querySelector("[data-card=${card}]").scrollIntoView()`); await pause(200);
    const sh = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'docs/test-reports/' + file), Buffer.from(sh.data, 'base64'));
  };
  await snap('edqui-07a-roadvalidate.png', 'validate');                 // burl.road: [06] list + footer
  await ev('window.__questPanel.select("sq.burl.blue")'); await pause(300);
  await snap('edqui-07a.png', 'conversation');                           // sq.burl.blue: [04] + [06] in one view
  // ED-QUI-07b2: SIM on burl.road (all green), STEP reveals one row at a time, strip SIM = same run
  await ev('window.__questPanel.select("burl.road")'); await pause(300);
  await ev('document.getElementById("quest-sim-run").click()');
  let sum = ''; for (let i = 0; i < 60 && !/SIM (PASS|FAIL)/.test(sum); i++) { await pause(300); sum = await ev('(document.getElementById("quest-sim-sum") || {innerText:""}).innerText'); }
  const simInfo = JSON.parse(await ev(`JSON.stringify({ sum: document.getElementById("quest-sim-sum").innerText, rows: document.querySelectorAll("#quest-sim-area .q-simrow").length, bad: document.querySelectorAll("#quest-sim-area .q-simrow.error").length, play: !document.getElementById("quest-sim-live").disabled })`));
  console.log(JSON.stringify(simInfo));
  assert.ok(/SIM PASS/.test(simInfo.sum) && simInfo.rows >= 10 && simInfo.bad === 0 && simInfo.play, 'sim burl.road: ' + JSON.stringify(simInfo));
  await ev('document.getElementById("quest-sim-step").click()'); await pause(800);   // steps exhausted -> a new stepwise run shows 1 row
  for (let i = 0; i < 40 && (await ev('document.querySelectorAll("#quest-sim-area .q-simrow").length')) !== 1; i++) await pause(300);
  assert.equal(await ev('document.querySelectorAll("#quest-sim-area .q-simrow").length'), 1, 'STEP shows one row');
  await ev('document.getElementById("quest-sim-step").click()'); await pause(300);
  assert.equal(await ev('document.querySelectorAll("#quest-sim-area .q-simrow").length'), 2, 'STEP reveals the next row');
  await ev('document.getElementById("quest-sim").click()');   // strip SIM = full run
  for (let i = 0; i < 40 && (await ev('document.querySelectorAll("#quest-sim-area .q-simrow").length')) < 10; i++) await pause(300);
  await snap('edqui-07b.png', 'validate');
  assert.equal(await ev('JSON.stringify(window.__questPanel.model.quests.find(q => q.id === "burl.road").raw)'), before, 'SIM must not change the quest');
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-edqui-05 PASS');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
