// game/js/quest/sim/power.test.js (PLAYER-LEVEL-01 v2, D-116; SPELL-R8 AC1/AC3). node game/js/quest/sim/power.test.js
import assert from 'node:assert/strict';
import { World, AssetRegistry } from '../../../../engine/index.js';
import {
  itemPower, slotPower, itemPowerTotal, spellPower, levelFromPower, playerPower, playerLevel, itemLevel, fireballGateOpen,
  formatPower, powerText, powerCompare, headerText, breakdownText, nextLevelText, hudLevelText, levelUpText, enemyTint, zoneHint,
} from './power.js';
import { affixRange } from './stats.js';
import { createSpellBook } from './spellBook.js';
import { useScroll, SCROLL_ID } from './spellScroll.js';
import { ensureInventory, addItem } from './inventory.js';
import { ensureEquipment } from './equipment.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from '../save/saveState.js';

const SLOT_TYPE = { main: 'sword', ranged: 'bow', off: 'shield' };
const W = { main: 3, body: 3, off: 2, ranged: 2, head: 2, legs: 2, hands: 1, feet: 1, cloak: 1, belt: 1 };
const KIT = Object.keys(W);
const mid = (id, iL, q = 0.5) => { const r = affixRange(id, iL); return [id, r[0] + (r[1] - r[0]) * q]; };
/** rolled instance: rarity index r, n lines at quality q (A3 = non-integer affix, any slot is fine for power) */
const inst = (slot, iL, r, n = [0, 1, 2, 3, 3][r], q = 0.5) => ({ type: SLOT_TYPE[slot] || slot, iL, r, a: Array.from({ length: n }, () => mid('A3', iL, q)) });
const kit = (iL, r, slots = KIT) => { const e = {}; for (const s of slots) e[s] = inst(s, iL, r); return e; };
const defs = {
  sword: { id: 'sword', kind: 'gear', equip: { slot: 'main', tier: 'worn' } }, bow: { id: 'bow', kind: 'gear', equip: { slot: 'ranged', tier: 'worn' } },
  shield: { id: 'shield', kind: 'gear', equip: { slot: 'off', tier: 'worn' } }, arrow: { id: 'arrow', kind: 'gear', equip: { slot: 'quiver', tier: 'worn' } },
  'spell.fireball': { id: 'spell.fireball', kind: 'spell', equip: { slot: 'off', tier: 'worn' } },
  's.sturdy': { kind: 'gear', equip: { slot: 'main', tier: 'sturdy' } }, 's.fine': { kind: 'gear', equip: { slot: 'main', tier: 'fine' } },
  's.tempered': { kind: 'gear', equip: { slot: 'main', tier: 'tempered' } }, 's.warden': { kind: 'gear', equip: { slot: 'main', tier: 'warden' } },
};
const S = (fireball = 0, freeze = 0, telekinesis = 0, teleport = 0) => ({ fireball, freeze, telekinesis, teleport });

// ---- AC1 itemPower goldens ----
assert.equal(itemPower('sword', defs), 60, 'iL1 Common sword');
assert.equal(itemPower('shield', defs), 40); assert.equal(itemPower('bow', defs), 40);
assert.equal(itemPower(inst('body', 2, 2), defs, 'body'), 340, 'iL2 Rare body');
assert.equal(itemPower(inst('body', 5, 1), defs, 'body'), 1800, 'iL5 Magic body');
assert.equal(itemPower({ type: 'sword', iL: 10, r: 4, a: [['A1', 0.3], ['A2', 10], ['A13', 5]] }, defs), 12300, 'iL10 Unique weapon');
assert.equal(itemPower('arrow', defs), 0, 'quiver'); assert.equal(itemPower({ id: 'arrow', n: 9 }, defs, 'quiver'), 0);
assert.equal(itemPower(null, defs), 0); assert.equal(itemPower(undefined), 0); assert.equal(itemPower('nope', defs), 0);
assert.equal(itemPower('spell.fireball', defs), 0, 'a spell in the off hand is not gear');
// old ids: iL1 C / iL2 M / iL4 M / iL6 R / iL8 R (main weight 3, unrolled lines q 0.5)
assert.equal(itemPower('s.sturdy', defs), Math.round(20 * 4 * 3 * 1.2 / 10) * 10);
assert.equal(itemPower('s.fine', defs), 1150); assert.equal(itemPower('s.tempered', defs), Math.round(20 * 36 * 3 * 1.4 / 10) * 10);
assert.equal(itemPower('s.warden', defs), Math.round(20 * 64 * 3 * 1.4 / 10) * 10);

