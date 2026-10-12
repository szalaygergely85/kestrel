// STREAM-01c browser pass (docs/architecture.md 38.51): headless stills at 2 placement-grid cell borders, ?stream=0 vs default.
// Counts differing cells (glyph or colour, via the canvas pixels cut into cell blocks) overall and for cells whose depth < minM.
// Expect: 0 differing cells with depth < minM (160 m), <= 0.2 % overall. NEEDS B1-main: `?stream=0` -> engine.world.streaming.enabled = false.
// Run: node tools/verify-stream.mjs 9575 [z=40]   (PC-B lane B1 range; CDP on port+1; kills only its own server + browser)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
const Z = Number(process.argv[3] || 40), MIN_M = 160, OVERALL_MAX = 0.002;
// two cell borders (cellM 64) near the tower: x = 23*64 = 1472 and y = 16*64 = 1024; +-0.4 m straddles the hysteresis-free classify edge
const POSES = [{ name: 'xBorder', at: [1472.4, 1018, Z, 90] }, { name: 'yBorder', at: [1480, 1024.4, Z, 180] }];
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-stream-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;

// In-page: decode a screenshot into per-cell signatures (cell size from the glyph grid in __debug.rt) + per-cell depth.
const GRAB = (b64) => `(async()=>{const d=window.__debug,rt=d.rt,cols=rt.cols||rt.width,rows=rt.rows||rt.height;
  const img=await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
  const c=new OffscreenCanvas(img.width,img.height),x=c.getContext('2d');x.drawImage(img,0,0);
  const cw=img.width/cols,ch=img.height/rows,sig=new Uint32Array(cols*rows),px=x.getImageData(0,0,img.width,img.height).data;
  for(let r=0;r<rows;r++)for(let q=0;q<cols;q++){let h=2166136261;for(let yy=Math.floor(r*ch);yy<Math.floor((r+1)*ch);yy+=2)for(let xx=Math.floor(q*cw);xx<Math.floor((q+1)*cw);xx+=2){const o=(yy*img.width+xx)*4;h=Math.imul(h^(px[o]>>2),16777619);h=Math.imul(h^(px[o+1]>>2),16777619);h=Math.imul(h^(px[o+2]>>2),16777619);}sig[r*cols+q]=h>>>0;}
  const db=d.depthBuffer,dp=db&&(db.data||db.depth||db.buf),depth=dp?Array.from(dp.slice?dp.slice(0,cols*rows):dp):null;
  return {cols,rows,sig:Array.from(sig),depth};})()`;

async function still(pose, stream) {
  const url = `http://127.0.0.1:${port}/game/index.html?capture=1&at=${pose.at.join(',')}${stream ? '' : '&stream=0'}`;
  await cdp.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug&&window.__debug.rt&&window.__debug.engine)')) { ready = true; break; } }
  assert.ok(ready, 'game booted');
  await pause(4000); // lazy meshes + grid hysteresis settle (20 s LRU not needed: stills compare what is drawn)
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(out, `stream-${pose.name}-${stream ? 'on' : 'off'}.png`), Buffer.from(s.data, 'base64'));
  return evaluate(cdp, GRAB(s.data));
}

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const report = [];
  for (const pose of POSES) {
    const on = await still(pose, true), off = await still(pose, false);
    assert.equal(on.cols * on.rows, off.cols * off.rows, 'same grid size');
    let diff = 0, near = 0; const n = on.sig.length;
    for (let i = 0; i < n; i++) {
      if (on.sig[i] === off.sig[i]) continue;
      diff++;
      const dpt = off.depth ? off.depth[i] : NaN;
      if (dpt < MIN_M) near++; // NaN (no depth readable) never counts: the script then reports depth:false below
    }
    const row = { pose: pose.name, cells: n, diff, pct: +(100 * diff / n).toFixed(3), nearDiff: near, depth: !!off.depth };
    report.push(row); console.log(JSON.stringify(row));
    assert.equal(near, 0, `${pose.name}: ${near} differing cells with depth < ${MIN_M} m`);
    assert.ok(diff / n <= OVERALL_MAX, `${pose.name}: ${row.pct} % differing cells > 0.2 %`);
  }
  console.log('STREAM-01c stills: stream on vs ?stream=0 PASS', JSON.stringify(report));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
