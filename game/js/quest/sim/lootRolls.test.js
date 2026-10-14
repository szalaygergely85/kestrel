// ITEM-06: gear drop rates by source, rarity weights by band side, chest min Rare / 1-2 items, pack full. Run: node game/js/quest/sim/lootRolls.test.js
import { makeOk } from '../../../../engine/test/assert.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';
import { weaponRng, rollKillGear, rollChestGear, rollRarity, rollType } from './loot.js';
import { GEAR_DROP, RARITY_BY_SIDE } from './lootConfig.js';
import { registerGenDefs } from './itemInst.js';
import { createLoot } from './loot.js';
import { createChests } from './chest.js';
import { ensureInventory } from './inventory.js';

await loadTestAssets(); itemsMod;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const defs = globalThis.ASSETS.items.defs; registerGenDefs(defs);
const N = 100000;

// drop rate per source (+-0.5 pp), 100k seeded kills each
for (const [src, g] of Object.entries(GEAR_DROP)) {
  const f = weaponRng(0xABC ^ src.length); let hit = 0;
  for (let i = 0; i < N; i++) if (rollKillGear(f, src, 3)) hit++;
  ok(`${src} drop rate ${(hit / N * 100).toFixed(2)} % vs ${g.chance * 100} %`, Math.abs(hit / N - g.chance) < 0.005);
}
// rarity weights per side (+-1 pp) over 100k drops (rBonus 0, wolf), iL = band
for (const [side, band] of [['near', 2], ['far', 7]]) {
  const f = weaponRng(7 + band), c = [0, 0, 0, 0]; let n = 0;
  for (let i = 0; i < N; i++) { const it = rollKillGear(f, 'goblinElite', band); if (it) { n++; c[it.it.r]++; } }
  // elite = +1 step: C->M, M->R, R+E->E
  const w = RARITY_BY_SIDE[side], want = [0, w[0], w[1], w[2] + w[3]];
  ok(`${side} elite rarity (+1 step) within 1 pp: ${c.map((x) => (x / n * 100).toFixed(1))}`, want.every((x, k) => Math.abs(c[k] / n * 100 - x) < 1));
  const f2 = weaponRng(99 + band), d = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) d[rollRarity(f2, band)]++;
  ok(`${side} plain rarity weights within 1 pp: ${d.map((x) => (x / N * 100).toFixed(1))}`, w.every((x, k) => Math.abs(d[k] / N * 100 - x) < 1));
}
// type pick 30 % weapons / 70 % armour
{ const f = weaponRng(5); let wpn = 0; const K = 50000;
  for (let i = 0; i < K; i++) if (/^(sword|axe|spear|bow|shield)$/.test(rollType(f))) wpn++;
  ok('weapons ~30 %', Math.abs(wpn / K - 0.3) < 0.01, wpn / K); }
// iL = band; Unique never
{ const f = weaponRng(3); let bad = 0;
  for (let i = 0; i < 20000; i++) { const it = rollKillGear(f, 'bear', 6); if (it && (it.it.iL !== 6 || it.it.r > 3)) bad++; }
  ok('kill gear iL == band, rarity <= Epic', bad === 0); }
// chest: 1-2 items, min Rare, iL band+1
{ const f = weaponRng(11); let bad = 0, two = 0;
  for (let i = 0; i < 20000; i++) { const g = rollChestGear(f, 4); if (g.length < 1 || g.length > 2) bad++; if (g.length === 2) two++; for (const x of g) if (x.it.r < 2 || x.it.iL !== 5) bad++; }
  ok('chest 1-2 items, min Rare, iL band+1', bad === 0 && two > 8000 && two < 12000, bad + ' ' + two); }
// determinism
ok('same seed -> same item', JSON.stringify(rollChestGear(weaponRng(1), 3)) === JSON.stringify(rollChestGear(weaponRng(1), 3)));
// pack full: chest stays closed, nothing lost
{
  const inv = ensureInventory({ transform: {}, components: {} }, { pack: [], left: null, right: null });
  const events = { emit() {}, on() { return () => {}; } };
  const tbl = { fixed: [], weighted: [], gear: {} };
  const loot = createLoot(null, events, { kind: 'chest', items: defs, table: tbl, rng: { nextFloat: weaponRng(2) }, inventoryOf: () => inv, bandIL: 4 });
  ok('chest rolled 1-2 instances', loot.insts.length >= 1 && loot.insts.length <= 2 && loot.insts.every((x) => x.it.r >= 2 && x.it.iL === 5));
  for (const s of inv.slots) { s.id = 'boar.meat'; s.n = 1; }
  ok('pack full: canClaim false, claim false, still unclaimed', !loot.canClaim() && !loot.claim());
  for (const s of inv.slots) { s.id = null; s.n = 0; }
  ok('space again: claim works, instances in the pack', loot.claim() && inv.slots.filter((s) => s.id && s.id.startsWith('gen.')).length === loot.insts.length);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((m) => console.error('FAIL:', m)); process.exit(1); }
console.log('ALL PASS');
