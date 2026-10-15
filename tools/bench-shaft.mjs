#!/usr/bin/env node
// tools/bench-shaft.mjs - GPU cost of the three FX features before they ship on (reuses bench-presets helpers, no new deps).
//   node tools/bench-shaft.mjs <port> [--gpu rtx|intel] [--seconds 8] [--write docs/test-reports/<file>.md] [--json]
// Per pose it measures total GPU ms (WG timestamp queries: __debug.wgPipeline.stats.gpuMsP50, sampled every 250 ms) with the feature on vs off
// and reports min-of-N and median of the P50 snapshots; delta = on - off (min). Features:
//   shaft  : CANOPY-SHAFT (38.76)   `?shafts=0` vs default (high 6 steps / ultra 10), budget RTX ultra <= 0.4 ms, Intel high <= 0.6 ms
//   water  : WATER-FINISH-01b (38.77) waterLooks with causticK/reflScreenK zeroed vs the design table, budget <= 0.05 ms RTX / <= 0.12 ms Intel
//   clouds : default morning clouds (look.clouds; shade uniform cloud block zeroed vs baked), no hard ms budget in the cloud note -> informational
// --gpu rtx -> quality ultra, intel -> quality high (run the same command on the laptop with --gpu intel).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pct } from './bench-presets.mjs';

export const SCENARIOS = [
  { feature: 'shaft', pose: 'forestFloor', time: 8, off: { js: 'shaft0' }, on: { js: 'shaft1' }, budget: { rtx: 0.4, intel: 0.6 } },
  { feature: 'shaft', pose: 'lookForestEdge', time: 8, off: { js: 'shaft0' }, on: { js: 'shaft1' }, budget: { rtx: 0.4, intel: 0.6 } },
  { feature: 'water', pose: 'fordDetail', off: { js: 'water0' }, on: { js: 'water1' }, budget: { rtx: 0.05, intel: 0.12 } },
  { feature: 'water', pose: 'lakeEdge', off: { js: 'water0' }, on: { js: 'water1' }, budget: { rtx: 0.05, intel: 0.12 } },
  { feature: 'clouds', pose: 'towerExterior', off: { js: 'clouds0' }, on: { js: 'clouds1' }, budget: null },
  { feature: 'clouds', pose: 'meadowSea', off: { js: 'clouds0' }, on: { js: 'clouds1' }, budget: null },
];
// In-page toggles (evaluated after the page is ready). Water/clouds flip live state, shaft reloads the page with ?shafts=0.
const JS = {
  shaft0: `(()=>{const f=window.__debug.fxHook; if(!f||!f.shaft) return 0; if(!window.__st0) window.__st0=f.shaft.steps; f.shaft.steps=0; return 1;})()`,
  shaft1: `(()=>{const f=window.__debug.fxHook; if(!f||!f.shaft||!window.__st0) return 0; f.shaft.steps=window.__st0; return 1;})()`,
  water0: `(()=>{const d=window.__debug,A=window.ASSETS; if(!window.__wl0) window.__wl0=A.waterLooks; const z={}; for(const k in window.__wl0){const l=window.__wl0[k]; z[k]=l&&typeof l==='object'?{...l,causticK:0,reflScreenK:0}:l;} d.wgPipeline.setWaterLooks(z); return 1;})()`,
  water1: `(()=>{const d=window.__debug; d.wgPipeline.setWaterLooks(window.__wl0||window.ASSETS.waterLooks); return 1;})()`,
  clouds0: `(()=>{const sp=window.__debug.wgPipeline._cellPass.shadePass; window.__sp=sp; if(!sp||!sp.su||!sp.skyClouds) return 0; window.__cl=[sp.skyClouds,sp.skyCloudBand]; sp._bakeClouds(sp.su,null,null); return 1;})()`,
  clouds1: `(()=>{const sp=window.__sp,c=window.__cl; if(!sp||!c) return 0; sp._bakeClouds(sp.su,c[0],c[1]); return 1;})()`,
};

function stats(a) { const f = a.filter(Number.isFinite); return { n: f.length, min: f.length ? Math.min(...f) : NaN, med: pct(f, 0.5) }; }
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

