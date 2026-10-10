// TREES-PERF-02: repeatable render-cost probe. For each (quality/grid x pose x trees) config it loads the game headless on a real GPU,
// unthrottled (no vsync / frame cap), F3 overlay on (turns the pass timers on), engine.setGrid(W,H) after boot, spins the camera so every
// frame is a fresh render, then reports GPU = sum of passStats raster+shadow+light+shade (benchGpuLine definition), CPU = loop.stats.jsMs,
// frame = loop.stats.intervalMs. Usage: node tools/perf-pose.mjs --port 9700 [--out file.json] [--settle 5500] [--frames 3000]
//   [--configs "high:400x150,ultra:480x180"] [--poses "roadSouth,forest"] [--trees "default,voxel"]
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate, evaluateAsync, validatePort } from './capture-browser.mjs';

const POSES = { roadSouth: 'pose=roadSouth', forest: 'at=1544.5,1201.3,-14.3,270,8' };
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port || 9700);
const settle = Number(args.settle || 5500), frames = Number(args.frames || 3000);
const configs = (args.configs || 'high:400x150,ultra:480x180').split(',').map((s) => { const [q, g] = s.split(':'); const [w, h] = g.split('x').map(Number); return { q, w, h }; });
const poses = (args.poses || 'roadSouth,forest').split(',');
const trees = (args.trees || 'default,voxel').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
validatePort(port); validatePort(port + 1);

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// In-page sampler: spins yaw each rAF, records per-frame cpu/interval and, at the end, the passStats of the last 120 frames.
const SAMPLER = (n) => `new Promise((resolve) => {
  const d = window.__debug, st = d.loop.stats, cpu = [], itv = [];
  const sum = (s, k) => ['raster','shadow','light','shade'].reduce((a, p) => a + (s.passes && s.passes[p] && Number.isFinite(s.passes[p][k]) ? s.passes[p][k] : 0), 0);
  let last = -1;
  const tick = () => {
    d.look.yawDeg = (d.look.yawDeg + 0.4) % 360;
    cpu.push(st.jsMs); itv.push(st.intervalMs);
    if (cpu.length >= ${n}) { const s = d.wgPipeline.passStats(); resolve({ rawAvail: JSON.stringify(s), cpu, itv, gpu: s.available ? { p50: sum(s, 'p50'), p95: sum(s, 'p95'), passes: s.passes } : null }); }
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

const binary = findBrowserBinary();
const udd = path.join(os.tmpdir(), 'kestrel-perf-pose-' + port);
let server, browser;
const cleanup = () => { if (browser) killTree(browser.pid); if (server) killTree(server.pid); try { rmSync(udd, { recursive: true, force: true }); } catch {} };
const rows = [];
try {
  server = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(binary, [`--remote-debugging-port=${port + 1}`, '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgpu-developer-features', '--window-size=3840,2160', '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  if (process.env.CAP_LOG) cdp.onEvent((m, p) => { if (m === 'Runtime.consoleAPICalled') console.error('[page]', (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); if (m === 'Runtime.exceptionThrown') console.error('[exc]', JSON.stringify(p.exceptionDetails).slice(0, 400)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false });
  for (const c of configs) for (const pose of poses) for (const t of trees) {
    const q = `quality=${c.q}&f3=1&autoquality=0&${POSES[pose]}${t === 'voxel' ? '&trees=voxel' : ''}`;
    await evaluate(cdp, 'window.__perfOld = 1; true'); // marker: the NEW document has no __perfOld
    const loaded = new Promise((res) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') res(); }));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${q}` });
    await loaded; await sleep(1500);
    for (let i = 0; i < 120 && !(await evaluate(cdp, '!window.__perfOld && !!(window.__debug && window.__debug.engine && window.__debug.look && window.__debug.loop)')); i++) await sleep(500);
    if (!(await evaluate(cdp, '!window.__perfOld && !!(window.__debug && window.__debug.engine)'))) throw new Error('page never booted: ' + q);
    await evaluate(cdp, `if (!window.__debug.overlay.visible) window.__debug.overlay.toggle(); window.__debug.engine.setGrid(${c.w}, ${c.h}, { immediate: true }); true`); // overlay visible = pass timers on
    await sleep(settle);
    let r = await evaluateAsync(cdp, SAMPLER(frames));
    for (let k = 0; !r.gpu && k < 3; k++) { await sleep(2000); r = await evaluateAsync(cdp, SAMPLER(frames)); } // pass timers need a few frames after the overlay turns them on
    const row = { quality: c.q, grid: `${c.w}x${c.h}`, pose, trees: t, frames: r.cpu.length,
      gpuP50: r.gpu && r.gpu.p50, gpuP95: r.gpu && r.gpu.p95, cpuP50: pct(r.cpu, 0.5), cpuP95: pct(r.cpu, 0.95),
      frameP50: pct(r.itv, 0.5), frameP95: pct(r.itv, 0.95), fps: 1000 / (r.itv.reduce((a, b) => a + b, 0) / r.itv.length) };
    if (process.env.CAP_LOG) console.error('[passStats]', JSON.stringify(r.gpu), r.rawAvail);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  cdp.close();
} finally { cleanup(); }
if (args.out) writeFileSync(args.out, JSON.stringify(rows, null, 1));
console.log('| quality / grid | pose | trees | GPU p50 | GPU p95 | CPU p50 | CPU p95 | frame p50 | frame p95 | fps |\n|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.quality} ${r.grid} | ${r.pose} | ${r.trees} | ${r.gpuP50?.toFixed(2)} | ${r.gpuP95?.toFixed(2)} | ${r.cpuP50.toFixed(2)} | ${r.cpuP95.toFixed(2)} | ${r.frameP50.toFixed(2)} | ${r.frameP95.toFixed(2)} | ${r.fps.toFixed(0)} |`);
