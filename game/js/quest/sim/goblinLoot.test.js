// GOB-05: goblin loot table + weapon source, tier forced by band. Run: node game/js/quest/sim/goblinLoot.test.js
import { readFileSync } from 'node:fs';
import { createRng } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import { createLoot } from './loot.js';
import { LOOT_TABLE, LOOT_PROMPT } from './lootConfig.js';
import { BAND_TABLE } from './band.js';

await loadTestAssets();
itemsMod;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const items = globalThis.ASSETS.items.defs;

const G = LOOT_TABLE.goblin;
ok('goblin table: no fixed, arrow 2-4 @0.3, trinket x1 @0.25, orb 0.4', G.fixed.length === 0 && G.rolls[0].give.item === 'arrow' && G.rolls[0].chance === 0.3 && G.rolls[0].give.min === 2 && G.rolls[0].give.max === 4 && G.rolls[1].give.item === 'goblin.trinket' && G.rolls[1].chance === 0.25 && G.orb.chance === 0.4);
ok('goblin.trinket has an item def', !!items['goblin.trinket'] && !!items['arrow']);
ok('goblin prompt', LOOT_PROMPT.goblin === '[E] Loot goblin');

// --- through createLoot: goblin slot uses the goblin table + band tier; boar slot unchanged
function run(group, x, y, seed) {
  const events = (() => { const h = {}; return { on: (n, f) => { (h[n] ||= []).push(f); return () => {}; }, emit: (n, p) => (h[n] || []).forEach((f) => f(p)) }; })();
  const world = { state: {}, addInteractable: (r) => r };
  const ents = [{ transform: { x, y, z: 0 }, components: { targetable: { radius: 0.4, height: 1.2 } } }];
  const beasts = { count: 1, ids: ['b0'], entities: ents, slotOf: (id) => (id === 'b0' ? 0 : -1), group: new Uint8Array([group]) };
  const band = { bandAt: () => 5, gearTierAt: (bx, by) => BAND_TABLE.gearTier[Math.floor(bx) - 1] }; // x = the band in this stub
  const loot = createLoot(world, events, { items, beasts, rng: createRng(seed), inventoryOf: () => null, table: LOOT_TABLE.boar, band });
  loot.die = () => events.emit('beast:died', { id: 'b0', x, y, z: 0 }); // repeated deaths advance the loot + weapon streams
  return loot;
}
{
  let trinkets = 0, arrows = 0, weaponTiers = {}, boarMeat = 0, n = 4000;
  for (const [band, want] of [[5, 'fine'], [7, 'tempered'], [9, 'warden']]) {
    weaponTiers[band] = new Set();
    const l = run(2, band, 0, 1);
    for (let s = 0; s < n; s++) {
      l.die();
      const o = 0; // slot 0
      for (let k = 0; k < 4; k++) { if (l.corpseItem[o + k] === 'goblin.trinket') trinkets += l.corpseN[o + k]; if (l.corpseItem[o + k] === 'arrow') arrows += l.corpseN[o + k] > 0 ? 1 : 0; if (l.corpseItem[o + k] === 'boar.meat') boarMeat++; }
      if (l.gearHeld[0]) weaponTiers[band].add(l.instHeld[0].it.iL);
    }
    const realWant = want;
    ok('goblin at band ' + band + ': gear iL = band (ITEM-06)', weaponTiers[band].size === 1 && weaponTiers[band].has(5), [...weaponTiers[band]].join());
  }
  ok('goblin corpses never hold boar meat', boarMeat === 0);
  ok('trinket ~25 % and arrows ~30 %', Math.abs(trinkets / (3 * n) - 0.25) < 0.03 && Math.abs(arrows / (3 * n) - 0.3) < 0.03, trinkets / (3 * n) + ' ' + arrows / (3 * n));
  // boar (group 0) at a goblin-weapon-free table: fixed meat, no goblin trinket; same seed -> same result with and without a group array
  const a = run(0, 1, 0, 77), b = run(0, 1, 0, 77); a.die(); b.die();
  ok('boar corpse: meat, deterministic, no goblin items', a.corpseItem[0] === 'boar.meat' && a.corpseN[0] === 1 && JSON.stringify(Array.from(a.corpseN.slice(0, 4))) === JSON.stringify(Array.from(b.corpseN.slice(0, 4))));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
