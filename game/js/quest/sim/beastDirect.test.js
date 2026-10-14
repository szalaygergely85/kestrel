// BEAST-01 / OB-149: measured-speed gait + stuck rule. A goblin chasing a player behind an impassable band (the ford case)
// used to "walk in place" forever. Now: stuck 1.5 s -> re-plan x2 -> give up (return), anim idle. Run: node beastStuck.test.js
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
import { createBeastSim, STATE_CHASE, STATE_RETURN, STATE_WANDER } from './beastSim.js';
import { presentBeasts } from '../beastView.js';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const PX = 1461, PY = 1031;
const ent = { id: 'g1', type: 'beast', x: PX - 9, y: PY, z: 'ground',
  components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [PX - 9, PY], species: 'goblin', role: 'melee' }, targetable: { radius: 0.45, height: 0.7 } } };
const orig = console.warn; console.warn = () => {};
const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [ent], state: {} }, assets, { physics: 'grid' });
console.warn = orig;
const nav = buildBeastNav(world, NAV_CFG);

// partial wall: blocks y < PY+8 (goblin starts at y=PY), open further south -> the chaser must detour around it
const g = nav.grid || nav;
for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
  const wx = g.x0 + x, wy = g.y0 + y;
  if (wx >= PX - 6 && wx <= PX - 3 && wy < PY + 8) g.cost[g.index(x, y)] = 0;
}
const sim = createBeastSim(world, { nav, rng: createRng(1), events: { emit() {}, on() {} } });
const z = world.terrain.heightAt(PX, PY);
let minD = 1e9;
for (let t = 0; t < 1800; t++) {
  sim.step(PX, PY, z);
  const d = Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY);
  if (d < minD) minD = d;
}
ok('chaser around a wall reaches the player (A* detour when the line is blocked)', minD < 2.5, 'minD=' + minD.toFixed(2));
ok('A* ran for the detour', sim.stats.astar >= 1, 'astar=' + sim.stats.astar);
// clear line: no wall -> direct steering, no A*
const sim2 = createBeastSim(world, { nav: buildBeastNav(world, NAV_CFG), rng: createRng(1), events: { emit() {}, on() {} } });
let minD2 = 1e9;
for (let t = 0; t < 900; t++) { sim2.step(PX, PY, z); minD2 = Math.min(minD2, Math.hypot(sim2.steer.x[0] - PX, sim2.steer.y[0] - PY)); }
ok('clear line: chaser reaches the player', minD2 < 2.5, 'minD=' + minD2.toFixed(2));
ok('clear line: direct steering used', sim2.stats.direct > 0, 'direct=' + sim2.stats.direct);
console.log(`beastDirect: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
