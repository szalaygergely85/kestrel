#!/usr/bin/env node
// MESH-LOAD-01 headless check (B1): boots the REAL game page (no voxelbench/bench/gpucompare/cinematic param -
// lazy mesh loading stays on, same as a real player boot, see game/js/main.js's `isCaptureOrBench`) and proves:
// (1) boot still reaches the first rendered frame with no console errors/exceptions; (2) by that first frame,
// every placed mesh prop within 60 m of the spawn point is already loaded (`!mesh.lazy`) - the boot
// `prefetchLazyMeshesAtBoot` call (game/js/bootPrefetchHook.js) resolved before `engine.run()`, so nothing near
// the player pops in on frame 1. Own server/browser on --port (PC-B lane B1 range 9500-9574 only); kills only
// what it started. This machine has a slow Intel iGPU - timeouts are generous (up to 2 minutes to first frame).
//   node tools/boot-prefetch-browser.mjs --port 9500 [--grid 240x90]
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort, evaluate, evaluateAsync } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port);
validatePort(port);
if (port < 9500 || port > 9574) throw new Error('PC-B lane B1 range is 9500-9574');
const grid = args.grid || '240x90';
// No voxelbench/bench/gpucompare/cinematic param: isCaptureOrBench stays false, so lazyMeshes defaults ON -
// the same boot path a real player gets, not the "stay eager for comparability" capture path.
const url = `http://127.0.0.1:${port}/game/index.html?grid=${grid}&autoquality=0`;

const handles = {};
const consoleErrors = [];
function cleanup() {
  if (handles.b) killTree(handles.b.pid);
  if (handles.s) killTree(handles.s.pid);
  if (handles.dir) { try { rmSync(handles.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
process.once('SIGINT', () => { cleanup(); process.exit(1); });

// Polls for `window.__bootReport` (set right after `bootMark('first frame rendered')`, game/js/main.js) - the
// first moment a real frame has actually been rendered, not just "engine/world objects exist".
const WAIT_FIRST_FRAME = `(async () => {
  const fr = () => new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 1200 && !window.__bootReport; i++) await fr(); // up to 120 s (slow Intel iGPU)
  return !!window.__bootReport;
})()`;

const CHECK = `(() => {
  const D = window.__debug, w = D.world, t = D.playerHandle.data.transform, store = window.__lazyMeshStore;
  const near = [];
  for (const s of (w.structures || [])) {
    if (s.kind !== 'mesh' || !s.bbox) continue;
    const b = s.bbox;
    const dx = Math.max(b.x0 - t.x, 0, t.x - b.x1), dy = Math.max(b.y0 - t.y, 0, t.y - b.y1);
    if (dx * dx + dy * dy <= 60 * 60) near.push({ id: s.mesh.id, lazy: !!s.mesh.lazy });
  }
  return { pos: { x: t.x, y: t.y }, near, lazyOn: !!store, storeStats: store ? { ...store.stats } : null, bootReport: window.__bootReport };
})()`;

let res;
try {
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary');
  handles.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  handles.dir = path.join(os.tmpdir(), 'kestrel-bootprefetch-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + JSON.stringify(p.exceptionDetails).slice(0, 400));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') consoleErrors.push('console.error: ' + (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 400));
  });

  const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url });
  await loaded;
  const reachedFirstFrame = await evaluateAsync(cdp, WAIT_FIRST_FRAME);
  let state = { near: [], lazyOn: false };
  if (reachedFirstFrame) state = await evaluate(cdp, CHECK);
  res = { reachedFirstFrame, ...state, errors: consoleErrors };
  cdp.close();
} finally { cleanup(); }

const stillLazy = res.near.filter((m) => m.lazy);
const ok = res.reachedFirstFrame === true && res.lazyOn === true && res.near.length > 0 && stillLazy.length === 0 && res.errors.length === 0;
console.log(JSON.stringify(res, null, 1));
console.log(ok
  ? `boot-prefetch: PASS (${res.near.length} near props, 0 still shells at frame 1)`
  : `boot-prefetch: FAIL (reachedFirstFrame=${res.reachedFirstFrame} lazyOn=${res.lazyOn} near=${res.near.length} stillLazy=${stillLazy.length} errors=${res.errors.length})`);
process.exit(ok ? 0 : 1);
