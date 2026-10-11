// engine/world/mapBounds.test.js (MAP-11, arch 38.43): map polygon as world.bounds with terrainGrid + far coverage of the map rect.
// Run: node engine/world/mapBounds.test.js
import { World } from './World.js';
import { Terrain } from './Terrain.js';
import { makeGrid, zoneAt } from './bandGrid.js';
import { projectBounds, boundsOvershoot } from '../physics/bounds.js';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import geoDef from '../../design/levels/world_geo.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; geoDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod;
farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));
const { assets } = await loadTestAssets();
const geo = globalThis.ASSETS.levels.world_geo;
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const GRID = { cx0: 0, cy0: 0, cx1: 16, cy1: 16, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 }; // 16 chunks x 128 m = the 2048 m map rect
const out = { x: 0, y: 0, nx: 0, ny: 0 };

// AC1: polygon bounds ride on a terrainGrid world; the capsule list is replaced; old capsule worlds unchanged
const polyDef = JSON.parse(JSON.stringify(geo.bounds));
const w = World.load({ ...def0, terrainGrid: GRID, bounds: polyDef }, assets, { detail: false });
ok('terrainGrid world: bounds is the polygon', w.terrainGrid && w.bounds.shape === 'polygon' && w.bounds.pts.length === geo.bounds.pts.length);
ok('bounds copy is plain content (no _poly in JSON)', !JSON.stringify(w.bounds).includes('_poly') && w.bounds._poly && w.bounds.pts !== polyDef.pts);
ok('bad polygon rejected at load', (() => { try { World.load({ ...def0, terrainGrid: GRID, bounds: { shape: 'polygon', pts: [[0, 0], [10, 10], [10, 0], [0, 10]] } }, assets, { detail: false }); return false; } catch (e) { return /self-intersecting|intersect/.test(e.message); } })());
const capsule = World.load({ ...def0 }, assets, { detail: false });
ok('old capsule world: bounds shape unchanged', capsule.bounds && capsule.bounds.shape === def0.bounds.shape && !capsule.terrainGrid);

// the map data itself: play area inside, sea / mountains / Wall outside
const P = geo.bounds, R = 0.4, inside = (x, y) => boundsOvershoot(P, x, y, R) <= 0;
const rect = geo.protect.rect;
ok('stage 0-2 play rect corners + tower + Bend + ford + crossroads inside', [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]], [1496.5, 1024.5], [1262, 1033], [992, 1079], [713.8, 1232.1], [905, 940]].every(([x, y]) => inside(x, y)));
ok('sea (south of the coast), Wall side (x > 1880), mountains (north y < 80), west rim are outside', [[1200, 1900], [1950, 1000], [1000, 30], [-30, 800], [2000, 1750]].every(([x, y]) => !inside(x, y)));
ok('walking east past the killing ground stops at x 1880 - R', (() => { let x = 1700; for (let i = 0; i < 1500; i++) { x += 14 / 60; if (projectBounds(P, x, 1000, R, out)) x = out.x; } return Math.abs(x - (1880 - R)) < 1e-6; })());
ok('walking south at the beach stops before the sea polygon', (() => { for (const bx of [800, 1160, 1450, 1750]) { let y = 1300; for (let i = 0; i < 3000; i++) { y += 14 / 60; if (projectBounds(P, bx, y, R, out)) y = out.y; } if (!(y < geo.coast.pts.find((p) => Math.abs(p[0] - bx) < 70)[1])) return false; } return true; })());
// every vertex of the outline lies inside the map rect and on land (above the sea polygon's y at that x is checked by the coast test above)
ok('outline inside the 2048 m map rect', P.pts.every(([x, y]) => x >= 0 && x <= 2048 && y >= 0 && y <= 2048));

// AC2 (the outer half texel, 4 m, is the bilinear sampler rim: corners are sampled 8 m in): the far grid covers the map rect - every zone of the grid, any corner/centre, has a baked far height (no hole)
const recipe = globalThis.ASSETS.levels.overworld_far;
const T = new Terrain(recipe); T.bakeFarSync();
const g = makeGrid(GRID), z = {}, cs = 128;
let holes = 0, zones = 0;
for (let j = 0; j < g.nj; j++) for (let i = 0; i < g.ni; i++) {
  zoneAt(g, i, j, z); zones++;
  const x0 = z.cx0 * cs, y0 = z.cy0 * cs, x1 = (z.cx0 + z.cw) * cs, y1 = (z.cy0 + z.ch) * cs;
  for (const [x, y] of [[x0 + 8, y0 + 8], [x1 - 8, y0 + 8], [x0 + 8, y1 - 8], [x1 - 8, y1 - 8], [(x0 + x1) / 2, (y0 + y1) / 2]]) {
    const h = T.farHeightAt ? T.farHeightAt(x, y) : null;
    if (h === null || h === undefined || !Number.isFinite(h)) holes++;
  }
}
ok('far grid is the whole map rect (0,0,256 x 256 x 8 m)', T.mapX0 === 0 && T.mapY0 === 0 && T.mapW * T.mapCell === 2048 && T.mapH * T.mapCell === 2048);
ok(`far height defined in all ${zones} zones x 5 points (no hole)`, zones > 0 && holes === 0, 'holes ' + holes);
ok('far height defined at every polygon vertex', P.pts.every(([x, y]) => Number.isFinite(T.farHeightAt(x, y))));

console.log(`mapBounds: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
