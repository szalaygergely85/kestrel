#!/usr/bin/env node
// tools/viewport-fit-browser.mjs (BUG-HUD-OFFSCREEN-01 headless check). Own server + headless Chrome over CDP on --port (95xx).
//   node tools/viewport-fit-browser.mjs --port 9535 [--backends webgpu] [--dprs 1,1.25,1.5]
// For viewports 1280x720 / 1920x969 x grids 240x90 (rays 1+2) / 400x150 / 480x180 x DPR: the canvas bounding rect must lie inside
// the window (so the bottom HUD and the top-left objective line are visible). Exit 1 on any overflow.
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port); validatePort(port);
const backends = (args.backends || 'webgpu').split(',');
const dprs = (args.dprs || '1,1.25,1.5').split(',').map(Number);
const VIEWS = [[1280, 720], [1920, 969], [1024, 768]]; // S8-B1-12: 1024x768 added for the resize/DPR/fullscreen owner-look AC
const GRIDS = [['240x90', 1], ['240x90', 2], ['400x150', 2], ['480x180', 4]];
const handles = {};
function cleanup() {
  if (handles.b) killTree(handles.b.pid);
  if (handles.s) killTree(handles.s.pid);
  if (handles.dir) { try { rmSync(handles.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
process.once('SIGINT', () => { cleanup(); process.exit(1); });
const evalIn = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 90000 });
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
};
const PROBE = `(async () => { for (let i = 0; i < 1200 && !(window.__debug && window.__debug.rt && window.__debug.rt.pxCellH && window.__debug.loop); i++) await new Promise((r) => setTimeout(r, 50));
  if (!(window.__debug && window.__debug.rt)) return { error: "boot timeout: no window.__debug.rt after 60 s", backend: "none", left: 0, top: 0, right: 1e9, bottom: 1e9, iw: innerWidth, ih: innerHeight };
  const rt = window.__debug.rt, c = document.getElementById('screen').getBoundingClientRect();
  return { backend: rt.backend, cols: rt.cols, rows: rt.rows, pxW: rt.pxCellW, pxH: rt.pxCellH, left: c.left, top: c.top, right: c.right, bottom: c.bottom, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio }; })()`;

const rows = [];
let bad = 0;
try {
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary');
  handles.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  handles.dir = path.join(os.tmpdir(), 'kestrel-vpfit-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({ backend: backends.includes('webgpu') ? 'webgpu' : undefined }), '--no-sandbox', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  for (const backend of backends) for (const [w, h] of VIEWS) for (const dpr of dprs) for (const [grid, rays] of GRIDS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`voxelbench=0&save=0&grid=${grid}&rays=${rays}&backend=${backend}`)}` });
    await loaded;
    const r = await evalIn(cdp, PROBE);
    const eps = 0.01;
    const fit = r.left >= -eps && r.top >= -eps && r.right <= r.iw + eps && r.bottom <= r.ih + eps;
    if (r.error || !fit || r.backend !== ('webgpu')) bad++;
    rows.push(`${fit ? 'ok  ' : 'FAIL'} ${backend} ${w}x${h} dpr${dpr} ${grid} r${rays} -> backend=${r.backend} cell ${r.pxW}x${r.pxH}px canvas ${r.left.toFixed(1)},${r.top.toFixed(1)}..${r.right.toFixed(1)},${r.bottom.toFixed(1)} of ${r.iw}x${r.ih}`);
  }
  cdp.close();
} finally { cleanup(); }
console.log(rows.join('\n'));
console.log(bad ? `viewport-fit: FAIL (${bad})` : 'viewport-fit: PASS');
process.exit(bad ? 1 : 0);
