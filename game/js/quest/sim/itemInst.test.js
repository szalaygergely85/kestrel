// ITEM-02a tests: accessors on 5 fixtures, sanitizeIt on 6 bad inputs, hash sensitivity, 0 alloc, pack instance ops.
import { createHasher } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import { generateItem, baseName } from './itemGen.js';
import { createStatsRng, computeTotals, createTotals } from './stats.js';
import { itOf, itemName, rarityOf, itemLevelOf, reqOf, sanitizeIt, hashIt, fillView, createView, registerGenDefs, fnv1a32, isInstance } from './itemInst.js';
import { ensureInventory, addItem, removeItem, addInstance, removeAt, moveSlot, hashInto, validateItemDefs, SLOTS } from './inventory.js';

await loadTestAssets(); itemsMod;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };

const defs = globalThis.ASSETS.items.defs;
registerGenDefs(defs);
defs['gear.feet.riverBoots'].equip.it = { iL: 3, r: 4, a: [['A14', 0.05]] }; // unique fixture: fixed lines in the def
validateItemDefs(defs); // gen.* defs pass (no tier)
ok(defs['gen.sword'] && defs['gen.armour.feet'] && defs['gen.shield'], 'gen defs registered');

// fixtures: Common / Magic / Rare gen items, unique boots, arrows
const rng = createStatsRng(7);
const com = generateItem(rng, { iL: 2, type: 'sword', r: 0 }), mag = generateItem(rng, { iL: 5, type: 'bow', r: 1 }), rare = generateItem(rng, { iL: 9, type: 'armour.head', r: 2 });
const boots = { id: 'gear.feet.riverBoots', n: 1, it: null }, arrow = { id: 'arrow', n: 12, it: null };
ok(itOf(com, defs) === com.it && itOf(boots, defs) === defs['gear.feet.riverBoots'].equip.it && itOf(arrow, defs) === null, 'itOf');
ok(itemName(com, defs) === baseName('sword', 2) && itemName(mag, defs) === baseName('bow', 5) && itemName(rare, defs) === baseName('armour.head', 9), 'names gen');
ok(itemName(boots, defs) === 'River Boots' && itemName(arrow, defs) === 'Arrow', 'names plain');
ok([com, mag, rare, boots, arrow].map((e) => rarityOf(e, defs)).join() === '0,1,2,4,-1', 'rarityOf ' + [com, mag, rare, boots, arrow].map((e) => rarityOf(e, defs)));
ok([com, mag, rare, boots, arrow].map((e) => itemLevelOf(e, defs)).join() === '2,5,9,3,0', 'itemLevelOf');
ok(reqOf(com, defs) && reqOf(com, defs).str === 5 && reqOf(mag, defs).dex === 8 && reqOf(rare, defs) === null && reqOf(boots, defs) === null && reqOf(arrow, defs) === null, 'reqOf');
ok(isInstance(com) && !isInstance(boots), 'isInstance');

// fillView -> computeTotals
const v = createView();
ok(fillView(v, com.id, com.it, defs) === v && v.dmg && v.dmg[0] === 8 && v.slot === 'main', 'fillView sword');
ok(computeTotals({ main: v }, createTotals()).mainMin >= 8, 'view feeds computeTotals');
ok(fillView(v, 'arrow', null, defs) === null, 'fillView plain -> null');
ok(fillView(v, 'gear.feet.riverBoots', itOf(boots, defs), defs) === v && v.slot === 'feet', 'fillView unique');

