// ITEM-04: gear -> combatMods -> rolls / DR / speed / life. node game/js/quest/sim/combatMods.test.js
import assert from 'node:assert/strict';
import { combatMods as cm, refreshCombat, rollMelee, rollBow, rollRange, seedCombat, hitOut } from './combatMods.js';
import { createStatsCache } from './itemInst.js';
import { armourReduction } from './stats.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const cache = createStatsCache();
const mk = (main, it) => ({ rev: 1, main, ranged: null, off: null, head: null, body: null, cloak: null, hands: null, belt: null, legs: null, feet: null, it: { main: it } });
let eq = mk('gen.sword', { iL: 5, r: 2, a: [['A1', 0.2], ['A5', 0.1], ['A13', 3], ['A3', 0.1]] });
refreshCombat(cache, eq, {});
ok(cm.active === 1 && cm.mainMax > cm.mainMin && cm.mainMin > 10, 'sword iL5 rolled range x10 scale: ' + cm.mainMin + '-' + cm.mainMax);
ok(Math.abs(cm.speedRate - 0.1) < 1e-9 && cm.reachAdd === 0 && cm.lifeOnHit === 3, 'atk speed / life from affixes');
seedCombat(1); let crit = 0, lo = 1e9, hi = 0; const N = 20000;
for (let i = 0; i < N; i++) { rollMelee(1); if (hitOut.crit) crit++; else { lo = Math.min(lo, hitOut.dmg); hi = Math.max(hi, hitOut.dmg); } }
ok(lo >= cm.mainMin - 1e-9 && hi <= cm.mainMax + 1e-9, 'non-crit rolls inside [min,max]');
ok(Math.abs(crit / N - cm.critChance) < 0.01, 'crit rate ' + crit / N + ' vs ' + cm.critChance);
rollMelee(3); ok(hitOut.dmg >= cm.mainMin * 3 - 1e-6, 'heavy x3'); ok(hitOut.life === 3, 'life in payload');
// axe: slower, spear: faster + reach
eq = mk('gen.axe', { iL: 5, r: 0, a: [] }); refreshCombat(cache, eq, {});
ok(cm.speedRate < 0 && cm.critMult > 1.5, 'axe slower, +crit dmg');
eq = mk('gen.spear', { iL: 5, r: 0, a: [] }); refreshCombat(cache, eq, {});
ok(cm.speedRate > 0 && cm.reachAdd > 0.5, 'spear faster + reach');
// no gear -> inactive; bow roll 0 without a bow
refreshCombat(cache, null, {}); ok(cm.active === 0, 'inactive without equipment');
// DR by attacker level
ok(Math.abs(armourReduction(60, 1) - 0.5) < 1e-9 && armourReduction(1e6, 10) === 0.6, 'DR formula + 60 % cap');
ok(armourReduction(60, 5) < armourReduction(60, 1), 'higher attacker level -> less DR');
const a = rollRange(25, 35); ok(a >= 25 && a < 35, 'rollRange');
console.log('combatMods.test: ' + n + ' passed');