// ---- AC2 band edges ----
for (const [p, L] of [[0, 1], [999, 1], [1000, 2], [2499, 2], [2500, 3], [4999, 3], [5000, 4], [7999, 4], [8000, 5], [11999, 5], [12000, 6],
  [16999, 6], [17000, 7], [21999, 7], [22000, 8], [27999, 8], [28000, 9], [34999, 9], [35000, 10], [1e7, 10], [-5, 1], [NaN, 1], [undefined, 1]]) assert.equal(levelFromPower(p), L, 'band ' + p);

// ---- AC3 example kits ----
const kit1 = { main: 'sword', ranged: 'bow', off: 'shield' };
const kit2 = { ...kit1, body: inst('body', 2, 2), head: inst('head', 1, 1), feet: inst('feet', 1, 0) };
const kit3 = { main: inst('main', 4, 1), body: inst('body', 4, 1), off: inst('off', 3, 1), ranged: inst('ranged', 3, 0), head: inst('head', 3, 1),
  legs: inst('legs', 3, 1), hands: inst('hands', 3, 0), feet: inst('feet', 3, 1), cloak: inst('cloak', 2, 1) };
const kit4a = kit(5, 1), kit4b = { ...kit4a, main: inst('main', 5, 2), body: inst('body', 5, 2) };
const kit5 = { main: { type: 'sword', iL: 10, r: 4, a: [['A1', 0.3], ['A2', 10], ['A13', 5]] }, body: inst('body', 10, 3),
  ...kit(10, 2, ['off', 'ranged', 'head', 'legs', 'hands', 'feet', 'cloak', 'belt']) };
for (const [k, sp, items, spells, total, L] of [[kit1, S(), 140, 0, 140, 1], [kit2, S(1), 550, 250, 800, 1], [kit3, S(2, 1), 4450, 850, 5300, 4],
  [kit4a, S(1, 1, 1), 10800, 750, 11550, 5], [kit4b, S(1, 1, 1), 11400, 750, 12150, 6], [kit5, S(3, 3, 3, 3), 55500, 4000, 59500, 10]]) {
  assert.equal(itemPowerTotal(k, defs), items); assert.equal(spellPower(sp), spells);
  assert.equal(playerPower(sp, k, defs), total); assert.equal(playerLevel(sp, k, defs), L, 'kit total ' + total);
}

// ---- AC4 balance sweep ----
for (let N = 1; N <= 10; N++) {
  assert.equal(itemLevel(kit(N, 0), defs), N, 'Common kit iL' + N); assert.equal(itemLevel(kit(N, 1), defs), N, 'Magic kit iL' + N);
  const rL = itemLevel(kit(N, 2), defs); assert.ok(rL === N || rL === Math.min(10, N + 1), 'Rare kit iL' + N + ' -> ' + rL);
  assert.ok(itemLevel(kit(N, 3), defs) <= Math.min(10, N + 2), 'Epic kit iL' + N);
}

// ---- AC5 spellPower (+ SPELL-R8 AC3: tier sums 8 and 12 = same level, levels clamp at 3) ----
assert.equal(spellPower(S(1)), 250); assert.equal(spellPower(S(2)), 600); assert.equal(spellPower(S(3)), 1000);
assert.equal(spellPower(S(3, 3, 3, 3)), 4000); assert.equal(spellPower(S(1, 1, 1, 1)), 1000, '4 spells learned L1 = +1,000');
for (let t = 4; t <= 9; t++) assert.equal(spellPower(S(t)), 1000);
assert.equal(spellPower({ spark: 3, fireball: 0 }), 0, 'unknown ids + level 0');
// v1 wording "tier sum 8 and 12 give the same level" is superseded (spec v2 note): the cap is per spell at L3, so a
// tier sum of 12 (all L3) and any higher sum give the same power and level; sum 8 (all L2) stays one band lower.
assert.equal(playerLevel(S(3, 3, 3, 3), {}, defs), playerLevel(S(5, 5, 5, 5), {}, defs), 'tier sum 12 vs 20 (clamp)');
assert.equal(spellPower(S(4, 4, 4, 4)), spellPower(S(3, 3, 3, 3)), 'tier sum 16 = 12');
assert.equal(playerLevel(S(2, 2, 2, 2), {}, defs), 2); assert.equal(playerLevel(S(3, 3, 3, 3), {}, defs), 3);
assert.ok(playerLevel(S(9, 9, 9, 9), {}, defs) <= 3, 'spells alone <= level 3');
assert.equal(spellPower({ tier: (id) => (id === 'freeze' ? 2 : 0) }), 600, 'book with tier(id)');

