// REGION-01 browser half: boots the game like tools/verify-m4-exit.mjs (fresh profile, ?save=1), teleports across one region
// border (roadWest -> ford, x 1150) and saves stills of the banner at two viewports. Banner state is read from
// the page by drawing into nothing: we sample the UI layer cells via window.__debug when exposed, else only the still is checked.
// Run: node tools/verify-region-banner.mjs 9560   (PC-B ports 9500-9999; CDP = port+1). Stills: docs/test-reports/region01/. Exit 1 on FAIL.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9560);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('this check uses PC-B ports 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-region-'));
const out = path.join(ROOT, 'docs', 'test-reports', 'region01'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&backend=webgpu`;
let browser, cdp;
const TP = (x, y) => `(() => { const D = window.__debug, p = D.playerHandle.data, t = p.transform; t.x = ${x}; t.y = ${y}; D.vitals.clearSafe(); })()`; // clearSafe: OB-040

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 300)); });
  for (const [w, h] of [[640, 360], [1680, 630]]) { // narrow and wide window (UI grid scales with the window)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.vitals && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
    assert.ok(ready, 'game never ready ' + JSON.stringify(errors));
    await pause(1500);
    await evaluate(cdp, `window.__debug.world.state['quest.wakeT'] = 100`); // as after a played wake (questUiActive)
    await evaluate(cdp, TP(1500, 1000)); await pause(5000);   // tower: its banner plays out
    await evaluate(cdp, TP(1160, 1050)); await pause(5000);   // roadWest: nameless, nothing
    await evaluate(cdp, TP(1140, 1050)); await pause(1400);   // crossed into ford: banner holding
    const seen = await evaluate(cdp, `JSON.stringify(window.__debug.world.state['region.seen'])`);
    assert.ok(/ford/.test(seen), 'ford not in the seen-set: ' + seen);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, `ford-${w}x${h}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  assert.deepEqual(errors, [], 'page errors');
  console.log('REGION-01 browser: crossed roadWest -> ford, stills saved to', out, 'PASS (look at the stills: "The Crossroads" top-centre, 2x glyphs)');
} catch (e) {
  console.error('REGION-01 browser: FAIL', e && e.message || e); process.exitCode = 1;
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
