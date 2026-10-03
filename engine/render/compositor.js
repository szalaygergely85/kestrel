// engine/render/compositor.js (US-025, docs/architecture.md 7.3/8). The
// world-level frame pipeline: sorts placed structures near-to-far, casts
// each into the shared FrameBuffers, then the terrain, then the deferred
// shading passes (US-028) and finally the sky - replacing the manual
// beginFrame/castSectors/.../fillSky sequence main.js used to write out by
// hand for a single bare level (US-024).
import { beginFrame, castSectors, fillSky, ambientL, primeAmbientLight } from './sectorCaster.js';
import { castTerrain, shadeTerrainCells } from './terrainCaster.js';
import { computeDerivatives, shadeSurfaces } from './detailShade.js';
import { edgePass } from './edgePass.js';
import { lightSurfaces } from './lighting.js';
import { castModels } from '../voxel/voxelMarch.js';
// ME-06 (27.15.5a item 6): the JS-twin oracle for `fb.renderer === 'mesh'` -
// same `DrawList`/`rasterJS` path the GPU raster pass (`GpuCellPipeline.
// _passRaster`) draws, so `?gpucompare=1&renderer=mesh` compares the GPU
// mesh output against a JS mesh twin instead of the CPU DDA (27.7 item 2 can
// only hold that way - see 27.15.5a item 6's "Oracle rule").
import { DrawList, LevelMeshCache, addStructures, addCloths } from '../mesh/DrawList.js';
import { rasterDrawList, copyToGBuffer, createRasterTarget, clearRasterTarget, clearRasterDepth } from '../mesh/rasterJS.js';
import { terrainMeshSetFor } from '../mesh/terrainMesh.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../mesh/voxelMesh.js';
import { projTerms, shearProjection, createPitchedTerms, pitchedTerms, resolveProjection, assertProjectionRenderer, pitchedFogScale } from './projection.js';
import { frustumPlanes } from '../mesh/culling.js';
import { renderWaterJS } from './water.js';
import { waterCompositeJS } from './waterComposite.js';
// ME-15c (27.9a): JS twin of the GPU sun shadow pass (same list builder, matrix, polygon offset, depth-only raster).
import { createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar } from './shadowSun.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../mesh/shadowList.js';

const MAX_STRUCTS = 8; // structSeq is a 3-bit field (arch 7.2) - never exceeded, never wrapped.
// Preallocated (architecture.md section 9: no per-frame allocation in renderWorld).
const order = new Int8Array(MAX_STRUCTS);
const distScratch = new Float32Array(MAX_STRUCTS);
// US-040 step 5 (architecture.md 15.2 item 5): `castModels` takes a
// `{rt, depth:Float32Array, gbuf}` shim, not the real `fb` (whose `depth` is
// a `DepthBuffer` object, `.depth` its typed array) - reused, never
// reallocated (architecture.md section 9).
const modelsFbShim = { rt: null, depth: null, gbuf: null };

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
const sunShadowSrc = { centre: { x: 0, y: 0, z: 0 }, cache: /** @type {any} */ (null), terrainSet: /** @type {any} */ (null), voxelPool: /** @type {any} */ (null), voxelMeshCache: sharedVoxelMeshCache, fogFarM: 2000, instances: /** @type {any} */ (null), cloths: /** @type {any} */ (null), matIdFor: /** @type {any} */ (undefined) };
const sunShadowRasterCtx = { M: sunShadowMat.M, depthBias: { factor: 0, units: 0 }, structFoot: /** @type {any} */ (null), structCount: 0 };
/** What `lightSurfaces` reads (`fb.sunMap`): {map, M, opts}. */
const sunMapState = { map: /** @type {any} */ (null), M: sunShadowMat.M, opts: /** @type {any} */ (null) };
/** @type {import('../mesh/rasterJS.js').RasterTarget|null} */
let _sunShadowTarget = null;

/**
 * Renders the sun shadow map for this frame (called by `renderWorldMesh` after the camera list was built and
 * culled) and publishes it as `fb.sunMap`; `null` when shadows.sun is not 'map' or there is no sun.
 */
