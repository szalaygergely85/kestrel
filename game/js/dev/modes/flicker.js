// US-048: `?flicker=1` dev mode, moved verbatim out of game/js/main.js.
//
// The GPU-side twin of tools/bench-cast.mjs's US-028a CPU flicker metric -
// SAME start pose (test_room, 2.5, 2.5, eyeHeight, yaw 90, pitch 0) and
// motions (30 steps each of 0.02 m forward, 0.02 m strafe, 0.1 deg yaw), so
// its "JS (1-ray)" row is directly comparable to bench-cast.mjs's own
// printed numbers (the CPU shading path is identical - see castJsFrame
// below) without a second implementation to keep in sync. Reports one row
// per path: JS (CPU, `renderWorld` with `fb.gpu = false`) and GPU at
// whatever `rays` this page loaded with.
import {
  loadLevel, bindLevel, World, repackMaterials, renderWorld, ambientL, buildLightSet, makeLightBuffer,
} from '../../../../engine/index.js';
import { runRow } from './flickerMeasure.js';

export const name = 'flicker';

export async function run(ctx) {
  const { rt, overlay, assets, matTable, gbuf, depthBuffer, detailPass, engine, wgPipeline, fadeLut, params } = ctx;
  // FLICKER-WG-01: the GPU row is the WebGPU WgCellPipeline (cells via readbackCells, geometry via readbackGeometry);
  // the old GL pipeline is gone. `?stable=1` (US-073c) builds the stable pass; this mode keeps it on for the whole run.
  const gpuPipeline = wgPipeline && wgPipeline.ready ? wgPipeline : null;
  const wantStable = params.get('stable') === '1';

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
    rt, depth: depthBuffer, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, gpu: false, renderer: 'mesh',
  };
  const n = rt.cols * rt.rows;
  // `&lit=1`: the level's real light set (sun + point lights) instead of flat ambientL - needed to see shade-ramp
  // flicker, which is what the US-073 stable pass removes (ambient-only has none).
  const lit = params.get('lit') === '1';
  const lights = lit ? buildLightSet(world, assets.palette) : null;
  if (lit) { fbCompare.lights = lights; fbCompare.light = makeLightBuffer(rt.cols, rt.rows); }

  // `&stepm=<m>&stepdeg=<deg>`: slower pan (the US-073 stable pass only reuses history within 0.5/detail of the same surface point)
  const STEPS = 30, STEP_M = Number(params.get('stepm')) || 0.02, STEP_DEG = Number(params.get('stepdeg')) || 0.1;
  const base = { x: 2.5, y: 2.5, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 0 };
  const yawRad = base.yawDeg * Math.PI / 180;
  const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad);

  // --- JS (CPU, 1-ray) path: gbuf.kind/mat/planeId + rt.cells.fg (the
  // shaded fg layer's alpha channel already carries the byte glyph code,
  // see CellBuffer.js) - no extra readback needed, this IS the final buffer.
  function castJsFrame(cam) {
    fbCompare.gpu = false;
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

  // --- GPU (WebGPU, n = gpuPipeline.rays) path: frame + present + async readbacks. ---
  const fbGpu = { ...fbCompare, lights, fadeLut, sceneFade: 1, frameNo: 0, gpu: true };
  async function castGpuFrame(cam) {
    fbGpu.frameNo++;
    renderWorld(fbGpu, world, cam); // primes ambientL; the passes run in frame()/present()
    gpuPipeline.frame(fbGpu, lights || ambientL, cam, world);
    engine.overlay.flush(cam);
    rt.present();
    const cells = await gpuPipeline.readbackCells();
    const fg = cells.fg.slice();
    const { GI } = await gpuPipeline.readbackGeometry();
    return { GI: GI.slice(), fg };
  }

  const motions = {
    fwd: { dx: fwdX * STEP_M, dy: fwdY * STEP_M, dyaw: 0 },
    strafe: { dx: rightX * STEP_M, dy: rightY * STEP_M, dyaw: 0 },
    yaw: { dx: 0, dy: 0, dyaw: STEP_DEG },
  };

  // totalPct (all non-sky-in-both cells, glyph OR surface-key change) is the main number; interior kept informational.
  const wantSteps = params.get('flickersteps') === '1';
  const jsFwdSteps = wantSteps ? [] : null;
  const gpuFwdSteps = wantSteps ? [] : null;
  gpuPipeline.setSource('scene');
  if (gpuPipeline.setStable) gpuPipeline.setStable(wantStable);
  const stableActive = wantStable && !!gpuPipeline._stablePass;
  const jsRow = await runRow(castJsFrame, base, motions, STEPS, rt.cols, rt.rows, { collect: jsFwdSteps });
  const gpuRow = await runRow(castGpuFrame, base, motions, STEPS, rt.cols, rt.rows,
    { collect: gpuFwdSteps, onStart: () => gpuPipeline.invalidateHistory && gpuPipeline.invalidateHistory() });
  const improvementPct = jsRow.avg > 0 ? 100 * (1 - gpuRow.avg / jsRow.avg) : 0;
  const interiorOkVsN1 = gpuRow.avgInterior <= jsRow.avgInterior || gpuPipeline.rays === 1;

  const rowText = (name2, r) => `${name2}: fwd ${r.fwd.toFixed(2)}%  strafe ${r.strafe.toFixed(2)}%  yaw ${r.yaw.toFixed(2)}%  averaged ${r.avg.toFixed(2)}%` +
    `  (interior-only, informational: fwd ${r.fwdInterior.toFixed(2)}%  strafe ${r.strafeInterior.toFixed(2)}%  yaw ${r.yawInterior.toFixed(2)}%  averaged ${r.avgInterior.toFixed(2)}%)`;
  const text = `?flicker=1${stableActive ? '&stable=1' : ''}${lit ? '&lit=1' : ''}  grid: ${rt.cols}x${rt.rows}  30 steps x {${STEP_M}m fwd, ${STEP_M}m strafe, ${STEP_DEG}deg yaw}  (main numbers = totalPct, item 1)\n` +
    `${rowText('JS   (1-ray)      ', jsRow)}\n` +
    `${rowText(`GPU  (n=${gpuPipeline.rays}, WebGPU${stableActive ? ', stable ON' : ''})`, gpuRow)}\n` +
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
  // gpuShare = GPU changed-glyph share (%, averaged over fwd/strafe/yaw); ratio of stable-on to stable-off = stableRatio(on.gpuShare, off.gpuShare)
  let diffN = -1, histV = null;
  if (gpuPipeline._stablePass && gpuPipeline._stableRan) {
    const d = gpuPipeline.device, rect = { x: 0, y: 0, w: rt.cols, h: rt.rows }, a = new Uint8Array(n * 4), b = new Uint8Array(n * 4);
    await d.readback(gpuPipeline._stablePass.outFg, rect, a); await d.readback(gpuPipeline._t.texFinalFg, rect, b);
    diffN = 0; for (let i = 0; i < n; i++) if (a[i * 4 + 3] !== b[i * 4 + 3]) diffN++;
    histV = gpuPipeline._stablePass.st.histValid;
  }
  const stDiag0 = { diffN, histV };
  const stDiag = gpuPipeline._stablePass ? { ...stDiag0, ran: !!gpuPipeline._stableRan, on: !!gpuPipeline._stableOn, passRan: !!gpuPipeline._stablePass.ran, pitched: !!(gpuPipeline._rasterPass && gpuPipeline._rasterPass.pitched), spritesRan: !!gpuPipeline._spritesRan } : null;
  window.__flicker = { jsRow, gpuRow, improvementPct, stDiag, stable: stableActive, lit, gpuShare: gpuRow.avg, jsShare: jsRow.avg };
}
