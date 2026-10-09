// engine/render/compositor.js (US-025, docs/architecture.md 7.3/8). The
// world-level frame pipeline: sorts placed structures near-to-far, casts
// each into the shared FrameBuffers, then the terrain, then the deferred
// shading passes (US-028) and finally the sky - replacing the manual
// beginFrame/castSectors/.../fillSky sequence main.js used to write out by
// hand for a single bare level (US-024).
import { windSwayOn, SWAY_SHADOW_HZ } from '../mesh/sway.js';
import { fillSky, ambientL, primeAmbientLight } from './sky.js';
import { shadeTerrainCells } from './terrainShade.js';
import { computeDerivatives, shadeSurfaces } from './detailShade.js';
import { edgePass } from './edgePass.js';
import { lightSurfaces } from './lighting.js';
// ME-06 (27.15.5a item 6): the JS-twin oracle for `fb.renderer === 'mesh'` -
// same `DrawList`/`rasterJS` path the GPU raster pass (`GpuCellPipeline.
// _passRaster`) draws, so `?gpucompare=1&renderer=mesh` compares the GPU
// mesh output against a JS mesh twin instead of the CPU DDA (27.7 item 2 can
// only hold that way - see 27.15.5a item 6's "Oracle rule").
import { DrawList, LevelMeshCache, MeshDrawCache, addStructures, addMeshStructures, addCloths } from '../mesh/DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from '../mesh/meshGroups.js';
import { rasterDrawList, copyToGBuffer, createRasterTarget, clearRasterTarget, clearRasterDepth } from '../mesh/rasterJS.js';
import { terrainMeshSetFor } from '../mesh/terrainMesh.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../mesh/voxelMesh.js';
import { projTerms, shearProjection, createPitchedTerms, pitchedTerms, resolveProjection, assertProjectionRenderer, pitchedFogScale, orthoHashCell, isPitchedFamily } from './projection.js';
import { lodCentreX, lodCentreY } from '../core/camFocus.js';
import { frustumPlanes } from '../mesh/culling.js';
import { renderWaterJS } from './water.js';
import { waterCompositeJS } from './waterComposite.js';
// ME-15c (27.9a): JS twin of the GPU sun shadow pass (same list builder, matrix, polygon offset, depth-only raster).
import { SUN_OFF_MATRIX, createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar } from './shadowSun.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../mesh/shadowList.js';
import { createPointShadowTwin, updatePointShadowTwin } from '../mesh/pointShadowJS.js'; // ME-16f

const MAX_STRUCTS = 8; // structSeq is a 3-bit field (arch 7.2) - never exceeded, never wrapped.
// ---------------------------------------------------------------------------
// ME-06 mesh JS twin (27.15.5a item 6) - module-level scratch, zero
// allocation per frame (27.7 item 5). Same fog-far cull constant
// (`GpuCellPipeline._passRaster`'s literal 2000) and the same MAX_STRUCTS
// cap the DDA structFoot loop above uses.
// ---------------------------------------------------------------------------
const meshDrawList = new DrawList();
const meshTerms = {
  cols: 0, rows: 0, eyeX: 0, eyeY: 0, eyeZ: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0,
  tanHalf: 0, planeDistX: 0, planeDistY: 0, horizonRow: 0, tanPitch: 0,
};
const meshViewProj = new Float64Array(16);
// RE-02a (28.1 A2): the pitched twin's terms (filled by renderWorldMesh) + the raw-depth scratch the
// horizontal-distance shading pass swaps in and out (see `renderWorld`).
const meshPitchTerms = createPitchedTerms();
let meshPitched = false;
let meshHashCell = 0; // BUG-RTS-001 (28.11a)
let pitchDepthSave = /** @type {Float32Array|null} */ (null);
const meshFrustumPlanes = new Float64Array(24);
const meshStructFoot = new Float64Array(MAX_STRUCTS * 4);
const meshGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
const meshCtx = { M: meshViewProj, kind7Mat: null, structFoot: null, structCount: 0, team: null };
/** @type {WeakMap<import('../world/World.js').World, LevelMeshCache>} */
const _meshLevelMeshCaches = new WeakMap();
/** @type {import('../mesh/rasterJS.js').RasterTarget|null} */
let _meshRasterTarget = null;

