// POI-05 + POI-05b: poiFights on REAL static beast slots (real World + beastSim + spawn-director wire; no fake spawner).
// approach -> members active; kill all -> cleared + chest unlocked; 3 days later the small fight is back, the guardian never; save/reload keeps state.
// Run: node game/js/life/poiFights.test.js
import { World, createRng } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js'; import '../../../design/models/voxel_beast.js'; import '../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBand } from '../quest/sim/band.js';
import { createBeastSim, MAX_BEASTS } from '../quest/sim/beastSim.js';
import { spawnRegionalBeasts, authoredHomes } from '../quest/sim/regionalBeasts.js';
import { createBeastDirectorWire } from '../quest/beastDirectorWire.js';
import { createPoiWire } from './poiWire.js';
import { generatePois, authoredPoints } from './poiSites.js';
import { createPoiFights, fightSlots, TRIGGER_R, LEAVE_R } from './poiFights.js';
import { spawnPoiBeasts, poiGroups } from './poiBeasts.js';

paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
const def = assets.world('world_m1'), band = createBand(G.regions), DAY = 600;

const mkBus = () => { const h = {}; return { on(n, f) { (h[n] = h[n] || []).push(f); return () => { h[n] = h[n].filter((x) => x !== f); }; }, emit(n, p) { for (const f of (h[n] || []).slice()) f(p); } }; };
const stub = { addEntity() {}, removeEntity() {} };

// the fight POIs: Boar Wallow (small, 4 boars) and Charcoal Burners made a GUARDIAN (3 members, boss class)
function boot(state) {
  const world = World.load(def, assets, { physics: 'grid' }), bus = mkBus();
  const defs = generatePois({ geo: G, terrain: world.terrain, seed: 12, avoid: authoredPoints(def.entities) });
  defs.find((d) => d.id === 'poi.charcoalBurners.1').guardian = true;
  const authored = authoredHomes(world).length;
  const regional = quiet(() => spawnRegionalBeasts(world, G, 12));
  const members = spawnPoiBeasts(world, defs);
  const sim = quiet(() => createBeastSim(world, { nav: buildBeastNav(world, def.nav), rng: createRng(1), events: bus, band, tileNav: true, spawn: { x: 1480, y: 1030 } }));
  const groups = poiGroups(sim, members, defs);
  const bw = createBeastDirectorWire({ sim, members: regional, seed: 12, state, events: bus, terrain: world.terrain, dayLenSec: DAY, los: () => false, extraGroups: groups });
  const pw = createPoiWire({ world: stub, defs, state });
  const pf = createPoiFights({ wire: pw, sim, dir: bw.dir, groups, events: bus });
  return { world, bus, defs, authored, regional, members, sim, groups, bw, pw, pf, state };
}
const state = {};
const R = boot(state);
const small = R.defs.find((d) => d.id === 'poi.boarWallow.1'), guard = R.defs.find((d) => d.id === 'poi.charcoalBurners.1');
const slotsOf = (r, id) => r.groups.find((g) => g.poiId === id).slots;
const downs = (r, id) => slotsOf(r, id).filter((s) => r.sim.down[s] > 0).length;
const gi = (r, id) => r.bw.groups.indexOf(r.groups.find((g) => g.poiId === id));

// headroom: every fight member has a slot, and the sim keeps room under MAX_BEASTS for far camps / future kinds
const poiN = R.members.length;
ok('every POI member got a static sim slot', R.members.every((m) => R.sim.slotOf(m.id) >= 0) && poiN === 4 + 3, `members ${poiN}`);
ok(`slot headroom: ${R.authored} authored + ${R.regional.length} regional + ${poiN} POI = ${R.sim.count} of ${MAX_BEASTS} (>= 24 left for camps)`, MAX_BEASTS - R.sim.count >= 24, `count ${R.sim.count}`);
ok('POI members start parked', downs(R, small.id) === 4 && downs(R, guard.id) === 3);
ok('groups: small = camp (rule 2), guardian = boss (rule 0)', R.bw.dir.rule[gi(R, small.id)] === 2 && R.bw.dir.rule[gi(R, guard.id)] === 0, JSON.stringify(R.groups.map((g) => g.cls)));
ok('fightSlots deterministic', JSON.stringify(fightSlots(small)) === JSON.stringify(fightSlots(small)) && fightSlots(small).length === 4);
ok('trigger radius is 15 m, leave 60', TRIGGER_R === 15 && LEAVE_R === 60);

