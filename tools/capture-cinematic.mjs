#!/usr/bin/env node
// US-119b: node tools/capture-cinematic.mjs --cinematic <id> --port <95xx>
// --compare a,b captures both paths and exports a horizontal pair; --frames N limits a probe.
// Capture options (teaser recording; every flag is optional, no flag = the old 1280x720 behaviour, byte-identical):
//   --size WxH     output video size (default 1280x720). 16:9 sizes also set the browser viewport; other aspects (e.g. 1080x1920)
//                  render a 16:9 viewport (height min(H,1440)) and ffmpeg centre-crops + scales it to WxH (the engine grid is 8:3, no native portrait grid).
//   --portrait     shorthand for --size 1080x1920 and, unless --grid is given, --grid 480x180 (centre crop keeps ~32% of the columns = ~152).
//   --hour H       freeze the clock at hour H (0..24, fractional ok) with the full live day/night look (sun/moon, sky, fog colour, clouds, ambient).
//                  Sends ?cinehour=H (+ ?time=H unless --time given). Not combined with cinematics that carry per-key hours.
//   --clean        also hides the player body (HUD, compass, markers, prompts, hands are already off in cinematic mode).
//   ffmpeg missing: PNGs + frames.jsonl stay and the exact ffmpeg commands are printed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTimeFreeze, parseTimeArg } from './tool-url.mjs'; // DN-04a
import { ROOT, validatePort, buildLaunchFlags, findBrowserBinary, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

export function parseArgs(argv) {
  const opts = { port: NaN, ids: [], grid: '240x90', outDir: null, maxFrames: Infinity, encode: true, size: '1280x720', hour: undefined, clean: false };
  let gridGiven = false, portrait = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--time=')) { opts.time = parseTimeArg(arg.slice(7)); continue; }
    if (arg === '--no-encode') { opts.encode = false; continue; }
    if (arg === '--portrait') { portrait = true; continue; }
    if (arg === '--clean') { opts.clean = true; continue; }
    if (arg.startsWith('--hour=')) { opts.hour = parseTimeArg(arg.slice(7)); continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    if (arg === '--port') opts.port = Number(value);
    else if (arg === '--cinematic') opts.ids = [value];
    else if (arg === '--compare') { opts.ids = value.split(','); if (opts.ids.length !== 2) throw new Error('--compare requires a,b'); }
    else if (arg === '--time') opts.time = parseTimeArg(value);
    else if (arg === '--grid') { opts.grid = value; gridGiven = true; }
    else if (arg === '--size') opts.size = value;
    else if (arg === '--hour') opts.hour = parseTimeArg(value);
    else if (arg === '--out') opts.outDir = path.resolve(value);
    else if (arg === '--frames') opts.maxFrames = Number(value);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (portrait) { opts.size = '1080x1920'; if (!gridGiven) opts.grid = '480x180'; }
  if (!/^\d+x\d+$/.test(opts.size) || opts.size.split('x').some((n) => Number(n) < 16 || Number(n) > 4320)) throw new Error('invalid --size (WxH, 16..4320)');
  validatePort(opts.port); validatePort(opts.port + 1);
  if (!opts.ids.length || opts.ids.some((id) => !/^[\w-]+$/.test(id))) throw new Error('provide --cinematic id or --compare a,b');
  if (!/^\d+x\d+$/.test(opts.grid)) throw new Error('invalid --grid');
  if (opts.maxFrames !== Infinity && (!Number.isInteger(opts.maxFrames) || opts.maxFrames < 1)) throw new Error('--frames must be a positive integer');
  opts.outDir ||= path.join(ROOT, 'captures', `${opts.ids.join('-')}-${Date.now()}`);
  return opts;
}

/** Output size and browser viewport for a --size value. Non-16:9 output renders a 16:9 viewport (grid is 8:3) that ffmpeg crops. */
export function sizes(size) {
  const [w, h] = size.split('x').map(Number), even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const out = { w: even(w), h: even(h) };
  const wide = Math.abs(out.w / out.h - 16 / 9) < 0.01;
  const vh = wide ? out.h : Math.min(out.h, 1440);
  const view = wide ? { w: out.w, h: out.h } : { w: even(vh * 16 / 9), h: even(vh) };
  return { out, view, crop: !wide };
}

/** Game URL query for one cinematic (hour -> ?cinehour + frozen ?time, clean -> ?clean=1). */
export function buildQuery(opts, id) {
  let q = `renderer=mesh&cinematic=${encodeURIComponent(id)}&capture=1&grid=${opts.grid}`;
  if (Number.isFinite(opts.hour)) q += `&cinehour=${opts.hour}`;
  if (opts.clean) q += '&clean=1';
  return withTimeFreeze(q, opts.time ?? (Number.isFinite(opts.hour) ? opts.hour : undefined));
}

export function hashCells(frame) {
  return createHash('sha256').update(Buffer.from(frame.fg)).update(Buffer.from(frame.bg)).digest('hex');
}

export function ffmpegArgs(dirs, fps, format, output, size) {
  const args = ['-y'];
  for (const dir of dirs) args.push('-framerate', String(fps), '-i', path.join(dir, '%06d.png'));
  const filters = [];
  if (dirs.length === 2) filters.push('[0:v][1:v]hstack=inputs=2:shortest=1[v]');
  const inLabel = dirs.length === 2 ? '[v]' : '[0:v]';
  const sz = size ? sizes(size) : null;
  if (sz && sz.crop) filters.push(`${inLabel}crop='min(iw,ih*${sz.out.w}/${sz.out.h})':ih,scale=${sz.out.w}:${sz.out.h}:flags=lanczos[c]`);
  const src = sz && sz.crop ? '[c]' : inLabel;
  if (format === 'gif') {
    filters.push(`${src}split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[out]`);
  } else filters.push(`${src}pad=ceil(iw/2)*2:ceil(ih/2)*2[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]');
  if (format === 'mp4') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  args.push(output);
  return args;
}

export async function captureCinematic(opts) {
  validatePort(opts.port); validatePort(opts.port + 1);
  const binary = findBrowserBinary();
  if (!binary) throw new Error('Chrome/Edge not found');
  if (existsSync(opts.outDir)) throw new Error(`output already exists: ${opts.outDir}`);
  mkdirSync(opts.outDir, { recursive: true });
  const { view } = sizes(opts.size || '1280x720');
  const server = spawn('python', ['tools/serve.py', String(opts.port)], { cwd: ROOT, stdio: 'ignore' });
  let browser, cdp, profile;
  const exceptions = [];
  const consoleLines = [];
  const cleanup = () => { if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); };
  process.once('SIGINT', cleanup);
  try {
    await waitForHttp(`http://127.0.0.1:${opts.port}/`, 10000);
    profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-cinematic-'));
    browser = spawn(binary, ['--headless=new', ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--window-size=${view.w},${view.h}`,
      `--remote-debugging-port=${opts.port + 1}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    cdp = await connectCdp(opts.port + 1, 15000);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Log.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: view.w, height: view.h, deviceScaleFactor: 1, mobile: false });
    cdp.onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails);
      // Optional local asset packs may 404 (game/index.html declares them optional); retain diagnostics.
      if (method === 'Log.entryAdded' && params.entry.level === 'error') consoleLines.push(JSON.stringify(params.entry));
      if (method === 'Network.loadingFailed') consoleLines.push(JSON.stringify({ network: params.errorText, blockedReason: params.blockedReason }));
      if (method === 'Runtime.consoleAPICalled') {
        consoleLines.push((params.args || []).map((a) => a.value ?? a.description).join(' '));
        if (consoleLines.length > 20) consoleLines.shift();
      }
    });
    const shots = [];
    for (let shot = 0; shot < opts.ids.length; shot++) {
      const id = opts.ids[shot], dir = path.join(opts.outDir, `${shot}-${id}`);
      mkdirSync(dir);
      exceptions.length = 0;
      consoleLines.length = 0;
      const navigation = await cdp.send('Page.navigate', { url: `http://127.0.0.1:${opts.port}/game/index.html?${buildQuery(opts, id)}` });
      if (navigation.errorText) throw new Error(`cinematic navigation: ${navigation.errorText}`);
      const deadline = Date.now() + 120000;
      while (!(await evaluate(cdp, '!!window.__cine'))) {
        const error = await evaluate(cdp, 'window.__cineError');
        if (error || exceptions.length) throw new Error(error || JSON.stringify(exceptions));
        if (Date.now() > deadline) {
          const state = await evaluate(cdp, '({url:location.href,ready:document.readyState,body:document.body?.textContent.slice(0,500)})');
          throw new Error(`timed out waiting for cinematic: ${JSON.stringify(state)} ${consoleLines.join(' | ')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const meta = await evaluate(cdp, '({frames:__cine.frames,fps:__cine.fps,cols:__debug.rt.cols,rows:__debug.rt.rows,backend:__debug.rt.backend})');
      const count = Math.min(meta.frames, opts.maxFrames), hashes = [], pngHashes = [];
      for (let i = 0; i < count; i++) {
        // Read cells and PNG in the same task as present(), before the browser discards its drawing buffer.
        const result = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
          await __cine.step(${i});
          const png = __debug.rt.canvas.toDataURL('image/png'); // WG-5c: PNG first (same task as present), then the async WebGPU cell readback
          const cells = await __debug.wgPipeline.readbackCells();
          return {fg:Array.from(cells.fg),bg:Array.from(cells.bg),png};
        })()` });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        const frame = result.result.value;
        const png = Buffer.from(frame.png.split(',')[1], 'base64');
        const hash = hashCells(frame), pngHash = createHash('sha256').update(png).digest('hex');
        hashes.push(hash); pngHashes.push(pngHash);
        writeFileSync(path.join(dir, `${String(i).padStart(6, '0')}.png`), png);
        appendFileSync(path.join(dir, 'frames.jsonl'), JSON.stringify({ i, t: i / meta.fps, fps: meta.fps, cols: meta.cols, rows: meta.rows, fg: frame.fg, bg: frame.bg, hash, pngHash }) + '\n');
      }
      if (exceptions.length) throw new Error(JSON.stringify(exceptions));
      shots.push({ id, dir, fps: meta.fps, frames: count, hashes, pngHashes });
    }
    if (shots.length === 2 && shots[0].fps !== shots[1].fps) throw new Error('comparison paths must have the same fps');
    if (opts.encode) {
      const available = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
      const cmd = (format) => ffmpegArgs(shots.map((s) => s.dir), shots[0].fps, format, path.join(opts.outDir, `cinematic.${format}`), opts.size);
      if (!available) {
        console.log('ffmpeg unavailable; PNG and frames.jsonl capture saved, MP4/GIF skipped. Run later:');
        for (const format of ['mp4', 'gif']) console.log('ffmpeg ' + cmd(format).map((a) => (/[\s\[\]();']/.test(a) ? `"${a}"` : a)).join(' '));
      } else for (const format of ['mp4', 'gif']) {
        const result = spawnSync('ffmpeg', cmd(format), { encoding: 'utf8' });
        if (result.status !== 0) throw new Error(`ffmpeg ${format}: ${result.stderr}`);
      }
    }
    writeFileSync(path.join(opts.outDir, 'capture.json'), JSON.stringify(shots, null, 2) + '\n');
    return shots;
  } finally {
    process.removeListener('SIGINT', cleanup);
    if (cdp) { try { await cdp.send('Browser.close'); } catch { /* browser already closed */ } cdp.close(); }
    cleanup();
    if (profile) { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { console.warn(`temporary browser profile remains: ${profile}`); } }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const shots = await captureCinematic(parseArgs(process.argv.slice(2))); console.log(JSON.stringify(shots, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
