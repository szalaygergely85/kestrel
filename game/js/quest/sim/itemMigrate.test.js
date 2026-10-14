// ITEM-02c tests: save v1 -> v2 item migration. Node: node game/js/quest/sim/itemMigrate.test.js
import assert from 'node:assert/strict';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { registerGenDefs } from './itemInst.js';
import { ensureInventory, SLOTS } from './inventory.js';
import { ensureEquipment, EQUIP_SLOTS } from './equipment.js';
import { migrateItems, sanitizeItems, legacyInfo, convertLegacy, ensureSaveId, TIER_MAP, addDrop } from './itemMigrate.js';
import { collectSave, applySave, parseGameSave, stringifyGameSave, SAVE_VERSION } from '../save/saveState.js';

await loadTestAssets(); itemsMod;
const defs = globalThis.ASSETS.items.defs;
const legacyIds = Object.keys(defs).filter((id) => /^gear\.[a-z]+\.[A-Za-z]+\.(worn|sturdy|fine|tempered|warden)$/.test(id) && !defs[id].unique);
registerGenDefs(defs);
assert.ok(legacyIds.length >= 35, 'legacy gear ids');

// old (v1) player: no `it`, no inv.v
const oldPlayer = (packIds, worn = {}) => {
  const p = { components: {} };
  ensureInventory(p, { pack: [] });
  const inv = p.components.inventory; delete inv.v;
  for (const s of inv.slots) delete s.it;
  packIds.forEach((id, i) => { inv.slots[i].id = id; inv.slots[i].n = 1; });
  const eq = ensureEquipment(p); delete eq.it; delete eq.rev;
  Object.assign(eq, worn);
  return p;
};

// golden: every legacy id x {pack, worn}
const goldenIL = { worn: [1, 0], sturdy: [2, 1], fine: [4, 1], tempered: [6, 2], warden: [8, 2] };
assert.deepEqual(TIER_MAP, goldenIL);
for (const id of legacyIds) {
  const [, slot, base, tier] = id.split('.'), [iL, r] = goldenIL[tier], type = { main: 'sword', ranged: 'bow', off: 'shield' }[slot] || 'armour.' + slot;
  const p = oldPlayer([id], { [slot]: id });
  const res = migrateItems(p, defs, 777);
  const s0 = p.components.inventory.slots[0], eq = p.components.equipment;
  assert.equal(res.converted, 2, id);
  assert.equal(s0.id, 'gen.' + type); assert.equal(s0.n, 1);
  assert.equal(s0.it.iL, iL, id); assert.equal(s0.it.r, r, id); assert.ok(!('req' in s0.it), 'no req');
  assert.equal(eq[slot], 'gen.' + type); assert.equal(eq.it[slot].iL, iL);
  assert.notEqual(eq.it[slot], s0.it, 'distinct instances');
}
for (const [id, type, slot] of [['sword', 'sword', 'main'], ['bow', 'bow', 'ranged'], ['shield', 'shield', 'off']]) {
  const p = oldPlayer([id], { [slot]: id });
  migrateItems(p, defs, 5);
  const s0 = p.components.inventory.slots[0];
  assert.equal(s0.id, 'gen.' + type); assert.equal(s0.it.iL, 1); assert.equal(s0.it.r, 0); assert.ok(!s0.it.req);
  assert.equal(p.components.equipment[slot], 'gen.' + type);
}

// determinism: same saveId + slot -> identical; other saveId or slot -> other rolls
const a1 = convertLegacy('gear.body.jerkin.warden', 42, 3), a2 = convertLegacy('gear.body.jerkin.warden', 42, 3);
assert.deepEqual(a1, a2);
assert.notDeepEqual(a1.it.a, convertLegacy('gear.body.jerkin.warden', 43, 3).it.a, 'other saveId');
assert.notDeepEqual(a1.it.a, convertLegacy('gear.body.jerkin.warden', 42, 4).it.a, 'other slot');
const pa = oldPlayer(['gear.head.hood.fine', 'gear.feet.boots.fine']), pb = oldPlayer(['gear.head.hood.fine', 'gear.feet.boots.fine']);
migrateItems(pa, defs, 9); migrateItems(pb, defs, 9);
assert.deepEqual(pa.components, pb.components, 'same save -> same items (2 runs)');

