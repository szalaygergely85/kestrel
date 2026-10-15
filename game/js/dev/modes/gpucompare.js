import {
  bindLevel, Camera, renderWorld, VoxelPool, World, repackMaterials, drawSprites, HFOV_DEG,
  meshFromJSON, meshFromBin, composeCharacter, meshCharacter, collapseRig, riggedModelDef, buildMeshFromTris, MaskAtlas, buildMaskAtlas, writeUnitInstance, buildLightSet, createLightBuffer, applySceneFade, clearMaskForSceneFade, createSceneDim, resetSceneDim, applySceneDim, setWorldSun,
  bindDecals, drawDecals, hexToRgb, ambientL, loadLevel, createClothSystem, forwardOf, rightOf, createWater, collectWaterDefs, createWaterfalls, collectWaterfallDefs, resolveWaterLooks, sunPathFrom, applySunPair, blendLook, createAtmosState, mixAtmos, applyAtmosToPalette, gradeCells, createPostState, composePost, postCells,
  bakeImpostor, enableGroupImpostor, resolveGroupLod1, createInstanceBuffer,
  createRipples, defineWadeSplash, wadeSplashAt, validateCarpetConfig, createUnderState, pitchedEyeFromFocus, PROJ_PITCHED_VFOV_DEG,
} from '../../../../engine/index.js';
import {
  runGpuCompare, compareCells, meshCellCap, compareGeometry, compareLight, describeCellNormals, poisonAllCells, unpackReadback,
  terrainMeshSetFor, runStableRow, compareGlow, emisFromPacked,
  computeDerivatives, shadeSurfaces, edgePass, createShadowParityRunner,
} from '../../../../engine/dev.js';
import { quadruped16, makeRowGI } from '../../../../engine/dev.js'; // VOX-PARTS-16b: 12-part fixture for the `vox12` row
import { POSES as GPU_COMPARE_POSES, GATE_POSES } from '../../../../content/dev-poses.js';
import { fillUnitGrid, placeholderTeamSpec } from '../unitsHarness.js'; // RE-06: instanced-units pose helpers
import { groundLookFromParams } from '../../look/groundLookConfig.js'; // ENV-02d-LIVE
import { placeCompareSprites } from '../spriteDev.js'; // US-030c: the synthetic 3-prop set for non-`real` compare poses

export const name = 'gpucompare';

function noPipelineMsg(ctx) {
  const { rt, detailPass, matTable, overlay } = ctx;
  const msg = '[gpucompare] no active wgPipeline (backend=' + rt.backend + ', detail=' + (detailPass ? 'on' : 'off') +
    ', allV2=' + matTable.allV2 + ') - nothing to compare.';
  console.error(msg);
  overlay.visible = true; overlay.el.style.display = 'block';
  overlay.el.textContent = msg;
  return msg;
}

