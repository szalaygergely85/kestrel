// Road-left Quaternius mesh scatter (owner 2026-10-07): ~300 trees / rocks / grass / mushrooms / pebbles on the LEFT (= south, walking west
// from the tower) verge of the walk-out road, seeded + clustered. Writes the "roadL###" structures into content/worlds/world_m1.world.json
// (replaces earlier roadL* rows; the hand-placed roadS* rows are never touched) and prints the detail.exclude capsules that
// design/levels/overworld_far.js must carry (the generator warns when they are missing).
// Usage: node tools/gen-roadside-meshes.mjs [--seed N] [--count N] [--dry-run] [--prefix roadL] [--side left|right] [--u0 N --u1 N --v0 N --v1 N] [--tree-quota F]
// WS1-05: only rows with the given --prefix are replaced; other prefixes (roadL, roadS, ...) stay untouched. Right side = north verge (walking west).
// Presets: --prefix roadW (south, u 250..300, count 60), --prefix roadN (north, u 110..300, v 8..26, count 140, tree quota 0.25).
// Geometry: path centre line = overworld_far recipe.path.points; heading west, left = (dy, -dx) = +y = SOUTH (y grows southward).
// Mesh structures have no scale field (World.placeMesh), so only yaw varies. lift = per-class z offset measured from the roadS* rows.
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { PLANT_SCALE, plantScaleFor, pickTree, treeScaleFor } from './plant-scale.mjs';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainDef from '../design/levels/overworld_far.js';
import lanternMod from '../design/models/lantern.js';
import leverMod from '../design/models/lever.js';
import voxelPropsMod from '../design/models/voxel_props.js';
import boulderMod from '../design/models/boulder.js';
import rubbleMod from '../design/models/rubble.js';
import wreckageMod from '../design/models/wreckage.js';
import relayMod from '../design/models/relay.js';
import swordMod from '../design/models/sword.js';
import m3PropsMod from '../design/models/m3_props.js';
import farTowerMod from '../design/models/far_tower.js';
import ferrumLightsMod from '../design/models/ferrum_lights.js';
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { meshClass, LIFT, SHADOW } from './editor/meshPlace.js';

const argv = process.argv.slice(2);
const argN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const argS = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PREFIX = argS('--prefix', 'roadL');
// DRESS-01: counts +15 % for the new bush/fern/flower classes (trees now mostly LOD1, so triangles stay below the old DeadTree-heavy mix)
const PRESETS = { roadL: { side: 'left', u0: 14, u1: 250, v0: 6, v1: 22, count: 345, tree: 0.30 }, roadW: { side: 'left', u0: 250, u1: 300, v0: 6, v1: 22, count: 70, tree: 0.30 }, roadN: { side: 'right', u0: 110, u1: 300, v0: 8, v1: 26, count: 160, tree: 0.22 },
  roadF: { side: 'left', u0: 305, u1: 470, v0: 6, v1: 20, count: 80, tree: 0.27 }, roadG: { side: 'right', u0: 305, u1: 470, v0: 8, v1: 24, count: 92, tree: 0.22 } };   // WS2-07 ford stretch (band west), DRESS-01 counts/tree share
const PRE = PRESETS[PREFIX] || PRESETS.roadL;
const SIDE = argS('--side', PRE.side) === 'right' ? -1 : 1;   // +1 left (south), -1 right (north)
// OB-034: every prefix used the SAME seed, so roadW/N/G/F shared one random stream (identical yaws, same tree trio at each section start).
// roadL keeps the base seed (its rows stay); every other prefix mixes its name into the seed.
const SEED = argN('--seed', 20261007 + (PREFIX === 'roadL' ? 0 : [...PREFIX].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100003, 7) * 17)), COUNT = argN('--count', PRE.count), dry = argv.includes('--dry-run');
const TREE_Q = argN('--tree-quota', PRE.tree);
const FILE = 'content/worlds/world_m1.world.json';
const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]];
const U0 = argN('--u0', PRE.u0), U1 = argN('--u1', PRE.u1);                // arc length range along the path (m): x ~1468 .. ~1250
const V0 = argN('--v0', PRE.v0), V1 = argN('--v1', PRE.v1);                  // lateral distance from the centre line, left side (road halfWidth 3 + verge)
const EXCL_V = (V0 + V1) / 2, EXCL_R = (V1 - V0) / 2 + 1.5;   // detail.exclude capsules: centre line + EXCL_V south, radius EXCL_R

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED);
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());