// ME-15c: JS sun shadow map state (module scratch, rebuilt per mesh frame when `fb.shadowOpts.sun === 'map'`).
const sunShadowList = createShadowList();
const sunShadowMat = createSunShadowMatrix();
const sunShadowCentreV = new Float64Array(3);
const sunShadowWorldZ = { min: 0, max: 0 };
const sunShadowSrc = { centre: { x: 0, y: 0, z: 0 }, cache: /** @type {any} */ (null), terrainSet: /** @type {any} */ (null), voxelPool: /** @type {any} */ (null), voxelMeshCache: sharedVoxelMeshCache, fogFarM: 2000, eye: { x: 0, y: 0 }, meshLod0M: 25, instCastM: 48, instances: /** @type {any} */ (null), cloths: /** @type {any} */ (null), matIdFor: /** @type {any} */ (undefined) };
const sunShadowRasterCtx = { M: sunShadowMat.M, depthBias: { factor: 0, units: 0 }, structFoot: /** @type {any} */ (null), structCount: 0 };
/** What `lightSurfaces` reads (`fb.sunMap`): {map, M, opts}. */
const sunMapState = { map: /** @type {any} */ (null), M: sunShadowMat.M, opts: /** @type {any} */ (null) };
/** @type {import('../mesh/rasterJS.js').RasterTarget|null} */
let _sunShadowTarget = null;
/** GFX-03 `shadows.sun: 'off'`: no map, no pass; `sunShadowTaps` sees every receiver outside the box (SUN_OFF_MATRIX) = fully sunlit. */
const sunOffState = { map: /** @type {any} */ (null), M: SUN_OFF_MATRIX, opts: /** @type {any} */ (null) };

/**
 * Renders the sun shadow map for this frame (called by `renderWorldMesh` after the camera list was built and
 * culled) and publishes it as `fb.sunMap`; `null` when shadows.sun is not 'map' or there is no sun.
 */
const _windCtx = { field: /** @type {any} */ (null), t: 0 };
/** Wind ctx for rasterDrawList (null = calm): world wind field + fb.timeSec, the clock passRaster/passShadow pack into the wind uniforms. */
export function windCtx(world, fb, quantised = false) {
  if (!windSwayOn(world.wind)) return null;
  const t = fb.timeSec || 0;
  // quantised (sun map): same 10 Hz step as windShadowKey, so the map is a pure function of its dirty key
  _windCtx.field = world.wind; _windCtx.t = quantised ? Math.floor(t * SWAY_SHADOW_HZ) / SWAY_SHADOW_HZ : t;
  return _windCtx;
}
function renderSunShadowJS(fb, world, cam, cameraList, cache, terrainMeshSet, structCount) {
  const so = fb.shadowOpts;
  const sun = fb.lights && fb.lights.sun;
  fb.sunMap = null;
  if (so && so.sun === 'off' && sun && sun.on) { sunOffState.opts = so; fb.sunMap = sunOffState; return; }
  if (!so || so.sun !== 'map' || !sun || !sun.on) return;
  if (!_sunShadowTarget || _sunShadowTarget.cols !== so.res) _sunShadowTarget = createRasterTarget(so.res, so.res, 1, { depthOnly: true });
  else clearRasterTarget(_sunShadowTarget);
  sunShadowCentre(cam, so, sunShadowCentreV);
  const src = sunShadowSrc, c = src.centre;
  c.x = sunShadowCentreV[0]; c.y = sunShadowCentreV[1]; c.z = sunShadowCentreV[2];
  src.cache = cache;
  src.terrainSet = terrainMeshSet;
  const vp = fb.voxelPool;
  if (vp && vp.shadowView) { vp.projectShadow(); src.voxelPool = vp.shadowView; } else src.voxelPool = null;
  src.instances = fb.instances || null;
  src.eye.x = lodCentreX(cam); src.eye.y = lodCentreY(cam); src.meshLod0M = so.meshLod0M; src.instCastM = so.instCastM; src.meshCastM = so.meshCastM; src.meshCastCap = so.meshCastCap; // ME-15f / MESH-SHADOW-02
  src.fogFarM = sunShadowFogFar(fb.palette, so);
  src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null; // CLOTH-1b1
  src.matIdFor = fb.matTable ? fb.matTable.idFor : undefined;
  src.meshCache = sharedMeshDrawCache; // ME-14c2 (37.1 item 6)
  src.meshIdFor = fb.matTable ? strictMatIdFor(fb.matTable) : undefined;
  src.maskAtlas = world.maskAtlas || null; // ALPHA-01f-fix2
  shadowWorldZ(world, cache, sunShadowWorldZ);
  const sm = shadowSunMatrix(sun.dir, sunShadowCentreV, so, sunShadowWorldZ, sunShadowMat);
  buildShadowList(sunShadowList, cameraList, world, sm.planes, src);
  const ctx = sunShadowRasterCtx;
  ctx.depthBias.factor = so.depthBias[0]; ctx.depthBias.units = so.depthBias[1];
  ctx.structFoot = meshStructFoot; ctx.structCount = structCount;
  ctx.maskAtlas = world.maskAtlas || null; // ALPHA-01b
  ctx.wind = windCtx(world, fb, true); // FOLIAGE-SWAY-01: same field + 10 Hz-quantised clock as the GPU shadow pass
  rasterDrawList(sunShadowList, _sunShadowTarget, ctx);
  sunMapState.map = _sunShadowTarget; sunMapState.opts = so;
  fb.sunMap = sunMapState;
}

