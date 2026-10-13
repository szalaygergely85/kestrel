// SWIM-03b (architecture.md 38.54 items 1,2,4,9): swimFeed feeds waterZ / waterFloorZ + the river current; no deep wall, no rescue.
// Synthetic checks first, then end to end on the real world_m1 data (Braid ford pool, Glasswater) with a scripted stick.
import fs from 'node:fs';
import '../../../../design/palette.js';
import '../../../../design/detail-pass.js';
import '../../../../design/levels/overworld_far.js';
import '../../../../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../../../../design/models/${m}.js`); } catch { /* optional */ } }
import { World, createWater, collectWaterDefs, integrate, PHYSICS } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { createSwimFeed } from './swimFeed.js';
import { createWading } from './wading.js';

let fails = 0;
const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d === undefined ? '' : d); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const dt = 1 / 60;
const mkEnt = (x, y, z) => ({ id: 'p', transform: { x, y, z, yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } });

// ---- synthetic: river along +x (v 1.0), bed 8.8 (1.2 m deep) ----
{
  const w = new World();
  w.water = createWater(collectWaterDefs({ water: [{ id: 'r', shape: 'river', path: [[0, 0, 10, 30, 1], [60, 0, 10, 30, 1], [120, 0, 10, 30, 1]] }, { id: 'p', shape: 'rect', rect: [200, 0, 220, 20], z: 5 }] }, []));
  w.physicsMode = 'mesh';
  const sup = { floorH: 0, ceilH: 'sky', terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
  w.supportAt = (x, y) => { sup.floorH = x >= 200 ? 1 : 8.8; return sup; };
  w.floorAt = (x) => (x >= 200 ? 1 : 8.8);
  w.collideCircle = (x, y, dx, dy, r, z, g, o, out) => { out.x = x + dx; out.y = y + dy; out.blockedX = false; out.blockedY = false; out.nx = 0; out.ny = 0; return out; };
  const feed = createSwimFeed(w), wd = createWading(w);
  const e = mkEnt(5, 0, 8.8), b = e.components.body;
  wd.before(e); feed.feed(e);
  ok('river: waterZ = surface, waterFloorZ = surface - depth', near(b.waterZ, 10, 0.2) && near(b.waterFloorZ, 8.8, 0.2), [b.waterZ, b.waterFloorZ]);
  ok('not swimming yet: no feed push (wading owns it)', b.pushX >= 0);
  const rect = mkEnt(210, 10, 1); feed.feed(rect);
  ok('rect region feeds too (z 5, floor 1)', near(rect.components.body.waterZ, 5, 0.2) && near(rect.components.body.waterFloorZ, 1, 0.2), [rect.components.body.waterZ, rect.components.body.waterFloorZ]);
  const dry = mkEnt(5, 100, 9); dry.components.body.waterZ = 3; feed.feed(dry);
  ok('dry: NaN fields', Number.isNaN(dry.components.body.waterZ) && Number.isNaN(dry.components.body.waterFloorZ));
  // current pushes a swimmer downstream (0.7 x flow ~ 0.7 m/s), no stick
  const s = mkEnt(5, 0, 8.8); let x0 = 0;
  for (let i = 0; i < 180; i++) { if (i === 60) x0 = s.transform.x; wd.before(s); feed.feed(s); integrate(s, dt, { forward: 0, strafe: 0 }, w, PHYSICS); wd.after(s); }
  ok('swimmer is swimming', s.components.body.swimming === true);
  const v = (s.transform.x - x0) / 2;
  ok(`current pushes a swimmer downstream ~0.7 m/s (${v.toFixed(2)})`, v > 0.5 && v < 0.9, v);
  ok('no rescue field / no teleport while swimming', s.components.body.wadeRescue === undefined && s.transform.y === 0);
  // wading in shallow water is unchanged: bed 9.6 -> imm 0.4, never swimming, speedScale < 1
  w.supportAt = () => { sup.floorH = 9.6; return sup; }; w.floorAt = () => 9.6;
  const h = mkEnt(5, 0, 9.6);
  for (let i = 0; i < 60; i++) { wd.before(h); feed.feed(h); integrate(h, dt, { forward: 0, strafe: 0 }, w, PHYSICS); }
  ok('shallow: not swimming, grounded, wading push ~0.31 m/s', h.components.body.swimming === false && h.components.body.grounded && h.transform.x > 5.25 && h.transform.x < 5.4, h.transform.x);
}

// ---- real world: scripted stick across the Braid ford pool and over Glasswater ----
const U = globalThis.ASSETS.levels.overworld_far.util;
const data = JSON.parse(fs.readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
world.bounds = null; // the walk bound (MAP-11) is the world edge, not water: unrelated to swimming, and the json's stale capsule bounds cut the Braid
const feed = createSwimFeed(world), wd = createWading(world);
const wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
function spawnAt(x, y) { world.ensureBandFor(x, y); const f = world.floorAt(x, y); return mkEnt(x, y, f); }
// walk with yaw (deg; 0 = +y, 90 = +x as in wading.test), n steps; returns stats
function walk(e, yaw, n) {
  const c = { forward: 1, strafe: 0, yawDeg: yaw, run: false }; const st = { swam: 0, maxDepth: 0, teleport: 0 };
  for (let i = 0; i < n; i++) {
    const t = e.transform, px = t.x, py = t.y;
    world.ensureBandFor(t.x, t.y);
    wd.before(e, 1); feed.feed(e);
    integrate(e, dt, c, world, PHYSICS); wd.after(e);
    if (e.components.body.swimming) st.swam++;
    if (world.waterAt(t.x, t.y, wa) && wa.depth > st.maxDepth) st.maxDepth = wa.depth;
    if (Math.hypot(t.x - px, t.y - py) > 1) st.teleport++;
  }
  return st;
}
// Braid ford pool (deep, y < 1058): find the deepest centre sample and cross it west -> east
{
  let by = 0, bd = 0;
  for (let y = 832; y < 1058; y += 2) { const x = U.riverX(y); world.ensureBandFor(x, y); if (world.waterAt(x, y, wa) && wa.depth > bd) { bd = wa.depth; by = y; } }
  const cx = U.riverX(by);
  const e = spawnAt(cx - 22, by); // dry west bank
  ok(`ford pool deepest ${bd.toFixed(2)} m at y ${by}`, bd > 1.15, bd);
  const st = walk(e, 90, 60 * 30);
  ok('Braid: swam across the deepest reach', st.swam > 20 && st.maxDepth > 1.15, JSON.stringify(st));
  ok('Braid: out on the far bank, dry, grounded', e.transform.x > cx + 8 && !e.components.body.swimming && e.components.body.grounded, [e.transform.x, cx]);
  ok('Braid: no rescue teleport, never stopped by a wall', st.teleport === 0 && e.components.body.wadeRescue === undefined);
}
// Glasswater: west shore to east across the open rect (y 505, rect x 1145..1325, surface -58)
{
  const e = spawnAt(1138, 505);
  const st = walk(e, 90, 60 * 80);
  ok('Glasswater: swam over the pond', st.swam > 60 * 10 && st.maxDepth > 5, JSON.stringify(st));
  ok('Glasswater: no teleport (no rescue)', st.teleport === 0, st.teleport);
  ok('Glasswater: out the far side (x > 1325) or still moving east', e.transform.x > 1250, e.transform.x);
}
console.log(`swimFeed: ${fails ? 'FAIL' : 'ok'}`); process.exit(fails ? 1 : 0);
