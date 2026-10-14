// ITEM-03 tests: ranges, counts, no duplicates, slot rules, determinism, names, req + reachability (ITEM-09).
import { generateItem, itemView, baseStats, baseName, BASE_TYPES, ITEM_BASES, affixesFor, reqValue, typeOfId } from './itemGen.js';
import { createStatsRng, affixRange, meetsRequirement } from './stats.js';
import { AFFIX, RARITY, STATS_CFG, ALL_SLOTS } from './statsConfig.js';

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL ' + m); } };

// 1. 10k rolls per iL
for (let iL = 1; iL <= 10; iL++) {
  const rng = createStatsRng(1000 + iL), seen = new Set();
  let bad = 0;
  for (let k = 0; k < 10000; k++) {
    const inst = generateItem(rng, { iL }), it = inst.it, type = typeOfId(inst.id), b = ITEM_BASES[type];
    seen.add(type);
    if (it.iL !== iL || it.r < 0 || it.r > 3 || inst.n !== 1) bad++;
    if (it.a.length !== RARITY[it.r].lines) bad++;
    const ids = it.a.map((x) => x[0]);
    if (new Set(ids).size !== ids.length) bad++;
    const al = affixesFor(type);
    for (const [id, v] of it.a) {
      const r = affixRange(id, iL);
      const lo = AFFIX[id].int ? Math.round(r[0]) : r[0], hi = AFFIX[id].int ? Math.round(r[1]) : r[1];
      if (!al.includes(id) || v < lo - 1e-9 || v > hi + 1e-9) bad++;
    }
    const s = baseStats(type, iL, it.r), m = RARITY[it.r].base;
    if (b.kind === 'weapon') {
      if (s.dmg[0] !== Math.round((4 + 2 * iL) * b.dmgMul * m) || s.dmg[1] < s.dmg[0]) bad++;
    } else if (!(s.armour > 0)) bad++;
    if (baseName(type, iL).length > 14) bad++;
    if (b.reqAttr ? it.req[b.reqAttr] !== reqValue(iL) : it.req !== undefined) bad++;
  }
  ok(bad === 0 && seen.size === BASE_TYPES.length, 'iL' + iL + ' 10k rolls bad=' + bad + ' types=' + seen.size);
}
// 2. slot rules on every type
for (const t of BASE_TYPES) {
  const slot = ITEM_BASES[t].slot, al = affixesFor(t);
  ok(ALL_SLOTS.includes(slot), t + ' slot');
  ok(al.every((id) => AFFIX[id]), t + ' ids');
  ok(!al.includes('A14') || slot === 'feet', t + ' A14 feet only');
  ok(!al.includes('A15') || slot === 'off', t + ' A15 shield only');
  ok(!al.includes('A13') || ITEM_BASES[t].kind === 'weapon', t + ' A13 weapon only');
  ok(al.includes('A8'), t + ' A8 all');
}
// 3. determinism + no unique
{
  const a = [], b = [];
  const r1 = createStatsRng(77), r2 = createStatsRng(77);
  for (let i = 0; i < 500; i++) { a.push(generateItem(r1, { iL: 1 + i % 10 })); b.push(generateItem(r2, { iL: 1 + i % 10 })); }
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed same items');
  ok(a.every((x) => x.it.r < 4), 'no unique rolled');
  ok(generateItem(createStatsRng(1), { iL: 5, r: 4 }).it.r === 3, 'unique request clamped');
  ok(generateItem(createStatsRng(1), { iL: 5, slot: 'feet' }).id === 'gen.armour.feet', 'slot filter');
}
// 4. req values + reachability (ITEM-09): kit of Magic iL n-1, nine slots, one attribute line each, best attribute.
{
  ok([1, 2, 3, 5, 7, 9, 10].map(reqValue).join() === '5,5,6,8,10,12,13', 'req table');
  const slots9 = ALL_SLOTS.filter((s) => s !== 'ranged');
  const out = [];
  for (let n = 3; n <= 10; n++) {
    const rng = createStatsRng(5000 + n), need = reqValue(n);
    let hit = 0;
    for (let k = 0; k < 2000; k++) {
      const sum = { A8: 0, A9: 0, A10: 0 };
      for (let s = 0; s < slots9.length; s++) {
        // real Magic item of that slot; reroll (seeded) until its one line is an attribute line
        let inst;
        do { inst = generateItem(rng, { iL: n - 1, r: 1, slot: slots9[s] }); } while (!(inst.it.a[0][0] in sum));
        sum[inst.it.a[0][0]] += inst.it.a[0][1];
      }
      if (STATS_CFG.attrBase + Math.max(sum.A8, sum.A9, sum.A10) >= need) hit++;
    }
    out.push('iL' + n + ' req ' + need + ' reach ' + (hit / 20).toFixed(1) + '%');
    ok(hit / 2000 >= 0.9, 'reachable iL' + n + ' ' + hit / 20 + '%');
  }
  console.log(out.join(' | '));
  const v = itemView(generateItem(createStatsRng(3), { iL: 9, type: 'bow', r: 0 }));
  ok(v.req.dex === 12 && !meetsRequirement(v, { str: 5, dex: 11, int: 5 }) && meetsRequirement(v, { str: 5, dex: 12, int: 5 }), 'Steel Bow needs DEX 12');
}
console.log('itemGen: ' + (checks - fails) + '/' + checks + ' checks' + (fails ? ' FAILED' : ' ok'));
if (fails) process.exit(1);
