// node game/js/prefetchAll.test.js  (OB-109: ensure EVERY lazy mesh, progress 0..total, bounded concurrency)
import assert from 'node:assert';
import { prefetchAllLazyMeshes } from './bootPrefetchHook.js';
const store = { live: 0, peak: 0, seen: new Set(), async ensure(m) { this.live++; this.peak = Math.max(this.peak, this.live); await new Promise((r) => setTimeout(r, 1)); this.live--; this.seen.add(m); } };
const mk = (id) => ({ id, lazy: { store } });
const shared = mk('shared');
const world = { structures: [{ mesh: shared }, { mesh: shared }, { mesh: mk('a') }, { mesh: null }, { mesh: { lazy: { store: {} } } }, { mesh: mk('b') }], scatterMeshes: [mk('s1'), null, shared] };
const prog = [];
const r = await prefetchAllLazyMeshes(store, world, (d, t) => prog.push([d, t]), 2);
assert.strictEqual(r.total, 4); assert.strictEqual(store.seen.size, 4);
assert.deepStrictEqual(prog[0], [0, 4]); assert.deepStrictEqual(prog[prog.length - 1], [4, 4]);
assert.ok(store.peak <= 2, 'bounded concurrency');
assert.strictEqual((await prefetchAllLazyMeshes(null, world)).total, 0);
console.log('prefetchAll.test.js: all checks passed.');
