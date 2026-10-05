#!/usr/bin/env node
// tools/route-walk-browser.mjs (ME-12 phase-2 gate, AC 1, 6, 7). Headless Chrome over CDP, own server on --port.
//   node tools/route-walk-browser.mjs --port 9230 --grid 400x150 --renderer mesh --physics mesh [--shadows map] [--out file.json]
// Loads game/index.html?voxelbench=0&... (any truthy voxelbench/bench param = isCaptureOrBench = no pause overlay, so no
// pointer lock is needed; =0 does not start the voxel bench), waits for the player, then F3 (GPU pass timing) and walks the whole M1 route by
// writing the game's own Input (KeyW/ShiftLeft/Space/KeyE) and look.yawDeg each frame. Per frame it samples
// engine.loop.stats (sim/js/interval) and gpuPipeline.stats, and per leg records completed / stuck / fell / end pos.
// Prints one JSON object. Same legs as tools/route-walk.mjs (the Node twin). Cleans up only its own server/browser.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate, buildLaunchFlags, validatePort,
} from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port);
validatePort(port);
const grid = args.grid || '400x150', renderer = args.renderer || 'mesh', physics = args.physics || 'mesh';
const noSkip = args.noskip === '1'; // ME-15d: --noskip 1 forces the shadow map to re-render every frame (worst case row)
const shadows = args.shadows; // ME-15c: `--shadows map` appends &shadows=map (sun shadow map instead of the sun DDA)
const query = `voxelbench=0&grid=${grid}&renderer=${renderer}&physics=${physics}${shadows ? `&shadows=${shadows}` : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The in-page driver (runs inside the game page). Returns a Promise resolved with the result object.
const DRIVER = `(async () => {
  const NOSKIP = ${noSkip};
  for (let i = 0; i < 3000 && !(window.__debug && window.__debug.engine); i++) await new Promise((r) => setTimeout(r, 50));
  const D = window.__debug, eng = D.engine, input = D.input, loop = eng.loop;
  const sleepF = () => new Promise((r) => requestAnimationFrame(r));
  const O = { x: 1480, y: 1018 };
  const W = (x, y) => ({ x: O.x + x + 0.5, y: O.y + y + 0.5 });
  const WAY = { x: 1428, y: 1040 }, NEAR = { x: 1470, y: 1029 };
  const yawTo = (fx, fy, tx, ty) => Math.atan2(tx - fx, -(ty - fy)) * 180 / Math.PI;
  const pH = () => window.__debug.playerHandle, T = () => pH().data.transform, B = () => pH().data.components.body;
  const world = () => window.__debug.world || eng.world;
  for (let i = 0; i < 4000 && !(window.__debug.playerHandle); i++) await sleepF();
  const out = { grid: D.rt.cols + 'x' + D.rt.rows, backend: D.rt.backend, physicsMode: world().physicsMode, legs: [], info: {} };
  const sim = [], js = [], gpu = [], ivl = [], shp = [], shc = [];
  const gp0 = D.gpuPipeline; if (NOSKIP && gp0 && gp0.shadowOpts) gp0.shadowOpts.dirtySkip = false;
  let sampling = false;
  function sample() { if (!sampling) return; const s = loop.stats; sim.push(s.simMs); js.push(s.jsMs); ivl.push(s.intervalMs); const g = D.gpuPipeline && D.gpuPipeline.stats ? D.gpuPipeline.stats.gpuMsP50 : NaN; gpu.push(g); const gp = D.gpuPipeline; if (gp && gp.stats && gp.stats.passMsP50) { shp.push(gp.stats.passMsP50[7]); shc.push(gp.stats.shadowCpuMs); } }
  input._pressedThisFrame.add('F3'); await sleepF(); await sleepF(); // overlay on -> GPU pass timing on (as the owner's F3)
  for (let i = 0; i < 120; i++) await sleepF(); // let boot / terrain streaming settle (real wake timeline then runs from wakeT)
  out.info.startPose = { x: T().x - O.x, y: T().y - O.y, z: T().z, eyeH: B().eyeH, wakeT: world().state['quest.wakeT'] };
  loop.resetStats(); sampling = true;
  const keys = (w, run, jump) => {
    for (const [k, on] of [['KeyW', w], ['ShiftLeft', run], ['Space', jump]]) { if (on) { if (!input._down.has(k)) input._pressedThisFrame.add(k); input._down.add(k); } else input._down.delete(k); }
  };
  let n = 0;
  // wake: wait until input is free (eyeH back to standing)
  let wf = 0; while (B().eyeH < 1.5 && wf < 4000) { await sleepF(); sample(); wf++; }
  out.legs.push({ name: '1 wake (timeline)', completed: B().eyeH >= 1.5, frames: wf, end: { x: T().x - O.x, y: T().y - O.y, z: T().z }, eyeH: B().eyeH, wakeT: world().state['quest.wakeT'] });
  async function leg(name, wps, opts = {}) {
    const rec = { name, completed: true, frames: 0, fell: false, stuck: null, minGap: 1e9 };
    let jumpLeft = 0;
    for (let i = 0; i < wps.length; i++) {
      const wp = wps[i]; let f = 0, best = 1e9, bestAt = 0, bias = 0, biasLeft = 0, tries = 0;
      for (;; f++) {
        const tr = T(), dist = Math.hypot(wp.x - tr.x, wp.y - tr.y);
        if (dist < 0.4) break;
        if (opts.untilEnd && world().state['quest.endT'] >= 0) { rec.endTriggered = true; break; } // the scripted ending takes the controls over
        if (f >= (opts.maxFrames || 900)) { rec.completed = false; rec.stuck = { wp: i, x: tr.x - O.x, y: tr.y - O.y, z: tr.z }; break; }
        if (opts.detour) {
          if (dist < best - 0.3) { best = dist; bestAt = f; }
          if (biasLeft <= 0 && f - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = f; }
          if (biasLeft > 0) biasLeft--; else bias = 0;
        }
        D.look.yawDeg = yawTo(tr.x, tr.y, wp.x, wp.y) + bias; D.look.pitchDeg = 0;
        if (wp.jump && dist < 2 && jumpLeft <= 0 && f > 0) jumpLeft = 6;
        keys(true, true, jumpLeft > 0); if (jumpLeft > 0) jumpLeft--;
        await sleepF(); sample(); rec.frames++;
        if (rec.frames <= 90 && rec.frames % 6 === 0) (rec.trace = rec.trace || []).push([+(T().x - O.x).toFixed(2), +(T().y - O.y).toFixed(2), +T().z.toFixed(2), +B().vx.toFixed(2), +B().vy.toFixed(2)]);
        const fl = world().floorAt(T().x, T().y);
        if (fl != null) { rec.minGap = Math.min(rec.minGap, T().z - fl); if (T().z < fl - 0.25) rec.fell = true; }
      }
      if (!rec.completed) break;
    }
    keys(false, false, false);
    rec.end = { x: T().x - O.x, y: T().y - O.y, z: T().z };
    if (opts.expectBlocked) rec.completed = !rec.completed;
    out.legs.push(rec); return rec;
  }
  const idle = async (frames) => { keys(false, false, false); for (let i = 0; i < frames; i++) { await sleepF(); sample(); } };
  await leg('1b walk out', [W(15, 9)]);
  await leg('2 boulder push', [W(15, 5), W(15, 3)]);
  await idle(480);
  { let bx = null; world().forEachEntity((e) => { if (e.components && e.components.roller) bx = { x: e.transform.x - O.x, y: e.transform.y - O.y, z: e.transform.z, sleeping: e.components.roller.sleeping }; }); out.info.boulder = bx; }
  // ME-15d AC2: after the boulder push (player still, boulder asleep) -> the shadow map must not re-render (counter delta over 120 idle frames)
  { const gp = D.gpuPipeline; keys(false, false, false); await idle(30); const r0 = gp ? gp.shadowRenders : 0, s0 = gp ? gp.shadowSkips : 0;
    await idle(120); out.info.staticShadow = gp ? { frames: 120, renders: gp.shadowRenders - r0, skips: gp.shadowSkips - s0 } : null; }
  await leg('3 stairs', [W(16, 3), W(17, 3), W(18, 3), W(19, 3), W(19, 4), W(20, 4), W(20, 5), W(20, 6), W(20, 7)]);
  await leg('4 gap jump + ledge', [{ ...W(20, 9), jump: true }, W(19, 9)]);
  // TOWER-LEVER-01: upper stair is open from the first load; no E interaction.
  out.info.upperStairOpen = world().structures[0].level.sectorAt(18.5, 10.5).ceilH === 'sky';
  out.info.leverAbsent = !world().get('tower.lever') && !world().interactables.some(r => r.id === 'lever');
  await leg('5a open landing', [W(19, 10), W(18, 10)]);
  await leg('5b upper steps', [W(17, 10), W(16, 10), W(15, 10), W(14, 10), W(14, 9), W(13, 9), W(13, 8), W(13, 7), W(12, 7)]);
  await leg('6 doorway + summit', [W(11, 7), W(10, 7), W(10, 8), W(9, 8), W(8, 8), W(7, 8), W(7, 7)]);
  await leg('7a breach + outcrop', [W(6, 7), W(5, 7)]);
  await leg('7b hillside -> waystone', [NEAR, WAY], { detour: true, maxFrames: 2400, untilEnd: true });
  out.info.endTrigger = world().state['quest.endT'] >= 0 || (world().triggers.find((x) => x.name === 'quest.end') || {}).inside === 1;
  out.info.endT = world().state['quest.endT'];
  sampling = false;
  const mean = (a) => { const v = a.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  out.shadowCpuMean = mean(shc);
  const pct = (a, p) => { const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };
  out.perf = { frames: sim.length, simP50: pct(sim, 0.5), simP95: pct(sim, 0.95), simMax: pct(sim, 1), jsP95: pct(js, 0.95), jsMax: pct(js, 1), gpuP95: pct(gpu, 0.95), gpuP50: pct(gpu, 0.5),
    shadowCpuP50: pct(shc, 0.5), shadowCpuP95: pct(shc, 0.95), shadowPassP50: pct(shp, 0.5), shadowPassP95: pct(shp, 0.95), intervalP95: pct(ivl, 0.95), over25: loop.stats.over25, worstIntervalMs: loop.stats.worstIntervalMs };
  const gpF = D.gpuPipeline; out.shadow = gpF ? { renders: gpF.shadowRenders, skips: gpF.shadowSkips, dirtySkip: !!(gpF.shadowOpts && gpF.shadowOpts.dirtySkip), items: gpF.stats.shadowItems, draws: gpF.stats.shadowDraws } : null;
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
  handles.dir = path.join(os.tmpdir(), 'kestrel-routewalk-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${query}` });
  await loaded;
  const r = await cdp.send('Runtime.evaluate', { expression: DRIVER, returnByValue: true, awaitPromise: true, timeout: 400000 });
  if (r.exceptionDetails) throw new Error('driver threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  const res = { query, ...r.result.value };
  if (args.out) writeFileSync(args.out, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  cdp.close();
} finally { cleanup(); }
