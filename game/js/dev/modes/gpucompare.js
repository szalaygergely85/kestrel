// US-048: `?gpucompare=1|shade|mesh`, moved verbatim (behaviour-identical)
// out of game/js/main.js. All three variants share `buildCompareRuns()`
// (the DDA and mesh variants both cast the same world/pose list; the shade
// variant is a separate, simpler test_room-only path) so they stay in one
// module rather than being split across three files per the letter of the
// backlog row - splitting would mean either duplicating buildCompareRuns/
// makeDiffPngPainter or introducing a cross-module import between two dev
// modes, both worse than one cohesive "gpucompare" module. See the story's
// Programmer notes (docs/backlog.md US-048 row) for this call.
import {
  bindLevel, Camera, renderWorld, GpuCellPipeline, VoxelPool, World, repackMaterials, drawSprites, HFOV_DEG,
  buildLightSet, makeLightBuffer, applySceneFade, clearMaskForSceneFade, createSceneDim, resetSceneDim, applySceneDim,
  animComponent, ambientL, loadLevel, createClothSystem, forwardOf, rightOf, createWater, collectWaterDefs, resolveWaterLooks,
} from '../../../../engine/index.js';
import {
  runGpuCompare, compareCells, compareGeometry, compareLight, poisonAllCells, unpackReadback,
  classifyMigrationCells, MIGRATION_CATS, terrainMeshSetFor, beginFrame, castSectors, fillSky,
  computeDerivatives, shadeSurfaces, edgePass, pitchedEyeFromFocus, PROJ_PITCHED_VFOV_DEG, createShadowParityRunner,
} from '../../../../engine/dev.js';
import { POSES as GPU_COMPARE_POSES } from '../../../../content/dev-poses.js';
import { fillUnitGrid, placeholderTeamSpec } from '../unitsHarness.js'; // RE-06: instanced-units pose helpers
import { placeCompareSprites } from '../spriteDev.js'; // US-030c: the synthetic 3-prop set for non-`real` compare poses

export const name = 'gpucompare';

function noPipelineMsg(ctx) {
  const { gpuPipeline, rt, detailPass, matTable, overlay } = ctx;
  const msg = '[gpucompare] no active GpuCellPipeline (backend=' + rt.backend + ', detail=' + (detailPass ? 'on' : 'off') +
    ', allV2=' + matTable.allV2 + ') - nothing to compare.';
  console.error(msg);
  overlay.visible = true; overlay.el.style.display = 'block';
  overlay.el.textContent = msg;
  void gpuPipeline;
  return msg;
}

