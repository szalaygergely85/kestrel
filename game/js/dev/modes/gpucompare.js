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
  animComponent, ambientL, loadLevel,
} from '../../../../engine/index.js';
import {
  runGpuCompare, compareCells, compareGeometry, compareLight, poisonAllCells, unpackReadback,
  classifyMigrationCells, MIGRATION_CATS, terrainMeshSetFor, beginFrame, castSectors, fillSky,
  computeDerivatives, shadeSurfaces, edgePass, pitchedEyeFromFocus, PROJ_PITCHED_VFOV_DEG,
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

  // RE-06 (28.6 "Parity"): mesh-renderer-only pose. 20 instances of the 2-part lever (until the
  // designer's unit model exists), yaws {0, 90, 37.5, 200}, teams {0, 1, 2}, mid-animation pose,
  // in the test_room start area (floor z 0). The dda renderer has no instanced path: it SKIPs
  // the pose (not counted), so `?gpucompare=1` stays 34/34 and `renderer=mesh` becomes 35/35.
  const compareInstances = engine.instances;
  compareInstances.bindPool(compareVoxelPool);
  const unitsGroup = compareInstances.group('lever', 20);
  const resetInstances = () => { for (const g of compareInstances.groups) g.count = 0; };
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

  return { testRoom, worldM1, m1Eye, testRoomLights, worldM1Lights, runs, compareVoxelPool, compareInstances, resetInstances };
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
  void m1Eye; void testRoomLights; void worldM1Lights;

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
  };
  const compareSceneDim = createSceneDim();

  const cols = rt.cols, rows = rt.rows, n = cols * rows;

  const rowsOut = [];
  let overallOk = true;
  let sampledOwnTextures = true;
  for (const { world, lights, name: poseName, cam, fade, dim, real, before, needK8, meshOnly } of runs) {
    if (meshOnly && renderer !== 'mesh') { console.log(`[gpucompare] SKIP ${poseName} (mesh renderer only)`); continue; }
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
    compareVoxelPool.project(cam, rt);
    resetSceneDim(compareSceneDim);
    if (dim) {
      compareSceneDim.all = dim.all;
      compareSceneDim.n = dim.n;
      compareSceneDim.rects.set(dim.rects.subarray(0, dim.n * 5));
    }
    fbCompare.sceneDim = compareSceneDim;
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
    sprites.pool.project(cam, rt, lights || ambientL, world);

    poisonAllCells(rt.cells, n);
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam);
    gpuPipeline.frame(fbCompare, lights || ambientL, cam, world);
    rt.present();
    const rb = rt.readbackPresent();
    sampledOwnTextures = sampledOwnTextures && rb.sampledOwnTextures;
    const gpuFg = rb.fg, gpuBg = rb.bg;
    const { GI, GA, Depth } = gpuPipeline.readbackGeometry();
    const lightBuf = gpuPipeline.readbackLight();

    const wasActive = rt.gpuActive;
    rt.gpuActive = false;
    fbCompare.gpuDda = false;
    renderWorld(fbCompare, world, cam);
    drawSprites(fbCompare, sprites.pool);
    if (fbCompare.fadeLut && typeof fbCompare.sceneFade === 'number') {
      clearMaskForSceneFade(fbCompare.rt);
      applySceneFade(fbCompare.rt, fbCompare.sceneFade, fbCompare.fadeLut);
    }
    applySceneDim(fbCompare.rt, compareSceneDim);
    rt.gpuActive = wasActive;

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
    const ok = (cmpCells.pass || meshColourOk) && (cmpGeom.pass || meshColourOk) && cmpLight.pass && k8Ok;
    overallOk = overallOk && ok;
    rowsOut.push({ pose: poseName, cmpCells, cmpGeom, cmpLight, ok, isVoxelPose, k8Ok, mesh8a: renderer === 'mesh' ? { geomViol, geomViolCells: cmpGeom.geomViolCells, violNonK8: cmpGeom.violNonK8, k8Outside: cmpCellsMesh.k8Outside, fgMaxNonK8: cmpCellsMesh.fgMaxNonK8 } : null });
  }
  overallOk = overallOk && sampledOwnTextures;
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
      `  light: ${r.cmpLight.pass ? 'OK' : 'MISMATCH'}  sunlit ${(r.cmpLight.sunlitMismatchFrac * 100).toFixed(3)}% (<=0.5%, ${r.cmpLight.sunlitMismatch}/${r.cmpLight.nonSky})  dLMax ${r.cmpLight.dLMax.toFixed(4)}  dLViol ${r.cmpLight.dLViol} (<=1e-3/chan)\n`;
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: kind=${r.cmpGeom.kindMatchPct.toFixed(2)}% glyph=${r.cmpCells.glyphMatchPct.toFixed(2)}% holes=${r.cmpGeom.holes} edgeKindMismatch=${r.cmpGeom.edgeKindMismatch}/${r.cmpGeom.edgeCells} k8cpu=${r.cmpGeom.k8Cpu} k8gpu=${r.cmpGeom.k8Gpu} kindExclK8=${r.cmpGeom.kindMatchPctExclK8.toFixed(2)}% holesExclK8=${r.cmpGeom.holesExclK8} poisonedSurvivors=${r.cmpCells.poisonedSurvivors} light=${r.cmpLight.pass ? 'OK' : 'MISMATCH'}(sunlit ${r.cmpLight.sunlitMismatch}, dLViol ${r.cmpLight.dLViol}, litFlip ${r.cmpLight.litFlip})`);
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
  window.__gpuCompare = { rows: rowsOut, ok: overallOk, infoRows };
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
  const pipelineMesh = new GpuCellPipeline(rt, { rays: 1, terrainEnabled, renderer: 'mesh' });
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

    compareVoxelPool.project(cam, rt);
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam);
    pipelineDda.setEnabled(true);
    pipelineDda.frame(fbCompare, lights || ambientL, cam, world);
    rt.present();
    const rbDda = rt.readbackPresent(rbDdaFg, rbDdaBg);
    const { GI: giDda, GA: gaDda, Depth: depthDda } = pipelineDda.readbackGeometry();

    compareVoxelPool.project(cam, rt);
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