// idempotent; uniques, spells, stackables, keys untouched; quickbar cleared for converted ids, others kept
const p = oldPlayer(['gear.feet.riverBoots', 'spell.fireball', 'potion.hp', 'gear.legs.pants.sturdy'], { head: 'gear.head.hood.worn', quiver: { id: 'arrow', n: 5 } });
p.components.quickbar = [null, null, 'gear.legs.pants.sturdy', 'potion.hp', null, null];
const r1 = migrateItems(p, defs, 11), snap = JSON.stringify(p.components);
assert.equal(r1.converted, 2);
const sl = p.components.inventory.slots;
assert.equal(sl[0].id, 'gear.feet.riverBoots'); assert.equal(sl[0].it, null);
assert.equal(sl[1].id, 'spell.fireball'); assert.equal(sl[2].id, 'potion.hp'); assert.equal(sl[3].id, 'gen.armour.legs');
assert.deepEqual(p.components.equipment.quiver, { id: 'arrow', n: 5 });
assert.deepEqual(p.components.quickbar, [null, null, null, 'potion.hp', null, null]);
assert.equal(p.components.inventory.v, 2); assert.equal(p.components.equipment.rev, 1);
assert.equal(migrateItems(p, defs, 11).converted, 0, 'second run converts 0');
assert.equal(JSON.stringify(p.components), snap, 'second run changes nothing');

// stale saves never throw
for (const bad of [
  { components: {} }, { components: { inventory: { slots: 'x' } } }, { components: { inventory: { v: 2, slots: [null, 7, { id: 'gen.foo', n: 1 }, { id: 'gen.sword', n: 1, it: {} }, { id: 'gen.sword', n: 1 }] } } },
  { components: { inventory: { slots: [{ id: 'sword', n: 1 }] }, equipment: { main: 'gen.nope', it: 5 } } }, null, undefined, { components: { equipment: { head: 'gen.armour.head' } } },
]) { migrateItems(bad, defs, 1); sanitizeItems(bad); }
const stale = { components: { inventory: { v: 2, slots: [{ id: 'gen.foo', n: 1, it: { iL: 3 } }, { id: 'gen.sword', n: 1, it: {} }] } } };
sanitizeItems(stale);
assert.equal(stale.components.inventory.slots[0].id, null); assert.equal(stale.components.inventory.slots[1].id, null);
assert.equal(legacyInfo('gear.feet.riverBoots'), null); assert.equal(legacyInfo(5), null); assert.equal(legacyInfo('gen.sword'), null);

// saveId: kept when present, derived once otherwise
const st = {}; const id1 = ensureSaveId(st, 'Wick', 125.7);
assert.equal(st['items.saveId'], id1); assert.equal(ensureSaveId(st, 'Other', 9), id1);

// save v2 round trip: collect -> stringify -> parse -> apply keeps instances deep-equal; v1 envelope still read
assert.equal(SAVE_VERSION, 2);
const assets = new AssetRegistry({ palette: {} }), world = World.load({ name: 'mig', terrain: null, structures: [], entities: [] }, assets, {});
const ent = world.spawn('unit', { x: 1, y: 2, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 3, max: 5, invuln: 0 } }, 'player');
const mp = oldPlayer(['gear.body.jerkin.tempered', 'sword'], { head: 'gear.head.hood.fine' });
ent.data.components.inventory = mp.components.inventory; ent.data.components.equipment = mp.components.equipment;
migrateItems(ent.data, defs, 31337);
world.state['items.saveId'] = 31337;
const before = structuredClone([ent.data.components.inventory, ent.data.components.equipment]);
const save = collectSave(world, { place: 'T', playTimeSec: 1 });
assert.equal(save.saveVersion, 2);
const back = applySave(parseGameSave(stringifyGameSave(save)), assets, {});
const bp = back.world.get('player').data;
assert.deepEqual([bp.components.inventory, bp.components.equipment], before, 'instances exact after round trip');
assert.equal(back.world.state['items.saveId'], 31337); assert.equal(back.saveVersion, 2);
const v1 = structuredClone(save); v1.saveVersion = 1;
assert.equal(applySave(v1, assets, {}).saveVersion, 1, 'v1 save is read');
// loot entry: a gear drop becomes an instance (req kept for weapons); no saveId -> plain legacy add; potions untouched
{
  const q = { components: {} }; ensureInventory(q, { pack: [] }); const inv = q.components.inventory, got = { id: '' };
  assert.equal(addDrop(inv, defs, 'gear.main.sword.tempered', 1, 5, 1000, got), 1);
  assert.equal(got.id, 'gen.sword'); assert.equal(inv.slots[0].it.iL, 6); assert.equal(inv.slots[0].it.r, 2); assert.ok(inv.slots[0].it.req.str >= 5);
  assert.equal(addDrop(inv, defs, 'gear.head.hood.worn', 1, null, 1, got), 1); assert.equal(got.id, 'gear.head.hood.worn'); assert.equal(inv.slots[1].it, null);
  assert.equal(addDrop(inv, defs, 'potion.hp', 1, 5, 2, got), 1); assert.equal(got.id, 'potion.hp');
}
console.log('itemMigrate OK', legacyIds.length, 'ids x pack+worn');
