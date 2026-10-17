// WS1-07b: headless check of map travel (CDP helpers as tools/verify-wild.mjs). The headless sim does not run, so the travel is
// requested through window.__debug.travelTo(id) (bypasses the wake/pointer gates) and stepped by hand via window.__debug.travel.step(dt).
// Steps: load -> touch the meadow stone and register a second point (sim.touch at a pose 60 m west) -> travel to it -> assert
// transform == anchor, velocity 0, fade timeline 0.35 s out / 0.35 s in, respawn point == target -> travel to the stone you stand at
// -> "here" with no fade. 0 console errors. Run: node tools/verify-travel.mjs <port>   (PC-B lane B1 ports 9500-9574; CDP = port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-travel-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&save=1&backend=webgpu`)}` });

  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.travel && window.__debug.waystoneSim)')) { ready = true; break; } }
  if (!ready) console.log('probe', await evaluate(cdp, 'JSON.stringify([!!window.__debug, !!window.__debug?.world, !!window.__debug?.playerHandle, !!window.__debug?.travel, JSON.stringify([!!window.__debug.gameHooks.ctx.world, !!window.__debug.gameHooks.ctx.player, !!window.__debug.world.state, !!window.__debug.playerHandle.data.components.health, !!window.__debug.gameHooks.ctx.requestSave]), typeof window.__debug?.waystoneSim, window.__debug?.waystoneSim ? !!window.__debug.waystoneSim() : null, location.search])'));
  console.log('errors', JSON.stringify(errors));
  assert.ok(ready, 'world / travel / waystone sim never ready: ' + JSON.stringify(errors));
  // headless: vitals never stepped, so the player has no health component yet -> give it one, then the wire's lazy sim init works
  await evaluate(cdp, "(()=>{const c=window.__debug.playerHandle.data.components;if(!c.health)c.health={hp:6,max:6,invuln:0};})()");
  assert.ok(await evaluate(cdp, '!!window.__debug.waystoneSim()'), 'waystone sim missing');
  console.log('[1/5] world loaded, travel + waystone sim present');

  // Two points: the meadow stone touched where the player is, a second one 60 m west (a registered test point).
  const setup = await evaluate(cdp, `(()=>{const d=window.__debug,s=d.waystoneSim(),t=d.playerHandle.data.transform;
    if(!s.has('ws_test'))s.register({id:'ws_test',label:'Test point',kind:'relay',order:9});
    s.touch('waystone',{x:t.x,y:t.y,z:t.z,yawDeg:t.yawDeg||0});
    s.touch('ws_test',{x:t.x-60,y:t.y,z:t.z,yawDeg:270});
    s.touch('waystone',{x:t.x,y:t.y,z:t.z,yawDeg:t.yawDeg||0}); // last touched = the stone
    return JSON.stringify({x:t.x,y:t.y,z:t.z});})()`);
  const home = JSON.parse(setup);
  console.log('[2/5] points registered, player at', JSON.stringify(home));

  const r1 = await evaluate(cdp, "window.__debug.travelTo('ws_test')");
  assert.equal(r1, 'ok', 'travelTo ws_test -> ' + r1);
  const run = (n, dt) => evaluate(cdp, `(()=>{const T=window.__debug.travel;for(let i=0;i<${n};i++)T.step(${dt});return JSON.stringify({phase:T.phase,alpha:T.alpha,locked:T.inputLocked,tele:T.teleports});})()`).then(JSON.parse);
  let o = await run(10, 1 / 60); assert.equal(o.phase, 'out'); assert.ok(o.locked && o.alpha > 0 && o.alpha < 1, 'fading out ' + JSON.stringify(o));
  o = await run(12, 1 / 60); assert.equal(o.phase, 'in'); assert.equal(o.tele, 1, 'teleport exactly once');
  const arrived = JSON.parse(await evaluate(cdp, `(()=>{const d=window.__debug,t=d.playerHandle.data.transform,b=d.playerHandle.data.components.body,s=d.waystoneSim().snapshot();return JSON.stringify({x:t.x,y:t.y,z:t.z,yaw:t.yawDeg,v:[b.vx,b.vy,b.vz],resp:s.waystoneId});})()`));
  assert.ok(Math.abs(arrived.x - (home.x - 60)) < 1e-6 && Math.abs(arrived.y - home.y) < 1e-6, 'at the anchor ' + JSON.stringify(arrived));
  assert.deepEqual(arrived.v, [0, 0, 0], 'velocity zeroed'); assert.equal(arrived.resp, 'ws_test', 'respawn point = target');
  o = await run(30, 1 / 60); assert.equal(o.phase, 'idle'); assert.ok(!o.locked && o.alpha === 0);
  console.log('[3/5] travelled: pose = anchor, v = 0, respawn = ws_test, fade 0.35 s out / in, 1 teleport');

  const r2 = await evaluate(cdp, "window.__debug.travelTo('ws_test')");
  assert.equal(r2, 'here', 'standing at the target -> here, got ' + r2);
  assert.equal(await evaluate(cdp, 'window.__debug.travel.phase'), 'idle');
  assert.ok(await evaluate(cdp, 'window.__debug.travel.toastLeft > 0'), 'toast "Already here." shown');
  console.log('[4/5] travel to the current stone: "Already here." toast, no fade');

  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('[5/5] 0 console errors');
  console.log('Travel (WS1-07b): fade, teleport once, respawn point, here-toast, PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
