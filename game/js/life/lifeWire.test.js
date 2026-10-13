// LIFE-HOOKS-01. Run: node game/js/life/lifeWire.test.js  - real raids.json + real quest book + real createRaids behind a stub sim.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook } from '../quest/sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { createLifeWire, createOutwallLife, prepareRaidDefs, syncGates, DAY_KEY } from './lifeWire.js';
import { createOutwall } from '../quest/outwall.js';
import { ROUTINES } from '../quest/outwallRoutines.js';
import { lifeFromRoutines } from './schedule.js';
import { World } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import voxelPropsMod from '../../../design/models/voxel_props.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import titleMod from '../../../design/models/title.js';
import voxelWorldMod from '../../../design/models/voxel_world.js';
globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const rel = (p) => fileURLToPath(new URL(p, import.meta.url));


// LIFE-04: villagers + chat + facing seam on the real world_m1 (hesk, dorrin have entities; sorrel/pell/tam are dropped cleanly)
{
  const { assets: tAssets } = await loadTestAssets();
  const w = World.load(tAssets.world('world_m1'), tAssets, { physics: 'mesh' });
  const nav = buildBeastNav(w, tAssets.world('world_m1').nav);
  const lifeJson = lifeFromRoutines(ROUTINES), barksData = JSON.parse(readFileSync(rel('../../../content/dialogue/life.barks.json'), 'utf8'));
  const dlg = { open: false, added: [], addNpc(id) { this.added.push(id); } };
  const mk = (hour) => {
    const ow = createOutwall({ world: w, questFlag() {} });
    const ol = createOutwallLife({ world: w, life: lifeJson, nav, events: null, state: w.state, outwall: ow, dialogue: dlg, barksData, hour });
    return { ow, ol };
  };
  const day = mk(10), ents = (id) => w.get(id).data;
  ok(day.ol && day.ol.villagers.n === 2, 'only entities that exist get a villager (hesk, dorrin): n=' + (day.ol && day.ol.villagers.n));
  ok(!ents('hesk').components.voxel.hidden && !ents('dorrin').components.voxel.hidden, '10:00 villagers present');
  const night = mk(23);
  ok(ents('hesk').components.voxel.hidden && ents('dorrin').components.voxel.hidden, '23:00 villagers hidden (asleep)');
  night.ol.dispose();
  // a game hour near the plaza: they move, the yaw seam hands over, chat pairs form
  const { ol, ow } = mk(14.5), h0 = [ents('hesk').transform.x, ents('hesk').transform.y];
  const sx = ents('hesk').transform.x, sy = ents('hesk').transform.y;
  let paired = 0, walked = 0, ownedYaw = 0, talkCut = false, hr = 14.5, moved = false;
  for (let k = 0; k < 18000 * 3; k++) {
    hr = 14.5 + k / 18000; if (hr >= 24) hr -= 24;
    ol.step(1 / 60, hr, 915, 945); ow.step(1 / 60, 915, 945);
    if (ol.chat.partner(0) >= 0) { paired++; if (!talkCut && paired > 120) { dlg.open = true; ol.talked('hesk'); ol.step(1 / 60, hr, 915, 945); talkCut = ol.chat.partner(0) < 0 && ol.chat.partner(1) < 0; dlg.open = false; } }
    if (ol.villagers.actors[0].anim === 'walk') { walked++; if (ow.npcs[0].owned) ownedYaw++; }
    if (ents('hesk').transform.x !== sx || ents('hesk').transform.y !== sy) moved = true;
  }
  ok(moved && walked > 0, 'hesk moved/walked over 3 game hours: walked=' + walked);
  ok(ownedYaw === walked, 'routine owns the yaw while walking (OUT-01 skipped): ' + ownedYaw + '/' + walked);
  ok(paired > 0, 'a chat pair formed (hesk with dorrin)');
  ok(talkCut, 'player talk interrupts the chat pair');
  ol.dispose();
  void h0;
}

const json = JSON.parse(readFileSync(rel('../../../content/life/raids.json'), 'utf8'));
const { defs, gates } = prepareRaidDefs(json);
ok(defs.length === 1 && defs[0].id === 'gooseFarm' && defs[0].requires === 'life.gate.sq.ow.raid' && gates['life.gate.sq.ow.raid'] === 'sq.ow.raid', 'raids.json -> defs + gate flag', JSON.stringify({ defs, gates }));

// real book: the board accept is an action key, not a world.state flag
const assets = await loadDesignAssets();
const dir = rel('../../../content/quests');
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map((q) => q.def);
const get = (id) => all.find((d) => d.id === id);
const pre = { ...get('mq.ford.mirror') }; delete pre.requires;
const book = createQuestBook(get('m1'), [pre, get('sq.ow.raid')]);
const state = {};
ok(!state['q.sq.ow.raid.accept'], 'the q.*.accept key is never a world.state flag');
syncGates(book, state, gates);
ok(state['life.gate.sq.ow.raid'] === false, 'gate closed before accept');
ok(book.accept('mq.ford.mirror') !== undefined, 'prereq stubbed');
const via = book.statusOf('sq.ow.raid') === 1 ? book.accept('sq.ow.raid') : null;
ok(book.statusOf('sq.ow.raid') >= 2, 'board note accepted -> status active', 'status=' + book.statusOf('sq.ow.raid') + ' via=' + via);
syncGates(book, state, gates);
ok(state['life.gate.sq.ow.raid'] === true, 'gate opens once accepted');

// wiring: stub sim/world, real createRaids from raids.json, clock through midnight
const goals = {}, log = [];
const sim = { slotOf: (id) => Number(id.slice(4)) - 1, isDead: () => false, setGoal: (s, x, y) => { goals[s] = [x, y]; }, clearGoal: (s) => { delete goals[s]; }, setAltTargets() {} };
const L = {}; const events = { on(n, f) { (L[n] = L[n] || []).push(f); return () => {}; }, emit(n, p) { log.push(n); (L[n] || []).forEach((f) => f(p)); } };
const world = { entity: (id) => (id === 'gooseFarm' ? { transform: { x: 860, y: 990 } } : null) };
const st = { 'clock.hour': 20.9 };
const wire = createLifeWire({ defs, gates, sim, events, state: st, world, book: () => null });
for (let i = 0; i < 20; i++) wire.step(21.5);
ok(!log.includes('life:raid:start') && Object.keys(goals).length === 0, 'gate closed (no book) -> no raid');
wire.dispose();
const st2 = { 'clock.hour': 23.9 };
const wire2 = createLifeWire({ defs: [{ ...defs[0], chancePerNight: 1 }], gates, sim, events, state: st2, world, book: () => book });
wire2.step(23.95); wire2.step(0.05);
ok((st2[DAY_KEY] | 0) === 1, 'midnight wrap increments clock.day', String(st2[DAY_KEY]));
wire2.step(1);
ok(log.includes('life:raid:start') && Object.keys(goals).length === 5, 'accepted + night: raid starts, 5 wolves given the goose-pen goal', JSON.stringify({ log, goals }));
wire2.dispose();


// main.js hands the ambient fauna to the beast sim, with the wildlife created first
const main = readFileSync(rel('../main.js'), 'utf8');
ok(/createWild\(/.test(main) && main.indexOf('wild = createWild(') < main.indexOf('createBeastSim(world') && /fauna: wild \? wild\.fauna : null/.test(main), 'main.js: wild before beasts, fauna passed');

ok(/createOutwallLife\(/.test(main) && /outLife\.step\(/.test(main) && /outLife\.talked\(/.test(main), 'main.js wires createOutwallLife (step + talked)');
console.log(`lifeWire.test: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
