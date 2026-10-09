// BEAST-TUNING-01: combat balance as data + a deterministic scripted-duel check. Reads beastConfig / vitalsConfig /
// swordConfig only (no behaviour change). Run: node game/js/quest/sim/combatBalance.test.js
// Skipped on purpose: the dodge-window criterion (no dodge / i-frames exist) -> NEEDS DESIGN.
import { makeOk } from '../../../../engine/test/assert.js';
import { BEAST_DEFAULTS as B, COMBAT_TARGETS as T, toSteps } from './beastConfig.js';
import { VITALS_DEFAULTS as V } from './vitalsConfig.js';
import { SWORD_CFG as S } from '../swordConfig.js';
import { createWaystone } from './waystone.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const STEP = 1 / 60;

// (a) boar vs player hearts
const boarHp = Math.round(1 * V.beastDamageScale); // beastSim contact payload damage 1 x scale
const hitsToKillPlayer = Math.ceil(V.maxHp / boarHp);
ok(hitsToKillPlayer >= T.boarHitsToKillPlayer[0] && hitsToKillPlayer <= T.boarHitsToKillPlayer[1], `(a) boar kills a full player in ${hitsToKillPlayer} hits`);
ok(V.maxHp === T.hpPerHeart * 6, '(a) 30 hp = 6 hearts');
// Least gap between two boar hits: charge ends in contact -> recover, then re-chase (>=0) + windup. Invuln must not cover it all.
const minGap = B.recoverSec + B.windupSec;
ok(minGap >= T.boarMinHitGapSec, `(a) boar hits >= ${T.boarMinHitGapSec}s apart (min gap ${minGap}s)`);
ok(V.invulnSteps * STEP <= minGap, '(a) invuln window <= the boar gap (no double-dip, no wasted hit)');

// (b) sword vs boar: best sequence is hard hits, light-only reported
const lightDmg = S.light.damage, hardDmg = S.light.damage * S.hard.damageMul;
const hitsHard = Math.ceil(B.hp / hardDmg), hitsLight = Math.ceil(B.hp / lightDmg);
ok(hitsHard >= T.swordHitsToKillBoar[0] && hitsHard <= T.swordHitsToKillBoar[1], `(b) heavy kills a boar in ${hitsHard} hits (light-only ${hitsLight})`);
ok(hitsLight >= hitsHard, '(b) light never beats heavy');
// the 0.2 s boar damage cooldown must not eat a heavy->heavy follow-up (heavy cycle >> 12 steps)
ok(S.hard.windup + S.hard.active + S.hard.recover > toSteps(B.dmgCooldownSec), '(b) damage cooldown shorter than a heavy cycle');

// (c) windup readability vs the owner's 70 ms hit-stop
const hitStopS = T.hitStopMs / 1000;
ok(B.windupSec >= T.windupMinSec, `(c) windup ${B.windupSec}s >= ${T.windupMinSec}s`);
ok(B.windupSec >= T.windupHitStopRatio * hitStopS, `(c) windup spans >= ${T.windupHitStopRatio} hit-stops (${(B.windupSec / hitStopS).toFixed(1)})`);
ok(Math.abs(S.hitStopHard * STEP - hitStopS) <= STEP, `(c) sword hard hit-stop ${S.hitStopHard} steps ~ 70 ms`);
ok(V.invulnSteps * STEP > hitStopS, '(c) invuln outlasts a hit-stop');

// (d) waystone heals to full
{
  const player = { components: { health: { hp: 5, max: V.maxHp, invuln: 0 } } };
  const world = { state: {} };
  const pos = { x: 0, y: 0, z: 0, yawDeg: 0 };
  const w = createWaystone(world, player, { waystones: [{ id: 'w1', pos }], spawn: pos, requestSave() {} });
  w.touch('w1');
  ok(player.components.health.hp === V.maxHp, '(d) waystone touch restores full hearts');
  player.components.health.hp = 0; w.onDeath();
  ok(player.components.health.hp === V.maxHp, '(d) respawn restores full hearts');
}

// (e) scripted duel, open ground, no dodge: player stands and swings once the boar is inside sword reach.
// Per boar: charge starts at windupR after windupSec; boar reaches sword reach, then contact (radius sum).
const contactR = B.radius + 0.35;                         // beast + player capsule (0.35 m player radius)
const tReachIn = B.windupSec + Math.max(0, B.windupR - S.reach) / B.charge; // s, boar enters sword reach
const tContact = B.windupSec + Math.max(0, B.windupR - contactR) / B.charge; // s, charge connects
const stepsInReach = Math.floor((tContact - tReachIn) / STEP);
// Fastest kill: heavy x hitsHard; the first lands at windup+? steps, the next only after its full recover (no chain).
const firstHeavyLands = S.hard.windup;                    // first active step
const killSteps = firstHeavyLands + (hitsHard - 1) * (S.hard.windup + S.hard.active + S.hard.recover);
ok(killSteps > stepsInReach, `(e) boar connects first: kill needs ${killSteps} steps, only ${stepsInReach} in reach`);
// Duel: every boar lands >= 1 hit, then the player kills it during the boar's recover (hit 1 -> death is possible).
let hp = V.maxHp, boarsDown = 0, hitsTaken = 0;
for (let i = 0; i < T.boarCount; i++) {
  hp -= boarHp; hitsTaken++;
  if (hp <= 0) break;
  boarsDown++;
}
ok(hitsTaken === T.boarCount && boarsDown === T.boarCount, `(e) 5 boars, one hit each: ${hitsTaken} hits taken, ${hp} hp left`);
ok(hp > 0, `(e) one hit per boar is survivable without waystone (${hp}/${V.maxHp} hp left; a 2nd hit on any boar is NOT: margin ${Math.floor((hp - 1) / boarHp)} extra hit)`);

console.log(`combatBalance: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.log('FAIL ' + m); process.exit(1); }