// `?gpucompare=shade` (US-029 AC "Parity page", tech notes item 7; US-030a
// 14.2 item 7 keeps this test-only mode: `pipeline.setSource('upload')`
// feeds the CPU-cast G-buffer into the same uint textures the DDA cast pass
// now writes, isolating the shading/edge passes from the DDA itself). Casts
// the same bench-cast.mjs pose set (content/dev-poses.js) against
// `test_room` on both paths and reports glyph/fg/bg parity. Shows PASS/FAIL
// on screen (the overlay) and in the console. Requires a working GPU
// pipeline - prints a clear message and does nothing else if one isn't active.
function runGpuCompareShadeMode(ctx) {
  const { gpuPipeline, rt, assets, matTable, detailPass, depthBuffer, openSpans, gbuf, overlay, GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR } = ctx;
  if (!gpuPipeline) { noPipelineMsg(ctx); return; }

  gpuPipeline.setSource('upload'); // 14.2 item 7: force the legacy CPU-fed G-buffer path for this test

  const level = loadLevel(assets.level('test_room'));
  bindLevel(matTable, level);
  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, light: ambientL, jsShade: shadeSurfaces, jsEdge: edgePass,
  };

  function castFrame(pose) {
    const cam = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    beginFrame(fbCompare);
    castSectors(fbCompare, level, cam, { x: 0, y: 0, z: 0 });
    computeDerivatives(fbCompare.gbuf, fbCompare.depth.depth);
    fillSky(fbCompare, cam);
    return cam;
  }

  const { rows, ok } = runGpuCompare(gpuPipeline, fbCompare, castFrame, GPU_COMPARE_POSES, null);

  // BUG-GPU-002 tooling fix: same fixed reference box as `?gpucompare=1`.
  const refScreenAspectShade = (rt.cols * rt.pxCellW) / (rt.rows * rt.pxCellH);
  console.log(`[gpucompare] ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px  aspect=${refScreenAspectShade.toFixed(4)}  fov=${HFOV_DEG} deg`);
  let text = `?gpucompare=shade  GpuCellPipeline: ${gpuPipeline.rendererString}\n` +
    `ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px` +
    `  aspect=${refScreenAspectShade.toFixed(4)}  fov=${HFOV_DEG} deg (fixed, window-independent)\n`;
  for (const r of rows) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  glyph match (non-edge): ${r.glyphMatchPct.toFixed(2)}%  edge cells excluded: ${r.edgeCells}\n` +
      `  fg outside +-4: ${r.fgOutside}  bg outside +-4: ${r.bgOutside}  fgMax ${r.fgMax} bgMax ${r.bgMax}\n` +
      `  depth match: ${r.depthMatchPct}%  mat==0 cells: ${r.matZeroCount}\n`;
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: glyph=${r.glyphMatchPct.toFixed(2)}% fgOut=${r.fgOutside} bgOut=${r.bgOutside} fgMax=${r.fgMax} bgMax=${r.bgMax}`);
  }
  text += `\n${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare] ${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows, ok };
}

// `?gpucompare=1` (US-030a AC "Parity: with N = 1 the GPU cast matches the
// JS caster"; docs/architecture.md 14.2 item 8): the DDA parity page. Runs
// at 160x60/n=1 (forced at bootstrap - see main.js's `isDdaCompare` block),
// casting `test_room` as a real `World` (so `renderWorld`'s `fb.gpuDda`
// branch is exercised exactly as gameplay uses it) through both paths from
// the same camera poses. ME-06 (27.15.5a item 6): the two worlds + fixed
// pose list `?gpucompare=1` and `?gpucompare=mesh` both need - factored out
// so a second GPU pipeline compare mode never has to keep a hand-copied
// pose list in sync with this one.
function buildCompareRuns(ctx) {
  const { assets, matTable, engine, lightsEnabled, sunEnabled, compareNearStep, rt } = ctx;
  function loadCompareWorld(def) {
    const w = World.load(def, assets, {});
    for (const s of w.structures) {
      if (s.kind === 'mesh') continue; // ME-14c1
      bindLevel(matTable, s.level);
      repackMaterials(s.packed, s.level, matTable); // US-030a: see the runGame('world') call site
    }
    return w;
  }
  const testRoom = loadCompareWorld(
    { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] },
  );
  if (compareNearStep) {
    const rec = globalThis.ASSETS && globalThis.ASSETS.levels && globalThis.ASSETS.levels.overworld_far;
    if (rec && rec.nearLOD && !rec.nearLOD.step) rec.nearLOD.step = { min: 0.5, k: 0.012 };
  }
  const worldM1 = loadCompareWorld(assets.world('world_m1'));
  if (worldM1.terrain) worldM1.terrain.bakeFarSync();
  const m1Player = worldM1.get('player').data;
  const m1Eye = Camera.fromEntity(m1Player, engine.physics.eyeHeight);
  const testRoomLights = lightsEnabled ? buildLightSet(testRoom, assets.palette) : null;
  const worldM1Lights = lightsEnabled ? buildLightSet(worldM1, assets.palette) : null;
  if (!sunEnabled) {
    if (testRoomLights) testRoomLights.setSun({ elevation: testRoomLights.sun.elevation, azimuth: testRoomLights.sun.azimuth, on: false });
    if (worldM1Lights) worldM1Lights.setSun({ elevation: worldM1Lights.sun.elevation, azimuth: worldM1Lights.sun.azimuth, on: false });
  }
  // ME-08b: waystone look poses, eye 2 m behind the old (inside-the-model) spot.
  const waystoneEye = (pitchDeg, yawNudge = 0) => {
    const yawDeg = 76, yr = yawDeg * Math.PI / 180;
    const x = 1428 - 2 * Math.sin(yr), y = 1040 + 2 * Math.cos(yr);
    return { x, y, z: (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0.53) + 1.6, yawDeg: yawDeg + yawNudge, pitchDeg };
  };
  const runs = [
    ...GPU_COMPARE_POSES.map((pose) => ({ world: testRoom, lights: testRoomLights, name: `test_room: ${pose.name || '(pose)'}`, cam: { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg } })),
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn (${m1Eye.x.toFixed(1)}, ${m1Eye.y.toFixed(1)}) yaw ${m1Eye.yawDeg} pitch ${m1Eye.pitchDeg}`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: BUG-OWN-001 owner repro (1500.69, 1027.36) yaw 236 pitch -29',
      cam: { x: 1500.69, y: 1027.36, z: 3.00 + engine.physics.eyeHeight, yawDeg: 236, pitchDeg: -29 } },
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn, sceneFade=0.5`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg }, fade: 0.5 },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: player spawn, card open (sceneDim 0.35 + plate 0.18)',
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg },
      dim: { all: 0.35, n: 1, rects: (() => { const r = new Float32Array(20); r.set([10, 4, 70, 26, 0.18]); return r; })() } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: crash room (burner + lamp + gondola + heap + rubble, near LOD)',
      cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: 5 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: lamp empty (post pickup)',
      cam: { x: 1497.5, y: 1027.0, z: engine.physics.eyeHeight, yawDeg: 15, pitchDeg: 10 }, real: true,
      before: () => { const h = worldM1.get('tower.lantern'); if (h) h.play('empty'); } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: lever mid-pull',
      cam: { x: 1498.25, y: 1027.3, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 60 }, real: true,
      before: () => { const h = worldM1.get('tower.lever'); if (h) { h.play('pull', { restart: true }); h.stop(); const c = animComponent(h.data); c.frame = 2; c.t = 45; } } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: boulder mid-roll',
      cam: { x: 1493.5, y: 1022.5, z: engine.physics.eyeHeight, yawDeg: 64.5, pitchDeg: -20 }, real: true,
      before: () => { const h = worldM1.get('tower.boulder'); if (h) animComponent(h.data).frame = 4; } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: relay at distance (half LOD)',
      cam: { x: 1497.0, y: 1027.5, z: engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -2 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: summit east (relay plinth, yaw 87.6)',
      cam: { x: 1489.0, y: 1025.0, z: 8.2, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breach looking back east (yaw 87.6)',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breach',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breachDown',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: -30 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: parapetSky',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 255, pitchDeg: 20 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: signal tower',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 255, pitchDeg: 2 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: terrainNearTower',
      cam: { x: 1470, y: 1025, z: 4.0, yawDeg: 270, pitchDeg: -10 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: bandEdge',
      cam: { x: 1470, y: 1025, z: 4.0, yawDeg: 270, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: waystoneLookBack',
      cam: waystoneEye(5), real: true, needK8: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: waystoneDown',
      cam: waystoneEye(-35), real: true, needK8: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: outsideNear (owner pose A)',
      cam: { x: 1464.33, y: 1045.50, z: 3.92, yawDeg: 54, pitchDeg: 19 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: outsideFar (owner pose B)',
      cam: { x: 1401.80, y: 1038.32, z: -0.78, yawDeg: 83, pitchDeg: 14 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: forestEdge (ME-06b background canopy face)',
      cam: { x: 1401.80, y: 1038.32, z: -0.78, yawDeg: 240, pitchDeg: 10 }, real: true },
  ];

  // US-078a: the view model's held sword (`voxelModels.swordHeld`) is not in ASSETS.models yet (game wiring = US-078d);
  // register a mesh-only copy for this harness so the pool packs it (kept out of the DDA atlas: existing poses unchanged).
  const swordHeldDef = globalThis.ASSETS && globalThis.ASSETS.voxelModels && globalThis.ASSETS.voxelModels.swordHeld;
  if (swordHeldDef && !assets.has('model', 'swordHeld')) assets.add('model', 'swordHeld', { ...swordHeldDef, voxel: { ...swordHeldDef.voxel, meshOnly: true } });
  const compareVoxelPool = new VoxelPool();
  compareVoxelPool.bind(assets, matTable);
  const LEVER_X = 1499.25, LEVER_Y = 1027.3, LEVER_Z = 3.0;
  const LANTERN_X = 1499.9, LANTERN_Y = 1024.5, LANTERN_Z = 1.3;
  runs.push(
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever wall 2 m',
      cam: { x: LEVER_X - 2.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 40 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever near (1 m)',
      cam: { x: LEVER_X - 1.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 60 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel half occluded (stair edge)',
      cam: { x: 1497.3, y: 1026.6, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 40 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel yaw 45',
      cam: { x: 1497.0, y: 1025.5, z: engine.physics.eyeHeight, yawDeg: 100.3, pitchDeg: 40 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 45) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lantern near',
      cam: { x: LANTERN_X - 1.5, y: LANTERN_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 5 },
      before: () => compareVoxelPool.pushInstance('lantern', LANTERN_X, LANTERN_Y, LANTERN_Z, 270) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever idle',
      cam: { x: LEVER_X - 1.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 60 },
      before: () => {
        const pm = compareVoxelPool.models.get('lever');
        const idleIdx = pm && pm.clipIndex.idle !== undefined ? pm.clipIndex.idle : -1;
        compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90, idleIdx, 0, 0);
      } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever mid-pull',
      cam: { x: LEVER_X - 1.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 60 },
      before: () => {
        const pm = compareVoxelPool.models.get('lever');
        const pullIdx = pm && pm.clipIndex.pull !== undefined ? pm.clipIndex.pull : -1;
        compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90, pullIdx, 2, 45);
      } },
    // "voxel over terrain" NOT added - see this story's Programmer notes
    // (pre-existing terrain/sun-visibility parity gap, not a voxel-pass bug).
  );

  // RE-02a (28.1 A2 item 8): mesh-only pitched poses, RTS view of the world_m1 hillside west of the tower.
  // Focus-driven eye exactly like `engine/core/rtsCamera.js` (dist = widthM * zoom / (2 tanHalfX), widthM 30),
  // vfov 36, yaw 20. Compared GPU vs the rasterJS + JS shade twin (same projection) - `?gpucompare=1` (dda) SKIPs them.
  const CULL_LOD_DX = 14; // RE-15c: grid shift east so ~half the units are off screen
  const rtsHillPose = (pitchDeg) => {
    const fx = 1440, fy = 1040, fz = worldM1.terrain ? worldM1.terrain.groundAt(fx, fy) : 0;
    const aspect = (rt.cols * (rt.pxCellW || 1)) / (rt.rows * (rt.pxCellH || 1));
    const tanHalfX = Math.tan((PROJ_PITCHED_VFOV_DEG * Math.PI) / 360) * aspect;
    const e = pitchedEyeFromFocus(fx, fy, fz, 20, pitchDeg, 30 / (2 * tanHalfX), [0, 0, 0]);
    return { x: e[0], y: e[1], z: e[2], yawDeg: 20, pitchDeg, vfovDeg: PROJ_PITCHED_VFOV_DEG, projection: 'pitched', focusX: fx, focusY: fy, focusZ: fz };
  };
  for (const pitch of [-55, -58, -60]) {
    runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: rtsHill${-pitch} (RE-02a pitched RTS view, hillside)`,
      cam: rtsHillPose(pitch), real: true, meshOnly: true });
  }
  // Extra (not in the 28.1 A2 list): a shallow -15 deg pitched pose so sky cells exist - covers the GLSL/JS
  // per-cell `screenRay` sky elevation and the fog scale at a large |b*sinP| (the RTS poses are 100 % ground).
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: rtsHillSky15 (RE-02a pitched, sky + fog scale)',
    cam: rtsHillPose(-15), real: true, meshOnly: true });

  // RE-07b (28.9 "Tests"): mesh-only overlay pose. Same pitched -58 RTS view as rtsHill58 but focused on the
  // signal tower so rings behind it fail the depth test: 30 rings (6x5 lattice, r 1 m), 30 bars, 1 screen rect.
  // The JS twin = rtsHill58-style CPU render + `overlay.renderCpu`; the GPU result is the GpuOverlayPass.
  const overlayOps = (ov) => {
    ov.setStyles({ ring: { glyphs: '-|\\/', fg: [255, 220, 60] }, barFill: { glyph: '=', fg: [80, 255, 80] },
      barEmpty: { glyph: '.', fg: [120, 120, 120] }, box: { glyphs: '-|++', fg: [255, 255, 255] } });
    const sRing = ov.styleId('ring'), sFill = ov.styleId('barFill'), sEmpty = ov.styleId('barEmpty'), sBox = ov.styleId('box');
    const g = worldM1.terrain ? (x, y) => worldM1.terrain.groundAt(x, y) : () => 0;
    ov.setGroundFn(g);
    let n = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++, n++) {
      const x = 1483.5 + 3 * i, y = 1020 + 3 * j;
      ov.ring(x, y, g(x, y), 1.0, sRing);
      ov.bar(x, y, g(x, y) + 2.5, n / 29, 5, sFill, sEmpty);
    }
    ov.rect(8, 6, 44, 22, sBox);
  };
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: rtsOverlay (RE-07b, pitched -58 at the tower, 30 rings + 30 bars + rect)',
    cam: (() => { const c = rtsHillPose(-58); const fx = 1492, fy = 1028, fz = worldM1.terrain ? worldM1.terrain.groundAt(fx, fy) : 0;
      const aspect = (rt.cols * (rt.pxCellW || 1)) / (rt.rows * (rt.pxCellH || 1));
      const tanHalfX = Math.tan((PROJ_PITCHED_VFOV_DEG * Math.PI) / 360) * aspect;
      const e = pitchedEyeFromFocus(fx, fy, fz, 20, -58, 30 / (2 * tanHalfX), [0, 0, 0]);
      return { ...c, x: e[0], y: e[1], z: e[2], focusX: fx, focusY: fy, focusZ: fz }; })(),
    real: true, meshOnly: true, overlayOps });

  // RE-06 (28.6 "Parity"): mesh-renderer-only pose. 20 instances of the 2-part lever (until the
  // designer's unit model exists), yaws {0, 90, 37.5, 200}, teams {0, 1, 2}, mid-animation pose,
  // in the test_room start area (floor z 0). The dda renderer has no instanced path: it SKIPs
  // the pose (not counted), so `?gpucompare=1` stays 34/34 and `renderer=mesh` becomes 35/35.
  const waterHomeM1 = worldM1.water; // US-055a2b: the `water` poses install a region set on worldM1; resetInstances puts the empty one back
  const compareInstances = engine.instances;
  compareInstances.bindPool(compareVoxelPool);
  const unitsGroup = compareInstances.group('lever', 20);
  const resetInstances = () => { for (const g of compareInstances.groups) g.count = 0; engine.viewModel.hide(); worldM1.cloths = clothHomeM1; testRoom.cloths = clothHomeTR; worldM1.water = waterHomeM1; };
  runs.push({
    world: testRoom, lights: testRoomLights, name: 'test_room: voxel units instanced (RE-06: 20 x lever, yaws 0/90/37.5/200, teams 0/1/2, mid-pull)',
    cam: { x: 2.5, y: 2.5, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: -12 }, meshOnly: true,
    before: () => {
      const pm = compareVoxelPool.models.get('lever');
      engine.setTeamMaterials(placeholderTeamSpec(matTable, pm));
      const pullIdx = pm && pm.clipIndex.pull !== undefined ? pm.clipIndex.pull : -1;
      unitsGroup.pose.clip = pullIdx; unitsGroup.pose.frame = 2; unitsGroup.pose.tMs = 45;
      fillUnitGrid(unitsGroup, 20, 4.5, 1.5, 0, 1.0, 4, null);
    },
  });

  // RE-15c (28.13 Parity): mesh-only `unitsCullLod` - pitched -58 RTS view of the hillside, 60 levers on a
  // 10 x 6 world-axis grid (spacing 4 m) shifted so about half are off screen, lodCells 8 with both LODs visible.
  // Asserts drawn + culled = 60 and lod1 > 0 (stats of the memoized frame), plus the standard `k8Gpu > 0` bar.
  const cullLodGroup = compareInstances.group('lever', 60);
  cullLodGroup.lodCells = 8;
  runs.push({
    world: worldM1, lights: worldM1Lights, real: true, meshOnly: true, instAssert: { total: 60 },
    name: 'world_m1: voxel units cull + LOD (unitsCullLod, RE-15c: 60 x lever, pitched -58, lodCells 8)',
    cam: rtsHillPose(-58),
    before: () => {
      const pm = compareVoxelPool.models.get('lever');
      engine.setTeamMaterials(placeholderTeamSpec(matTable, pm));
      cullLodGroup.pose.clip = -1; cullLodGroup.pose.frame = 0; cullLodGroup.pose.tMs = 0;
      const gz = (x, y) => (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0);
      fillUnitGrid(cullLodGroup, 60, 1440 + CULL_LOD_DX - 18, 1040 - 10, 0, 4.0, 10, gz);
    },
  });

  // RE-02b (28.1 A2 items 5, 8): mesh-only first-person poses on the DEFAULT projection (pitched on mesh; the
  // `pitchedDefault` flag keeps the shear pin below off them). fpLevel0 is additionally compared against the
  // same pose's shear JS twin (`anchorShear`): pitch 0 pitched == shear at the same bars.
  const fpRun = (name, cam, extra) => runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: ${name} (RE-02b first person, pitched default)`,
    cam, real: true, meshOnly: true, pitchedDefault: true, ...extra });
  fpRun('fpLevel0', { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: 0 }, { anchorShear: true });
  fpRun('fpUp30', { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 215, pitchDeg: 30 }); // interior, looks up at walls/ceiling
  fpRun('fpDown60', { x: 1470, y: 1025, z: 4.0, yawDeg: 270, pitchDeg: -60 });
  fpRun('fpTowerDown45', { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 40, pitchDeg: -45 });

  // ME-15c (27.9a item 11): sun-shadow parity poses (mesh-only; GPU light pass + shade vs the JS twin with the same
  // rasterJS depth-only map). With `&shadows=map` every pose above also runs the map; these pin sun az 135 el 30
  // (shadows fall NW) so the casters are long and obvious. Without `&shadows=map` they are plain mesh poses.
  const SUN_135_30 = { azimuth: 135, elevation: 30 };
  const groundZ = (x, y) => (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0);
  // signal tower shadow on terrain: eye 9 m above the grass 28 m NNW of the tower looking SE-down (into the sun), the shadow lies on the grass between
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: towerShadowGrass (ME-15c, signal tower shadow on terrain, sun az 135 el 30)',
    cam: { x: 1474, y: 1006, z: groundZ(1474, 1006) + 9.0, yawDeg: 137, pitchDeg: -17 }, real: true, meshOnly: true, sun: SUN_135_30 });
  // ED-SCALE-1a (34.2): per-instance scale - a lever at 2x and a lantern at 0.5x in one view (dda normal fix, mesh part matrices)
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: voxelScaled (ED-SCALE-1a, lever 2x + lantern 0.5x)',
    cam: { x: 1496.2, y: 1026.0, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 35 },
    before: () => {
      compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90, -1, 0, 0, 2);
      compareVoxelPool.pushInstance('lantern', LANTERN_X, LANTERN_Y, LANTERN_Z, 270, -1, 0, 0, 0.5);
    } });
  // voxel lever lit through the tower doorway, part in shadow (existing lever feet position)
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: leverSunShaft (ME-15c, voxel lever through a doorway, sun az 135 el 30)',
    cam: { x: LEVER_X - 2.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 40 }, meshOnly: true, sun: SUN_135_30,
    before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) });
  // crash room: burner (voxel prop) and gondola cast on the floor
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: burnerShadowFloor (ME-15c, crash room, burner shadow on the floor, sun az 135 el 30)',
    cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: -32 }, real: true, meshOnly: true, sun: SUN_135_30 });
  // pitched RTS hill, focus-centred box
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: rtsHill58Shadow (ME-15c, pitched RTS hillside, focus-centred sun box, sun az 135 el 30)',
    cam: rtsHillPose(-58), real: true, meshOnly: true, sun: SUN_135_30 });
  // first person at open terrain looking west: the box far edge (eye + 64 m + 96 m = 160 m ahead) lies inside the fog; no seam
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: fpBoxEdge (ME-15c, first person, sun box edge 160 m ahead, sun az 135 el 30)',
    cam: { x: 1464.33, y: 1045.5, z: groundZ(1464.33, 1045.5) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: -2 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30 });

  // CLOTH-1b2 (architecture.md 33.6): mesh-only `cloth` pose. A 16x12 banner (1.6 x 1.2 m, seed 1) built THROUGH the cloth
  // system (rest-spacing uv), 5 top pins, 120 scripted steps in a 6 m/s wind, then frozen (nothing ticks it again): both twins
  // draw the same frozen Float32 arrays, so parity is geometry only. Hangs in the open ~6 m ahead of the fpBoxEdge eye, turned
  // 35 deg so folds show both faces; sun az 135 el 30 (the sun-map pose). The system lives on worldM1 for this pose only
  // (`resetInstances` puts the empty system back before every pose).
  const clothHomeM1 = worldM1.cloths, clothHomeTR = testRoom.cloths;
  let clothSys = null;
  const buildClothPose = () => {
    if (clothSys) return clothSys;
    const eye = { x: 1464.33, y: 1045.5 }, f = forwardOf(270, [0, 0]), yaw = 305, rg = rightOf(yaw, [0, 0]), nm = forwardOf(yaw, [0, 0]);
    const cx = eye.x + f[0] * 6, cy = eye.y + f[1] * 6, W = 1.6;
    const gz = worldM1.terrain ? worldM1.terrain.groundAt(cx, cy) : 0;
    clothSys = createClothSystem([{ id: 'compare.banner', preset: 'banner', mat: 'canvas', cols: 16, rows: 12, size: [W, 1.2],
      origin: [cx - rg[0] * W / 2, cy - rg[1] * W / 2, gz + 2.8], yawDeg: yaw, plane: 'vertical', seed: 1,
      pins: [[0, 0], [3, 0], [7, 0], [11, 0], [15, 0]] }], { groundAt: (x, y) => (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0) }, null);
    const wx = 6 * (0.8 * nm[0] + 0.6 * rg[0]), wy = 6 * (0.8 * nm[1] + 0.6 * rg[1]);
    const wind = { sampleInto(x, y, z, tick, out) { out[0] = wx; out[1] = wy; out[2] = 0; } };
    for (let t = 0; t < 120; t++) { clothSys.markDrawn(0); clothSys.tick(t, wind, cx, cy, gz + 1.6); }
    return clothSys;
  };
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: cloth (CLOTH-1b2, 16x12 banner built through the system, 6 m/s wind x 120 steps then frozen, sun az 135 el 30)',
    cam: { x: 1464.33, y: 1045.5, z: groundZ(1464.33, 1045.5) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: -4 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30,
    before: () => { worldM1.cloths = buildClothPose(); } });

  // US-055a2b (architecture.md 35.10): mesh-only `water` poses - the water layer (055a2a) + the composite (055a2b), flat water (waves
  // are 143). A round pond (r 7 m, 0.9 m deep at the centre: shallow rim = floor glyph tinted, deep centre = ramp glyphs) on the open
  // terrain west of the fpBoxEdge eye, seen grazing (shear) and top-down (pitched default), plus a flooded plain ("sea", 1 m below the
  // eye, 800 x 700 m rect: clipmap rings + skirt + the own fog). Time is frozen (fb.timeSec 0 in both twins). Sun az 135 el 30.
  const waterEye = { x: 1464.33, y: 1045.5 };
  const poolC = { x: 1456, y: 1045.5 };
  const waterPose = (list) => () => { worldM1.water = createWater(collectWaterDefs({ water: list }, [])); };
  const pondSet = waterPose([{ id: 'cmp.pond', shape: 'circle', c: [poolC.x, poolC.y], r: 7, z: groundZ(poolC.x, poolC.y) + 0.9, look: 'water' }]);
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water pond grazing (US-055a2b, r 7 m, 0.9 m deep, shear pitch -6, sun az 135 el 30)',
    cam: { x: waterEye.x, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: -6 }, real: true, meshOnly: true, sun: SUN_135_30, before: pondSet });
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water pond top-down (US-055a2b, pitched default, pitch -75, sun az 135 el 30)',
    cam: { x: poolC.x + 1.5, y: poolC.y, z: groundZ(poolC.x, poolC.y) + 16, yawDeg: 270, pitchDeg: -75 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, before: pondSet });
  // 36.1b: exercise the designer pond and murky palettes as well as the default water look.
  for (const look of ['pond', 'murky']) {
    runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: water ${look} look top-down (36.1b, drift/glint)`,
      cam: { x: poolC.x + 1.5, y: poolC.y, z: groundZ(poolC.x, poolC.y) + 16, yawDeg: 270, pitchDeg: -75 },
      real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30,
      before: waterPose([{ id: `cmp.${look}`, shape: 'circle', c: [poolC.x, poolC.y], r: 7, z: groundZ(poolC.x, poolC.y) + 0.9, look }]) });
  }
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water sea (US-055a2b, flooded plain 1 m below the eye, shear pitch -3, sun az 135 el 30)',
    cam: { x: waterEye.x, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -3 }, real: true, meshOnly: true, sun: SUN_135_30,
    before: waterPose([{ id: 'cmp.sea', shape: 'rect', rect: [1100, 700, 1900, 1400], z: groundZ(waterEye.x, waterEye.y) - 1, look: 'water' }]) });

  // US-141a (architecture.md 35.4, 35.10): flowing water at a frozen clock (t = 10 s; the tick-600 pose of 35.10 once waves.js exists).
  // A 3 m wide river (flow 4 m/s along +x, 2 m/s in the slow reach) seen grazing, and a circular plunge-pool style pool (flowRadial 2)
  // from above. Same hash + table in both twins, so the streak glyphs must match cell for cell (modulo the f32 sample point).
  const riverC = { x: poolC.x, y: poolC.y };
  const riverSet = waterPose([
    { id: 'cmp.river', shape: 'rect', rect: [poolC.x - 14, poolC.y - 3, poolC.x + 14, poolC.y + 3], z: groundZ(poolC.x, poolC.y) + 0.9, look: 'water', flow: [4, 0] },
    { id: 'cmp.fast', shape: 'rect', rect: [poolC.x - 14, poolC.y + 3, poolC.x + 14, poolC.y + 9], z: groundZ(poolC.x, poolC.y) + 0.9, look: 'pond', flow: [-1, 0.6] },
  ]);
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water flowing river grazing (US-141a, flow 4 m/s + 1.2 m/s reach, t 10 s, shear pitch -6, sun az 135 el 30)',
    cam: { x: waterEye.x, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: -6 }, real: true, meshOnly: true, sun: SUN_135_30, timeSec: 10, before: riverSet });
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water flowing radial pool top-down (US-141a, flowRadial 2 + flow, t 10 s, pitched default, pitch -75, sun az 135 el 30)',
    cam: { x: riverC.x + 1.5, y: riverC.y, z: groundZ(riverC.x, riverC.y) + 16, yawDeg: 270, pitchDeg: -75 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, timeSec: 10,
    before: waterPose([{ id: 'cmp.radial', shape: 'circle', c: [poolC.x, poolC.y], r: 7, z: groundZ(poolC.x, poolC.y) + 0.9, look: 'water', flow: [1, 0], flowRadial: 2 }]) });

  // US-078a (architecture.md 30.1): view-model poses (mesh-only): the held sword in the tower interior (crash room), rest
  // (idle t=0) and swingLR t=160, at pitch 0 and +30 (the d*tanPitch term keeps the sword in the lower right at any pitch).
  // `resetInstances` hides the layer before every pose; `before` shows it.
  // These poses run under the SHEAR camera (the auto `projection: 'shear'` fill below, since none sets
  // `pitchedDefault`) - they never exercised the mesh renderer's own DEFAULT first-person camera (RE-02b/D-029's
  // "pitched" projection), which is exactly how BUG-VM-001 (the sword never drawing in normal play) got through
  // 53/53 mesh poses: the gate that hid the view model under a pitched camera was never hit by any pose here.
  if (globalThis.ASSETS && globalThis.ASSETS.viewModels && globalThis.ASSETS.viewModels.sword && compareVoxelPool.models.has('swordHeld')) {
    const vmLayer = engine.viewModel;
    const vmH = vmLayer.load('sword', globalThis.ASSETS.viewModels.sword, compareVoxelPool);
    for (const [clip, tMs, label] of [['idle', 0, 'rest'], ['swingLR', 160, 'swingLR t=160']]) {
      for (const pitch of [0, 30]) {
        runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: viewModel ${label} pitch ${pitch} (US-078a, held sword, crash room)`,
          cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: pitch }, real: true, meshOnly: true, needK8: true,
          before: () => { vmLayer.setBob(0, 0); vmLayer.show(vmH, vmLayer.clipId(vmH, clip), tMs, false); } });
      }
    }
    // BUG-VM-001 (architect decision 2026-10-03, item 5): the real regression test - the mesh renderer's own
    // DEFAULT first-person camera (`pitchedDefault: true`, no `cam.projection` override -> `resolveProjection`
    // falls to 'pitched' for renderer === 'mesh', same as `game/js/main.js`'s unmodified `cam`). `vmAssert: true`
    // asserts `engine.viewModel.stats.items > 0` on BOTH the GPU twin and the JS/mesh twin separately (captured
    // right after each twin runs, below) - not just that the two twins agree (agreeing on "both draw nothing"
    // is exactly the vacuous pass that let this bug ship).
    for (const pitch of [0, 20]) {
      runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: viewModel rest pitch ${pitch} PITCHED CAMERA (BUG-VM-001, held sword, crash room)`,
        cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: pitch }, real: true, meshOnly: true, needK8: true, pitchedDefault: true, vmAssert: true,
        before: () => { vmLayer.setBob(0, 0); vmLayer.show(vmH, vmLayer.clipId(vmH, 'idle'), 0, false); } });
    }
  }

  // US-053b (32.1): mesh-only `particles` pose - crash room (tower interior), a debug
  // emitter (rate 200, non-emissive so the per-emitter light term is exercised too),
  // seed 1 (engine.particles' own seed - `clear()` re-seeds it), stepped 120 times from
  // a fresh clear() and then frozen (never stepped again - the loop below clears
  // engine.particles again before every OTHER pose, so this is the only one with live
  // particles). Expect 0 mismatching cells (the existing compareCells bars already scan
  // every cell, particle-covered or not).
  if (engine.particles) {
    const debugDefId = engine.particles.defineEmitter('gpucompareDebug', {
      rate: 200, life: [1.2, 1.2], speed: [0.4, 1.2], spreadDeg: 25, box: [0.1, 0.1, 0.1],
      accelZ: 0.3, drag: 0.5, maxLive: 256, glyphs: '@Oo. ', colors: [[255, 160, 40], [220, 110, 30], [150, 70, 20], [60, 30, 10], [0, 0, 0]],
    });
    runs.push({
      world: worldM1, lights: worldM1Lights, name: 'world_m1: particles (US-053b, crash room, debug emitter rate 200, 120 steps then frozen)',
      cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: -32 }, real: true, meshOnly: true,
      before: () => {
        engine.particles.clear();
        const h = engine.particles.createEmitter(debugDefId, 1498.0, 1026.0, engine.physics.eyeHeight);
        engine.particles.setOn(h, true);
        for (let i = 0; i < 120; i++) engine.particles.step();
      },
    });
  }

  // Every pose that does not ask for a projection is a shear (dda-vs-mesh parity) pose until ME-19: pin it.
  for (const r of runs) if (!r.pitchedDefault && !r.cam.projection) r.cam = { ...r.cam, projection: 'shear' };

  return { testRoom, worldM1, m1Eye, testRoomLights, worldM1Lights, runs, compareVoxelPool, compareInstances, resetInstances };
}