// polyline helpers
const segs = PATH.slice(1).map((p, i) => { const a = PATH[i], dx = p[0] - a[0], dy = p[1] - a[1], len = Math.hypot(dx, dy); return { a, dx: dx / len, dy: dy / len, len }; });
let acc = 0; for (const s of segs) { s.u0 = acc; acc += s.len; }
function at(u, v) { const s = segs.find((q) => u <= q.u0 + q.len) || segs[segs.length - 1], t = u - s.u0; return [s.a[0] + s.dx * t + s.dy * v, s.a[1] + s.dy * t - s.dx * v]; }   // left normal = (dy, -dx)
function nearest(x, y) {   // {d: distance, side: +1 left, u}
  let best = null;
  for (const s of segs) {
    const t = Math.max(0, Math.min(s.len, (x - s.a[0]) * s.dx + (y - s.a[1]) * s.dy));
    const px = s.a[0] + s.dx * t, py = s.a[1] + s.dy * t, d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { d, side: ((x - px) * s.dy + (y - py) * -s.dx) >= 0 ? 1 : -1, u: s.u0 + t };
  }
  return best;
}

const { assets } = await loadTestAssets();
const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);
const idRe = new RegExp('^' + PREFIX + '\\d+$');
data.structures = data.structures.filter((s) => !idRe.test(s.id));
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
world.ensureBandFor(1040, 1068);   // WS2-07: the ford stretch (x < 1180) lives in the west band; groundAt/groundTypeAt read the current near

// mesh classes
const names = fs.readdirSync('content/meshes/quaternius').filter((f) => f.endsWith('.mesh.json')).map((f) => f.replace('.mesh.json', ''));
const pool = {}, info = {};
// DRESS-01: plant classes the editor's meshClass calls 'other' (walk-through, no shadow, lift 0 - as in gen-meadow-meshes.mjs)
const PLANT_CLS = (n) => /^Pine_[1-5]/.test(n) ? 'tree' : /^Bush_Common/.test(n) ? 'bush' : /^(Fern_1|Plant_(1|7)(_Big)?)$/.test(n) ? 'fern' : /^(Flower_[34]_(Single|Group)|Clover_[12])$/.test(n) ? 'flower' : null;
const LIFTX = { ...LIFT, bush: 0, fern: 0, flower: 0 }, SHADOWX = { ...SHADOW, bush: false, fern: false, flower: false };
for (const n of names) {
  const c = PLANT_CLS(n) || meshClass(n); if (c === 'other') continue;
  const b = assets.mesh('quaternius/' + n).bbox;   // [x0, y0, z0, x1, y1, z1]
  const ext = 0.5 * Math.max(b[3] - b[0], b[4] - b[1]);
  info[n] = { cls: c, r: (c === "tree" ? 0.45 : 0.65) * ext, ext };   // trees: trunk + inner crown only
  (pool[c] ||= []).push(n);
}
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const pickWeighted = (w) => { let t = 0; for (const k in w) t += w[k]; let r = R() * t; for (const k in w) { if ((r -= w[k]) < 0) return k; } return Object.keys(w)[0]; };
const KINDS = {   // cluster recipes: class weights (DRESS-01: bush clumps at the grove edge / around rocks / on the verge, ferns under trees)
  grove: { tree: 48, rock: 8, grass: 12, mushroom: 8, bush: 12, fern: 12 },
  rocks: { rock: 50, pebble: 22, rockpath: 6, grass: 8, mushroom: 3, bush: 11 },
  meadow: { grass: 30, pebble: 10, mushroom: 6, rock: 10, tree: 8, flower: 22, fern: 6, bush: 8 },
  verge: { bush: 40, grass: 20, fern: 15, flower: 20, mushroom: 5 }
};
const KIND_W = { grove: 36, rocks: 28, meadow: 21, verge: 15 };
const QUOTA = { tree: TREE_Q, rock: 0.22, pebble: 0.09, grass: 0.10, mushroom: 0.06, rockpath: 0.02, bush: 0.14, fern: 0.08, flower: 0.07 };   // share of COUNT
const BUSH_POOL = ['Bush_Common', 'Bush_Common', 'Bush_Common_Flowers'];
const quota = {}; for (const k in QUOTA) quota[k] = Math.round(QUOTA[k] * COUNT);