/**
 * ME-16f (38.22): JS twin of the GPU point-light shadow pass. Opt-in: fb.pointShadowOpts = resolvePointShadowOptions(...) with n > 0.
 * Publishes fb.lights.pointShadow ({depth,res,slot,O,opts}, read by lightAt); off (default) never touches the lights = byte-identical.
 */
const pointTwin = createPointShadowTwin();
const pointSrc = { centre: { x: 0, y: 0, z: 0 }, cache: /** @type {any} */ (null), terrainSet: /** @type {any} */ (null), voxelPool: /** @type {any} */ (null), voxelMeshCache: sharedVoxelMeshCache, fogFarM: 2000, eye: { x: 0, y: 0 }, meshLod0M: 25, instCastM: 48, instances: /** @type {any} */ (null), cloths: /** @type {any} */ (null), matIdFor: /** @type {any} */ (undefined), gpu: null };
const pointRasterExtras = { structFoot: /** @type {any} */ (null), structCount: 0, wind: /** @type {any} */ (null), maskAtlas: /** @type {any} */ (null) };
let _pointWorld = null, _pointCameraList = null;
function buildPointCasters(list, O, radius, planes) {
  const src = pointSrc, c = src.centre;
  c.x = O[0]; c.y = O[1]; c.z = O[2]; src.eye.x = O[0]; src.eye.y = O[1];
  src.instCastM = radius; src.fogFarM = radius + 64;
  buildShadowList(list, _pointCameraList, _pointWorld, planes, src);
}
function renderPointShadowsJS(fb, world, cam, cameraList, cache, terrainMeshSet, structCount) {
  const lights = fb.lights, po = fb.pointShadowOpts;
  if (!lights) return;
  if (!po || !(po.n > 0)) { if (lights.pointShadow) lights.pointShadow = null; return; }
  const src = pointSrc, vp = fb.voxelPool;
  src.cache = cache; src.terrainSet = terrainMeshSet;
  if (vp && vp.shadowView) { vp.projectShadow(); src.voxelPool = vp.shadowView; } else src.voxelPool = null;
  src.instances = fb.instances || null;
  src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null;
  src.matIdFor = fb.matTable ? fb.matTable.idFor : undefined;
  src.meshCache = sharedMeshDrawCache;
  src.meshIdFor = fb.matTable ? strictMatIdFor(fb.matTable) : undefined;
  src.maskAtlas = world.maskAtlas || null;
  pointRasterExtras.structFoot = meshStructFoot; pointRasterExtras.structCount = structCount;
  pointRasterExtras.maskAtlas = world.maskAtlas || null;
  pointRasterExtras.wind = windCtx(world, fb, true);
  _pointWorld = world; _pointCameraList = cameraList;
  lights.pointShadow = updatePointShadowTwin(pointTwin, lights, cam, po, buildPointCasters, pointRasterExtras);
  _pointWorld = _pointCameraList = null;
}

