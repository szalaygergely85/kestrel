// MAP-STRAND-01 (D-073): the walk corridor from the south edge (river road) to the Long Strand. Bounds, ground (no void), nav reach, a real walk.
// Run: node game/js/quest/strandOpen.test.js
import fs from 'node:fs';
import { legacyVariant } from './bandPose.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title']) { try { await import(`../../../design/models/${m}.js`); } catch (e) { /* not every model exists in every clone */ } }
import { World, integrate, PHYSICS, createAStar, findPath } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { buildBeastNav } from './sim/beastNav.js';

let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d === undefined ? '' : d); } };
export const CORRIDOR = [[1478, 1100], [1520, 1180], [1590, 1300], [1590, 1500], [1520, 1700], [1500, 1735], [1440, 1762], [1384, 1745]];
// <= 0 inside the union of circle/capsule parts (the engine rule: d <= r - radius), else the smallest overshoot. Local copy: tests may only import engine/index.js.
function boundsOvershoot(b, x, y, radius) {
  let best = Infinity;
  for (const p of b.parts) {
    let cx = p.x, cy = p.y;
    if (p.shape === 'capsule') { const sx = p.bx - p.ax, sy = p.by - p.ay, t = Math.max(0, Math.min(1, ((x - p.ax) * sx + (y - p.ay) * sy) / (sx * sx + sy * sy))); cx = p.ax + sx * t; cy = p.ay + sy * t; }
    best = Math.min(best, Math.hypot(x - cx, y - cy) - (p.r - radius));
  }
  return best;
}
const data = legacyVariant(JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'))); // WM-05: pins the authored corridors (capsule bounds)
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const pts = [];
for (let i = 0; i < CORRIDOR.length - 1; i++) { const [ax, ay] = CORRIDOR[i], [bx, by] = CORRIDOR[i + 1], n = Math.ceil(Math.hypot(bx - ax, by - ay) / 8); for (let k = 0; k <= n; k++) pts.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); }
// 1 bounds + ground
let outside = 0, void_ = 0, minZ = 1e9;
for (const [x, y] of pts) {
  if (boundsOvershoot(world.bounds, x, y, 0.3) > -2) outside++;
  world.ensureBandFor(x, y);
  const z = world.floorAt(x, y); if (!Number.isFinite(z) || z < -110) void_++; else minZ = Math.min(minZ, z);
}
ok('corridor points inside bounds (2 m inside)', outside === 0, outside);
ok('corridor has ground everywhere (no void)', void_ === 0, [void_, minZ]);
for (const id of ['strandSignPost', 'strandStake01', 'strandStake08']) { const s = data.structures.find((q) => q.id === id); ok('bounds cover ' + id, boundsOvershoot(world.bounds, s.origin.x, s.origin.y, 0.3) <= 0, id); }
// 2 old bounds edge still stops (west bound probe: far outside the new corridor is outside)
ok('bounds still end: (1300,1500) and (1750,1500) outside', boundsOvershoot(world.bounds, 1300, 1500, 0.3) > 0 && boundsOvershoot(world.bounds, 1750, 1500, 0.3) > 0);
// 3 nav
world.ensureBandFor(1478, 1100);
const nav = buildBeastNav(world, data.nav), g = nav.grid, out = new Int32Array(g.w * g.h);
const cell = (x, y) => [g.cellX(x), g.cellY(y)];
const cost = (x, y) => g.terrainCost[g.index(...cell(x, y))];
ok('nav area covers the sign and stakes', g.inBounds(...cell(1384, 1742)) && g.inBounds(...cell(1408, 1813)));
const [sx, sy] = cell(1478, 1100), [gx, gy] = cell(1384, 1745);
const n = findPath(nav.astar, sx, sy, gx, gy, out);
ok('nav: path from the river-side start to the strand sign (exact)', n > 0 && !nav.astar.partial, [n, nav.astar.partial, cost(1478, 1100), cost(1384, 1745)]);
// 4 walk it
const e = { id: 'p', transform: { x: 1478, y: 1100, z: world.floorAt(1478, 1100), yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: 0 } } };
const c = { forward: 1, strafe: 0, yawDeg: 0, run: true, jump: false };
let wp = 1, steps = 0, fell = 0;
while (wp < CORRIDOR.length && steps < 60 * 400) {
  const t = e.transform, [tx, ty] = CORRIDOR[wp];
  c.yawDeg = Math.atan2(tx - t.x, -(ty - t.y)) * 180 / Math.PI;
  world.streamBand(t.x, t.y, 2); integrate(e, 1 / 60, c, world, PHYSICS); steps++;
  if (t.z < world.floorAt(t.x, t.y) - 3) fell++;
  if (Math.hypot(tx - t.x, ty - t.y) < 2.5) wp++;
}
ok('walked the corridor to the sign, no fall', wp === CORRIDOR.length && fell === 0, [wp, steps, fell, e.transform]);
console.log(fails ? `strandOpen: ${fails} FAIL` : `strandOpen: ok (${pts.length} pts, nav path ${n} cells, walk ${steps} steps)`);
process.exit(fails ? 1 : 0);
