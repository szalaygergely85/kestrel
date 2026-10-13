// PERF-R1 (D-075 step 1): per-pass GPU timing of the real game for pose x rays, on the real GPU (WebGPU, not SwiftShader).
// Run: node tools/bench-presets.mjs 9575 [--poses roadSouth,meadowDetail,fordDetail,outwall] [--rays 1,2,4] [--grid 480x180] [--seconds 20] [--json]
// Port range PC-B 9500-9999 (this clone: 9575-9649); port+1 is CDP. Stats source = the F3 "wg pass ms" line:
// __debug.wgPipeline.stats.{gpuMsP50,gpuMsP95,wgPassMsP50[]} (WG_PASS_NAMES order). If timestamp queries are unavailable
// R6d (D-075 step 5): --imp off,on runs each pose with card impostors off/on (URL ?imp=0|1, NEEDS B1-main: main.js reads it, see lane note);
// --quality ultra|high adds &quality= and --gpu rtx|intel picks the gate: RTX ultra <= 7.5 ms total GPU, Intel high <= 10 ms (roadSouth, imp on); printed PASS/FAIL.
// those are NaN: the table then shows n/a and the frame time (rAF delta) is the only number - said in the footer.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const PASS_COLS = ['raster', 'resolve', 'shade'];
export const GBUFFER_BYTES_PER_SAMPLE = 36; // proposal perf-environment-2026-10-13: 36 B G-buffer per sample

export function pct(arr, p) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}
const median = (arr) => pct(arr, 0.5);

export function parseArgs(argv) {
  const o = { port: NaN, poses: ['roadSouth', 'meadowDetail', 'fordDetail', 'outwall'], rays: [1, 2, 4], grid: '480x180', seconds: 20, json: false, imp: [null], quality: null, gpu: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--poses') o.poses = String(argv[++i]).split(',').filter(Boolean);
    else if (a === '--rays') o.rays = String(argv[++i]).split(',').map(Number);
    else if (a === '--grid') o.grid = String(argv[++i]);
    else if (a === '--imp') o.imp = String(argv[++i]).split(',').filter(Boolean).map((v) => (v === 'on' || v === '1' ? 1 : 0));
    else if (a === '--quality') o.quality = String(argv[++i]);
    else if (a === '--gpu') o.gpu = String(argv[++i]);
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else rest.push(a);
  }
  o.port = Number(rest[0]);
  return o;
}

/** Frame deltas (ms) + GPU sample series -> one table row. gpu = { total:[], passes:{raster:[],...} } of P50 snapshots. */
export function summarize(pose, rays, grid, frameDeltas, gpu, imp = null) {
  const m = /^(\d+)x(\d+)$/.exec(grid);
  const cells = m ? Number(m[1]) * Number(m[2]) : NaN;
  const row = {
    pose, rays, grid, imp,
    frameP50: pct(frameDeltas, 0.5), frameP95: pct(frameDeltas, 0.95),
    totalGpu: median(gpu.total),
    gbufferMB: cells * rays * GBUFFER_BYTES_PER_SAMPLE / 1048576,
    timers: gpu.total.some(Number.isFinite),
  };
  for (const n of PASS_COLS) row[n] = median(gpu.passes[n] || []);
  return row;
}

/** D-075 step 5 gates (total GPU ms at roadSouth, impostors on). Returns {name, limit, ms, pass} or null when not applicable. */
export const IMP_GATES = { rtx: { quality: 'ultra', limit: 7.5 }, intel: { quality: 'high', limit: 10 } };
export function gateResult(rows, gpuKind, quality, pose = 'roadSouth') {
  const g = IMP_GATES[gpuKind];
  if (!g || quality !== g.quality) return null;
  const r = rows.find((x) => x.pose === pose && x.imp === 1);
  if (!r || !r.timers) return { name: `${gpuKind} ${g.quality}`, limit: g.limit, ms: NaN, pass: null };
  return { name: `${gpuKind} ${g.quality}`, limit: g.limit, ms: r.totalGpu, pass: r.totalGpu <= g.limit };
}
export function formatGate(res) {
  if (!res) return 'GATE: n/a (needs --gpu rtx --quality ultra, or --gpu intel --quality high, with --imp on)';
  return `GATE ${res.name} <= ${res.limit} ms GPU at roadSouth (imp on): ${Number.isFinite(res.ms) ? res.ms.toFixed(2) + ' ms ' : 'no timers '}${res.pass === null ? 'UNKNOWN' : res.pass ? 'PASS' : 'FAIL'}`;
}