/** Resolved-materials draw copies of placed glTF meshes (ME-14c2); per mesh, rebuilt when the matTable's idFor changes. */
const sharedMeshDrawCache = new MeshDrawCache();
/** MESH-INST-01: CPU batching of repeated placed meshes (the JS twin of GpuCellPipeline's own set). */
const sharedMeshGroups = new MeshGroupSet();
/** TREES-LP-b: the `meshDraw` argument of `InstanceGroups.addToDrawList` (kind-9 mesh groups); idFor refreshed per frame. */
const meshDrawArg = { cache: sharedMeshDrawCache, idFor: /** @type {any} */ (null) };
const _strictIdFor = new WeakMap();
/** matTable.idFor that throws on a key the palette/detail pass does not define (idFor itself invents ids). Stable identity per table. */
function strictMatIdFor(table) {
  let f = _strictIdFor.get(table);
  if (!f) {
    f = (key) => {
      if (!table.hasKey(key)) throw new Error(`mesh material: palette key "${key}" is not defined in the palette / detail pass`);
      return table.idFor(key);
    };
    _strictIdFor.set(table, f);
  }
  return f;
}
function meshLevelMeshCacheFor(world, matTable) {
  let cache = _meshLevelMeshCaches.get(world);
  if (!cache) {
    cache = new LevelMeshCache(matTable ? matTable.idFor : undefined);
    _meshLevelMeshCaches.set(world, cache);
  }
  return cache;
}

function meshRasterTargetFor(cols, rows) {
  if (!_meshRasterTarget || _meshRasterTarget.cols !== cols || _meshRasterTarget.rows !== rows) {
    _meshRasterTarget = createRasterTarget(cols, rows, 1);
  } else {
    clearRasterTarget(_meshRasterTarget);
  }
  return _meshRasterTarget;
}