// occupied circles: existing mesh structures + keep-outs
const circles = [];
for (const s of data.structures) if (s.mesh) circles.push({ x: s.origin.x, y: s.origin.y, r: info[s.mesh.split('/')[1]]?.r ?? 1 });
circles.push({ x: 1428, y: 1040, r: 6 });              // waystone + end trigger
circles.push({ x: 1478, y: 1025, r: 6 });              // breach landing
circles.push({ x: 1494, y: 1048, r: 10 });             // groveSouth (forest paint)
circles.push({ x: 1262, y: 1033, r: 8 });              // WS1-05 relay ws_roadBend (relay + base + travel anchor + wake approach)
for (const e of data.entities) if (e.type === 'beast' || e.id === 'bear') circles.push({ x: e.x, y: e.y, r: 3 });   // DRESS-01: boar homes + Burl
circles.push({ x: 992, y: 1079, r: 8 });               // WS2-07 relay ws_ford (relay + base + wake approach)
circles.push({ x: 1028, y: 1068, r: 15 });             // WS2-07 stepping stones fordS1..7 + both banks
// walk route (tools/route-walk.mjs legs 7a/7b: breach -> terrain-near -> waystone): keep every placement >= 2 m clear of it (ME-14c4 rule)
const ROUTES = [[[1485.5, 1025.5], [1470, 1029], [1428, 1040]], [[1420, 1032], [1350, 1050], [1270, 1042]], [[1260, 1045], [1180, 1062], [1090, 1070], [1046, 1069], [1010, 1070], [993, 1077]]], ROUTE_CLEAR = 2;   // 2nd = WS1-08 leg 8 (waystone -> road bend relay)
const routeDist = (x, y) => { let m = Infinity; for (const ROUTE of ROUTES) for (let i = 0; i < ROUTE.length - 1; i++) { const [ax, ay] = ROUTE[i], dx = ROUTE[i + 1][0] - ax, dy = ROUTE[i + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t)); } return m; };
const ok = (x, y, r) => {
  if (routeDist(x, y) < r + ROUTE_CLEAR) return false;
  for (const c of circles) { const dx = c.x - x, dy = c.y - y, m = c.r + r + 0.3; if (dx * dx + dy * dy < m * m) return false; }
  const nn = nearest(x, y); if (nn.side !== SIDE || nn.d < V0 - 0.5 || nn.d > V1 + 1 || nn.u < U0 - 4 || nn.u > U1 + 4) return false;
  { const o = {}; if (world.riverAt(x, y, o) || world.riverAt(x + 2, y, o) || world.riverAt(x - 2, y, o) || world.riverAt(x, y + 2, o) || world.riverAt(x, y - 2, o)) return false; }   // design walk: roadF075/roadG075 stood in a river water area
  if (T.groundTypeAt(x, y) !== 0) return false;        // grass only (no water / path / forest paint / rock type)
  const e = 1.2, gx = (T.groundAt(x + e, y) - T.groundAt(x - e, y)) / (2 * e), gy = (T.groundAt(x, y + e) - T.groundAt(x, y - e)) / (2 * e);
  return Math.hypot(gx, gy) < 0.6;
};

