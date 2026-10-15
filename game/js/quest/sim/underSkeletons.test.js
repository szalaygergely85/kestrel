// UNDER-01 (OB-191): cemetery night spawner + idle ruin pair. Run: node game/js/quest/sim/underSkeletons.test.js
import { World, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import '../../../../design/models/voxel_goblin.js'; import '../../../../design/models/voxel_skeleton.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createBand } from './band.js';
import { createBeastSim, MAX_BEASTS, STATE_DYING, STATE_SINK, STATE_GONE } from './beastSim.js';
import { spawnRegionalBeasts } from './regionalBeasts.js';
import { UNDER_SITES, createUnderSpawner, RISE_MS } from './underSkeletons.js';
import { skeletonClip, presentBeasts } from '../beastView.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const mkWorld = () => World.load(def, assets, { physics: 'grid' });
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };

const band = createBand(G.regions);
const events = { emit() {}, on() { return () => {}; } };
function mk() {
  const w = mkWorld(); quiet(() => spawnRegionalBeasts(w, G, 12));
  const sim = quiet(() => createBeastSim(w, { nav: buildBeastNav(w, def.nav), rng: createRng(1), events, band, tileNav: true, spawn: { x: 1644, y: 1372 } }));
  return { w, sim };
}
const cem = UNDER_SITES.find((s) => s.id === 'cemetery'), ruin = UNDER_SITES.find((s) => s.id === 'ruinWhite');
const { w, sim } = mk();
const slotsOf = (s, site) => site.members.map((m) => s.slotOf(m[0]));
const cs = slotsOf(sim, cem), rs = slotsOf(sim, ruin);
ok('cemetery: 2 warriors + 1 archer exist', cs.every((s) => s >= 0) && cem.members.filter((m) => m[1] === 'skelwar').length === 2 && cem.members.filter((m) => m[1] === 'skelarch').length === 1);
ok('cemetery slots start down (reserve)', cs.every((s) => sim.down[s]));
ok('ruin pair (whitecombs, band 5) idles from the start (alive, not down)', rs.every((s) => s >= 0 && !sim.down[s] && sim.state[s] !== STATE_GONE));
ok('models: warrior skeleton, archer skeletonArcher', sim.entities[cs[0]].components.voxel.model === 'skeleton' && sim.entities[cs[2]].components.voxel.model === 'skeletonArcher');
ok('beast total (authored + generated + under) <= 300', sim.count <= 300 && sim.count <= MAX_BEASTS, String(sim.count));
const zones = [band.bandAt(1644, 1372), band.bandAt(1740, 200)];
ok('ruin sits in a band >= 5, cemetery tier 2 (level 5)', zones[1] >= 5 && sim.entities[cs[0]].components.brain.tier === 2, zones.join(','));
console.log('  zone band cemetery/ruin:', zones.join('/'), 'beasts:', sim.count);

const state = {};
const sp = createUnderSpawner({ sim, site: cem, state });
const z = sp.siteZ, NIGHT = 23, DAY = 12, DT = 1 / 60;
const run = (n, hour, px, py, pz = z, fx = 1, fy = 0) => { for (let i = 0; i < n; i++) sp.step(DT, px, py, pz, fx, fy, hour); };
run(10, DAY, 1630, 1372);
ok('day: nobody spawns even when the player is near', cs.every((s) => sim.down[s]) && sp.wakes === 0);
run(10, NIGHT, 1500, 1372);
ok('night, player 144 m away: nobody spawns', cs.every((s) => sim.down[s]));
run(10, NIGHT, 1625, 1372, z + 8);
ok('night, player 8 m higher (other level, |dz| >= 3): nobody spawns', cs.every((s) => sim.down[s]));
run(2, NIGHT, 1625, 1372);
ok('night + within 30 m: all 3 rise', cs.every((s) => !sim.down[s] && sim.riseMs[s] > 0) && sp.wakes === 3, `wakes ${sp.wakes}`);
ok('rise window = 1.2 s', Math.abs(sim.riseMs[cs[0]] - RISE_MS) < 40);
const out = { bar() {} };
presentBeasts(sim, w, out, { beastNotice: 0 });
const v = sim.entities[cs[0]].components.voxel, va = sim.entities[cs[2]].components.voxel;
ok('view plays rise on spawn (manual, not looping)', v.anim === 'rise' && v.playing === false && va.anim === 'rise');
run(80, NIGHT, 1625, 1372);
presentBeasts(sim, w, out, { beastNotice: 0 });
ok('after 1.2 s the rise ends', sim.riseMs[cs[0]] === 0 && v.anim !== 'rise', v.anim);
ok('skeletonClip: chase -> run, archer windup -> draw', skeletonClip('charge', 2, false) === 'run' && skeletonClip('windup', 3, true) === 'draw' && skeletonClip('idle', 3, false) === 'windup');
ok('max 3 alive at the cemetery', cs.filter((s) => !sim.down[s] && sim.state[s] !== STATE_GONE).length === 3 && sp.wakes === 3);

