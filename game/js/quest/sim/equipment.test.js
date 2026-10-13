// game/js/quest/sim/equipment.test.js (EQ-02). Headless Node ESM: node game/js/quest/sim/equipment.test.js
// Own fixture defs (EQ-01 schema: equip:{slot,tier,def}); no design/items.js dependency.
import assert from 'node:assert/strict';
import { World, AssetRegistry, createHasher } from '../../../../engine/index.js';
import { ensureInventory, addItem, countOf, SLOTS } from './inventory.js';
import {
  ensureEquipment, equip, unequip, swapSet, defenceOf, reductionOf, applyDefence, syncHands,
  migrateEquipment, stepEquipment, hashInto, EQUIP_SLOTS,
} from './equipment.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as CFG } from './vitalsConfig.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from '../save/saveState.js';

const def = (id, slot, tier, d, stackMax = 1) => ({ id, name: id, kind: 'gear', stackMax, equip: { slot, tier, def: d } });
const defs = {
  sword: def('sword', 'main', 'worn', 0), shield: def('shield', 'off', 'sturdy', 2), bow: def('bow', 'ranged', 'worn', 0),
  arrow: def('arrow', 'quiver', 'worn', 0, 30),
  'hood.worn': def('hood.worn', 'head', 'worn', 1), 'hood.fine': def('hood.fine', 'head', 'fine', 3),
  'jerkin.fine': def('jerkin.fine', 'body', 'fine', 6), 'cloak.fine': def('cloak.fine', 'cloak', 'fine', 3),
  'gloves.fine': def('gloves.fine', 'hands', 'fine', 3), 'belt.fine': def('belt.fine', 'belt', 'fine', 3),
  'legs.fine': def('legs.fine', 'legs', 'fine', 3), 'boots.fine': def('boots.fine', 'feet', 'fine', 3),
  junk: { id: 'junk', name: 'junk', kind: 'material', stackMax: 99 },
  'spell.fireball': { id: 'spell.fireball', name: 'f', kind: 'spell', stackMax: 1 },
};
const mkPlayer = (start) => { const p = { components: {} }; ensureInventory(p, start || { pack: [] }); return p; };

// ---- equip / unequip / pack ----
{
  const p = mkPlayer({ pack: [{ id: 'sword', n: 1 }, { id: 'hood.worn', n: 1 }, { id: 'hood.fine', n: 1 }, { id: 'junk', n: 5 }] });
  const inv = p.components.inventory, eq = ensureEquipment(p);
  assert.equal(eq.set, 'melee'); for (const s of EQUIP_SLOTS) assert.equal(eq[s], null);
  assert.equal(equip(inv, eq, defs, 'sword'), true); assert.equal(eq.main, 'sword'); assert.equal(countOf(inv, 'sword'), 0);
  assert.equal(equip(inv, eq, defs, 'hood.worn'), true);
  assert.equal(equip(inv, eq, defs, 'hood.fine'), true, 'replace');
  assert.equal(eq.head, 'hood.fine'); assert.equal(countOf(inv, 'hood.worn'), 1, 'old piece back in the pack');
  assert.equal(equip(inv, eq, defs, 'junk'), false, 'no equip def'); assert.equal(equip(inv, eq, defs, 'nope'), false);
  assert.equal(equip(inv, eq, defs, 'shield'), false, 'not in the pack');
  assert.equal(unequip(inv, eq, defs, 'head'), true); assert.equal(eq.head, null);
  assert.equal(unequip(inv, eq, defs, 'head'), false, 'empty slot');
  // full pack: unequip refuses, nothing changes
  const q = mkPlayer({ pack: [] }); const qi = q.components.inventory, qe = ensureEquipment(q);
  qe.body = 'jerkin.fine';
  for (let i = 0; i < SLOTS; i++) addItem(qi, defs, 'junk', 99);
  assert.equal(unequip(qi, qe, defs, 'body'), false, 'full pack refuses'); assert.equal(qe.body, 'jerkin.fine');
  assert.equal(countOf(qi, 'jerkin.fine'), 0);
  // equip into a full pack: the piece moving out frees its own slot, so the old one fits back
  qi.slots[0].id = 'hood.fine'; qi.slots[0].n = 1; qe.head = 'hood.worn';
  assert.equal(equip(qi, qe, defs, 'hood.fine'), true); assert.equal(qe.head, 'hood.fine'); assert.equal(countOf(qi, 'hood.worn'), 1);
}

