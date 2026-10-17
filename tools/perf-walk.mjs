// PERF-05: frame-spike capture on a realistic WALK (not a spin). Loads the game headless on a real GPU, unthrottled, with
// `?spikes=1` (game/js/dev/spikeRecorder.js) at one quality/grid, puts the player at --pose and runs it along the road west
// from the tower (waypoints below) for --seconds by writing the game's own Input (KeyW + ShiftLeft) and look.yawDeg, like
// tools/route-walk-browser.mjs. Prints one JSON row: frame counts > 16.7 / > 33 ms, max interval / CPU, and the spike
// records ranked by cause. One config per process (high + ultra in one browser failed "page never booted" before, PERF-03).
// Usage: node tools/perf-walk.mjs --port 9540 [--config ultra:480x180] [--seconds 60] [--settle 4000] [--out file.json] [--alloc 1] [--heap-profile 1] [--cpu-profile 1] [--cpu-raw file.json] [--js-flags "--log-deopt --logfile=X"]
// PERF-08: --heap-profile 1 = CDP HeapProfiler sampling (32 KB, incl. GC'd objects) over the walk -> top 20 self-size sites (function + url:line)
// written to docs/test-reports/perf-alloc-<date>.md (or --heap-out); --cpu-profile 1 adds a CDP Profiler self-time table to the same file.
// PERF-06: p99 = 99th percentile rAF interval; --alloc 1 adds allocMb = JS heap growth per profiler section over the walk (heap read per lap).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { summariseHeap, summariseCpu, renderMd } from './heap-profile-summary.mjs';
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
  rec.records.length = 0; rec.count = 0; rec.frames = 0; rec.allocB.fill(0); rec.trackAlloc = ${args.alloc ? 'true' : 'false'};
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
  return { start, end: { x: T().x, y: T().y }, wpReached: wi, frames: f, cpu, itv, spikes: rec.records.slice(), spikeCount: rec.count, alloc: rec.allocReport(), probe: window.__probeLog || null };
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
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${udd}`, ...(args['js-flags'] ? [`--js-flags=${args['js-flags']}`] : []), 'about:blank'], { stdio: 'ignore' });
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
  if (args['heap-profile']) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true }); }
  if (args['cpu-profile']) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const GC = `(() => { const c = window.__gpuCount; if (!c) return null; const b = []; for (const [id, e] of c.byBuf) b.push([id, e.size, e.n, e.bytes]); return { frames: c.frames, writes: c.writes, writeBytes: c.writeBytes, same: c.same, sameBytes: c.sameBytes, setBindGroup: c.setBindGroup, setPipeline: c.setPipeline, setVertexBuffer: c.setVertexBuffer, draws: c.draws, passes: c.passes, b }; })()`; // D-107 (?gpucount=1 via --extra): per-frame GPU call counts over the walk
  const gc0 = await evaluate(cdp, GC);
  const r = await evaluateAsync(cdp, DRIVER(seconds), (seconds + 60) * 1000);
  const heapProf = args['heap-profile'] ? (await cdp.send('HeapProfiler.stopSampling')).profile : null;
  const cpuProf = args['cpu-profile'] ? (await cdp.send('Profiler.stop')).profile : null;
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
    p99: +[...r.itv].sort((a, b) => a - b)[Math.floor(r.itv.length * 0.99)].toFixed(1), fps: +(1000 / (r.itv.reduce((a, b) => a + b, 0) / r.itv.length)).toFixed(0), spikeCount: r.spikeCount, gcSpikes, allocMb: r.alloc.slice(0, 8),
    rank: Object.entries(rank).sort((a, b) => b[1].sumMs - a[1].sumMs).map(([k, v]) => ({ cause: k, n: v.n, maxMs: +v.maxMs.toFixed(1) })) };
  console.log(JSON.stringify(row));
  const gc1 = gc0 && await evaluate(cdp, GC);
  if (gc1) { const st = await evaluate(cdp, 'window.__gpuCount.stacks ? JSON.stringify(window.__gpuCount.stacks) : ""'); if (st) console.log('STACKS ' + JSON.stringify(Object.entries(JSON.parse(st)).sort((a, b) => b[1].n - a[1].n).slice(0, 8))); }
  if (gc1) {
    const fr = gc1.frames - gc0.frames, pf = (k) => +((gc1[k] - gc0[k]) / fr).toFixed(1), prev = new Map(gc0.b.map((e) => [e[0], e]));
    const top = gc1.b.map((e) => { const o = prev.get(e[0]) || [0, 0, 0, 0]; return { size: e[1], callsPerFrame: +((e[2] - o[2]) / fr).toFixed(2), kbPerFrame: +((e[3] - o[3]) / fr / 1024).toFixed(1) }; }).filter((e) => e.callsPerFrame > 0).sort((a, b) => b.callsPerFrame - a.callsPerFrame || b.kbPerFrame - a.kbPerFrame).slice(0, Number(args.top || 12));
    console.log('GPUCOUNT ' + JSON.stringify({ frames: fr, writes: pf('writes'), sameWrites: pf('same'), sameKB: +((gc1.sameBytes - gc0.sameBytes) / fr / 1024).toFixed(1), writeKB: +((gc1.writeBytes - gc0.writeBytes) / fr / 1024).toFixed(1), setBindGroup: pf('setBindGroup'), setPipeline: pf('setPipeline'), setVertexBuffer: pf('setVertexBuffer'), draws: pf('draws'), passes: pf('passes'), top }));
  }
  if (heapProf || cpuProf) {
    const date = new Date().toISOString().slice(0, 10), out = args['heap-out'] || path.join(ROOT, 'docs', 'test-reports', `perf-alloc-${date}.md`);
    const heap = heapProf && summariseHeap(heapProf, 20), cpu = cpuProf && summariseCpu(cpuProf, 20);
    writeFileSync(out, renderMd({ title: `Allocation profile: ${q} ${gw}x${gh} ${seconds} s road walk (${date})`, row, heap, cpu }));
    console.log('profile ->', out, heap ? `heap ${heap.totalMb.toFixed(0)} MB sampled` : '');
  }
  if (cpuProf && args['cpu-raw']) writeFileSync(args['cpu-raw'], JSON.stringify(cpuProf));   // PERF-09: raw CDP profile (nodes carry deoptReason)
  if (args.out) writeFileSync(args.out, JSON.stringify({ row, spikes: r.spikes, probe: r.probe }, null, 1));
  cdp.close();
} finally { cleanup(); }
