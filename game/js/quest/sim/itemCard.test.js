// ITEM-07 tests: golden card text for Common / Magic / Rare / Unique fixtures + per-stat compare colours. Run: node game/js/quest/sim/itemCard.test.js
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import looksMod from '../../../../design/itemLooks.js';
import { registerGenDefs } from './itemInst.js';
import { buildCard, compareLines } from './itemCard.js';

await loadTestAssets(); itemsMod; looksMod;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };
const eqRows = (got, want, m) => { const g = got.join('\n'), w = want.join('\n'); ok(g === w, m + '\n' + g + '\n--- want\n' + w); };

const defs = globalThis.ASSETS.items.defs;
registerGenDefs(defs);
defs['gear.feet.riverBoots'].equip.it = { iL: 3, r: 4, a: [['A14', 0.05]] };
const E = (id, iL, r, a, req) => ({ id, n: 1, it: { iL, r, a, ...(req ? { req } : {}) } });
const totals = { str: 5, dex: 5, int: 5 };

// Common sword iL2 (base 8-13), no bonus, empty slot -> every compare line green
const common = E('gen.sword', 2, 0, [], { str: 5 });
const cc = buildCard(common, defs, { worn: null, totals });
eqRows(cc.rows, [
  '+--------------------------------+',
  '| Worn Sword            [Common] |',
  '| Main hand  -  Level 2          |',
  '| Damage 8-13   (avg 11)         |',
  '| Needs STR 5                    |',
  '|--------------------------------|',
  '| vs empty slot                  |',
  '| Avg damage +11                 |',
  '+--------------------------------+'], 'common golden');
ok(cc.cmp.every((l) => l.kind === 'better'), 'empty slot all green');

// Magic bow iL5 with one bonus, no compare block
const magic = E('gen.bow', 5, 1, [['A9', 3]], { dex: 8 });
const cm = buildCard(magic, defs, { totals });
eqRows(cm.rows, [
  ".--------------------------------.",
  '| Long Bow               [Magic] |',
  '| Ranged  -  Level 5             |',
  '| Damage 13-21   (avg 17)        |',
  '| +3 DEX                         |',
  '| Needs DEX 8                    |',
  "'--------------------------------'"], 'magic golden');
ok(cm.lines.find((l) => l.kind === 'reqBad') && cm.lines.find((l) => l.kind === 'reqBad').c === globalThis.ASSETS.itemLooks.card.text.worse, 'unmet requirement is red (DEX 5 < 8)');
ok(buildCard(magic, defs, { totals: { str: 5, dex: 9, int: 5 } }).lines.find((l) => l.kind === 'req').c === globalThis.ASSETS.itemLooks.card.text.same, 'met requirement is grey');

// Rare axe vs worn Magic sword: green / red / grey per stat
const rare = E('gen.axe', 5, 2, [['A1', 0.18], ['A8', 4]]);
const worn = E('gen.sword', 4, 1, [['A3', 0.02]]);
const cr = buildCard(rare, defs, { worn, totals });
console.log(cr.rows.join('\n'));
ok(cr.cmp.some((l) => l.kind === 'better' && l.t.startsWith('Avg damage +')), 'avg damage green');
ok(cr.cmp.some((l) => l.kind === 'worse' && l.t.startsWith('Crit chance -2')), 'crit chance red (worn has it)');
ok(cr.cmp.some((l) => l.kind === 'better' && l.t === 'STR +4'), 'STR green');
ok(cr.cmp.some((l) => l.kind === 'worse' && l.t.startsWith('Swing speed -15')), 'swing speed red');
ok(buildCard(rare, defs, { worn: rare, totals }).cmp.every((l) => l.kind === 'same' && l.t.endsWith('same')), 'identical = grey same');

// Unique boots
const boots = { id: 'gear.feet.riverBoots', n: 1, it: null };
const cu = buildCard(boots, defs, { worn: null, totals });
ok(cu && cu.tag === '[Unique]' && cu.lines[0].c === globalThis.ASSETS.itemLooks.rarity.unique.name, 'unique tag + name colour');
console.log(cu.rows.join('\n'));
ok(buildCard({ id: 'arrow', n: 3, it: null }, defs) === null, 'non-gear -> null');

console.log(fails ? 'FAIL ' + fails + '/' + checks : 'OK ' + checks + ' checks');
process.exit(fails ? 1 : 0);