// ---- quiver ----
{
  const p = mkPlayer({ pack: [{ id: 'arrow', n: 12 }] }), inv = p.components.inventory, eq = ensureEquipment(p);
  assert.equal(equip(inv, eq, defs, 'arrow'), true); assert.deepEqual(eq.quiver, { id: 'arrow', n: 12 });
  addItem(inv, defs, 'arrow', 25);
  assert.equal(equip(inv, eq, defs, 'arrow'), true); assert.equal(eq.quiver.n, 30, 'topped up to stackMax'); assert.equal(countOf(inv, 'arrow'), 7);
  assert.equal(unequip(inv, eq, defs, 'quiver'), true); assert.equal(eq.quiver, null); assert.equal(countOf(inv, 'arrow'), 37);
}

// ---- defence ----
{
  const p = mkPlayer(), eq = ensureEquipment(p);
  assert.equal(defenceOf(eq, defs), 0);
  eq.head = 'hood.worn'; assert.equal(defenceOf(eq, defs), 1);
  eq.off = 'shield'; eq.body = 'jerkin.fine'; assert.equal(defenceOf(eq, defs), 9);
  eq.quiver = { id: 'arrow', n: 3 }; assert.equal(defenceOf(eq, defs), 9, 'quiver counts 0');
  for (const [s, id] of [['head', 'hood.fine'], ['cloak', 'cloak.fine'], ['hands', 'gloves.fine'], ['belt', 'belt.fine'], ['legs', 'legs.fine'], ['feet', 'boots.fine']]) eq[s] = id;
  assert.equal(defenceOf(eq, defs), 26, 'full fine set + shield');
  assert.equal(reductionOf(0), 0); assert.ok(Math.abs(reductionOf(10) - 0.3) < 1e-12);
  assert.equal(reductionOf(20), 0.6); assert.equal(reductionOf(26), 0.6, 'cap 60 %'); assert.equal(reductionOf(-4), 0);
  // damage table: [hit, defence, expected]
  for (const [n, d, want] of [[5, 0, 5], [5, 5, 4], [5, 20, 2], [5, 26, 2], [10, 20, 4], [1, 20, 1], [1, 0, 1], [30, 10, 21], [2, 20, 1], [0, 10, 0]]) {
    assert.equal(applyDefence(n, d), want, 'applyDefence(' + n + ',' + d + ')');
  }
}

// ---- hands + weapon-set swap ----
{
  const p = mkPlayer(), inv = p.components.inventory, eq = ensureEquipment(p);
  eq.main = 'sword'; eq.off = 'shield'; eq.ranged = null;
  syncHands(inv, eq); assert.equal(inv.left, 'sword'); assert.equal(inv.right, 'shield');
  assert.equal(swapSet(eq), 'melee', 'no bow: stays melee');
  eq.ranged = 'bow'; assert.equal(swapSet(eq), 'ranged');
  syncHands(inv, eq); assert.equal(inv.left, 'bow'); assert.equal(inv.right, null, 'bow is two-handed');
  assert.equal(swapSet(eq), 'melee'); syncHands(inv, eq); assert.equal(inv.left, 'sword'); assert.equal(inv.right, 'shield');
  // stepEquipment auto-equips a sword that entered the pack (tower pickup) and derives the hands
  const t = mkPlayer({ pack: [{ id: 'sword', n: 1 }] });
  stepEquipment(t, defs); assert.equal(t.components.equipment.main, 'sword'); assert.equal(t.components.inventory.left, 'sword');
  assert.equal(countOf(t.components.inventory, 'sword'), 0);
}

// ---- old-save migration ----
{
  const p = mkPlayer({ pack: [{ id: 'spell.fireball', n: 1 }, { id: 'shield', n: 1 }, { id: 'sword', n: 1 }], left: 'sword', right: 'spell.fireball' });
  const eq = migrateEquipment(p, defs);
  assert.equal(eq.main, 'sword'); assert.equal(eq.off, 'shield');
  assert.equal(countOf(p.components.inventory, 'spell.fireball'), 1, 'fireball stays in the pack');
  assert.equal(p.components.inventory.left, 'sword'); assert.equal(p.components.inventory.right, 'shield');
  assert.equal(migrateEquipment(p, defs), eq, 'idempotent');
  const none = mkPlayer({ pack: [] }); const e2 = migrateEquipment(none, defs); assert.equal(e2.main, null); assert.equal(e2.off, null);
  const swordOnly = mkPlayer({ pack: [{ id: 'sword', n: 1 }], left: 'sword' }); assert.equal(migrateEquipment(swordOnly, defs).off, null);
}

