// game/js/bootPrefetchHook.js - MESH-LOAD-01 boot hook (docs/mesh-bin.md "Lazy loading"; ARCH batch 15: "main.js
// already passes lazyMeshes + sets window.__lazyMeshStore; boot prefetchNear call still NEEDS B1"). Pulled out of
// main.js so main.js's own edit stays one import + one `await` call, and the call order + exact args reaching
// `LazyMeshStore.prefetchNear` can be Node-tested with a mock store (no DOM, no content pack).
//
// `prefetchLazyMeshesAtBoot` awaits every lazy mesh near the spawn/save position (`playerHandle.data.transform`,
// already restored - gatePose/`?at=`/save - by the time `runGame` reaches the call) before `engine.run()` starts
// the frame loop, so props near the player don't pop in on the first frame. No-op (resolves 0, no console line,
// no call at all) when lazy loading is off - `bundle.lazyMeshes` is undefined on capture/bench/gpucompare pages
// and with `?lazymesh=0` (main.js's own `lazyMeshes` flag, loadContentPack call).
import { bootNow, bootSpan } from '../../engine/index.js';

/** Same band the camera feed already uses to request a shell once it is near (engine/render/compositor.js's mesh
 * draw feed passes `fogFarM=2000` to `addStructures`/`addMeshStructuresBatched`; `LOAD_MARGIN_M=20` is
 * engine/mesh/lazyMesh.js's own margin before a shell becomes visible) - the boot prefetch asks for exactly the
 * same radius around the spawn so nothing just inside it has to load on the very first frames instead. */
export const BOOT_PREFETCH_RADIUS_M = 2000 + 20;

/**
 * @param {{prefetchNear: (world: any, x: number, y: number, radiusM: number, opts?: {also?: any[]}) => Promise<number>}|null|undefined} store - `bundle.lazyMeshes`
 * @param {any} world - `engine.world` (placed structures + the optional `scatterMeshes` species array)
 * @param {{x: number, y: number}} pos - spawn/save position, e.g. `playerHandle.data.transform`
 * @returns {Promise<number>} count prefetched (0 when `store` is falsy)
 */
export async function prefetchLazyMeshesAtBoot(store, world, pos) {
  if (!store) return 0;
  const t0 = bootNow();
  const also = (world.scatterMeshes || []).filter(Boolean); // scatter species meshes (instances positioned per camera, not per-structure bbox)
  const n = await store.prefetchNear(world, pos.x, pos.y, BOOT_PREFETCH_RADIUS_M, { also });
  const ms = bootNow() - t0;
  bootSpan(`lazy meshes prefetched near spawn (${n})`, t0);
  console.info(`[boot] prefetchNear: ${n} lazy mesh${n === 1 ? '' : 'es'} near spawn in ${ms.toFixed(0)} ms`);
  return n;
}
