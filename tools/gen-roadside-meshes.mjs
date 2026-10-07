// Road-left Quaternius mesh scatter (owner 2026-10-07): ~300 trees / rocks / grass / mushrooms / pebbles on the LEFT (= south, walking west
// from the tower) verge of the walk-out road, seeded + clustered. Writes the "roadL###" structures into content/worlds/world_m1.world.json
// (replaces earlier roadL* rows; the hand-placed roadS* rows are never touched) and prints the detail.exclude capsules that
// design/levels/overworld_far.js must carry (the generator warns when they are missing).
// Usage: node tools/gen-roadside-meshes.mjs [--seed N] [--count N] [--dry-run]
// Geometry: path centre line = overworld_far recipe.path.points; heading west, left = (dy, -dx) = +y = SOUTH (y grows southward).
// Mesh structures have no scale field (World.placeMesh), so only yaw varies. lift = per-class z offset measured from the roadS* rows.
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
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

const argv = process.argv.slice(2);
const argN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const SEED = argN('--seed', 20261007), COUNT = argN('--count', 300), dry = argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062]];
const U0 = 14, U1 = 250;                // arc length range along the path (m): x ~1468 .. ~1250
const V0 = 6, V1 = 22;                  // lateral distance from the centre line, left side (road halfWidth 3 + verge)
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
data.structures = data.structures.filter((s) => !/^roadL\d+$/.test(s.id));
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;

// mesh classes
const names = fs.readdirSync('content/meshes/quaternius').filter((f) => f.endsWith('.mesh.json')).map((f) => f.replace('.mesh.json', ''));
const cls = (n) => /Tree/.test(n) ? 'tree' : /^Rock_/.test(n) ? 'rock' : /^RockPath/.test(n) ? 'rockpath' : /^Pebble/.test(n) ? 'pebble' : /^Grass/.test(n) ? 'grass' : /^Mushroom/.test(n) ? 'mushroom' : null;
const LIFT = { tree: 0.2, rock: 0.15, rockpath: -0.02, pebble: -0.01, grass: 0, mushroom: 0 };
const SHADOW = { tree: true, rock: true };   // small pieces: castShadow:false
const pool = {}, info = {};
for (const n of names) {
  const c = cls(n); if (!c) continue;
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
const QUOTA = { tree: 0.35, rock: 0.30, pebble: 0.12, grass: 0.10, mushroom: 0.10, rockpath: 0.03 };   // share of COUNT: mostly trees + rocks
const quota = {}; for (const k in QUOTA) quota[k] = Math.round(QUOTA[k] * COUNT);

// occupied circles: existing mesh structures + keep-outs
const circles = [];
for (const s of data.structures) if (s.mesh) circles.push({ x: s.origin.x, y: s.origin.y, r: info[s.mesh.split('/')[1]]?.r ?? 1 });
circles.push({ x: 1428, y: 1040, r: 6 });              // waystone + end trigger
circles.push({ x: 1478, y: 1025, r: 6 });              // breach landing
circles.push({ x: 1494, y: 1048, r: 10 });             // groveSouth (forest paint)
const ok = (x, y, r) => {
  for (const c of circles) { const dx = c.x - x, dy = c.y - y, m = c.r + r + 0.3; if (dx * dx + dy * dy < m * m) return false; }
  const nn = nearest(x, y); if (nn.side < 0 || nn.d < V0 - 0.5 || nn.d > V1 + 1 || nn.u < U0 - 4 || nn.u > U1 + 4) return false;
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
    const [x, y] = at(u + gauss() * 4.5, v + gauss() * 3.2);
    if (!ok(x, y, inf.r)) continue;
    const e = inf.ext * 0.5;   // footprint: highest ground under centre + 4 points, so slopes do not leave the piece floating
    const z = Math.max(T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e)) + LIFT[c];
    circles.push({ x, y, r: inf.r });
    const st = { id: 'roadL' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + name, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: Math.floor(R() * 360) };
    if (!SHADOW[c]) st.castShadow = false;
    out.push(st); counts[c] = (counts[c] || 0) + 1;
  }
}
const perMesh = {}; for (const s of out) { const n = s.mesh.split('/')[1]; perMesh[n] = (perMesh[n] || 0) + 1; }

// detail.exclude capsules for the verge (centre line shifted EXCL_V south)
const caps = [];
{ const a0 = U0 - 6, end = U1 + 6, pts = [a0]; for (const s of segs) { const b = s.u0 + s.len; if (b > a0 && b < end) pts.push(b); } pts.push(end);
  for (let i = 0; i < pts.length - 1; i++) { const a = at(pts[i], EXCL_V), b = at(pts[i + 1], EXCL_V); caps.push(`{ shape: 'capsule', ax: ${Math.round(a[0])}, ay: ${Math.round(a[1])}, bx: ${Math.round(b[0])}, by: ${Math.round(b[1])}, r: ${EXCL_R} }`); } }

const fmt = (s) => '    {"id": "' + s.id + '", "mesh": "' + s.mesh + '", "origin": {"x": ' + s.origin.x + ', "y": ' + s.origin.y + ', "z": ' + s.origin.z + '}, "yawDeg": ' + s.yawDeg + (s.castShadow === false ? ', "castShadow": false' : '') + '}';
const rows = text.split('\n').filter((l) => !/"id": "roadL\d+"/.test(l));
const last = rows.findLastIndex((l) => /"id": "roadS\d+"/.test(l));
rows[last] = rows[last].replace(/,?$/, ',');
rows.splice(last + 1, 0, out.map((s, i) => fmt(s) + (i < out.length - 1 ? ',' : '')).join('\n'));
const res = stringifyContent(JSON.parse(rows.join('\n')));   // world_m1 is in the manifest: canonical form (content-canonical test)
console.log(`roadL: ${out.length} meshes (seed ${SEED}, ${guard} cluster tries); by class`, JSON.stringify(counts), '\nby mesh', JSON.stringify(perMesh));
console.log(`detail.exclude capsules (centre line + ${EXCL_V} m south, r ${EXCL_R}):\n` + caps.join(',\n'));
const far = fs.readFileSync('design/levels/overworld_far.js', 'utf8');
if (!caps.every((c) => far.includes(c))) console.log('WARNING: design/levels/overworld_far.js detail.exclude lacks the capsules above');
if (!dry) { fs.writeFileSync(FILE, res, 'utf8'); console.log('wrote', FILE, (res.length / 1024).toFixed(1) + ' KB'); }
