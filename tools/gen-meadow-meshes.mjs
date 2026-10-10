// MESH-PLACE-01: meadow dressing from EXISTING content/meshes (Quaternius): bushes, grass clumps, MegaKit ferns/flowers/clover/plants (MESH-PLACE-02), mushrooms,
// rocks on the slopes, pebbles. Writes the "mdw###" structures into content/worlds/world_m1.world.json (replaces earlier mdw* rows and
// leaves roadS*/roadL* rows alone) and retargets burlBush to the leafy Bush_Common. Bushes are walk-through via the mesh json `collide:false`
// (SOFT_NAME_RE in engine/mesh/colliderProxy.js + tools/gen-mesh-colliders.mjs), not per placement (World.load ignores a placement `collide`).
// Usage: node tools/gen-meadow-meshes.mjs [--seed N] [--dry-run]
// Area: the meadow around Burl, the walk-out path breach (1486.5, 1025) -> bend (1420, 1032) -> waystone (1428, 1040), and the hillside south of it.
// Keep-outs (checked again by tools/meadow-clear.test.mjs): the path (ground type path + 1.5 m verge), 2.5 m beside the route walk line, 3.5 m
// around Burl / the waystone / every boar home (+ the piece's own radius), the tower footprint, and every existing mesh structure.
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { PLANT_SCALE } from './plant-scale.mjs';
import { pathToFileURL } from 'node:url';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'menu_ui', 'notes', 'brazier']) await import(`../design/models/${m}.js`);
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';

export const MEADOW = { x0: 1426, x1: 1494, y0: 1008, y1: 1064 };
export const PATH = [[1480, 1025], [1420, 1032]];                      // overworld_far recipe.path.points (first leg)
export const ROUTE = [[1485.5, 1025.5], [1470, 1029], [1428, 1040]];   // tools/route-walk.mjs legs 7a/7b
export const PATH_HALF = 3, PATH_VERGE = 1.5, ROUTE_CLEAR = 2.5, HOME_CLEAR = 3.5;
export const TOWER = { x0: 1479, x1: 1505, y0: 1017, y1: 1033 };      // footprint 1480..1504 x 1018..1032 + 1 m
export const POOL = {
  bush: ['Bush_Common', 'Bush_Common', 'Bush_Common_Flowers'],
  flowerBush: ['Bush_Common_Flowers'],
  grass: ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall'],   // wispy grass was the fern stand-in; real ferns are the 'fern' class now
  fern: ['Fern_1'],
  flower: ['Flower_3_Single', 'Flower_3_Single', 'Flower_4_Single', 'Flower_3_Group'],
  clover: ['Clover_1', 'Clover_2'],
  plant: ['Plant_1', 'Plant_1_Big', 'Plant_7', 'Plant_7_Big'],
  mushroom: ['Mushroom_Common'],
  rock: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'],
  pebble: ['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Square_1', 'Pebble_Square_2', 'Pebble_Square_5'],
};
const LIFT = { fern: 0, flower: 0, clover: 0, plant: 0, bush: 0, flowerBush: 0, grass: 0, mushroom: 0, rock: 0.15, pebble: -0.01 };
const SHADOW = { fern: false, flower: false, clover: false, plant: false, bush: false, flowerBush: false, grass: false, mushroom: false, rock: true, pebble: false };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function segDist(x, y, pts) {
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return m;
}
/** Fixed anchors: Burl, the waystone, and every boar home from the world json. */
export function anchors(data) {
  const a = [];
  for (const e of data.entities) if (e.id === 'bear' || e.id === 'endMarker' || e.type === 'beast') a.push({ id: e.id, x: e.x, y: e.y });
  return a;
}
export const isMeadowId = (id) => /^mdw\d+$/.test(id);

