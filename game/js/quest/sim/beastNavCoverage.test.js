// BEAR-NAV-01 (verify-d069 4c): every brain entity in the real world_m1 sits in a walkable cell of the nav built from
// the world's own `nav` block, and a real bear 10 m from the player aggroes. Run: node game/js/quest/sim/beastNavCoverage.test.js
import { World, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_WANDER } from './beastSim.js';

paletteMod; detailPassMod; terrainMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const def = assets.world('world_m1');
const world = World.load(def, assets, { physics: 'grid' });
const t0 = performance.now();
const nav = buildBeastNav(world, def.nav);
const ms = performance.now() - t0;
const g = nav.grid;
ok('nav build < 12000 ms (MAP-STRAND-01 widened nav.area to 455x490 cells at cell 2, ~223k cells: 5-7 s one-time load; was 0.8 s on the old area)', ms < 12000, `${ms.toFixed(0)} ms`);
ok('nav grid < 400k cells', g.w * g.h < 400000, `${g.w}x${g.h}`);

const homes = [];
world.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.kind === 'beast') homes.push({ id: e.id, x: b.home[0], y: b.home[1] }); });
ok('world has beasts (26 at time of writing)', homes.length >= 20, String(homes.length));
const bad = homes.filter((h) => { const cx = g.cellX(h.x), cy = g.cellY(h.y); return !g.inBounds(cx, cy) || g.cost[g.index(cx, cy)] === 0; });
ok('every beast home is in a walkable nav cell', bad.length === 0, bad.map((b) => b.id).join(','));

const beasts = createBeastSim(world, { nav, rng: createRng(1), events: { emit() {}, on() { return () => {}; } } });
const bi = beasts.entities.findIndex((e) => e.id === 'blackBear1');
const be = beasts.entities[bi].data ? beasts.entities[bi].data.transform : beasts.entities[bi].transform;
const px = be.x + 10, py = be.y, pz = world.terrain.heightAt(px, py);
let aggro = false;
for (let i = 0; i < 300 && !aggro; i++) { beasts.step(px, py, pz); if (beasts.state[bi] !== STATE_WANDER) aggro = true; }
ok('west-lobe blackBear1 leaves WANDER with the player 10 m away', aggro, `state=${beasts.state[bi]}`);
console.log(`beastNavCoverage: ${homes.length} homes, grid ${g.w}x${g.h}, build ${ms.toFixed(0)} ms`);
console.log(`${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
