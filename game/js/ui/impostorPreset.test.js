import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyImpostorPreset, impostorSpecies, resetImpostorCache, impostorCacheBytes, IMPOSTOR_BUDGET_BYTES } from './impostorPreset.js';
import { loadPresets, knobsFor } from './gfxPresets.js';

const data = JSON.parse(readFileSync(new URL('../../../content/settings/gfx-presets.json', import.meta.url)));
await loadPresets(data);
// preset table (D-075 step 5)
const t = (n) => [knobsFor(n).impM, knobsFor(n).impMaxDistM, knobsFor(n).occl];
assert.deepEqual(t('ultra'), [60, 300, null]); assert.deepEqual(t('high'), [45, 200, null]);
assert.deepEqual(t('medium'), [0, 0, null]); assert.deepEqual(t('low'), [0, 0, null]);
for (const [k, v] of [['impM', -1], ['impM', NaN], ['impMaxDistM', 'x'], ['occl', 1], ['impMaxDistM', 0], ['impM', 0]]) {
  const bad = structuredClone(data); bad.presets.ultra[k] = v;
  await assert.rejects(loadPresets(bad), undefined, `${k}=${v} rejected`);
}
const near = structuredClone(data); near.presets.high.impMaxDistM = 50; await assert.rejects(loadPresets(near), /impM/);
const noKey = structuredClone(data); delete noKey.presets.low.occl; await assert.rejects(loadPresets(noKey));
await loadPresets(data);
const occlSet = structuredClone(data); occlSet.presets.ultra.occl = true; assert.equal((await loadPresets(occlSet)).ultra.occl, true); await loadPresets(data);

// opt-in species list (design data): valid mesh ids, 2-3 opted in, none for non-tree rows
globalThis.ASSETS = { levels: {} };
await import('../../../design/levels/overworld_far.js');
const species = globalThis.ASSETS.levels.overworld_far.recipe.forest.trees.species;
const ids = impostorSpecies(species);
assert.ok(ids.length >= 2 && ids.length <= 3, 'opt-in count ' + ids.length);
for (const id of ids) assert.ok(species.some((s) => s.mesh === id) && /^quaternius\/(CommonTree|Pine)_\d$/.test(id), id);
const top = [...species].sort((a, b) => b.weight - a.weight).slice(0, 3).map((s) => s.mesh);
assert.deepEqual([...ids].sort(), [...top].sort(), 'opted in = most common by weight');

// applyImpostorPreset with stub deps
const mk = (key, tris = 100) => ({ modelKey: key, mesh: { id: key, data: { triCount: tris } }, ib: { capacity: 8 }, count: 1, maxDistM: 0 });
const calls = { bake: 0, enable: 0 };
const deps = {
  resolveGroupLod1: (g) => g.mesh, createInstanceBuffer: () => ({}),
  bakeImpostor: () => { calls.bake++; return { bytes: new Uint8Array(86016) }; },
  enableGroupImpostor: (g, imp, m) => { calls.enable++; g.imp = imp; g.impM = m; },
};
const eng = { instances: { groups: [mk('quaternius/CommonTree_1'), mk('quaternius/CommonTree_2'), mk('quaternius/CommonTree_5'), { modelKey: 'voxel', count: 1 }] } };
const logs = [], opts = { species, deps, log: (m) => logs.push(m) };
resetImpostorCache();
let r = applyImpostorPreset(eng, knobsFor('medium'), opts);
assert.deepEqual([r.on, r.groups, calls.bake], [false, 0, 0], 'off at medium');
r = applyImpostorPreset(eng, knobsFor('low'), opts); assert.equal(calls.bake, 0, 'off at low');
r = applyImpostorPreset({ engine: eng }, knobsFor('ultra'), opts);
assert.deepEqual([r.on, r.groups, r.baked, calls.bake], [true, 2, 2, 2], 'ultra: only opted-in species'); // CommonTree_5 not opted in
assert.equal(eng.instances.groups[0].impM, 60); assert.equal(eng.instances.groups[0].maxDistM, 300); assert.equal(eng.instances.groups[2].imp, undefined);
// once per mesh id: switching presets / re-calling never re-bakes
applyImpostorPreset(eng, knobsFor('high'), opts); applyImpostorPreset(eng, knobsFor('ultra'), opts);
assert.equal(calls.bake, 2, 'baked once per mesh id'); assert.equal(calls.enable, 2, 'enabled once per group');
assert.equal(eng.instances.groups[0].impM, 60); applyImpostorPreset(eng, knobsFor('high'), opts); assert.equal(eng.instances.groups[0].impM, 45);
// back to off: impM 0 on the group, atlas stays cached
applyImpostorPreset(eng, knobsFor('medium'), opts); assert.equal(eng.instances.groups[0].impM, 0); assert.equal(impostorCacheBytes(), 2 * 86016);
// 2 MB cap: log + skip
resetImpostorCache();
const big = { instances: { groups: Array.from({ length: 30 }, (_, i) => mk('quaternius/CommonTree_1')) } };
big.instances.groups.forEach((g, i) => { g.modelKey = g.mesh.id = 'quaternius/CommonTree_1'; });
const manyIds = Array.from({ length: 30 }, (_, i) => 'quaternius/T_' + i);
big.instances.groups.forEach((g, i) => { g.modelKey = g.mesh.id = manyIds[i]; });
const sp = manyIds.map((m) => ({ mesh: m, impostor: true }));
logs.length = 0; calls.bake = 0;
r = applyImpostorPreset(big, knobsFor('ultra'), { species: sp, deps, log: (m) => logs.push(m) });
assert.equal(calls.bake, Math.floor(IMPOSTOR_BUDGET_BYTES / 86016), 'bakes stop at the 2 MB cap (24)');
assert.ok(impostorCacheBytes() <= IMPOSTOR_BUDGET_BYTES); assert.equal(r.skipped, 30 - calls.bake); assert.equal(logs.length, r.skipped);
assert.match(logs[0], /over .* budget/);
console.log('impostorPreset.test: OK');

// R6-WIRE: boot path applies once with preset knobs; ?imp=0 zeroes impM; Settings reapply reuses species.
{
  const { impostorKnobs, applyImpostorBoot, reapplyImpostorPreset } = await import('./impostorPreset.js');
  const k = { impM: 60, impMaxDistM: 300 };
  if (impostorKnobs(k, '0').impM !== 0 || impostorKnobs(k, '0').impMaxDistM !== 300) throw new Error('imp=0 must zero impM');
  if (impostorKnobs(k, '1') !== k || impostorKnobs(k, null) !== k) throw new Error('imp=1/absent keeps knobs');
  const eng = { instances: { groups: [{ mesh: { id: 'x/CommonTree_1', data: { triCount: 0 } } }] } };
  const logs = [];
  const r = applyImpostorBoot(eng, k, { species: [{ mesh: 'CommonTree_1', impostor: true }], log: (m) => logs.push(m), imp: '0' });
  if (r.on) throw new Error('boot with imp=0 must be off');
  if (reapplyImpostorPreset(eng, k).on) throw new Error('reapply keeps imp=0');
  console.log('impostor wire OK');
}