// ---- AC6 pure, safe, monotonic, 0 alloc ----
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const randKit = () => { const e = {}; for (const s of KIT) if (rnd() < 0.85) { const iL = (rnd() * 13) | 0, r = (rnd() * 5) | 0; e[s] = inst(s, iL, r, (rnd() * 4) | 0, rnd()); } return e; };
const randSp = () => S((rnd() * 6) | 0, (rnd() * 6) | 0, (rnd() * 6) | 0, (rnd() * 6) | 0);
for (let i = 0; i < 10000; i++) {
  const k = randKit(), sp = randSp(), snap = JSON.stringify([k, sp]);
  const L = playerLevel(sp, k, defs);
  assert.ok(Number.isInteger(L) && L >= 1 && L <= 10);
  assert.equal(JSON.stringify([k, sp]), snap, 'inputs not mutated');
  // monotonic: raise one thing
  const s = KIT[(rnd() * KIT.length) | 0], it = k[s], p0 = playerPower(sp, k, defs);
  if (it) {
    const up = { ...it, a: it.a.slice() }, what = (rnd() * 3) | 0;
    if (what === 0) up.iL = it.iL + 1; else if (what === 1) up.r = Math.min(4, it.r + 1); else if (up.a.length) up.a[0] = mid('A3', Math.max(1, it.iL), 1);
    const k2 = { ...k, [s]: up };
    assert.ok(playerPower(sp, k2, defs) >= p0, 'monotonic item'); assert.ok(playerLevel(sp, k2, defs) >= L);
  }
  const sp2 = { ...sp, freeze: sp.freeze + 1 }; assert.ok(playerPower(sp2, k, defs) >= p0, 'monotonic spell');
}
for (const a of [[], [undefined], [null, null, null], [{}, {}, {}], [S(), 'x', null]]) { assert.doesNotThrow(() => playerLevel(...a)); assert.equal(playerLevel(...a), 1); }
assert.equal(itemPowerTotal(undefined), 0); assert.equal(spellPower(undefined), 0);
// 0-alloc check: power.alloc.test.js (own isolate; the fuzz above deopts the functions on purpose)

// ---- AC7 D-069 gate on item power only ----
assert.equal(itemLevel(kit4a, defs), 5); assert.equal(fireballGateOpen(kit4a, defs), true);
assert.equal(fireballGateOpen(kit3, defs), false);
const kit4m = kit(4, 1);
assert.equal(itemPowerTotal(kit4m, defs), 6900);
assert.equal(playerLevel(S(3, 3, 3, 3), kit4m, defs), 5); assert.equal(itemLevel(kit4m, defs), 4); assert.equal(fireballGateOpen(kit4m, defs), false);