/**
 * RE-07b: per touched overlay cell, "GPU shows the overlay" vs "JS twin shows it" (fg rgb + glyph equal to the layer).
 * Cells where the depth compare sits within 1e-3 * ref of the bias edge are boundary cells (excluded from mismatch).
 */
function compareOverlayCells(ov, twinFg, gpuFg, depth) {
  const r = { cells: ov.stats.cells, shownTwin: 0, shownGpu: 0, hidden: 0, mismatch: 0, boundary: 0, boundaryPct: 0 };
  for (let t = 0; t < ov.stats.cells; t++) {
    const i = ov.touched[t], f = i * 4;
    if (ov.ovl[f + 3] === 0) continue;
    let tw = true, gp = true;
    for (let k = 0; k < 3; k++) { if (twinFg[f + k] !== ov.ovl[f + k]) tw = false; if (gpuFg[f + k] !== ov.ovl[f + k]) gp = false; }
    if (twinFg[f + 3] !== ov.ovl[f + 3]) tw = false;
    if (gpuFg[f + 3] !== ov.ovl[f + 3]) gp = false;
    if (tw) r.shownTwin++;
    if (gp) r.shownGpu++;
    if (!tw) r.hidden++;
    if (tw !== gp) {
      const ref = ov.ovlZ[i], d = depth[i];
      const bias = Math.max(0.25, 0.01 * ref);
      if (Math.abs(ref - d - bias) < 1e-3 * ref) r.boundary++; else r.mismatch++;
    }
  }
  r.boundaryPct = r.cells ? (100 * r.boundary) / r.cells : 0;
  return r;
}

