// QD-09 (OB-225, D-120): "Old Tusk" (elite boar in the wallow, comes back after lingerSec) + "Who Pushed the Shrine" (2 skeletons by day)
// from the REAL content (content/logic/qd09.logic.json + world_m1 reserve groups), headless Node: node game/js/logic/qd09.test.js
import fs from 'node:fs';
import { World, SIM_STEP, createRng, validateLogic } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import boarMod from '../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBeastSim, STATE_CORPSE } from '../quest/sim/beastSim.js';
import { ACTIVE, UNAVAILABLE } from '../quest/sim/questBook.js';
import { createLogicWire } from './logicWire.js';
import { LOGIC_VOCAB } from './vocab.js';

paletteMod; detailPassMod; terrainMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const BLOCKS = J('../../../content/logic/qd09.logic.json'), PROPS = J('../../../content/logic/props.json');
const idx = J('../../../content/logic/index.json'), world = J('../../../content/worlds/world_m1.world.json');
const ents = world.entities.filter((e) => e.components && e.components.brain && /^(wallow\.oldTusk|shrine\.bones)$/.test(e.components.brain.group || ''));
const tusk = ents.filter((e) => e.components.brain.group === 'wallow.oldTusk'), bones = ents.filter((e) => e.components.brain.group === 'shrine.bones');
ok('content: 1 reserve Old Tusk (boar kind, tier 3, scale > 1, lingerSec > 1200 = longer than the 1 day elite default)', tusk.length === 1 && tusk[0].components.brain.reserve === true && tusk[0].components.brain.beastKind === 'boar'
  && tusk[0].components.brain.tier === 3 && tusk[0].scale > 1 && tusk[0].components.brain.lingerSec > 1200);
ok('content: 2 reserve skeleton_warrior (no night gate field on the entity)', bones.length === 2 && bones.every((e) => e.components.brain.reserve === true && e.components.brain.beastKind === 'skeleton_warrior' && !e.components.brain.when));
ok('content: block file registered + passes the real vocab', idx.files.includes('qd09.logic.json') && validateLogic(BLOCKS, LOGIC_VOCAB).length === 0, validateLogic(BLOCKS, LOGIC_VOCAB).join(' | '));

