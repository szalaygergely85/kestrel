#!/usr/bin/env node
// RND-PROBE-01 FAR-WALL-PROBE (VISQA-27 prerequisite): turns "the far canyon wall looks flat grey" into numbers.
// Loads game/index.html at the teaser-river-falls END pose + one more pose (the same path's MID frame, canyon seen from the climb),
// reads back a 40x20 cell box (default centre of the grid, --box x,y,w,h in cells to move it) from the existing WebGPU debug readbacks
// (wgPipeline.readbackGeometry / readbackLight / readbackShade / readbackCells) and prints min/mean/max/std per channel.
// Run: node tools/probe-far-walls.mjs --port 9560 [--grid 480x180] [--hour 11] [--quality ultra] [--box 220,60,40,20] [--out docs/test-reports/visqa/far-wall-probe.json]
// Writes docs/test-reports/visqa/far-wall-probe.json. Not exposed by any readback (see docs/lanes/pc-b1.md): surface normal, fog k, albedo.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validatePort, buildLaunchFlags, findBrowserBinary, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
import { buildQuery } from './capture-cinematic.mjs';

export const PROBE_ID = 'teaser-river-falls';
export const DEFAULT_BOX = Object.freeze({ w: 40, h: 20 });

/** min / mean / max / std of a numeric array (empty -> nulls). */
export function channelStats(values) {
  const n = values.length;
  if (!n) return { n: 0, min: null, mean: null, max: null, std: null };
  let mn = Infinity, mx = -Infinity, s = 0;
  for (let i = 0; i < n; i++) { const v = values[i]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
  const mean = s / n; let q = 0;
  for (let i = 0; i < n; i++) q += (values[i] - mean) ** 2;
  return { n, min: mn, mean, max: mx, std: Math.sqrt(q / n) };
}

/** value -> count, sorted by count desc, top `k` as [[value,count],..]. */
export function histogram(values, k = 6) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k);
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Pure summary of one box. `cells`: array of
 *  { kind, mat, depth, L:[r,g,b], sunlit, litCount, shadeFg:[r,g,b,glyph], fg:[r,g,b,glyph], bg:[r,g,b,a] }
 * (L = GPU light term, fg/bg = final cells 0..255, depth in metres; sky cells (kind 0 / non-finite depth) are counted, not averaged for geometry channels).
 * `flatGrey`: chroma = max-min of the mean fg rgb, fgStd = mean of the per-channel stds; grey = chroma < 12 && fgStd < 10.
 */
export function summarizeBox(cells) {
  const col = (f) => cells.map(f);
  const geom = cells.filter((c) => c.kind !== 0 && Number.isFinite(c.depth));
  const g = (f) => geom.map(f);
  const stats = {
    cells: cells.length, geometryCells: geom.length, skyCells: cells.length - geom.length,
    depth: channelStats(g((c) => c.depth)),
    lightR: channelStats(g((c) => c.L[0])), lightG: channelStats(g((c) => c.L[1])), lightB: channelStats(g((c) => c.L[2])),
    lightLum: channelStats(g((c) => lum(c.L[0], c.L[1], c.L[2]))),
    sunlit: channelStats(g((c) => c.sunlit)), litCount: channelStats(g((c) => c.litCount)),
    shadeR: channelStats(col((c) => c.shadeFg[0])), shadeG: channelStats(col((c) => c.shadeFg[1])), shadeB: channelStats(col((c) => c.shadeFg[2])),
    fgR: channelStats(col((c) => c.fg[0])), fgG: channelStats(col((c) => c.fg[1])), fgB: channelStats(col((c) => c.fg[2])),
    fgLum: channelStats(col((c) => lum(c.fg[0], c.fg[1], c.fg[2]))),
    bgR: channelStats(col((c) => c.bg[0])), bgG: channelStats(col((c) => c.bg[1])), bgB: channelStats(col((c) => c.bg[2])),
    kindTop: histogram(col((c) => c.kind)), matTop: histogram(col((c) => c.mat)), glyphTop: histogram(col((c) => c.fg[3])),
  };
  const means = [stats.fgR.mean, stats.fgG.mean, stats.fgB.mean];
  const chroma = cells.length ? Math.max(...means) - Math.min(...means) : null;
  const fgStd = cells.length ? (stats.fgR.std + stats.fgG.std + stats.fgB.std) / 3 : null;
  stats.flatGrey = { chroma, fgStd, distinctGlyphs: new Set(col((c) => c.fg[3])).size, grey: chroma !== null && chroma < 12 && fgStd < 10 };
  return stats;
}

