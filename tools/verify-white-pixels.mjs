// BUG-WHITE-PIXELS-02 repro: load the owner pose, let the sim run 3 s, screenshot, and list near-white cells in the wall region.
// Run: node tools/verify-white-pixels.mjs 9520 [webgl2|webgpu] [--grid 480x180] [--quality low|high]
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const THR = Number(process.env.THR || 245);
const grid = opt('--grid', '480x180'), quality = opt('--quality', 'low');
const frames = Number(opt('--frames', 120)), motion = opt('--motion', 'idle'), keys = opt('--keys', ''); // --frames N: sample N screenshots; --motion idle|jitter|strafe; --keys 'f,1' pressed once before sampling
const port = Number(args[0] || 9520); validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574');
const backend = args[1] || 'webgl2';
assert.ok(['webgpu', 'webgl2'].includes(backend));
const [gc, gr] = grid.split('x').map(Number);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-white-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 540, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&at=1500.70,1027.88,3.00,329,-24&backend=${backend}&grid=${grid}&quality=${quality}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'setInterval(() => { if (window.__debug.look) window.__debug.look.locked = true; }, 30), true');
  await pause(3000);
  const probe = opt('--probe', '');
  if (probe) { const [pc, pr] = probe.split(',').map(Number); // dump G-buffer + sprites around a cell
    console.log(JSON.stringify(await evaluate(cdp, `(() => { const g = window.__debug.gbuf, W = g.cols || g.w || g.width, o = { W, keys: Object.keys(g).slice(0, 8), cells: [] };
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const i = (${pr} + dr) * W + ${pc} + dc; o.cells.push([${pc} + dc, ${pr} + dr, g.kind[i], g.mat[i], g.face[i], +g.z[i].toFixed(2), +g.aoD[i].toFixed(2), +g.fogF[i].toFixed(2)]); }
      const sp = window.__debug.sprites; o.sprites = sp && (sp.count ?? sp.length); return o; })()`)));
  }
  for (const k of keys.split(',').filter(Boolean)) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k }); await pause(200); }
  const analyse = (b64) => evaluateAsync(cdp, `(async () => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, cv = document.querySelector('canvas').getBoundingClientRect();
    const cw = cv.width / ${gc}, ch = cv.height / ${gr}, cells = [];
    for (let row = 20; row < Math.floor(${gr} * 0.92); row++) for (let col = 0; col < ${gc}; col++) {
      let n = 0, tot = 0, mx = 0;
      for (let py = Math.floor(cv.top + row * ch); py < Math.floor(cv.top + (row + 1) * ch); py++) for (let px = Math.floor(cv.left + col * cw); px < Math.floor(cv.left + (col + 1) * cw); px++) {
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue; tot++; const i = (py * c.width + px) * 4;
        if (d[i] >= ${THR} && d[i + 1] >= ${THR} && d[i + 2] >= ${THR}) n++; }
      if (tot && n >= 1) cells.push([col, row, n]);
    } return cells; })()`);
  if (frames > 1) {
    const hits = new Map(); let shot = 0;
    for (let f = 0; f < frames; f++) {
      if (motion === 'jitter') await evaluate(cdp, `window.__debug.look && (window.__debug.look.yawDeg = 329 + ${f % 2 ? 1 : -1} * (1 + (${f} % 3) * 0.3)), true`);
      if (motion === 'strafe') { const t = f % 20 === 0; if (t) await cdp.send('Input.dispatchKeyEvent', { type: f % 40 === 0 ? 'keyDown' : 'keyUp', key: 'd', code: 'KeyD', text: 'd', windowsVirtualKeyCode: 68 }); }
      const sh = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const cells = await analyse(sh.data);
      if (cells.length) { for (const [c, r, n] of cells) { const k = c + ',' + r; (hits.get(k) || hits.set(k, []).get(k)).push(f); } if (!shot) { shot = 1; writeFileSync(path.join(out, `white-pixels-${backend}-${quality}-${motion}-hit.png`), Buffer.from(sh.data, 'base64')); } }
    }
    const list = [...hits].map(([k, v]) => ({ cell: k, frames: v.length, first: v.slice(0, 5) }));
    console.log(JSON.stringify({ backend, quality, motion, keys, frames, hitCells: list.length, list: list.slice(0, 40), errors: errors.length }));
    process.exitCode = 0;
  } else {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(out, `white-pixels-${backend}-${quality}.png`), Buffer.from(s.data, 'base64'));
  // Decode in the page; per cell count pixels >= ${THR} on all channels. Wall region = rows 15%..92% (no HUD top/bottom).
  const res = await evaluateAsync(cdp, `(async () => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,${s.data}')).blob());
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, cv = document.querySelector('canvas').getBoundingClientRect();
    const cw = cv.width / ${gc}, ch = cv.height / ${gr}, r0 = Math.floor(${gr} * 0.15), r1 = Math.floor(${gr} * 0.92), cells = [];
    for (let row = r0; row < r1; row++) for (let col = 0; col < ${gc}; col++) {
      let n = 0, tot = 0, sx = 0, sy = 0;
      for (let py = Math.floor(cv.top + row * ch); py < Math.floor(cv.top + (row + 1) * ch); py++) for (let px = Math.floor(cv.left + col * cw); px < Math.floor(cv.left + (col + 1) * cw); px++) {
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue; tot++; const i = (py * c.width + px) * 4;
        if (d[i] >= ${THR} && d[i + 1] >= ${THR} && d[i + 2] >= ${THR}) { n++; sx = d[i]; sy = d[i + 2]; } }
      if (tot && n >= 1) cells.push({ col, row, rgb: [sx, 0, sy], whitePx: n, of: tot });
    }
    return { canvas: [cv.left, cv.top, cv.width, cv.height], cells };
  })()`);
  console.log(JSON.stringify({ backend, quality, grid, canvas: res.canvas, whiteCells: res.cells, count: res.cells.length, errors: errors.length }));
  }
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
}
