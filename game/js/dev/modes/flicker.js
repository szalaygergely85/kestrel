// US-048: `?flicker=1` dev mode, moved verbatim out of game/js/main.js.
//
// The GPU-side twin of tools/bench-cast.mjs's US-028a CPU flicker metric -
// SAME start pose (test_room, 2.5, 2.5, eyeHeight, yaw 90, pitch 0) and
// motions (30 steps each of 0.02 m forward, 0.02 m strafe, 0.1 deg yaw), so
// its "JS (1-ray)" row is directly comparable to bench-cast.mjs's own
// printed numbers (the CPU shading path is identical - see castJsFrame
// below) without a second implementation to keep in sync. Reports one row
// per path: JS (CPU, `renderWorld` with `fb.gpuDda = false`) and GPU at
// whatever `rays` this page loaded with.
import {
  loadLevel, bindLevel, World, repackMaterials, renderWorld, ambientL, flickerStep,
} from '../../../../engine/index.js';

export const name = 'flicker';

export function run(ctx) {
  const { rt, overlay, assets, matTable, gbuf, depthBuffer, openSpans, detailPass, engine, gpuPipeline, params } = ctx;

  if (!gpuPipeline) {
    const msg = '[flicker] no active GpuCellPipeline (backend=' + rt.backend + ') - nothing to measure.';
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }

  const level = loadLevel(assets.level('test_room'));
  bindLevel(matTable, level);
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  for (const s of world.structures) { if (s.kind === 'mesh') continue; bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }

  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, gpuDda: false,
  };
  const n = rt.cols * rt.rows;

  const STEPS = 30, STEP_M = 0.02, STEP_DEG = 0.1;
  const base = { x: 2.5, y: 2.5, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 0 };
  const yawRad = base.yawDeg * Math.PI / 180;
  const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad);

  // --- JS (CPU, 1-ray) path: gbuf.kind/mat/planeId + rt.cells.fg (the
  // shaded fg layer's alpha channel already carries the byte glyph code,
  // see CellBuffer.js) - no extra readback needed, this IS the final buffer.
  function castJsFrame(cam) {
    fbCompare.gpuDda = false;
    const wasActive = rt.gpuActive;
    rt.gpuActive = false; // force the CPU shade/edge passes to actually run
    renderWorld(fbCompare, world, cam);
    rt.gpuActive = wasActive;
    const GI = new Uint32Array(4 * n);
    for (let i = 0; i < n; i++) {
      GI[i * 4] = gbuf.planeId[i] >>> 0;
      GI[i * 4 + 1] = (gbuf.kind[i] & 0xff) | ((gbuf.mat[i] & 0xffff) << 16);
    }
    return { GI, fg: rt.cells.fg.slice() };
  }

  // --- GPU (DDA, n = gpuPipeline.rays) path: real present()+readback. ---
  function castGpuFrame(cam) {
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam); // primes ambientL; the DDA itself runs in present()
    gpuPipeline.frame(fbCompare, ambientL, cam, world);
    rt.present();
    const fg = gpuPipeline.readback().fg.slice();
    const { GI } = gpuPipeline.readbackGeometry();
    return { GI: GI.slice(), fg };
  }

  // Architect review 1 item 1 + PO ruling: `totalPct` (all non-sky-in-both
  // cells, no neighbour exclusion - see flicker.js) is the AC number now;
  // `pct` (US-028a's original interior-only metric) is kept as `interiorPct`,
  // informational, required only to not regress vs GPU n=1.
  function motionSeries(castFrame, dx, dy, dyaw, collect) {
    let cam = { ...base };
    let prev = castFrame(cam);
    let sumInterior = 0, sumTotal = 0;
    const out = {};
    for (let s = 0; s < STEPS; s++) {
      cam = { x: cam.x + dx, y: cam.y + dy, z: cam.z, yawDeg: cam.yawDeg + dyaw, pitchDeg: cam.pitchDeg };
      const cur = castFrame(cam);
      flickerStep(prev.GI, prev.fg, cur.GI, cur.fg, rt.cols, rt.rows, out);
      sumInterior += out.pct;
      sumTotal += out.totalPct;
      // Architect review 1 item 2: per-step forward diagnostic, gated behind
      // `?flickersteps=1` (not part of the normal AC printout) - probes the
      // suspected float32/float64 boundary spike at x = 3.0 (start x 2.5 +
      // step 25 * 0.02m).
      if (collect) collect.push({ step: s + 1, x: cam.x, pct: out.pct, totalPct: out.totalPct });
      prev = cur;
    }
    return { interior: sumInterior / STEPS, total: sumTotal / STEPS };
  }

  function runRow(castFrame, collectFwd) {
    const fwd = motionSeries(castFrame, fwdX * STEP_M, fwdY * STEP_M, 0, collectFwd);
    const strafe = motionSeries(castFrame, rightX * STEP_M, rightY * STEP_M, 0);
    const yaw = motionSeries(castFrame, 0, 0, STEP_DEG);
    const avg = (fn) => (fwd[fn] + strafe[fn] + yaw[fn]) / 3;
    return {
      fwd: fwd.total, strafe: strafe.total, yaw: yaw.total, avg: avg('total'),
      fwdInterior: fwd.interior, strafeInterior: strafe.interior, yawInterior: yaw.interior, avgInterior: avg('interior'),
    };
  }

  const wantSteps = params.get('flickersteps') === '1';
  const jsFwdSteps = wantSteps ? [] : null;
  const gpuFwdSteps = wantSteps ? [] : null;
  const jsRow = runRow(castJsFrame, jsFwdSteps);
  const gpuRow = runRow(castGpuFrame, gpuFwdSteps);
  const improvementPct = jsRow.avg > 0 ? 100 * (1 - gpuRow.avg / jsRow.avg) : 0;
  const interiorOkVsN1 = gpuRow.avgInterior <= jsRow.avgInterior || gpuPipeline.rays === 1;

  const rowText = (name2, r) => `${name2}: fwd ${r.fwd.toFixed(2)}%  strafe ${r.strafe.toFixed(2)}%  yaw ${r.yaw.toFixed(2)}%  averaged ${r.avg.toFixed(2)}%` +
    `  (interior-only, informational: fwd ${r.fwdInterior.toFixed(2)}%  strafe ${r.strafeInterior.toFixed(2)}%  yaw ${r.yawInterior.toFixed(2)}%  averaged ${r.avgInterior.toFixed(2)}%)`;
  const text = `?flicker=1  grid: ${rt.cols}x${rt.rows}  30 steps x {0.02m fwd, 0.02m strafe, 0.1deg yaw}  (main numbers = totalPct, item 1)\n` +
    `${rowText('JS   (1-ray)      ', jsRow)}\n` +
    `${rowText(`GPU  (n=${gpuPipeline.rays}, 2x2 default)`, gpuRow)}\n` +
    `GPU vs JS (totalPct): ${improvementPct.toFixed(1)}% lower (target >= 20%)\n` +
    `AC (totalPct >= 20% lower than JS): ` + (improvementPct >= 20 ? 'PASS' : 'FAIL') + `\n` +
    `AC (interiorPct informational, not worse than GPU n=1): ` + (interiorOkVsN1 ? 'PASS' : 'FAIL (see console)');

  console.log('[flicker] ' + text.replace(/\n/g, '\n[flicker] '));
  if (wantSteps) {
    console.log(`[flicker] per-step forward (JS vs GPU n=${gpuPipeline.rays}) - x = 2.5 + step*0.02, boundary expected at step 25 (x=3.0):`);
    for (let s = 0; s < STEPS; s++) {
      const j = jsFwdSteps[s], g = gpuFwdSteps[s];
      console.log(`  step ${String(j.step).padStart(2)}  x=${j.x.toFixed(9)}  JS pct=${j.pct.toFixed(2)}% total=${j.totalPct.toFixed(2)}%   GPU pct=${g.pct.toFixed(2)}% total=${g.totalPct.toFixed(2)}%`);
    }
    window.__flickerSteps = { js: jsFwdSteps, gpu: gpuFwdSteps };
  }
  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__flicker = { jsRow, gpuRow, improvementPct };
}
