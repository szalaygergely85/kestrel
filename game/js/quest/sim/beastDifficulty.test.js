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

// vitals: playerDmg scales damage the player takes
function taken(diff) {
  const listeners = []; const events = { on: (n, f) => { listeners.push(f); return () => {}; }, emit() {} };
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { health: { hp: 100, max: 100, invuln: 0 }, body: {} } };
  const world = { get: () => null };
  const v = createVitals(world, events, VITALS_DEFAULTS, { dmgMul: () => resolveDifficulty(diff).playerDmg });
  v.step(player, null, 1 / 60);
  listeners[0]({ target: 'player', source: 'b0', damage: 8 });
  return 100 - player.components.health.hp;
}
const tk = { easy: taken('easy'), normal: taken('normal'), hard: taken('hard') };
ok(`player damage taken Easy < Normal < Hard (${tk.easy}/${tk.normal}/${tk.hard})`, tk.easy > 0 && tk.easy < tk.normal && tk.normal < tk.hard);
console.warn = orig;
console.log(`beastDifficulty: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
