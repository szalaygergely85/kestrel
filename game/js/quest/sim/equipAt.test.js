// ITEM-02b tests: equipAt / unequipSlot codes, hard requirement, BREAKS, stats cache. Node: node game/js/quest/sim/equipAt.test.js
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import { computeTotals } from './stats.js';
import { createStatsCache, refreshTotals, fillWornViews, registerGenDefs } from './itemInst.js';
import { ensureInventory, addInstance, SLOTS } from './inventory.js';
import { ensureEquipment, equipAt, unequipSlot, equip, OK, NO_SLOT, EMPTY, NEEDS, PACK_FULL, BREAKS } from './equipment.js';
import { rollHit } from './stats.js';

await loadTestAssets(); itemsMod;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const defs = globalThis.ASSETS.items.defs;
registerGenDefs(defs);

const inst = (type, iL, a, req) => ({ id: 'gen.' + type, it: { iL, r: 1, a, ...(req ? { req } : {}) } });
const mk = () => { const p = { components: {} }; ensureInventory(p, { pack: [] }); return { inv: p.components.inventory, eq: ensureEquipment(p), p }; };
const why = { attr: '', need: 0, have: 0, blockerSlot: '', blockerId: null };
const snap = (inv, eq) => JSON.stringify([inv.slots, eq]);
const put = (inv, i) => addInstance(inv, defs, i);

