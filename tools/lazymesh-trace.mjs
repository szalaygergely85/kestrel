#!/usr/bin/env node
// MESH-LOAD-01 headless trace: walks roadSouth -> west (forest side) with `?lazymesh=1` (or 0 = baseline) and reports the
// boot fetch counts, the longest frame and how many mesh loads happened per frame. Own server/browser on --port, cleans up only those.
//   node tools/lazymesh-trace.mjs --port 9653 [--lazy 1|0] [--grid 400x150] [--out file.json]
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port);
validatePort(port);
const lazy = args.lazy !== '0';
const query = `voxelbench=0&grid=${args.grid || '400x150'}&physics=mesh&lazymesh=${lazy ? 1 : 0}`;

const DRIVER = `(async () => {
  for (let i = 0; i < 3000 && !(window.__debug && window.__debug.engine); i++) await new Promise((r) => setTimeout(r, 50));
  const D = window.__debug, input = D.input, eng = D.engine, loop = eng.loop;
  const rAF = () => new Promise((r) => requestAnimationFrame(r));
  const st = window.__lazyMeshStore || null;
  const frames = []; let prev = performance.now(), prevDec = 0, prevFetch = 0;
  const rec = (tag) => { const now = performance.now(), dec = st ? st.stats.decoded : 0, ft = st ? st.stats.fetched : 0; frames.push([now - prev, dec - prevDec, ft - prevFetch, loop.stats.jsMs, tag]); prev = now; prevDec = dec; prevFetch = ft; };
  for (let i = 0; i < 4000 && !D.playerHandle; i++) { await rAF(); rec(0); } // boot: every frame from the first until the player exists
  const pH = () => D.playerHandle, T = () => pH().data.transform, B = () => pH().data.components.body;
  const st2 = st;
  const out = { lazy: !!st2, bootFrames: frames.length, bootStats: st2 ? { ...st2.stats } : null };
  for (let i = 0; i < 120; i++) { await rAF(); rec(0); }
  out.afterSettle = st2 ? { ...st2.stats } : null;
  out.bootFrameStats = { longestMsAfterFrame5: Math.max(...frames.slice(5).map((f) => f[0])), longestDecodeFrameMs: Math.max(0, ...frames.filter((f) => f[1] > 0).map((f) => f[0])), maxDecodesInOneFrame: Math.max(0, ...frames.map((f) => f[1])), framesWithDecode: frames.filter((f) => f[1] > 0).length };
  frames.length = 0;
  const yawTo = (fx, fy, tx, ty) => Math.atan2(tx - fx, -(ty - fy)) * 180 / Math.PI;
  const world = D.world || eng.world;
  const keys = (on) => { for (const k of ['KeyW', 'ShiftLeft']) { if (on) { if (!input._down.has(k)) input._pressedThisFrame.add(k); input._down.add(k); } else input._down.delete(k); } };
  // teleport to the roadSouth pose (content/dev-poses.js) and walk the road west-south-west into the forest side
  { const tr = T(), b = B(); tr.x = 1466; tr.y = 1035; tr.z = (world.floorAt(1466, 1035) ?? 0) + 0.3; b.vx = 0; b.vy = 0; b.vz = 0; }
  const wps = [{ x: 1428, y: 1040 }, { x: 1380, y: 1050 }, { x: 1330, y: 1050 }];
  for (const wp of wps) {
    let best = 1e9, bestAt = 0, bias = 0, biasLeft = 0, tries = 0;
    for (let f = 0; f < 900; f++) {
      const tr = T(), dist = Math.hypot(wp.x - tr.x, wp.y - tr.y); if (dist < 1) break;
      if (dist < best - 0.3) { best = dist; bestAt = f; }
      if (biasLeft <= 0 && f - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = f; }
      if (biasLeft > 0) biasLeft--; else bias = 0;
      D.look.yawDeg = yawTo(tr.x, tr.y, wp.x, wp.y) + bias; D.look.pitchDeg = 0; keys(true);
      await rAF(); rec(1);
    }
  }
  keys(false);
  const ms = frames.map((f) => f[0]);
  const worst = frames.reduce((b, f, i) => (f[0] > frames[b][0] ? i : b), 0);
  const loadFrames = frames.filter((f) => f[1] > 0);
  out.walk = { frames: frames.length, end: { x: T().x, y: T().y }, longestFrameMs: Math.max(...ms), longestFrameDecodes: frames[worst][1],
    longestLoadFrameMs: loadFrames.length ? Math.max(...loadFrames.map((f) => f[0])) : 0,
    framesWithDecode: loadFrames.length, maxDecodesInOneFrame: Math.max(0, ...frames.map((f) => f[1])), maxFetchesInOneFrame: Math.max(0, ...frames.map((f) => f[2])),
    over50: ms.filter((m) => m > 50).length, over50WithDecode: frames.filter((f) => f[0] > 50 && f[1] > 0).length,
    p95: ms.slice().sort((a, b) => a - b)[Math.floor(ms.length * 0.95)], maxJsMs: Math.max(...frames.map((f) => f[3])) };
  out.final = st ? { ...st.stats } : null;
  return out;
})()`;

const handles = {};
function cleanup() {
  if (handles.b) killTree(handles.b.pid);
  if (handles.s) killTree(handles.s.pid);
  if (handles.dir) { try { rmSync(handles.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
process.once('SIGINT', () => { cleanup(); process.exit(1); });
try {
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary');
  handles.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  handles.dir = path.join(os.tmpdir(), 'kestrel-lazytrace-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`${query}`)}` });
  await loaded;
  const r = await cdp.send('Runtime.evaluate', { expression: DRIVER, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.exceptionDetails) throw new Error('driver threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  const res = { query, ...r.result.value };
  if (args.out) writeFileSync(args.out, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  cdp.close();
} finally { cleanup(); }
