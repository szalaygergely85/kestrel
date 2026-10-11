// QL-19 passives. Run: node game/js/quest/sim/equipmentPassives.test.js
import assert from 'node:assert/strict';
import '../../../../design/items.js'; // side effect: globalThis.ASSETS.items
import { ensureEquipment, defenceOf, reductionOf, applyDefence, isNight, nightBonus, hasSureFooting, wetStoneStep, DEF_CAP, WET_SLOW_S } from './equipment.js';
import { gearIdFor } from './loot.js';

const defs = globalThis.ASSETS.items.defs || globalThis.ASSETS.items;
const mk = (o) => { const eq = ensureEquipment({}); Object.assign(eq, o); return eq; };
const rows = [];
const cases = [['none', mk({})], ['cloak', mk({ cloak: 'gear.cloak.cloak.worn' })], ['boots', mk({ feet: 'gear.feet.riverBoots' })], ['cloak+boots', mk({ cloak: 'gear.cloak.cloak.worn', feet: 'gear.feet.riverBoots' })]];
// item x day/night table: reduction = 0.03 * points + night bonus
const exp = { none: [0, 0], cloak: [0.03, 0.13], boots: [0.06, 0.06], 'cloak+boots': [0.09, 0.19] };
for (const [name, eq] of cases) for (const [i, hour] of [[0, 12], [1, 23]]) {
  const r = reductionOf(defenceOf(eq, defs), nightBonus(eq, defs, hour));
  assert.ok(Math.abs(r - exp[name][i]) < 1e-9, `${name} @${hour}: ${r}`);
  rows.push(`${name.padEnd(12)} ${String(hour).padStart(2)}h ${(r * 100).toFixed(0)}%`);
}
for (const h of [21, 23.5, 0, 4.99]) assert.equal(isNight(h), true);
for (const h of [5, 12, 20.99]) assert.equal(isNight(h), false);
assert.equal(applyDefence(10, 0, 0.1), 9); assert.equal(applyDefence(10, 0, 0), 10);
assert.equal(reductionOf(100, 0.1), DEF_CAP, 'cap holds with the bonus');
// hood and tunic carry no passive; cosmetic hood unchanged by night
assert.equal(nightBonus(mk({ head: 'gear.head.hood.worn', body: 'gear.body.jerkin.worn' }), defs, 23), 0);
// wet stepping stones
const dt = 1 / 60, st = { t: 0 };
assert.equal(hasSureFooting(cases[2][1], defs), true); assert.equal(hasSureFooting(cases[1][1], defs), false);
assert.equal(wetStoneStep(st, cases[0][1], defs, true, true, false, dt), 0.5, 'sprint onto wet stone, no boots: slow step');
let steps = 0; while (wetStoneStep(st, cases[0][1], defs, true, true, true, dt) < 1) steps++;
assert.ok(Math.abs((steps + 1) * dt - WET_SLOW_S) < 2 * dt, 'lasts 0.4 s: ' + steps);
const s2 = { t: 0 };
assert.equal(wetStoneStep(s2, cases[2][1], defs, true, true, false, dt), 1, 'River Boots: no stumble');
assert.equal(wetStoneStep(s2, cases[0][1], defs, false, true, false, dt), 1, 'walking: no stumble');
assert.equal(wetStoneStep(s2, cases[0][1], defs, true, false, false, dt), 1, 'dry stone: no stumble');
// loot rolls unchanged: River Boots is never the rolled feet piece
for (const t of ['worn', 'sturdy', 'fine']) assert.equal(gearIdFor(defs, 'feet', t), 'gear.feet.boots.' + t);
console.log(rows.join('\n')); console.log('equipment passives tests passed');