/**
 * ME-15c: temporarily points BOTH sun sources at `sun = {azimuth, elevation}` for one pose - the light set (the shadow
 * map + the light pass) and the first structure's `def.sun` (the terrain's analytic sun, `sunFromWorld`) - so a pose
 * can pin e.g. az 135 el 30. Returns the restore closure.
 */
function applySunOverride(world, lights, sun) {
  const s0 = world.structures && world.structures.find((q) => q.kind !== 'mesh');
  const def = s0 && s0.level && s0.level.def;
  const hadDef = def && 'sun' in def, oldDef = def ? def.sun : undefined;
  const old = lights ? { elevation: lights.sun.elevation, azimuth: lights.sun.azimuth, on: lights.sun.on } : null;
  if (def) def.sun = { ...(def.sun || {}), azimuth: sun.azimuth, elevation: sun.elevation };
  if (lights) lights.setSun({ elevation: sun.elevation, azimuth: sun.azimuth, on: true });
  return () => {
    if (def) { if (hadDef) def.sun = oldDef; else delete def.sun; }
    if (lights && old) lights.setSun(old);
  };
}

function runGpuCompareDdaMode(ctx) {
  const {
    gpuPipeline, rt, assets, matTable, detailPass, depthBuffer, openSpans, gbuf, overlay, sprites, engine,
    compareNoVoxels, renderer, terrainEnabled, rayParam, params, GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR, fadeLut,
  } = ctx;
  if (!gpuPipeline) { noPipelineMsg(ctx); return; }
  if (rt.cols !== 160 || rt.rows !== 60) {
    console.warn(`[gpucompare] expected 160x60 for ?gpucompare=1, got ${rt.cols}x${rt.rows} - the grid-forcing block at the top of main.js may have been bypassed.`);
  }

  gpuPipeline.setSource('dda');

  const { testRoom, worldM1, m1Eye, testRoomLights, worldM1Lights, runs, compareVoxelPool, compareInstances, resetInstances } = buildCompareRuns(ctx);
  gpuPipeline.bindVoxels(compareVoxelPool);
  gpuPipeline.bindInstances(compareInstances);
  gpuPipeline.bindViewModel(engine.viewModel); // US-078a
  void m1Eye; void testRoomLights; void worldM1Lights;
  // US-053b (32.1): registers engine.particleLayer with the GPU sprite pass
  // (a one-time/boot call, like bindVoxels/bindInstances above). Harmless
  // for every pose that never touches engine.particles - the layer stays
  // empty, so its textures read all-zero and the shader's particle branch
  // never fires (requirement: pre-053b poses byte-for-byte unchanged).
  if (sprites.pass && sprites.pass.bindParticleLayer) sprites.pass.bindParticleLayer(engine.particleLayer);

  if (params.get('roundtrip') === '1') {
    engine.setGrid(480, 180, { immediate: true });
    const p0 = GPU_COMPARE_POSES[0];
    gpuPipeline.frame({ rt }, ambientL, { x: p0.x, y: p0.y, z: p0.z, yawDeg: p0.yawDeg, pitchDeg: p0.pitchDeg }, testRoom);
    rt.present();
    engine.setGrid(160, 60, { immediate: true });
    for (const s of testRoom.structures) { bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }
  }

  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    lights: null, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpuDda: false,
    renderer, terrainEnabled,
    fadeLut, sceneFade: 1,
    voxelPool: compareVoxelPool,
    instances: compareInstances,
    waterLooks: resolveWaterLooks(window.ASSETS.waterLooks), // same designer table as the bound GPU pipeline
    viewModel: engine.viewModel, // US-078a: both twins draw the layer when a pose shows it
    // ME-15c: the JS twin renders the same sun shadow map as the GPU pass whenever the pipeline runs sun 'map'.
    shadowOpts: renderer === 'mesh' && gpuPipeline.shadowOpts && gpuPipeline.shadowOpts.sun === 'map' ? gpuPipeline.shadowOpts : null,
    // RE-15a fixes (28.13 point 4, PC-B Q7 item 1): host-owned "rendered frame" counter,
    // bumped once per pose below, before both twins (GPU + JS) run for that pose - replaces
    // the two independent per-caller counters compositor.js/GpuCellPipeline.js used to keep.
    frameNo: 0,
  };
  const compareSceneDim = createSceneDim();

  const cols = rt.cols, rows = rt.rows, n = cols * rows;

  const rowsOut = [];
  let overallOk = true;
  let sampledOwnTextures = true;
  // ME-15b (27.9a item 10): sun shadow depth parity rows (GPU map vs rasterJS depth-only twin), mesh renderer only.
  const shadowRows = [];
  const shadowRunner = renderer === 'mesh' && gpuPipeline.shadowOpts && gpuPipeline.shadowOpts.sun === 'map'
    ? createShadowParityRunner(gpuPipeline.shadowOpts.res) : null;
  let restoreSun = null; // ME-15c: per-pose sun override (see applySunOverride)
  // `&pose=<text>` (US-055a2b): run only the poses whose name contains <text> (case-insensitive); the last one stays on the canvas = an owner look,
  // e.g. `?gpucompare=1&renderer=mesh&pose=water pond`. No filter = every pose.
  const poseQ = (params.get('pose') || '').toLowerCase();
  const poseRuns = poseQ ? runs.filter((r) => r.name.toLowerCase().includes(poseQ)) : runs;
  for (const { world, lights, name: poseName, cam, fade, dim, real, before, needK8, meshOnly, overlayOps, anchorShear, pitchedDefault, sun: sunOverride, instAssert, vmAssert, timeSec: poseTime } of poseRuns) {
    if (restoreSun) { restoreSun(); restoreSun = null; }
    if (meshOnly && renderer !== 'mesh') { console.log(`[gpucompare] SKIP ${poseName} (mesh renderer only)`); continue; }
    if (sunOverride) restoreSun = applySunOverride(world, lights, sunOverride);
    // US-053b (32.1): cleared before EVERY pose (not just the ones that never touch
    // particles) - only the `particles` pose's own `before()` hook repopulates it, so a
    // pose that runs after it never inherits stray live particles from a previous pose.
    if (engine.particles) engine.particles.clear();
    resetInstances();
    if (world.terrain) while (terrainMeshSetFor(world.terrain).step(1000));
    if (real) {
      if (before) before();
      compareVoxelPool.collect(world, cam);
    } else {
      compareVoxelPool.beginFrame();
      if (before) before();
    }
    if (compareNoVoxels) compareVoxelPool.beginFrame();
    compareVoxelPool.project(cam, rt, renderer);
    resetSceneDim(compareSceneDim);
    if (dim) {
      compareSceneDim.all = dim.all;
      compareSceneDim.n = dim.n;
      compareSceneDim.rects.set(dim.rects.subarray(0, dim.n * 5));
    }
    fbCompare.sceneDim = compareSceneDim;
    fbCompare.timeSec = poseTime || 0; // US-141a: frozen per-pose clock (flow streaks); 0 for every other pose
    fbCompare.lights = lights;
    if (lights) lights.update(0, world);
    fbCompare.sceneFade = typeof fade === 'number' ? fade : 1;
    if (sprites.pass) {
      sprites.pass.sceneFade = fbCompare.sceneFade;
      sprites.pass.setFadeLut(fadeLut);
      sprites.pass.setSceneDim(compareSceneDim);
    }
    if (real) sprites.pool.collect(world);
    else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
    sprites.pool.project(cam, rt, lights || ambientL, world, renderer);
    // US-053b (32.1): particle layer, built once per pose from the current (just-cleared-
    // or-just-populated) engine.particles state - both twins below read the SAME layer.
    if (engine.particleLayer) engine.particleLayer.build(engine.particles, cam, rt, lights || ambientL, world, assets.palette, renderer);

    engine.overlay.clear(); // RE-07b: per-pose ops (none for the old poses -> pass skipped)
    if (overlayOps) overlayOps(engine.overlay);
    poisonAllCells(rt.cells, n);
    fbCompare.frameNo++; // RE-15a fixes: once per pose, before both twins run (see fbCompare init above)
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam);
    gpuPipeline.frame(fbCompare, lights || ambientL, cam, world);
    engine.overlay.flush(cam); // GPU path: JS raster, GpuOverlayPass composites inside present()
    rt.present(); // the GPU twin's actual raster work (rt's registered cell-pass hook -> `_hook` -> `_prepRaster`'s
    // `buildList` call) runs INSIDE this call, not inside `gpuPipeline.frame()` above (which only stashes cam/world
    // refs) - `engine.viewModel.stats` is ONE shared object both twins write through, so this must be captured
    // right here, after `present()`, before the JS/mesh twin below overwrites it (BUG-VM-001 item 5).
    const vmItemsGpu = engine.viewModel ? engine.viewModel.stats.items : 0;
    const rb = rt.readbackPresent();
    sampledOwnTextures = sampledOwnTextures && rb.sampledOwnTextures;
    const gpuFg = rb.fg, gpuBg = rb.bg;
    const { GI, GA, Depth } = gpuPipeline.readbackGeometry();
    const lightBuf = gpuPipeline.readbackLight();
    if (shadowRunner) {
      const sd = shadowRunner.run(gpuPipeline);
      if (sd) {
        shadowRows.push({ pose: `${poseName} [shadow depth parity]`, ok: sd.pass, shadowDepth: sd });
        console.log(`[gpucompare] shadowDepth ${sd.pass ? 'PASS' : 'FAIL'} ${poseName}: items=${sd.items} both=${sd.both} slopeAwareWithin=${sd.withinPct.toFixed(4)}%(>=99.9) flat16=${sd.within16Pct.toFixed(3)}% maxUlp=${sd.maxUlp} covMismatch=${sd.covMismatchPct.toFixed(4)}%(<=0.3, union ${sd.covMismatchUnionPct.toFixed(3)}%) gpuOnly=${sd.gpuOnly} jsOnly=${sd.jsOnly} outside16: le64=${sd.hist.le64} le1024=${sd.hist.le1024} big=${sd.hist.big} ratioHist(<=.02/.05/.1/.25/1/>1 texel)=${sd.ratioHist}`);
      } else {
        console.log(`[gpucompare] shadowDepth SKIP ${poseName} (no sun pass this pose)`);
      }
    }

    const wasActive = rt.gpuActive;
    rt.gpuActive = false;
    fbCompare.gpuDda = false;
    renderWorld(fbCompare, world, cam);
    // BUG-VM-001 (item 5): the JS/mesh twin's own `buildList` call (compositor.js's `renderWorldMesh`), right
    // after `renderWorld` above runs it - before anything else touches `engine.viewModel.stats`.
    const vmItemsJs = engine.viewModel ? engine.viewModel.stats.items : 0;
    drawSprites(fbCompare, sprites.pool, engine.particleLayer);
    if (fbCompare.fadeLut && typeof fbCompare.sceneFade === 'number') {
      clearMaskForSceneFade(fbCompare.rt);
      applySceneFade(fbCompare.rt, fbCompare.sceneFade, fbCompare.fadeLut);
    }
    applySceneDim(fbCompare.rt, compareSceneDim);
    rt.gpuActive = wasActive;
    let ovlRes = null;
    if (overlayOps) { // JS twin composite, then per-overlay-cell GPU-vs-twin check (28.9 bar)
      engine.overlay.renderCpu(cam, rt.cells, depthBuffer.depth);
      ovlRes = compareOverlayCells(engine.overlay, rt.cells.fg, gpuFg, depthBuffer.depth);
      console.log(`[gpucompare] rtsOverlay: cells=${ovlRes.cells} shownTwin=${ovlRes.shownTwin} shownGpu=${ovlRes.shownGpu} hidden=${ovlRes.hidden} mismatch=${ovlRes.mismatch} boundary=${ovlRes.boundary} (${ovlRes.boundaryPct.toFixed(3)}% , <=0.5%)`);
      // pass timer (async GpuTimer ring): repeat the composite so p50/p95 fill in (NaN if the timer extension is missing)
      for (let k = 0; k < 140; k++) rt.present();
      const ps = rt.overlayPassStats; ovlRes.gpuMsP50 = ps ? ps.gpuMsP50 : NaN; ovlRes.gpuMsP95 = ps ? ps.gpuMsP95 : NaN;
      console.log(`[gpucompare] rtsOverlay pass ms: p50=${ovlRes.gpuMsP50} p95=${ovlRes.gpuMsP95} uploadRows=${ps ? ps.rows : -1}`);
    }

    const cmpCells = compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.005);
    const cmpGeom = compareGeometry(gbuf, depthBuffer.depth, GI, GA, Depth, cols, rows);
    const cmpLight = compareLight(fbCompare.light, lightBuf, gbuf.kind, cols, rows);
    const isVoxelPose = poseName.includes('voxel');
    const k8Ok = !(isVoxelPose || needK8) || compareNoVoxels || (cmpGeom.k8Cpu > 0 && cmpGeom.k8Gpu > 0);
    const geomViol = cmpGeom.depthViol + cmpGeom.uvViol + cmpGeom.aoViol + cmpGeom.zViol + cmpGeom.faceViol + cmpGeom.nrmViol;
    const cmpCellsMesh = renderer === 'mesh' ? compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.01, 96, true) : null;
    const geomBaseOk = cmpGeom.kindMatchPct >= 99.5 && cmpGeom.holes === 0;
    const meshColourOk = renderer === 'mesh' && geomBaseOk && cmpGeom.geomViolCells <= 4 && cmpGeom.violNonK8 === 0 && cmpGeom.aoViol === 0 &&
      cmpCells.glyphMatchPct >= 99.5 && cmpCells.poisonedSurvivors === 0 && cmpCellsMesh.pass;
    if (renderer === 'mesh') console.log(`[gpucompare] mesh8a ${poseName}: geomViol=${geomViol} geomViolCells=${cmpGeom.geomViolCells} violNonK8=${cmpGeom.violNonK8} k8ColourOutliers=${cmpCellsMesh.k8Outside} fgMaxNonK8=${cmpCellsMesh.fgMaxNonK8}`);
    const ovlOk = !ovlRes || (ovlRes.mismatch === 0 && ovlRes.boundaryPct <= 0.5 && ovlRes.hidden > 0 && ovlRes.shownGpu > 0);
    // BUG-RTS-001 (architecture.md 28.11, architect 2026-09-30): pitched poses (pitchedHashCell > 0) have a
    // 0.25 m terrain look-hash; GPU float32 u/v vs the JS double twin flip a few boundary cells, so fgMax is
    // reported but not gated there: outside <= 0.5 %, glyph >= 99.9 %, bgMax <= 64. Shear/dda poses unchanged.
    const pitchedHashOk = renderer === 'mesh' && cam && (cam.projection === 'pitched' || pitchedDefault) && geomBaseOk &&
      cmpCells.outsideFrac <= 0.005 && cmpCells.glyphMatchPct >= 99.9 && cmpCells.bgMax <= 64 && cmpCells.poisonedSurvivors === 0;
    // RE-02b b3 anchor: the same pose's shear JS twin vs the pitched GPU output, same mesh bars.
    let anchorOk = true;
    if (anchorShear && renderer === 'mesh') {
      const shearCam = { ...cam, projection: 'shear' };
      compareVoxelPool.project(shearCam, rt, renderer);
      rt.gpuActive = false; fbCompare.gpuDda = false;
      renderWorld(fbCompare, world, shearCam);
      drawSprites(fbCompare, sprites.pool);
      rt.gpuActive = wasActive;
      const cmpA = compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.01, 96, true);
      anchorOk = cmpA.pass && cmpA.glyphMatchPct >= 99;
      console.log(`[gpucompare] anchor ${poseName}: pitched GPU vs shear twin pass=${cmpA.pass} glyph=${cmpA.glyphMatchPct.toFixed(2)}% fgMaxNonK8=${cmpA.fgMaxNonK8} k8Outside=${cmpA.k8Outside}`);
    }
    let instOk = true, instNote = '';
    if (instAssert) { // RE-15c: drawn + culled = total, LOD1 bucket used (cull+LOD both exercised)
      const st = engine.instances.stats;
      instOk = st.instances + st.instancesCulled === instAssert.total && st.instancesCulled > 0 && st.instancesLod1 > 0 && st.instances > st.instancesLod1;
      instNote = `[drawn ${st.instances} culled ${st.instancesCulled} lod1 ${st.instancesLod1}]`;
      console.log(`[gpucompare] instances ${poseName}: drawn=${st.instances} culled=${st.instancesCulled} lod1=${st.instancesLod1} total=${instAssert.total} ${instOk ? 'OK' : 'FAIL'}`);
    }
    // BUG-VM-001 (item 5): the real visibility regression test - both twins must have built a non-empty view-model
    // draw list for this pitched pose (not just "both agree", which is also true when both wrongly draw nothing).
    let vmOk = true;
    if (vmAssert) {
      vmOk = vmItemsGpu > 0 && vmItemsJs > 0;
      console.log(`[gpucompare] viewModel ${poseName}: itemsGpu=${vmItemsGpu} itemsJs=${vmItemsJs} ${vmOk ? 'OK' : 'FAIL'}`);
    }
    const ok = (cmpCells.pass || meshColourOk || pitchedHashOk) && (cmpGeom.pass || meshColourOk) && cmpLight.pass && k8Ok && ovlOk && anchorOk && instOk && vmOk;
    overallOk = overallOk && ok;
    rowsOut.push({ pose: instNote ? `${poseName} ${instNote}` : poseName, cmpCells, cmpGeom, cmpLight, ok, isVoxelPose, k8Ok, ...(ovlRes ? { overlay: ovlRes } : {}), mesh8a: renderer === 'mesh' ? { geomViol, geomViolCells: cmpGeom.geomViolCells, violNonK8: cmpGeom.violNonK8, k8Outside: cmpCellsMesh.k8Outside, fgMaxNonK8: cmpCellsMesh.fgMaxNonK8 } : null, ...(vmAssert ? { vmItemsGpu, vmItemsJs, vmOk } : {}) });
  }
  if (restoreSun) { restoreSun(); restoreSun = null; }
  overallOk = overallOk && sampledOwnTextures;
  for (const r of shadowRows) overallOk = overallOk && r.ok;
  fbCompare.sceneFade = 1;
  if (sprites.pass) sprites.pass.sceneFade = 1;
  resetSceneDim(compareSceneDim);
  if (sprites.pass) sprites.pass.setSceneDim(compareSceneDim);

  let infoRows = null;
  if (rayParam === 2) {
    const pipeline2 = new GpuCellPipeline(rt, { rays: 2 });
    if (pipeline2.ready) {
      pipeline2.bind(matTable, assets.palette);
      pipeline2.setSource('dda');
      infoRows = [];
      resetInstances();
      for (const { world, lights, name: poseName, cam, real, before, meshOnly } of runs) {
        if (meshOnly) continue;
        if (real) {
          if (before) before();
          compareVoxelPool.collect(world, cam);
        } else {
          compareVoxelPool.beginFrame();
          if (before) before();
        }
        compareVoxelPool.project(cam, rt);
        fbCompare.lights = lights;
        if (lights) lights.update(0, world);
        if (real) sprites.pool.collect(world);
        else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
        sprites.pool.project(cam, rt, lights || ambientL, world);

        poisonAllCells(rt.cells, n);
        fbCompare.gpuDda = true;
        renderWorld(fbCompare, world, cam);
        pipeline2.frame(fbCompare, lights || ambientL, cam, world);
        rt.present();
        const rb2 = rt.readbackPresent();
        const { GI: GI2, GA: GA2, Depth: Depth2 } = pipeline2.readbackGeometry();

        const wasActive2 = rt.gpuActive;
        rt.gpuActive = false;
        fbCompare.gpuDda = false;
        renderWorld(fbCompare, world, cam);
        drawSprites(fbCompare, sprites.pool);
        rt.gpuActive = wasActive2;

        const cmpCells2 = compareCells(rt.cells.fg, rt.cells.bg, rb2.fg, rb2.bg, gbuf.kind, cols, rows, undefined, undefined, 0.005);
        const cmpGeom2 = compareGeometry(gbuf, depthBuffer.depth, GI2, GA2, Depth2, cols, rows);
        infoRows.push({ pose: poseName, cmpCells: cmpCells2, cmpGeom: cmpGeom2, kindOk: cmpGeom2.kindMatchPct >= 99.5 });
        console.log(`[gpucompare] INFO n=2 ${poseName}: kind=${cmpGeom2.kindMatchPct.toFixed(2)}%(>=99.5% required) glyph=${cmpCells2.glyphMatchPct.toFixed(2)}%(reported only) holes=${cmpGeom2.holes}`);
      }
    } else {
      console.warn('[gpucompare] ?rays=2 informational row requested but the second GpuCellPipeline failed to compile - skipped.');
    }
  }

  const refScreenAspect = (cols * rt.pxCellW) / (rows * rt.pxCellH);
  console.log(`[gpucompare] ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px  aspect=${refScreenAspect.toFixed(4)}  fov=${HFOV_DEG} deg`);
  let text = `?gpucompare=1  GpuCellPipeline: ${gpuPipeline.rendererString}  grid: ${cols}x${rows}  rays: 1` +
    `  readback: present() units 0/1${sampledOwnTextures ? '' : '  (NOT rt.fgTex/bgTex - present() wiring bug)'}\n` +
    `ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px` +
    `  aspect=${refScreenAspect.toFixed(4)}  fov=${HFOV_DEG} deg (fixed, window-independent)\n`;
  for (const r of rowsOut) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  geometry: kind ${r.cmpGeom.kindMatchPct.toFixed(2)}%  matEq ${r.cmpGeom.matEqual}/${r.cmpGeom.matched}  planeEq ${r.cmpGeom.planeEqual}/${r.cmpGeom.matched}` +
      `  depthViol ${r.cmpGeom.depthViol}  uvViol ${r.cmpGeom.uvViol}  holes ${r.cmpGeom.holes} (must be 0)` +
      `  edgeKindMismatch ${r.cmpGeom.edgeKindMismatch}/${r.cmpGeom.edgeCells}\n` +
      (r.mesh8a ? `  mesh8a: geomViol ${r.mesh8a.geomViol}  geomViolCells ${r.mesh8a.geomViolCells}  violNonK8 ${r.mesh8a.violNonK8}  k8 colour outliers ${r.mesh8a.k8Outside}  fgMaxNonK8 ${r.mesh8a.fgMaxNonK8}