const W = { x: 1320, y: 1070 }, S = { x: 1005, y: 1046 };
const DEF = () => ({ name: 'qd09Test', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: ents.map((e) => ({ ...e, components: { ...e.components, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } } })), state: {} });
const w = World.load(DEF(), assets, { physics: 'mesh' });
const nav = (c) => ({ area: { x0: c.x - 96, y0: c.y - 96, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
const mkSim = (wd) => createBeastSim(wd, { nav: buildBeastNav(wd, nav(W)), rng: createRng(1), events: { on: () => () => {}, emit() {} } });
const sim = mkSim(w);
const status = { 'sq.he.wallow': UNAVAILABLE, 'sq.fc.shrine': UNAVAILABLE };
let player = { x: 1200, y: 1000, z: 0 };
const wire = createLogicWire({ world: w, blocks: BLOCKS, meshStates: PROPS, book: { statusOf: (id) => (id in status ? status[id] : -1) }, sim, nav: null, player: () => player, hint: () => {}, hooks: { emitSimple() {} } });
const tick = (n = 1) => { for (let i = 0; i < n; i++) wire.onTick(SIM_STEP); };
const slotsOf = (g) => sim.groupSlots(g);
const alive = (g) => sim.groupAlive(g);
const kill = (i) => { sim.state[i] = STATE_CORPSE; wire.onEvent('beast:died', { id: sim.ids[i] }); };

ok('1a: both groups start in reserve', alive('wallow.oldTusk') === 0 && alive('shrine.bones') === 0 && slotsOf('shrine.bones').length === 2);
// Old Tusk
wire.onEvent('zone:entered', { id: 'wallow' }); tick(2);
ok('2a: wallow entered before accepting -> nothing (OB-115)', alive('wallow.oldTusk') === 0 && wire.logic.fireCount('qd09.tusk') === 0);
status['sq.he.wallow'] = ACTIVE;
wire.onEvent('zone:entered', { id: 'other' }); tick(2);
ok('2b: another zone -> nothing', alive('wallow.oldTusk') === 0);
wire.onEvent('zone:entered', { id: 'wallow' }); tick(2);
ok('2c: quest active + wallow entered -> Old Tusk rises, fired once', alive('wallow.oldTusk') === 1 && wire.logic.fireCount('qd09.tusk') === 1);
wire.onEvent('zone:entered', { id: 'wallow' }); tick(2);
ok('2d: once -> no refire', wire.logic.fireCount('qd09.tusk') === 1);
const t0 = slotsOf('wallow.oldTusk')[0];
kill(t0); tick(3);
ok('3a: killed -> group cleared (2) and linger armed (lingerSec)', wire.logic.groups['wallow.oldTusk'] === 2 && w.state.logicLinger['wallow.oldTusk'] > 1200);
// linger: gone for the whole elite timer, then back in his area once the player is away
tick(60 * 1200); // 1200 s = 1 game day: the plain elite class time -> still down
ok('3b: after 1 day (1200 s) still down (longer linger)', alive('wallow.oldTusk') === 0 && wire.logic.groups['wallow.oldTusk'] === 2);
player = { x: W.x + 5, y: W.y, z: 0 };
tick(60 * 1300); // total 2500 s > 2400, but the player stands in the wallow -> waits (no pop-in)
ok('3c: linger over but player at the wallow -> still waiting', alive('wallow.oldTusk') === 0 && w.state.logicLinger['wallow.oldTusk'] <= 0);
player = { x: W.x + 200, y: W.y, z: 0 }; tick(2);
ok('3d: player away -> Old Tusk is back in the wallow (alive, group 1, timer cleared)', alive('wallow.oldTusk') === 1 && wire.logic.groups['wallow.oldTusk'] === 1 && !w.state.logicLinger['wallow.oldTusk']);
kill(slotsOf('wallow.oldTusk')[0]); tick(3);
ok('3e: second kill clears the group again and re-arms the linger', wire.logic.groups['wallow.oldTusk'] === 2 && w.state.logicLinger['wallow.oldTusk'] > 1200);

// Who Pushed the Shrine
wire.onEvent('flag:set', { key: 'talk.rsInspectShrine' }); tick(2);
ok('4a: shrine read before accepting -> nothing', alive('shrine.bones') === 0 && wire.logic.fireCount('qd09.bones') === 0);
status['sq.fc.shrine'] = ACTIVE;
wire.onEvent('flag:set', { key: 'talk.somethingElse' }); tick(2);
ok('4b: other flag -> nothing', alive('shrine.bones') === 0);
wire.onEvent('flag:set', { key: 'talk.rsInspectShrine' }); tick(2);
ok('4c: read with quest active (by day: no night gate) -> 2 skeletons, once', alive('shrine.bones') === 2 && wire.logic.fireCount('qd09.bones') === 1);
wire.onEvent('flag:set', { key: 'talk.rsInspectShrine' }); wire.onEvent('zone:entered', { id: 'shrine' }); tick(2);
ok('4d: no refire; return block does not double-spawn', wire.logic.fireCount('qd09.bones') === 1 && alive('shrine.bones') === 2);
const [b0, b1] = slotsOf('shrine.bones');
kill(b0); tick(2);
ok('5a: one dead -> not cleared', wire.logic.groups['shrine.bones'] === 1);
kill(b1); tick(3);
ok('5b: both dead -> cleared; skeletons have no linger (not elite)', wire.logic.groups['shrine.bones'] === 2 && !(w.state.logicLinger && w.state.logicLinger['shrine.bones']));
// fallback: quest accepted AFTER the stone was read (flag already set) -> stepping into the shrine zone spawns them
{
  const w2 = World.load(DEF(), assets, { physics: 'mesh' }); w2.state['talk.rsInspectShrine'] = true;
  const sim2 = mkSim(w2);
  const wire2 = createLogicWire({ world: w2, blocks: BLOCKS, meshStates: PROPS, book: { statusOf: (id) => (id === 'sq.fc.shrine' ? ACTIVE : -1) }, sim: sim2, nav: null, player: () => S, hint: () => {}, hooks: { emitSimple() {} } });
  wire2.onEvent('zone:entered', { id: 'shrine' }); for (let i = 0; i < 3; i++) wire2.onTick(SIM_STEP);
  ok('6: flag already set + quest active + shrine zone entered -> skeletons rise', sim2.groupAlive('shrine.bones') === 2 && wire2.logic.fireCount('qd09.bones.return') === 1);
}
console.log(`qd09.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  - ' + m); process.exit(1); }