/**
 * `fb.renderer === 'mesh'` twin of the DDA block below (structs loop +
 * `castTerrain`): builds the exact same `DrawList` the GPU raster pass
 * draws (`addStructures` + the shared `TerrainMeshSet`, `terrainMeshSetFor`
 * - one cache, one object, both twins), rasterises it with `rasterJS.js`
 * and copies the `n === 1` result into `fb.gbuf`/`fb.depth.depth` exactly
 * like `GpuCellPipeline._passRaster` fills the GPU G-buffer. Voxel props
 * (ME-08b) are added as mesh items too; `castModels` does not run on mesh.
 * @param {Object} fb
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 */
function renderWorldMesh(fb, world, cam) {
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows;
  meshGrid.cols = cols; meshGrid.rows = rows;
  meshGrid.pxCellW = (fb.rt && fb.rt.pxCellW) || 1;
  meshGrid.pxCellH = (fb.rt && fb.rt.pxCellH) || 1;
  meshPitched = isPitchedFamily(resolveProjection(cam, fb.renderer || 'mesh'));
  projTerms(cam, meshGrid, meshTerms);
  // The JS deriv fallback reads `gbuf.cam` (castSectors normally sets it; it never runs on mesh), so
  // write it on every mesh frame (RE-02a review: shear frames left it stale / at defaults).
  // GPU `_passDeriv` uses the shear constants for every camera (28.1 A2: deriv unchanged) - same here.
  fb.gbuf.cam.tanHalfHFov = meshTerms.tanHalf; fb.gbuf.cam.cols = cols; fb.gbuf.cam.planeDistY = meshTerms.planeDistY;
  if (meshPitched) {
    pitchedTerms(cam, meshGrid, meshPitchTerms);
    meshViewProj.set(meshPitchTerms.M);
    const tr = world.terrain;
    // BUG-FP-002: per-cell mode on every pitched frame; ortho (38.19): positive fixed cell (constant ground m per column)
    meshHashCell = meshPitchTerms.ortho ? orthoHashCell(meshPitchTerms, cols) : -(2 * meshPitchTerms.tanHalfX / cols);
    meshCtx.ortho = meshPitchTerms.ortho === 1;
  } else {
    shearProjection(meshTerms, meshViewProj);
    meshCtx.ortho = false;
  }
  frustumPlanes(meshViewProj, meshFrustumPlanes);

  const list = meshDrawList;
  list.begin();
  const cache = meshLevelMeshCacheFor(world, fb.matTable);
  addStructures(list, world, cam, cache, 2000);
  // ME-14c2 (37.1 item 7): imported glTF meshes (kind 9), right after the level structures. Needs a palette-bound matTable.
  if (fb.matTable) addMeshStructuresBatched(list, world, cam, sharedMeshDrawCache, strictMatIdFor(fb.matTable), 2000, sharedMeshGroups, meshFrustumPlanes);

  let terrainMeshSet = null;
  if (fb.terrainEnabled !== false && world.terrain) {
    terrainMeshSet = terrainMeshSetFor(world.terrain);
    terrainMeshSet.step(2);
    terrainMeshSet.addToDrawList(list, cam);
  }
  // ME-08b (27.16 item 5/7): voxel props from the pool (already posed and
  // screen-culled by `VoxelPool.project`), same cache the GPU pass uses.
  const voxelPool = fb.voxelPool;
  if (voxelPool && voxelPool.list.length > 0) {
    addVoxelInstances(list, voxelPool, sharedVoxelMeshCache, voxelPool.partNamesFor);
  }
  // RE-06 (28.6): instanced unit groups (engine.instances) after the ME-08 items, before the cull.
  // RE-15a fixes (28.13 point 4, PC-B Q7 item 1): per-instance cull + compaction
  // (`meshFrustumPlanes`, same viewProj as `list.cull` below), memoized on the host-owned
  // `fb.frameNo` (one shared counter, bumped once per actual rendered frame by the caller -
  // main.js's render tick / gpucompare's per-pose bump - not by this twin) so the CPU mesh
  // twin and `GpuCellPipeline`'s GPU pass agree on the same frame even if they're called an
  // uneven number of times. F3 stats copied onto `fb.loop.stats` (27.16 item 5 precedent:
  // `fb.loop.stats.structuresCulled` above, same "only when a Loop is wired" guard).
  if (fb.instances) {
    meshDrawArg.idFor = fb.matTable ? strictMatIdFor(fb.matTable) : null; // TREES-LP-b: kind-9 mesh groups
    meshDrawArg.maskAtlas = world.maskAtlas || null; // ALPHA-01f-fix2
    fb.instances.addToDrawList(list, sharedVoxelMeshCache, meshFrustumPlanes, fb.frameNo, meshViewProj, rows, meshDrawArg);
    if (fb.loop && fb.loop.stats) {
      fb.loop.stats.instances = fb.instances.stats.instances;
      fb.loop.stats.instancesCulled = fb.instances.stats.instancesCulled;
      fb.loop.stats.instancesLod1 = fb.instances.stats.instancesLod1;
    }
  }
  // CLOTH-1b1 (33.5): cloth meshes after the voxel feed (JS twin only; the GPU pass draws them from CLOTH-1b2).
  if (world.cloths && world.cloths.count > 0) addCloths(list, world.cloths, meshFrustumPlanes, fb.matTable ? fb.matTable.idFor : undefined);
  meshCtx.team = fb.matTable ? fb.matTable.team : null;
  list.cull(meshFrustumPlanes);

  const target = meshRasterTargetFor(cols, rows);
  if (terrainMeshSet) {
    meshCtx.kind7Mat = terrainMeshSet.typeAtFn;
    const structs = world.structures || [];
    let structCount = 0;
    for (let i = 0; i < structs.length && structCount < MAX_STRUCTS; i++) {
      if (structs[i].kind === 'mesh') continue; // ME-14c1: imported meshes carve no terrain footprint
      const b = structs[i].bbox;
      if (!b) continue;
      const o4 = structCount * 4;
      meshStructFoot[o4] = b.x0; meshStructFoot[o4 + 1] = b.y0; meshStructFoot[o4 + 2] = b.x1; meshStructFoot[o4 + 3] = b.y1;
      structCount++;
    }
    meshCtx.structFoot = meshStructFoot;
    meshCtx.structCount = structCount;
  } else {
    meshCtx.kind7Mat = null;
    meshCtx.structFoot = null;
    meshCtx.structCount = 0;
  }
  meshCtx.maskAtlas = world.maskAtlas || null; // ALPHA-01b
  meshCtx.wind = windCtx(world, fb); // FOLIAGE-SWAY-01: JS twin of the raster wind uniforms
  rasterDrawList(list, target, meshCtx);
  // US-078a (architecture.md 30.1): first-person view model, same pass after a depth-only clear (twin of the GPU
  // `_passRaster` tail); off on pitched frames and when nothing is shown.
  const vmList = fb.viewModel ? fb.viewModel.buildList(cam, meshPitched) : null;
  if (vmList) {
    clearRasterDepth(target);
    rasterDrawList(vmList, target, meshCtx);
  }
  copyToGBuffer(target, fb.gbuf, fb.depth.depth);
  // US-055a2a (35.3): the water layer (own target, fb.water; the composite reads it from US-055a2b). No-op without regions.
  if ((world.water && world.water.count > 0) || (world.waterfalls && world.waterfalls.length > 0)) renderWaterJS(fb, world, cam, meshViewProj, meshFrustumPlanes);
  else if (fb.water) fb.water = null;
  renderSunShadowJS(fb, world, cam, list, cache, terrainMeshSet, meshCtx.structCount);
  renderPointShadowsJS(fb, world, cam, list, cache, terrainMeshSet, meshCtx.structCount);
}