` : '') +
      `  k8 cpu ${r.cmpGeom.k8Cpu}  gpu ${r.cmpGeom.k8Gpu}${r.isVoxelPose ? (r.k8Ok ? ' (both > 0, OK)' : ' (must both be > 0 on a voxel pose - FAIL)') : ''}\n` +
      `  shading: glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}%  fgOut ${r.cmpCells.fgOutside}  bgOut ${r.cmpCells.bgOutside}` +
      `  outside ${(r.cmpCells.outsideFrac * 100).toFixed(3)}% (<=0.5%, ${r.cmpCells.cellsOutside} cells)  fgMax ${r.cmpCells.fgMax}  bgMax ${r.cmpCells.bgMax} (<=64)  poisonedSurvivors ${r.cmpCells.poisonedSurvivors}\n` +
      `  light: ${r.cmpLight.pass ? 'OK' : 'MISMATCH'}  sunlit ${(r.cmpLight.sunlitMismatchFrac * 100).toFixed(3)}% (<=0.5%, ${r.cmpLight.sunlitMismatch}/${r.cmpLight.sunMap ? r.cmpLight.litCells + ' lit' : r.cmpLight.nonSky})  dLMax ${r.cmpLight.dLMax.toFixed(4)}  dLViol ${r.cmpLight.dLViol} (<=1e-3/chan)` +
      (r.cmpLight.sunMap ? `  [sun map] boundary ${r.cmpLight.boundaryCells} (${(r.cmpLight.boundaryFrac * 100).toFixed(2)}%)  n mismatch ${r.cmpLight.nMismatch} (${(r.cmpLight.nMismatchFrac * 100).toFixed(3)}%, <=1%)` : '') + '\n';
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: kind=${r.cmpGeom.kindMatchPct.toFixed(2)}% glyph=${r.cmpCells.glyphMatchPct.toFixed(2)}% holes=${r.cmpGeom.holes} edgeKindMismatch=${r.cmpGeom.edgeKindMismatch}/${r.cmpGeom.edgeCells} k8cpu=${r.cmpGeom.k8Cpu} k8gpu=${r.cmpGeom.k8Gpu} kindExclK8=${r.cmpGeom.kindMatchPctExclK8.toFixed(2)}% holesExclK8=${r.cmpGeom.holesExclK8} poisonedSurvivors=${r.cmpCells.poisonedSurvivors} light=${r.cmpLight.pass ? 'OK' : 'MISMATCH'}(sunlit ${r.cmpLight.sunlitMismatch}, dLViol ${r.cmpLight.dLViol}, litFlip ${r.cmpLight.litFlip}${r.cmpLight.sunMap ? `, sunMap lit=${r.cmpLight.litCells} sunlitFrac=${(r.cmpLight.sunlitMismatchFrac * 100).toFixed(3)}% boundary=${r.cmpLight.boundaryCells} nMismatch=${r.cmpLight.nMismatch}(${(r.cmpLight.nMismatchFrac * 100).toFixed(3)}%)` : ''})`);
  }
  for (const r of shadowRows) {
    const d = r.shadowDepth;
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n  items ${d.items}  co-covered ${d.both}  within 16 ULP+0.05 texel ${d.withinPct.toFixed(4)}% (>=99.9%)  flat 16 ULP ${d.within16Pct.toFixed(3)}%  maxUlp ${d.maxUlp}  coverage mismatch ${d.covMismatchPct.toFixed(4)}% (<=0.3%)\n`;
  }
  text += `\n${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare] ${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  if (infoRows) {
    text += `\n\n--- INFO ONLY: n=2 coverage-vote resolve (?rays=2, does not affect ALL PASS/FAILURES above) ---\n`;
    for (const r of infoRows) {
      text += `${r.kindOk ? 'OK' : 'FAIL'}  ${r.pose}\n` +
        `  geometry: kind ${r.cmpGeom.kindMatchPct.toFixed(2)}% (must stay >=99.5%)  holes ${r.cmpGeom.holes}\n` +
        `  shading: glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}% (reported, not gated)\n`;
    }
  }

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows: rowsOut.concat(shadowRows), ok: overallOk, infoRows };
}

