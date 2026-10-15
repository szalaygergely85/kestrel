// OB-150: hits-to-kill table by level and difficulty. Run: node game/js/quest/sim/beastLevels.test.js
import { levelScale, levelHpMul, levelDmgMul } from './beastLevels.js';
import { BEAST_DEFAULTS as B } from './beastConfig.js';
import { VITALS_DEFAULTS as V } from './vitalsConfig.js';
import { SWORD_CFG as S } from '../swordConfig.js';
import { WOLF_TUNING } from './wolfBrain.js';
import { BEAR_TUNING } from './bearBrain.js';
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.error('FAIL:', n, d ?? ''); } };
// base: boar hp B.hp, contact damage 1 x beastDamageScale; wolf hp x0.75; bear swipe 2 hearts, hp x3
const hitsToKillPlayer = (baseDmg, lv, diff) => Math.ceil(V.maxHp / (baseDmg * levelScale(lv, diff).damage * V.beastDamageScale));
const swordHits = (baseHp, lv, diff, dmg) => Math.ceil(Math.max(1, Math.round(baseHp * levelScale(lv, diff).hp)) / dmg);
const heavy = S.light.damage * S.hard.damageMul;
const row = (n, base, hpBase) => [1, 5, 10].map((lv) => `lv${lv}: kills you in ${hitsToKillPlayer(base, lv)}, heavy x${swordHits(hpBase, lv, 'normal', heavy)}`).join(' | ');
console.log('boar ', row('boar', 1, B.hp)); console.log('wolf ', row('wolf', 1, Math.round(B.hp * WOLF_TUNING.hpMul)));
console.log('bear ', row('bear', BEAR_TUNING.swipeHearts, Math.round(B.hp * BEAR_TUNING.hpMul)));
// targets (+-1): level-1 boar 6-8 hits (spec 6-8), level-8 wolf 3-4
ok('lv1 boar needs 6-8 hits to kill a fresh player', hitsToKillPlayer(1, 1) >= 5 && hitsToKillPlayer(1, 1) <= 9, hitsToKillPlayer(1, 1));
ok('lv8 wolf needs 3-4 hits (+-1)', hitsToKillPlayer(1, 8) >= 2 && hitsToKillPlayer(1, 8) <= 5, hitsToKillPlayer(1, 8));
// monotonic in level
let mono = true;
for (let lv = 2; lv <= 10; lv++) mono = mono && levelHpMul(lv) > levelHpMul(lv - 1) && levelDmgMul(lv) > levelDmgMul(lv - 1) && hitsToKillPlayer(1, lv) <= hitsToKillPlayer(1, lv - 1);
ok('hp, damage monotonic in level; hits-to-kill-player never rises', mono);
// difficulty ordering
for (const lv of [1, 5, 10]) {
  const e = levelScale(lv, 'easy'), n = levelScale(lv, 'normal'), h = levelScale(lv, 'hard');
  ok(`lv${lv} hard > normal > easy (damage and hp)`, h.damage > n.damage && n.damage > e.damage && h.hp > n.hp && n.hp > e.hp);
  ok(`lv${lv} hits to kill player easy >= normal >= hard`, hitsToKillPlayer(1, lv, 'easy') >= hitsToKillPlayer(1, lv, 'normal') && hitsToKillPlayer(1, lv, 'normal') >= hitsToKillPlayer(1, lv, 'hard'));
}
ok('unknown difficulty = normal', levelScale(3, 'zzz').hp === levelScale(3, 'normal').hp);
// KINDS-F: two kinds of one species at the same level differ by their factors; missing factors = base
import { kindFactors } from './beastLevels.js';
const ent = (beastKind, species) => ({ components: { brain: { beastKind, species } } });
const gw = kindFactors(ent('goblin_warrior')), gc = kindFactors(ent('goblin_chief'));
ok('goblin chief tougher than warrior at same level', gc.hp > gw.hp && gc.dmg > gw.dmg);
ok('wolf/bear skip (own tuning)', kindFactors(ent('black_bear'), 1).hp === 1);
ok('unknown/no kind = boar = base', kindFactors({ components: {} }).hp === 1 && kindFactors(ent('nope')).dmg === 1);
console.log(`beastLevels: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
