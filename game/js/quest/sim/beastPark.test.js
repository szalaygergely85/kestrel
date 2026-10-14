// BEAST-PARK-01: sim.parkSlot / unparkSlot / isParked / resetAll interplay. Run: node game/js/quest/sim/beastPark.test.js
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
import { createBeastSim, STATE_WANDER, STATE_RETURN, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_STAGGER, STATE_CIRCLE, STATE_GONE } from './beastSim.js';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const HX = 1461, HY = 1031;
const orig = console.warn; console.warn = () => {};
// kinds placed close together (3 per row, 3 m apart) around (HX, HY)
function mk(kinds, seed = 1) {
  const entities = kinds.map((k, n) => { const x = HX + (n % 3) * 3, y = HY + Math.floor(n / 3) * 3;
    return { id: 'b' + n, type: 'beast', x, y, z: 'ground',
      components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [x, y], beastKind: k }, targetable: { radius: 0.45, height: 0.7 } } }; });
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  return { world, sim: createBeastSim(world, { nav, rng: createRng(seed), seed, events: { emit() {}, on() {} } }) };
}

// park/unpark a mix of live and dead-ish slots in random order, then resetAll: no throw, parked set unchanged, no GONE slot with an active steer agent
const N = 8, kinds = ['grey_wolf', 'grey_wolf', 'grey_wolf', 'grey_wolf', 'goblin', 'grey_wolf', 'grey_wolf', 'grey_wolf'];
const { world, sim } = mk(kinds);
const px = HX + 4, py = HY - 8, z = world.terrain.heightAt(px, py);
const rng = createRng(5);
const noGhost = () => { for (let k = 0; k < N; k++) if (sim.state[k] === STATE_GONE && sim.steer.active[k]) return false; return true; };
let threw = '';
try {
  for (let round = 0; round < 40; round++) {
    for (let t = 0; t < 30; t++) sim.step(px, py, z);
    const order = []; for (let k = 0; k < N; k++) order.push(k);
    for (let k = N - 1; k > 0; k--) { const j = Math.floor(rng.nextFloat() * (k + 1)); const tmp = order[k]; order[k] = order[j]; order[j] = tmp; }
    const parkSet = order.slice(0, 1 + Math.floor(rng.nextFloat() * (N - 1)));
    for (const s of parkSet) { sim.parkSlot(s); if (rng.nextFloat() < 0.3) sim.parkSlot(s); }
    const before = []; for (let k = 0; k < N; k++) before.push(sim.isParked(k) ? 1 : 0);
    ok('parked slots are GONE and inactive', parkSet.every((s) => sim.state[s] === STATE_GONE && !sim.steer.active[s] && sim.isParked(s)));
    if (round % 2) sim.resetAll();
    const after = []; for (let k = 0; k < N; k++) after.push(sim.isParked(k) ? 1 : 0);
    ok('resetAll keeps the parked set', before.join() === after.join(), before.join('') + ' vs ' + after.join(''));
    ok('no GONE slot has an active steer agent', noGhost());
    for (let t = 0; t < 10; t++) sim.step(px, py, z);
    ok('parked slots stay GONE while stepping', parkSet.every((s) => sim.state[s] === STATE_GONE));
    const un = parkSet.slice().sort(() => rng.nextFloat() - 0.5);
    for (const s of un) if (!sim.unparkSlot(s)) threw = 'unpark false ' + s;
    ok('unparked slots: wander at home, agent active', un.every((s) => sim.state[s] === STATE_WANDER && sim.steer.active[s] && !sim.isParked(s)));
    ok('unpark of a non-parked slot is a no-op', sim.unparkSlot(un[0]) === false);
  }
} catch (e) { threw = e.message; }
ok('park/unpark/resetAll in random order never throws', threw === '', threw);
{ const w = mk(Array(3).fill('grey_wolf')); const s2 = w.sim; const pz = w.world.terrain.heightAt(HX + 4, HY - 8);
  for (let t = 0; t < 400 && s2.tactics.nM === 0; t++) s2.step(HX + 4, HY - 8, pz);
  for (let k = 0; k < 3; k++) s2.parkSlot(k);
  ok('parkSlot releases attack tokens', s2.tactics.nM === 0 && !s2.tactics.held[0] && !s2.tactics.held[1] && !s2.tactics.held[2], 'nM=' + s2.tactics.nM);
  ok('engagedCount is 0 with everything parked', s2.engagedCount() === 0); }
console.warn = orig;
console.log(`beastPark: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
