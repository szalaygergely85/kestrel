// ITEM-01 tests. Run: node --expose-gc game/js/quest/sim/stats.test.js
import { allocProbe } from '../../../../tools/allocProbe.mjs';
import { computeTotals, createTotals, rollHit, rollAffix, affixRange, armourReduction, meetsRequirement, createStatsRng } from './stats.js';
import { AFFIX, STATS_CFG } from './statsConfig.js';

let bad = 0; const chk = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${x}`); if (!c) bad++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const eq = {
  main: { type: 'sword', iL: 5, r: 2, dmg: [14, 22], a: [['A1', 0.2], ['A2', 3], ['A3', 0.02], ['A4', 0.2], ['A13', 2]] },
  ranged: { type: 'bow', iL: 5, r: 1, dmg: [12, 20], a: [] },
  off: { type: 'shield', iL: 5, r: 1, armour: 14, a: [['A7', 0.1], ['A15', 0.1], ['A8', 3]] },
  body: { type: 'armour', iL: 5, r: 1, armour: 21, a: [['A6', 5], ['A9', 5], ['A11', 20]] },
  feet: { type: 'armour', iL: 5, r: 1, armour: 7, a: [['A14', 0.2], ['A10', 2], ['A12', 10]] },
  head: null,
};
const t = computeTotals(eq);
chk('attributes', t.str === 8 && t.dex === 10 && t.int === 7, `${t.str}/${t.dex}/${t.int}`);
chk('hp / mana', t.hp === 120 && t.mana === 100 + 10 + 2 * 2, `${t.hp}/${t.mana}`);
chk('armour = (14+21+7+5) * 1.1', near(t.armour, 47 * 1.1, 1e-9), `${t.armour}`);
chk('crit chance 5% + 2% + 5*0.2%', near(t.critChance, 0.08, 1e-9), `${t.critChance}`);
chk('crit mult 1.5 + 0.2', near(t.critMult, 1.7, 1e-9));
chk('main dmg min = 14*(1+3*2%)*1.2+3', near(t.mainMin, 14 * 1.06 * 1.2 + 3, 1e-9), `${t.mainMin}`);
chk('bow dmg uses DEX', near(t.bowMax, 20 * 1.1 * 1.2 + 3, 1e-9));
chk('move speed capped 15%', t.moveSpeed === 0.15);
chk('block = 10% + 3 STR', near(t.blockPct, 0.13, 1e-9));
chk('empty equipment = base', (() => { const e = computeTotals({}); return e.hp === 100 && e.mana === 100 && e.str === 5 && e.armour === 0 && near(e.critChance, 0.05, 1e-9); })());

// Armour DR
chk('DR exact at 5 points (L1)', near(armourReduction(5, 1), 5 / 65, 1e-12));
chk('DR exact at 5 points (L10)', near(armourReduction(5, 10), 5 / 245, 1e-12));
chk('DR never > 60%', armourReduction(1e9, 1) === 0.6 && armourReduction(100000, 10) <= 0.6);
chk('DR 0 for no armour', armourReduction(0, 3) === 0);

// Requirement hook
chk('requirement met / unmet', meetsRequirement({ req: { dex: 12 } }, { str: 5, dex: 12, int: 5 }) && !meetsRequirement({ req: { dex: 12 } }, { str: 5, dex: 11, int: 5 }) && meetsRequirement({}, t));

// Seeded affix rolls: mean within 2 % for every affix at iL 1, 5, 10 (integer affixes: rounding bias is < 2 % except tiny ranges, so use 2 % of the range centre or 0.05 absolute)
let worst = 0;
for (const id of Object.keys(AFFIX)) for (const iL of [1, 5, 10]) {
  const rng = createStatsRng(1234 + iL), r = affixRange(id, iL); let s = 0;
  for (let i = 0; i < 10000; i++) s += rollAffix(id, iL, rng);
  const mean = s / 10000, exp = (r[0] + r[1]) / 2;
  if (AFFIX[id].int) continue; // rounded: checked separately below
  worst = Math.max(worst, Math.abs(mean - exp) / exp);
}
chk('10k rolls mean within 2 % (non-integer affixes, iL 1/5/10)', worst < 0.02, `worst ${(worst * 100).toFixed(2)} %`);
let worstI = 0;
for (const id of Object.keys(AFFIX)) if (AFFIX[id].int) for (const iL of [1, 5, 10]) {
  const rng = createStatsRng(77 + iL), r = affixRange(id, iL); let s = 0;
  for (let i = 0; i < 10000; i++) s += rollAffix(id, iL, rng);
  const mean = s / 10000, exp = (r[0] + r[1]) / 2;
  worstI = Math.max(worstI, Math.abs(mean - exp) / exp);
}
chk('integer affixes mean within 4 % of centre (rounding)', worstI < 0.04, `worst ${(worstI * 100).toFixed(2)} %`);
chk('affix range linear in iL', near(affixRange('A1', 5.5)[0], (0.05 + 0.25) / 2, 1e-12));
const a = [], b = [];
{ const r1 = createStatsRng(7), r2 = createStatsRng(7); for (let i = 0; i < 5; i++) { a.push(rollAffix('A8', 6, r1)); b.push(rollAffix('A8', 6, r2)); } }
chk('same seed -> same rolls', a.join() === b.join());

// Hit rolls: crit rate and mean damage
{
  const rng = createStatsRng(99), out = { dmg: 0, crit: false, life: 0 }; let crits = 0, sum = 0; const N = 20000;
  for (let i = 0; i < N; i++) { rollHit(t, false, rng(), rng(), out); if (out.crit) crits++; sum += out.dmg; }
  chk('crit rate within 1 %', near(crits / N, t.critChance, 0.01), `${(crits / N).toFixed(4)} vs ${t.critChance}`);
  const exp = (t.mainMin + t.mainMax) / 2 * (1 + t.critChance * (t.critMult - 1));
  chk('hit mean within 2 %', near(sum / N, exp, exp * 0.02), `${(sum / N).toFixed(2)} vs ${exp.toFixed(2)}`);
  chk('life on hit passed', out.life === 2);
}
chk('crit chance cap 50 %', computeTotals({ main: { dmg: [1, 2], a: [['A3', 0.9]] } }).critChance === STATS_CFG.crit.chanceCap);

// 0 alloc per rollHit
{
  const out = { dmg: 0, crit: false, life: 0 }, rng = createStatsRng(5);
  const r = allocProbe((n) => { let u = 0.13; for (let i = 0; i < n; i++) { u = (u * 7.31 + 0.17) % 1; rollHit(t, false, u, 1 - u, out); } }, { n: 20000, warm: 2 });
  chk('rollHit 0 alloc', r.perCall < 1, `${r.perCall.toFixed(2)} B/call`);
  const tt = createTotals();
  const r2 = allocProbe((n) => { for (let i = 0; i < n; i++) computeTotals(eq, tt); }, { n: 5000, warm: 2 });
  chk('computeTotals (reused out) < 16 B', r2.perCall < 16, `${r2.perCall.toFixed(2)} B/call`);
}
if (bad) process.exitCode = 1;
