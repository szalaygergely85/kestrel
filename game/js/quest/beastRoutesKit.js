// Shared kit for the beast route e2e tests (split from beastRoutes.e2e.test.js, 2026-10-14): content/world setup, the region-cropped scene
// builder (real World + regional generator + A* nav over the region rect only) and the roam simulator. Not a test.
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
import { createBeastSim } from './sim/beastSim.js';
import { generateRegionalBeasts, spawnBeastEntity } from './sim/regionalBeasts.js';
import { buildGroups } from './sim/spawnDirector.js';
import { createBeastDirectorWire } from './beastDirectorWire.js';
import { regionRectOf, routeFor, walkableFor, reachFor } from './beastRoutes.js';

paletteMod; detailPassMod; terrainMod; geoMod;
export const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
export const def = assets.world('world_m1');
export const quiet = (f) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return f(); } finally { console.warn = w; console.log = l; } };
export const ev = { on: () => () => {}, emit: () => {} };
export const FAR = -900, SEED = 12;
export const rectOf = regionRectOf(G);

/** Fresh World + the full regional member list (same seed/generator as main.js); entities are NOT spawned yet. */
export function loadScene() {
  const w = quiet(() => World.load(def, assets, { physics: 'grid' })); w.state = {};
  const list = quiet(() => generateRegionalBeasts({ geo: G, terrain: w.terrain, seed: SEED, avoid: null }));
  return { w, list };
}
/** Nav over a rect (terrain only: structures are irrelevant in far regions and cost 100x); cell 2, same params as the main.js world nav. */
export const navFor = (w, r, pad = 24) => buildBeastNav({ terrain: w.terrain }, { area: { x0: r[0] - pad, y0: r[1] - pad, w: r[2] - r[0] + 2 * pad, h: r[3] - r[1] + 2 * pad }, cell: 2, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });

/** Routes only (no sim): the groups the wire would build, each with its seeded route clamped to the region rect. The reach nav is cropped to
 *  home +- 125 m (routes stay within 90 m * 1.2 of home) so a nav build costs ~0.2 s instead of the whole region. Returns [{ g, nav }]. */
export function routesFor(w, members) {
  const ms = members.map((m) => ({ ...m, kind: m.species, key: m.region }));
  const groups = buildGroups(ms, SEED, null), walk = walkableFor(w.terrain), out = [];
  for (const g of groups) {
    if (g.when === undefined && g.members[0] && g.members[0].when) g.when = g.members[0].when;
    const rect = rectOf(g.region), hx = g.home[0], hy = g.home[1];
    const nav = navFor(w, [Math.max(rect[0], hx - 125), Math.max(rect[1], hy - 125), Math.min(rect[2], hx + 125), Math.min(rect[3], hy + 125)], 0);
    g.route = routeFor(g, SEED, walk, { rect, reach: reachFor(nav) });
    out.push({ g, nav });
  }
  return out;
}

/** Real sim + wire for the members of ONE region only, on a nav cropped to that region rect. Fresh World each call (determinism runs). */
export function roamScene(region) {
  const { w, list: all } = loadScene();
  const list = all.filter((m) => m.region === region);
  quiet(() => { for (const b of list) spawnBeastEntity(w, b.id, b.species, b.x, b.y); });
  const nav = navFor(w, rectOf(region));
  const sim = quiet(() => createBeastSim(w, { nav, rng: createRng(1), events: ev }));
  const wire = createBeastDirectorWire({ sim, members: list, seed: SEED, state: w.state, events: ev, terrain: w.terrain, geo: G, nav, dayLenSec: 1200, hour: () => 22, los: () => false });
  return { w, list, nav, sim, wire };
}

/** Roam `steps` steps (night hour: every set active; player parked far away). Tracks cohesion, BEAST-01 stuck rule, leader displacement, final hash. */
export function simulate(S, steps) {
  const { sim, wire } = S, N = sim.count, gs = wire.groups, h = createHasher();
  const x0 = gs.map((g) => sim.steer.x[g.slots[0]]), y0 = gs.map((g) => sim.steer.y[g.slots[0]]);
  const ax = new Float64Array(N), ay = new Float64Array(N), still = new Int32Array(N);
  for (let s = 0; s < N; s++) { ax[s] = sim.steer.x[s]; ay[s] = sim.steer.y[s]; }
  let worst = 0, maxStill = 0; const maxDisp = gs.map(() => 0);
  for (let i = 0; i < steps; i++) {
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
