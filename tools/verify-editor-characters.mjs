// OB-218: headless check that the world editor draws character models (Burl the bear at 1471,1025; Hesk = char.kit at 938,930).
// Run: node tools/verify-editor-characters.mjs --port 9730   (PC-B range; port+1 is CDP). Starts + stops its own server/browser.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const i = process.argv.indexOf('--port');
const port = Number(i > 0 ? process.argv[i + 1] : process.argv[2] || 9730);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edchars-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html` });
  let ready = false;
  for (let k = 0; k < 150 && !ready; k++) { await pause(300); ready = await evaluate(cdp, '!!(window.__editor && window.__editor.drawnModelKeys)'); }
  assert.ok(ready, 'editor did not boot: ' + JSON.stringify(errors));
  const seen = async (x, y, wanted) => { // fly next to the spot, look at it, wait for frames
    await evaluate(cdp, `window.__editor.setCamPose({ x: ${x}, y: ${y - 8}, z: window.__editor.world.floorAt(${x}, ${y}) + 4, yawDeg: 0, pitchDeg: -20 })`);
    let keys = [];
    for (let k = 0; k < 40; k++) { await pause(250); keys = await evaluate(cdp, 'window.__editor.drawnModelKeys()'); if (keys.includes(wanted)) break; }
    return keys;
  };
  const burl = await seen(1471, 1025, 'bear');
  assert.ok(burl.includes('bear'), 'Burl (model bear) not drawn near the tower spot; drawn: ' + JSON.stringify([...new Set(burl)]));
  const hesk = await seen(938, 930, 'char.kit');
  assert.ok(hesk.includes('char.kit'), 'Hesk (char.kit) not drawn at the Outwall gate; drawn: ' + JSON.stringify([...new Set(hesk)]));
  assert.deepEqual(errors, [], 'page errors: ' + JSON.stringify(errors));
  console.log('verify-editor-characters PASS: bear + char.kit drawn');
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  try { browser && killTree(browser.pid); } catch {}
  try { killTree(server.pid); } catch {}
  rmSync(profile, { recursive: true, force: true });
}
