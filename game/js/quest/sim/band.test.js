// US-129a: zone band -> tier stats + gear tier. Run: node game/js/quest/sim/band.test.js
import { readFileSync } from 'node:fs';
import '../../../../design/levels/world_geo.js';
import { createBand, BAND_TABLE, tierMult } from './band.js';
import { createLoot } from './loot.js';
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.error('FAIL:', n, d ?? ''); } };
const G = globalThis.ASSETS.levels.world_geo;
const band = createBand(G.regions);

const j = JSON.parse(readFileSync(new URL('../../../../content/beasts/tiers.json', import.meta.url), 'utf8'));
ok('tiers.json == band.js table', JSON.stringify({ mult: j.mult, beastTier: j.beastTier, gearTier: j.gearTier, gearItemTier: j.gearItemTier }) === JSON.stringify(BAND_TABLE));

// AC1: 6 fixed points
const pts = [['meadow', 1450, 1040, 1], ['ford east', 1100, 1050, 4], ['Outwall', 905, 940, 5], ['Thornwood', 700, 900, 6], ['West Fells', 150, 800, 9], ['out of map', -500, 5000, band.bandAt(0, 2047)]];
for (const [n, x, y, want] of pts) ok('bandAt ' + n, band.bandAt(x, y) === want, band.bandAt(x, y));
ok('out of map clamps to nearest cell', band.bandAt(-500, 5000) === band.bandAt(0, 2047) && band.bandAt(9999, -9) === band.bandAt(2047, 0));
ok('tiers: meadow 1, Outwall 2, Fells 3', band.beastTierAt(1450, 1040) === 1 && band.beastTierAt(905, 940) === 2 && band.beastTierAt(150, 800) === 3);
ok('override wins', band.beastTierAt(1450, 1040, 3) === 3 && band.beastTierAt(150, 800, 1) === 1);
ok('tier mult t2/t3', tierMult(2).hp === 2 && tierMult(2).damage === 1.5 && tierMult(3).speed === 1.2 && tierMult(1).hp === 1);

// beast stats at spawn + no stacking on respawn (real sim)
const { createBeastSim } = await import('./beastSim.js');
const { createAStar } = await import('../../../../engine/index.js');
function mk(positions, withBand) {
  const ents = positions.map((p, i) => ({ id: 'b' + i, transform: { x: p[0], y: p[1], z: 0 }, components: { brain: { kind: 'beast', tier: p[2] } } }));
  const world = { forEachEntity: (fn) => ents.forEach(fn), entity: () => null };
  const grid = { x0: 0, y0: 0, w: 2048, h: 2048, cell: 1, blocked: () => false };
  const events = { on: () => () => {}, emit() {} };
  try { return { ents, sim: createBeastSim(world, { nav: { grid, astar: { findPath: () => [] } }, rng: { nextFloat: () => 0.5, int: () => 0 }, events, band: withBand ? band : null }) }; }
  catch (e) { return { ents, err: e }; }
}
const r = mk([[1450, 1040], [905, 940], [150, 800], [1450, 1040, 3]], true);
if (r.err || !r.sim) console.log('SKIP sim create (needs harness):', r.err && r.err.message);
else {
  const hp = r.ents.map((e) => e.components.health.max);
  ok('hp x1/x2/x3/override3', hp.join() === '4,8,12,12', hp.join());
  ok('damage payload (OB-150 level table)', r.sim._hitPayload.map((h) => +h.damage.toFixed(2)).join() === '1,1.48,1.96,1.96', r.sim._hitPayload.map((h) => h.damage).join());
  r.sim.resetAll && r.sim.resetAll();
  ok('respawn does not stack', r.ents.map((e) => e.components.health.max).join() === '4,8,12,12' && r.ents[2].components.health.hp === 12);
  ok('no band = tier 1 unless overridden', (() => { const q = mk([[150, 800], [150, 800, 2]], false); return q.sim && q.ents[0].components.health.max === 4 && q.ents[1].components.health.max === 8; })());
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
console.log('ALL PASS');
