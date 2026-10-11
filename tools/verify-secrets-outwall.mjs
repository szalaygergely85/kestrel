// US-104b AC3: one headless still per Outwall track chest, taken from its nearest track point looking at it, grid 240x90 (docs/test-reports/us104b/<id>.png).
// Boot = tools/verify-m4-exit.mjs. Run: node tools/verify-secrets-outwall.mjs 9660   (PC-B range 9500-9999; CDP = port+1). Exit 1 on FAIL.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
import { segNear } from './gen-secrets-ch12.mjs';
import { OW_IDS as SECRET_IDS, OW_PATH as PATH } from './gen-secrets-outwall.mjs';
import { forwardOf } from '../engine/index.js';

const port = Number(process.argv[2] || 9660);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('this check uses PC-B ports 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
const out = path.join(ROOT, 'docs/test-reports/us104b'); mkdirSync(out, { recursive: true });
const world = JSON.parse(readFileSync(path.join(ROOT, 'content/worlds/world_m1.world.json'), 'utf8'));
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-secrets-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&grid=240x90&backend=${backend}`;
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 480, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  let ready = false;
    for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
  assert.ok(ready, 'game never ready: ' + JSON.stringify(errors));
  await pause(1500);
  const shots = [];
  for (const id of SECRET_IDS) {
    const c = world.entities.find((e) => e.id === id), rp = segNear(c.x, c.y, PATH);
    let yaw = 0, bd = -2; const f = [0, 0], wx = c.x - rp.x, wy = c.y - rp.y, d = Math.hypot(wx, wy); // yaw whose forwardOf points at the chest
    for (let a = 0; a < 360; a++) { forwardOf(a, f); const dd = (f[0] * wx + f[1] * wy) / d; if (dd > bd) { bd = dd; yaw = a; } }
    await evaluate(cdp, `(() => { const D = window.__debug, t = D.playerHandle.data.transform, b = D.playerHandle.data.components.body; D.world.ensureBandFor(${rp.x}, ${rp.y});
      t.x = ${rp.x}; t.y = ${rp.y}; t.z = D.world.terrain.groundAt(${rp.x}, ${rp.y}) + 0.3; t.yawDeg = ${yaw}; if (b) { b.vx = 0; b.vy = 0; b.vz = 0; } if (D.look) { D.look.yawDeg = ${yaw}; D.look.pitchDeg = 0; } })()`);
    await pause(1800);
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, id + '.png'), Buffer.from(s.data, 'base64')); shots.push(id);
  }
  assert.deepEqual(shots, SECRET_IDS);
  assert.deepEqual(errors, [], 'console errors');
  console.log('Secrets Outwall: 3 stills written to docs/test-reports/us104b/ PASS');
} catch (e) {
  console.error('Secrets Outwall: FAIL', e && e.message || e); process.exitCode = 1;
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
