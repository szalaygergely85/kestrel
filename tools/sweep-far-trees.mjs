// OB-222 navy-tree sweep: N spots x 8 yaws x hours, headless WebGPU, counts "navy" (luma<60, b>=g) and "pale flat" cells in the far band
// (rows 30%-58% of the frame, just around the horizon) and saves the worst stills to docs/test-reports/navysweep/.
// Run: node tools/sweep-far-trees.mjs <port> [backend]   Env: HOURS=9,12,17  EXTRA="farforest=1"  TAG=now  YAWS=8  SPOTS=0,1  KEEP=6
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { snapEnv } from '../game/js/dev/bugSnapshot.js';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

// REPORT-KEY-01: SNAP="<F8 report line>" replays the owner's view (pose, clock, quality, size, flags) instead of the sweep grid.
const SNAP = snapEnv(process.env.SNAP); if (SNAP) Object.assign(process.env, { HOURS: SNAP.HOUR || SNAP.HOURS, QUALITY: SNAP.QUALITY || 'high', W: SNAP.W, H: SNAP.H, EXTRA: SNAP.EXTRA, YAWS: '1' });
const port = Number(process.argv[2] || 9575); validatePort(port);
const backend = process.argv[3] || 'webgpu';
const hours = (process.env.HOURS || '9,12,17').split(',');
const tag = process.env.TAG || 'now';
const nYaw = Number(process.env.YAWS || 8), keep = Number(process.env.KEEP || 6);
const extra = process.env.EXTRA ? '&' + process.env.EXTRA : '';
const SPOTS = SNAP ? [{ name: 'snap', x: SNAP.x, y: SNAP.y, snap: true }] : [
  { name: 'meadow', x: 1466, y: 1035 }, { name: 'burl', x: 1404, y: 1010 }, { name: 'tower', x: 1471, y: 1025 },
  { name: 'ford', x: 1010, y: 1060 }, { name: 'crossroads', x: 1380, y: 1040 }, { name: 'hilltop', hill: true },
].filter((s, i) => SNAP || !process.env.SPOTS || process.env.SPOTS.split(',').includes(String(i)));
const outDir = path.join(ROOT, 'docs/test-reports/navysweep'); mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-navy-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// counts inside the page (PNG -> canvas): navy = luma<60 && b>=g ; pale = luma>200 && max-min<28 (flat grey/cream, no sky blue)
const COUNT = `async(b64)=>{const im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();const W=im.width,H=im.height;const c=new OffscreenCanvas(W,H);const x=c.getContext('2d');x.drawImage(im,0,0);const y0=Math.floor(H*0.30),y1=Math.floor(H*0.58);const d=x.getImageData(0,y0*0+0,W,H).data;let navy=0,pale=0,n=0;for(let yy=y0;yy<y1;yy++)for(let xx=0;xx<W;xx++){const i=(yy*W+xx)*4,r=d[i],g=d[i+1],bl=d[i+2],l=0.299*r+0.587*g+0.114*bl;n++;if(l<60&&bl>=g)navy++;else if(l>200&&Math.max(r,g,bl)-Math.min(r,g,bl)<28)pale++;}return {navy,pale,n};}`;
let browser, cdp; const rows = [];
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W || 1000), height: Number(process.env.H || 700), deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const hour of hours) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&dev=1&title=0&nopause=1&backend=${backend}&quality=${process.env.QUALITY || "high"}&time=${hour}${extra}` });
    let ok = false;
    for (let i = 0; i < 400 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world)')); } catch { /* navigating */ } }
    if (!ok) throw new Error('world never became ready');
    await pause(8000);
    for (const S of SPOTS) {
      let sx = S.x, sy = S.y;
      if (S.hill) { const h = await evaluate(cdp, `(()=>{const T=__debug.world.terrain;let b=null;for(let x=1300;x<=1560;x+=10)for(let y=940;y<=1120;y+=10){const z=T.heightAt(x,y);if(!b||z>b.z)b={x,y,z};}return b;})()`); sx = h.x; sy = h.y; }
      await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${sx};t.y=${sy};if(__debug.vitals&&__debug.vitals.setGodMode)__debug.vitals.setGodMode(true);const T=__debug.world.terrain,gz=(T.groundAt||T.heightAt).call(T,${sx},${sy});t.z=(gz==null?12:gz+0.2);})()`);
      await pause(9000);
      for (let k = 0; k < nYaw; k++) {
        const yaw = SNAP ? SNAP.yaw : k * 360 / nYaw;
        await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.yawDeg=${yaw};t.pitchDeg=${SNAP ? SNAP.pitch : 0};const L=__debug.look;if(L){L.yawDeg=${yaw};L.pitchDeg=${SNAP ? SNAP.pitch : 0};}})()`);
        await pause(1800);
        const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const m = await evaluateAsync(cdp, `(${COUNT})(${JSON.stringify(s.data)})`);
        rows.push({ hour, spot: S.name, yaw, navy: m.navy, pale: m.pale, navyPct: +(100 * m.navy / m.n).toFixed(1), palePct: +(100 * m.pale / m.n).toFixed(1), png: s.data });
      }
      console.log('done', hour, S.name);
    }
  }
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp profile left */ }
}
console.table(rows.map(({ png, ...r }) => r));
const tot = rows.reduce((a, r) => (a.navy += r.navy, a.pale += r.pale, a), { navy: 0, pale: 0 });
console.log(`TOTAL ${tag}: navy=${tot.navy} pale=${tot.pale} cases=${rows.length}`);
[...rows].sort((a, b) => b.navy - a.navy).slice(0, keep).forEach((r, i) => writeFileSync(path.join(outDir, `${tag}-${i + 1}-${r.spot}-h${r.hour}-y${r.yaw}.png`), Buffer.from(r.png, 'base64')));