async function main() {
  const argv = process.argv.slice(2), dry = argv.includes('--dry-run');
  const SEED = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : 20261009;
  const R = rng(SEED);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const FILE = 'content/worlds/world_m1.world.json';
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.structures = data.structures.filter((s) => !isMeadowId(s.id));
  const burlBush = data.structures.find((s) => s.id === 'burlBush');
  burlBush.mesh = 'quaternius/Bush_Common'; burlBush.scale = PLANT_SCALE.Bush_Common;
  burlBush.note = 'NPC-BEAR-01: the bush beside Burl (MESH-PLACE-01: leafy Bush_Common; no berry mesh exists in content/meshes)';
  const { assets } = await loadTestAssets();
  const world = World.load(data, assets, { physics: 'mesh' });
  const T = world.terrain;
  const info = {};
  for (const cls of Object.keys(POOL)) for (const n of POOL[cls]) if (!info[n]) {
    const b = assets.mesh('quaternius/' + n).bbox, ext = 0.5 * Math.max(b[3] - b[0], b[4] - b[1]);
    info[n] = { cls, ext, r: 0.65 * ext };
  }
  const circles = data.structures.filter((s) => s.mesh).map((s) => ({ x: s.origin.x, y: s.origin.y, r: 1.2 }));
  const fixed = anchors(data);
  const slope = (x, y) => { const e = 1.2; return Math.hypot((T.groundAt(x + e, y) - T.groundAt(x - e, y)) / (2 * e), (T.groundAt(x, y + e) - T.groundAt(x, y - e)) / (2 * e)); };
  const ok = (x, y, r) => {
    if (x < MEADOW.x0 || x > MEADOW.x1 || y < MEADOW.y0 || y > MEADOW.y1) return false;
    if (x > TOWER.x0 - r && x < TOWER.x1 + r && y > TOWER.y0 - r && y < TOWER.y1 + r) return false;
    if (segDist(x, y, PATH) < PATH_HALF + PATH_VERGE + r) return false;
    if (segDist(x, y, ROUTE) < ROUTE_CLEAR + r) return false;
    for (const f of fixed) if (Math.hypot(f.x - x, f.y - y) < HOME_CLEAR + r) return false;
    for (const c of circles) { const m = c.r + r + 0.3; if ((c.x - x) ** 2 + (c.y - y) ** 2 < m * m) return false; }
    if (T.groundTypeAt(x, y) !== 0) return false;
    return slope(x, y) < 0.7;
  };
  if (argv.includes('--slopes')) {   // debug: slope histogram + steepest grass cells of the meadow box
    const h = {}; let best = [];
    for (let x = MEADOW.x0; x < MEADOW.x1; x += 2) for (let y = MEADOW.y0; y < MEADOW.y1; y += 2) { if (T.groundTypeAt(x, y) !== 0) continue; const sl = slope(x, y); h[Math.min(9, Math.floor(sl * 10))] = (h[Math.min(9, Math.floor(sl * 10))] || 0) + 1; best.push([sl, x, y]); }
    console.log('slope x0.1 histogram', JSON.stringify(h), 'steepest', best.sort((a, b) => b[0] - a[0]).slice(0, 5).map((b) => b.map((v) => +v.toFixed(2)).join('/')).join(' '));
  }
  const out = [];
  const add = (cls, x, y) => {
    const name = pick(POOL[cls]), inf = info[name];
    if (!ok(x, y, inf.r)) return false;
    const e = inf.ext * 0.5;
    const z = Math.max(T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e)) + LIFT[cls];
    circles.push({ x, y, r: inf.r });
    const st = { id: 'mdw' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + name, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: Math.floor(R() * 360) };
    if (PLANT_SCALE[name]) st.scale = PLANT_SCALE[name];   // PLANT-SCALE-01
    if (!SHADOW[cls]) st.castShadow = false;
    out.push(st); return true;
  };
  const site = () => [MEADOW.x0 + R() * (MEADOW.x1 - MEADOW.x0), MEADOW.y0 + R() * (MEADOW.y1 - MEADOW.y0)];
  const forestNear = (x, y) => [[9, 0], [-9, 0], [0, 9], [0, -9], [6, 6], [-6, -6], [6, -6], [-6, 6]].some(([dx, dy]) => T.groundTypeAt(x + dx, y + dy) === 1);
  const counts = { bushClump: 0, flowerEdge: 0, rocks: 0, grass: 0, flowerPatch: 0, cloverPatch: 0, fernShade: 0 };
  const QUOTA = { bushClump: 12, flowerEdge: 11, rocks: 10, grass: 20, flowerPatch: 12, cloverPatch: 12, fernShade: 12 };
  for (let guard = 0; guard < 40000 && Object.keys(QUOTA).some((k) => counts[k] < QUOTA[k]); guard++) {
    const [cx, cy] = site(), pd = segDist(cx, cy, PATH), sl = slope(cx, cy);
    const sig = (s) => gauss() * s;
    if (counts.rocks < QUOTA.rocks && sl > 0.06 && pd > 6) {         // rocks on the slopes: 1-3 boulders + pebbles + a grass tuft
      const n0 = out.length;
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) add('rock', cx + sig(1.6), cy + sig(1.6));
      for (let k = 0, n = 2 + Math.floor(R() * 4); k < n; k++) add('pebble', cx + sig(2.2), cy + sig(2.2));
      add('grass', cx + sig(2), cy + sig(2));
      if (out.length > n0) counts.rocks++;
    } else if (counts.flowerEdge < QUOTA.flowerEdge && (forestNear(cx, cy) || pd > 15) && sl < 0.3) {   // flowers at the meadow edge
      const n0 = out.length;
      for (let k = 0, n = 1 + Math.floor(R() * 2); k < n; k++) add('flowerBush', cx + sig(1.5), cy + sig(1.5));
      for (let k = 0, n = 2 + Math.floor(R() * 3); k < n; k++) add('grass', cx + sig(1.8), cy + sig(1.8));
      for (let k = 0, n = 1 + Math.floor(R() * 2); k < n; k++) add('flower', cx + sig(1.8), cy + sig(1.8));
      if (R() < 0.3) add('mushroom', cx + sig(1.5), cy + sig(1.5));
      if (out.length > n0) counts.flowerEdge++;
    } else if (counts.bushClump < QUOTA.bushClump && pd > 6 && pd < 24 && sl < 0.35) {   // bush clump with grass and the odd mushroom
      const n0 = out.length;
      for (let k = 0, n = 2 + Math.floor(R() * 3); k < n; k++) add('bush', cx + sig(1.7), cy + sig(1.7));
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) add('grass', cx + sig(2), cy + sig(2));
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) add('fern', cx + sig(2.2), cy + sig(2.2));   // ferns in the shade of the bushes
      if (R() < 0.4) add('plant', cx + sig(2), cy + sig(2));
      if (R() < 0.25) add('mushroom', cx + sig(1.3), cy + sig(1.3));
      if (out.length > n0) counts.bushClump++;
    } else if (counts.fernShade < QUOTA.fernShade && forestNear(cx, cy) && pd > 5 && sl < 0.4) {   // fern colonies under the tree line
      const n0 = out.length;
      for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) add('fern', cx + sig(1.8), cy + sig(1.8));
      for (let k = 0, n = Math.floor(R() * 3); k < n; k++) add('plant', cx + sig(2), cy + sig(2));
      if (out.length > n0) counts.fernShade++;
    } else if (counts.flowerPatch < QUOTA.flowerPatch && pd > 8 && sl < 0.25) {   // flower patches in the open meadow
      const n0 = out.length;
      for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) add('flower', cx + sig(1.8), cy + sig(1.8));
      for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) add('grass', cx + sig(2), cy + sig(2));
      if (out.length > n0) counts.flowerPatch++;
    } else if (counts.cloverPatch < QUOTA.cloverPatch && pd > 5 && sl < 0.3) {   // clover mats in the grass
      const n0 = out.length;
      for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) add('clover', cx + sig(1.7), cy + sig(1.7));
      for (let k = 0, n = 1 + Math.floor(R() * 2); k < n; k++) add('grass', cx + sig(2), cy + sig(2));
      if (out.length > n0) counts.cloverPatch++;
    } else if (counts.grass < QUOTA.grass && pd > 5 && sl < 0.4) {     // loose grass / wispy-fern clumps, nearer the path
      const n0 = out.length;
      for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) add('grass', cx + sig(1.6), cy + sig(1.6));
      if (out.length > n0) counts.grass++;
    }
  }
  const perMesh = {}; for (const s of out) perMesh[s.mesh.split('/')[1]] = (perMesh[s.mesh.split('/')[1]] || 0) + 1;
  console.log(`mdw: ${out.length} meshes (seed ${SEED}), clusters`, JSON.stringify(counts), '\nby mesh', JSON.stringify(perMesh));
  const iBush = data.structures.findIndex((s) => s.id === 'burlBush');
  data.structures.splice(iBush, 0, ...out);   // burlBush stays the last structure row, after the generated rows
  if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
