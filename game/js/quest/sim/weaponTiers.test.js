// game/js/quest/sim/weaponTiers.test.js (EQ-20). node game/js/quest/sim/weaponTiers.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../../design/palette.js';
import '../../../../design/items.js';
import { ensureInventory, addItem } from './inventory.js';
import { ensureEquipment, equip, unequip, defenceOf } from './equipment.js';
import { weaponMods, refreshWeaponMods } from './weaponStats.js';
import { WEAPON_LOOT, weaponRng, rollWolfWeapon, rollChestWeapon } from './weaponLoot.js';
import { createBowDraw, BOW_SHOT } from './bowDraw.js';
import { BOW_CFG } from '../bowConfig.js';
import { CHEST_TABLES } from './chestDefs.js';

const I = globalThis.ASSETS.items, defs = I.defs, rgb = globalThis.ASSETS.palette.rgb;
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };

// AC1: 6 defs valid, slot/tier/def, stats strictly worn < sturdy < fine
ok(I.validate(globalThis.ASSETS.palette).length === 0, 'items.validate clean: ' + I.validate(globalThis.ASSETS.palette).join('; '));
const bases = { sword: ['main', 'dmgMul', 1], bow: ['ranged', 'dmgMul', 1], shield: ['off', 'blockStamMul', -1] };
for (const [b, [slot, key, dir]] of Object.entries(bases)) {
  const v = ['worn', 'sturdy', 'fine'].map((t) => { const id = t === 'worn' ? b : `gear.${slot}.${b}.${t}`; const d = defs[id]; ok(!!d, id); ok(d.equip.slot === slot, id + ' slot'); ok(d.equip.tier === t, id + ' tier'); ok(d.name.length <= 14, id + ' name <= 14'); return d.equip.stats[key]; });
  ok(dir * v[0] < dir * v[1] && dir * v[1] < dir * v[2], `${b} ${key} strictly better: ${v}`);
  for (const t of ['sturdy', 'fine']) for (const ch of defs[`gear.${slot}.${b}.${t}`].icon.fg.join('')) ok(ch === ' ' || (rgb[I.keys[ch].c]), 'icon colour');
}
ok(defs['gear.ranged.bow.fine'].equip.stats.drawMul > defs['gear.ranged.bow.sturdy'].equip.stats.drawMul && defs['gear.ranged.bow.sturdy'].equip.stats.drawMul > 1, 'bow draw speed');
ok(defs['gear.off.shield.sturdy'].equip.def > defs.shield.equip.def && defs['gear.off.shield.fine'].equip.def > defs['gear.off.shield.sturdy'].equip.def, 'shield def rises');
ok(I.equipTiers.includes('sturdy') && I.equipTiers.includes('fine'), 'tiers');

// equip / unequip round trip + the multiplier follows the equipped item
{
  const p = { components: {} }; ensureInventory(p, { pack: [] }); const inv = p.components.inventory, eq = ensureEquipment(p);
  addItem(inv, defs, 'gear.main.sword.fine', 1); addItem(inv, defs, 'gear.ranged.bow.sturdy', 1); addItem(inv, defs, 'gear.off.shield.fine', 1);
  ok(equip(inv, eq, defs, 'gear.main.sword.fine') && eq.main === 'gear.main.sword.fine', 'equip fine sword');
  ok(equip(inv, eq, defs, 'gear.ranged.bow.sturdy') && equip(inv, eq, defs, 'gear.off.shield.fine'), 'equip bow + shield');
  refreshWeaponMods(eq, defs);
  ok(weaponMods.dmgMul === 1.5 && weaponMods.bowDmgMul === 1.25 && weaponMods.drawMul === 1.15 && weaponMods.blockStamMul === 0.7, JSON.stringify(weaponMods));
  ok(defenceOf(eq, defs) >= 4, 'shield def counts');
  ok(unequip(inv, eq, defs, 'main') && eq.main === null, 'unequip sword');
  refreshWeaponMods(eq, defs); ok(weaponMods.dmgMul === 1, 'no sword -> x1');
  refreshWeaponMods(null, defs); ok(weaponMods.blockStamMul === 1, 'no equipment -> x1');
}

// bow draw speed
{
  const t = (mul) => { const b = createBowDraw(BOW_CFG); b.setDrawMul(mul); let n = 0; while (b.drawFrac < 1 && n < 500) { b.step(true, true, 5); n++; } return n; };
  ok(t(1.3) < t(1.15) && t(1.15) < t(1), `draw steps ${t(1)} / ${t(1.15)} / ${t(1.3)}`);
}

// AC2: 10k wolf kills
{
  const sim = (band) => { const r = weaponRng(1234 + band); let n = 0, fine = 0, shield = 0, bow = 0; for (let i = 0; i < 10000; i++) { const id = rollWolfWeapon(defs, band, r(), r(), r()); if (id) { n++; if (id.endsWith('.fine')) fine++; if (id.includes('shield')) shield++; if (id.includes('.bow.')) bow++; ok(!id.includes('sword'), 'wolves never drop swords'); } } return { n, fine, shield, bow }; };
  for (const band of [1, 2, 4]) { const s = sim(band); ok(s.n >= 200 && s.n <= 400, `band ${band}: ${s.n}/10000 drops`); ok(s.fine === 0, `band ${band}: no fine`); ok(s.shield > 0 && s.bow > 0, 'both items'); }
  const s5 = sim(5); ok(s5.n >= 200 && s5.n <= 400 && s5.fine > 0 && s5.fine < s5.n, `band 5: ${s5.n} drops, ${s5.fine} fine`);
}

// chests + JSON mirror
ok(CHEST_TABLES.chestForge.fixed[0].item === 'gear.main.sword.sturdy', 'forge chest sturdy sword');
ok(rollChestWeapon(defs, { tier: 'fine' }, 0.5) === 'gear.ranged.bow.fine', 'chest fine roll');
const j = JSON.parse(readFileSync(new URL('../../../../content/loot/weapons.json', import.meta.url), 'utf8'));
ok(j.fineMinBand === WEAPON_LOOT.fineMinBand && j.fineShare === WEAPON_LOOT.fineShare && j.sources.wolf.chance === WEAPON_LOOT.wolf.chance, 'weapons.json mirrors weaponLoot.js');
assert.deepEqual(j.sources.wolf.items, WEAPON_LOOT.wolf.items); pass++;
ok(j.sources.chestForge.fixed[0].item === CHEST_TABLES.chestForge.fixed[0].item && defs[j.sources.chestForge.fixed[0].item], 'forge chest mirrors json');
console.log(`weaponTiers.test: ${pass} passed, 0 failed`);