/** Extracts the box (cell coords) from full-grid readback arrays (i = y*cols + x; GI/Depth/Light 4-wide u32, ShadeFg/fg/bg 4-wide u8). */
export function extractBox({ cols, box, GI, Depth, Light, ShadeFg, fg, bg }) {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const bits = (u) => { u32[0] = u; return f32[0]; };
  const cells = [];
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = y * cols + x, w = Light[i * 4 + 3];
    cells.push({
      kind: GI[i * 4 + 1] & 0xff, mat: (GI[i * 4 + 1] >>> 16) & 0xffff, depth: bits(Depth[i * 4]),
      L: [bits(Light[i * 4]), bits(Light[i * 4 + 1]), bits(Light[i * 4 + 2])], sunlit: w & 0xff, litCount: (w >>> 8) & 0xff,
      shadeFg: [ShadeFg[i * 4], ShadeFg[i * 4 + 1], ShadeFg[i * 4 + 2], ShadeFg[i * 4 + 3]],
      fg: [fg[i * 4], fg[i * 4 + 1], fg[i * 4 + 2], fg[i * 4 + 3]], bg: [bg[i * 4], bg[i * 4 + 1], bg[i * 4 + 2], bg[i * 4 + 3]],
    });
  }
  return cells;
}

function parse(argv) {
  const o = { port: NaN, grid: '480x180', hour: 11, quality: 'ultra', view: '1920x1080', box: null, out: path.join(ROOT, 'docs', 'test-reports', 'visqa', 'far-wall-probe.json') };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--port') o.port = Number(v); else if (k === '--grid') o.grid = v; else if (k === '--hour') o.hour = Number(v);
    else if (k === '--quality') o.quality = v; else if (k === '--view') o.view = v; else if (k === '--out') o.out = path.resolve(v);
    else if (k === '--box') { const [x, y, w, h] = v.split(',').map(Number); o.box = { x, y, w, h }; }
    else throw new Error(`unknown argument ${k}`);
  }
  validatePort(o.port); validatePort(o.port + 1);
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const [vw, vh] = o.view.split('x').map(Number), [gc, gr] = o.grid.split('x').map(Number);
  const box = o.box || { x: Math.floor((gc - DEFAULT_BOX.w) / 2), y: Math.floor((gr - DEFAULT_BOX.h) / 2), ...DEFAULT_BOX };
  mkdirSync(path.dirname(o.out), { recursive: true });
  const server = spawn('python', ['tools/serve.py', String(o.port)], { cwd: ROOT, stdio: 'ignore' });
  let browser, cdp, profile; const poses = [];
  try {
    await waitForHttp(`http://127.0.0.1:${o.port}/`, 10000);
    profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-farwall-'));
    browser = spawn(findBrowserBinary(), ['--headless=new', ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--window-size=${vw},${vh}`,
      `--remote-debugging-port=${o.port + 1}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    cdp = await connectCdp(o.port + 1, 15000);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
    const q = buildQuery({ grid: o.grid, hour: o.hour, clean: true }, PROBE_ID) + `&quality=${o.quality}`;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${o.port}/game/index.html?${q}` });
    const deadline = Date.now() + 240000;
    while (!(await evaluate(cdp, '!!window.__cine'))) {
      const err = await evaluate(cdp, 'window.__cineError');
      if (err || Date.now() > deadline) throw new Error('cinematic not ready: ' + (err || 'timeout'));
      await new Promise((r) => setTimeout(r, 200));
    }
    const frames = await evaluate(cdp, '__cine.frames');
    const wanted = [['river-falls-end', frames - 1], ['river-falls-mid', Math.floor((frames - 1) / 2)]];
    let cursor = 0; // playback is sequential: step every frame up to the wanted one, never backwards (mid first would be cheaper, end is the AC pose)
    wanted.sort((a, b) => a[1] - b[1]);
    for (const [name, frame] of wanted) {
      const res = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const wp = __debug.wgPipeline, box = ${JSON.stringify(box)}, cols = __debug.rt.cols, n = cols * __debug.rt.rows;
        for (let i = ${cursor}; i <= ${frame}; i++) await __cine.step(i);
        const g = await wp.readbackGeometry(), light = await wp.readbackLight(), cells = await wp.readbackCells();
        const sh = await wp.readbackShade(new Uint8Array(n * 4), new Uint8Array(n * 4));
        const pick = (a) => { const out = []; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const i = (y * cols + x) * 4; out.push(a[i], a[i + 1], a[i + 2], a[i + 3]); } return out; };
        return { GI: pick(g.GI), Depth: pick(g.Depth), Light: pick(light), ShadeFg: pick(sh.fg), fg: pick(cells.fg), bg: pick(cells.bg) };
      })()` });
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
      cursor = frame + 1;
      const r = res.result.value;
      // The page returned only the box, row-major: re-index as a box.w-wide grid.
      const cells = extractBox({ cols: box.w, box: { x: 0, y: 0, w: box.w, h: box.h }, ...r });
      const summary = summarizeBox(cells);
      poses.push({ name, frame, summary });
      console.log(name, 'frame', frame, JSON.stringify(summary.flatGrey), 'fg mean', [summary.fgR.mean, summary.fgG.mean, summary.fgB.mean].map((v) => v.toFixed(1)).join(','), 'depth', JSON.stringify(summary.depth));
    }
    writeFileSync(o.out, JSON.stringify({ id: PROBE_ID, hour: o.hour, grid: o.grid, quality: o.quality, box, poses, notExposed: ['surface normal', 'fog k', 'albedo (material id only)'] }, null, 2) + '\n');
    console.log('wrote', o.out);
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch { /* closed */ } cdp.close(); }
    if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp profile left */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
