// MESH-LOAD-01 boot prefetch hook (game/js/bootPrefetchHook.js). Mock store, no DOM: proves (1) the boot hook
// really AWAITS `prefetchNear` before it resolves - so main.js's own `await prefetchLazyMeshesAtBoot(...)` would
// delay `engine.run()`/the first frame until the fetch+decode settle, not just kick the request off; (2) the
// exact args reach `prefetchNear` (world, spawn x/y, the shared BOOT_PREFETCH_RADIUS_M, `also` = scatterMeshes
// with falsy entries dropped); (3) a falsy store (lazy loading off) resolves 0 and never calls `prefetchNear`.
import assert from 'node:assert/strict';
import { prefetchLazyMeshesAtBoot, BOOT_PREFETCH_RADIUS_M } from './bootPrefetchHook.js';

const world = { structures: [], scatterMeshes: [null, { id: 'oak' }, { id: 'rock' }, null] };
const pos = { x: 12, y: -34 };

// --- call order: prefetchNear is called synchronously, but the hook must not resolve before IT resolves. ---
const order = [];
const calls = [];
let resolveFetch;
const mockStore = {
  prefetchNear(w, x, y, radiusM, opts) {
    calls.push({ w, x, y, radiusM, opts });
    order.push('prefetchNear:called');
    return new Promise((res) => { resolveFetch = () => { order.push('prefetchNear:resolved'); res(3); }; });
  },
};

const hookPromise = prefetchLazyMeshesAtBoot(mockStore, world, pos).then((n) => { order.push('hook:resolved'); return n; });
order.push('after the call (still pending)');
assert.deepEqual(order, ['prefetchNear:called', 'after the call (still pending)'],
  'prefetchNear is invoked before prefetchLazyMeshesAtBoot returns its (still pending) promise');

resolveFetch(); // simulate the fetch+decode finishing
const n = await hookPromise;
order.push('simulated first frame (engine.run)');
assert.equal(n, 3, 'resolves with prefetchNear\'s own count');
assert.deepEqual(order, [
  'prefetchNear:called', 'after the call (still pending)', 'prefetchNear:resolved', 'hook:resolved', 'simulated first frame (engine.run)',
], 'the first frame (simulated here) only ever comes after prefetchNear has resolved');

// --- args: world, spawn x/y, the shared radius constant, also = scatterMeshes with nulls filtered out ---
assert.equal(calls.length, 1, 'exactly one prefetchNear call');
const call = calls[0];
assert.equal(call.w, world, 'passes engine.world through unchanged');
assert.equal(call.x, 12);
assert.equal(call.y, -34);
assert.equal(call.radiusM, BOOT_PREFETCH_RADIUS_M);
assert.equal(BOOT_PREFETCH_RADIUS_M, 2020, 'fogFarM (2000, compositor.js mesh feed) + LOAD_MARGIN_M (20, lazyMesh.js)');
assert.deepEqual(call.opts.also, [{ id: 'oak' }, { id: 'rock' }], 'also = world.scatterMeshes with falsy entries dropped');

// --- no scatter groups at all (world.scatterMeshes absent) -> also = [], never throws ---
const worldNoScatter = { structures: [] };
let alsoNoScatter = null;
await prefetchLazyMeshesAtBoot(
  { prefetchNear: (w, x, y, radiusM, opts) => { alsoNoScatter = opts.also; return Promise.resolve(0); } },
  worldNoScatter, pos,
);
assert.deepEqual(alsoNoScatter, [], 'missing scatterMeshes does not throw and prefetches nothing extra');

// --- falsy store (lazy loading off: capture/bench/gpucompare pages, ?lazymesh=0) -> resolves 0, no call at all ---
let calledWhenOff = false;
const nOff = await prefetchLazyMeshesAtBoot(null, world, pos);
assert.equal(nOff, 0, 'resolves 0 when lazy loading is off');
assert.equal(calledWhenOff, false, 'never touches prefetchNear when there is no store');

console.log('PASS bootPrefetchHook.test.js');
