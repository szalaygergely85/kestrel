// OB-123: at the owner's pose by the tower waystone (1429.51,1039.74 z0.68) the prompt '[E] Hold up the crystal' must show at pitch -3 AND -26.
// Run: node tools/verify-ob123.mjs 9500   (port+1 = CDP). Sets the Burl stone-told flag first (the stone prompt is gated on it).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob123-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, failed = false;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&at=1429.51,1039.74,0.68,256,-3` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'boot failed');
  await pause(4000);
  await evaluate(cdp, '(()=>{const w=__debug.world;w.state["dlg.bear.stone.told"]=true;const t=__debug.playerHandle.data.transform;t.x=1429.51;t.y=1039.74;})()');
  await pause(1500);
  console.log('diag', await evaluate(cdp, 'JSON.stringify((()=>{const w=__debug.world,t=__debug.playerHandle.data.transform;return {p:[t.x,t.y,t.z],ix:w.interactables.filter(r=>/stone|relay/.test(r.key)).map(r=>({k:r.key,req:r.requires,pick:r.pick,x:r.x,y:r.y,z:r.z,r:r.radius,used:r.usedKey})),told:w.state["dlg.bear.stone.told"],inter:w.interaction};})())'));
  await evaluate(cdp, `(async()=>{const m=await import('/engine/index.js');const w=__debug.world,t=__debug.playerHandle.data.transform,o={targetKey:null,prompt:'',dist:0,angleDeg:0};const r=[];for(const ez of [0.68,1.3,1.68,2.28]){m.findInteractTarget(w,{x:t.x,y:t.y,z:t.z+ez-0.68,yawDeg:256,pitchDeg:-3},{reach:3},o);r.push([ez,o.targetKey]);}window.__d=JSON.stringify({r,eyeH:t.eyeH,body:__debug.playerHandle.data.components.body&&Object.keys(__debug.playerHandle.data.components.body)});})()`); await pause(800); console.log('diag2', await evaluate(cdp, 'window.__d'));
  for (const [pitch, want] of [[-3, true], [-26, true], [45, false]]) {
    await evaluate(cdp, `(()=>{const l=__debug.look;l.yawDeg=256;l.pitchDeg=${pitch};const t=__debug.playerHandle.data.transform;t.yawDeg=256;t.pitchDeg=${pitch};})()`);
    await pause(700);
    const p = await evaluate(cdp, '(()=>{const i=__debug.world.interaction;const r=__debug.world.interactables.find(q=>q.key===i.targetKey);return r?r.prompt:""})()');
    const ok = want ? /Hold up the crystal/.test(p) : !/Hold up the crystal/.test(p);
    console.log(`pitch ${pitch}: prompt=${JSON.stringify(p)} ${ok ? 'OK' : 'FAIL'}`); if (!ok) failed = true;
  }
} finally { cdp?.close(); if (browser?.pid) killTree(browser.pid); server.pid && killTree(server.pid); }
process.exit(failed ? 1 : 0);
