// OB-215: headless in-page probe - does Burl (the 'bear' NPC) get the knee rig + foot IK while walking?
// Run: node tools/probe-burl-legs.mjs {port} [backend]   (PC-B range 9500-9999; kestrel-3 uses 9650-9724)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9650);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-burl-legs-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 200, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(500); if (await evaluate(cdp, '!!(window.__debug && window.__debug.burl && window.__debug.engine && window.__debug.engine.world && window.__debug.engine.world.get("bear"))')) { ready = true; break; } }
  if (!ready) console.log('diag', await evaluate(cdp, 'JSON.stringify({dbg:Object.keys(window.__debug||{}),bear:!!(window.__debug&&window.__debug.engine&&window.__debug.engine.world&&window.__debug.engine.world.get("bear")),title:document.title,txt:document.body.innerText.slice(0,200)})'));
  assert.ok(ready, 'game/burl handle not ready');
  await pause(2500);
  // put the player 8 m from Burl so he is inside the leg-IK LOD range (35 m) and drawn
  await evaluate(cdp, `(()=>{const d=window.__debug,p=d.playerHandle.data.transform,b=d.engine.world.get('bear').data.transform;p.x=b.x-8;p.y=b.y+6;if(d.engine.world.terrain)p.z=d.engine.world.terrain.groundAt(p.x,p.y)+1;})()`);
  await pause(1500);
  const info = await evaluate(cdp, `(()=>{const d=window.__debug,b=d.burl,h=d.engine.world.get('bear'),v=h.data.components.voxel,pm=b.pool.models.get(v.model);
    return {model:v.model,hidden:!!v.hidden,poolHasModel:!!pm,legRig:!!(pm&&pm.legRig),legs:!!b.legs,drawnIsWorldHandle:true,started:b.walk.start('depart')};})()`);
  console.log('setup', JSON.stringify(info));
  console.log('raf', JSON.stringify(await evaluateAsync(cdp, `new Promise(r=>{let n=0;const t0=performance.now();(function f(){n++;if(performance.now()-t0<2000)requestAnimationFrame(f);else r({n,vis:document.visibilityState,mode:window.__debug.engine.mode||null,keys:Object.keys(window.__debug.engine).slice(0,30)})})()})`)));
  // headless software GPU renders ~1 fps (loop caps 5 sim steps/frame), so the probe steps Burl's walk itself at 60 Hz (escort only steps it in its own phases) and samples legPose each tick; `rf` counts real rendered frames.
  const frames = await evaluateAsync(cdp, `new Promise((res)=>{const d=window.__debug,b=d.burl,out=[],t0=performance.now();
    let rf=0;(function c(){rf++;requestAnimationFrame(c)})();function f(){b.walk.step(1/60,0,0);const h=d.engine.world.get('bear'),v=h.data.components.voxel,t=h.data.transform,lp=v.legPose;
      out.push({cd:Math.round(Math.hypot(t.x-d.engine.camera.x,t.y-d.engine.camera.y)),ms:Math.round(performance.now()-t0),x:+t.x.toFixed(2),y:+t.y.toFixed(2),anim:v.anim,hidden:!!v.hidden,w:lp?lp[0]:null,rf,att:b.legs?b.legs.stats.attached:-1,walking:b.walk.walking});
      if(performance.now()-t0>=10000){clearInterval(iv);res(out);}} const iv=setInterval(f,50);})`);
  const walking = frames.filter((r) => r.anim === 'walk' && r.rf >= 2 && frames.find((q) => q.anim === 'walk' && q.rf >= 1) && r.rf > frames.find((q) => q.anim === 'walk').rf); // after at least one frame was rendered with the walk clip
  const w1 = walking.filter((r) => r.w >= 0.99).length;
  console.log('frames', frames.length, 'walkFrames', walking.length, 'legPose w>=0.99 on', w1, 'moved', JSON.stringify([frames[0], frames[frames.length - 1]]));
  console.log('w-by-time',JSON.stringify(frames.filter((_,i)=>i%10===0).map(r=>[r.ms,r.w==null?null:+r.w.toFixed(2),r.cd])));
  console.log('sample', JSON.stringify(frames.filter((_, i) => i % 40 === 0)));
  console.log(walking.length > 0 && w1 === walking.length ? 'PASS legPose weight 1 on every walking frame' : 'FAIL legPose not applied while walking');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(400); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
