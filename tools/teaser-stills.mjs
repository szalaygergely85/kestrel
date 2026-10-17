#!/usr/bin/env node
// TEASER-QA: headless stills of every design/cinematics/teaser-*.json path (one browser run).
// node tools/teaser-stills.mjs --port 95xx [--ids a,b] [--hours id=H,..] [--quality high] [--grid 480x180] [--timeout 300] [--retries 1]
// (QUALITY= / GRID= env also work; default quality high. Each shot has its own timeout + one automatic retry with a fresh page load; one PASS/FAIL line per shot.)
// [--view 1920x1080] [--view 1920x1080] [--out dir]
// Plays each path at its intended hour (README table / note) and saves frames at start / middle / end:
//   <out>/<id>-start.png, -mid.png, -end.png + <id>-sheet.png (3 frames side by side, the portrait 9:16 centre crop outlined).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validatePort, buildLaunchFlags, findBrowserBinary, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
import { buildQuery } from './capture-cinematic.mjs';
import { pickQuality, parseGrid, runShot, resultLine } from './still-robust.mjs';

// Intended capture hour per teaser (design/cinematics/README.md table + each file's note). teaser-water 17 -> 12 (TEASER-QA: water near-black at 17:00).
export const TEASER_HOURS = Object.freeze({
  'teaser-grass': 17, 'teaser-water': 12, 'teaser-fire': 22, 'teaser-sky': 19, 'teaser-leaves': 10,
  'teaser-dawn-sea': 6.25, 'teaser-crypt-drone': 22, 'teaser-crypt-night': 22, 'teaser-river-falls': 11, 'teaser-strand-dawn': 6.5,
});

function parse(argv) {
  const o = { port: NaN, ids: null, quality: null, grid: process.env.GRID || '480x180', timeout: 300, retries: 1, view: '1920x1080', out: path.join(ROOT, 'docs', 'test-reports', 'teaser') };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--port') o.port = Number(v); else if (k === '--ids') o.ids = v.split(',');
    else if (k === '--quality') o.quality = v; else if (k === '--grid') o.grid = v;
    else if (k === '--hours') o.hours = Object.fromEntries(v.split(',').map((kv) => kv.split('=')).map(([a, b]) => [a, Number(b)]));
    else if (k === '--timeout') o.timeout = Number(v); else if (k === '--retries') o.retries = Number(v);
    else if (k === '--view') o.view = v; else if (k === '--out') o.out = path.resolve(v);
    else throw new Error(`unknown argument ${k}`);
  }
  validatePort(o.port); validatePort(o.port + 1);
  o.quality = pickQuality(o.quality, process.env); parseGrid(o.grid);
  o.ids ||= readdirSync(path.join(ROOT, 'design', 'cinematics')).filter((f) => /^teaser-[\w-]+\.json$/.test(f)).map((f) => f.slice(0, -5));
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const [vw, vh] = o.view.split('x').map(Number);
  mkdirSync(o.out, { recursive: true });
  const server = spawn('python', ['tools/serve.py', String(o.port)], { cwd: ROOT, stdio: 'ignore' });
  let browser, cdp, profile;
  const cleanup = () => { if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); };
  const report = [];
  try {
    await waitForHttp(`http://127.0.0.1:${o.port}/`, 10000);
    profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-teaser-'));
    browser = spawn(findBrowserBinary(), ['--headless=new', ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--window-size=${vw},${vh}`,
      `--remote-debugging-port=${o.port + 1}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    cdp = await connectCdp(o.port + 1, 15000);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
    const exceptions = [];
    cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text); });
    const shotOnce = async (id) => {
      exceptions.length = 0;
      const hour = o.hours?.[id] ?? TEASER_HOURS[id] ?? 12;
      const q = buildQuery({ grid: o.grid, hour, clean: true }, id) + `&quality=${o.quality}`;
      await cdp.send('Page.navigate', { url: 'about:blank' });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${o.port}/game/index.html?${q}` });
      const deadline = Date.now() + o.timeout * 1000 - 5000;
      while (!(await evaluate(cdp, '!!window.__cine'))) {
        const err = await evaluate(cdp, 'window.__cineError');
        if (err || Date.now() > deadline) throw new Error(String(err || 'world not ready'));
        await new Promise((r) => setTimeout(r, 200));
      }
      const frames = await evaluate(cdp, '__cine.frames');
      const picks = { start: 0, mid: Math.floor((frames - 1) / 2), end: frames - 1 };
      // Step through every frame (playback is sequential); grab PNGs only at the picks, then build the sheet in-page.
      const res = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const picks = ${JSON.stringify(picks)}, want = new Map(Object.entries(picks).map(([k, v]) => [v, k])), out = {};
        for (let i = 0; i < ${frames}; i++) { await __cine.step(i); if (want.has(i)) out[want.get(i)] = __debug.rt.canvas.toDataURL('image/png'); }
        const imgs = await Promise.all(Object.keys(picks).map((k) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = out[k]; })));
        const w = 640, h = Math.round(w * imgs[0].height / imgs[0].width), c = document.createElement('canvas');
        c.width = w * 3 + 8; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, h);
        imgs.forEach((im, j) => { g.drawImage(im, j * (w + 4), 0, w, h); const cw = h * 9 / 16, x0 = j * (w + 4) + (w - cw) / 2;
          g.strokeStyle = 'rgba(255,0,255,0.8)'; g.strokeRect(x0, 0, cw, h); });
        out.sheet = c.toDataURL('image/png');
        return out;
      })()` });
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
      for (const [k, url] of Object.entries(res.result.value)) writeFileSync(path.join(o.out, `${id}-${k}.png`), Buffer.from(url.split(',')[1], 'base64'));
      return { id, hour, frames, picks, exceptions: exceptions.slice(0, 3) };
    };
    for (const id of o.ids) {
      const r = await runShot(() => shotOnce(id), { timeoutMs: o.timeout * 1000, retries: o.retries, label: id });
      console.log(resultLine(id, r));
      report.push(r.ok ? r.value : { id, error: r.error });
    }
    if (report.some((r) => r.error)) process.exitCode = 1;
    writeFileSync(path.join(o.out, 'stills.json'), JSON.stringify({ quality: o.quality, grid: o.grid, view: o.view, shots: report }, null, 2) + '\n');
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch { /* closed */ } cdp.close(); }
    cleanup();
    if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp profile left */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
