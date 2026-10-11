// FS-01 AC4: the M4 action hints appear in order in a new game, one at a time; stills in docs/test-reports/captures/.
// Run: node tools/verify-action-hints.mjs 9500   (PC-B lane B1 ports 9500-9574; CDP = port+1). Boot/__debug pattern of verify-note-close.mjs.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-action-hints-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?debug=1` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(400); if (await evaluate(cdp, '!!(window.__debug && window.__debug.engine && window.__debug.engine.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  const shot = async (name) => { await pause(700); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'action-hints-' + name + '.png'), Buffer.from(s.data, 'base64')); };
  // Runtime.evaluate without awaitPromise returns a promise object; use cdp directly for the awaited read.
  const curId = async () => { const r = await cdp.send('Runtime.evaluate', { expression: '(async()=>(await import("/game/js/quest/hints.js")).currentHintId())()', awaitPromise: true, returnByValue: true }); return r.result.value; };
  const run = (js) => evaluate(cdp, `(()=>{const p=__debug.playerHandle.data, c=p.components, w=__debug.engine.world; ${js}})()`);
  // Trigger -> expected hint id, in the order a new game meets them (each waits out the previous one, 8 s timeout + fades).
  const steps = [
    ['actItems', 'c.inventory.slots[5]={id:"potion.hp",n:1};'],
    ['actQuickbar', ''],
    ['actSwing', 'w.state["tower.sword.taken"]=true;'],
    ['actBlock', 'c.equipment.off="shield";'],
    ['actDraw', 'c.equipment.ranged="bow";'],
    ['actSwap', 'c.equipment.main=c.equipment.main||"sword";'],
  ];
  const seen = [];
  for (const [id, js] of steps) {
    if (js) await run(js);
    let got = null;
    for (let i = 0; i < 60 && got !== id; i++) { await pause(500); got = await curId(); if (got && got !== id && !seen.includes(got)) { /* an earlier queued hint is still up; keep waiting */ } }
    assert.equal(got, id, 'expected hint ' + id + ', got ' + got);
    seen.push(id); await shot(id);
  }
  console.log('PASS hints in order', seen.join(' > '));
  console.log('stills:', out, '(check none overlaps the OB-051 interact prompt)');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
