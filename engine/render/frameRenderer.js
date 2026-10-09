// ED-WG-01a (docs/architecture.md 38.21): the engine-owned frame renderer. One place that builds matTable / GBuffer / VoxelPool /
// sprites / LightSet, does the WebGPU binds (main.js 592-626 / 717-721) and runs the per-frame order (tools/editor/frame.js step +
// main.js 1594-1612). Pipeline is the WgCellPipeline createRenderer built, or null (CPU path). Never reads device.backend; never
// imports game/ or tools/ (game hooks come in through `beforePresent` and fb fields). Not wired into editor/game yet (01b/01d).
import { GBuffer } from './GBuffer.js';
import { VoxelPool } from './voxelPool.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { repackMaterials } from '../world/packed.js';
import { renderWorld } from './compositor.js';
import { ambientL } from './sky.js';
import { buildSpriteAtlas } from './gpu/spritesAtlas.js';
import { SpritePool, drawSprites } from './sprites.js';
import { buildLightSet, syncEntityLights, makeLightBuffer } from './lighting.js';
import { attachedLightPos } from '../entities/attach.js';
import { stepAnimationsBuf } from '../entities/animation.js';
import { stepSectorAnimsBuf } from '../world/World.js';
import { prebuildTerrainMesh } from '../mesh/terrainMesh.js';

const _u32 = new Uint32Array(1), _f32 = new Float32Array(_u32.buffer);
function u32ToF32(u) { _u32[0] = u >>> 0; return _f32[0]; }
const NO_STEP = { animate: false, dt: 0 }; // reused by readSurface's dirty flush

/** Pure idle-skip decision (24.1 decision 6), kept for tests; step() inlines it so it allocates nothing. */
export function idleSkip(dirty, animate, farBaking) {
  return { shouldRender: dirty || animate || farBaking, nextDirty: animate || farBaking };
}

/**
 * @param {{engine:Object, rt:Object, pipeline:Object|null, assets:Object, idleSkip?:boolean}} deps
 */
