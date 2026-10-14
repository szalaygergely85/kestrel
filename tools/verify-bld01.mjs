// BLD-01 (OB-139): headless check of the Rook ruin (own voxel house bldRuin at 975,1058). Teleports next to Rook (on the ground N of the wall),
// asserts the [E] Talk to Rook interactable is within reach of a grounded player (never on a roof), no page exceptions, screenshots it.
// Run: node tools/verify-bld01.mjs {port}    ({port} 9575-9649, PC-B range; port+1 = CDP). Output: docs/test-reports/captures/bld01-rook.png
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9575 || port > 9649) throw new Error('use a port in 9575-9649 (port+1 = CDP)');
const AT = '975,1052,-87.4,0,-8'; // 2 m north of Rook (974.9,1054.5), looking south at the ruin

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bld01-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, failed = false;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&at=${AT}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world && window.__debug.look)')) { ready = true; break; } }
  assert.ok(ready, 'boot failed ' + JSON.stringify(errors));
  await evaluate(cdp, 'window.__debug.look.locked = true');
  await pause(4000);
  const r = JSON.parse(await evaluate(cdp, `(() => { const D = window.__debug, t = D.playerHandle.data.transform, w = D.world,
    ix = (w.interactables || []).find((i) => i.key === 'npc.rook'), house = w.get('bldRuinHouse');
    return JSON.stringify({ p: [t.x, t.y, t.z], ix: ix ? [ix.x, ix.y, ix.z, ix.radius, ix.prompt] : null, house: !!house }); })()`));
  console.log(JSON.stringify(r));
  assert.ok(r.house, 'bldRuinHouse entity exists');
  assert.ok(r.ix, 'Rook [E] Talk interactable registered');
  const d = Math.hypot(r.p[0] - r.ix[0], r.p[1] - r.ix[1]), dz = r.ix[2] - r.p[2];
  assert.ok(d <= r.ix[3] + 0.5, `player within reach of Rook (d ${d.toFixed(2)} <= radius ${r.ix[3]})`);
  assert.ok(dz > -0.5 && dz < 2.5, `Rook is on the player's level, not on a roof (dz ${dz.toFixed(2)})`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'bld01-rook.png'), Buffer.from(shot.data, 'base64'));
  assert.deepEqual(errors, []);
  console.log('BLD-01 Rook reachable on the ground: PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