// ---- save round trip ----
{
  const assets = new AssetRegistry({ palette: {} });
  const world = World.load({ name: 'eq_fixture', terrain: null, structures: [], entities: [] }, assets, {});
  const h = world.spawn('unit', { x: 1, y: 2, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 5, max: 10, invuln: 0 } }, 'player');
  ensureInventory(h.data, { pack: [{ id: 'junk', n: 3 }] });
  const eq = ensureEquipment(h.data); eq.main = 'sword'; eq.off = 'shield'; eq.body = 'jerkin.fine'; eq.ranged = 'bow'; eq.set = 'ranged'; eq.quiver = { id: 'arrow', n: 17 };
  const text = stringifyGameSave(collectSave(world, {}));
  const back = applySave(parseGameSave(text), assets, {});
  assert.deepEqual(back.world.get('player').data.components.equipment, eq, 'equipment round-trips');
  assert.equal(stringifyGameSave(collectSave(back.world, {})), text, 'byte-stable');
  // an old save (no equipment component) loads, then migrates
  const old = parseGameSave(text); delete old.world.entities[0].components.equipment;
  old.world.entities[0].components.inventory.left = 'sword';
  const o = applySave(old, assets, {}); const od = o.world.get('player').data;
  assert.equal(od.components.equipment, undefined);
  assert.equal(migrateEquipment(od, defs).main, 'sword', 'held sword migrates to main');
}

// ---- hash + zero alloc ----
{
  const p = mkPlayer({ pack: [{ id: 'sword', n: 1 }] }); stepEquipment(p, defs);
  const a = createHasher(), b = createHasher();
  hashInto(p.components.equipment, a); hashInto(p.components.equipment, b);
  assert.equal(JSON.stringify(a.digest ? a.digest() : a), JSON.stringify(b.digest ? b.digest() : b));
  if (global.gc) {
    global.gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) stepEquipment(p, defs);
    global.gc(); assert.ok(process.memoryUsage().heapUsed - before < 200000, 'stepEquipment allocates nothing');
  }
}

// ---- vitals hit path uses defence ----
{
  const mkWorld = () => World.load({ name: 'v', terrain: null, structures: [], entities: [
    { id: 'player', type: 'player', x: 0, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'b1', type: 'beast', x: 5, y: 0, z: 0, components: {} }] }, new AssetRegistry({ palette: {} }), {});
  const listeners = new Set();
  const events = { on(n, f) { listeners.add(f); return () => listeners.delete(f); }, emit(n, p) { for (const f of listeners) f(p); } };
  // [beast damage (x5 scale), defence points, expected hp lost]
  for (const [dmg, pts, lost] of [[1, 0, 5], [1, 5, 4], [1, 20, 2], [2, 26, 4], [3, 10, 11], [1, 100, 2]]) {
    listeners.clear();
    const w = mkWorld(), vit = createVitals(w, events, CFG, { defence: () => pts }), pl = w.get('player').data;
    vit.step(pl, false); const hp0 = vit.hp;
    events.emit('combat:hit', { source: 'b1', target: 'player', damage: dmg });
    assert.equal(hp0 - vit.hp, lost, 'hit ' + dmg + ' with ' + pts + ' defence');
  }
  listeners.clear();
  const w = mkWorld(), vit = createVitals(w, events, CFG, {}), pl = w.get('player').data; vit.step(pl, false);
  events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 }); assert.equal(vit.hp, CFG.maxHp - 5, 'no defence hook = unchanged');
  listeners.clear();
  const w2 = mkWorld(), v2 = createVitals(w2, events, CFG, { defence: () => 20 }), p2 = w2.get('player').data;
  p2.components.body.landed = true; p2.components.body.fallDistance = CFG.fallThreshold10m + 1; v2.step(p2, false);
  assert.equal(CFG.maxHp - v2.hp, CFG.fallDamage10m, 'fall damage not reduced');
}
console.log('equipment: equip/unequip/pack, quiver, defence table, hands + set swap, migration, save round trip, vitals hook PASS');
