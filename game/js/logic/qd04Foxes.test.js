// QD-04 (OB-225): "Scratches at the Door" ambush from the REAL content (content/logic/qd04.logic.json + world_m1 foxes), headless Node:
// node game/js/logic/qd04Foxes.test.js. Pattern of farmAmbush.test.js: fires once, only while the quest is active, group clears.
import fs from 'node:fs';
import { World, SIM_STEP, createRng, validateLogic } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import boarMod from '../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBeastSim, STATE_CORPSE, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_FLEE, STATE_GRAZE } from '../quest/sim/beastSim.js';
import { ACTIVE, UNAVAILABLE } from '../quest/sim/questBook.js';
import { createLogicWire } from './logicWire.js';
import { LOGIC_VOCAB } from './vocab.js';

paletteMod; detailPassMod; terrainMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const BLOCKS = J('../../../content/logic/qd04.logic.json'), PROPS = J('../../../content/logic/props.json');
const idx = J('../../../content/logic/index.json');
const world = J('../../../content/worlds/world_m1.world.json');
const foxDefs = world.entities.filter((e) => e.components && e.components.brain && e.components.brain.group === 'qd04.foxes');
ok('content: 2 reserve foxes authored + block file registered in index.json', foxDefs.length === 2 && foxDefs.every((e) => e.components.brain.reserve === true) && idx.files.includes('qd04.logic.json'));
ok('content: qd04.logic.json passes the real vocab', validateLogic(BLOCKS, LOGIC_VOCAB).length === 0, validateLogic(BLOCKS, LOGIC_VOCAB).join(' | '));

const QUEST = 'sq.burl.tower', FLAG = 'inspect.qd04_towerScratch';
const DEF = () => ({ name: 'qd04Test', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }],
  entities: foxDefs.map((e) => ({ ...e, components: { ...e.components, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } } })), state: {} });
const NAV = { area: { x0: 1400, y0: 950, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const status = { [QUEST]: UNAVAILABLE };
const w = World.load(DEF(), assets, { physics: 'mesh' });
const sim = createBeastSim(w, { nav: buildBeastNav(w, NAV), rng: createRng(1), events: { on: () => () => {}, emit() {} } });
const player = { x: 1488, y: 1031, z: 0 };
const wire = createLogicWire({ world: w, blocks: BLOCKS, meshStates: PROPS, book: { statusOf: (id) => (id in status ? status[id] : -1) }, sim, nav: null, player: () => player, hint: () => {}, hooks: { emitSimple() {} } });
const tick = (n = 1) => { for (let i = 0; i < n; i++) wire.onTick(SIM_STEP); };
const alive = () => [0, 1].filter((i) => sim.down[i] === 0 && sim.state[i] < STATE_CORPSE).length;

ok('1a: foxes start in reserve', alive() === 0 && sim.groupSlots('qd04.foxes').length === 2);
wire.onEvent('flag:set', { key: FLAG }); tick(3);
ok('1b: quest not active -> nothing spawns, block not fired', alive() === 0 && wire.logic.fireCount('qd04.scratch') === 0);
status[QUEST] = ACTIVE;
wire.onEvent('flag:set', { key: 'inspect.somethingElse' }); tick(2);
ok('2a: other inspect flag -> nothing', alive() === 0);
wire.onEvent('flag:set', { key: FLAG }); tick(2);
ok('2b: reading the claw marks with the quest active -> 2 foxes, fired once', alive() === 2 && wire.logic.fireCount('qd04.scratch') === 1);
wire.onEvent('flag:set', { key: FLAG }); tick(2);
ok('2c: once -> no refire', wire.logic.fireCount('qd04.scratch') === 1 && alive() === 2);
// the spawned foxes FIGHT (kind fox_raider = packHunter, not the skittish plain fox): with the player 6 m away at least one notices/chases/attacks and none flees
{
  let engaged = false, fled = false;
  for (let k = 0; k < 240; k++) { sim.step(player.x + 6, player.y, w.groundZ ? w.groundZ(player.x + 6, player.y) : 2.4); for (const i of [0, 1]) { const st = sim.state[i]; if (st === STATE_NOTICE || st === STATE_CHASE || st === STATE_WINDUP) engaged = true; if (st === STATE_FLEE || st === STATE_GRAZE) fled = true; } }
  ok('2d: spawned qd04 foxes engage the player (kind fox_raider), none flee/graze', engaged && !fled, 'engaged=' + engaged + ' fled=' + fled);
}
const kill = (i) => { sim.state[i] = STATE_CORPSE; wire.onEvent('beast:died', { id: sim.ids[i] }); };
kill(0); tick(2);
ok('3a: one fox dead -> group not yet cleared', wire.logic.groups['qd04.foxes'] === 1);
kill(1); tick(3);
ok('3b: both dead -> group cleared (state 2)', wire.logic.groups['qd04.foxes'] === 2);

console.log(`qd04Foxes.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  - ' + m); process.exit(1); }
