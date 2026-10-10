// QUALITY-BOOT-01: a saved quality must boot at the preset grid (ultra = 480x180). Variants: plain, stale saved grid, big window, title menu. Same CDP approach as tools/verify-chest-hook.mjs, reusing capture-browser.mjs's
// exported helpers - PC-B port range only (9500-9574). Starts its own server, kills only
// the processes it spawned, screenshots into docs/test-reports/captures/.
// Run: node tools/verify-quality-boot.mjs 9500 (webgpu, default)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-quality-boot-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [], warns = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); if (m === 'Runtime.consoleAPICalled' && p.type === 'warning') warns.push(p.args.map((a) => a.description || a.value).join(' ').slice(0, 500)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  const variants = [
    { name: 'ultra', ls: { quality: 'ultra' }, w: 1280, h: 720, q: 'title=0' },
    { name: 'ultra+stale-grid', ls: { quality: 'ultra', grid: '240x90' }, w: 1280, h: 720, q: 'title=0' },
    { name: 'ultra-1920', ls: { quality: 'ultra', grid: '240x90' }, w: 1920, h: 1080, q: 'title=0' },
    { name: 'ultra+title', ls: { quality: 'ultra', grid: '240x90' }, w: 1600, h: 900, q: '' },
    { name: 'high-1920', ls: { quality: 'high' }, w: 1920, h: 1080, q: 'title=0', expect: '400x150' },
    { name: 'ultra-1717', ls: { quality: 'ultra' }, w: 1717, h: 790, q: 'title=0' },
    { name: 'high-1717', ls: { quality: 'high' }, w: 1717, h: 790, q: 'title=0', expect: '400x150' },
  ];
  const results = []; let scriptId = null;
  for (const v of variants) {
    warns.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false });
    if (scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
    const blob = JSON.stringify({ settingsVersion: 1, ...v.ls });
    scriptId = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('kestrel.settings', ${JSON.stringify(blob)});}catch(e){}` })).identifier;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&backend=webgpu&${v.q}` });
    let ready = false;
    for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug && !!window.__debug.engine')) { ready = true; break; } }
    assert.ok(ready, JSON.stringify(errors));
    await pause(4000);
    const r = await evaluate(cdp, `(() => { const rt = window.__debug.engine.renderTarget; const cv = rt.canvas; const sz = { css: [cv.style.width, cv.style.height], backing: [cv.width, cv.height], px: [rt.pxCellW, rt.pxCellH] }; const p = window.__debug.wgPipeline; return { sz, cols: rt.cols, rows: rt.rows, backend: rt.backend, frameComplete: !!(p && p.frameComplete), gpuActive: !!rt.gpuActive, pending: window.__debug.engine._pendingGrid || null, saved: localStorage.getItem('kestrel.settings') }; })()`);
    results.push({ variant: v.name, ...r, warns: warns.filter((w) => /setGrid|GPU grid|quality|grid/.test(w)).slice(0, 4) });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  console.log(JSON.stringify({ errors: errors.map((e) => (e.exception && e.exception.description || e.text).slice(0, 300)) }));
  for (const r of results) assert.equal(`${r.cols}x${r.rows}`, r.variant.startsWith('high') ? '400x150' : '480x180', `${r.variant}: grid`);
  const area = (r) => parseFloat(r.sz.css[1]); // height: width follows the integer cell aspect (3x4 vs 4x5 px)
  for (const w of ['1920', '1717']) { const h = results.find((x) => x.variant === 'high-' + w), u = results.find((x) => x.variant === 'ultra-' + w); assert.ok(area(u) >= area(h) * 0.97, `ultra picture smaller than high at ${w}: ${area(u)} vs ${area(h)}`); }
  console.log('Quality boot: all variants at 480x180');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
