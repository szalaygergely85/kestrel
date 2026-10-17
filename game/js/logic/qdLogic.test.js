// QD-05 cart robbers + QD-07 jetty eel from the REAL content (content/logic/qd.logic.json + world_m1 placements), headless Node:
// node game/js/logic/qdLogic.test.js. Fixture = the real reserve beasts of groups cart.bandits / jetty.eel.
import fs from 'node:fs';
import { World, SIM_STEP, createRng, validateLogic } from '../../../engine/index.js';
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
import { createBeastSim, STATE_CORPSE } from '../quest/sim/beastSim.js';
import { ACTIVE, UNAVAILABLE } from '../quest/sim/questBook.js';
import { createLogicWire } from './logicWire.js';
import { LOGIC_VOCAB } from './vocab.js';
import { CHEST_TABLES } from '../quest/sim/chestDefs.js';

paletteMod; detailPassMod; m0Mod; m1Mod; m2Mod; m3Mod; m4Mod; m5Mod; m6Mod; m7Mod; terrainMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const BLOCKS = J('../../../content/logic/qd.logic.json'), PROPS = J('../../../content/logic/props.json');
const world = J('../../../content/worlds/world_m1.world.json');
const groupOf = (g) => world.entities.filter((e) => e.components && e.components.brain && e.components.brain.group === g);
const bandits = groupOf('cart.bandits'), eels = groupOf('jetty.eel');
ok('content: qd.logic.json passes the real vocab', validateLogic(BLOCKS, LOGIC_VOCAB).length === 0, validateLogic(BLOCKS, LOGIC_VOCAB).join(' | '));
ok('content: 2 reserve robbers + 1 reserve eel', bandits.length === 2 && eels.length === 1 && [...bandits, ...eels].every((e) => e.components.brain.reserve === true));
const near = (e, x, y, r) => Math.hypot(e.x - x, e.y - y) <= r;
ok('content: robbers within 8 m of the wagon, eel within 6 m of the jetty', bandits.every((e) => near(e, 1347, 1058, 8)) && near(eels[0], 1043, 1058, 6));
ok('content: chestCart placed + table (honeycomb); the turtle is within 6 m of chestBoots', !!world.entities.find((e) => e.id === 'chestCart') && CHEST_TABLES.chestCart.fixed.some((f) => f.item === 'honeycomb')
  && near(world.entities.find((e) => e.id === 'qd03_turtle'), 975, 1060, 6));
const DEF = () => ({ name: 'qdTest', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }],
  entities: [...bandits, ...eels].map((e) => ({ ...e, components: { ...e.components, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } } })), state: {} });
const NAV = { area: { x0: 1000, y0: 1000, w: 400, h: 160 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: [] };
const status = { 'sq.tm.cart': UNAVAILABLE, 'sq.fc.jetty': UNAVAILABLE };
const pack = { cog: 0 };
const w = World.load(DEF(), assets, { physics: 'mesh' });
const sim = createBeastSim(w, { nav: buildBeastNav(w, NAV), rng: createRng(1), events: { on: () => () => {}, emit() {} } });
const wire = createLogicWire({ world: w, blocks: BLOCKS, meshStates: PROPS, book: { statusOf: (id) => (id in status ? status[id] : -1) }, sim, nav: null,
  player: () => ({ x: 1350, y: 1058, z: 0 }), hint() {}, hooks: { emitSimple() {} } });
const tick = (n = 1) => { for (let i = 0; i < n; i++) wire.onTick(SIM_STEP); };
const slotsOf = (g) => sim.groupSlots(g);
const alive = (g) => slotsOf(g).filter((i) => sim.down[i] === 0).length;
ok('1a: both groups start in reserve (nothing alive)', slotsOf('cart.bandits').length === 2 && slotsOf('jetty.eel').length === 1 && alive('cart.bandits') === 0 && alive('jetty.eel') === 0);

// QD-05
wire.onEvent('flag:set', { key: 'talk.rsInspectWagon', value: true }); tick(3);
ok('2a: quest not active -> inspect flag spawns nothing', alive('cart.bandits') === 0 && wire.logic.fireCount('qd05.cart.search') === 0);
status['sq.tm.cart'] = ACTIVE;
wire.onEvent('flag:set', { key: 'talk.other', value: true }); tick(2);
ok('2b: another flag does nothing', alive('cart.bandits') === 0);
wire.onEvent('flag:set', { key: 'talk.rsInspectWagon', value: true }); tick(2);
ok('2c: active + inspect -> 2 robbers within 1 step, block fired once', alive('cart.bandits') === 2 && wire.logic.fireCount('qd05.cart.search') === 1);
wire.onEvent('flag:set', { key: 'talk.rsInspectWagon', value: true }); wire.onEvent('zone:entered', { id: 'wagon' }); tick(3);
ok('2d: once -> no refire; the return block ignores a live group', wire.logic.fireCount('qd05.cart.search') === 1 && alive('cart.bandits') === 2);
for (const i of slotsOf('cart.bandits')) { sim.state[i] = STATE_CORPSE; wire.onEvent('beast:died', { id: sim.ids[i] }); }
tick(3);
ok('2e: both dead -> group cleared', wire.logic.groups['cart.bandits'] === 2);

// QD-07
wire.onEvent('item:got', { id: 'cog', n: 1 }); tick(3);
ok('3a: quest not active -> picking the cog spawns no eel', alive('jetty.eel') === 0);
status['sq.fc.jetty'] = ACTIVE;
wire.onEvent('item:got', { id: 'cog', n: 1 }); tick(3);
ok('3b: active + cog taken -> the reed eel strikes, fired once', alive('jetty.eel') === 1 && wire.logic.fireCount('qd07.jetty.cog') === 1);
wire.onEvent('item:got', { id: 'cog', n: 1 }); tick(3);
ok('3c: once', wire.logic.fireCount('qd07.jetty.cog') === 1 && alive('jetty.eel') === 1);
const e0 = slotsOf('jetty.eel')[0]; sim.state[e0] = STATE_CORPSE; wire.onEvent('beast:died', { id: sim.ids[e0] }); tick(3);
ok('3d: eel dead -> group cleared (the kill step can complete)', wire.logic.groups['jetty.eel'] === 2);

console.log(`qdLogic.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  - ' + m); process.exit(1); }
