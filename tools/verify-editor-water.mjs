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
  mkdirSync(path.join(ROOT, 'docs/test-reports/edwater'), { recursive: true });
  await evaluate(cdp, `window.__editor.setCamPose({ x: 1494, y: 975, z: window.__editor.world.floorAt(1494, 1000) + 14, yawDeg: 0, pitchDeg: -35 })`);
  await pause(1500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(ROOT, 'docs/test-reports/edwater/resized.png'), Buffer.from(shot.data, 'base64'));
  // undo puts it back
  await evaluate(cdp, 'window.__editor.doUndo(); window.__editor.rebuildNow()');
  assert.equal(await wet(1500, 1000), false, 'undo restores the dry area');
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-editor-water PASS: resize + undo change world.waterAt');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
