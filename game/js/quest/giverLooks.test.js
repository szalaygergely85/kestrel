// NPC-LOOKS-01: each of the 11 givers resolves to its own char.<look>; the 3 anchors use markerPost / standingStone.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { createRequire } from 'node:module';
import { GIVER_NAMES, GIVER_LOOK, registerGiverLooks } from './giverNpcs.js';
const npcLooks = createRequire(import.meta.url)('../../../design/chargen/npc_looks.js');
const world = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const ent = (id) => world.entities.find((e) => e.id === id);
test('11 givers, 11 distinct looks, entity model = char.<look>', () => {
  const ids = Object.keys(GIVER_NAMES); assert.equal(ids.length, 11);
  assert.equal(GIVER_LOOK.postKeeper, 'npcPostKeeper');
  assert.equal(new Set(ids.map((i) => GIVER_LOOK[i])).size, 11);
  for (const id of ids) { assert.ok(npcLooks.ids.includes(GIVER_LOOK[id]), id); assert.equal(ent(id).components.voxel.model, 'char.' + GIVER_LOOK[id], id); }
});
test('registerGiverLooks composes every look (stub engine) once', () => {
  const kit = { id: 'k' }, reg = new Map(), assets = { has: (t, i) => reg.has(i), add: (t, i, d) => reg.set(i, d) };
  const ext = npcLooks.extendKit; const fake = { ids: npcLooks.ids, extendKit: () => ({ looks: Object.fromEntries(npcLooks.ids.map((i) => [i, { i }])), partMap: {} }) };
  const seen = [];
  const deps = { compose: (k, r) => { seen.push(r.i); return r.i; }, mesh: (g) => g, collapse: (m) => m, rigged: (m) => ({ m }) };
  assert.equal(registerGiverLooks(assets, kit, fake, deps).length, 11); assert.deepEqual(seen.sort(), [...npcLooks.ids].sort());
  assert.equal(registerGiverLooks(assets, kit, fake, deps).length, 0); assert.ok(ext);
});
test('anchors use the marker props', () => {
  assert.equal(ent('notePost').components.voxel.model, 'markerPost'); assert.equal(ent('knot').components.voxel.model, 'markerPost');
  assert.equal(ent('pierStone').components.voxel.model, 'standingStone');
  assert.ok(ent('notePost').components.inspect && ent('pierStone').components.inspect);
});
