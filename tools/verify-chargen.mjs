// CHARGEN-13: headless browser check of tools/chargen/index.html (CDP helpers from capture-browser.mjs).
// Checks: 0 console errors/exceptions, canvas non-empty, Random changes the glb bytes.
// Run: node tools/verify-chargen.mjs {port}   (PC-B range 9500-9999; CDP uses port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2]);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-chargen-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception?.description || ''));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error ' + p.args.map((a) => a.value ?? a.description).join(' '));
    if (m === 'Log.entryAdded' && p.entry.level === 'error') errors.push('log ' + p.entry.text + ' ' + (p.entry.url || ''));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/chargen/index.html` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__chargen && window.__chargen.glb)')) { ready = true; break; } }
  assert.ok(ready, 'page did not become ready: ' + JSON.stringify(errors));
  await pause(800);
  // Canvas non-empty: read pixels back (preserveDrawingBuffer) and count pixels differing from the background.
  const px = await evaluate(cdp, `(() => { const c = window.__chargen.viewer.canvas, t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; const b = [d[0], d[1], d[2]]; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2]) > 30) n++; return n; })()`);
  assert.ok(px > 500, 'canvas looks empty: ' + px + ' non-background pixels');
  const hash = () => evaluate(cdp, 'Array.from(window.__chargen.glb).reduce((h, b) => (Math.imul(h, 31) + b) >>> 0, 7) + ":" + window.__chargen.glb.length');
  const h0 = await hash();
  await evaluate(cdp, `(() => { const s = document.querySelector('#seed'); s.value = '12345'; document.querySelector('#random').click(); })()`);
  let h1 = h0;
  for (let i = 0; i < 40 && h1 === h0; i++) { await pause(150); h1 = await hash(); }
  assert.notEqual(h1, h0, 'Random did not change the glb bytes');
  // CHARGEN-22d: switch Head detail to the finest enabled level and assert the glb bytes change
  const fine = await evaluate(cdp, `(() => { const sel = [...document.querySelectorAll('select')].find((x) => x.previousSibling && x.previousSibling.textContent === 'Head detail'); if (!sel) return -1;
    const o = [...sel.options].filter((x) => !x.disabled && Number(x.value) > 1).pop(); if (!o) return 0; sel.value = o.value; sel.dispatchEvent(new Event('change')); return Number(o.value); })()`);
  assert.notEqual(fine, -1, 'Head detail row missing');
  if (fine > 0) {
    const h2a = await hash(); let h2 = h2a;
    for (let i = 0; i < 40 && h2 === h2a; i++) { await pause(150); h2 = await hash(); }
    assert.notEqual(h2, h2a, 'Head detail did not change the glb bytes');
    console.log('head detail level ' + fine + ': glb ' + h2a + ' -> ' + h2);
  } else console.log('head detail: no finer level enabled in this kit, skipped');
  await pause(300);
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'chargen-app.png'), Buffer.from(s.data, 'base64'));
  assert.deepEqual(errors, [], 'console errors');
  console.log(JSON.stringify({ pixels: px, glbBefore: h0, glbAfter: h1 }));
  console.log('chargen app: loads with 0 errors, canvas non-empty, Random changes the glb PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