export function createFrameRenderer({ engine, rt, pipeline = null, assets, idleSkip: useIdleSkip = false }) {
  const palette = assets.palette;
  const detailPass = assets.detailPass || null;
  let matTable = bindShading(palette, detailPass, rt.pxCellH / rt.pxCellW);
  const voxelPool = new VoxelPool();
  voxelPool.bind(assets, matTable);
  voxelPool.renderer = 'mesh'; // ME-19a: the CPU reference and the GPU frames use the same mesh renderer
  const atlas = buildSpriteAtlas(assets, palette);
  const spritePool = new SpritePool(atlas, palette);
  spritePool.renderer = 'mesh';
  const sprites = { atlas, pool: spritePool };

  const fb = {
    rt, depth: engine.depthBuffer, palette,
    lights: null, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf: new GBuffer(rt.cols, rt.rows), matTable, detailPass, voxelPool,
    gpu: false, cpuLightCap: true, fadeLut: null, sceneFade: 1, terrainEnabled: true,
    renderer: 'mesh', frameNo: 0,
  };

  // WebGPU binds, once (main.js 592-626, 717-721). Order matters: bind(matTable) before voxels/instances/sprites.
  const wg = !!(pipeline && pipeline.ready);
  if (engine.instances) engine.instances.bindPool(voxelPool);
  if (wg) {
    pipeline.bind(matTable, palette);
    if (assets.waterLooks && pipeline.setWaterLooks) pipeline.setWaterLooks(assets.waterLooks);
    pipeline.bindVoxels(voxelPool);
    if (engine.viewModel && pipeline.bindViewModel) pipeline.bindViewModel(engine.viewModel);
    if (engine.instances && pipeline.bindInstances) pipeline.bindInstances(engine.instances);
    if (pipeline.bindSprites) {
      pipeline.bindSprites({ pool: spritePool, atlas, palette, particleLayer: engine.particleLayer || null, overlay: engine.overlay });
    }
  }
  const ready = wg
    ? Promise.all([pipeline.compiled, pipeline.spritesCompiled]).then(() => undefined)
    : Promise.resolve();

  let lightSet = null;
  const prebuilt = new WeakSet(); // terrains already baked + meshed (once per Terrain)
  const lightSyncScratch = new Float64Array(3);
  let presented = 0;
  let dirty = true; // the first frame always renders
  let lastWorld = null, lastCam = null;
  let disposed = false;

  const offLoaded = engine.events.on('world:loaded', (evt) => {
    const world = evt.world;
    for (const s of world.structures) {
      if (s.kind === 'mesh') continue; // road/mesh structures have no Level
      bindLevel(matTable, s.level);
      repackMaterials(s.packed, s.level, matTable);
    }
    // the mesh terrain needs the far bake up front (else the ground stays black)
    if (world.terrain && !prebuilt.has(world.terrain)) {
      prebuilt.add(world.terrain);
      if (world.terrain.bakeFarSync) world.terrain.bakeFarSync();
      prebuildTerrainMesh(world.terrain);
    }
    lightSet = buildLightSet(world, palette);
    dirty = true;
  });

  // ED-MESH-1e: model defs seen by the last voxelPool.bind (key -> def) so refreshAssets can tell "unchanged" from "new/replaced".
  const boundModels = new Map();
  function snapshotModels() {
    boundModels.clear();
    const keys = assets.keys('model');
    for (let i = 0; i < keys.length; i++) boundModels.set(keys[i], assets.model(keys[i]));
  }
  function modelsChanged() {
    const keys = assets.keys('model');
    if (keys.length !== boundModels.size) return true;
    for (let i = 0; i < keys.length; i++) if (boundModels.get(keys[i]) !== assets.model(keys[i])) return true;
    return false;
  }
  snapshotModels();

  const dtBuf = new Float64Array(1);
  const api = {
    fb, voxelPool, sprites, ready,
    get gpuOwnsFrame() { return !!pipeline && !!pipeline.frameComplete && !!rt.gpuActive; },
    get lightSet() { return lightSet; },
    get presented() { return presented; },
    markDirty() { dirty = true; },

    /** One frame attempt. Returns whether a frame was presented (false = idle skip). Allocation-free. */
    step(world, cam, opts) {
      const animate = opts.animate;
      lastWorld = world; lastCam = cam;
      if (animate) {
        dtBuf[0] = opts.dt; // FRAME-ALLOC-01: unboxed dt hand-off
        stepAnimationsBuf(world, dtBuf);
        stepSectorAnimsBuf(world, dtBuf);
        fb.timeSec += dtBuf[0];
      }
      const farBaking = !!(world.terrain && !world.terrain.farReady);
      if (useIdleSkip) {
        if (!(dirty || animate || farBaking)) return false;
        dirty = animate || farBaking;
      }
      engine.ui.clear(); // OWN-REQ-003: the fixed UI layer is cleared every rendered frame
      if (farBaking) world.terrain.bakeFarStep(1);

      fb.lights = lightSet;
      if (lightSet) {
        syncEntityLights(lightSet, world, palette, attachedLightPos, lightSyncScratch);
        lightSet.timeBuf[0] = fb.timeSec;
        lightSet.updateBuffered(world);
      }
      fb.gpu = !!pipeline && pipeline.frameComplete && rt.gpuActive;
      voxelPool.collect(world, cam);
      if (!fb.gpu) voxelPool.project(cam, rt, 'mesh');
      if (engine.feedDetail) engine.feedDetail(cam);
      fb.frameNo++;
      renderWorld(fb, world, cam);
      if (engine.particleLayer && engine.particles) engine.particleLayer.build(engine.particles, cam, rt, lightSet, world, palette, 'mesh');
      spritePool.collect(world);
      spritePool.project(cam, rt, lightSet || ambientL, world);
      if (!fb.gpu) drawSprites(fb, spritePool);
      if (opts.beforePresent) opts.beforePresent(fb, world, cam);
      if (pipeline) pipeline.frame(fb, lightSet || ambientL, cam, world);
      rt.present();
      presented++;
      return true;
    },

    /** The caller has already resized rt / engine grid; this re-creates the host-owned grid-sized targets (and the pipeline's if it lags). */
    resize(cols, rows) {
      matTable = bindShading(palette, detailPass, rt.pxCellH / rt.pxCellW);
      fb.matTable = matTable;
      fb.gbuf = new GBuffer(cols, rows);
      fb.light = makeLightBuffer(cols, rows);
      fb.depth = engine.depthBuffer;
      voxelPool.bind(assets, matTable); // 38.21 nit: the new matTable has new ids, so the packed models must follow
      snapshotModels();
      if (pipeline) {
        if (pipeline.resizeGrid && (pipeline.cols !== cols || pipeline.rows !== rows)) pipeline.resizeGrid(cols, rows);
        pipeline.bind(matTable, palette);
        if (wg) pipeline.bindVoxels(voxelPool);
      }
      dirty = true;
    },

    /**
     * ED-MESH-1e (38.26): after a runtime import into the AssetRegistry, re-pack the voxel/mesh models and re-bind them to the
     * pipeline without a reload. No-op (nothing re-created, atlas version unchanged) when no model was added or replaced.
     * Click/import-only; may allocate. Returns whether a re-bind happened.
     */
    refreshAssets(newAssets) {
      if (newAssets && newAssets !== assets) assets = newAssets;
      if (!modelsChanged()) return false;
      voxelPool.bind(assets, matTable);
      snapshotModels();
      if (wg) pipeline.bindVoxels(voxelPool);
      dirty = true;
      return true;
    },

    /**
     * Click-only surface sample (24.6 exemption; never in the frame loop). GPU: flush a pending dirty frame, then await the
     * async geometry readback; CPU: read fb.gbuf / fb.depth.
     */
    async readSurface(col, row) {
      const i = row * rt.cols + col;
      if (api.gpuOwnsFrame) {
        if (dirty && lastWorld) api.step(lastWorld, lastCam, NO_STEP);
        if (pipeline.cols !== rt.cols || pipeline.rows !== rt.rows) {
          throw new Error(`frameRenderer.readSurface: pipeline grid ${pipeline.cols}x${pipeline.rows} != rt ${rt.cols}x${rt.rows}`);
        }
        const { GI, Depth } = await pipeline.readbackGeometry();
        const gi1 = GI[i * 4 + 1];
        return { kind: gi1 & 0xff, face: (gi1 >>> 8) & 0xf, mat: gi1 >>> 16, planeId: GI[i * 4] | 0, depth: u32ToF32(Depth[i * 4]) };
      }
      const g = fb.gbuf;
      return { kind: g.kind[i], face: g.face[i], mat: g.mat[i], planeId: g.planeId[i], depth: fb.depth.depth[i] };
    },

    /** Drops the world:loaded listener and host-side references. The pipeline belongs to createRenderer and is NOT disposed here. */
    dispose() {
      if (disposed) return;
      disposed = true;
      offLoaded();
      lightSet = null; lastWorld = null; lastCam = null;
      fb.lights = null; fb.gbuf = null; fb.light = null; fb.voxelPool = null; fb.depth = null;
      engine.instances && engine.instances.bindPool && engine.instances.bindPool(null);
    },
  };
  return api;
}