const out = [], counts = {};
let guard = 0;
while (out.length < COUNT && guard++ < 200000) {
  const kind = pickWeighted(KIND_W), u = U0 + R() * (U1 - U0), v = kind === 'verge' ? V0 + R() * 3 : V0 + 2 + R() * (V1 - V0 - 4);   // verge clumps hug the road edge
  const n = 5 + Math.floor(R() * 10);
  for (let k = 0; k < n && out.length < COUNT; k++) {
    const w = {}; for (const k in KINDS[kind]) if ((counts[k] || 0) < quota[k]) w[k] = KINDS[kind][k];
    if (!Object.keys(w).length) continue;
    const c = pickWeighted(w);
    let [x, y] = at(u + gauss() * 4.5, SIDE * (v + gauss() * 3.2));
    let name;
    if (c === 'tree') {   // DRESS-01: species by ground - pines on slopes / rocky ground, broadleaf beside the road, a few dead trees
      const e = 2, sl = Math.hypot(T.groundAt(x + e, y) - T.groundAt(x - e, y), T.groundAt(x, y + e) - T.groundAt(x, y - e)) / (2 * e);
      const rocky = [[5, 0], [-5, 0], [0, 5], [0, -5]].some(([dx, dy]) => T.groundTypeAt(x + dx, y + dy) === 3);
      name = pickTree(R, sl > 0.2 || rocky ? 'slope' : nearest(x, y).d < 15 ? 'near' : 'wild');
    } else name = c === 'bush' ? pick(BUSH_POOL) : pick(pool[c]);
    const inf = info[name];
    if (!inf || !ok(x, y, inf.r)) continue;
    const e = inf.ext * 0.5;   // footprint: highest ground under centre + 4 points, so slopes do not leave the piece floating
    const zs = [T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e)];
    const z = (/^(rock|pebble|rockpath|tree)$/.test(c) ? Math.min(...zs) : Math.max(...zs)) + LIFTX[c]; // ROCK-SNAP-01: rocks sit on the LOWEST ground (no floating downhill side)
    circles.push({ x, y, r: inf.r });
    const st = { id: PREFIX + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + name, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: Math.floor(R() * 360) };
    if (PLANT_SCALE[name]) st.scale = plantScaleFor(name, st.id);   // PLANT-SCALE-01 + PLANT-SIZE-RANDOM-01
    else if (c === 'tree') st.scale = treeScaleFor(st.id);            // DRESS-01: trees 0.85..1.2
    if (!SHADOWX[c]) st.castShadow = false;
    out.push(st); counts[c] = (counts[c] || 0) + 1;
    if (c === 'bush') for (let b = 0, nb = 1 + Math.floor(R() * 4); b < nb && out.length < COUNT; b++) {   // DRESS-01: bushes grow in clumps of 2-5
      const bn = pick(BUSH_POOL), bi = info[bn], bx = x + gauss() * 1.6, by = y + gauss() * 1.6;
      if (!ok(bx, by, bi.r)) continue;
      const bz = Math.max(T.groundAt(bx, by), T.groundAt(bx + bi.ext * 0.5, by), T.groundAt(bx - bi.ext * 0.5, by), T.groundAt(bx, by + bi.ext * 0.5), T.groundAt(bx, by - bi.ext * 0.5));
      circles.push({ x: bx, y: by, r: bi.r });
      const bs = { id: PREFIX + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + bn, origin: { x: +bx.toFixed(2), y: +by.toFixed(2), z: +bz.toFixed(2) }, yawDeg: Math.floor(R() * 360), castShadow: false };
      bs.scale = plantScaleFor(bn, bs.id); out.push(bs); counts.bush++;
    }
  }
}
const perMesh = {}; for (const s of out) { const n = s.mesh.split('/')[1]; perMesh[n] = (perMesh[n] || 0) + 1; }

// detail.exclude capsules for the verge (centre line shifted EXCL_V south)
const caps = [];
{ const a0 = U0 - 6, end = U1 + 6, pts = [a0]; for (const s of segs) { const b = s.u0 + s.len; if (b > a0 && b < end) pts.push(b); } pts.push(end);
  for (let i = 0; i < pts.length - 1; i++) { const a = at(pts[i], SIDE * EXCL_V), b = at(pts[i + 1], SIDE * EXCL_V); if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 2) continue; /* skip a degenerate tail segment */ caps.push(`{ shape: 'capsule', ax: ${Math.round(a[0])}, ay: ${Math.round(a[1])}, bx: ${Math.round(b[0])}, by: ${Math.round(b[1])}, r: ${EXCL_R} }`); } }

// canonical JSON round trip (world_m1 is in the manifest: content-canonical test); scale is written whenever set (WS1-05 fix: the old text fmt() dropped it)
const full = JSON.parse(text);
full.structures = full.structures.filter((s) => !idRe.test(s.id));
const last = full.structures.findLastIndex((s) => /^road[SLWN]\d+$/.test(s.id));
full.structures.splice(last + 1, 0, ...out);
const res = stringifyContent(full);
console.log(`${PREFIX}: ${out.length} meshes (seed ${SEED}, ${guard} cluster tries); by class`, JSON.stringify(counts), '\nby mesh', JSON.stringify(perMesh));
console.log(`detail.exclude capsules (centre line + ${EXCL_V} m ${SIDE > 0 ? 'south' : 'north'}, r ${EXCL_R}):\n` + caps.join(',\n'));
const far = fs.readFileSync('design/levels/overworld_far.js', 'utf8');
if (!caps.every((c) => far.includes(c))) console.log('WARNING: design/levels/overworld_far.js detail.exclude lacks the capsules above');
if (!dry) { fs.writeFileSync(FILE, res, 'utf8'); console.log('wrote', FILE, (res.length / 1024).toFixed(1) + ' KB'); }