// Diff-PNG painter for `?gpucompare=mesh`: 3 panels (dda fg, mesh fg,
// category map), 4x8 px per cell, 2 px gaps. One canvas/ImageData per page run.
function makeDiffPngPainter(cols, rows) {
  const DIFF_CAT_RGB = [null, [255, 0, 255], [0, 255, 255], [255, 0, 0], [255, 255, 0], [255, 140, 0]];
  const CW = 4, CH = 8, GAP = 2;
  const w = cols * CW * 3 + GAP * 2, h = rows * CH;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx2d = canvas.getContext('2d');
  const img = ctx2d.createImageData(w, h);
  return function paint(ddaFg, meshFg, cat) {
    const d = img.data;
    d.fill(0);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x, fi = i * 4, c = cat[i];
        const ov = DIFF_CAT_RGB[c];
        for (let p = 0; p < 3; p++) {
          let r, g, b;
          if (p === 0) { r = ddaFg[fi]; g = ddaFg[fi + 1]; b = ddaFg[fi + 2]; }
          else if (p === 1) { r = meshFg[fi]; g = meshFg[fi + 1]; b = meshFg[fi + 2]; }
          else if (ov) { r = ov[0]; g = ov[1]; b = ov[2]; }
          else { r = ddaFg[fi] >> 2; g = ddaFg[fi + 1] >> 2; b = ddaFg[fi + 2] >> 2; }
          const x0 = p * (cols * CW + GAP) + x * CW;
          for (let yy = 0; yy < CH; yy++) {
            let o = ((y * CH + yy) * w + x0) * 4;
            for (let xx = 0; xx < CW; xx++, o += 4) { d[o] = r; d[o + 1] = g; d[o + 2] = b; }
          }
        }
      }
    }
    ctx2d.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };
}

