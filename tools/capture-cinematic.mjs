#!/usr/bin/env node
// US-119b: node tools/capture-cinematic.mjs --cinematic <id> --port <95xx>
// --compare a,b captures both paths and exports a horizontal pair; --frames N limits a probe.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validatePort, buildLaunchFlags, findBrowserBinary, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

export function parseArgs(argv) {
  const opts = { port: NaN, ids: [], grid: '240x90', outDir: null, maxFrames: Infinity, encode: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-encode') { opts.encode = false; continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    if (arg === '--port') opts.port = Number(value);
    else if (arg === '--cinematic') opts.ids = [value];
    else if (arg === '--compare') { opts.ids = value.split(','); if (opts.ids.length !== 2) throw new Error('--compare requires a,b'); }
    else if (arg === '--grid') opts.grid = value;
    else if (arg === '--out') opts.outDir = path.resolve(value);
    else if (arg === '--frames') opts.maxFrames = Number(value);
    else throw new Error(`unknown argument ${arg}`);
  }
  validatePort(opts.port); validatePort(opts.port + 1);
  if (!opts.ids.length || opts.ids.some((id) => !/^[\w-]+$/.test(id))) throw new Error('provide --cinematic id or --compare a,b');
  if (!/^\d+x\d+$/.test(opts.grid)) throw new Error('invalid --grid');
  if (opts.maxFrames !== Infinity && (!Number.isInteger(opts.maxFrames) || opts.maxFrames < 1)) throw new Error('--frames must be a positive integer');
  opts.outDir ||= path.join(ROOT, 'captures', `${opts.ids.join('-')}-${Date.now()}`);
  return opts;
}

export function hashCells(frame) {
  return createHash('sha256').update(Buffer.from(frame.fg)).update(Buffer.from(frame.bg)).digest('hex');
}

export function ffmpegArgs(dirs, fps, format, output) {
  const args = ['-y'];
  for (const dir of dirs) args.push('-framerate', String(fps), '-i', path.join(dir, '%06d.png'));
  const filters = [];
  if (dirs.length === 2) filters.push('[0:v][1:v]hstack=inputs=2:shortest=1[v]');
  if (format === 'gif') {
    filters.push(`${dirs.length === 2 ? '[v]' : '[0:v]'}split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[out]`);
  } else filters.push(`${dirs.length === 2 ? '[v]' : '[0:v]'}pad=ceil(iw/2)*2:ceil(ih/2)*2[out]`);
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
  const server = spawn('python', ['tools/serve.py', String(opts.port)], { cwd: ROOT, stdio: 'ignore' });
  let browser, cdp, profile;
  const exceptions = [];
  const consoleLines = [];
  const cleanup = () => { if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); };
  process.once('SIGINT', cleanup);
  try {
    await waitForHttp(`http://127.0.0.1:${opts.port}/`, 10000);
    profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-cinematic-'));
    browser = spawn(binary, ['--headless=new', ...buildLaunchFlags(), '--no-sandbox', '--window-size=1280,720',
      `--remote-debugging-port=${opts.port + 1}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    cdp = await connectCdp(opts.port + 1, 15000);
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Log.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
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
      const navigation = await cdp.send('Page.navigate', { url: `http://127.0.0.1:${opts.port}/game/index.html?renderer=mesh&cinematic=${encodeURIComponent(id)}&capture=1&grid=${opts.grid}` });
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
      if (meta.backend !== 'gl2' || !await evaluate(cdp, '!!__debug.gpuPipeline')) throw new Error('cinematic capture requires WebGL2 mesh pipeline');
      const count = Math.min(meta.frames, opts.maxFrames), hashes = [], pngHashes = [];
      for (let i = 0; i < count; i++) {
        // Read cells and PNG in the same task as present(), before the browser discards its drawing buffer.
        const result = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
          await __cine.step(${i});
          const cells = __debug.gpuPipeline.readback();
          return {fg:Array.from(cells.fg),bg:Array.from(cells.bg),png:__debug.rt.canvas.toDataURL('image/png')};
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
      if (!available) console.log('ffmpeg unavailable; PNG and frames.jsonl capture saved, MP4/GIF skipped');
      else for (const format of ['mp4', 'gif']) {
        const result = spawnSync('ffmpeg', ffmpegArgs(shots.map((s) => s.dir), shots[0].fps, format, path.join(opts.outDir, `cinematic.${format}`)), { encoding: 'utf8' });
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