// sanitizeIt: 6 bad inputs never throw
const bad = [
  [{ r: 1, a: [] }, 'sword'], [{ iL: 5, r: 9, a: [] }, 'sword'], [{ iL: 5, r: 1, a: [['ZZ', 3]] }, 'sword'],
  [{ iL: 5, r: 1, a: [['A2', NaN]] }, 'sword'], [{ iL: 5, r: 1, a: [['A6', 5]] }, 'sword'], [{ iL: 5, r: 1, a: 'x' }, 'sword'],
];
const outs = bad.map(([it, t]) => { try { return sanitizeIt(it, t); } catch (e) { return 'THROW'; } });
ok(!outs.includes('THROW'), 'sanitize never throws');
ok(outs[0] === null && outs[1].r === 3 && outs[2].a.length === 0 && outs[3].a.length === 0 && outs[4].a.length === 0 && Array.isArray(outs[5].a) && outs[5].a.length === 0, 'sanitize results');
ok(sanitizeIt(null, 'sword') === null && sanitizeIt(12, 'sword') === null, 'sanitize junk');
ok(JSON.stringify(sanitizeIt(rare.it, 'armour.head')) === JSON.stringify(rare.it), 'sanitize keeps good item');

// hash: differs when one affix value changes; deterministic
const hOf = (it) => { const h = createHasher(); hashIt(h, it); return h.digest ? h.digest() : h.value(); };
const a1 = { iL: 3, r: 1, a: [['A2', 4]] }, a2 = { iL: 3, r: 1, a: [['A2', 5]] };
ok(hOf(a1) !== hOf(a2) && hOf(a1) === hOf({ iL: 3, r: 1, a: [['A2', 4]] }) && hOf(null) !== hOf(a1), 'hashIt');
ok(fnv1a32('abc') === fnv1a32('abc') && fnv1a32('abc') !== fnv1a32('abd'), 'fnv');

// pack ops
const player = {};
const inv = ensureInventory(player, { pack: [], left: null, right: null });
ok(inv.v === 2 && inv.slots[0].it === null, 'inv.v 2 + slot it');
ok(addItem(inv, defs, 'gen.sword', 1) === 0 && removeItem(inv, 'gen.sword', 1) === 0, 'addItem/removeItem refuse gen');
const i0 = addInstance(inv, defs, com), i1 = addInstance(inv, defs, mag);
ok(i0 === 0 && i1 === 1 && inv.slots[0].it === com.it && inv.slots[0].n === 1, 'addInstance by reference');
ok(addItem(inv, defs, 'arrow', 5) === 5 && inv.slots[2].id === 'arrow', 'stackable unchanged');
moveSlot(inv, 0, 5);
ok(inv.slots[5].it === com.it && inv.slots[5].id === 'gen.sword' && inv.slots[0].id === null && inv.slots[0].it === null, 'moveSlot by reference');
const out = { id: null, it: null };
ok(removeAt(inv, 5, out) === out && out.it === com.it && inv.slots[5].id === null && inv.slots[5].it === null, 'removeAt');
ok(removeAt(inv, 5, out) === null, 'removeAt empty');
// full pack
for (let i = 0; i < SLOTS; i++) if (inv.slots[i].id === null) addInstance(inv, defs, generateItem(rng, { iL: 1, type: 'sword', r: 0 }));
ok(addInstance(inv, defs, com) === -1, 'full -> -1');
// instances never stack: 2 slots same id both n 1
ok(inv.slots[1].id === 'gen.bow' && inv.slots[1].n === 1, 'n stays 1');
// hashInto differs when one affix value changes
const hv = () => { const h = createHasher(); hashInto(inv, h); return h.digest ? h.digest() : h.value(); };
const before = hv(); inv.slots[1].it.a[0][1] += 0.5; ok(hv() !== before, 'hashInto reacts to affix value');

// 0 alloc: heap flat over 10k calls
if (globalThis.gc) {
  const h = createHasher(); gc(); const m0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 10000; k++) { itOf(com, defs); itOf(boots, defs); hashIt(h, rare.it); fillView(v, com.id, com.it, defs); }
  gc(); const d = process.memoryUsage().heapUsed - m0; ok(d < 200000, 'heap flat ' + d);
}
console.log(fails ? `FAIL ${fails}/${checks}` : `ok ${checks} checks`);
process.exit(fails ? 1 : 0);