/** Swaps `depth` to horizontal forward distance (`toShade`) and back from the saved raw copy. Zero alloc once warm. */
function scaleDepthForShade(depth, cols, rows, toShade) {
  if (!toShade) { depth.set(/** @type {Float32Array} */ (pitchDepthSave)); return; }
  if (!pitchDepthSave || pitchDepthSave.length !== depth.length) pitchDepthSave = new Float32Array(depth.length);
  pitchDepthSave.set(depth);
  for (let y = 0; y < rows; y++) {
    const k = pitchedFogScale(meshPitchTerms, y);
    const base = y * cols;
    for (let x = 0; x < cols; x++) {
      const d = depth[base + x];
      if (d !== Infinity) depth[base + x] = d * k;
    }
  }
}

/** Clears the mesh frame buffers; no column spans remain. */
export function beginFrame(fb) {
  fb.depth.clear();
  if (fb.gbuf) fb.gbuf.beginFrame();
}

/**
 * @param {Object} fb - FrameBuffers ({ rt, depth, palette, gbuf?, matTable?, detailPass?, lights, timeSec, loop? })
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 */
export function renderWorld(fb, world, cam) {
  assertProjectionRenderer(cam, fb.renderer); // RE-02a: 'pitched' needs renderer 'mesh'
  // US-030a AC "the CPU caster no longer runs on the gl2 path": when a
  // ready GPU pipeline owns this frame's cast (`fb.gpu`, set by
  // main.js), skip the entire CPU cast/derivative/shade/edge/sky sequence
  // below - `GpuCellPipeline.js`'s present hook does all of it itself
  // (`_passCast`/`_passDeriv`/`_passShade`/`_passEdgeOrDebug`), fed by
  // `world`/`cam` via `pipeline.frame(fb, light, cam, world)` (main.js).
  // The legacy CPU sequence stays exactly as-is for the JS oracle/fallback
  // (`fb.gpu` unset - `?gpu=0`, `?force2d=1`, no WebGL2, or the
  // `?gpucompare=shade` test's own separate `fbCompare`).
  //
  // Bug fix (US-030a, "colour blocks, no glyphs" on the GPU path): the
  // per-frame ambient light `ambientL` (sky.js) used to be primed
  // only inside `castScene`, i.e. only by the CPU caster this early-out
  // skips - so on the GPU path it stayed [0,0,0], `uLight` was zero and the
  // shade pass resolved every cell to glyph 0. Prime it here, once per
  // frame, from the live palette - same call, same source of truth.
  if (fb.gpu) {
    if (fb.palette) primeAmbientLight(fb.palette);
    return;
  }

  beginFrame(fb);
  meshPitched = false;
  const meshWater = ((!!world.water && world.water.count > 0) || (world.waterfalls && world.waterfalls.length > 0)); // US-055a2b
  meshHashCell = 0;

  renderWorldMesh(fb, world, cam);

  if (fb.gbuf) {
    computeDerivatives(fb.gbuf, fb.depth.depth);
    // US-006: `fb.lights` (a LightSet, built by main.js from the world's
    // `level.def.lights`) drives per-cell ambient+point-light shading;
    // `?lights=0` (fb.lights left null) keeps the US-028 uniform-ambient
    // regression path, unchanged. `fb.lights.update()` itself is the
    // caller's job (main.js), once per rendered frame - it must also run on
    // the GPU-DDA path above, which returns before reaching this code, so
    // it cannot live only here.
    if (fb.light) {
      if (fb.lights) {
        // Architect review 1 item 3: `lightSurfaces` now sets `uniform =
        // false` itself - see engine/render/lighting.js.
        lightSurfaces(fb, fb.lights, cam, world);
      } else {
        fb.light.uniform = true;
        fb.light.rgb[0] = ambientL[0]; fb.light.rgb[1] = ambientL[1]; fb.light.rgb[2] = ambientL[2];
      }
    }
    // RE-02a (28.1 A2 item 3): the shade passes (fog, LOD dither, terrain bands) read the horizontal
    // forward distance `vd * pitchedFogScale(row)`; light/edge/sky/sprites keep the raw view depth.
    // GLSL twin: `dist *= fogScaleCell(...)` in shade.frag.js / edge.frag.js.
    if (meshPitched) scaleDepthForShade(fb.depth.depth, fb.gbuf.cols, fb.gbuf.rows, true);
    shadeSurfaces(fb, fb.gbuf, fb.matTable, fb.detailPass, fb.light);
    shadeTerrainCells(fb, world.terrain, world, fb.timeSec || 0, meshHashCell);
    if (meshPitched) scaleDepthForShade(fb.depth.depth, fb.gbuf.cols, fb.gbuf.rows, false);
    // US-055a2b (35.3): water composite on the surface cells (raw depth), then the edge pass skips opaque-water cells.
    if (meshWater) waterCompositeJS(fb, world, meshTerms, meshPitchTerms, meshPitched, false);
    else if (fb.waterMask) fb.waterMask = null;
    if (fb.detailPass) edgePass(fb.gbuf, fb.depth.depth, fb.rt, fb.detailPass.edges, fb.waterMask || null, fb.matTable ? fb.matTable.soft : null);
  }

  fillSky(fb, cam);
  if (meshWater && fb.gbuf) waterCompositeJS(fb, world, meshTerms, meshPitchTerms, meshPitched, true); // sky cells (water to the horizon)

  // (US-017 ARCH CHANGES #1 item 2, 7.4 "Fade") CPU scene fade moved OUT of
  // here to the call site right after `sprites.render(...)` (main.js) -
  // sprites are plain non-mask cells too and must fade, same as the GPU
  // composite pass (sprite pass F, `sprites.frag.js`) fades them. Applying
  // it here (before sprites are drawn) would leave sprites unfaded on the
  // CPU/oracle path while the GPU path fades everything in one pass.
}
