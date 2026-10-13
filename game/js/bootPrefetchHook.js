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

/** STREAM-01c (38.51): boot prefetch from the placement grid - every lazy mesh of an active or warm placement that is within its own
 * `reach + warmM` of the spawn (the same per-placement rule the camera feed and `warmLazyMeshes` use), instead of the 2020 m radius. */
async function prefetchGridMeshes(store, world, pos, also) {
  const g = world.refreshPlacementGrid ? world.refreshPlacementGrid() : world.placementGrid;
  let guard = 0;
  g.update(pos.x, pos.y);
  while (g.pending && guard++ < 1000) g.update(pos.x, pos.y); // drain the per-frame cap: boot has no frame budget
  const want = new Set(), st = world.structures, warmM = g.opts.warmM;
  const scan = (list, count) => {
    for (let q = 0; q < count; q++) {
      const i = list[q], m = st[i].mesh;
      if (!m || !m.lazy || m.lazy.store !== store) continue;
      const b = st[i].bbox;
      const dx = Math.max(b.x0 - pos.x, 0, pos.x - b.x1), dy = Math.max(b.y0 - pos.y, 0, pos.y - b.y1), rw = Math.sqrt(g.reach2[i]) + warmM;
      if (dx * dx + dy * dy <= rw * rw) want.add(m);
    }
  };
  scan(g.activeList, g.activeCount); scan(g.warmList, g.warmCount);
  for (const m of also) if (m && m.lazy && m.lazy.store === store) want.add(m);
  await Promise.all([...want].map((m) => store.ensure(m).catch(() => null)));
  return want.size;
}

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
  const n = world.streaming && world.streaming.enabled !== false && world.placementGrid && store.ensure
    ? await prefetchGridMeshes(store, world, pos, also)
    : await store.prefetchNear(world, pos.x, pos.y, BOOT_PREFETCH_RADIUS_M, { also });
  const ms = bootNow() - t0;
  bootSpan(`lazy meshes prefetched near spawn (${n})`, t0);
  console.info(`[boot] prefetchNear: ${n} lazy mesh${n === 1 ? '' : 'es'} near spawn in ${ms.toFixed(0)} ms`);
  return n;
}

/** OB-109: "load up everything" - ensure EVERY lazy mesh of the world (structures + scatter species) behind the boot card, so nothing
 * streams in during play. Bounded concurrency; `onProgress(done, total)` drives the 'props' bar slice. Same meshes as the lazy path
 * would load later (no output change). @returns {Promise<{total:number, ms:number}>} */
export async function prefetchAllLazyMeshes(store, world, onProgress, concurrency = 6) {
  if (!store || !store.ensure) return { total: 0, ms: 0 };
  const t0 = bootNow(), want = new Set();
  for (const m of world.scatterMeshes || []) if (m && m.lazy && m.lazy.store === store) want.add(m);
  for (const s of world.structures || []) { const m = s.mesh; if (m && m.lazy && m.lazy.store === store) want.add(m); }
  const list = [...want], total = list.length;
  let next = 0, done = 0;
  if (onProgress) onProgress(0, total);
  const worker = async () => { while (next < total) { const m = list[next++]; await store.ensure(m).catch(() => null); done++; if (onProgress) onProgress(done, total); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const ms = bootNow() - t0;
  bootSpan(`ALL lazy meshes prefetched (${total})`, t0);
  console.info(`[boot] prefetchAll: ${total} lazy meshes in ${ms.toFixed(0)} ms`);
  return { total, ms };
}
