import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
const { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } = await import('./capture-browser.mjs');
const port = 9730; validatePort(port);
const poses = (process.argv[2] || 'forestFloor,hillside,meadowDetail,fordDetail').split(',');
const FLIPS = 6;
const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bandflip-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--enable-webgpu-developer-features', '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  for (const pose of poses) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?pose=${pose}&quality=ultra&title=0&f3=1` });
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '(()=>{const d=window.__debug;return !!(d&&d.wgPipeline&&d.wgPipeline.ready&&d.engine&&d.engine.world&&d.engine.world.terrain&&d.engine.world.terrain.farReady);})()').catch(() => false); }
    if (!ready) { console.log(pose, 'not ready'); continue; }
    await evaluate(cdp, '(()=>{const d=window.__debug; window.__li=setInterval(()=>{ if(d.look) d.look.locked=true; },30); window.__p=d.wgPipeline; window.__p.setPassTiming(true); 0})()', true);
    const info = JSON.parse(await evaluate(cdp, 'JSON.stringify({rays:window.__p.rays,band:window.__p.resolveBandM,grid:[window.__p.rt&&window.__p.rt.cols,window.__p.rt&&window.__p.rt.rows]})'));
    await pause(3000);
    const res = { 40: [], 0: [] };
    for (let f = 0; f < FLIPS; f++) for (const band of (f % 2 ? [0, 40] : [40, 0])) {
      await evaluate(cdp, `window.__p.resolveBandM=${band}; 0`);
      await pause(2000);
      const s = [];
      for (let k = 0; k < 8; k++) { await pause(250); s.push(await evaluate(cdp, 'window.__p.stats.wgPassMsP50[3]')); }
      res[band].push(med(s.map((v) => (v === null ? NaN : v))));
    }
    console.log(await evaluate(cdp, 'JSON.stringify({a:(t=>({att:t._attempted,ser:t._serial,len:Array.from(t._length),dis:t._disposed,busy:t._rings.map(r=>r.busy),cnt:t._rings.map(r=>r.count)}))(window.__p.device.timer),on:window.__p._passTimingOn,p:Array.from(window.__p.stats.wgPassMsP50),t:window.__p.stats.gpuMsP50,off:window.__p.stats.offReason,draw:window.__p.stats.drawMs,en:window.__p.enabled,fr:window.__p.stats.frames,act:window.__p.active,ported:window.__p.portedPasses&&window.__p.portedPasses.join(),be:window.__debug.engine&&window.__debug.engine.rt&&window.__debug.engine.rt.backend,sw:window.__debug.engine&&window.__debug.engine.caps&&window.__debug.engine.caps.softwareRenderer})')); console.log(JSON.stringify({ pose, info, on: res[40], off: res[0], medOn: med(res[40]), medOff: med(res[0]) }));
    await evaluate(cdp, 'clearInterval(window.__li); 0', true);
  }
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
