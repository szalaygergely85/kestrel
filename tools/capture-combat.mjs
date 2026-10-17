// COMBAT-CAPTURE-01: owner readability capture of the combat bench (?bench=combat) at several grids.
// Run: node tools/capture-combat.mjs --port 9500 [--backend webgpu] [--grids 240x90,400x150] [--out docs/test-reports/combat-capture]
// Stills are taken at script times of game/js/dev/combatBench.js (the script only holds 'swing' hits at 500 ms steps, no
// boar-distance moments, so the nearest times are used - the boars keep walking in via the real beastSim; the clock
// starts when window.__debug.beasts is ready, so times are approximate). No game edits.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { withTimeFreeze, parseTimeArg } from './tool-url.mjs'; // DN-04a
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

export const STILLS = [
  { slug: 'idle-8m', tMs: 0, caption: 'boar idle (~8 m)' },
  { slug: 'windup-5m', tMs: 500, caption: 'windup (~5 m)' },
  { slug: 'charge-3m', tMs: 1500, caption: 'charge (~3 m)' },
  { slug: 'hit-1m', tMs: 2500, caption: 'hit spark (~1 m)' },
];
export const DEFAULTS = { backend: 'webgpu', grids: ['240x90', '400x150'], out: 'docs/test-reports/combat-capture' };

export function parseArgs(argv) {
  const o = { port: NaN, backend: DEFAULTS.backend, grids: [...DEFAULTS.grids], out: DEFAULTS.out };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a.startsWith('--time=')) o.time = parseTimeArg(a.slice(7));
    else if (a === '--time') o.time = parseTimeArg(v());
    else if (a === '--port') o.port = Number(v());
    else if (a === '--backend') o.backend = v();
    else if (a === '--grids') o.grids = v().split(',').filter(Boolean);
    else if (a === '--out') o.out = v();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(o.port)) throw new Error('--port <n> is required');
  if (!['webgpu', 'webgl2'].includes(o.backend)) throw new Error('--backend must be webgpu or webgl2');
  for (const g of o.grids) if (!/^\d+x\d+$/.test(g)) throw new Error(`bad grid ${g} (expected WxH)`);
  return o;
}
export const stillName = (grid, slug) => `combat-${grid}-${slug}.png`;
export const stillTimes = () => STILLS.map((s) => s.tMs);
export const pageUrl = (port, grid, backend, hour) => `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`bench=combat&grid=${grid}&backend=${backend}`, hour)}`;

export function contactSheetHtml(grids, backend) {
  const rows = grids.map((g) => `<h2>${g}</h2><div class="row">${STILLS.map((s) =>
    `<figure><img src="${stillName(g, s.slug)}" alt="${g} ${s.slug}"><figcaption>${g} - ${s.caption} @ ${s.tMs} ms</figcaption></figure>`).join('')}</div>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Combat readability (${backend})</title>
<style>body{background:#111;color:#ddd;font:14px monospace}.row{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:49%}img{width:100%;image-rendering:pixelated}</style>
<h1>Combat readability - backend ${backend}</h1>\n${rows}\n`;
}

/** Browser step; `shoot(grid, still)` -> PNG Buffer. Injectable so the test can mock it. */
export async function captureAll(opts, shoot) {
  mkdirSync(opts.out, { recursive: true });
  const files = [];
  for (const g of opts.grids) {
    for (const s of STILLS) { writeFileSync(path.join(opts.out, stillName(g, s.slug)), await shoot(g, s)); files.push(stillName(g, s.slug)); }
  }
  writeFileSync(path.join(opts.out, 'index.html'), contactSheetHtml(opts.grids, opts.backend)); files.push('index.html');
  return files;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  validatePort(opts.port);
  if (opts.port < 9500 || opts.port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
  opts.out = path.resolve(ROOT, opts.out);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-combat-cap-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(opts.port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${opts.port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${opts.port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(opts.port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    let cur = null, t0 = 0;
    const shoot = async (grid, still) => {
      if (cur !== grid) {
        cur = grid;
        await cdp.send('Page.navigate', { url: pageUrl(opts.port, grid, opts.backend, opts.time) });
        let ready = false;
        for (let i = 0; i < 200 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '!!(window.__debug && window.__debug.beasts && window.__debug.beasts.count >= 4)'); }
        if (!ready) throw new Error(`combat bench not ready at grid ${grid}`);
        // headless: no pointer lock, and an unlocked look pauses the sim (as in verify-motes.mjs)
        await evaluate(cdp, 'setInterval(() => { if (window.__debug.look) window.__debug.look.locked = true; }, 30), true');
        t0 = Date.now();
      }
      const wait = still.tMs - (Date.now() - t0); if (wait > 0) await pause(wait);
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(s.data, 'base64');
    };
    const files = await captureAll(opts, shoot);
    console.log(`combat capture: ${files.length} files in ${opts.out} - open index.html`);
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
