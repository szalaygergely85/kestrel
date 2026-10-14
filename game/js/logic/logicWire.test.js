// ED-LOGIC-01c (game/js/logic/*). Headless Node ESM: node game/js/logic/logicWire.test.js
// Fixture: tower world (prop 'tower.doorBar' = the gate: variant 'closed' = solid, 'open' = collider off) + 3 reserve beasts (group 'goblins').
import { World, serialize, deserialize, SIM_STEP, createRng, validateLogic } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import boarMod from '../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBeastSim, STATE_GONE, STATE_CORPSE } from '../quest/sim/beastSim.js';
import { ACTIVE, UNAVAILABLE } from '../quest/sim/questBook.js';
import { createLogicWire } from './logicWire.js';
import { LOGIC_VOCAB } from './vocab.js';
import { createPropStates, propKey } from './propState.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const TOWER_ORIGIN = { x: 1480, y: 1018, z: 0 };
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const PX = 1461, PY = 1031, GATE = 'tower.doorBar';
const beast = (id, x, y) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, targetable: { radius: 0.45, height: 0.7 },
  brain: { kind: 'beast', home: [x, y], group: 'goblins', reserve: true } } });
const ENTS = () => [beast('gob1', PX - 10, PY), beast('gob2', PX - 12, PY + 3), beast('gob3', PX - 9, PY - 3)];
const DEF = () => ({ name: 'logicWireTest', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: TOWER_ORIGIN, yawSteps: 0 }], entities: ENTS(), state: {} });

const BLOCKS = [
  { id: 'rook.ambush', rev: 1, once: true, when: { on: 'area.enter', area: 'yard' }, if: [{ is: 'quest', quest: 'sq.x', state: 'active' }],
    do: [{ act: 'prop.state', prop: GATE, state: 'closed' }, { act: 'beasts.spawn', group: 'goblins' }] },
  { id: 'rook.won', rev: 1, when: { on: 'group.cleared', group: 'goblins' }, do: [{ act: 'flag.set', flag: 'rook.won', value: true }, { act: 'prop.state', prop: GATE, state: 'open' }] },
];

function build(world, status, nav) {
  const w = world || World.load(DEF(), assets, { physics: 'mesh' });
  const sim = createBeastSim(w, { nav: buildBeastNav(w, NAV_CFG), rng: createRng(1), events: { on: () => () => {}, emit() {} } });
  const player = { x: PX, y: PY, z: 0 };
  const emitted = [];
  const wire = createLogicWire({ world: w, blocks: BLOCKS, book: { statusOf: (id) => (id in status ? status[id] : -1) }, sim, nav, player: () => player,
    hooks: { emitSimple: (...a) => emitted.push(a) } });
  return { w, sim, wire, player, emitted };
}
const tick = (wire, n = 1) => { for (let i = 0; i < n; i++) wire.onTick(SIM_STEP); };
const gateVariant = (w) => w.get(GATE).getComponent('voxel').variant;
const alive = (sim) => [0, 1, 2].filter((i) => sim.down[i] === 0 && sim.state[i] !== STATE_GONE).length;
const status = { 'sq.x': UNAVAILABLE };

// vocab schema is valid for the shipped block shape
ok('validateLogic: fixture blocks pass the real vocab', validateLogic(BLOCKS, LOGIC_VOCAB).length === 0, validateLogic(BLOCKS, LOGIC_VOCAB).join(' | '));

// ---- 1) reserve + quest gating
const A = build(null, status);
A.wire.props.request(GATE, 'open'); // the gate stands open before the ambush
ok('1a: reserve group starts down (3 slots, none alive)', A.sim.groupSlots('goblins').length === 3 && alive(A.sim) === 0 && A.sim.state[0] === STATE_GONE);
ok('1b: gate starts open', gateVariant(A.w) === 'open' && A.w.state[propKey(GATE)] === 'open');
A.wire.onEvent('zone:entered', { id: 'yard' }); tick(A.wire, 3);
ok('1c: quest inactive -> nothing (gate open, 0 goblins, no fire)', gateVariant(A.w) === 'open' && alive(A.sim) === 0 && A.wire.logic.fireCount('rook.ambush') === 0);
A.wire.onEvent('zone:entered', { id: 'elsewhere' }); status['sq.x'] = ACTIVE; tick(A.wire, 2);
ok('1d: other area -> nothing', alive(A.sim) === 0 && A.wire.logic.fireCount('rook.ambush') === 0);

// ---- 2) quest active -> gate closed + 3 alive within 1 step
A.wire.onEvent('zone:entered', { id: 'yard' }); tick(A.wire, 1);
ok('2a: within 1 step: gate closed (variant, state key)', gateVariant(A.w) === 'closed' && A.w.state[propKey(GATE)] === 'closed');
ok('2b: within 1 step: 3 goblins alive at home, hp max', alive(A.sim) === 3 && A.sim.entities[0].components.health.hp === A.sim.entities[0].components.health.max
  && A.sim.steer.x[0] === A.sim.homeX[0] && A.wire.logic.groups.goblins === 1);
