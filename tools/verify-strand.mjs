// MAP-STRAND-01 (D-073): headless check of the south corridor on the real game. Boots at the corridor head, teleports along it
// (ensureBandFor like the travel code, then settles), asserts ground under the player at every stop (no void rescue / respawn) and the
// bounds hold at the sea end; stills at the beach looking at the net stakes. Run: node tools/verify-strand.mjs 9725 (next port is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { SEA_EDGE_CONFIG } from '../game/js/quest/seaEdge.js';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-strand-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?at=1478,1100,0,180,0&backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(400); if (await evaluate(cdp, '!!(window.__debug && window.__debug.engine && window.__debug.engine.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'game booted ' + JSON.stringify(errors));
  await evaluate(cdp, 'setInterval(() => { if (window.__debug && window.__debug.look) window.__debug.look.locked = true; }, 30), true'); // headless: no pointer lock -> sim paused (see verify-swim)
  const stops = [[1478, 1100], [1520, 1180], [1590, 1300], [1590, 1500], [1520, 1700], [1470, 1752], [1384, 1745]];
  const rows = [];
  for (const [x, y] of stops) {
    const r = await evaluate(cdp, `(async()=>{const d=__debug,w=d.engine.world,h=d.playerHandle,t=h.data.transform,b=h.data.components.body;
      w.ensureBandFor(${x},${y}); t.x=${x}; t.y=${y}; t.z=w.floorAt(${x},${y})+0.5; t.yawDeg=180; b.vx=b.vy=b.vz=0;
      await new Promise((r)=>setTimeout(r,900));
      return {x:t.x,y:t.y,z:t.z,floor:w.floorAt(t.x,t.y),grounded:!!b.grounded,swimming:!!b.swimming,band:w.bandId};})()`);
    rows.push(r);
    assert.ok(r && Math.hypot(r.x - x, r.y - y) < 4, 'no rescue teleport at ' + x + ',' + y + ' ' + JSON.stringify(r));
    assert.ok(r.z >= r.floor - 1.5 && r.z > -110, 'ground under the player (no void) at ' + x + ',' + y + ' ' + JSON.stringify(r));
  }
  // bounds hold at the sea end: push the pose out beyond the circle (1500,1790 r45) and let integrate project it back.
  const edge = await evaluate(cdp, `(async()=>{const d=__debug,w=d.engine.world,t=d.playerHandle.data.transform;t.x=1500;t.y=1860;t.z=-95;await new Promise((r)=>setTimeout(r,900));return {x:t.x,y:t.y};})()`);
  assert.ok(edge.y < 1850, 'bounds clamp at the new sea edge ' + JSON.stringify(edge));
  await evaluate(cdp, '(()=>{const h=__debug.playerHandle,t=h.data.transform;t.x=1384;t.y=1745;t.z=__debug.engine.world.floorAt(1384,1745)+0.3;t.yawDeg=180;h.data.components.body.vz=0;})()');
  await pause(1500); await shot('strand-corridor-' + backend);
  console.log(JSON.stringify({ backend, rows, edge }));
  assert.deepEqual(errors, []);
  console.log('Strand corridor: ground + bounds + still PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
