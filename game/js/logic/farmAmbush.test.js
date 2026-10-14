// ED-LOGIC-01d: the first-use ambush from the REAL content (content/logic/farm.logic.json + props.json), headless Node:
// node game/js/logic/farmAmbush.test.js. Fixture = a small world with the real farm.gate mesh placement + 3 reserve goblins.
import fs from 'node:fs';
import { World, serialize, deserialize, SIM_STEP, createRng, validateLogic } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import m0Mod from '../../../design/models/lantern.js';
import m1Mod from '../../../design/models/lever.js';
import m2Mod from '../../../design/models/boulder.js';
import m3Mod from '../../../design/models/rubble.js';
import m4Mod from '../../../design/models/wreckage.js';
import m5Mod from '../../../design/models/relay.js';
import m6Mod from '../../../design/models/sword.js';
import m7Mod from '../../../design/models/m3_props.js';
import boarMod from '../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBeastSim, STATE_GONE, STATE_CORPSE } from '../quest/sim/beastSim.js';
import { ACTIVE, UNAVAILABLE } from '../quest/sim/questBook.js';
import { createLogicWire } from './logicWire.js';
import { LOGIC_VOCAB } from './vocab.js';
import { propKey } from './propState.js';

paletteMod; detailPassMod; m0Mod; m1Mod; m2Mod; m3Mod; m4Mod; m5Mod; m6Mod; m7Mod; terrainMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const BLOCKS = J('../../../content/logic/farm.logic.json'), PROPS = J('../../../content/logic/props.json');
const world = J('../../../content/worlds/world_m1.world.json');
const gateDef = world.structures.find((s) => s.id === 'farmGateLeaf');
const gobDefs = world.entities.filter((e) => e.components && e.components.brain && e.components.brain.group === 'farm.goblins');
ok('content: farm.gate placement + 3 reserve goblins authored in world_m1', !!gateDef && gateDef.collide === false && gobDefs.length === 3 && gobDefs.every((e) => e.components.brain.reserve === true));
ok('content: farm.logic.json passes the real vocab', validateLogic(BLOCKS, LOGIC_VOCAB).length === 0, validateLogic(BLOCKS, LOGIC_VOCAB).join(' | '));

const GATE = 'farmGateLeaf', QUEST = 'sq.he.farm', PX = 1080, PY = 1090;
const DEF = () => ({ name: 'farmAmbushTest', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }, { ...gateDef }],
  entities: gobDefs.map((e) => ({ ...e, components: { ...e.components, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } } })), state: {} });
const NAV = { area: { x0: 1000, y0: 1000, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const status = { [QUEST]: UNAVAILABLE };
const build = (w0) => {
  const w = w0 || World.load(DEF(), assets, { physics: 'mesh' });
  const sim = createBeastSim(w, { nav: buildBeastNav(w, NAV), rng: createRng(1), events: { on: () => () => {}, emit() {} } });
  const player = { x: PX + 30, y: PY + 30, z: 0 }, hints = [];
  const wire = createLogicWire({ world: w, blocks: BLOCKS, meshStates: PROPS, book: { statusOf: (id) => (id in status ? status[id] : -1) }, sim, nav: null, player: () => player, hint: (id) => hints.push(id), hooks: { emitSimple() {} } });
  return { w, sim, wire, hints };
};
const tick = (wire, n = 1) => { for (let i = 0; i < n; i++) wire.onTick(SIM_STEP); };
const gate = (w) => w.structures.find((s) => s.id === GATE);
const alive = (sim) => [0, 1, 2].filter((i) => sim.down[i] === 0 && sim.state[i] !== STATE_GONE).length;

const A = build(null);
ok('1a: gate starts open (collide off), goblins in reserve', gate(A.w).collide === false && A.wire.props.get(GATE) === 'open' && alive(A.sim) === 0 && A.sim.groupSlots('farm.goblins').length === 3);
A.wire.onEvent('zone:entered', { id: 'farmGate' }); tick(A.wire, 3);
ok('1b: quest not active -> nothing', gate(A.w).collide === false && alive(A.sim) === 0 && A.wire.logic.fireCount('farm.ambush') === 0);
status[QUEST] = ACTIVE;
A.wire.onEvent('zone:entered', { id: 'farmGate' }); tick(A.wire, 1);
ok('2a: walk in with quest active -> gate closed (solid, yaw 0) within 1 step', gate(A.w).collide === true && A.w.state[propKey(GATE)] === 'closed' && A.wire.props.get(GATE) === 'closed');
ok('2b: 3 goblins alive within 1 step; block fired once', alive(A.sim) === 3 && A.wire.logic.fireCount('farm.ambush') === 1);
tick(A.wire, 40);
ok('2c: hint raised once after its 30-step delay', A.hints.length === 1 && A.hints[0] === 'hint.farm.ambush', A.hints.join());
A.wire.onEvent('zone:entered', { id: 'farmGate' }); tick(A.wire, 2);
ok('2d: once -> no refire', A.wire.logic.fireCount('farm.ambush') === 1 && alive(A.sim) === 3);

const B = build(deserialize(JSON.parse(JSON.stringify(serialize(A.w))), assets, { physics: 'mesh' }));
B.wire.onWorldLoaded();
ok('3a: save/load -> gate still closed, goblins alive', gate(B.w).collide === true && B.wire.props.get(GATE) === 'closed' && alive(B.sim) === 3);
B.sim.setDown(0, true); B.wire.onEvent('zone:entered', { id: 'farmGate' }); tick(B.wire, 3);
ok('3b: no refire after load', B.wire.logic.fireCount('farm.ambush') === 1 && alive(B.sim) === 2);
B.sim.setDown(0, false);

const kill = (R, i) => { R.sim.state[i] = STATE_CORPSE; R.wire.onEvent('beast:died', { id: R.sim.ids[i] }); };
kill(B, 0); kill(B, 1); tick(B.wire, 2);
ok('4a: 2 of 3 dead -> gate stays closed', B.wire.props.get(GATE) === 'closed');
kill(B, 2); tick(B.wire, 3);
ok('4b: group cleared -> gate open again (not stuck)', B.wire.props.get(GATE) === 'open' && gate(B.w).collide === false && B.wire.logic.fireCount('farm.ambush.won') === 1);

console.log(`farmAmbush.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  - ' + m); process.exit(1); }
