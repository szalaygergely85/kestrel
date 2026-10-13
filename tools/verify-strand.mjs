// MAP-STRAND-01 (D-073): headless check of the south corridor on the real game. Boots at the corridor head, teleports along it
// (ensureBandFor like the travel code, then settles), asserts ground under the player at every stop (no void rescue / respawn) and the
// bounds hold at the sea end; stills at the beach looking at the net stakes. Run: node tools/verify-strand.mjs 9725 (next port is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { SEA_EDGE_CONFIG } from '../game/js/quest/seaEdge.js';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

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
  for (let i = 0; i < 50 && !(await evaluate(cdp, '!!window.__debug.look')); i++) await pause(300);
  await evaluate(cdp, '(()=>{__debug.look.locked = true; return 1;})()'); // headless never gets pointer lock -> isPaused() would freeze the sim and make every ground assertion vacuous
  // sanity: the sim must really step the player (a drop of 15 m must fall); otherwise every ground assertion below is vacuous
  const drop = await evaluateAsync(cdp, `(async()=>{const d=__debug,w=d.engine.world,t=d.playerHandle.data.transform;const z0=w.floorAt(t.x,t.y)+15;t.z=z0;for(let i=0;i<40&&t.z>z0-1;i++)await new Promise((r)=>setTimeout(r,250));return {z0,z:t.z,x:t.x,y:t.y,vis:document.visibilityState,focus:document.hasFocus()};})()`);
  console.log('drop probe', JSON.stringify(drop));
  assert.ok(drop.z < drop.z0 - 0.5, 'sim steps the player (fell from ' + drop.z0 + ' to ' + drop.z + ') ' + JSON.stringify(drop));
  const stops = [[1478, 1100], [1520, 1180], [1590, 1300], [1590, 1500], [1520, 1700], [1470, 1752], [1384, 1745]];
  const rows = [];
  // The game's travel code calls vitals.clearSafe(); a raw teleport must not drop >30 m below the last safe spot (VOID-RESPAWN-01 snaps back),
  // so we hop in <=45 m steps like a walk would (each hop lands + gets a second to re-capture the safe spot), assert at the real stops.
  let cur = [1478, 1100];
  for (const [x, y] of stops) {
    const n = Math.max(1, Math.ceil(Math.hypot(x - cur[0], y - cur[1]) / 45));
    let r;
    for (let k = 1; k <= n; k++) {
      const hx = cur[0] + (x - cur[0]) * k / n, hy = cur[1] + (y - cur[1]) * k / n;
      r = await evaluateAsync(cdp, `(async()=>{const d=__debug,w=d.engine.world,h=d.playerHandle,t=h.data.transform,b=h.data.components.body;
      w.ensureBandFor(${hx},${hy}); t.x=${hx}; t.y=${hy}; t.z=w.floorAt(${hx},${hy})+0.5; t.yawDeg=180; b.vx=b.vy=b.vz=0;
      await new Promise((r)=>setTimeout(r,400)); for(let i=0;i<40&&!b.grounded;i++)await new Promise((r)=>setTimeout(r,250)); // headless software render: few fps, wait for the landing
      await new Promise((r)=>setTimeout(r,${k < n ? 1000 : 600}));
      return {x:t.x,y:t.y,z:t.z,floor:w.floorAt(t.x,t.y),grounded:!!b.grounded,swimming:!!b.swimming,band:w.bandId,hop:'${k}/${n}'};})()`);
      if (Math.hypot(r.x - hx, r.y - hy) >= 4) break;
    }
    cur = [x, y];
    rows.push(r);
    assert.ok(r && Math.hypot(r.x - x, r.y - y) < 4, 'no rescue teleport at ' + x + ',' + y + ' ' + JSON.stringify(r));
    assert.ok(r.z >= r.floor - 1.5 && r.z > -110, 'ground under the player (no void) at ' + x + ',' + y + ' ' + JSON.stringify(r));
  }
  // bounds hold at the sea end: push the pose out beyond the circle (1500,1790 r45) and let integrate project it back.
  const edge = await evaluateAsync(cdp, `(async()=>{const d=__debug,w=d.engine.world,t=d.playerHandle.data.transform;const b=d.playerHandle.data.components.body;t.x=1500;t.y=1860;t.z=-95;b.vx=b.vy=b.vz=0;for(let i=0;i<40&&!b.boundsHit&&t.y>1850;i++)await new Promise((r)=>setTimeout(r,250));return {x:t.x,y:t.y,z:t.z,hit:!!b.boundsHit,sw:!!b.swimming,gr:!!b.grounded,shape:w.bounds&&w.bounds.shape,n:w.bounds&&w.bounds.parts&&w.bounds.parts.length,keys:Object.keys(b).join()};})()`);
  console.log(JSON.stringify({ rows, edge }));
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