async function main() {
  const { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } = await import('./capture-browser.mjs');
  const argv = process.argv.slice(2); const o = { gpu: 'rtx', seconds: 4, rounds: 3, write: null, json: false, port: NaN }; const rest = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--gpu') o.gpu = argv[++i]; else if (a === '--seconds') o.seconds = Number(argv[++i]); else if (a === '--rounds') o.rounds = Number(argv[++i]); else if (a === '--write') o.write = argv[++i]; else if (a === '--json') o.json = true; else rest.push(a); }
  o.port = Number(rest[0]); validatePort(o.port);
  const quality = o.gpu === 'intel' ? 'high' : 'ultra';
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bench-shaft-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(o.port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp; const rows = []; let adapter = '';
  const sample = async (secs) => {
    await evaluate(cdp, `(()=>{const d=window.__debug; clearInterval(window.__lockIv); window.__lockIv=setInterval(()=>{ if(d.look) d.look.locked=true; },30); clearInterval(window.__bsIv); window.__bs=[]; window.__bsIv=setInterval(()=>{const s=d.wgPipeline.stats; if(s) window.__bs.push(s.gpuMsP50);},250); return 1;})()`, true);
    await pause(secs * 1000);
    return JSON.parse(await evaluate(cdp, 'clearInterval(window.__bsIv); JSON.stringify(window.__bs)')).map((v) => (v === null ? NaN : v));
  };
  try {
    await waitForHttp(`http://127.0.0.1:${o.port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${o.port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(o.port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    for (const sc of SCENARIOS) {
      const res = { off: [], on: [] }; let ok = true, steps = 0;
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${o.port}/game/index.html?pose=${sc.pose}&grid=480x180&rays=1&quality=${quality}&title=0${sc.time ? `&time=${sc.time}` : ''}` });
      let ready = false;
      for (let i = 0; i < 400 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '(()=>{const d=window.__debug;return !!(d&&d.wgPipeline&&d.wgPipeline.ready&&d.engine&&d.engine.world&&d.engine.world.terrain&&d.engine.world.terrain.farReady);})()').catch(() => false); }
      if (!ready) { console.error(`[skip] ${sc.feature}/${sc.pose}: not ready`); continue; }
      if (!adapter) { adapter = await evaluateAsync(cdp, `(async()=>{try{const a=await navigator.gpu.requestAdapter();const i=a.info||await a.requestAdapterInfo();return (i.vendor||'')+' '+(i.architecture||'')+' '+(i.description||'');}catch(e){return 'unknown';}})()`).catch(() => 'unknown'); adapter = String(adapter); }
      await pause(4000); // warm-up (far terrain, shader compile) is discarded
      steps = await evaluate(cdp, `(()=>{const f=window.__debug.fxHook; return f&&f.shaft?f.shaft.steps:0;})()`).catch(() => 0);
      // Paired A/B in ONE page load (page-to-page GPU variance was larger than the features): off,on,off,on,... each slot --seconds long.
      for (let round = 0; round < o.rounds && ok; round++) for (const variant of ['off', 'on']) {
        const applied = await evaluate(cdp, JS[sc[variant].js]);
        if (applied !== 1) { console.error(`[warn] ${sc.feature}/${sc.pose}/${variant}: toggle returned ${applied} (feature not present here)`); ok = false; break; }
        await pause(1200);
        res[variant].push(...await sample(o.seconds));
      }
      if (ok) await evaluate(cdp, JS[sc.on.js]);
      res.on = ok ? { ...stats(res.on), steps } : null; res.off = ok ? stats(res.off) : null;
      rows.push({ feature: sc.feature, pose: sc.pose, budget: sc.budget && sc.budget[o.gpu === 'intel' ? 'intel' : 'rtx'], on: res.on, off: res.off });
    }
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
  }
  if (o.write) writeFileSync(o.write.replace(/\.md$/, '.json'), JSON.stringify(rows, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2));
  const lines = [`# Perf: shafts / water finish / morning clouds (${new Date().toISOString().slice(0, 10)})`, '', `Tool: \`node tools/bench-shaft.mjs <port> --gpu ${o.gpu}\` (headless WebGPU, ${quality}, 480x180, rays 1, ${o.rounds} alternating off/on slots x ${o.seconds} s in one page load, GPU timestamp queries = sum of passes, P50 snapshots every 250 ms). Adapter: ${adapter.trim() || 'unknown'}.`, '', 'min = lowest P50 snapshot, med = median; delta = on - off. The verdict uses the MEDIAN delta (min is hit by idle-frame timer glitches, kept for reference); run-to-run noise on a ~4 ms total is about +-0.5 ms, so budgets below that need a quiet GPU / the laptop. Off: shaft steps set to 0; water causticK/reflScreenK = 0; clouds shade cloud block zeroed.', '',
    '| feature | pose | off min / med (ms) | on min / med (ms) | delta min (ms) | delta med (ms) | budget (ms) | verdict |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const dmin = r.on && r.off ? r.on.min - r.off.min : NaN, dmed = r.on && r.off ? r.on.med - r.off.med : NaN;
    const verdict = !Number.isFinite(dmed) ? 'n/a (no timers)' : r.budget == null ? 'info (no ms budget in the cloud note)' : dmed <= r.budget ? 'PASS' : (dmed <= r.budget + 0.5 ? 'within noise (+-0.5 ms)' : 'OVER');
    lines.push(`| ${r.feature}${r.feature === 'shaft' && r.on && r.on.steps ? ` (${r.on.steps} steps)` : ''} | ${r.pose} | ${r.off ? `${fmt(r.off.min, 3)} / ${fmt(r.off.med, 3)}` : 'n/a'} | ${r.on ? `${fmt(r.on.min, 3)} / ${fmt(r.on.med, 3)}` : 'n/a'} | ${fmt(dmin, 3)} | ${fmt(dmed, 3)} | ${r.budget == null ? '-' : `<= ${r.budget}`} | ${verdict} |`);
  }
  const text = lines.join('\n') + '\n';
  if (o.write) writeFileSync(o.write, text);
  console.log(o.json ? JSON.stringify(rows, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2) : text);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
