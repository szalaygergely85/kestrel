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
import { PLANT_SCALE, plantScaleFor } from './plant-scale.mjs';
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
const PRESETS = { roadL: { side: 'left', u0: 14, u1: 250, v0: 6, v1: 22, count: 300, tree: 0.35 }, roadW: { side: 'left', u0: 250, u1: 300, v0: 6, v1: 22, count: 60, tree: 0.35 }, roadN: { side: 'right', u0: 110, u1: 300, v0: 8, v1: 26, count: 140, tree: 0.25 } };
const PRE = PRESETS[PREFIX] || PRESETS.roadL;
const SIDE = argS('--side', PRE.side) === 'right' ? -1 : 1;   // +1 left (south), -1 right (north)
const SEED = argN('--seed', 20261007), COUNT = argN('--count', PRE.count), dry = argv.includes('--dry-run');
const TREE_Q = argN('--tree-quota', PRE.tree);
const FILE = 'content/worlds/world_m1.world.json';
const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062]];
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

// mesh classes
const names = fs.readdirSync('content/meshes/quaternius').filter((f) => f.endsWith('.mesh.json')).map((f) => f.replace('.mesh.json', ''));
const pool = {}, info = {};
for (const n of names) {
  const c = meshClass(n); if (c === 'other') continue;
  const b = assets.mesh('quaternius/' + n).bbox;   // [x0, y0, z0, x1, y1, z1]
  const ext = 0.5 * Math.max(b[3] - b[0], b[4] - b[1]);
  info[n] = { cls: c, r: (c === "tree" ? 0.45 : 0.65) * ext, ext };   // trees: trunk + inner crown only
  (pool[c] ||= []).push(n);
}
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const pickWeighted = (w) => { let t = 0; for (const k in w) t += w[k]; let r = R() * t; for (const k in w) { if ((r -= w[k]) < 0) return k; } return Object.keys(w)[0]; };
const KINDS = {   // cluster recipes: class weights
  grove: { tree: 55, rock: 12, grass: 20, mushroom: 13 },
  rocks: { rock: 55, pebble: 25, rockpath: 8, grass: 8, mushroom: 4 },
  meadow: { grass: 40, pebble: 20, mushroom: 15, rock: 15, tree: 10 }
};
const KIND_W = { grove: 40, rocks: 35, meadow: 25 };
const QUOTA = { tree: TREE_Q, rock: 0.30, pebble: 0.12, grass: 0.10, mushroom: 0.10, rockpath: 0.03 };   // share of COUNT: mostly trees + rocks
const quota = {}; for (const k in QUOTA) quota[k] = Math.round(QUOTA[k] * COUNT);

// occupied circles: existing mesh structures + keep-outs
const circles = [];
for (const s of data.structures) if (s.mesh) circles.push({ x: s.origin.x, y: s.origin.y, r: info[s.mesh.split('/')[1]]?.r ?? 1 });
circles.push({ x: 1428, y: 1040, r: 6 });              // waystone + end trigger
circles.push({ x: 1478, y: 1025, r: 6 });              // breach landing
circles.push({ x: 1494, y: 1048, r: 10 });             // groveSouth (forest paint)
circles.push({ x: 1262, y: 1033, r: 8 });              // WS1-05 relay ws_roadBend (relay + base + travel anchor + wake approach)
// walk route (tools/route-walk.mjs legs 7a/7b: breach -> terrain-near -> waystone): keep every placement >= 2 m clear of it (ME-14c4 rule)
const ROUTES = [[[1485.5, 1025.5], [1470, 1029], [1428, 1040]], [[1420, 1032], [1350, 1050], [1270, 1042]]], ROUTE_CLEAR = 2;   // 2nd = WS1-08 leg 8 (waystone -> road bend relay)
const routeDist = (x, y) => { let m = Infinity; for (const ROUTE of ROUTES) for (let i = 0; i < ROUTE.length - 1; i++) { const [ax, ay] = ROUTE[i], dx = ROUTE[i + 1][0] - ax, dy = ROUTE[i + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t)); } return m; };
const ok = (x, y, r) => {
  if (routeDist(x, y) < r + ROUTE_CLEAR) return false;
  for (const c of circles) { const dx = c.x - x, dy = c.y - y, m = c.r + r + 0.3; if (dx * dx + dy * dy < m * m) return false; }
  const nn = nearest(x, y); if (nn.side !== SIDE || nn.d < V0 - 0.5 || nn.d > V1 + 1 || nn.u < U0 - 4 || nn.u > U1 + 4) return false;
  if (T.groundTypeAt(x, y) !== 0) return false;        // grass only (no water / path / forest paint / rock type)
  const e = 1.2, gx = (T.groundAt(x + e, y) - T.groundAt(x - e, y)) / (2 * e), gy = (T.groundAt(x, y + e) - T.groundAt(x, y - e)) / (2 * e);
  return Math.hypot(gx, gy) < 0.6;
};

const out = [], counts = {};
let guard = 0;
while (out.length < COUNT && guard++ < 200000) {
  const kind = pickWeighted(KIND_W), u = U0 + R() * (U1 - U0), v = V0 + 2 + R() * (V1 - V0 - 4);
  const n = 5 + Math.floor(R() * 10);
  for (let k = 0; k < n && out.length < COUNT; k++) {
    const w = {}; for (const k in KINDS[kind]) if ((counts[k] || 0) < quota[k]) w[k] = KINDS[kind][k];
    if (!Object.keys(w).length) continue;
    const c = pickWeighted(w), name = pick(pool[c]), inf = info[name];
    const [x, y] = at(u + gauss() * 4.5, SIDE * (v + gauss() * 3.2));
    if (!ok(x, y, inf.r)) continue;
    const e = inf.ext * 0.5;   // footprint: highest ground under centre + 4 points, so slopes do not leave the piece floating
    const zs = [T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e)];
    const z = (/^(rock|pebble|rockpath)$/.test(c) ? Math.min(...zs) : Math.max(...zs)) + LIFT[c]; // ROCK-SNAP-01: rocks sit on the LOWEST ground (no floating downhill side)
    circles.push({ x, y, r: inf.r });
    const st = { id: PREFIX + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + name, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: Math.floor(R() * 360) };
    if (PLANT_SCALE[name]) st.scale = plantScaleFor(name, st.id);   // PLANT-SCALE-01 + PLANT-SIZE-RANDOM-01
    if (!SHADOW[c]) st.castShadow = false;
    out.push(st); counts[c] = (counts[c] || 0) + 1;
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