const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
export function formatTable(rows) {
  const head = ['pose', 'rays', 'imp', 'frame p50', 'frame p95', 'raster', 'resolve', 'shade', 'total GPU', 'gbuf MB'];
  const body = rows.map((r) => [r.pose, String(r.rays), r.imp === null || r.imp === undefined ? '-' : r.imp ? 'on' : 'off', f(r.frameP50), f(r.frameP95), f(r.raster), f(r.resolve), f(r.shade), f(r.totalGpu), f(r.gbufferMB, 1)]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => c.map((x, i) => i === 0 ? x.padEnd(w[i]) : x.padStart(w[i])).join('  ');
  const out = [line(head), w.map((n) => '-'.repeat(n)).join('  '), ...body.map(line)];
  if (rows.length && !rows.some((r) => r.timers)) out.push('NOTE: GPU timestamp queries unavailable on this adapter - only frame times are valid.');
  return out.join('\n');
}

async function main() {
  const { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } = await import('./capture-browser.mjs');
  const o = parseArgs(process.argv.slice(2));
  validatePort(o.port);
  if (o.port < 9500 || o.port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bench-presets-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(o.port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp;
  const rows = [];
  try {
    await waitForHttp(`http://127.0.0.1:${o.port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${o.port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(o.port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    for (const pose of o.poses) for (const rays of o.rays) for (const imp of o.imp) {
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${o.port}/game/index.html?pose=${pose}&grid=${o.grid}&rays=${rays}${o.quality ? `&quality=${o.quality}` : ''}${imp === null ? '' : `&imp=${imp}`}&title=0` });
      let ready = false;
      for (let i = 0; i < 400; i++) { // up to ~2 min: pipeline ready + far terrain baked
        await pause(300);
        ready = await evaluate(cdp, '(()=>{const d=window.__debug;return !!(d&&d.wgPipeline&&d.wgPipeline.ready&&d.engine&&d.engine.world&&d.engine.world.terrain&&d.engine.world.terrain.farReady);})()').catch(() => false);
        if (ready) break;
      }
      if (!ready) { console.error(`[skip] ${pose} rays ${rays}: not ready`); continue; }
      // Headless: no pointer lock -> sim pauses; keep look.locked. Record rAF deltas + GPU stats snapshots in-page.
      await evaluate(cdp, `(()=>{ const d=window.__debug; clearInterval(window.__lockIv); window.__lockIv=setInterval(()=>{ if(d.look) d.look.locked=true; },30);
        const names=${JSON.stringify(['cull', 'raster', 'shadow', 'resolve', 'water', 'light', 'shade', 'edge', 'sprites', 'overlay', 'hzb', 'cull2', 'raster2', 'pshadow', 'stable'])};
        window.__bp={deltas:[],total:[],passes:{raster:[],resolve:[],shade:[]},on:true}; let last=performance.now();
        const tick=(t)=>{ if(!window.__bp.on) return; window.__bp.deltas.push(t-last); last=t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        window.__bpIv=setInterval(()=>{ const s=d.wgPipeline.stats; if(!s) return; window.__bp.total.push(s.gpuMsP50); for(const n of ['raster','resolve','shade']) window.__bp.passes[n].push(s.wgPassMsP50[names.indexOf(n)]); },250); })()`, true);
      await pause(3000); // warm-up window is discarded below
      await evaluate(cdp, 'window.__bp.deltas.length=0; window.__bp.total.length=0; for(const k in window.__bp.passes) window.__bp.passes[k].length=0; 0');
      await pause(o.seconds * 1000);
      const raw = JSON.parse(await evaluate(cdp, 'window.__bp.on=false; clearInterval(window.__bpIv); clearInterval(window.__lockIv); JSON.stringify({deltas:window.__bp.deltas,total:window.__bp.total,passes:window.__bp.passes})'));
      const nan = (a) => a.map((v) => (v === null ? NaN : v)); // JSON turns NaN into null
      raw.total = nan(raw.total); for (const k in raw.passes) raw.passes[k] = nan(raw.passes[k]);
      rows.push(summarize(pose, rays, o.grid, raw.deltas, raw, imp));
    }
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  }
  if (o.json) console.log(JSON.stringify(rows.map((r) => ({ ...r, frameP50: r.frameP50 || null })), (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2));
  else console.log(formatTable(rows) + '\n' + formatGate(gateResult(rows, o.gpu, o.quality)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