sim.state[cs[1]] = STATE_DYING; // killed
run(3, NIGHT, 1625, 1372);
ok('killed one is recorded in under.cemetery.dead', state['under.cemetery.dead'].ids.length === 1 && state['under.cemetery.dead'].ids[0] === cem.members[1][0]);
run(2, DAY, 1625, 1372);
ok('dawn: the living start sinking', sim.state[cs[0]] === STATE_SINK && sim.state[cs[2]] === STATE_SINK);
ok('dawn: the killed one is left alone', sim.state[cs[1]] === STATE_DYING);
for (const s of [cs[0], cs[2]]) sim.state[s] = STATE_GONE; // sink timer ran out
run(2, DAY, 1625, 1372);
ok('after the sink the living are parked down', sim.down[cs[0]] && sim.down[cs[2]]);
ok('save flags live under under.cemetery.*', Object.keys(state).length > 0 && Object.keys(state).every((k) => k.startsWith('under.cemetery.')));
run(3, NIGHT, 1625, 1372);
ok('next night: all 3 rise again (dead reset)', sp.wakes === 6 && cs.every((s) => !sim.down[s] && sim.state[s] !== STATE_GONE && sim.state[s] !== STATE_DYING), `wakes ${sp.wakes}`);
ok('dead record reset, night counter 2', state['under.cemetery.dead'].ids.length === 0 && state['under.cemetery.night'] === 2);

{ // reload mid-night with saved flags: the killed one stays dead until the next night
  const { sim: sim2 } = mk();
  const st2 = { 'under.cemetery.night': 3, 'under.cemetery.dead': { n: 3, ids: [cem.members[1][0]] } };
  const sp2 = createUnderSpawner({ sim: sim2, site: cem, state: st2 });
  for (let i = 0; i < 5; i++) sp2.step(DT, 1625, 1372, sp2.siteZ, 1, 0, NIGHT);
  const c2 = slotsOf(sim2, cem);
  ok('reload mid-night: killed one stays dead, other two rise', !!sim2.down[c2[1]] && !sim2.down[c2[0]] && !sim2.down[c2[2]] && sp2.wakes === 2, `wakes ${sp2.wakes}`);
}
{ // in-view pop-in guard
  const { sim: sim3 } = mk();
  const sp3 = createUnderSpawner({ sim: sim3, site: cem, state: {} });
  const hx = cem.anchor[0] + cem.members[0][2], hy = cem.anchor[1] + cem.members[0][3], s0 = sim3.slotOf(cem.members[0][0]);
  for (let i = 0; i < 5; i++) sp3.step(DT, hx - 5, hy, sp3.siteZ, 1, 0, NIGHT);
  ok('pop-in guard: member within 8 m and in view waits', !!sim3.down[s0]);
  for (let i = 0; i < 5; i++) sp3.step(DT, hx - 5, hy, sp3.siteZ, -1, 0, NIGHT);
  ok('looking away: it rises', !sim3.down[s0] && sim3.riseMs[s0] > 0);
}
ok('ruin pair untouched by the night spawner', rs.every((s) => !sim.down[s]));

console.log(`underSkeletons: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