const killAll = (r, poi) => { for (const s of slotsOf(r, poi)) r.bus.emit('combat:hit', { source: 'player', target: r.sim.ids[s], damage: 9999 }); r.sim.step(1480, 1030, 0); r.sim.step(1480, 1030, 0); };
const tick = (r, sec, px, py) => { for (let i = 0; i < sec * 60; i++) r.bw.step(1 / 60, px, py, -1, 0); };
const FAR = [-500, -500];

R.pw.step(small.at[0], small.at[1]); R.pf.step(small.at[0] + 40, small.at[1], 0);
ok('outside 15 m: still parked', downs(R, small.id) === 4 && !R.pf.isFighting(small.id));
ok('chest locked before the clear', !R.pw.chestUnlocked(small.id));
R.pf.step(small.at[0] + 10, small.at[1], 0);
ok('within 15 m: members unparked and active', R.pf.isFighting(small.id) && downs(R, small.id) === 0 && slotsOf(R, small.id).every((s) => !R.sim.isDead(s)));
killAll(R, small.id);
ok('all dead -> fight cleared + chest unlocked', !R.pf.isFighting(small.id) && R.pw.chestUnlocked(small.id) && R.bw.dir.dead[gi(R, small.id)] === 1);
R.pf.step(small.at[0], small.at[1], 0);
ok('cleared fight does not restart on approach', !R.pf.isFighting(small.id));

// 3 days later: small back (re-parked by the director), guardian never
R.pw.step(guard.at[0], guard.at[1]);
R.pf.step(guard.at[0] + 5, guard.at[1], 0); killAll(R, guard.id);
ok('guardian cleared once; chest open', R.pw.guardianDead(guard.id) && R.pw.chestUnlocked(guard.id) && R.bw.dir.dead[gi(R, guard.id)] === 1);
tick(R, 2.9 * DAY, FAR[0], FAR[1]); R.pf.step(small.at[0], small.at[1], 2);
ok('2.9 days: small fight not back', !R.pf.isFighting(small.id) && R.bw.dir.dead[gi(R, small.id)] === 1);
tick(R, 0.3 * DAY, FAR[0], FAR[1]);
ok('3.2 days: group alive again, members parked', R.bw.dir.dead[gi(R, small.id)] === 0 && downs(R, small.id) === 4);
R.pw.step(small.at[0], small.at[1]); R.pf.step(small.at[0] + 5, small.at[1], 3);
ok('3 days later: small fight is back and active', R.pf.isFighting(small.id) && downs(R, small.id) === 0 && slotsOf(R, small.id).every((s) => !R.sim.isDead(s)));
tick(R, 10 * DAY, FAR[0], FAR[1]); R.pw.step(guard.at[0], guard.at[1]); R.pf.step(guard.at[0], guard.at[1], 20);
ok('guardian never returns (10 days)', !R.pf.isFighting(guard.id) && slotsOf(R, guard.id).every((s) => R.sim.isDead(s)) && R.bw.dir.dead[gi(R, guard.id)] === 1);

// leaving re-parks a half-fought fight
R.pf.step(small.at[0] + 100, small.at[1], 20);
ok('leave > 60 m: re-parked', !R.pf.isFighting(small.id) && downs(R, small.id) === 4);

// save / reload: both fights stay cleared + parked, chests unlocked
R.pw.step(small.at[0], small.at[1]); R.pf.step(small.at[0] + 5, small.at[1], 21); killAll(R, small.id);
R.bw.save();
const blob = JSON.parse(JSON.stringify(state));
const R2 = boot(blob);
R2.pw.step(small.at[0], small.at[1]); R2.pw.step(guard.at[0], guard.at[1]);
ok('reload: dead groups stay parked', downs(R2, small.id) === 4 && downs(R2, guard.id) === 3);
R2.pf.step(small.at[0] + 5, small.at[1], 21); R2.pf.step(guard.at[0] + 5, guard.at[1], 21);
ok('reload: neither fight restarts; chests unlocked', !R2.pf.isFighting(small.id) && !R2.pf.isFighting(guard.id) && R2.pw.chestUnlocked(small.id) && R2.pw.chestUnlocked(guard.id));
R2.sim.resetAll(); R2.bus.emit('beasts:reset');
ok('beasts:reset re-parks the POI slots', downs(R2, small.id) === 4 && downs(R2, guard.id) === 3);
R.pf.dispose(); R2.pf.dispose();

console.log(`poiFights: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
