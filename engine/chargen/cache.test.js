// EQ-05: createCharCache hits / misses / LRU / timing, and byte-identical looks after adding the hands/belt/cloak slots.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createCharCache, canonicalJson } from './cache.js';
import { composeCharacter, randomRecipe, SHELL_ORDER } from './index.js';

const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const look = { ...kit.defaults };
let n = 0; const t = (name, f) => { f(); n++; };

t('canonical key ignores key order', () => assert.equal(canonicalJson({ a: 1, b: { d: 1, c: 2 } }), canonicalJson({ b: { c: 2, d: 1 }, a: 1 })));
t('SHELL_ORDER has the gear slots', () => assert.deepEqual(SHELL_ORDER, ['legs', 'feet', 'top', 'hands', 'belt', 'outer', 'cloak']));
t('hit returns the same object, miss composes once', () => {
  const c = createCharCache(kit, 4);
  const a = c.get(look), b = c.get({ ...look });
  assert.equal(a, b); assert.equal(c.stats.misses, 1); assert.equal(c.stats.hits, 1);
  const g = c.get({ ...look, cloak: { id: 'cloak', ramp: 'undyed' }, hands: { id: 'gloves', ramp: 'walnut' }, belt: { id: 'girdle', ramp: 'walnut' } });
  assert.notEqual(g, a); assert.equal(c.stats.misses, 2); assert.equal(c.size, 2);
  assert.ok(g.voxel);
});
t('gear changes the model; empty slot = underclothes (look unchanged)', () => {
  const base = composeCharacter(kit, look), geared = composeCharacter(kit, { ...look, cloak: { id: 'cloak', ramp: 'undyed' } });
  assert.notDeepEqual(base.mat, geared.mat);
  const same = composeCharacter(kit, { ...look, cloak: null, hands: null, belt: null });
  assert.deepEqual(same.mat, base.mat);
});
t('LRU evicts the oldest', () => {
  const c = createCharCache(kit, 2);
  const r = (s) => randomRecipe(kit, s);
  const a = c.get(r(1)); c.get(r(2)); c.get(r(1)); c.get(r(3)); // 2 evicted, 1 kept
  assert.equal(c.size, 2); assert.equal(c.get(r(1)), a); const m = c.stats.misses; c.get(r(2)); assert.equal(c.stats.misses, m + 1);
});
t('recompose <= 50 ms (warm), hit is free', () => {
  const c = createCharCache(kit, 4);
  c.get(look); // warm JIT
  const rec = { ...look, cloak: { id: 'cloak', ramp: 'undyed' } };
  const t0 = performance.now(); c.get(rec); const ms = performance.now() - t0;
  console.log(`  recompose ${ms.toFixed(1)} ms`);
  if (process.env.BAKE_BENCH) assert.ok(ms <= 50, `recompose ${ms} ms`); // wall-clock: BAKE_BENCH=1 only
  const t1 = performance.now(); for (let i = 0; i < 1000; i++) c.get(rec); if (process.env.BAKE_BENCH) assert.ok((performance.now() - t1) / 1000 < 0.05);
});
console.log(`cache.test: ${n} ok`);
