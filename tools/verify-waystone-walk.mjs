// TELEPORT-BUG: headless walk with ?debug=1 from the tower west past the tower waystone, the Bend relay and toward the Ford.
// The rAF loop does not run headless, so loop.update(1/60) is stepped by hand while the pose is advanced 0.07 m/step west.
// Fails on any pose jump > 5 m, any hp loss, or death. Run: node tools/verify-waystone-walk.mjs <port> [fromX] [toX] [y]  (PC-B 9500-9999)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluateAsync, evaluate, killTree } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9810); validatePort(port);
const from = Number(process.argv[3] || 1500), to = Number(process.argv[4] || 1250), y0 = Number(process.argv[5] || 1036), woken = process.argv[6] === 'woken'; // 'woken' = the stone is awake in the profile (save flag), so the walk-in touch fires
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-wsw-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?debug=1&dev=1&save=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.loop)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded');
  const res = await evaluateAsync(cdp, `(async()=>{
    const d=window.__debug; d.loop.stop(); const P=d.playerHandle.data, t=P.transform, h=()=>P.components.health;
    if(d.look) d.look.locked=true; if(${woken}) d.world.state['waystone.waystone.woken']=true;
    t.x=${from}; t.y=${y0}; t.z=(d.world.heightAt(${from},${y0})||0)+1;
    for(let i=0;i<240;i++) d.loop.update(1/60);
    const hs=[]; for(let y=1020;y<=1060;y+=2){const r=[];for(let x=1380;x<=1460;x+=4)r.push(Math.round(d.world.heightAt(x,y)??-99));hs.push(y+':'+r.join(','));}
    const yaws=[]; for(const yw of [0,90,180,270]){ const x0=t.x,y1=t.y; d.look.yawDeg=yw; d.input._down.add('KeyW'); for(let i=0;i<30;i++) d.loop.update(1/60); d.input._down.delete('KeyW'); yaws.push([yw,Math.round(t.x-x0),Math.round(t.y-y1)]); }
    t.x=${from}; t.y=${y0}; t.z=(d.world.heightAt(${from},${y0})||0)+1; for(let i=0;i<120;i++) d.loop.update(1/60);
    const west=yaws.find(q=>q[1]<-1&&Math.abs(q[2])<1); const yaw=west?west[0]:-1;
    const log=[], ev=[]; let prev={x:t.x,y:t.y,z:t.z}, hp0=h().hp, bad=null; let k=0;
    d.input._down.add('KeyW'); d.look.yawDeg=yaw;
    while(t.x>${to} && k<20000 && !bad){
      d.loop.update(1/60); k++;
      const j=Math.hypot(t.x-prev.x,t.y-prev.y);
      if(h().hp<hp0){ev.push(['hp',Math.round(t.x),hp0,h().hp]);hp0=h().hp;}
      if(j>3||(d.vitals&&d.vitals.dead)) bad={k,prev,now:{x:t.x,y:t.y,z:t.z},hp:h().hp,dead:d.vitals&&d.vitals.dead};
      prev={x:t.x,y:t.y,z:t.z};
      if(k%300===0) log.push([Math.round(t.x),Math.round(t.y),+t.z.toFixed(1)]);
      if(k%50===0) await new Promise(r=>setTimeout(r,0));
    }
    d.input._down.delete('KeyW');
    return JSON.stringify({hs,yaws,ws:d.world.state.waystone,bad,log:log.filter((q,i)=>i%4===0),ev,hpEnd:h().hp});
  })()`);
  console.log(res);
  assert.equal(JSON.parse(res).bad, null, 'pose jump / hp loss / death during the walk');
  console.log('Waystone walk (?debug=1): PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
