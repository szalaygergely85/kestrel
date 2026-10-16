// PERF-05: frame-spike capture on a realistic WALK (not a spin). Loads the game headless on a real GPU, unthrottled, with
// `?spikes=1` (game/js/dev/spikeRecorder.js) at one quality/grid, puts the player at --pose and runs it along the road west
// from the tower (waypoints below) for --seconds by writing the game's own Input (KeyW + ShiftLeft) and look.yawDeg, like
// tools/route-walk-browser.mjs. Prints one JSON row: frame counts > 16.7 / > 33 ms, max interval / CPU, and the spike
// records ranked by cause. One config per process (high + ultra in one browser failed "page never booted" before, PERF-03).
// Usage: node tools/perf-walk.mjs --port 9540 [--config ultra:480x180] [--seconds 60] [--settle 4000] [--out file.json]
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate, evaluateAsync, validatePort } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port || 9540);
validatePort(port); validatePort(port + 1);
const [q, g] = (args.config || 'ultra:480x180').split(':'); const [gw, gh] = g.split('x').map(Number);
const seconds = Number(args.seconds || 60), settle = Number(args.settle || 4000);
const pose = args.pose || 'roadSouth';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// road west from the tower: walk-out meadow -> waystone -> bend relay -> ford relay (world metres, tools/map-loop-waypoints.mjs stops)
const WPS = [{ x: 1428, y: 1040 }, { x: 1350, y: 1041 }, { x: 1270, y: 1042 }, { x: 1135, y: 1055 }, { x: 1000, y: 1069 }];

const DRIVER = (secs) => `(async () => {
  const D = window.__debug, input = D.input, st = D.loop.stats, rec = window.__spikeRec;
  const sleepF = () => new Promise((r) => requestAnimationFrame(r));
  const T = () => D.playerHandle.data.transform;
  const WPS = ${JSON.stringify(WPS)};
  const keys = (on) => { for (const k of ['KeyW', 'ShiftLeft']) { if (on) { if (!input._down.has(k)) input._pressedThisFrame.add(k); input._down.add(k); } else input._down.delete(k); } };
  rec.records.length = 0; rec.count = 0; rec.frames = 0;
  const start = { x: T().x, y: T().y }, cpu = [], itv = [];
  let wi = 0, best = 1e9, bestAt = 0, bias = 0, biasLeft = 0, tries = 0, f = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ${secs} * 1000 && wi < WPS.length) {
    const tr = T(), wp = WPS[wi], dist = Math.hypot(wp.x - tr.x, wp.y - tr.y);
    if (dist < 3) { wi++; best = 1e9; continue; }
    if (dist < best - 0.3) { best = dist; bestAt = f; }
    if (biasLeft <= 0 && f - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = f; } // stuck: detour
    if (biasLeft > 0) biasLeft--; else bias = 0;
    D.look.yawDeg = Math.atan2(wp.x - tr.x, -(wp.y - tr.y)) * 180 / Math.PI + bias; D.look.pitchDeg = 0;
    keys(true);
    await sleepF(); f++;
    cpu.push(st.jsMs); itv.push(st.intervalMs);
  }
  keys(false);
  return { start, end: { x: T().x, y: T().y }, wpReached: wi, frames: f, cpu, itv, spikes: rec.records.slice(), spikeCount: rec.count, probe: window.__probeLog || null };
})()`;

const binary = findBrowserBinary();
const udd = path.join(os.tmpdir(), 'kestrel-perf-walk-' + port);
let server, browser;
const cleanup = () => { if (browser) killTree(browser.pid); if (server) killTree(server.pid); try { rmSync(udd, { recursive: true, force: true }); } catch {} };
let row;
try {
  server = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(binary, [`--remote-debugging-port=${port + 1}`, '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgpu-developer-features', '--window-size=3840,2160', '--no-sandbox', '--enable-precise-memory-info',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  if (process.env.CAP_LOG) cdp.onEvent((m, p) => { if (m === 'Runtime.consoleAPICalled' && p.type !== 'log') console.error('[page]', (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); if (m === 'Runtime.exceptionThrown') console.error('[exc]', JSON.stringify(p.exceptionDetails).slice(0, 600)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false });
  const url = `http://127.0.0.1:${port}/game/index.html?quality=${q}&f3=1&autoquality=0&nopause=1&spikes=1&pose=${pose}${args.extra ? '&' + args.extra : ''}`;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < (Number(args.bootwait) || 240) && !(await evaluate(cdp, '!!(window.__debug && window.__debug.engine && window.__debug.loop && window.__debug.playerHandle && window.__spikeRec)')); i++) await sleep(500);
  if (!(await evaluate(cdp, '!!(window.__debug && window.__spikeRec)'))) throw new Error('page never booted (or ?spikes=1 inactive): ' + url);
  await evaluate(cdp, `if (!window.__debug.overlay.visible) window.__debug.overlay.toggle(); window.__debug.engine.setGrid(${gw}, ${gh}, { immediate: true }); true`);
  await sleep(settle);
  if (args.probe) await evaluateAsync(cdp, readFileSync(args.probe, 'utf8')); // dev: a timing wrapper script (fills window.__probeLog)
  const r = await evaluateAsync(cdp, DRIVER(seconds), (seconds + 60) * 1000);
  // cause per spike: CPU spike -> top section (or "unattributed" when the uncovered rest is bigger); interval-only spike -> "wait" (GPU /
  // compositor / OS: the CPU frame and the previous one were both short) or the previous frame's top section.
  const cause = (s) => {
    if (s.js > 25) { const t = s.top[0]; return t && t.ms >= s.unattr ? t.name : 'unattributed (GC/JIT/driver)'; }
    if (s.prevJs > 25 && s.prevTop[0]) return 'prev:' + s.prevTop[0].name;
    return 'wait (GPU/compositor/OS)';
  };
  const rank = {};
  for (const s of r.spikes) { const c = cause(s); const e = rank[c] || (rank[c] = { n: 0, sumMs: 0, maxMs: 0 }); const ms = Math.max(s.js, s.itv); e.n++; e.sumMs += ms; e.maxMs = Math.max(e.maxMs, ms); }
  const gcSpikes = r.spikes.filter((s) => s.gcInMb > 0.5).length;
  row = { quality: q, grid: `${gw}x${gh}`, pose, seconds, frames: r.frames, wpReached: r.wpReached, start: r.start, end: r.end,
    over16: r.itv.filter((v) => v > 16.7).length, over33: r.itv.filter((v) => v > 33).length, itvMax: +Math.max(...r.itv).toFixed(1),
    cpuOver16: r.cpu.filter((v) => v > 16.7).length, cpuMax: +Math.max(...r.cpu).toFixed(1),
    fps: +(1000 / (r.itv.reduce((a, b) => a + b, 0) / r.itv.length)).toFixed(0), spikeCount: r.spikeCount, gcSpikes,
    rank: Object.entries(rank).sort((a, b) => b[1].sumMs - a[1].sumMs).map(([k, v]) => ({ cause: k, n: v.n, maxMs: +v.maxMs.toFixed(1) })) };
  console.log(JSON.stringify(row));
  if (args.out) writeFileSync(args.out, JSON.stringify({ row, spikes: r.spikes, probe: r.probe }, null, 1));
  cdp.close();
} finally { cleanup(); }
