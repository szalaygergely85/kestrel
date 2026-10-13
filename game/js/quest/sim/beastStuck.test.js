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
// the "river": a full-height impassable band between goblin and player
const g = nav.grid || nav;
for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
  const wx = g.x0 + x;
  if (wx >= PX - 6 && wx <= PX - 3) g.cost[g.index(x, y)] = 0;
}
const sim = createBeastSim(world, { nav, rng: createRng(1), events: { emit() {}, on() {} } });
const z = world.terrain.heightAt(PX, PY);
let sawChase = false, gaveUp = false, walkInPlace = 0, maxRun = 0, run = 0;
const ov = { bar() {} }, ids = { beastNotice: 0 };
for (let t = 0; t < 1200; t++) {
  sim.step(PX, PY, z);
  presentBeasts(sim, world, ov, ids);
  const st = sim.state[0];
  if (st === STATE_CHASE) sawChase = true;
  if (sawChase && (st === STATE_RETURN || st === STATE_WANDER)) gaveUp = true;
  const clip = sim.entities[0].components.voxel.anim;
  const gait = clip !== 'idle' && /walk|run|charge|flee|carry/.test(clip) && (st === STATE_CHASE);
  if (gait && sim.mv[0] < 0.15) { run++; if (run > maxRun) maxRun = run; } else run = 0;
  if (gait && sim.mv[0] < 0.15) walkInPlace++;
}
ok('goblin chased the player at some point', sawChase);
ok('goblin gave up the unreachable target', gaveUp);
ok('no walk clip while < 0.15 m/s for > 0.2 s (12 steps)', maxRun <= 12, 'maxRun=' + maxRun + ' total=' + walkInPlace);
console.log(`beastStuck: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