function renderSunShadowJS(fb, world, cam, cameraList, cache, terrainMeshSet, structCount) {
  const so = fb.shadowOpts;
  const sun = fb.lights && fb.lights.sun;
  fb.sunMap = null;
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
  src.fogFarM = sunShadowFogFar(fb.palette, so);
  src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null; // CLOTH-1b1
  src.matIdFor = fb.matTable ? fb.matTable.idFor : undefined;
  shadowWorldZ(world, cache, sunShadowWorldZ);
  const sm = shadowSunMatrix(sun.dir, sunShadowCentreV, so, sunShadowWorldZ, sunShadowMat);
  buildShadowList(sunShadowList, cameraList, world, sm.planes, src);
  const ctx = sunShadowRasterCtx;
  ctx.depthBias.factor = so.depthBias[0]; ctx.depthBias.units = so.depthBias[1];
  ctx.structFoot = meshStructFoot; ctx.structCount = structCount;
  rasterDrawList(sunShadowList, _sunShadowTarget, ctx);
  sunMapState.map = _sunShadowTarget; sunMapState.opts = so;
  fb.sunMap = sunMapState;
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
  meshPitched = resolveProjection(cam, fb.renderer || 'mesh') === 'pitched';
  projTerms(cam, meshGrid, meshTerms);
  // The JS deriv fallback reads `gbuf.cam` (castSectors normally sets it; it never runs on mesh), so
  // write it on every mesh frame (RE-02a review: shear frames left it stale / at defaults).
  // GPU `_passDeriv` uses the shear constants for every camera (28.1 A2: deriv unchanged) - same here.
  fb.gbuf.cam.tanHalfHFov = meshTerms.tanHalf; fb.gbuf.cam.cols = cols; fb.gbuf.cam.planeDistY = meshTerms.planeDistY;
  if (meshPitched) {
    pitchedTerms(cam, meshGrid, meshPitchTerms);
    meshViewProj.set(meshPitchTerms.M);
    const tr = world.terrain;
    meshHashCell = -(2 * meshPitchTerms.tanHalfX / cols); // BUG-FP-002: per-cell mode on every pitched frame
  } else {
    shearProjection(meshTerms, meshViewProj);
  }
  frustumPlanes(meshViewProj, meshFrustumPlanes);

  const list = meshDrawList;
  list.begin();
  const cache = meshLevelMeshCacheFor(world, fb.matTable);
  addStructures(list, world, cam, cache, 2000);

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
    fb.instances.addToDrawList(list, sharedVoxelMeshCache, meshFrustumPlanes, fb.frameNo, meshViewProj, rows);
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
  if (world.water && world.water.count > 0) renderWaterJS(fb, world, cam, meshViewProj, meshFrustumPlanes);
  else if (fb.water) fb.water = null;
  renderSunShadowJS(fb, world, cam, list, cache, terrainMeshSet, meshCtx.structCount);
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

function bboxDist(cam, bbox) {
  const cx = Math.min(Math.max(cam.x, bbox.x0), bbox.x1);
  const cy = Math.min(Math.max(cam.y, bbox.y0), bbox.y1);
  const dx = cam.x - cx, dy = cam.y - cy;
  return Math.hypot(dx, dy); // 0 when the camera is inside the footprint
}

/**
 * @param {Object} fb - FrameBuffers ({ rt, depth, spans, palette, gbuf?, matTable?, detailPass?, lights, timeSec, loop? })
 * @param {import('../world/World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 */
export function renderWorld(fb, world, cam) {
  assertProjectionRenderer(cam, fb.renderer); // RE-02a: 'pitched' needs renderer 'mesh'
  // US-030a AC "the CPU caster no longer runs on the gl2 path": when a
  // ready GPU pipeline owns this frame's cast (`fb.gpuDda`, set by
  // main.js), skip the entire CPU cast/derivative/shade/edge/sky sequence
  // below - `GpuCellPipeline.js`'s present hook does all of it itself
  // (`_passCast`/`_passDeriv`/`_passShade`/`_passEdgeOrDebug`), fed by
  // `world`/`cam` via `pipeline.frame(fb, light, cam, world)` (main.js).
  // The legacy CPU sequence stays exactly as-is for the JS oracle/fallback
  // (`fb.gpuDda` unset - `?gpu=0`, `?force2d=1`, no WebGL2, or the
  // `?gpucompare=shade` test's own separate `fbCompare`).
  //
  // Bug fix (US-030a, "colour blocks, no glyphs" on the GPU path): the
  // per-frame ambient light `ambientL` (sectorCaster.js) used to be primed
  // only inside `castScene`, i.e. only by the CPU caster this early-out
  // skips - so on the GPU path it stayed [0,0,0], `uLight` was zero and the
  // shade pass resolved every cell to glyph 0. Prime it here, once per
  // frame, from the live palette - same call, same source of truth.
  if (fb.gpuDda) {
    if (fb.palette) primeAmbientLight(fb.palette);
    return;
  }

  beginFrame(fb);
  meshPitched = false;
  const meshWater = fb.renderer === 'mesh' && !!world.water && world.water.count > 0; // US-055a2b
  meshHashCell = 0;

  // ME-06 (27.15.5a item 6): `fb.renderer === 'mesh'` replaces the
  // structs-loop + `castTerrain` geometry below with the JS mesh twin
  // (`renderWorldMesh`) - same `DrawList`/`TerrainMeshSet` the GPU raster
  // pass draws. Everything after this block (models, derivatives, light,
  // shade, edge, sky) is unchanged and runs on top of whichever geometry
  // path just filled `fb.gbuf`/`fb.depth`.
  if (fb.renderer === 'mesh') {
    renderWorldMesh(fb, world, cam);
  } else {
    const structs = world.structures;
    const fogFar = (fb.palette && fb.palette.fog && fb.palette.fog.far) || 2000;
    let count = 0;

    for (let i = 0; i < structs.length; i++) {
      if (structs[i].kind === 'mesh') continue; // ME-14c1: no sectors (mesh draws via addMeshStructures)
      const d = bboxDist(cam, structs[i].bbox);
      if (d > fogFar) continue; // too far to matter this frame
      if (count < MAX_STRUCTS) {
        order[count] = i;
        distScratch[count] = d;
        count++;
      } else {
        let worst = 0, worstD = distScratch[0];
        for (let k = 1; k < MAX_STRUCTS; k++) {
          if (distScratch[k] > worstD) { worstD = distScratch[k]; worst = k; }
        }
        if (d < worstD) { order[worst] = i; distScratch[worst] = d; }
        if (fb.loop && fb.loop.stats) fb.loop.stats.structuresCulled = (fb.loop.stats.structuresCulled || 0) + 1;
      }
    }

    // Insertion sort near -> far (count <= 8, so this is cheap and allocation-free).
    for (let i = 1; i < count; i++) {
      const oi = order[i], di = distScratch[i];
      let j = i - 1;
      while (j >= 0 && distScratch[j] > di) {
        order[j + 1] = order[j];
        distScratch[j + 1] = distScratch[j];
        j--;
      }
      order[j + 1] = oi;
      distScratch[j + 1] = di;
    }

    for (let k = 0; k < count; k++) {
      const s = structs[order[k]];
      castSectors(fb, s.level, cam, s.origin);
    }

    // US-016: writes fb.gbuf/fb.depth for every open span it can resolve (a
    // no-op until `world.terrain.farReady`); `shadeTerrainCells` below paints
    // those kind-7 cells (a separate look-up from `shadeSurfaces`'s
    // MaterialTable), and only what's left open after both goes to `fillSky`.
    // ARCH CHANGES item 3: `fb.terrainEnabled === false` (`?terrain=0`, set by
    // main.js) skips terrain on this (CPU/JS oracle) path too, the same way
    // `GpuCellPipeline`'s `terrainEnabled` gates pass A2 - `castTerrain`
    // already no-ops on a null/not-ready terrain, so passing `null` here reuses
    // that same early-out with no new branch inside terrainCaster.js.
    castTerrain(fb, fb.terrainEnabled === false ? null : world.terrain, cam, world);
  }

  // US-040 step 5 (architecture.md 15.2 item 5): `castModels` runs after
  // terrain, before the shading passes - `fb.voxelPool` is optional (US-040
  // has no entity binding; harness callers set it via `pool.project(cam,
  // rt)`, US-041a's `collect(world)` fills it from entities instead). Only
  // the JS oracle path reaches here (`fb.gpuDda` early-out above covers the
  // GPU path). US-041a (15.3 item 3): default `faceMode: 'packed'` now (US-040
  // forced 'nearest' - "face 7 is US-041a" - the rotated-normal GPU/light
  // pass work this story adds; `voxelMarch.js`'s own default is 'packed').
  if (fb.gbuf && fb.voxelPool && fb.voxelPool.list.length && fb.renderer !== 'mesh') {
    modelsFbShim.rt = fb.rt; modelsFbShim.depth = fb.depth.depth; modelsFbShim.gbuf = fb.gbuf;
    castModels(modelsFbShim, fb.voxelPool.list, cam);
  }

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
    if (fb.detailPass) edgePass(fb.gbuf, fb.depth.depth, fb.rt, fb.detailPass.edges, fb.waterMask || null);
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
