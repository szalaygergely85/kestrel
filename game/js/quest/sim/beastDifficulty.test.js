// BH2-G1: Settings > Difficulty is wired into the beast sim (windup, notice radius/time, leash, live switch) and vitals (playerDmg). Run: node game/js/quest/sim/beastDifficulty.test.js
import { readFileSync } from 'node:fs';
import { World, NavGrid, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_WANDER, STATE_RETURN, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_STAGGER } from './beastSim.js';
import { KINDS } from './beastKinds.js';
import { COMBAT_TARGETS, toSteps } from './beastConfig.js';
import { createTactics, FLANK_X, FLANK_Y, TOK_M, TOK_R, TOK_S } from './tactics.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { resolveDifficulty } from './difficulty.js';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const HX = 1461, HY = 1031;
const orig = console.warn; console.warn = () => {};
// kinds placed close together (3 per row, 3 m apart) around (HX, HY)
function mk(kinds, diff, seed = 1) {
  const entities = kinds.map((k, n) => { const x = HX + (n % 3) * 3, y = HY + Math.floor(n / 3) * 3;
    return { id: 'b' + n, type: 'beast', x, y, z: 'ground',
      components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [x, y], beastKind: k }, targetable: { radius: 0.45, height: 0.7 } } }; });
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  return { world, sim: createBeastSim(world, { nav, rng: createRng(seed), seed, events: { emit() {}, on() {} }, difficulty: diff }) };
}

const one = (diff) => mk(['grey_wolf'], diff);
// notice radius: farthest distance (north of the beast, which faces north) at which a fresh beast leaves WANDER within 10 steps
function noticeReach(diff, live) {
  let far = 0;
  for (let d = 4; d <= 40; d++) {
    const { world, sim } = one(live ? 'normal' : diff); if (live) sim.setDifficulty(diff);
    const px = HX, py = HY - d, z = world.terrain.heightAt(px, py);
    for (let t = 0; t < 10; t++) sim.step(px, py, z);
    if (sim.state[0] !== STATE_WANDER) far = d;
  }
  return far;
}
const reach = { easy: noticeReach('easy'), normal: noticeReach('normal'), hard: noticeReach('hard') };
ok(`notice radius Easy < Normal < Hard (${reach.easy}/${reach.normal}/${reach.hard} m)`, reach.easy < reach.normal && reach.normal < reach.hard);
ok('live switch rescales an existing beast notice radius', noticeReach('hard', true) === reach.hard && noticeReach('easy', true) === reach.easy, `${noticeReach('hard', true)} ${noticeReach('easy', true)}`);

// windup length (steps in STATE_WINDUP) with the player inside windup range
function windupSteps(diff, live) {
  const { world, sim } = one(live ? 'normal' : diff); if (live) sim.setDifficulty(diff);
  const px = HX, py = HY - 3, z = world.terrain.heightAt(px, py);
  let n = 0, seen = false;
  for (let t = 0; t < 900 && !(seen && sim.state[0] !== STATE_WINDUP); t++) { sim.step(px, py, z); if (sim.state[0] === STATE_WINDUP) { n++; seen = true; } }
  return seen ? n : -1;
}
const wu = { easy: windupSteps('easy'), normal: windupSteps('normal'), hard: windupSteps('hard') };
ok(`windup Easy > Normal > Hard (${wu.easy}/${wu.normal}/${wu.hard} steps)`, wu.normal > 0 && wu.easy > wu.normal && wu.normal > wu.hard && wu.hard > 0);
ok('live switch rescales windup of an existing beast', windupSteps('hard', true) === wu.hard && windupSteps('easy', true) === wu.easy);

// notice time (steps in STATE_NOTICE): Easy slower than Hard
function noticeSteps(diff) {
  const { world, sim } = one(diff); const px = HX, py = HY - 8, z = world.terrain.heightAt(px, py);
  let n = 0, seen = false;
  for (let t = 0; t < 600 && !(seen && sim.state[0] !== 1); t++) { sim.step(px, py, z); if (sim.state[0] === 1) { n++; seen = true; } }
  return seen ? n : -1;
}
const ns = { easy: noticeSteps('easy'), normal: noticeSteps('normal'), hard: noticeSteps('hard') };
ok(`notice time Easy > Normal > Hard (${ns.easy}/${ns.normal}/${ns.hard} steps)`, ns.hard > 0 && ns.easy > ns.normal && ns.normal > ns.hard);

// leash factor + tactics tokens follow a live switch; damage payload rescales (DIFF-MENU)
{ const { sim } = one('normal'); const t0 = sim.tactics.tokM; sim.setDifficulty('hard');
  ok('live switch: leash / tokens / difficulty row', sim.dm.leash === resolveDifficulty('hard').leash && sim.tactics.tokM === 3 && t0 === 2 && sim.difficulty.name === 'hard'); }