ok('2c: block fired once; state mirrored into world.state.logic', A.wire.logic.fireCount('rook.ambush') === 1 && A.w.state.logic && A.w.state.logic.g.goblins === 1);
A.wire.onEvent('zone:entered', { id: 'yard' }); tick(A.wire, 2);
ok('2d: once -> re-entering does not refire', A.wire.logic.fireCount('rook.ambush') === 1 && alive(A.sim) === 3);

// ---- 3) save/load after the ambush
const saved = serialize(A.w);
const B = build(deserialize(JSON.parse(JSON.stringify(saved)), assets, { physics: 'mesh' }), status);
ok('3a: fresh sim after load has the reserve group down again (before the wire re-applies)', alive(B.sim) === 0);
B.wire.onWorldLoaded();
ok('3b: load -> gate closed, goblins alive, block count restored', gateVariant(B.w) === 'closed' && alive(B.sim) === 3 && B.wire.logic.fireCount('rook.ambush') === 1, `${gateVariant(B.w)} ${alive(B.sim)} ${B.wire.logic.fireCount('rook.ambush')}`);
B.sim.setDown(0, true); // one goblin removed by hand: a refire would bring it back
B.wire.onEvent('zone:entered', { id: 'yard' }); tick(B.wire, 3);
ok('3c: no refire after load (goblin 0 stays down)', B.wire.logic.fireCount('rook.ambush') === 1 && alive(B.sim) === 2);
B.sim.setDown(0, false);

// ---- 4) group.cleared fires once
const kill = (R, i) => { R.sim.state[i] = STATE_CORPSE; R.wire.onEvent('beast:died', { id: R.sim.ids[i] }); };
kill(B, 0); kill(B, 1); tick(B.wire, 3);
ok('4a: 2 of 3 dead -> not cleared', B.wire.logic.groups.goblins === 1 && B.wire.logic.fireCount('rook.won') === 0);
kill(B, 2); tick(B.wire, 1); // check marks the group cleared + queues group.cleared
tick(B.wire, 1); // the block runs
ok('4b: last one dead -> group.cleared fired exactly once; flag set, gate open', B.wire.logic.fireCount('rook.won') === 1 && B.w.state['rook.won'] === true && gateVariant(B.w) === 'open'
  && B.wire.logic.groups.goblins === 2 && B.emitted.some((e) => e[0] === 'flag:set' && e[1] === 'rook.won'));
tick(B.wire, 30);
ok('4c: stays once over time', B.wire.logic.fireCount('rook.won') === 1);
// save/load after cleared: group stays down (no goblins), count kept
const C = build(deserialize(JSON.parse(JSON.stringify(serialize(B.w))), assets, { physics: 'mesh' }), status);
C.wire.onWorldLoaded(); tick(C.wire, 3);
ok('4d: reload after cleared: goblins down, gate open, no refire', alive(C.sim) === 0 && gateVariant(C.w) === 'open' && C.wire.logic.fireCount('rook.won') === 1 && C.wire.logic.groups.goblins === 2);

// ---- 5) prop close deferred while the player stands in the gateway; nav footprint follows
const navCalls = [];
const fakeNav = { blockWorldRect: (o, ...r) => navCalls.push(['block', o, ...r]), unblock: (o) => navCalls.push(['unblock', o]) };
const D = build(null, status, fakeNav);
D.wire.props.request(GATE, 'open');
const gh = D.w.get(GATE), gt = gh.data ? gh.data.transform : gh.transform;
D.player.x = gt.x; D.player.y = gt.y; D.player.z = gt.z;
ok('5a: close refused (deferred) while the player is in the gateway', D.wire.props.request(GATE, 'closed') === false && gateVariant(D.w) === 'open' && D.wire.props.pending === 1);
tick(D.wire, 5);
ok('5b: still open after 5 steps with the player inside', gateVariant(D.w) === 'open' && D.wire.props.pending === 1 && !navCalls.some((c) => c[0] === 'block'));
D.player.x = gt.x + 10;
tick(D.wire, 1);
ok('5c: player steps out -> gate closes next step, nav blocked once', gateVariant(D.w) === 'closed' && D.wire.props.pending === 0 && navCalls.filter((c) => c[0] === 'block').length === 1);
D.wire.props.request(GATE, 'open');
ok('5d: opening again unblocks the nav footprint', gateVariant(D.w) === 'open' && navCalls.filter((c) => c[0] === 'unblock').length === 1);
// a deferred request survives save/load (world.state carries the want key)
D.player.x = gt.x; D.wire.props.request(GATE, 'open'); D.player.x = gt.x; D.wire.props.request(GATE, 'closed');
const E = createPropStates(D.w, { player: () => D.player });
E.reapply();
ok('5e: a deferred want is restored from world.state (pending 1, still open)', E.pending === 1 && gateVariant(D.w) === 'open', `${E.pending} ${gateVariant(D.w)}`);
D.player.x = gt.x + 10; E.step();
ok('5f: restored want applies once the gateway is clear', E.pending === 0 && gateVariant(D.w) === 'closed');

// ---- 6) wrong dt warns once, determinism of hashes is covered by engine/core/logic.test.js
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
