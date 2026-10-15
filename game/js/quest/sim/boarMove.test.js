// OB-176: in the default grid world_m1 at the owner pose (1430.8, 1057.3) every boar within 60 m must MOVE within 10 s
// (none frozen in idle) and every beast must be targetable. Mirrors main.js boot: grid nav tile, regional herds, createBeastSim + waterNav.
// Run: node game/js/quest/sim/boarMove.test.js
import assert from 'node:assert/strict';
import { World, NavGrid, createRng, createAStar } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import farMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import detailPassMod from '../../../../design/detail-pass.js';
import voxelPropsMod from '../../../../design/models/voxel_props.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { gridVariant } from '../bandPose.js';
import { spawnRegionalBeasts } from './regionalBeasts.js';
import { buildWaterNav } from './beastNav.js';
import { createBeastSim } from './beastSim.js';
import { createTargetables } from './targetables.js';
globalThis.window = globalThis.window || globalThis;
paletteMod; farMod; geoMod; detailPassMod; voxelPropsMod;
for (const m of ['lantern', 'lever', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_world']) await import(`../../../../design/models/${m}.js`);
const { assets } = await loadTestAssets();
const geo = globalThis.ASSETS.levels.world_geo;
if (geo && geo.util) geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const raw = assets.world('world_m1');
const def = raw.terrainGrid && raw.bounds && raw.bounds.shape === 'polygon' ? raw : gridVariant(raw, geo);
const warn = console.warn; console.warn = () => {};
const hs = {}; // tiny event bus (engine/dev.js is off-limits for game/js/quest)
const events = { on(n, f) { (hs[n] = hs[n] || []).push(f); return () => { hs[n] = hs[n].filter((g) => g !== f); }; }, emit(n, p) { for (const f of hs[n] || []) f(p); } };
const world = World.load(def, assets, { physics: 'mesh', events });
const PX = +(process.argv[2] || 1430.8), PY = +(process.argv[3] || 1057.3);
const nc = def.nav;
world.setNavTiles({ create: (x0, y0, w, h, cell) => new NavGrid({ x0, y0, w, h, cell }), maxSlopeDeg: nc.maxSlopeDeg ?? 30, maxStepM: nc.maxStepM ?? Infinity, blockedTypes: nc.blockedTypes ?? ['water'] });
world.ensureBandFor(PX, PY);
const gridNav = { grid: world.nav, astar: createAStar(world.nav) };
spawnRegionalBeasts(world, geo, 12);
const sim = createBeastSim(world, { tileNav: true, nav: gridNav, rng: createRng(nc.seed ?? 1), events, band: undefined, playerMaxHp: 100, hpPerDamage: 1, waterNav: (() => { try { return buildWaterNav(world, gridNav.grid); } catch (e) { return null; } })() });
console.warn = warn;

const boars = []; world.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.kind === 'beast' && b.species !== 'wolf' && b.species !== 'bear' && b.species !== 'goblin' && (e.transform || e).x !== undefined) boars.push(e); });
const near = boars.filter((e) => Math.hypot(e.transform.x - PX, e.transform.y - PY) < 60);
const start = new Map(near.map((e) => [e.id, [e.transform.x, e.transform.y]]));
const moved = new Map(near.map((e) => [e.id, 0]));
for (let t = 0; t < 600; t++) {
  sim.step(PX, PY, world.terrain.groundAt(PX, PY));
  if (sim.tileMode && t % 60 === 0) sim.updateTileDormancy(PX, PY);
  for (const e of near) { const s = start.get(e.id); moved.set(e.id, Math.max(moved.get(e.id), Math.hypot(e.transform.x - s[0], e.transform.y - s[1]))); }
}
const rows = [];
for (const e of near) {
  const sl = sim.slotOf(e.id);
  rows.push(`${e.id} slot=${sl} moved=${moved.get(e.id).toFixed(2)} d=${Math.hypot(e.transform.x - PX, e.transform.y - PY).toFixed(0)}`);
}
console.log(`boars<60m: ${near.length}\n` + rows.join('\n'));
const frozen = near.filter((e) => moved.get(e.id) < 0.5);
assert.ok(near.length > 0, 'boars near the owner pose');
assert.equal(frozen.length, 0, 'frozen boars: ' + frozen.map((e) => e.id).join(','));
console.log('boarMove ok');
// OB-169 half: every beast near the player is in the targetable list (cap 256, nearest picked)
const tg = createTargetables(world, events); tg.setFocus(PX, PY);
const inList = new Set(tg.ent.slice(0, tg.count).map((e) => e.id));
for (const e of near) assert.ok(inList.has(e.id), e.id + ' is targetable');
console.log('targetables ok', tg.count);
if (process.env.DBG) { const s = sim.slotOf('boar5'); console.log('boar5 state', sim.state[s], 'dormant', sim.dormant[s], 'down', sim.down[s], 'wat', sim.wat && sim.wat[s], 'tileMode', sim.tileMode); }
if (process.env.DBG) console.log('ground z', world.terrain.groundAt(PX, PY));
