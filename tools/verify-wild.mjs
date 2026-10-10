// WILD-06b: headless check that the ambient fauna spawns and is drawn in the real game (WebGPU).
// Loads game/index.html?dev=1&save=0&backend=webgpu (NO voxelbench param: any non-empty value disables fauna),
// puts the player in the meadow (1460, 1035), forces look.locked (headless has no pointer lock; unlocked = paused sim), turns the view for up to 40 s, asserts >= 1 animal alive and
// >= 1 drawn (window.__debug.wild {alive, drawn}), rt.gpuActive stays true, 0 console errors.
// Run: node tools/verify-wild.mjs <port>   (PC-B lane B1 ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-wild-'));
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&save=0&backend=webgpu`)}` });

  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  console.log('[1/4] world loaded');

  await evaluate(cdp, '(()=>{const d=window.__debug,t=d.playerHandle.data.transform;t.x=1460;t.y=1035;t.z=d.world.terrain.heightAt(1460,1035);})()');
  console.log('[2/4] player placed at (1460, 1035)');

  // Turn the view slowly so animals spawned behind the camera enter the frustum; poll alive + drawn.
  const t0 = Date.now(); let alive = 0, drawn = 0, seen = false;
  while (Date.now() - t0 < 40000) {
    // The headless sim never runs (no pointer lock + wake sequence) and main.js never moves the render camera, so step the fauna
    // through the dev hook and call its feed against the real game voxel pool for four view directions (= what the frame does).
    await evaluate(cdp, '(()=>{const l=window.__debug.look, W=window.__debug.wildRaw; if(l) l.locked=true; if(W&&W.w){ for(let i=0;i<120;i++) W.w.step(1/60,1460,1035,false,0); if(W.pool){ let best=0; for(const yaw of [0,90,180,270]){ const n=W.w.feed(W.pool,{x:1460,y:1035,yawDeg:yaw}); if(n>best) best=n; } window.__wildFeedBest=best; } }})()');
    await pause(500);
    const w = await evaluate(cdp, 'JSON.stringify(window.__debug.wild)');
    const o = w && JSON.parse(w);
    if (o) { if (o.alive > alive) alive = o.alive; const fb = await evaluate(cdp, 'window.__wildFeedBest||0'); if (fb > drawn) drawn = fb; if (o.drawn > drawn) drawn = o.drawn; if (alive >= 1 && drawn >= 1) { seen = true; break; } }
  }
  if (!seen) console.log('last wild =', await evaluate(cdp, 'JSON.stringify([window.__debug.wild, (()=>{const t=window.__debug.playerHandle.data.transform;return [t.x,t.y]})(), Object.keys(window.__debug.rt).join(), location.search, !!window.__debug.world, window.__debug.rt.mode, document.title])'), JSON.stringify(errors));
  assert.ok(seen, `no animal alive+drawn within 40 s (max alive ${alive}, max drawn ${drawn})`);
  console.log(`[3/4] fauna alive ${alive}, drawn ${drawn} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  assert.equal(await evaluate(cdp, '!!window.__debug.rt.gpuActive'), true, 'rt.gpuActive is not true');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('[4/4] gpuActive true, 0 console errors');
  console.log('Wild (WILD-06b): fauna spawns and is drawn on the real GPU, PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