// `?gpucompare=shade` (US-029 AC "Parity page", tech notes item 7; US-030a
// 14.2 item 7 keeps this test-only mode: `pipeline.setSource('upload')`
// feeds the mesh JS G-buffer into the same uint textures, isolating
// shading/edge parity from raster precision). Uses the shared pose set against
// `test_room` on both paths and reports glyph/fg/bg parity. Shows PASS/FAIL
// on screen (the overlay) and in the console. Requires a working GPU
// pipeline - prints a clear message and does nothing else if one isn't active.
async function runGpuCompareShadeMode(ctx) {
  const { wgPipeline, rt, assets, matTable, detailPass, depthBuffer, gbuf, overlay, GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR } = ctx;
  const gpuPipeline = wgPipeline && wgPipeline.ready ? wgPipeline : null; // WG-3c: the WebGPU pipeline runs this mode too (cells via readbackCells)
  if (!gpuPipeline) { noPipelineMsg(ctx); return; }

  gpuPipeline.setSource('upload'); // 14.2 item 7: force the legacy CPU-fed G-buffer path for this test

  const level = loadLevel(assets.level('test_room'));
  bindLevel(matTable, level);
  gpuPipeline.bind(matTable, assets.palette); // WebGPU: re-pack the shade data textures for the materials bindLevel just added
  const compareWorld = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  const fbCompare = {
    rt, depth: depthBuffer, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, light: ambientL, jsShade: shadeSurfaces, jsEdge: edgePass,
  };

  const sceneFb = { ...fbCompare, renderer: 'mesh', light: createLightBuffer(rt.cols, rt.rows) };

  function castFrame(pose) {
    const cam = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    renderWorld(sceneFb, compareWorld, cam);
    return cam;
  }

  const { rows, ok } = await runGpuCompare(gpuPipeline, fbCompare, castFrame, GPU_COMPARE_POSES, null);

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
// casting `test_room` as a real `World` (so `renderWorld`'s `fb.gpu`
// branch is exercised exactly as gameplay uses it) through both paths from
// the same camera poses. ME-06 (27.15.5a item 6): the two worlds + fixed
// pose list `?gpucompare=1` and `?gpucompare=mesh` both need - factored out
// so a second GPU pipeline compare mode never has to keep a hand-copied
// pose list in sync with this one.
function buildCompareRuns(ctx) {
  const { assets, matTable, engine, lightsEnabled, sunEnabled, compareNearStep, rt, params } = ctx;
  // ART-01a (architecture.md 37.18 item 2): `?look=<key>` also honoured on the
  // compare page - set the active look before the buildLightSet calls below, so
  // every parity row (and the terrain sun) resolves the same look the real page
  // would. Load-time only, idempotent with main.js's own block.
  const lookParam = params.get('look');
  if (lookParam && assets.palette && assets.palette.timeOfDay) {
    if (assets.palette.timeOfDay[lookParam]) assets.palette.defaultTime = lookParam;
    else console.warn(`[look] ?look=${lookParam} is not a timeOfDay key - using "${assets.palette.defaultTime}"`);
  }
  function loadCompareWorld(def, opts = {}) {
    const w = World.load(def, assets, opts);
    w.maskAtlas = buildMaskAtlas(assets); // TREES-DEFAULT-01: same per-world atlas as engine.loadWorld (mesh trees + the berry bush are masked meshes)
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
  // EMIS-03/04: `?gpucompare=emissive` runs ONLY this pose (tower crown from 15 m west, 24 emissive cells in view - the interior brazier is a sprite, hidden in this mode; glow gate is material-only, so time of day does not matter for parity).
  const emisParam = ctx.params.get('emispose') || '1485,1025,6,90,20', emisNum = emisParam.split(',').map(Number); // `emispose=<slug>` or `x,y,z,yaw,pitch` (dev)
  const emisPose = emisNum.length === 5 && emisNum.every(Number.isFinite) ? { x: emisNum[0], y: emisNum[1], z: emisNum[2], yawDeg: emisNum[3], pitchDeg: emisNum[4] } : (GATE_POSES.find((g) => g.slug === emisParam) || {}).cam;
  const runs = [
    ...GPU_COMPARE_POSES.map((pose) => ({ world: testRoom, lights: testRoomLights, name: `test_room: ${pose.name || '(pose)'}`, cam: { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg } })),
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn (${m1Eye.x.toFixed(1)}, ${m1Eye.y.toFixed(1)}) yaw ${m1Eye.yawDeg} pitch ${m1Eye.pitchDeg}`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: BUG-OWN-001 owner repro (1500.69, 1027.36) yaw 236 pitch -29',
      cam: { x: 1500.69, y: 1027.36, z: 3.00 + engine.physics.eyeHeight, yawDeg: 236, pitchDeg: -29 } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: BUG-WHITE-PIXELS-01 repro (1500.58, 1022.77) yaw 185 pitch -24',
      cam: { x: 1500.58, y: 1022.77, z: 1.80 + engine.physics.eyeHeight, yawDeg: 185, pitchDeg: -24 } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: BUG-WHITE-PIXELS-02 owner pose (1500.70, 1027.88) yaw 329 pitch -24',
      cam: { x: 1500.70, y: 1027.88, z: 3.00 + engine.physics.eyeHeight, yawDeg: 329, pitchDeg: -24 } },
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn, sceneFade=0.5`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg }, fade: 0.5 },
    // ENV-03c: biome atmosphere rows (fixed driver weights, no driver; pose.atmos = { w: [per entry], tod: [day, dusk, night] }): fog + haze + sprite grade
    ...[['atmosForestDay', 12, { w: [1, 0, 0], tod: [1, 0, 0] }], ['atmosMeadowDusk', 18, { w: [0, 1, 0], tod: [0, 1, 0] }], ['atmosBorderNight', 23, { w: [0, 0.5, 0.5], tod: [0, 0, 1] }]].map(([n, hour, atmos]) => (
      { world: worldM1, lights: worldM1Lights, name: `world_m1: ${n} (ENV-03c biome atmosphere)`, hour, atmos,
        cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } })),
    // POST-STACK-01b (38.73 section 5): per-cell finish chain rows (pose.post = PostConfig; pose.atmos on top = composed grade). Bloom = the existing glow pass (`?gpucompare=emissive`, 01c wires it), not a row here.
    ...[['postVignette', 12, null, { vignette: { k: 0.45, r0: 0.4, r1: 0.95, rgb: [0.02, 0.02, 0.05] } }],
      ['postGradeOverAtmos', 12, { w: [1, 0, 0], tod: [1, 0, 0] }, { grade: { lift: [0.01, 0, 0.01], gamma: [1.05, 1, 0.95], gain: [1.02, 1, 0.98], sat: 1.1 } }],
      ['postMistInterior', 12, null, { mist: { rgb: [0.55, 0.6, 0.7], density: 0.03, start: 4, heightK: 0 } }],
      ['postAllHigh', 18, { w: [0, 1, 0], tod: [0, 1, 0] }, { grade: { lift: [0.01, 0, 0.01], gamma: [1.05, 1, 0.95], gain: [1.02, 1, 0.98], sat: 1.1 }, vignette: { k: 0.45, r0: 0.4, r1: 0.95, rgb: [0.02, 0.02, 0.05] }, mist: { rgb: [0.55, 0.6, 0.7], density: 0.03, start: 4, heightK: 0 } }]].map(([n, hour, atmos, post]) => (
      { world: worldM1, lights: worldM1Lights, name: `world_m1: ${n} (POST-STACK-01b finish chain)`, hour, atmos: atmos || undefined, post,
        cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } })),
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: player spawn, card open (sceneDim 0.35 + plate 0.18)',
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg },
      dim: { all: 0.35, n: 1, rects: (() => { const r = new Float32Array(20); r.set([10, 4, 70, 26, 0.18]); return r; })() } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: crash room (burner + lamp + gondola + heap + rubble, near LOD)',
      cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: 5 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: lamp empty (post pickup)',
      cam: { x: 1497.5, y: 1027.0, z: engine.physics.eyeHeight, yawDeg: 15, pitchDeg: 10 }, real: true,
      before: () => { const h = worldM1.get('tower.lantern'); if (h) h.play('empty'); } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: upper stair landing (TOWER-LEVER-01, always open)',
      cam: { x: 1499.5, y: 1027.8, z: 4.6, yawDeg: 280, pitchDeg: -10 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: relay at distance (half LOD)',
      cam: { x: 1497.0, y: 1027.5, z: engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -2 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: roadBend (WS1-08 road bend, relay waystone, yaw 270)',
      cam: { x: 1268, y: 1040, z: -29.79 + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: 0 }, real: true }, // floorAt(1268,1040) = -29.79 (absolute z)
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: summit east (relay plinth, yaw 87.6)',
      cam: { x: 1489.0, y: 1025.0, z: 8.2, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breach looking back east (yaw 87.6)',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: ob053Heap (OB-053 depth tiers: envelopeHeap voxel prop on the tower floor, yaw 104 pitch -24)',
      cam: { x: 1481.85, y: 1024.30, z: 2.40, yawDeg: 104, pitchDeg: -24 }, real: true },
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
    // BUG-MESH-MISSING-01: owner eyes (F3 feet z + eye height); trees/props missing without the B2 cap fix.
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: ownerTreesA (1446.63, 1024.64) yaw 227 pitch 1',
      cam: { x: 1446.63, y: 1024.64, z: 2.02 + engine.physics.eyeHeight, yawDeg: 227, pitchDeg: 1 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: ownerTreesB (1448.31, 1026.52) yaw 229 pitch 3',
      cam: { x: 1448.31, y: 1026.52, z: 2.08 + engine.physics.eyeHeight, yawDeg: 229, pitchDeg: 3 }, real: true },
    // MAP-06b (38.42): meadowSkyline - far peaks (fog cap z > fromZ) west/north, the sea line + 6 km sea skirt south-west (seaFogMax)
    ...[[270, 'west fells'], [0, 'north whitecombs'], [235, 'south-west sea line']].map(([yawDeg, what]) => ({ world: worldM1, lights: worldM1Lights,
      name: `world_m1: meadowSkyline yaw ${yawDeg} (${what})`,
      cam: { x: 1460, y: 1030, z: (worldM1.terrain ? worldM1.terrain.groundAt(1460, 1030) : 0) + engine.physics.eyeHeight, yawDeg, pitchDeg: 0 }, real: true })),
    // OB-104b2 (38.55): cliffNotch - the Glasswater outlet notch wall (steep faces N.z < 0.5 shade as rock, cliffType uniform); JS == GPU
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: cliffNotch (OB-104b2 cliff rock, 1237, 606 yaw 0 pitch 2)',
      cam: { x: 1237, y: 606, z: (worldM1.terrain ? worldM1.terrain.groundAt(1237, 606) : 0) + engine.physics.eyeHeight, yawDeg: 0, pitchDeg: 2 }, real: true },
  ];

  // DN-04b (38.39): frozen dusk 19.5 h and night 23 h rows (world_m1). Lit Bend lamps (rsLamp1/2 at 1280,1052 / 1246,1053.5) and the tower, so the
  // point lights, the moon switch (night), the live sky LUT and the night floor all run through the same JS-vs-GPU parity as the 8 h rows.
  for (const [hour, tag] of [[19.5, 'dusk 19.5 h'], [23, 'night 23 h']]) {
    for (const [what, x, y, yawDeg, pitchDeg] of [['Bend lamps', 1268, 1040, 135, -2], ['tower', 1470, 1025, 90, 8]]) {
      runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: ${tag} ${what} (DN-04b)`, hour,
        cam: { x, y, z: (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0) + engine.physics.eyeHeight, yawDeg, pitchDeg }, real: true });
    }
  }

  // GI-PROBE-05 (arch 38.72 item 6): 4 rows with the baked-GI path on (light + terrain shade read lights.gi); every other row runs with gi null = unchanged.
  // Hour is pinned like the DN-04b rows; the field is analytic (makeRowGI) until the baked .gi.bin files exist. Command (do not run on PC-B): see docs/lanes/pc-b2.md GI-PROBE-05.
  {
    const gz = (x, y) => (worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0), eh = engine.physics.eyeHeight;
    for (const [n, hour, x, y, yawDeg, pitchDeg, gi] of [
      ['giMeadowNoon', 12, 1470, 1035, 235, -12, { }],
      ['giForestDusk', 18.5, 1268, 1040, 135, -2, { }],
      ['giRuinInterior', 12, 1470, 1025, 90, 8, { room: [1470, 1025, 14] }],
      ['giEmisNight', 23, 1268, 1040, 135, -2, { lamps: [1268, 1052, 18], emisK: 1.6 }],
    ]) {
      runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: ${n} (GI-PROBE-05 baked bounce light)`, hour, gi: { ...gi, groundAt: gz },
        cam: { x, y, z: gz(x, y) + eh, yawDeg, pitchDeg }, real: true });
    }
  }

  // US-078a: the view model's held sword (`voxelModels.swordHeld`) is not in ASSETS.models yet (game wiring = US-078d);
  // register a mesh-only copy for this harness so the pool packs it (kept out of the DDA atlas: existing poses unchanged).
  const swordHeldDef = globalThis.ASSETS && globalThis.ASSETS.voxelModels && globalThis.ASSETS.voxelModels.swordHeld;
  if (swordHeldDef && !assets.has('model', 'swordHeld')) assets.add('model', 'swordHeld', { ...swordHeldDef, voxel: { ...swordHeldDef.voxel, meshOnly: true } });
  // HANDS-01c: the spell glove (`voxelModels.spellHandL`, authored left), same mesh-only registration (pose `handsSwapped` below).
  const spellHandLDef = globalThis.ASSETS && globalThis.ASSETS.voxelModels && globalThis.ASSETS.voxelModels.spellHandL;
  if (spellHandLDef && !assets.has('model', 'spellHandL')) assets.add('model', 'spellHandL', { ...spellHandLDef, voxel: { ...spellHandLDef.voxel, meshOnly: true } });
  // RIG-GC-01 (38.32 item 8): the chargen default character (fixed recipe, no randomness) through composeCharacter -> meshCharacter ->
  // collapseRig -> riggedModelDef, registered as `char.gc` before the pool binds (mesh-only rigged voxel model).
  try {
    const gcKit = ctx.gcKit; // fetched in the async scene-mode entry
    assets.add('model', 'char.gc', riggedModelDef(collapseRig(meshCharacter(composeCharacter(gcKit, gcKit.defaults)), gcKit.partMap)));
  } catch (e) { console.warn('[gpucompare] char.gc not built:', e && e.message); }
  // VOX-PARTS-16b (38.67 section 1): `vox12` registers the 12-part fixture (meshOnly, mats remapped to palette keys) with a `splay` clip
  // that rotates the lower-leg parts 8..11 by 30-60 deg, so the 4th part bit (flat0 bit 17) is set on every vertex of parts 8..11.
  try {
    const q16 = JSON.parse(JSON.stringify(quadruped16));
    q16.mats = { '#': 'wood', 'o': 'wood_cut', 'e': 'iron_light' }; // ENV-GATEFIX: real material keys (woodLight/ironLight are palette colours, fastShade threw)
    q16.animations.splay = { fps: 1, loop: true, frames: [{ legFL2: { rot: [30, 0, 0] }, legFR2: { rot: [45, 0, 0] }, legBL2: { rot: [60, 0, 0] }, legBR2: { rot: [-40, 0, 0] } }] };
    assets.add('model', 'vox12', { voxel: q16 });
  } catch (e) { console.warn('[gpucompare] vox12 not registered:', e && e.message); }
  const compareVoxelPool = new VoxelPool();
  compareVoxelPool.renderer = ctx.renderer;
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

  // VOX-PARTS-16b: 12-part mesh-only instances (parts 8..11 posed), ~2 m from the camera, sun shadow pose (az 135 el 30).
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: vox12 (VOX-PARTS-16b, 12-part voxel model, lower legs 30-60 deg, sun az 135 el 30)',
    cam: { x: LANTERN_X - 2.0, y: LANTERN_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 20 }, meshOnly: true, sun: { azimuth: 135, elevation: 30 },
    before: () => {
      const pm = compareVoxelPool.models.get('vox12');
      const ci = pm && pm.clipIndex.splay !== undefined ? pm.clipIndex.splay : -1;
      compareVoxelPool.pushInstance('vox12', LANTERN_X - 0.2, LANTERN_Y, LANTERN_Z, 90, ci, 0, 0);
      compareVoxelPool.pushInstance('vox12', LANTERN_X + 0.4, LANTERN_Y + 1.2, LANTERN_Z, 200, ci, 0, 0);
    } });

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

  // OB-073-D2e part 2 (38.52 + pitched amendment): the grass carpet ON, a PITCHED perspective first-person pose on the meadow south of the tower.
  // `carpet: true`: before() installs a minimal 1-variant meadow carpet on worldM1 (World._rebuildCarpet = the real class-map build) and hands it to the
  // WebGPU pipeline; the loop below removes it again before the next pose. Gate: kind-10 cell agreement >= 98 %, colour within the usual bars.
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: carpetMeadow (OB-073-D2e, pitched first person at (1470, 1035) over grass, carpet ON)',
    cam: { x: 1470, y: 1035, z: (worldM1.terrain ? worldM1.terrain.groundAt(1470, 1035) : 0) + engine.physics.eyeHeight, yawDeg: 235, pitchDeg: -12 }, real: true, meshOnly: true, pitchedDefault: true, carpet: true,
    before: () => {
      const tr = worldM1.terrain;
      worldM1._carpetCtx = { cfg: validateCarpetConfig({ seed: 11, radiusM: 12, variants: [
        { name: 'meadow', ground: tr.typeNames.filter((n) => n.startsWith('grass')), density: 0.9, heightM: [0.15, 0.28], ramp: [[10, 40, 10], [60, 160, 40], [180, 230, 90]] },
      ] }, tr.typeNames), recipe: tr.recipe };
      worldM1._rebuildCarpet();
    } });

  // OB-121b: carpetNear - same minimal meadow carpet as carpetMeadow but with the near underlay (carpet.underlay 0.6 -> fgP.x = 1.6, grass colour under the
  // tufts, also inside the 40 m close band) and a steeper pitch -35 so most of the frame is near ground. Gate = the usual pitched bars.
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: carpetNear (OB-121b underlay 0.6, pitched -35 first person at (1470, 1035) over grass, carpet ON)',
    cam: { x: 1470, y: 1035, z: (worldM1.terrain ? worldM1.terrain.groundAt(1470, 1035) : 0) + engine.physics.eyeHeight, yawDeg: 235, pitchDeg: -35 }, real: true, meshOnly: true, pitchedDefault: true, carpet: true,
    before: () => {
      const tr = worldM1.terrain;
      worldM1._carpetCtx = { cfg: validateCarpetConfig({ seed: 11, radiusM: 12, underlay: 0.6, variants: [
        { name: 'meadow', ground: tr.typeNames.filter((n) => n.startsWith('grass')), density: 0.9, heightM: [0.15, 0.28], ramp: [[10, 40, 10], [60, 160, 40], [180, 230, 90]] },
      ] }, tr.typeNames), recipe: tr.recipe };
      worldM1._rebuildCarpet();
    } });

  // US-068b3b (38.19 item 2): ortho ISO pose over the roadSouth area (look-at 20 m along the roadSouth view, yaw 240).
  // Eye = focus - 500 m*F (ORTHO_BACK_M), halfH 20 m. NEW row: JS twin (meshPitched path) vs WG under the pitched gate rules.
  const orthoIsoPose = () => {
    const fx = 1448.7, fy = 1025.0, fz = worldM1.terrain ? worldM1.terrain.groundAt(fx, fy) : 0;
    const e = pitchedEyeFromFocus(fx, fy, fz, 45, -35.264, 500, [0, 0, 0]);
    return { x: e[0], y: e[1], z: e[2], yawDeg: 45, pitchDeg: -35.264, projection: 'ortho', orthoHalfH: 20, focusX: fx, focusY: fy, focusZ: fz };
  };
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: orthoIso (US-068b3b ortho yaw 45 pitch -35.264, halfH 20, roadSouth area)',
    cam: orthoIsoPose(), real: true, meshOnly: true });

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
  const fallHomeM1 = worldM1.waterfalls;
  const waterHomeM1 = worldM1.water; // US-055a2b: the `water` poses install a region set on worldM1; resetInstances puts the empty one back
  let forestWorld = null;
  const compareInstances = engine.instances;
  compareInstances.bindPool(compareVoxelPool);
  const unitsGroup = compareInstances.group('lever', 20);
  const resetInstances = () => { if (engine._detail || (forestWorld && engine.world === forestWorld)) engine.setWorld(worldM1); for (const g of compareInstances.groups) g.count = 0; engine.viewModel.hide(); worldM1.cloths = clothHomeM1; testRoom.cloths = clothHomeTR; worldM1.water = waterHomeM1; worldM1.waterfalls = fallHomeM1; };
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

  // TREES-LP-b (37.15 item 3): 6 instanced kind-9 trees (InstanceGroups.meshGroup), eye 8 m away, mesh renderer only.
  if (ctx.lowpolyTreeMesh) {
    const ltGroup = compareInstances.meshGroup(ctx.lowpolyTreeMesh, 6);
    runs.push({
      world: worldM1, lights: worldM1Lights, real: true, meshOnly: true, name: 'world_m1: lowpolyTrees (TREES-LP-b, 6 instanced kind-9 trees, eye 8 m)',
      cam: { x: 1470, y: 1025, z: (worldM1.terrain ? worldM1.terrain.groundAt(1470, 1025) : 0) + 1.6, yawDeg: 270, pitchDeg: 8 },
      before: () => {
        const yaws = [0, 40, 95, 150, 210, 300];
        for (let i = 0; i < 6; i++) {
          const x = 1462 - (i % 2) * 3.5, y = 1025 + (i - 2.5) * 3.2;
          writeUnitInstance(ltGroup.ib, ltGroup.count++, x, y, worldM1.terrain ? worldM1.terrain.groundAt(x, y) : 0, yaws[i], 0xFF00 | i, 0); // MESH-INST-02: clear of the placed-mesh id range 0xA000..0xFEFF
        }
      },
    });
  }

  // RIG-GC-01: 1 rigged character, rest pose (the kit has no clips), jaw partRot ry 30, 3 m ahead of the camera, mesh only.
  if (assets.has('model', 'char.gc')) {
    const CG = { x: 1470, y: 1025 };
    const cgZ = worldM1.terrain ? worldM1.terrain.groundAt(CG.x, CG.y) : 0;
    runs.push({
      world: worldM1, lights: worldM1Lights, real: true, meshOnly: true, name: 'world_m1: charRig (RIG-GC-01, rigged chargen character, jaw partRot ry 30, 3 m ahead)',
      cam: { x: CG.x + 3, y: CG.y, z: cgZ + 1.6, yawDeg: 90, pitchDeg: 0 },
      before: () => {
        const pm = compareVoxelPool.models.get('char.gc');
        const idle = pm && pm.clipIndex.idle !== undefined ? pm.clipIndex.idle : -1;
        const slot = compareVoxelPool.pushInstance('char.gc', CG.x, CG.y, cgZ, 270, idle, 0, 0);
        const jaw = pm && pm.partIndex ? pm.partIndex.jaw : undefined;
        if (slot >= 0 && jaw !== undefined) { const sl = compareVoxelPool._rawSlot(slot); sl.addPart = jaw; sl.addRx = 0; sl.addRy = 30; sl.addRz = 0; } // = components.voxel.partRot
      },
    });
  }

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
  // SWAY-GC-01: fixed wind field for the `swayWindy` pose only (deterministic: explicit seed, fixed clock via the pose's timeSec).
  const SWAY_GC_WIND = { dirDeg: 45, speed: 8, seed: 7, gust: { amp: 0.5, periodSec: 6, travel: 12 } };
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
  // SWIM-04c (38.54): underwaterLake - eye 2 m below the surface of a 30 m round lake (surface 4 m above the ground at the pool centre, so >= 4 m deep
  // at the eye), looking over the water (yaw 270 pitch 0) and up at the ceiling (pitch 35). Fog, bubble swap, ceiling hash and caustics through both twins.
  // Explicit coordinates: eye (1456, 1045.5, surface - 2), surface z = groundZ(1456, 1045.5) + 4; sun az 135 el 30; fb.timeSec 0.
  const lakeSet = waterPose([{ id: 'cmp.underLake', shape: 'circle', c: [poolC.x, poolC.y], r: 30, z: groundZ(poolC.x, poolC.y) + 4, look: 'water' }]);
  for (const [what, pitchDeg] of [['underwaterLake', 0], ['underwaterLake up (ceiling)', 35]]) {
    runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: ${what} (SWIM-04c, eye 2 m under a 30 m lake, yaw 270, pitch ${pitchDeg}, sun az 135 el 30)`,
      cam: { x: poolC.x, y: poolC.y, z: groundZ(poolC.x, poolC.y) + 2, yawDeg: 270, pitchDeg }, real: true, meshOnly: true, sun: SUN_135_30, before: lakeSet, under: true });
  }
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: water sea (US-055a2b, flooded plain 1 m below the eye, shear pitch -3, sun az 135 el 30)',
    cam: { x: waterEye.x, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -3 }, real: true, meshOnly: true, sun: SUN_135_30,
    before: waterPose([{ id: 'cmp.sea', shape: 'rect', rect: [1100, 700, 1900, 1400], z: groundZ(waterEye.x, waterEye.y) - 1, look: 'water' }]) });

  // US-142a1: both sides of one static sheet, tick 600; no content placement.
  const fallZ = groundZ(poolC.x, poolC.y) + 9;
  const waterfallSet = () => {
    worldM1.water = createWater([]); worldM1.water.setTickForTest(600);
    worldM1.waterfalls = createWaterfalls(collectWaterfallDefs({ waterfalls: [
      { id: 'cmp.fall', lip: [poolC.x, poolC.y - 3, poolC.x, poolC.y + 3], z: fallZ, drop: 8, outDeg: 90 },
    ] }, []));
  };
  for (const [side, x, yaw] of [['front', poolC.x + 10, 270], ['back', poolC.x - 8, 90]]) {
    runs.push({ world: worldM1, lights: worldM1Lights, name: `world_m1: waterfall ${side} (US-142a1, tick 600)`,
      cam: { x, y: poolC.y, z: fallZ - 4, yawDeg: yaw, pitchDeg: -4 }, real: true, meshOnly: true,
      sun: SUN_135_30, timeSec: 10, before: waterfallSet });
  }

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

  // RIVER-03 (architecture.md 38.45, OB-019): river ribbon rows on worldM1 (installed like the water poses above: a `river` water def, tick 600,
  // t = 10 s). Path z = highest ground along the path + 0.6 minus a constant slope (monotone, so it validates); the terrain cuts the flat
  // cross-section. riverBend: S-bend 300 m long, camera over the head (LOD0 near, LOD1 far, both in view). riverFord: shallow short reach,
  // grazing (shore foam where stones / banks poke through). riverSteep: 0.2 m/m slope, rapids (rapidQ > 0), looking down the fall line.
  const riverPath = (pts, hw, slope, speed) => {
    let zTop = -Infinity;
    for (const [x, y] of pts) zTop = Math.max(zTop, groundZ(x, y));
    let s = 0;
    return pts.map(([x, y], i) => {
      if (i) s += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
      return [x, y, zTop + 0.6 - slope * s, hw, speed];
    });
  };
  const riverPose = (id, pts, hw, slope, speed, look = 'water') => () => {
    worldM1.water = createWater(collectWaterDefs({ water: [{ id, shape: 'river', path: riverPath(pts, hw, slope, speed), look, feather: 1.5 }] }, []));
    worldM1.water.setTickForTest(600);
  };
  const bendPts = Array.from({ length: 16 }, (_, i) => [waterEye.x + 6 - 20 * i, waterEye.y + 10 * Math.sin(i * 0.7)]);
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: riverBend (RIVER-03, 300 m S-bend, LOD0 + LOD1, tick 600, t 10 s, sun az 135 el 30)',
    cam: { x: waterEye.x + 8, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + 14, yawDeg: 270, pitchDeg: -16 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, timeSec: 10,
    before: riverPose('cmp.riverBend', bendPts, 4, 0.05, 1.5) });
  const fordPts = Array.from({ length: 8 }, (_, i) => [waterEye.x + 4 - 10 * i, waterEye.y + 1.5 * Math.sin(i)]);
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: riverFord (RIVER-03, shallow reach, grazing, shore foam on the bank contour, tick 600, t 10 s)',
    cam: { x: waterEye.x + 6, y: waterEye.y + 5, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -4 }, real: true, meshOnly: true, sun: SUN_135_30, timeSec: 10,
    before: riverPose('cmp.riverFord', fordPts, 5, 0.01, 0.8) });
  // WATER-FINISH-01b (38.77): the design looks carry reflScreenK / causticK. waterReflectLake: a 14 m-radius lake 22 m ahead seen grazing from the shore (far bank mirrored, shear);
  // waterCausticFord: the 'river' look ford reach, shallow bed with caustic flicker + faint bank reflection (sun up, t 10 s).
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: waterReflectLake (WATER-FINISH-01b, 28 m lake 8 m ahead, far-bank screen reflection, shear pitch -3, sun az 135 el 30)',
    cam: { x: waterEye.x, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: -3 }, real: true, meshOnly: true, sun: SUN_135_30, timeSec: 10,
    before: waterPose([{ id: 'cmp.reflLake', shape: 'circle', c: [waterEye.x - 22, waterEye.y], r: 14, z: groundZ(waterEye.x - 22, waterEye.y) + 0.9, look: 'water' }]) });
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: waterCausticFord (WATER-FINISH-01b, river look ford, shallow caustics, grazing, tick 600, t 10 s)',
    cam: { x: waterEye.x + 6, y: waterEye.y + 5, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -4 }, real: true, meshOnly: true, sun: SUN_135_30, timeSec: 10,
    before: riverPose('cmp.riverFordCaustic', fordPts, 5, 0.01, 0.8, 'river') });
  // US-055a (architecture.md 38.47): wade splash droplets (pooled particles) + 3 ripple rings at fixed ages, on the ford reach.
  // Particles are cleared before every pose; fb.ripples is set only for this pose and reset next to that clear().
  const wadeRipples = createRipples();
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: wadeSplash (US-055a, ford, 12 particle steps + rings at ages 0.2/0.5/0.8 s, t 10 s)',
    cam: { x: waterEye.x + 6, y: waterEye.y + 5, z: groundZ(waterEye.x, waterEye.y) + engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -4 }, real: true, meshOnly: true, sun: SUN_135_30, timeSec: 10,
    before: () => {
      riverPose('cmp.riverFord', fordPts, 5, 0.01, 0.8)();
      const fw = forwardOf(250, [0, 0]); // 3 m ahead of the camera
      const fx = waterEye.x + 6 + fw[0] * 3, fy = waterEye.y + 5 + fw[1] * 3;
      engine.particles.clear(); wadeRipples.clear();
      defineWadeSplash(engine.particles);
      const z = groundZ(waterEye.x, waterEye.y) + 0.6;
      wadeSplashAt(engine.particles, fx, fy, z, 1);
      wadeRipples.add(fx, fy, 0.8, 9.8); wadeRipples.add(fx, fy, 0.6, 9.5); wadeRipples.add(fx, fy, 0.4, 9.2);
      for (let i = 0; i < 12; i++) engine.particles.step();
      ctx.compareRipples = wadeRipples; // read by runGpuCompareSceneMode (fbCompare lives there)
    } });
  const steepPts = Array.from({ length: 9 }, (_, i) => [waterEye.x + 6 - 10 * i, waterEye.y + 3 * Math.sin(i * 0.6)]);
  runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: riverSteep (RIVER-03, 0.2 m/m slope, rapids foam, flow streaks stretch, tick 600, t 10 s)',
    cam: { x: waterEye.x + 9, y: waterEye.y, z: groundZ(waterEye.x, waterEye.y) + 9, yawDeg: 270, pitchDeg: -22 }, real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, timeSec: 10,
    before: riverPose('cmp.riverSteep', steepPts, 3, 0.2, 3) });

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
        cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 40, pitchDeg: pitch }, real: true, meshOnly: true, needK8: true, pitchedDefault: true, vmAssert: true,
        before: () => { vmLayer.setBob(0, 0); vmLayer.show(vmH, vmLayer.clipId(vmH, 'idle'), 0, false); } });
    }
    // HANDS-01c (37.8a): `handsSwapped` - the winding-flip pose (HANDS-01a's GPU frontFace(CW) for det<0 items was never
    // drawn by a pose). Two handles at once (VM_MAX_HANDLES 8; main: main's sword + spell, this sword, the spell glove): the sword
    // (authored left, vmH) in the RIGHT hand = mirrored (det<0), the spell glove (authored left) in the LEFT hand = unmirrored
    // (per-item flip, restored between items). Default pitched camera, vmAssert.
    if (globalThis.ASSETS.viewModels.spellHand && compareVoxelPool.models.has('spellHandL') && vmLayer.stats.items === 0) {
      const spH = vmLayer.load('spellHand', globalThis.ASSETS.viewModels.spellHand, compareVoxelPool);
      runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: viewModel handsSwapped (HANDS-01c, sword right = mirrored + spell glove left, crash room)',
        cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 40, pitchDeg: 0 }, real: true, meshOnly: true, needK8: true, pitchedDefault: true, vmAssert: true,
        before: () => {
          vmLayer.setBob(0, 0); vmLayer.setHand(vmH, 'right'); vmLayer.setHand(spH, 'left');
          vmLayer.show(vmH, vmLayer.clipId(vmH, 'idle'), 0, false); vmLayer.show(spH, vmLayer.clipId(spH, 'idle'), 0, false);
        } });
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

  // ME-06c3: tree-enabled world only for this mesh pose; old rows retain their worlds.
  if (ctx.renderer === 'mesh') {
    forestWorld = loadCompareWorld(assets.world('world_m1'), { realTrees: true, physics: 'mesh' });
    forestWorld.terrain.bakeFarSync();
    const sc = forestWorld.scatter, cfg = forestWorld.terrain.recipe.recipe.forest.trees;
    let best = -1, bestN = -1, bestD = Infinity;
    for (let i = 0; i < sc.count; i++) {
      let n = 0;
      for (let j = 0; j < sc.count; j++) if ((sc.x[j] - sc.x[i]) ** 2 + (sc.y[j] - sc.y[i]) ** 2 <= 900) n++;
      const d = (sc.x[i] - m1Eye.x) ** 2 + (sc.y[i] - m1Eye.y) ** 2;
      if (n > bestN || (n === bestN && d < bestD)) { best = i; bestN = n; bestD = d; }
    }
    if (best < 0) throw new Error('forestWalk: empty tree scatter');
    let x = sc.x[best] + 2, y = sc.y[best] + 2;
    for (let i = 0; i < sc.count; i++) {
      const r = cfg.species[sc.species[i]].trunkR / Math.cos(Math.PI / 8) + .3;
      if ((sc.x[i] - x) ** 2 + (sc.y[i] - y) ** 2 < r * r) throw new Error('forestWalk: eye inside trunk');
    }
    const forestLights = lightsEnabled ? buildLightSet(forestWorld, assets.palette) : null;
    runs.push({ world: forestWorld, lights: forestLights, name: 'world_m1: forestWalk (ME-06c3, dense canopy)',
      cam: { x, y, z: forestWorld.terrain.groundAt(x, y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: 30 },
      real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30,
      before: () => engine.setWorld(forestWorld) });

    // SWAY-GC-01: the ONLY wind-on pose (world_m1 authors speed 0 = calm for every other row). Own world instance with a fixed wind def
    // (fixed dir/speed/gust/seed, no wall clock) at a fixed fb.timeSec, so the camera view (JS twin vs GPU) uses one clock; the same pose also
    // yields its `[shadow depth parity]` row (sun map, 10 Hz-quantised wind clock). Same camera as forestWalk -> compare the two for visible sway.
    const swayWindWorld = loadCompareWorld({ ...assets.world('world_m1'), wind: SWAY_GC_WIND }, { realTrees: true, physics: 'mesh' });
    swayWindWorld.terrain.bakeFarSync();
    const swayWindLights = lightsEnabled ? buildLightSet(swayWindWorld, assets.palette) : null;
    runs.push({ world: swayWindWorld, lights: swayWindLights, name: 'world_m1: swayWindy (SWAY-GC-01, forestWalk pose, wind on, t=7.3 s)',
      cam: { x, y, z: swayWindWorld.terrain.groundAt(x, y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: 30 },
      real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, timeSec: 7.3,
      before: () => engine.setWorld(swayWindWorld) });
    // R6c (38.60 item 8): card impostor rows, NEW, opt-in (`?imp=1`; default gpucompare unchanged until the WebGPU card pass is wired). One tree species
    // (the densest mesh group of the forest world) is force-enabled: impMid = forestWalk-like pose looking over trees at 60-120 m with impM 60 (cards to
    // maxDistM); impBand = camera 4 m inside the 8 m dither band of the tree cluster (impM 60, cluster 64 m away). Expected JS == GPU.
    if (ctx.params.get('imp') === '1') {
      const enableImp = (impM) => () => {
        engine.setWorld(forestWorld);
        const g = engine.instances.groups.filter((q) => q.mesh && q.count > 0).sort((a, b) => b.count - a.count)[0];
        if (!g) throw new Error('imp row: no tree mesh group in the forest world');
        const src = resolveGroupLod1(g, engine.instances._meshLookup) || g.mesh;
        if (!g.imp) enableGroupImpostor(g, bakeImpostor(src.data || src), impM, createInstanceBuffer);
        g.impM = impM;
      };
      runs.push({ world: forestWorld, lights: forestLights, name: 'world_m1: impMid (R6c, one species as cards 60-300 m, forestWalk eye, pitch 5)',
        cam: { x, y, z: forestWorld.terrain.groundAt(x, y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: 5 },
        real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, before: enableImp(60) });
      const bx = sc.x[best] + 64, by = sc.y[best];
      runs.push({ world: forestWorld, lights: forestLights, name: 'world_m1: impBand (R6c, camera 64 m from the densest cluster = 4 m inside the 60..68 m dither band)',
        cam: { x: bx, y: by, z: forestWorld.terrain.groundAt(bx, by) + engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 5 },
        real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, before: enableImp(60) });
    }

    // MAP-12 (arch 38.43): band GRID world, near band at zone g6_9 (cx0 12, cy0 9) - neither the east {8,7} nor the west {6,7} authored zone.
    // Own world instance (terrainBand(s) replaced by terrainGrid, same bake bytes per cell): exercises near type re-upload + band origin at an arbitrary zone.
    const gridDef = { ...assets.world('world_m1'), terrainGrid: { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 } };
    delete gridDef.terrainBand; delete gridDef.terrainBands;
    const GZ = { x: 1856, y: 1344 }; // inside zone g6_9 (x 1536..2176, y 1152..1536), >= 192 m from its x edges, 192 m from its y edges
    const gridZoneWorld = loadCompareWorld(gridDef, { realTrees: true, physics: 'mesh', spawn: GZ });
    gridZoneWorld.terrain.bakeFarSync();
    if (gridZoneWorld.bandId !== 'g6_9') throw new Error('gridZone: expected band g6_9, got ' + gridZoneWorld.bandId);
    const gridZoneLights = lightsEnabled ? buildLightSet(gridZoneWorld, assets.palette) : null;
    runs.push({ world: gridZoneWorld, lights: gridZoneLights, name: 'world_m1: gridZone (MAP-12, band g6_9, near terrain at a generated zone)',
      cam: { x: GZ.x, y: GZ.y, z: gridZoneWorld.terrain.groundAt(GZ.x, GZ.y) + engine.physics.eyeHeight, yawDeg: 270, pitchDeg: 15 },
      real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30,
      before: () => engine.setWorld(gridZoneWorld) });
  }

  // ENV-01a2: existing comparison worlds retain detail off.
  if (ctx.renderer === 'mesh') {
    const detailWorld = loadCompareWorld(assets.world('world_m1'), { detail: true, physics: 'mesh' });
    detailWorld.terrain.bakeFarSync();
    const x = 1474.5, y = 1025;
    const detailLights = lightsEnabled ? buildLightSet(detailWorld, assets.palette) : null;
    runs.push({ world: detailWorld, lights: detailLights, name: 'world_m1: detailWalkout (ENV-01a2, ground scatter)',
      cam: { x, y, z: detailWorld.terrain.groundAt(x, y) + 1.6, yawDeg: 270, pitchDeg: -15 },
      real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30,
      before: () => engine.setWorld(detailWorld) });
  }
  // ENV-01d (38.62): decorGpu rows. Existing rows above stay decor=cpu (world.decorGpu undefined = no mask, identical bytes). These two rows share a world that sets the
  // plain property `decorGpu` (ENV-01b); the GPU decor pass itself is fed by main.js / the renderer host (NEEDS B1-main). Main session runs them, thresholds unchanged.
  if (ctx.renderer === 'mesh') {
    const decorWorld = loadCompareWorld(assets.world('world_m1'), { detail: true, physics: 'mesh' });
    decorWorld.decorGpu = true; decorWorld.terrain.bakeFarSync();
    const decorLights = lightsEnabled ? buildLightSet(decorWorld, assets.palette) : null;
    const dpose = (name, x, y, yawDeg, pitchDeg) => runs.push({ world: decorWorld, lights: decorLights, name,
      cam: { x, y, z: decorWorld.terrain.groundAt(x, y) + 1.6, yawDeg, pitchDeg }, real: true, meshOnly: true, pitchedDefault: true, decorGpu: true, sun: SUN_135_30,
      before: () => engine.setWorld(decorWorld) });
    dpose('world_m1: decorMeadow (ENV-01d, decorGpu, flower meadow, eye 1.6 m: carpet hand-off)', 1474.5, 1025, 270, -15);
    dpose('world_m1: decorFord (ENV-01d, decorGpu, ford reeds + pebbles)', 1045.96, 1066.69, 246, -11);
  }
  // ENV-02d-LIVE: ground look rows (lookMeadow / lookForestEdge / lookShore from content/dev-poses.js GATE_POSES): a world_m1 load with `groundLook` on, same opts main.js builds.
  { const gl = groundLookFromParams(params, globalThis.BIOME_LOOK, globalThis.ASSETS && globalThis.ASSETS.levels.overworld_far);
    if (gl) {
      for (const slug of ['lookMeadow', 'lookForestEdge', 'lookShore']) {
        const g = GATE_POSES.find((q) => q.slug === slug); if (!g) continue;
        // GC-FIX: one fresh world per look row (a shared world leaked state from lookMeadow into lookForestEdge: meshTies 2 -> 124)
        const lookWorld = loadCompareWorld(assets.world('world_m1'), { groundLook: gl });
        lookWorld.terrain.bakeFarSync();
        const lookLights = lightsEnabled ? buildLightSet(lookWorld, assets.palette) : null;
        runs.push({ world: lookWorld, lights: lookLights, name: `world_m1: ${slug} (ENV-02d ground look)`, cam: { ...g.cam, z: lookWorld.terrain.groundAt(g.cam.x, g.cam.y) + 1.7 },
          real: true, pitchedDefault: true, sun: SUN_135_30, before: () => engine.setWorld(lookWorld) });
      }
    } }
  // Every pose that does not ask for a projection is a shear (dda-vs-mesh parity) pose until ME-19: pin it.
  for (const r of runs) if (!r.pitchedDefault && !r.cam.projection) r.cam = { ...r.cam, projection: 'shear' };

  // DECAL-01: isolated overlay probe; every earlier pose retains its old ops.
  const scrawl = worldM1.decals.find(d => d.id === 'tower.scrawl');
  if (ctx.renderer === 'mesh' && scrawl) {
    const x = (scrawl.ax + scrawl.bx) * 0.5, y = (scrawl.ay + scrawl.by) * 0.5, z = (scrawl.z0 + scrawl.z1) * 0.5;
    const decalCam = { x, y: y - 1.5, z: z + 0.65, yawDeg: 180, pitchDeg: -23.4 };
    runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: decalScrawl (DECAL-01, KEEP THE LIGHT, lantern lit)',
      cam: decalCam, real: true, meshOnly: true, decalAssert: scrawl.glyphs.filter(g => g !== 0).length, overlayOps: ov => {
        ov.setStyles({ decal: { glyphs: '-|\\/', fg: hexToRgb(assets.palette.colors.scrawl) },
          decalFaint: { glyphs: '-|\\/', fg: hexToRgb(assets.palette.colors.scrawlFaint) } });
        const binding = bindDecals(ov, worldM1.decals);
        drawDecals(binding, ov, decalCam, worldM1Lights, worldM1);
      } });
  }

  // SPELL-01b (37.14): `fireballInFlight` + `fireballBurst` - the ball / blast billboards (SpritePool.push via `spritesExtra`, after
  // collect) and the moving / flash lights, in the crash room. Appended LAST: the lights are added lazily in `before`, so no
  // earlier pose sees them. The designer sprites + presets must have been attached (main.js boot does it).
  if (ctx.renderer === 'mesh' && worldM1Lights && assets.palette.lights.fireballLightBig && globalThis.ASSETS.spellSprites) {
    const P = assets.palette, lp = P.lights;
    const eyeZ = engine.physics.eyeHeight, fwd = forwardOf(40, [0, 0]);
    const fcam = { x: 1497.5, y: 1026.5, z: eyeZ, yawDeg: 40, pitchDeg: 0 };
    const at = (d, dz) => [fcam.x + fwd[0] * d, fcam.y + fwd[1] * d, fcam.z + dz];
    let ball = -1, flash = -1;
    const mk = (preset, key) => worldM1Lights.add({ x: 0, y: 0, z: 0, hue: P.hue[preset.color], intensity: preset.intensity, radius: preset.radius, flicker: null, on: false, key });
    const ensure = () => { if (ball < 0) { ball = mk(lp.fireballLightBig, 'cmp.fireball'); flash = mk(lp.fireballFlash, 'cmp.flash'); } };
    runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: fireballInFlight (SPELL-01b, core sprite 3 m ahead + moving light + flash at 50 %, crash room)',
      cam: fcam, real: true, meshOnly: true, needK8: true, pitchedDefault: true,
      before: () => {
        ensure();
        const b = at(3, -0.1);
        worldM1Lights.move(ball, b[0], b[1], b[2]); worldM1Lights.setOn(ball, true);
        worldM1Lights.move(flash, b[0], b[1], b[2] + 0.4); worldM1Lights.setParams(flash, { intensity: lp.fireballFlash.intensity * 0.25 }); worldM1Lights.setOn(flash, true); // (1 - 0.5)^2
      },
      spritesExtra: (pool) => { const b = at(3, -0.1); pool.push('fireballCore', 'fly', 1, b[0], b[1], b[2]); } });
    runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: fireballBurst (SPELL-01b, blast sprite frame 2 + embers/smoke frozen at 10 steps + flash light, crash room)',
      cam: fcam, real: true, meshOnly: true, needK8: true, pitchedDefault: true,
      before: () => {
        ensure();
        const b = at(3.5, -0.2);
        worldM1Lights.setOn(ball, false);
        worldM1Lights.move(flash, b[0], b[1], b[2]); worldM1Lights.setParams(flash, { intensity: lp.fireballFlash.intensity }); worldM1Lights.setOn(flash, true);
        const ps = engine.particles;
        if (ps && ps.defIdOf('fireballBurst') >= 0) {
          ps.burstAt(ps.defIdOf('fireballBurst'), b[0], b[1], b[2], 20, 0, 0, 1);
          ps.burstAt(ps.defIdOf('fireballSmoke'), b[0], b[1], b[2], 8, 0, 0, 1);
          for (let i = 0; i < 10; i++) ps.step();
        }
      },
      spritesExtra: (pool) => { const b = at(3.5, -0.2); pool.push('fireballBlast', 'burst', 2, b[0], b[1], b[2]); } });
  }

  // ALPHA-01c (37.17 step c): alpha-cutout poses `alphaLeaves` (6 m) and `alphaLeavesFar` (30 m). TEST-ONLY world: a second load of world_m1 with its own
  // MaskAtlas and a leaf-card fixture built here from code (4 vertical cards + 1 tilted card, 2 m, 8x8 checker mask, an opaque post first), placed only in this
  // world, so no committed content or earlier pose changes. Appended LAST. WebGL2 draws the masked ranges opaque (D-044: no GLSL) = recorded known-FAIL rows.
  if (ctx.renderer === 'mesh') {
    const aw = loadCompareWorld(assets.world('world_m1'), { physics: 'mesh' });
    aw.terrain.bakeFarSync();
    const atlas = buildMaskAtlas(assets); // real masks too: world_m1 meshes (MESH-PLACE-01 flower bushes) reference Leaves_NormalTree_C; a checker-only atlas made the raster throw
    const chk = new Uint8Array(64);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) chk[j * 8 + i] = (i + j) % 2 === 0 ? 255 : 0;
    atlas.add('test/checker8', 8, 8, chk);
    aw.maskAtlas = atlas;
    const tris = [];
    const quad = (cx, cy, cz, yawDeg, w, h, tiltDeg, mat) => { // w x h card centred on (cx, cy, cz), uv = unit square (v = 0 on top)
      const yw = yawDeg * Math.PI / 180, tl = tiltDeg * Math.PI / 180;
      const ax = Math.cos(yw) * w / 2, ay = Math.sin(yw) * w / 2;
      const ux = -Math.sin(yw) * Math.sin(tl) * h / 2, uy = Math.cos(yw) * Math.sin(tl) * h / 2, uz = Math.cos(tl) * h / 2;
      const P = { tl: [cx - ax + ux, cy - ay + uy, cz + uz], tr: [cx + ax + ux, cy + ay + uy, cz + uz], br: [cx + ax - ux, cy + ay - uy, cz - uz], bl: [cx - ax - ux, cy - ay - uy, cz - uz] };
      const UV = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
      const tri = (a, b, c) => {
        const e1 = [P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]], e2 = [P[c][0] - P[a][0], P[c][1] - P[a][1], P[c][2] - P[a][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
        return { p0: P[a], p1: P[b], p2: P[c], normal: [n[0] / l, n[1] / l, n[2] / l], matName: mat, uv0: UV[a], uv1: UV[b], uv2: UV[c] };
      };
      tris.push(tri('tl', 'bl', 'br'), tri('tl', 'br', 'tr'));
    };
    quad(0, 0, 1.5, 0, 0.3, 3, 0, 'post'); // opaque range first (37.17: opaque before masked)
    const nOpaque = tris.length;
    quad(0, 0.1, 2.2, 20, 2, 2, 0, 'leaf'); quad(1.2, 0.7, 2.7, 75, 2, 2, 0, 'leaf'); quad(-1.3, 0.4, 1.8, -40, 2, 2, 0, 'leaf'); quad(0.2, 0.1, 1.0, 10, 2, 2, 55, 'leaf');
    const nLeaf = tris.length - nOpaque;
    quad(0.3, -0.8, 3.0, 110, 2, 2, 0, 'leaf_dark');
    const mask = { tex: 'test/checker8', cutoff: 0.5 };
    const alphaMesh = buildMeshFromTris(tris, [{ part: 'post', triStart: 0, triCount: nOpaque }, { part: 'leaf', triStart: nOpaque, triCount: nLeaf, mask },
      { part: 'leaf_dark', triStart: nOpaque + nLeaf, triCount: tris.length - nOpaque - nLeaf, mask }], 'test/alphaCards');
    alphaMesh.mats = { post: 'timber_old', leaf: 'leaf', leaf_dark: 'leaf_dark' }; // EMIS-01b/kestrel-2#0: repointed to leaf/leaf_dark directly (already edge:'soft', ALPHA-01e); *_softtest clones removed
    const cx = 1456, cy = 1046, gz = aw.terrain.groundAt(cx, cy);
    aw.placeMesh(alphaMesh, { x: cx, y: cy, z: gz }, 'test.alphaCards');
    const alphaLights = lightsEnabled ? buildLightSet(aw, assets.palette) : null;
    const fwd = forwardOf(0, [0, 0]);
    for (const [label, d] of [['alphaLeaves (ALPHA-01c, masked leaf cards, eye 6 m)', 6], ['alphaLeavesFar (ALPHA-01c, eye 30 m)', 30]]) {
      const ex = cx - fwd[0] * d, ey = cy - fwd[1] * d;
      runs.push({ world: aw, lights: alphaLights, name: `world_m1: ${label}`, cam: { x: ex, y: ey, z: aw.terrain.groundAt(ex, ey) + 1.6, yawDeg: 0, pitchDeg: d === 6 ? 8 : 2 },
        real: true, meshOnly: true, pitchedDefault: true, sun: SUN_135_30, maskPose: true, before: () => engine.setWorld(aw) });
    }
  }

  if (ctx.params.get('gpucompare') === 'emissive' && emisPose) {
    runs.length = 0; // emissive mode: only the brazier pose (rows emissive-glow-fg/bg)
    runs.push({ world: worldM1, lights: worldM1Lights, name: 'world_m1: tower crown (EMIS glow)', cam: { ...emisPose }, real: true });
  }
  return { testRoom, worldM1, m1Eye, testRoomLights, worldM1Lights, runs, compareVoxelPool, compareInstances, resetInstances };
}

/**
 * RE-07b: per touched overlay cell, "GPU shows the overlay" vs "JS twin shows it" (fg rgb + glyph equal to the layer).
 * Cells where the depth compare sits within 1e-3 * ref of the bias edge are boundary cells (excluded from mismatch).
 */
/** US-142a1 / WG-3e: waterfall sheet layer (flags + depth on interior sheet cells) vs the JS twin's fbCompare.water; null for other poses. */
function waterfallRow(poseName, waterBits, jt, n, cols, rows) {
  if (!poseName.includes('waterfall')) return null;
  const floats = waterBits ? new Float32Array(waterBits.buffer) : null;
  let tested = 0, flags = 0, depthOk = 0, hits = 0;
  for (let i = 0; jt && waterBits && i < n; i++) {
    if (!jt.kind[i] || (jt.objectId[i] & 32) === 0) continue;
    hits++;
    const x = i % cols, y = (i / cols) | 0;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) continue;
    if (![i - 1, i + 1, i - cols, i + cols].every((j) => jt.kind[j] && (jt.objectId[j] & 32) !== 0)) continue;
    tested++;
    if (waterBits[i * 4 + 3] === jt.objectId[i]) flags++;
    if (Math.abs(floats[i * 4] - jt.depth[i]) <= jt.depth[i] * 0.01) depthOk++;
  }
  const waterfall = { hits, tested, flags, depthOk, pass: tested > 0 && flags / tested >= 0.995 && depthOk === tested };
  console.log(`[gpucompare] waterfall layer ${poseName}: ${JSON.stringify(waterfall)}`);
  return waterfall;
}

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
 * map + the light pass) and `world.sun` (the terrain's analytic sun, `sunFromWorld`) - so a pose
 * can pin e.g. az 135 el 30. Returns the restore closure.
 */
function applySunOverride(world, lights, sun) {
  const oldSun = world.sun, oldSource = world.sunSource, hadSource = 'sunSource' in world;
  const old = lights ? { elevation: lights.sun.elevation, azimuth: lights.sun.azimuth, on: lights.sun.on } : null;
  world.sunSource = null; // force a temporary copy even if this world already owns a time-driven sun
  setWorldSun(world, lights, sun.elevation, sun.azimuth, true);
  return () => {
    world.sun = oldSun;
    if (hadSource) world.sunSource = oldSource; else delete world.sunSource;
    if (lights && old) lights.setSun(old);
  };
}

/**
 * DN-04b: pins the day/night clock to `hour` for one pose (what main.js's clock driver does per step): moon/sun pair on the light set + world.sun,
 * the blended look (`P.liveLook`) and the LightSet ambient. Returns the restore closure (liveLook cleared = frozen path, sun + ambient back).
 */
function applyHourOverride(world, lights, P, hour, on) {
  const oldSun = world.sun, oldSource = world.sunSource, hadSource = 'sunSource' in world;
  const old = lights ? { elevation: lights.sun.elevation, azimuth: lights.sun.azimuth, on: lights.sun.on, amb: Array.from(lights.ambient) } : null;
  const path = sunPathFrom(world.sun || P.lights.sun);
  world.sunSource = null;
  applySunPair(world, lights, hour, hour, path, on);
  const L = blendLook(P, hour, P.daySchedule);
  if (lights) { const hu = P.hue[L.ambient]; for (let i = 0; i < 3; i++) lights.ambient[i] = hu[i] * L.ambientI; }
  return () => {
    world.sun = oldSun;
    if (hadSource) world.sunSource = oldSource; else delete world.sunSource;
    delete P.liveLook; P.liveLookVersion = (P.liveLookVersion | 0) + 1; // back to the frozen look; the version bump re-bakes the sky LUT
    if (lights && old) { lights.setSun({ elevation: old.elevation, azimuth: old.azimuth, on: old.on }); for (let i = 0; i < 3; i++) lights.ambient[i] = old.amb[i]; }
  };
}

async function runGpuCompareSceneMode(ctx) {
  const {
    wgPipeline, rt, assets, matTable, detailPass, depthBuffer, gbuf, overlay, sprites, engine,
    compareNoVoxels, renderer, terrainEnabled, rayParam, params, GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR, fadeLut,
  } = ctx;
  // WG-2b: a ready WebGPU WgCellPipeline runs the GEOMETRY rows only (cells/light/shadow/overlay need WG-3); readbacks are awaited.
  const wg = wgPipeline && wgPipeline.ready ? wgPipeline : null;
  const gpuPipeline = wg;
  if (!gpuPipeline) { noPipelineMsg(ctx); return; }
  if (rt.cols !== 160 || rt.rows !== 60) {
    console.warn(`[gpucompare] expected 160x60 for ?gpucompare=1, got ${rt.cols}x${rt.rows} - the grid-forcing block at the top of main.js may have been bypassed.`);
  }

  gpuPipeline.setSource('scene');
  if (wg && wg.setStable) wg.setStable(false); // US-073c: every normal row sees the unstabilised edge output; the `stable` row below switches it on for its two frames

  // TREES-LP-b: the unplaced Kenney stub (test-only content) for the `lowpolyTrees` pose; missing file = pose skipped.
  try { ctx.gcKit = await (await fetch(new URL('../../../../content/chargen/human.charkit.json', import.meta.url))).json(); } catch (e) { ctx.gcKit = null; } // RIG-GC-01
  try { const u = new URL('../../../../content/meshes/kenney/tree_oak.mesh.json', import.meta.url), meta = await (await fetch(u)).json(); ctx.lowpolyTreeMesh = typeof meta.bin === 'string' ? meshFromBin(meta, await (await fetch(new URL(meta.bin, u))).arrayBuffer()) : meshFromJSON(meta); /* MESH-BIN-01 */ } catch (e) { ctx.lowpolyTreeMesh = null; }
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
    rt, depth: depthBuffer, palette: assets.palette, gbuf, matTable, detailPass,
    lights: null, light: createLightBuffer(rt.cols, rt.rows), timeSec: 0, gpu: false,
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
  const stableRows = []; // US-073c (38.25 item 6): one `stable` row (2-frame pan), first suitable pitched pose
  let stableDone = false, stableWaterDone = false;
  const shadowRunner = renderer === 'mesh' && gpuPipeline.shadowOpts && gpuPipeline.shadowOpts.sun === 'map'
    ? createShadowParityRunner(gpuPipeline.shadowOpts.res) : null;
  // ENV-03c: synthetic 3-entry atmosphere table (day/dusk/night per entry: forest, meadow, fields); numbers in the 38.65 ranges
  const atmosSt = createAtmosState(), atmosDrv = { w: new Float32Array(3), wNone: 0, tod: new Float32Array(3), version: 0 };
  const atmosTable = (() => { const rec = (fog, dens, haze, hk, lift, gamma, gain, sat) => ({ fog: Float32Array.from(fog), fogDensity: dens, haze: Float32Array.from(haze), hazeAmount: hk, lift: Float32Array.from(lift), gamma: Float32Array.from(gamma), gain: Float32Array.from(gain), sat });
    const E = [[[150, 180, 150], [120, 130, 140], [30, 40, 60]], [[200, 210, 225], [220, 170, 150], [40, 45, 70]], [[210, 205, 180], [215, 180, 140], [45, 45, 65]]];
    const recs = []; E.forEach((e, i) => e.forEach((fog, s) => recs.push(rec(fog, 0.006 + 0.004 * i + 0.002 * s, fog.map((v) => Math.min(255, v + 20)), 0.5, [0.01 + 0.01 * s, 0.01, 0.02], [1 + 0.1 * i, 1.05, 1.1 - 0.1 * s], [1 - 0.2 * s, 1 - 0.15 * s, 1 - 0.1 * s], 1 - 0.1 * s)))); return { n: 3, recs }; })();
  const atmosOn = (a) => { for (let i = 0; i < 3; i++) { atmosDrv.w[i] = a.w[i]; atmosDrv.tod[i] = a.tod[i]; } atmosDrv.wNone = 1 - (a.w[0] + a.w[1] + a.w[2]); atmosDrv.version++; const f = atmosBase(); mixAtmos(atmosTable, atmosDrv, f, atmosSt); applyAtmosToPalette(assets.palette, atmosSt); };
  const postSt = createPostState(); // POST-STACK-01b: one composed state shared by the GPU sprites pass and the JS twin
  const atmosOff = () => { if (atmosSt.on) { atmosSt.on = false; applyAtmosToPalette(assets.palette, atmosSt); } };
  let atmosBaseRec = null;
  const atmosBase = () => { const P = assets.palette, f = P.fog.farBase || P.fog.far; if (!atmosBaseRec) atmosBaseRec = { start: f.start, full: f.full, curve: f.curve || 1, near: P.rgb[f.color], far: P.rgb[f.colorFar] }; return atmosBaseRec; };
  let restoreSun = null; // ME-15c: per-pose sun override (see applySunOverride)
  // `&pose=<text>` (US-055a2b): run only the poses whose name contains <text> (case-insensitive); the last one stays on the canvas = an owner look,
  // e.g. `?gpucompare=1&renderer=mesh&pose=water pond`. No filter = every pose.
  const poseQ = (params.get('pose') || '').toLowerCase();
  const poseRuns = poseQ ? runs.filter((r) => r.name.toLowerCase().includes(poseQ)) : runs;
  for (const { world, lights, name: poseName, cam, fade, dim, real, before, spritesExtra, needK8, meshOnly, maskPose, overlayOps, anchorShear, pitchedDefault, sun: sunOverride, hour: poseHour, atmos: poseAtmos, post: posePost, instAssert, vmAssert, decalAssert, timeSec: poseTime, carpet: carpetPose, gi: poseGi, under: underPose } of poseRuns) {
    if (world.carpet || world._carpetCtx) { world._carpetCtx = null; world.carpet = null; wg.setCarpet(null, null, 0); } // D2e: carpet poses only
    if (restoreSun) { restoreSun(); restoreSun = null; }
  for (const r of runs) if (r.lights) r.lights.gi = null; // GI-PROBE-05: leave no probe field on the shared light sets
    atmosOff(); // ENV-03c: previous pose's atmosphere off (one palette bump)
    if (meshOnly && renderer !== 'mesh') { console.log(`[gpucompare] SKIP ${poseName} (mesh renderer only)`); continue; }
    if (sunOverride) restoreSun = applySunOverride(world, lights, sunOverride);
    else if (Number.isFinite(poseHour)) restoreSun = applyHourOverride(world, lights, assets.palette, poseHour, ctx.sunEnabled); // DN-04b
    if (lights) lights.gi = poseGi && lights ? makeRowGI({ ...poseGi, hour: poseHour, lights }) : null; // GI-PROBE-05: only the gi* rows carry a probe field
    // US-053b (32.1): cleared before EVERY pose (not just the ones that never touch
    // particles) - only the `particles` pose's own `before()` hook repopulates it, so a
    // pose that runs after it never inherits stray live particles from a previous pose.
    if (engine.particles) engine.particles.clear();
    fbCompare.ripples = null; // US-055a: only the wadeSplash pose sets it
    resetInstances();
    if (world.terrain) while (terrainMeshSetFor(world.terrain).step(1000));
    if (real) {
      ctx.compareRipples = null;
      if (before) before();
      if (carpetPose) { // D2e: GPU side of the pose's carpet (calm wind unless the world has some)
        const nb = world.terrain.near, wp = world.wind && world.wind.params;
        wg.setCarpet(world.carpet, { data: nb.hDraw, w: nb.w, h: nb.h, x0: nb.x0, y0: nb.y0, cell: nb.cell }, 1);
        wg.setCarpetFrame(poseTime || 0, wp && wp.speed > 0 ? wp : null);
      }
      if (ctx.compareRipples) fbCompare.ripples = ctx.compareRipples;
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
    fbCompare.under = underPose ? createUnderState() : null; // SWIM-04c: underwater look state (both twins read fb.under; null = dry, untouched frame)
    fbCompare.timeSec = poseTime || 0; // US-141a: frozen per-pose clock (flow streaks); 0 for every other pose
    fbCompare.lights = lights;
    if (poseAtmos) atmosOn(poseAtmos); // ENV-03c: before the first frame so both twins see the same live fog/haze/grade
    if (wg && wg._spritesPass) { // POST-STACK-01b: composed grade (biome + preset) -> the atmos slots; null = today's pipeline
      if (posePost) { composePost(poseAtmos ? atmosSt : null, posePost, postSt); wg._spritesPass.post = postSt; wg._spritesPass.postAspect = (rt.cols * (rt.pxCellW || 1)) / (rt.rows * (rt.pxCellH || 1)); } else wg._spritesPass.post = null;
    }
    if (lights) lights.update(0, world);
    if (lights) lights.cloud = null; // S8-B2-12c: every gpucompare mode forces clouds off
    if (lights) lights.ao = null; // S8-B2-20 NEEDS B1 item (3): every gpucompare mode forces ao off
    fbCompare.sceneFade = typeof fade === 'number' ? fade : 1;
    if (sprites.pass) {
      sprites.pass.sceneFade = fbCompare.sceneFade;
      sprites.pass.setFadeLut(fadeLut);
      sprites.pass.setSceneDim(compareSceneDim);
    }
    if (real) sprites.pool.collect(world);
    else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
    if (spritesExtra) spritesExtra(sprites.pool); // SPELL-01b: view-only billboards (fireball core / blast)
    if (params.get('sprites') === '0' || params.get('gpucompare') === 'emissive') sprites.pool.reset(); // emissive: glow rows compare the pre-sprite stage // diagnostic (WG-3c): isolate shade/edge from the sprite layer WebGPU has not ported
    sprites.pool.project(cam, rt, lights || ambientL, world, renderer);
    // US-053b (32.1): particle layer, built once per pose from the current (just-cleared-
    // or-just-populated) engine.particles state - both twins below read the SAME layer.
    if (engine.particleLayer && (params.get('sprites') === '0' || params.get('gpucompare') === 'emissive')) engine.particleLayer.bind(cols, rows); // diagnostic: no particle cells either
    else if (engine.particleLayer) engine.particleLayer.build(engine.particles, cam, rt, lights || ambientL, world, assets.palette, renderer);

    engine.overlay.clear(); // RE-07b: per-pose ops (none for the old poses -> pass skipped)
    if (overlayOps) overlayOps(engine.overlay);
    poisonAllCells(rt.cells, n);
    engine.feedDetail(cam, true); // ENV-01a2: one shared fed set for both twins.
    fbCompare.frameNo++; // RE-15a fixes: once per pose, before both twins run (see fbCompare init above)
    fbCompare.gpu = true;
    renderWorld(fbCompare, world, cam);
    gpuPipeline.frame(fbCompare, lights || ambientL, cam, world);
    engine.overlay.flush(cam); // GPU path: JS raster, GpuOverlayPass / WgOverlayPass composites inside present()
    rt.present(); // the GPU twin's actual raster work (rt's registered cell-pass hook -> `_hook` -> `_prepRaster`'s
    // `buildList` call) runs INSIDE this call, not inside `gpuPipeline.frame()` above (which only stashes cam/world
    // refs) - `engine.viewModel.stats` is ONE shared object both twins write through, so this must be captured
    // right here, after `present()`, before the JS/mesh twin below overwrites it (BUG-VM-001 item 5).
    const vmItemsGpu = engine.viewModel ? engine.viewModel.stats.items : 0;
        // WG-3c: the WebGPU path still PRESENTS the CPU cells, so its GPU-shaded cells come from the pipeline's own final textures
    const rbw = wg ? await wg.readbackCells() : null;
    if (rbw && params.get('gpucompare') === 'emissive') { // EMIS-03/04: glow-off pass for the twin's input, then the real (glow) output stays in rbw
      if (!wg._glowRan) { overallOk = false; console.log('[gpucompare] FAIL emissive-glow: glow pass did not run (opts.glow missing or pass disabled)'); }
      else {
        const outFg = new Uint8Array(rbw.fg), outBg = new Uint8Array(rbw.bg), P = wg.glowOpt;
        wg.runtimeGlow(null);
        fbCompare.gpu = true; renderWorld(fbCompare, world, cam); wg.frame(fbCompare, lights || ambientL, cam, world); engine.overlay.flush(cam); rt.present();
        const rin = await wg.readbackCells(), gi = await gpuPipeline.readbackGeometry();
        wg.runtimeGlow(P);
        const up = unpackReadback(gi.GI, gi.GA, gi.Depth, cols, rows);
        const cg = compareGlow(up, cols, rows, emisFromPacked(matTable), new Uint8Array(rin.fg), new Uint8Array(rin.bg), outFg, outBg, P);
        for (const r of [cg.fg, cg.bg]) { rowsOut.push({ pose: r.pose, ok: r.ok, glow: r }); console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: max=${r.max} bad=${r.bad} live=${r.live} (tol 1, live>0)`); }
        overallOk = overallOk && cg.ok;
      }
    }
    const gpuFg = rbw ? rbw.fg : null, gpuBg = rbw ? rbw.bg : null;
    const { GI, GA, Depth } = await gpuPipeline.readbackGeometry();
    const lightBuf = await gpuPipeline.readbackLight(); // WG-3b: WebGPU too (null only while the pass is not ported)
    const waterBits = poseName.includes('waterfall') ? await gpuPipeline.readbackWater() : null; // WG-3e: WebGPU too
    if (maskPose && wg && wg._shadowPass && wg._shadowPass.casterList) { // ALPHA-01c: are the cards in the sun caster list, and drawn by the discard pipeline?
      const sh = wg._shadowPass, L = sh.casterList();
      let cards = 0, withMask = 0;
      for (let i = 0; i < L.count; i++) { const m = L.items[i].mesh; if (m && m.id === 'test/alphaCards') { cards++; if (m.maskRanges) withMask++; } }
      console.log(`[gpucompare] maskCasters ${poseName}: items=${L.count} cards=${cards} withMask=${withMask} maskDraws=${sh.maskDraws} raster.maskDraws=${wg._rasterPass ? wg._rasterPass.maskDraws : '?'}`);
    }
    if (shadowRunner) {
      const sd = wg ? await shadowRunner.runAsync(gpuPipeline) : shadowRunner.run(gpuPipeline);
      if (sd) {
        // ALPHA-01c: on a mask pose a leaf-shaped shadow is the gate: with the twin skipping the same fragments the >1024-code outliers (card depth vs the ground behind a masked-out texel) stay at the content baseline
        if (maskPose) sd.maskShadowOk = sd.hist.big < 200; // world_m1 content alone gives ~100-145 in every row; 5 opaque cards would add ~330
        shadowRows.push({ pose: `${poseName} [shadow depth parity]`, ok: sd.pass && (!maskPose || sd.maskShadowOk), shadowDepth: sd });
        console.log(`[gpucompare] shadowDepth ${sd.pass ? 'PASS' : 'FAIL'} ${poseName}: items=${sd.items} both=${sd.both} slopeAwareWithin=${sd.withinPct.toFixed(4)}%(>=99.9) flat16=${sd.within16Pct.toFixed(3)}% maxUlp=${sd.maxUlp} covMismatch=${sd.covMismatchPct.toFixed(4)}%(<=0.3, union ${sd.covMismatchUnionPct.toFixed(3)}%) gpuOnly=${sd.gpuOnly} jsOnly=${sd.jsOnly} outside16: le64=${sd.hist.le64} le1024=${sd.hist.le1024} big=${sd.hist.big} ratioHist(<=.02/.05/.1/.25/1/>1 texel)=${sd.ratioHist}`);
      } else {
        console.log(`[gpucompare] shadowDepth SKIP ${poseName} (no sun pass this pose)`);
      }
    }

    // STABLE-GATE-TEST-01 (38.25 amendment A): two sub-cases on the same 2-frame pan. (i) water drawn (first suitable pitched pose that really draws
    // water), (ii) water inactive (waterOn = 0, forced by switching the water pass off on the first other pitched pose). Each: 0 non-tie mismatches,
    // ties <= 0.5 %, liveness floor (twin used >= 20 % of non-sky, GPU held count == twin held count).
    const isWaterPose = /water|pond|river|fall/i.test(poseName);
    if (wg && wg._stablePass && cam && (cam.projection === 'pitched' || pitchedDefault) && cam.focusX === undefined
      && ((!stableDone && !isWaterPose) || (!stableWaterDone && isWaterPose))) {
      // pan 1 cm sideways + 0.05 deg (a sub-cell move: the stable pass only reuses history within 1.0/detail of the same surface point)
      const yr = (cam.yawDeg * Math.PI) / 180, camA = { ...cam }, camB = { ...cam, x: cam.x + 0.01 * Math.cos(yr), y: cam.y + 0.01 * Math.sin(yr), yawDeg: cam.yawDeg + 0.05 };
      const gpuFrame = (c) => () => { fbCompare.gpu = true; renderWorld(fbCompare, world, c); wg.frame(fbCompare, lights || ambientL, c, world); engine.overlay.flush(c); rt.present(); };
      const subs = isWaterPose ? [['water drawn', false]] : [['water inactive', true]];
      if (!isWaterPose) stableDone = true; // water poses keep trying until one really draws water
      for (const [label, waterOff] of subs) {
        const sr = await runStableRow(wg, camA, camB, gpuFrame(camA), gpuFrame(camB), { waterOff });
        // sub-case (i) is only meaningful when water really drew (waterOn): else it is an informational skip, never a silent pass
        const noWater = !waterOff && !sr.skipped && !sr.waterOn;
        if (!waterOff && sr.waterOn) stableWaterDone = true;
        const ok = noWater ? true : !!sr.ok;
        if (!noWater) stableRows.push({ pose: `stable pan (${poseName}) [webgpu stable, ${label}]`, ok, stable: sr });
        overallOk = overallOk && ok;
        console.log(`[gpucompare] ${noWater ? 'SKIP' : ok ? 'PASS' : 'FAIL'} stable pan (${poseName}, ${label}): ` + (sr.skipped ? `SKIPPED ${sr.reason}` : `waterOn=${sr.waterOn} histValid=${sr.histValid} used=${sr.usedPct.toFixed(1)}% live=${sr.livePct.toFixed(1)}% of non-sky (>=20) mismatches=${sr.mismatches} (must be 0) tieMismatches=${sr.tieMismatches} ties=${sr.tiePct.toFixed(3)}% (<=0.5) held twin/gpu=${sr.heldTwin}/${sr.heldGpu} held255=${sr.held255} vacuous=${sr.vacuous}${noWater ? ' (no water in view: sub-case not exercised)' : ''}${sr.bad && sr.bad.length ? ' e.g. ' + JSON.stringify(sr.bad[0]) : ''}`));
      }
    }

    const wasActive = rt.gpuActive;
    rt.gpuActive = false;
    fbCompare.gpu = false;
    try { renderWorld(fbCompare, world, cam); } catch (e) { e.message += ' [pose: ' + poseName + ']'; throw e; } // ENV-GATEFIX: name the failing pose
    // BUG-VM-001 (item 5): the JS/mesh twin's own `buildList` call (compositor.js's `renderWorldMesh`), right
    // after `renderWorld` above runs it - before anything else touches `engine.viewModel.stats`.
    const vmItemsJs = engine.viewModel ? engine.viewModel.stats.items : 0;
    drawSprites(fbCompare, sprites.pool, engine.particleLayer);
    if (fbCompare.fadeLut && typeof fbCompare.sceneFade === 'number') {
      clearMaskForSceneFade(fbCompare.rt);
      applySceneFade(fbCompare.rt, fbCompare.sceneFade, fbCompare.fadeLut);
    }
    applySceneDim(fbCompare.rt, compareSceneDim);
    if (posePost) postCells(fbCompare.rt, depthBuffer.depth, postSt); // POST-STACK-01b: JS twin of the whole chain (grade stage = composed set)
    else if (poseAtmos) gradeCells(fbCompare.rt, atmosSt); // ENV-03c: JS twin grade after fade/dim (the GPU does it in the sprites pass)
    rt.gpuActive = wasActive;
    if (overlayOps) engine.overlay.renderCpu(cam, rt.cells, depthBuffer.depth); // JS twin composite (WebGPU: judged by the final cell row)

    if (params.get('probe')) { // BUG-WHITE-PIXELS-02 r3 (dev): `&probe=col,row` 3x3 dump, `&probe=scan` sky-islands (a sky cell with >=6/8 solid neighbours) per side
      const pq = params.get('probe'), L = [], gK = (i) => GI[i * 4 + 1] & 0xff, side = (isG, x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? 1 : ((isG ? gK(y * cols + x) : gbuf.kind[y * cols + x]) !== 0 ? 1 : 0);
      if (pq === 'scan') {
        for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) for (const g of [true, false]) {
          if (side(g, x, y)) continue; let solid = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && side(g, x + dx, y + dy)) solid++;
          if (solid >= 6) { const i = y * cols + x; L.push(`${g ? 'GPUsky' : 'JSsky'}@${x},${y} solid=${solid} other(${g ? 'js' : 'gpu'})kind=${g ? gbuf.kind[i] : gK(i)} jsPlane=${gbuf.planeId[i]} jsZ=${(+gbuf.z[i]).toFixed(2)} gpuDepth=${Depth[i]}`); }
        }
        let nd = 0, gSkyJsSolid = 0, jsSkyGpuSolid = 0; const ex = [];
        for (let i = 0; i < cols * rows; i++) { const gk = gK(i), jk = gbuf.kind[i]; if ((gk !== 0) !== (jk !== 0)) { nd++; if (gk === 0) gSkyJsSolid++; else jsSkyGpuSolid++; if (ex.length < 12) ex.push(`${i % cols},${(i / cols) | 0}:g${gk}/j${jk}`); } }
        L.push(`skyDisagree=${nd} gpuSky/jsSolid=${gSkyJsSolid} jsSky/gpuSolid=${jsSkyGpuSolid} e.g. ${ex.join(' ')}`);
      } else {
        const [pc, pr] = pq.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (pr + dy) * cols + pc + dx; L.push(`(${pc + dx},${pr + dy}) gpuKind=${gK(i)} gpuDepth=${Depth[i]} gpuGI=${[0, 1, 2, 3].map((k) => GI[i * 4 + k]).join('/')} | jsKind=${gbuf.kind[i]} jsPlane=${gbuf.planeId[i]} jsZ=${(+gbuf.z[i]).toFixed(2)}`); }
      }
      (window.__gpuProbe = window.__gpuProbe || []).push({ pose: poseName, cols, rows, pq, L });
      console.log(`[gpucompare] probe ${poseName} (${cols}x${rows}) ${pq}: ` + (L.length ? L.join(' ## ') : 'none'));
    }
    const cmpGeom = compareGeometry(gbuf, depthBuffer.depth, GI, GA, Depth, cols, rows, {
      fogMax: fbCompare.detailPass ? fbCompare.detailPass.edges.fogMax : undefined, suppress: fbCompare.waterMask || null,
      table: matTable, jsLight: fbCompare.light, pitched: !!(cam && (cam.projection === 'pitched' || cam.projection === 'ortho' || pitchedDefault)), maskPose: !!maskPose,
    }); // PREC-04b2: oracle ties before cmpCells (exclude mask)
    const maskOk = !maskPose || cmpGeom.kind9Cells > 0; // ALPHA-01c: the fixture must be in view on the JS twin (else a pass would be vacuous)
    if (maskPose) console.log(`[gpucompare] maskTies ${poseName}: ${cmpGeom.maskTies}/${cmpGeom.maskTiesMax} k9=${cmpGeom.kind9Cells} holes=${cmpGeom.holes}${cmpGeom.holes ? ' cells ' + cmpGeom.holeCells.join(',') : ''}${maskOk ? '' : ' FIXTURE NOT IN VIEW'}`);
    // D2e: kind-10 (carpet) cell agreement on a carpet pose; its kind bar is 98 % (blade edges), every other pose keeps 99.5 %
    let carpetCov = null;
    if (carpetPose) {
      let both = 0, js = 0, gp = 0;
      for (let i = 0; i < cols * rows; i++) { const a = gbuf.kind[i] === 10, b = (GI[i * 4 + 1] & 0xff) === 10; if (a) js++; if (b) gp++; if (a && b) both++; }
      const agree = 100 * (1 - (js + gp - 2 * both) / (cols * rows));
      carpetCov = { js, gp, both, agree, ok: js > 0 && gp > 0 && agree >= 98 };
      console.log(`[gpucompare] carpetCoverage ${poseName}: kind10 js=${js} gpu=${gp} both=${both} cellAgree=${agree.toFixed(2)}% (>=98) ${carpetCov.ok ? 'OK' : 'FAIL'}`);
    }
    const kindBar = carpetPose ? 98 : 99.5;
    const geomBaseOkG = cmpGeom.kindMatchPct >= kindBar && cmpGeom.holes === 0 && cmpGeom.meshTiesOk && cmpGeom.texelTiesOk;
    // geometry-only verdict (same terms as the geometry half of the mesh gate below); recorded on both backends so a WebGL2 run is the WG-2b baseline
    const geomOk = cmpGeom.pass || (geomBaseOkG && cmpGeom.geomViolCells <= 4 && cmpGeom.violNonK8 === 0 && cmpGeom.aoViol === 0);
    if (wg) {
      const k8OkW = !(poseName.includes('voxel') || needK8) || compareNoVoxels || (cmpGeom.k8Cpu > 0 && cmpGeom.k8Gpu > 0);
      let instOkW = true;
      if (instAssert) { const st = engine.instances.stats; instOkW = st.instances + st.instancesCulled === instAssert.total && st.instancesCulled > 0 && st.instancesLod1 > 0 && st.instances > st.instancesLod1; }
      const vmOkW = !vmAssert || (vmItemsGpu > 0 && vmItemsJs > 0);
      // WG-3b/3d: light row (JS twin fb.light vs texLight), sun-map poses included (the WebGPU shadow map is ported: gated like WebGL2).
      const cmpLightW = lightBuf ? compareLight(fbCompare.light, lightBuf, gbuf.kind, cols, rows, cmpGeom.meshTieMask) : null;
      const lightWaits = false;
      const lightOkW = !cmpLightW || cmpLightW.pass;
      // WG-3c/3f: final cell row (shade + edge + sprites + particles + overlay + fade + dim), same bars as the WebGL2 rows, no waits.
      let cmpCellsW = null, cellsOkW = true, cellsWait = null;
      if (gpuFg) {
        cmpCellsW = compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.005, 64, false, cmpGeom.excludeMask);
        const cmpCellsMeshW = renderer === 'mesh' ? compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.01, meshCellCap(gpuPipeline.shadowOpts && gpuPipeline.shadowOpts.sun === 'map'), true, cmpGeom.excludeMask) : null;
        const geomBaseOkW = cmpGeom.kindMatchPct >= kindBar && cmpGeom.holes === 0 && cmpGeom.meshTiesOk && cmpGeom.texelTiesOk;
        const meshColourOkW = renderer === 'mesh' && geomBaseOkW && cmpGeom.geomViolCells <= 4 && cmpGeom.violNonK8 === 0 && cmpGeom.aoViol === 0 &&
          cmpCellsW.glyphMatchPct >= 99.5 && cmpCellsW.poisonedSurvivors === 0 && cmpCellsMeshW.pass;
        const pitchedHashOkW = renderer === 'mesh' && cam && (cam.projection === 'pitched' || cam.projection === 'ortho' || pitchedDefault) && geomBaseOkW &&
          cmpCellsW.outsideFrac <= 0.005 && cmpCellsW.glyphMatchPct >= 99.9 && cmpCellsW.bgMax <= 64 && cmpCellsW.poisonedSurvivors === 0;
        cellsOkW = !!(cmpCellsW.pass || meshColourOkW || pitchedHashOkW);
      }
      const waterfallW = waterfallRow(poseName, waterBits, fbCompare.water, n, cols, rows);
      const okW = maskOk && (!carpetCov || carpetCov.ok) && geomOk && k8OkW && instOkW && vmOkW && lightOkW && cellsOkW && (!waterfallW || waterfallW.pass);
      overallOk = overallOk && okW;
      console.log(`[gpucompare] ${okW ? 'PASS' : 'FAIL'} ${poseName} [webgpu geometry]: kind=${cmpGeom.kindMatchPct.toFixed(2)}% holes=${cmpGeom.holes} geomViolCells=${cmpGeom.geomViolCells} violNonK8=${cmpGeom.violNonK8} depthViol=${cmpGeom.depthViol} uvViol=${cmpGeom.uvViol} faceViol=${cmpGeom.faceViol} nrmViol=${cmpGeom.nrmViol} nrmMaxDeg=${cmpGeom.nrmMaxDeg} k8cpu=${cmpGeom.k8Cpu} k8gpu=${cmpGeom.k8Gpu} inst=${instOkW} vm=${vmOkW}(${vmItemsGpu}/${vmItemsJs}) cells=${cmpCellsW ? (cellsWait ? 'WAIT-' + cellsWait + '(glyph ' + cmpCellsW.glyphMatchPct.toFixed(2) + '%, fgOut ' + cmpCellsW.fgOutside + ')' : (cellsOkW ? 'OK' : 'MISMATCH') + '(glyph ' + cmpCellsW.glyphMatchPct.toFixed(2) + '%, fgOut ' + cmpCellsW.fgOutside + ', bgOut ' + cmpCellsW.bgOutside + ', fgMax ' + cmpCellsW.fgMax + ', bgMax ' + cmpCellsW.bgMax + ', outside ' + (cmpCellsW.outsideFrac * 100).toFixed(3) + '%, poisoned ' + cmpCellsW.poisonedSurvivors + ')') : 'n/a'} light=${cmpLightW ? (cmpLightW.pass ? 'OK' : lightWaits ? 'WAIT-WG3d' : 'MISMATCH') : 'n/a'}${cmpLightW ? `(sunlit ${cmpLightW.sunlitMismatch}, dLMax ${cmpLightW.dLMax.toFixed(4)}, dLViol ${cmpLightW.dLViol}, nMismatch ${cmpLightW.nMismatch})` : ''} stats=${JSON.stringify({ mesh: gpuPipeline.stats.meshDraws, voxel: gpuPipeline.stats.voxelDraws, vm: gpuPipeline.stats.vmDraws, inst: gpuPipeline.stats.instancedDraws, gpuCull: gpuPipeline.stats.gpuCullDraws || 0, cloth: gpuPipeline.stats.clothDraws })}`);
      rowsOut.push({ ...(waterfallW ? { waterfall: waterfallW } : {}), pose: poseName, cmpGeom, cmpLight: cmpLightW, cmpCells: cmpCellsW, cellsWait, lightWaits, ok: okW, geomOk, wg: true, k8Ok: k8OkW, instOk: instOkW, vmOk: vmOkW, ...(vmAssert ? { vmItemsGpu, vmItemsJs } : {}) });
      continue;
    }
  }
  if (restoreSun) { restoreSun(); restoreSun = null; }
  resetInstances();
  overallOk = overallOk && sampledOwnTextures;
  for (const r of shadowRows) overallOk = overallOk && r.ok;
  atmosOff();
  if (wg && wg._spritesPass) wg._spritesPass.post = null; // POST-STACK-01b
  fbCompare.sceneFade = 1;
  if (sprites.pass) sprites.pass.sceneFade = 1;
  resetSceneDim(compareSceneDim);
  if (sprites.pass) sprites.pass.setSceneDim(compareSceneDim);

  let infoRows = null;
  // WG-3a: with `?rays=2` the WebGPU pipeline also gets the INFO n=2 geometry rows (resolved cell-res set, kind%/holes vs the JS twin, no cells compare yet).
  if (rayParam === 2) {
    const base2 = wg; // same terrain/voxel/view-model/instance inputs as the rays-1 pipeline
    const pipeline2 = new base2.constructor(rt, { rays: 2, terrainEnabled: base2.terrainEnabled, shadows: base2.shadowOpts, gpuCull: base2.gpuCull });
    if (pipeline2.ready) {
      pipeline2.bind(matTable, assets.palette);
      pipeline2.setSource('scene');
      pipeline2.bindVoxels(base2._voxelPool); pipeline2.bindViewModel(base2._viewModel); pipeline2.bindInstances(base2._instances);
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
        if (lights) lights.cloud = null; // S8-B2-12c: every gpucompare mode forces clouds off
        if (lights) lights.ao = null; // S8-B2-20 NEEDS B1 item (3): every gpucompare mode forces ao off
        if (real) sprites.pool.collect(world);
        else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
        sprites.pool.project(cam, rt, lights || ambientL, world);

        poisonAllCells(rt.cells, n);
        fbCompare.gpu = true;
        renderWorld(fbCompare, world, cam);
        pipeline2.frame(fbCompare, lights || ambientL, cam, world);
        rt.present();
                const { GI: GI2, GA: GA2, Depth: Depth2 } = await pipeline2.readbackGeometry();

        const wasActive2 = rt.gpuActive;
        rt.gpuActive = false;
        fbCompare.gpu = false;
        renderWorld(fbCompare, world, cam);
        drawSprites(fbCompare, sprites.pool);
        rt.gpuActive = wasActive2;

        const cmpCells2 = { glyphMatchPct: NaN }; // WebGPU: cells are judged by the main rows
        const cmpGeom2 = compareGeometry(gbuf, depthBuffer.depth, GI2, GA2, Depth2, cols, rows);
        infoRows.push({ pose: poseName, cmpCells: cmpCells2, cmpGeom: cmpGeom2, kindOk: cmpGeom2.kindMatchPct >= 99.5 });
        console.log(`[gpucompare] INFO n=2 ${poseName}: kind=${cmpGeom2.kindMatchPct.toFixed(2)}%(>=99.5% required) glyph=${cmpCells2.glyphMatchPct.toFixed(2)}%(reported only) holes=${cmpGeom2.holes}`);
      }
      // 38.8a 26b: the constructor re-hooked rt.setCellPass; release pipeline2's GPU resources and give the hook back to the rays-1 pipeline
      pipeline2.dispose();
      if (base2.ready) base2.setEnabled(true);
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
    if (r.wg) { text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose} [webgpu geometry]  kind ${r.cmpGeom.kindMatchPct.toFixed(2)}%  holes ${r.cmpGeom.holes}  geomViolCells ${r.cmpGeom.geomViolCells}  depthViol ${r.cmpGeom.depthViol}  uvViol ${r.cmpGeom.uvViol}
`; continue; }
  }
  for (const r of shadowRows) {
    const d = r.shadowDepth;
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n  items ${d.items}  co-covered ${d.both}  within 16 ULP+0.05 texel ${d.withinPct.toFixed(4)}% (>=99.9%)  flat 16 ULP ${d.within16Pct.toFixed(3)}%  maxUlp ${d.maxUlp}  coverage mismatch ${d.covMismatchPct.toFixed(4)}% (<=0.3%)\n`;
  }
  for (const r of stableRows) text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n  ` + (r.stable.skipped ? `skipped: ${r.stable.reason}` : `history cells ${r.stable.usedPct.toFixed(1)}% (live ${r.stable.livePct.toFixed(1)}% of non-sky, >=20)  mismatches ${r.stable.mismatches} (must be 0)  tie mismatches ${r.stable.tieMismatches}  ties ${r.stable.tiePct.toFixed(3)}% (<=0.5%)  held twin/gpu ${r.stable.heldTwin}/${r.stable.heldGpu}  waterOn ${r.stable.waterOn}`) + '\n';
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
  const droppedFrames = (rt && rt.failedFrames) || 0; // FIX-RING: a dropped frame means the compare images are suspect
  if (droppedFrames > 0) { overallOk = false; console.error(`[gpucompare] FAIL: ${droppedFrames} GPU frame(s) dropped`); }
  window.__gpuCompare = { rows: rowsOut.concat(shadowRows, stableRows), ok: overallOk, infoRows, droppedFrames };
}

/**
 * ME-16f (38.22 item 4): ?gpucompare=pointshadow - tower interior pose pointShadowTorch (3 torches + carried lamp), compares L + litCount
 * against the JS twin (engine/mesh/pointShadowJS.js via fb.pointShadowOpts). PENDING until ME-16e lands the GPU host: the row is skipped, never fails.
 */
async function runGpuComparePointShadowPending() {
  const rows = [{ pose: 'world_m1: pointShadowTorch', ok: true, skipped: true, note: 'needs ME-16e' }];
  console.log('[gpucompare] SKIP pointshadow world_m1: pointShadowTorch (needs ME-16e: GPU point-shadow host not wired yet)');
  window.__gpuCompare = { rows, ok: true, infoRows: [] };
}

export function run(ctx) {
  const mode = ctx.params.get('gpucompare');
  if (mode === '1' || mode === 'emissive') return runGpuCompareSceneMode(ctx).catch((e) => { console.error('[gpucompare] failed:', e); throw e; });
  else if (mode === 'shade') return runGpuCompareShadeMode(ctx).catch((e) => { console.error('[gpucompare] failed:', e); throw e; });
  else if (mode === 'pointshadow') return runGpuComparePointShadowPending();
  else throw new Error('gpucompare mode must be 1 (mesh twin), shade or emissive');
}