// ---- NEEDS: iL9 bow DEX 12; refused at DEX 11, accepted at 12; own +DEX line and outgoing +DEX do not count ----
{
  const { inv, eq } = mk(), cache = createStatsCache();
  const gloves = inst('armour.hands', 4, [['A9', 6]]); // dex 5+6 = 11
  const bow = inst('bow', 9, [['A9', 3]], { dex: 12 }); // own +3 must not help
  const gi = put(inv, gloves), bi = put(inv, bow);
  ok(equipAt(inv, eq, defs, gi, cache, why) === OK && eq.hands === 'gen.armour.hands' && eq.it.hands === gloves.it, 'gloves worn by reference');
  const before = snap(inv, eq), rev = eq.rev;
  ok(equipAt(inv, eq, defs, bi, cache, why) === NEEDS && why.attr === 'dex' && why.need === 12 && why.have === 11, 'bow refused at DEX 11 ' + JSON.stringify(why));
  ok(snap(inv, eq) === before && eq.rev === rev, 'refusal changes nothing');
  gloves.it.a[0][1] = 7; // dex 12
  ok(equipAt(inv, eq, defs, bi, cache, why) === OK && eq.ranged === 'gen.bow' && eq.it.ranged === bow.it, 'bow accepted at DEX 12');
  ok(inv.slots[bi].id === null, 'bow cell emptied');
  // outgoing piece's +DEX does not count: worn bow2 (+10 DEX line) replaced by bow3 needing DEX 13 (gloves 12, bow2's 10 excluded)
  const bow3 = inst('bow', 9, [], { dex: 13 }); const b3 = put(inv, bow3);
  ok(equipAt(inv, eq, defs, b3, cache, why) === NEEDS && why.have === 12, 'outgoing line not counted');
  ok(equipAt(inv, eq, defs, 23, cache, why) === EMPTY && equipAt(inv, eq, defs, 22, cache, why) === EMPTY, 'EMPTY');
}
// ---- swap: old piece takes the freed pack cell by reference ----
{
  const { inv, eq } = mk(), cache = createStatsCache();
  const a = inst('armour.head', 2, []), b = inst('armour.head', 3, []);
  const ai = put(inv, a), bi = put(inv, b);
  equipAt(inv, eq, defs, ai, cache, why);
  ok(equipAt(inv, eq, defs, bi, cache, why) === OK && eq.it.head === b.it && inv.slots[bi].it === a.it && inv.slots[ai].id === null, 'swap moves by reference');
  ok(unequipSlot(inv, eq, defs, 'head', cache, why) === OK && eq.head === null && eq.it.head === null, 'unequip OK');
  ok(unequipSlot(inv, eq, defs, 'head', cache, why) === EMPTY && unequipSlot(inv, eq, defs, 'set', cache, why) === NO_SLOT, 'EMPTY / NO_SLOT');
}
// ---- NO_SLOT: potion; PACK_FULL on unequip ----
{
  const { inv, eq } = mk(), cache = createStatsCache();
  inv.slots[0].id = 'potion.hp'; inv.slots[0].n = 1;
  ok(equipAt(inv, eq, defs, 0, cache, why) === NO_SLOT, 'potion NO_SLOT');
  const h = inst('armour.head', 1, []); put(inv, h); equipAt(inv, eq, defs, 1, cache, why);
  for (let i = 0; i < SLOTS; i++) if (inv.slots[i].id === null) { inv.slots[i].id = 'potion.hp'; inv.slots[i].n = 1; }
  const before = snap(inv, eq);
  ok(unequipSlot(inv, eq, defs, 'head', cache, why) === PACK_FULL && snap(inv, eq) === before, 'PACK_FULL, nothing changes');
}
// ---- BREAKS: +STR piece keeps a worn axe's req met ----
{
  const { inv, eq } = mk(), cache = createStatsCache();
  const helm = inst('armour.head', 4, [['A8', 4]]); // str 9
  const axe = inst('axe', 5, [['A8', 6]], { str: 9 }); // own +6 STR must not count
  put(inv, helm); equipAt(inv, eq, defs, 0, cache, why);
  const ai = put(inv, axe);
  ok(equipAt(inv, eq, defs, ai, cache, why) === OK && eq.main === 'gen.axe', 'axe worn with helm');
  const before = snap(inv, eq);
  ok(unequipSlot(inv, eq, defs, 'head', cache, why) === BREAKS && why.blockerId === 'gen.axe' && why.blockerSlot === 'main' && why.need === 9, 'BREAKS names the axe ' + JSON.stringify(why));
  ok(snap(inv, eq) === before, 'BREAKS changes nothing');
  const helm2 = inst('armour.head', 2, [['A8', 1]]); const h2 = put(inv, helm2); // swap to weaker helm: breaks
  ok(equipAt(inv, eq, defs, h2, cache, why) === BREAKS, 'weaker swap BREAKS');
  ok(unequipSlot(inv, eq, defs, 'main', cache, why) === OK, 'axe off is fine');
}
// ---- cache: recompute only on rev change; equals computeTotals; legacy plain items; 0 alloc ----
{
  const { inv, eq } = mk(), cache = createStatsCache();
  put(inv, inst('sword', 3, [['A1', 0.1]])); put(inv, inst('armour.body', 3, [['A8', 2]])); put(inv, inst('bow', 2, []));
  equipAt(inv, eq, defs, 0, cache, why); equipAt(inv, eq, defs, 1, cache, why); equipAt(inv, eq, defs, 2, cache, why);
  refreshTotals(cache, eq, defs); const n0 = cache.recomputes;
  for (let i = 0; i < 1000; i++) refreshTotals(cache, eq, defs);
  ok(cache.recomputes === n0, 'no recompute without a change');
  fillWornViews(cache, eq, defs);
  const ref = computeTotals(cache.viewEq);
  ok(JSON.stringify(ref) === JSON.stringify(cache.totals), 'cache equals computeTotals');
  unequipSlot(inv, eq, defs, 'body', cache, why); refreshTotals(cache, eq, defs);
  ok(cache.recomputes === n0 + 1 && cache.totals.str === 5, 'recompute once after a change');
  const out = { dmg: 0, crit: false, life: 0 };
  if (globalThis.gc) globalThis.gc();
  const run = () => { for (let i = 0; i < 10000; i++) { refreshTotals(cache, eq, defs); rollHit(cache.totals, false, 0.5, 0.5, out); } };
  run(); if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed; run();
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 100000, 'heap flat: ' + grew);
  // legacy plain wrapper still equips; no req
  const { inv: i2, eq: e2 } = mk(); i2.slots[0].id = 'sword'; i2.slots[0].n = 1;
  ok(equip(i2, e2, defs, 'sword') === true && e2.main === 'sword' && e2.it.main === null, 'legacy equip');
}
{ // quick bar keys refuse gen.* (hands via equipAt only)
  const { p } = mk(); const { assign } = await import('./quickbar.js');
  ok(assign(p, defs, 2, 'gen.sword') === false && assign(p, defs, 3, 'gen.armour.head') === false, 'quickbar refuses gen.*');
}
console.log(fails ? fails + ' FAILED' : 'equipAt.test ok');
process.exit(fails ? 1 : 0);