// ---- AC8 text goldens ----
assert.equal(powerText(1800), 'Power 1,800'); assert.equal(formatPower(59500), '59,500'); assert.equal(formatPower(140), '140'); assert.equal(formatPower(1000000), '1,000,000');
assert.equal(powerCompare(2150, 1800).text, 'Power +350'); assert.equal(powerCompare(1680, 1800).text, 'Power -120'); assert.equal(powerCompare(60, 60).text, 'Power same');
assert.equal(powerCompare(340, 0).tone, 'up', 'empty slot = green');
assert.equal(headerText(5300), 'Power 5,300 - Level 4'); assert.equal(breakdownText(4450, 850), 'Items 4,450 + Spells 850');
assert.equal(nextLevelText(5300), 'Next level at 8,000'); assert.equal(nextLevelText(59500), 'Max level');
assert.equal(hudLevelText(4), 'Lv 4'); assert.equal(levelUpText(5), 'Level up! 5');
const tints = [], hints = [];
for (let p = 1; p <= 10; p++) for (let e = 1; e <= 10; e++) {
  const d = e - p, t = enemyTint(e, p), z = zoneHint(e, p); tints.push(t); hints.push(z);
  assert.equal(t, d <= -3 ? 'grey' : d <= -1 ? 'green' : d === 0 ? 'white' : d <= 2 ? 'yellow' : 'red');
  assert.equal(z, d >= 2 ? 'Dangerous here' : d <= -2 ? 'Easy' : 'Fair');
}
for (const s of [powerText(1), headerText(1), breakdownText(1, 1), nextLevelText(1), nextLevelText(1e6), hudLevelText(1), levelUpText(2), ...tints, ...hints]) assert.ok(!/XP/.test(s), s);

// ---- SPELL-R8 AC1: level recomputes on learn + scroll use; Save/Continue: level derived, never stored ----
{
  const assets = new AssetRegistry({ palette: {} });
  const world = World.load({ name: 'pw_fixture', terrain: null, structures: [], entities: [] }, assets, {});
  const h = world.spawn('unit', { x: 1, y: 2, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 5, max: 10, invuln: 0 } }, 'player');
  const inv = ensureInventory(h.data, { pack: [] });
  const scrollDefs = { [SCROLL_ID]: { id: SCROLL_ID, kind: 'scroll', stackMax: 9 } };
  addItem(inv, scrollDefs, SCROLL_ID, 2);
  const eq = ensureEquipment(h.data); eq.main = 'sword'; eq.off = 'shield'; eq.ranged = 'bow';
  eq.rolled = { body: { id: 'body#1', ...inst('body', 4, 1) } }; eq.body = 'body#1';
  const book = createSpellBook(world.state);
  assert.equal(playerPower(book.tiers(), eq, defs), 140 + 1150);
  book.learn('freeze'); book.learn('fireball'); book.learn('telekinesis');
  assert.equal(playerPower(book.tiers(), eq, defs), 1290 + 750);
  assert.equal(playerLevel(book.tiers(), eq, defs), 2);
  const r = useScroll(inv, book, 'freeze'); assert.equal(r.ok, true); assert.equal(r.level, 2);
  assert.equal(playerPower(book.tiers(), eq, defs), 1290 + 1100, 'scroll use recomputes (Freeze is now level 2)');
  assert.equal(slotPower(eq, 'body', defs), 1150, 'rolled instance counts while worn');
  const L0 = playerLevel(book.tiers(), eq, defs), P0 = playerPower(book.tiers(), eq, defs);
  const text = stringifyGameSave(collectSave(world, {}));
  assert.ok(!/"(level|power|playerLevel|playerPower)"/i.test(text), 'save holds no level / power field');
  const back = applySave(parseGameSave(text), assets, {}), bp = back.world.get('player').data;
  const book2 = createSpellBook(back.world.state);
  assert.equal(playerPower(book2.tiers(), bp.components.equipment, defs), P0, 'Continue: same power');
  assert.equal(playerLevel(book2.tiers(), bp.components.equipment, defs), L0, 'Continue: same level');
}
console.log('power.test: ok');

// ---- SPELL-R8: HUD text + "Level up!" flash for 2 s on a rise, no flash on load ----
{
  const { stepLevelHud, resetLevelHud } = await import('../levelHud.js');
  resetLevelHud(); const w1 = {}, w2 = {};
  assert.equal(stepLevelHud(w1, 4, 0), 'Lv 4', 'first value after load: no flash');
  assert.equal(stepLevelHud(w1, 5, 1), 'Level up! 5'); assert.equal(stepLevelHud(w1, 5, 2.9), 'Level up! 5');
  assert.equal(stepLevelHud(w1, 5, 3.01), 'Lv 5'); assert.equal(stepLevelHud(w1, 4, 4), 'Lv 4', 'drop: no flash');
  assert.equal(stepLevelHud(w2, 7, 5), 'Lv 7', 'Continue into another world: no flash');
}
console.log('power.test: hud ok');
