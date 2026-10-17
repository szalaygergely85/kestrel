// OB-189: low-preset horizontal light stripes on ground/grass. Captures the real game at ?quality=<low|medium|high> (+ a few
// window sizes: integer vs fractional canvas stretch) at a meadow pose, then counts "stripe rows" in the lower (ground) third:
// rows whose mean luma differs from the mean of the rows 2-3 px above/below by > THRESH, per frame. Prints a table, writes PNGs.
// Hypothesis: OB-117 fitCssFill (non-uniform CSS stretch of the integer-px backing store, smooth sampling) beats BUG-SQUARES-01's
// 1:1 rule, so glyph-row edges resample into light lines. Compare low vs high stripe counts and window sizes.
// Run: node tools/verify-ob189.mjs {port} [webgpu]     (PC-B port range 9575-9649; CDP uses port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9575 || port + 1 > 9649) throw new Error('lane range is 9575-9649 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');
const POSE = process.env.OB189_POSE || 'forestWalk', THRESH = 6;

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-ob189-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Runs in the page: decode the PNG, per-row luma over the lower third, count rows that stick out from their +-2..3 px neighbours.
const COUNT = (b64, thresh) => `(async()=>{const im=new Image();im.src='data:image/png;base64,${b64}';await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const W=c.width,H=c.height,y0=Math.floor(H*0.68),y1=H-4;const d=x.getImageData(0,0,W,H).data;const m=new Float64Array(H);for(let y=y0-3;y<y1+3;y++){let s=0;for(let i=0;i<W;i++){const o=(y*W+i)*4;s+=0.3*d[o]+0.59*d[o+1]+0.11*d[o+2];}m[y]=s/W;}let n=0;for(let y=y0;y<y1;y++){const nb=(m[y-2]+m[y-3]+m[y+2]+m[y+3])/4;if(Math.abs(m[y]-nb)>${thresh})n++;}return {rows:y1-y0,stripeRows:n,frac:+(n/(y1-y0)).toFixed(3)};})()`;
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // headless page otherwise loses focus -> game pauses
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  const rows = [];
  for (const q of ['low', 'medium', 'high']) for (const [w, h] of [[1280, 720], [1717, 790], [1366, 638]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?pose=${POSE}&gpu=${backend}&quality=${q}&title=0&shadows=off&nopause=1` });
    await pause(9000);
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const name = `ob189-${q}-${w}x${h}`; writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64'));
    const r = await evaluateAsync(cdp, COUNT(s.data, THRESH));
    const css = await evaluate(cdp, '(()=>{const c=document.querySelector("canvas");const b=c.getBoundingClientRect();return {back:c.width+"x"+c.height,css:Math.round(b.width)+"x"+Math.round(b.height),ir:getComputedStyle(c).imageRendering};})()');
    rows.push({ q, win: `${w}x${h}`, ...css, ...r }); console.log(JSON.stringify(rows.at(-1)));
  }
  const lowMax = Math.max(...rows.filter((r) => r.q === 'low').map((r) => r.frac)), highMax = Math.max(...rows.filter((r) => r.q === 'high').map((r) => r.frac));
  console.log(`stripe fraction low ${lowMax} vs high ${highMax} (screenshots: ${out}/ob189-*.png)`);
  assert.deepEqual(errors, []);
  assert.ok(lowMax <= highMax + 0.05, `OB-189: low preset has more stripe rows (${lowMax}) than high (${highMax})`);
  console.log('OB-189: low preset stripe rows not above high PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
