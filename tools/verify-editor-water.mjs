// ED-WATER-01 (OB-223): headless check that the editor Water tool resizes floodedCellar and world.waterAt follows.
// Run: node tools/verify-editor-water.mjs <port> [backend]   (PC-B range 9500-9999; port+1 is CDP). Starts + stops its own server/browser.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9730), backend = process.argv[3];
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edwater-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags(backend ? { backend } : {}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html` });
  let ready = false;
  for (let k = 0; k < 150 && !ready; k++) { await pause(300); ready = await evaluate(cdp, '!!(window.__editor && window.__editor.water)'); }
  assert.ok(ready, 'editor did not boot: ' + JSON.stringify(errors));
  const wet = (x, y) => evaluate(cdp, `(() => { const o = {}; return !!window.__editor.world.waterAt(${x}, ${y}, o) && o.region; })()`);
  assert.equal(await wet(1490, 1000), 'floodedCellar', 'inside the original cellar rect');
  assert.equal(await wet(1500, 1000), false, 'x=1500 is dry before the edit');
  await evaluate(cdp, `window.__editor.water.setOn(true); window.__editor.water.tool.select('floodedCellar')`);
  // resize via the tool API exactly as the mouse path does: grab the east handle, drag 8 m east, release
  const ok = await evaluate(cdp, `(() => { const t = window.__editor.water.tool; if (!t.down(1495, 1000)) return 'no-down'; t.move(1503, 1000); return t.up() ? 'ok' : 'no-up'; })()`);
  assert.equal(ok, 'ok');
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1000), 'floodedCellar', 'the new area is water after the resize');
  assert.deepEqual(await evaluate(cdp, 'window.__editor.water.tool.current().rect'), [1485, 995, 1503, 1005]);
  // circle: quietPond (c 1500,1010 r 4): drag the rim handle 2 m east -> r 6
  assert.equal(await wet(1505, 1010), false, 'pond dry at 5 m before');
  await evaluate(cdp, "window.__editor.water.tool.select('quietPond')");
  const ok2 = await evaluate(cdp, `(() => { const t = window.__editor.water.tool; if (!t.down(1504, 1010)) return 'no-down'; t.move(1506, 1010); return t.up() ? 'ok' : 'no-up'; })()`);
  assert.equal(ok2, 'ok');
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1505, 1010), 'quietPond', 'pond grew to r 6');
  assert.equal(await evaluate(cdp, 'window.__editor.water.tool.current().r'), 6);
  // frame the camera on the cellar (as the list select does) and take the still AFTER the framing
  mkdirSync(path.join(ROOT, 'docs/test-reports/edwater'), { recursive: true });
  await evaluate(cdp, "window.__editor.water.tool.select('floodedCellar'); window.__editor.water.frame('floodedCellar')");
  await pause(2000);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'docs/test-reports/edwater/resized.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(cdp, "window.__editor.water.tool.select('quietPond'); window.__editor.water.frame('quietPond')");
  await pause(2000);
  writeFileSync(path.join(ROOT, 'docs/test-reports/edwater/pond.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(cdp, 'window.__editor.doUndo(); window.__editor.rebuildNow()'); // undoes the pond
  assert.equal(await wet(1505, 1010), false, 'undo restores the small pond');
  // ED-WATER-02: new pool (6x6 at the given point) -> resize -> delete, each one undo step
  const nid = await evaluate(cdp, `(() => { const t = window.__editor.water.tool; return t.createPool(1500, 1030, 'rect'); })()`);
  assert.ok(nid && nid.startsWith('pond_'), 'pool created: ' + nid);
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1030), nid, 'new pool is water at its centre');
  const okp = await evaluate(cdp, `(() => { const t = window.__editor.water.tool; const r = t.current().rect; if (!t.down(r[2], (r[1] + r[3]) / 2)) return 'no-down'; t.move(r[2] + 4, (r[1] + r[3]) / 2); return t.up() ? 'ok' : 'no-up'; })()`);
  assert.equal(okp, 'ok'); await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1506, 1030), nid, 'resized pool covers +4 m east');
  assert.equal(await evaluate(cdp, `(() => { const t = window.__editor.water.tool; t.deleteSelected(); return t.deleteSelected(); })()`), true);
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1030), false, 'deleted pool is dry');
  for (let i = 0; i < 3; i++) await evaluate(cdp, 'window.__editor.doUndo()'); // delete, resize, create
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1030), false, 'undo of create leaves no pool');
  // undo puts it back
  await evaluate(cdp, 'window.__editor.doUndo(); window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1000), false, 'undo restores the dry area');
  // ED-WATER-03: river ribbon surface z offset (+0.5 m on braid): path z follows live, one undo restores it, riverEdits written
  const rz0 = await evaluate(cdp, "window.__editor.world.waterAt(1244.25, 605, {}) && 0, window.__editor.water.tool.select('braid'), window.__editor.water.tool.riverInfo().points[1].z");
  assert.equal(await evaluate(cdp, "window.__editor.water.tool.setRiverDz(0.5)"), true);
  await evaluate(cdp, 'window.__editor.rebuildNow()');
  assert.equal(await evaluate(cdp, "+window.__editor.water.tool.riverInfo().points[1].z.toFixed(3)"), +(rz0 + 0.5).toFixed(3), 'ribbon surface z raised by 0.5');
  assert.deepEqual(await evaluate(cdp, "window.__editor.water.tool.riverInfo().edit"), { dz: 0.5, hw: {} });
  await evaluate(cdp, 'window.__editor.doUndo(); window.__editor.rebuildNow()');
  assert.equal(await evaluate(cdp, "window.__editor.water.tool.riverInfo().points[1].z"), rz0, 'undo restores the ribbon z');
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-editor-water PASS: resize + undo change world.waterAt');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
