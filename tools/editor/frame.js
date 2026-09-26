// tools/editor/frame.js - US-031 (docs/architecture.md 24.4), the
// US-046 workaround: `createWorldRenderer` doesn't exist yet, so the editor
// wires the frame sequence itself, mirroring `game/js/main.js`'s setup minus
// quest UI. Deleted when US-046 lands (24.4's own note) - kept self-contained
// so that swap is one file. Imports only engine/index.js.
import {
  GBuffer, bindShading, bindLevel, GpuCellPipeline, VoxelPool, repackMaterials,
  renderWorld, buildLightSet, syncEntityLights, makeLightBuffer, attachedLightPos,
  stepAnimations, stepSectorAnims, ambientL,
} from '../../engine/index.js';
import { createEditorSprites } from './sprites.js';

/**
 * Pure idle-skip decision (24.1 decision 6 / 24.4's `render(alpha)`
 * pseudocode: `if (!dirty) return; dirty = animate || farBaking;`), pulled
 * out of `step()` so it is Node-testable without a real RenderTarget/World
 * (see frame.test.mjs). `shouldRender` is `dirty || animate || farBaking`
 * (equivalent to the pseudocode's `!dirty` early-out, written the other way
 * round so a caller with `animate`/`farBaking` true but a stale `dirty:false`
 * - e.g. a toggle that forgot to call `markDirty()` - still renders instead
 * of skipping forever); `nextDirty` is what `dirty` becomes for the frame
 * after this one.
 * @param {boolean} dirty
 * @param {boolean} animate
 * @param {boolean} farBaking
 */
export function idleSkip(dirty, animate, farBaking) {
  return { shouldRender: dirty || animate || farBaking, nextDirty: animate || farBaking };
}

/**
 * @param {{engine:Object, assets:Object, rt:Object}} deps
 */
export function createFrame({ engine, assets, rt }) {
  // D-025-style "no per-frame allocation" (24.14): everything below is built
  // once and reused every frame; only `bindLevel`/`repackMaterials` (which
  // run once per `world:loaded`, not per frame) touch it after that.
  let matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
  const detailPass = assets.detailPass || null;
  const gbuf = new GBuffer(rt.cols, rt.rows);
  const voxelPool = new VoxelPool();
  voxelPool.bind(assets, matTable);

  // US-029 gate (24.4/main.js precedent): only when every condition holds -
  // `?gpu=0` is handled by `createEngine`/`RenderTarget` itself (rt.backend
  // stays c2d-capped), so this file only checks `rt.backend`.
  let gpuPipeline = null;
  if (rt.backend === 'gl2' && detailPass && matTable.allV2) {
    const candidate = new GpuCellPipeline(rt, { rays: engine.rays, terrainEnabled: true });
    if (candidate.ready) {
      candidate.bind(matTable, assets.palette);
      gpuPipeline = candidate;
    }
  }
  if (gpuPipeline) gpuPipeline.bindVoxels(voxelPool);

  const sprites = createEditorSprites({ assets, rt, gpuPipeline });

  const fb = {
    rt, depth: engine.depthBuffer, spans: engine.openSpans, palette: assets.palette,
    lights: null, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf, matTable, detailPass, voxelPool,
    gpuDda: false, cpuLightCap: true, fadeLut: null, sceneFade: 1, terrainEnabled: true,
  };

  let lightSet = null;
  // Reused every frame (rule 9: no per-frame allocation) - `syncEntityLights`'s scratch output.
  const lightSyncScratch = new Float64Array(3);
  let presented = 0;
  let dirty = true; // 24.13 S1: the first frame after boot always renders.

  // World.load (via engine.loadWorld/setWorld) emits this synchronously - see
  // engine/world/World.js line ~439 - so listening BEFORE the first
  // `engine.loadWorld` call (main.js's job) already catches it.
  engine.events.on('world:loaded', (evt) => {
    const world = evt.world;
    for (const s of world.structures) {
      bindLevel(matTable, s.level); // US-028: pre-warm material ids per placed level
      repackMaterials(s.packed, s.level, matTable);
    }
    lightSet = buildLightSet(world, assets.palette);
    dirty = true;
  });

  return {
    fb, gpuPipeline, sprites, voxelPool,
    get presented() { return presented; },
    /** Forces the next `step()` to actually render (24.4's `dirty = true`) - camera move, `?gpu=0` toggle, etc. */
    markDirty() { dirty = true; },
    /**
     * One frame attempt (24.4's `render(alpha)` sequence). No-ops (idle skip)
     * unless `dirty`, `opts.animate`, or the far terrain bake is still
     * running - `dirty` is then reset to whichever of those two keeps it
     * true, exactly like the architecture note's pseudocode.
     * @param {import('../../engine/index.js').World} world
     * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
     * @param {{animate:boolean, dt:number}} opts
     * @returns {boolean} whether a frame was actually presented
     */
    step(world, cam, opts) {
      const { animate, dt } = opts;
      if (animate) {
        stepAnimations(world, dt * 1000);
        stepSectorAnims(world, dt);
        fb.timeSec += dt;
      }
      const farBaking = !!(world.terrain && !world.terrain.farReady);
      const skip = idleSkip(dirty, animate, farBaking);
      if (!skip.shouldRender) return false; // idle skip (24.1 decision 6 / 24.4)
      dirty = skip.nextDirty;

      if (farBaking) world.terrain.bakeFarStep(1);

      fb.lights = lightSet;
      if (fb.lights) {
        syncEntityLights(fb.lights, world, assets.palette, attachedLightPos, lightSyncScratch);
        fb.lights.update(fb.timeSec, world);
      }
      fb.gpuDda = !!gpuPipeline && rt.gpuActive;
      voxelPool.collect(world, cam);
      if (!fb.gpuDda) voxelPool.project(cam, rt);
      renderWorld(fb, world, cam);
      sprites.render(fb, world, cam);
      // US-032 (24.4/24.7): an optional overlay hook (highlight/markers/
      // hover outline/status text), called right here - JS-written rt cells
      // between the sprite pass and the GPU compositor survive it (same
      // route drawText/the eyelid already use, 24.4's own note).
      if (opts.drawOverlay) opts.drawOverlay(fb, world, cam);
      if (gpuPipeline) gpuPipeline.frame(fb, fb.lights || ambientL, cam, world);
      rt.present();
      presented++;
      return true;
    },
    /** `grid:changed`-style rebuild (only used by `?grid=` at boot today - no live grid change in the editor, 24.4). */
    resize(cols, rows) {
      matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
      fb.matTable = matTable;
      fb.gbuf = new GBuffer(cols, rows);
      fb.light = makeLightBuffer(cols, rows);
      if (gpuPipeline) gpuPipeline.bind(matTable, assets.palette);
      dirty = true;
    },
  };
}