// BH2-G1 eliteChance: seeded per-slot roll, Normal/Easy never, Hard some (x1.5 HP, spec)
{
  const kinds = Array(12).fill('grey_wolf'), cnt = (d, sd) => { const { sim } = mk(kinds, d, sd); let n = 0; for (let i = 0; i < 12; i++) n += sim.elite[i]; return { sim, n }; };
  const ne = cnt('normal'), ee = cnt('easy'), he = cnt('hard'), he2 = cnt('hard');
  ok(`elites: Normal/Easy none, Hard some but not all (${ne.n}/${ee.n}/${he.n})`, ne.n === 0 && ee.n === 0 && he.n > 0 && he.n < 12);
  ok('elites: deterministic (same seed, same slots)', he.sim.elite.join() === he2.sim.elite.join());
  const hp = (i) => he.sim.entities[i].components.health.max, el = [], nel = [];
  for (let i = 0; i < 12; i++) (he.sim.elite[i] ? el : nel).push(hp(i));
  ok(`elites: HP is exactly x1.5 a non-elite of the same kind (${el[0]} vs ${nel[0]})`, el.length > 0 && nel.length > 0 && el.every((v) => v === Math.round(nel[0] * 1.5)));
}
// BH2-G1 flank: Easy = no flank slots, Hard = tighter ring than Normal
{
  const f = (d) => { const T = createTactics(4, 1); T.setDifficulty(d); return T; };
  ok('flank levels: Easy 0 / Normal 1 / Hard 2', f('easy').flankLv === 0 && f('normal').flankLv === 1 && f('hard').flankLv === 2);
  const run = (d) => { const { world, sim } = mk(Array(6).fill('grey_wolf'), d); const px = HX, py = HY - 6, z = world.terrain.heightAt(px, py); let fl = 0;
    for (let t = 0; t < 600; t++) { sim.step(px, py, z); let m = 0; for (let i = 0; i < 6; i++) if (sim.tactics.flank[i] >= 0) m |= 1 << sim.tactics.flank[i]; let c = 0; for (; m; m &= m - 1) c++; /* distinct ring slots */ if (c > fl) fl = c; }
    return fl; };
  const fe = run('easy'), fn = run('normal'), fh = run('hard');
  ok(`flank slots: Easy none (straight chase), Normal/Hard spread (${fe}/${fn}/${fh})`, fe === 0 && fn > 1 && fh > 1);
}
// vitals: playerDmg scales damage the player takes
function taken(diff) {
  const listeners = []; const events = { on: (n, f) => { listeners.push(f); return () => {}; }, emit() {} };
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { health: { hp: 100, max: 100, invuln: 0 }, body: {} } };
  const world = { get: () => null };
  const v = createVitals(world, events, VITALS_DEFAULTS, { dmgMul: () => resolveDifficulty(diff).playerDmg });
  v.step(player, null, 1 / 60);
  v.hurt(8, 'drown'); // playerDmg covers sourceless env damage only
  return 100 - player.components.health.hp;
}
// ARCH round 4b: beast hits carry only the enemy factor (playerDmg must not stack); sourceless env damage (hurt) uses playerDmg
{ const mkV = (mul) => { const listeners = []; const events = { on: (n, f) => { listeners.push(f); return () => {}; }, emit() {} };
    const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { health: { hp: 100, max: 100, invuln: 0 }, body: {} } };
    const v = createVitals({ get: () => null }, events, VITALS_DEFAULTS, { dmgMul: () => mul }); v.step(player, null, 1 / 60); return { v, listeners, player }; };
  const a = mkV(1), b = mkV(2);
  a.listeners[0]({ target: 'player', source: 'b0', damage: 8 }); b.listeners[0]({ target: 'player', source: 'b0', damage: 8 });
  ok('beast hit ignores playerDmg (dmgMul 2 == 1)', a.player.components.health.hp === b.player.components.health.hp);
  a.v.hurt(5, 'drown'); b.v.hurt(5, 'drown');
  ok(`drowning uses playerDmg (${100 - a.player.components.health.hp} vs ${100 - b.player.components.health.hp})`, b.player.components.health.hp < a.player.components.health.hp); }
// per-slot perception reaches perceive() (a comment once swallowed the assignments): non-default pNear/pCone show up in the adapter
{ const { world, sim } = mk(['grey_wolf']); sim.pNear[0] = 6.5; sim.pCone[0] = 0.25; const px = HX, py = HY - 20, z = world.terrain.heightAt(px, py);
  for (let t = 0; t < 5; t++) sim.step(px, py, z);
  ok(`noticedOf uses per-slot hearR/coneCos (${sim._pa.hearR}/${sim._pa.coneCos})`, sim._pa.hearR === 6.5 && sim._pa.coneCos === 0.25); }
const tk = { easy: taken('easy'), normal: taken('normal'), hard: taken('hard') };
ok(`player damage taken Easy < Normal < Hard (${tk.easy}/${tk.normal}/${tk.hard})`, tk.easy > 0 && tk.easy < tk.normal && tk.normal < tk.hard);
console.warn = orig;
console.log(`beastDifficulty: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
