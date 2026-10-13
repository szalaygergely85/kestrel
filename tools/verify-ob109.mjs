// OB-109: the boot loading card stays up until the far terrain is baked (terrain.farReady) - no flat placeholder band.
// From the title: assert the card shows "Shaping the land" while farReady is false, the first in-game frame already has
// farReady true, then press New Game and check it is still ready (no landcard). Prints the times.
// OB109-B3: also reports bar time, band cache MB and the worst in-game frame over 30 s of walking the strand corridor (hops <= 45 m like
// verify-strand.mjs). Pass 'prebake=0' (and/or farhold=0) as 2nd arg for the baseline.
// Run: node tools/verify-ob109.mjs 9500   (PC-B ports 9500-9574; CDP on port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const query = process.argv[3] || ''; // 'farhold=0&prefetchall=0' = the old behaviour (baseline); empty = OB-109
const baseline = /farhold=0/.test(query);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob109-'));
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
  // sampler installed before any page script: records every card text + the farReady flag it was seen with
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cardLog=[];window.__ft=[];{let l=0;const f=(t)=>{if(l&&window.__t30!==false)window.__ft.push(t-l);l=t;requestAnimationFrame(f)};requestAnimationFrame(f);}setInterval(()=>{const c=document.getElementById('bootcard');if(!c)return;const w=window.__debug&&window.__debug.engine&&window.__debug.engine.world;const t=w&&w.terrain;window.__cardLog.push({txt:c.textContent.split(String.fromCharCode(10)).slice(2,4).join('|'),far:t?t.farReady:null});},100);` });
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${query}` });
  let firstFrame = false;
  for (let i = 0; i < 600; i++) { await pause(250); if (await evaluate(cdp, '!document.getElementById("bootcard") && !!(window.__debug && window.__debug.menuHost)')) { firstFrame = true; break; } }
  const tFirst = Date.now() - t0;
  assert.ok(firstFrame, 'boot card never went away ' + JSON.stringify(errors));
  const st = await evaluate(cdp, '(()=>{const t=__debug.engine.world.terrain;return {far:t.farReady,holdMs:window.__farHoldMs,atBoot:window.__farReadyAtBoot,log:window.__cardLog};})()');
  console.log('card labels seen:', JSON.stringify([...new Set(st.log.map((e) => e.txt.split('|')[1]))]).slice(-500), 'holdMs', st.holdMs);
  if (!baseline) {
    assert.equal(st.far, true, 'first in-game frame has farReady');
    assert.equal(st.atBoot, true, 'farReady was already true before engine.run');
    assert.ok(st.log.some((e) => /Loading props/.test(e.txt)), 'card showed "Loading props"');
  }
  await evaluate(cdp, '__debug.look.locked = true; window.__ft.length=0; 1');
  // 30 s walking the strand corridor head -> sea end in <= 45 m hops with landing waits (a raw teleport would trip the void-respawn rescue)
  const stops = [[1478, 1100], [1520, 1180], [1590, 1300], [1590, 1500], [1520, 1700], [1470, 1752], [1384, 1745]];
  const walkEnd = Date.now() + 30000; let cur = await evaluate(cdp, '(()=>{const t=__debug.playerHandle.data.transform;return [t.x,t.y];})()');
  walk: for (const [x, y] of stops) {
    const n = Math.max(1, Math.ceil(Math.hypot(x - cur[0], y - cur[1]) / 45));
    for (let k = 1; k <= n; k++) {
      if (Date.now() > walkEnd) break walk;
      const hx = cur[0] + (x - cur[0]) * k / n, hy = cur[1] + (y - cur[1]) * k / n;
      await evaluateAsync(cdp, `(async()=>{const d=__debug,w=d.engine.world,h=d.playerHandle,t=h.data.transform,b=h.data.components.body;
      w.ensureBandFor(${hx},${hy}); t.x=${hx}; t.y=${hy}; t.z=w.floorAt(${hx},${hy})+0.5; b.vx=b.vy=b.vz=0;
      await new Promise((r)=>setTimeout(r,400)); for(let i=0;i<20&&!b.grounded;i++)await new Promise((r)=>setTimeout(r,250)); await new Promise((r)=>setTimeout(r,600)); return 1;})()`);
    }
    cur = [x, y];
  }
  while (Date.now() < walkEnd) await pause(250);
  const cache = await evaluate(cdp, '(()=>{const w=__debug.engine.world,s=w.bandCache.stats();return {entries:s.entries,MB:+(s.bytes/1048576).toFixed(2),hits:s.hits,misses:s.misses,bakes:s.bakes};})()');
  const hitch = await evaluate(cdp, '(()=>{const a=window.__ft.slice().sort((x,y)=>x-y);return {frames:a.length,p50:a[a.length>>1]||0,p99:a[Math.floor(a.length*0.99)]||0,max:a[a.length-1]||0,over50:a.filter(x=>x>50).length,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,farAfter:__debug.engine.world.terrain.farReady,prefetchAll:window.__prefetchAll||null};})()');
  // New Game: Enter on the first menu row
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await pause(1500);
  const after = await evaluate(cdp, '({active:__debug.menuHost?__debug.menuHost.active:null,far:__debug.engine.world.terrain.farReady,land:!!document.getElementById("landcard")})');
  assert.equal(after.far, true); assert.equal(after.land, false);
  console.log(JSON.stringify({ query, cache, barMs: Math.round(st.holdMs), maxFrameMs: Math.round(hitch.max), hitch, timeToFirstFrameMs: tFirst, farHoldMs: Math.round(st.holdMs), menuActiveAfterEnter: after.active, cardSamples: st.log.length }));
  assert.deepEqual(errors, []);
  console.log('OB-109: loading card holds until farReady, first frame has the far terrain PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
}
