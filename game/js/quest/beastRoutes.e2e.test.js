// BEAST-07b: end-to-end roaming with the REAL beastSim + regional generator + director wire (no stubs) on a real nav grid.
// Routes stay inside their region rect and every leg is reachable (A*); over 6000 steps groups move, stay cohesive (<= 8 m), never stand
// stuck > 5 s (BEAST-01 rule: wants to move, moved < 0.1 m), and the whole run is deterministic (same hash twice). Night groups are the
// placeholder wolf packs (REGION_RULES `placeholderFor: 'undead'`) and stay inside the MAX_BEASTS headroom.
import assert from 'node:assert/strict';
import { World, createRng, createHasher } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js'; import '../../../design/models/voxel_beast.js'; import '../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { buildBeastNav } from './sim/beastNav.js';
import { createBeastSim, MAX_BEASTS } from './sim/beastSim.js';
import { REGION_RULES, spawnRegionalBeasts } from './sim/regionalBeasts.js';
import { createBeastDirectorWire } from './beastDirectorWire.js';
import { regionRectOf, reachFor } from './beastRoutes.js';

paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const def = assets.world('world_m1');
const quiet = (f) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return f(); } finally { console.warn = w; console.log = l; } };
const ev = { on: () => () => {}, emit: () => {} };
const STEPS = 6000, FAR = -900;

function run() {
  const w = quiet(() => World.load(def, assets, { physics: 'grid' })); w.state = {};
  const list = quiet(() => spawnRegionalBeasts(w, G, 12));
  // real nav over every opened region (same builder + params as main.js world nav, terrain only: structures are irrelevant in far regions and cost 100x)
  const nav = buildBeastNav({ terrain: w.terrain }, { area: { x0: 0, y0: 300, w: 1900, h: 1450 }, cell: 2, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
  const sim = quiet(() => createBeastSim(w, { nav, rng: createRng(1), events: ev }));
  const wire = createBeastDirectorWire({ sim, members: list, seed: 12, state: w.state, events: ev, terrain: w.terrain, geo: G, nav, dayLenSec: 1200, hour: () => 22, los: () => false });
  return { w, list, nav, sim, wire };
}

const A = run(), groups = A.wire.groups;
// 1. routes: inside the region rect, 3..6 waypoints, every leg (incl. the closing one) reachable on the real nav
const rectOf = regionRectOf(G), reach = reachFor(A.nav);
let legs = 0;
for (const g of groups) {
  const r = rectOf(g.region); assert.ok(r, 'rect for ' + g.region);
  assert.ok(g.route.length >= 3 && g.route.length <= 6, g.gid + ' len');
  let p = g.home;
  for (const q of g.route.concat([g.route[0]])) {
    assert.ok(q[0] >= r[0] && q[0] <= r[2] && q[1] >= r[1] && q[1] <= r[3], g.gid + ' waypoint in rect ' + q);
    assert.ok(reach(p[0], p[1], q[0], q[1]), g.gid + ' leg reachable ' + p + ' -> ' + q);
    p = q; legs++;
  }
}
// 2. night groups = placeholder wolves, headroom
const nightRules = REGION_RULES.filter((r) => r.when === 'night');
assert.ok(nightRules.length >= 2 && new Set(nightRules.map((r) => r.region)).size >= 2, 'night groups in >= 2 regions');
assert.ok(nightRules.every((r) => r.placeholderFor === 'undead' && r.species === 'wolf'), 'placeholders marked');
const nightGroups = groups.filter((g) => g.when === 'night'), nightSlots = nightGroups.reduce((n, g) => n + g.slots.length, 0);
assert.ok(nightGroups.length >= 2 && nightGroups.length <= 3, 'night groups 2-3: ' + nightGroups.length);
assert.ok(A.sim.count < MAX_BEASTS && MAX_BEASTS - A.sim.count >= 20, `MAX_BEASTS headroom ${A.sim.count}/${MAX_BEASTS} (night slots ${nightSlots})`);

// 3. roam 6000 steps (night hour: every set active); player parked far away so nothing is in view
function simulate(S) {
  const { sim, wire } = S, N = sim.count, gs = wire.groups, h = createHasher();
  const x0 = gs.map((g) => sim.steer.x[g.slots[0]]), y0 = gs.map((g) => sim.steer.y[g.slots[0]]);
  const ax = new Float64Array(N), ay = new Float64Array(N), still = new Int32Array(N);
  for (let s = 0; s < N; s++) { ax[s] = sim.steer.x[s]; ay[s] = sim.steer.y[s]; }
  let worst = 0, maxStill = 0; const maxDisp = gs.map(() => 0);
  for (let i = 0; i < STEPS; i++) {
    wire.step(1 / 60, FAR, FAR, 1, 0); sim.step(FAR, FAR, 0);
    for (let s = 0; s < N; s++) { // BEAST-01 stuck rule: wants to move (has a goal, not there) yet moved < 0.1 m
      const dx = sim.steer.x[s] - ax[s], dy = sim.steer.y[s] - ay[s];
      if (dx * dx + dy * dy >= 0.01 || !sim.hasGoal(s) || sim.atGoal(s) || (sim.isDown && sim.isDown(s))) { ax[s] = sim.steer.x[s]; ay[s] = sim.steer.y[s]; still[s] = 0; } else if (++still[s] > maxStill) maxStill = still[s];
    }
    for (let g = 0; g < gs.length; g++) {
      const sl = gs[g].slots, l = sl[0];
      maxDisp[g] = Math.max(maxDisp[g], Math.hypot(sim.steer.x[l] - x0[g], sim.steer.y[l] - y0[g]));
      if (i > 600) for (const s of sl) worst = Math.max(worst, Math.hypot(sim.steer.x[s] - sim.steer.x[l], sim.steer.y[s] - sim.steer.y[l]));
    }
  }
  sim.hashInto(h);
  return { hash: JSON.stringify(h.digest ? h.digest() : h), worst, maxStill, maxDisp, gs };
}
const R1 = simulate(A), R2 = simulate(run());
// groups whose route really leaves home (> 40 m) must roam > 30 m; Whitecombs-foot bears stand on steep rock (walkable islands only) and legitimately sit at home
const eligible = R1.gs.map((g, i) => i).filter((i) => R1.gs[i].route.some((q) => Math.hypot(q[0] - R1.gs[i].home[0], q[1] - R1.gs[i].home[1]) > 40));
const moved = R1.maxDisp.filter((d) => d > 30).length, idle = eligible.filter((i) => R1.maxDisp[i] <= 30).map((i) => R1.gs[i].gid + ':' + R1.maxDisp[i].toFixed(0));
console.log(`legs ${legs}, groups ${groups.length}, moved>30m ${moved}, worst cohesion ${R1.worst.toFixed(2)}, max still ${(R1.maxStill / 60).toFixed(1)}s, disp ${R1.maxDisp.map((d) => d.toFixed(0)).join(',')}`);
assert.ok(eligible.length >= 12 && idle.length === 0, `groups roam (leader displacement > 30 m): ${moved}/${groups.length}, eligible ${eligible.length}, idle ${idle}`);
assert.ok(R1.worst <= 8, 'cohesion ' + R1.worst.toFixed(2));
assert.ok(R1.maxStill <= 300, 'no slot stuck > 5 s: ' + (R1.maxStill / 60).toFixed(1));
assert.equal(R1.hash, R2.hash, 'deterministic over 2 runs');
console.log('beastRoutes.e2e.test: PASS');