function runGpuCompareMeshMode(ctx) {
  const { gpuPipeline, rt, assets, matTable, detailPass, depthBuffer, openSpans, gbuf, overlay, terrainEnabled, compareNoVoxels } = ctx;
  if (!gpuPipeline) { noPipelineMsg(ctx); return; }
  if (rt.cols !== 160 || rt.rows !== 60) {
    console.warn(`[gpucompare] expected 160x60 for ?gpucompare=mesh, got ${rt.cols}x${rt.rows} - the grid-forcing block at the top of main.js may have been bypassed.`);
  }

  const pipelineDda = new GpuCellPipeline(rt, { rays: 1, terrainEnabled, renderer: 'dda' });
  const pipelineMesh = new GpuCellPipeline(rt, { rays: 1, terrainEnabled, renderer: 'mesh', shadows: { sun: 'dda' } }); // ME-15c: dda-vs-mesh pins the sun DDA
  if (!pipelineDda.ready || !pipelineMesh.ready) {
    const msg = `[gpucompare] mesh-migration pipelines failed to compile (dda ready=${pipelineDda.ready}, mesh ready=${pipelineMesh.ready}) - nothing to compare.`;
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }
  pipelineDda.bind(matTable, assets.palette);
  pipelineMesh.bind(matTable, assets.palette);
  pipelineDda.setSource('dda');
  pipelineMesh.setSource('dda');

  const { m1Eye, testRoomLights, worldM1Lights, runs, compareVoxelPool } = buildCompareRuns(ctx);
  pipelineDda.bindVoxels(compareVoxelPool);
  pipelineMesh.bindVoxels(compareVoxelPool);
  void m1Eye; void testRoomLights; void worldM1Lights;

  const cols = rt.cols, rows = rt.rows;
  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    lights: null, light: makeLightBuffer(cols, rows), timeSec: 0, gpuDda: true, terrainEnabled,
    voxelPool: compareVoxelPool,
  };

  const rbDdaFg = new Uint8Array(cols * rows * 4), rbDdaBg = new Uint8Array(cols * rows * 4);
  const rowsOut = [];
  let overallOk = true;
  const paintDiff = makeDiffPngPainter(cols, rows);
  for (const { world, lights, name: poseName, cam, real, before, meshOnly } of runs) {
    if (meshOnly) continue; // RE-06: the dda pipeline has no instanced path
    if (world.terrain) while (terrainMeshSetFor(world.terrain).step(1000));
    if (real) {
      if (before) before();
      compareVoxelPool.collect(world, cam);
    } else {
      compareVoxelPool.beginFrame();
      if (before) before();
    }
    if (compareNoVoxels) compareVoxelPool.beginFrame();
    fbCompare.lights = lights;
    if (lights) lights.update(0, world);

    compareVoxelPool.project(cam, rt, 'dda');
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam);
    pipelineDda.setEnabled(true);
    pipelineDda.frame(fbCompare, lights || ambientL, cam, world);
    rt.present();
    const rbDda = rt.readbackPresent(rbDdaFg, rbDdaBg);
    const { GI: giDda, GA: gaDda, Depth: depthDda } = pipelineDda.readbackGeometry();

    compareVoxelPool.project(cam, rt, 'mesh');
    pipelineMesh.setEnabled(true);
    pipelineMesh.frame(fbCompare, lights || ambientL, cam, world);
    rt.present();
    const rbMesh = rt.readbackPresent();
    const { GI: giMesh, GA: gaMesh, Depth: depthMesh } = pipelineMesh.readbackGeometry();

    const ddaSide = unpackReadback(giDda, gaDda, depthDda, cols, rows);
    const cmpGeom = compareGeometry(ddaSide, ddaSide.depth, giMesh, gaMesh, depthMesh, cols, rows);
    const cmpCells = compareCells(rbDda.fg, rbDda.bg, rbMesh.fg, rbMesh.bg, ddaSide.kind, cols, rows, undefined, ddaSide.mat, 0.02);

    const kindOk = cmpGeom.kindMatchPct >= 98;
    const glyphOk = cmpCells.glyphMatchPct >= 97;
    const ok = kindOk && glyphOk;
    overallOk = overallOk && ok;
    const meshKind = new Uint8Array(cols * rows);
    for (let i = 0; i < meshKind.length; i++) meshKind[i] = giMesh[i * 4 + 1] & 0xff;
    const mig = classifyMigrationCells(ddaSide.kind, meshKind, rbDda.fg, rbDda.bg, rbMesh.fg, rbMesh.bg, cols * rows);
    const diffCats = { counts: mig.counts, pct: {} };
    for (const k of MIGRATION_CATS) diffCats.pct[k] = +mig.pct[k].toFixed(3);
    const diffPng = paintDiff(rbDda.fg, rbMesh.fg, mig.cat);
    rowsOut.push({ pose: poseName, ok, cmpGeom, cmpCells, diffCats, diffPng });
    const catStr = MIGRATION_CATS.slice(1).map((k) => `${k}=${diffCats.pct[k].toFixed(2)}%`).join(' ');
    console.log(`[gpucompare=mesh] diffCats ${poseName}: ${catStr}`);
    console.log(`[gpucompare=mesh] ${ok ? 'PASS' : 'FAIL'} ${poseName}: kind=${cmpGeom.kindMatchPct.toFixed(2)}% kindExclK8=${cmpGeom.kindMatchPctExclK8.toFixed(2)}% glyph=${cmpCells.glyphMatchPct.toFixed(2)}%(>=97%) holes=${cmpGeom.holes} holesExclK8=${cmpGeom.holesExclK8} k8dda=${cmpGeom.k8Cpu} k8mesh=${cmpGeom.k8Gpu} depthViol=${cmpGeom.depthViol} uvViol=${cmpGeom.uvViol}`);
  }

  let text = `?gpucompare=mesh  dda: ${pipelineDda.rendererString}  mesh: ${pipelineMesh.rendererString}  grid: ${cols}x${rows}\n`;
  for (const r of rowsOut) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  kind ${r.cmpGeom.kindMatchPct.toFixed(2)}%(raw) ${r.cmpGeom.kindMatchPctExclK8.toFixed(2)}%(excl. voxel, >=98% required)  glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}%(>=97% required)\n` +
      `  holes ${r.cmpGeom.holes} (${r.cmpGeom.holesExclK8} excl. voxel)  k8 dda ${r.cmpGeom.k8Cpu} mesh ${r.cmpGeom.k8Gpu}  depthViol ${r.cmpGeom.depthViol}  uvViol ${r.cmpGeom.uvViol}\n`;
  }
  text += `\n${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare=mesh] ${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows: rowsOut, ok: overallOk };
}

export function run(ctx) {
  const mode = ctx.params.get('gpucompare');
  if (mode === '1') runGpuCompareDdaMode(ctx);
  else if (mode === 'shade') runGpuCompareShadeMode(ctx);
  else if (mode === 'mesh') runGpuCompareMeshMode(ctx);
}
