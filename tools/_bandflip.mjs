import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
const { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } = await import('./capture-browser.mjs');
const port = Number(process.env.PORT || 9730); validatePort(port);
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
  cdp.onEvent((method, params) => { const m = { method, params }; if (m.method === 'Runtime.exceptionThrown') console.error('EXC', JSON.stringify(m.params).slice(0, 500)); else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.error('CON', m.params.type, m.params.args.map((a) => a.value || a.description).join(' ').slice(0, 400)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  for (const pose of poses) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?pose=${pose}&quality=ultra&title=0&f3=1` });
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '(()=>{const d=window.__debug;return !!(d&&d.wgPipeline&&d.wgPipeline.ready&&d.engine&&d.engine.world&&d.engine.world.terrain&&d.engine.world.terrain.farReady);})()').catch(() => false); }
    if (!ready) { console.log(pose, 'not ready'); continue; }
    await pause(3000);
    await evaluate(cdp, '(()=>{const d=window.__debug; window.__li=setInterval(()=>{ if(d.look) d.look.locked=true; },30); window.__p=d.wgPipeline; window.__p.setPassTiming(true); 0})()', true);
    const info = JSON.parse(await evaluate(cdp, 'JSON.stringify({rays:window.__p.rays,band:window.__p.resolveBandM,grid:[window.__p.rt&&window.__p.rt.cols,window.__p.rt&&window.__p.rt.rows]})'));
    await pause(3000);
    const res = { 40: [], 0: [] }, tot = { 40: [], 0: [] };
    for (let f = 0; f < FLIPS; f++) for (const band of (f % 2 ? [0, 40] : [40, 0])) {
      await evaluate(cdp, `window.__p.resolveBandM=${band}; 0`);
      await pause(2000);
      const s = [], t = [];
      // Raw per-frame samples (not the 120-sample P50, which lags a flip): fresh resolve-slot ms pushed since the flip; total = sum of all slots' latest.
      await evaluate(cdp, '(()=>{window.__h=[]; window.__ht=[]; const tm=window.__p.device.timer; window.__hi=setInterval(()=>{ if(tm._latest[3]===tm._latest[3]){ const k=tm._latestSerial[3]; if(k!==window.__lk){window.__lk=k; window.__h.push(tm._latest[3]); let a=0; for(let i=0;i<16;i++) a+=(tm._latest[i]||0); window.__ht.push(a);} } },25); return 0;})()', true);
      await pause(3000);
      const raw = JSON.parse(await evaluate(cdp, 'clearInterval(window.__hi); JSON.stringify([window.__h,window.__ht])'));
      if (!raw[0].length) console.error('empty', await evaluate(cdp, 'JSON.stringify({on:window.__p._passTimingOn,ser:window.__p.device.timer._serial,ls:window.__p.device.timer._latestSerial[3],lat:window.__p.device.timer._latest[3],lk:window.__lk,hv:document.visibilityState,en:window.__p.enabled})'));
      s.push(med(raw[0])); t.push(med(raw[1]));
      res[band].push(med(s.map((v) => (v === null ? NaN : v)))); tot[band].push(med(t.map((v) => (v === null ? NaN : v))));
    }
    console.log(JSON.stringify({ pose, info, resolveOn: res[40], resolveOff: res[0], medResolveOn: med(res[40]), medResolveOff: med(res[0]), medTotOn: med(tot[40]), medTotOff: med(tot[0]) }));
    await evaluate(cdp, 'clearInterval(window.__li); 0', true);
  }
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
