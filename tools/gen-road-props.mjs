// DRESS-02 (owner 2026-10-10: "design even this nicely"): a few Medieval Village props (IMPORT-MEDIEVAL) along the walk-out road that
// tell the story of an abandoned land - a broken-down wagon + crates at the (1350,1050) road bend, two short stretches of old wooden
// fence along field edges, a ruined arch + foundation + bricks + vine near each dead relay (ws_roadBend, ws_ford) and a lone chimney
// on a brick foundation off the road. Seeded + re-runnable: replaces only the "rprop###" rows of content/worlds/world_m1.world.json.
// Usage: node tools/gen-road-props.mjs [--seed N] [--dry-run]
// Placement: each vignette is tried at seeded anchors until EVERY piece passes the keep-outs (road + 1.5 m, route-walk lines + 2.5 m,
// bear walks, bound-probe line, relays / waystone / tower / stepping stones, boars, solid meshes, no path / water ground, flat enough).
// Mesh placements are yaw-only (World.placeMesh has no tilt), so pieces sit on the LOWEST ground of their footprint with a slight sink.
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
const SEED = argN('--seed', 20261010), dry = argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', PREFIX = 'rprop', idRe = /^rprop\d+$/;
const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]];   // road centre (overworld_far recipe)
const ROAD_HALF = 3, ROAD_CLEAR = 1.5, LINE_CLEAR = 2.5;
const LINES = [   // route-walk legs 7-9c + Burl's walks + the 9b bound probe west of the ford
  [[1485.5, 1025.5], [1470, 1029], [1428, 1040]], [[1420, 1032], [1350, 1050], [1270, 1042], [1263, 1034]],
  [[1260, 1045], [1180, 1062], [1090, 1070], [1046, 1069], [1010, 1070], [993, 1077]], [[1310, 1048], [1260, 1045]],
  [[1471, 1029.1], [1462, 1031], [1452, 1034], [1443, 1037], [1436, 1040], [1431.5, 1041.5], [1426, 1034], [1418, 1026], [1410, 1018], [1404, 1010]],
  [[1008, 1075], [950, 1075]]];
const KEEP = [{ x: 1428, y: 1040, r: 6 }, { x: 1478, y: 1025, r: 6 }, { x: 1492, y: 1025, r: 16 } /* tower + door trench */, { x: 1262, y: 1033, r: 8 },
  { x: 992, y: 1079, r: 8 }, { x: 1028, y: 1068, r: 15 } /* stepping stones + banks */];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED), span = (a, b) => a + R() * (b - a), pick = (a) => a[Math.floor(R() * a.length)];
const segDist = (x, y, P) => { let m = Infinity; for (let i = 0; i < P.length - 1; i++) { const [ax, ay] = P[i], dx = P[i + 1][0] - ax, dy = P[i + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t)); } return m; };
const segs = PATH.slice(1).map((p, i) => { const a = PATH[i], dx = p[0] - a[0], dy = p[1] - a[1], len = Math.hypot(dx, dy); return { a, dx: dx / len, dy: dy / len, len }; });
let acc = 0; for (const s of segs) { s.u0 = acc; acc += s.len; }
const segAt = (u) => segs.find((q) => u <= q.u0 + q.len) || segs[segs.length - 1];
function at(u, v) { const s = segAt(u), t = u - s.u0; return [s.a[0] + s.dx * t + s.dy * v, s.a[1] + s.dy * t - s.dx * v]; }   // +v = left (south walking west)
const roadYaw = (u) => { const s = segAt(u); return Math.atan2(s.dy, s.dx) * 180 / Math.PI; };

const { assets } = await loadTestAssets();
const text = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(text);
data.structures = data.structures.filter((s) => !idRe.test(s.id));
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
world.ensureBandFor(1040, 1068);   // the ford stretch lives in the west band (as gen-roadside-meshes.mjs)
const TYPE_PATH = T.groundTypeAt(1350, 1050), TYPE_WATER = T.groundTypeAt(1028, 1068);

// occupied circles: solid meshes at their footprint, walk-through plants (grass/flowers/ferns/pebbles/mushrooms) only 0.25 m (props may stand in them)
const SOFT = /Grass|Flower|Clover|Fern|Plant_|Pebble|Mushroom/;
const circles = [];
for (const s of data.structures) if (s.mesh && s.origin) {
  const b = assets.mesh(s.mesh).bbox, sc = typeof s.scale === 'number' ? s.scale : 1;
  circles.push({ x: s.origin.x, y: s.origin.y, r: SOFT.test(s.mesh) ? 0.25 : /Tree|Pine/.test(s.mesh) ? 0.8 /* trunk; props may stand under a crown */ : Math.min(2.5, 0.45 * sc * Math.max(b[3] - b[0], b[4] - b[1])) });
}
for (const e of data.entities) if (typeof e.x === 'number') circles.push({ x: e.x, y: e.y, r: e.type === 'beast' ? 8 : 3 });   // boar homes: 8 m

const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
// piece: { mesh, x, y, yaw, pts: local [lx, ly] footprint samples, r: clearance radius per sample, z: 'low'|'mean', sink, lift, maxRange, flat }
const why = {};   // --debug: rejection counts per reason
const no = (k) => { why[k] = (why[k] || 0) + 1; return false; };
function pointOk(x, y, r) {
  for (const P of LINES) if (segDist(x, y, P) < r + LINE_CLEAR) return no('line');
  if (segDist(x, y, PATH) < ROAD_HALF + ROAD_CLEAR + r) return no('road');
  for (const k of KEEP) if (Math.hypot(k.x - x, k.y - y) < k.r + r) return no('keep');
  for (const c of circles) if (Math.hypot(c.x - x, c.y - y) < c.r + r + 0.2) return no('mesh');
  const t = T.groundTypeAt(x, y); return t !== TYPE_PATH && t !== TYPE_WATER ? true : no('ground');
}
function resolve(p) {   // world footprint + ground z, or null when a sample fails
  const zs = [];
  for (const [lx, ly] of p.pts) { const [ox, oy] = rot(p.yaw, lx, ly), x = p.x + ox, y = p.y + oy; if (!pointOk(x, y, p.r)) return null; zs.push(T.groundAt(x, y)); }
  const lo = Math.min(...zs), hi = Math.max(...zs); if (hi - lo > (p.maxRange ?? 0.6)) { no('slope:' + p.mesh); return null; }
  const z = (p.z === 'mean' ? zs.reduce((a, b) => a + b, 0) / zs.length : lo) - (p.sink ?? 0.05) + (p.lift ?? 0);
  return { ...p, zw: z };
}
const out = [], log = [];
function commit(name, pieces) {
  for (const p of pieces) {
    const st = { id: PREFIX + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + p.mesh, origin: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.zw.toFixed(2) }, yawDeg: ((Math.round(p.yaw) % 360) + 360) % 360 };
    if (p.noShadow) st.castShadow = false;
    out.push(st); circles.push({ x: p.x, y: p.y, r: p.cr ?? 0.5 });
    log.push(`${st.id} ${name} ${p.mesh} (${st.origin.x}, ${st.origin.y}, ${st.origin.z}) yaw ${st.yawDeg}`);
  }
}
// tries anchors until all required pieces resolve; optional pieces that fail are dropped
function vignette(name, anchor, build, tries = 3000) {
  for (const k in why) delete why[k];
  for (let i = 0; i < tries; i++) {
    const a = anchor(), pieces = build(a), res = [];
    let okAll = true;
    for (const p of pieces) { const r = resolve(p); if (r) res.push(r); else if (!p.optional) { okAll = false; break; } }
    if (okAll) { commit(name, res); return true; }
  }
  console.log('WARNING: vignette', name, 'found no free spot', JSON.stringify(why)); return false;
}
const BRICKS = ['Prop_Brick1', 'Prop_Brick2', 'Prop_Brick3', 'Prop_Brick4'];
const brick = (ax, ay, rMin, rMax) => {   // optional; ruin() offers 2x the wanted count so ~the wanted count survives
  const a = R() * 2 * Math.PI, d = span(rMin, rMax); return { mesh: pick(BRICKS), x: ax + Math.cos(a) * d, y: ay + Math.sin(a) * d, yaw: R() * 360, pts: [[0, 0]], r: 0.2, z: 'mean', sink: span(0.02, 0.06), maxRange: 0.3, noShadow: true, optional: true, cr: 0.2 }; };
const around = (cx, cy, d0, d1) => () => { const a = R() * 2 * Math.PI, d = span(d0, d1); return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, yaw: R() * 360 }; };
const WALL = [[-1, 0], [0, 0], [1, 0]];
// ruin: arch + vine on its face + foundation strips (in line / at right angles) + optional flagstones + bricks
const ruin = (nCover, nBricks, floor) => (a) => {
  const ps = [{ mesh: 'Wall_Arch', x: a.x, y: a.y, yaw: a.yaw, pts: WALL, r: 0.35, sink: 0.1, maxRange: 0.45, cr: 1.1 }];
  const [vx, vy] = rot(a.yaw, span(-0.3, 0.3), -0.07);
  ps.push({ mesh: 'Prop_Vine1', x: a.x + vx, y: a.y + vy, yaw: a.yaw, pts: [[0, 0]], r: 0.1, lift: 2.5, sink: 0.1, maxRange: 1, cr: 0.1, link: 0 });
  const covers = [[2.05, 0, 0], [-2.05, 0, 0], [-3.05, 1.05, 90], [3.05, -1.05, 90]];
  for (let k = 0; k < nCover; k++) { const [lx, ly, dy] = covers[k], [ox, oy] = rot(a.yaw, lx, ly); ps.push({ mesh: 'Wall_BottomCover', x: a.x + ox, y: a.y + oy, yaw: a.yaw + dy + span(-4, 4), pts: WALL, r: 0.3, z: 'mean', sink: 0.04, maxRange: 0.35, noShadow: true, optional: k > 0, cr: 1 }); }
  if (floor) { const [ox, oy] = rot(a.yaw, 0, 1.3); ps.push({ mesh: 'Floor_UnevenBrick', x: a.x + ox, y: a.y + oy, yaw: a.yaw, pts: [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9], [0, 0]], r: 0.1, z: 'low', sink: 0.0, lift: 0.01, maxRange: 0.35, noShadow: true, optional: true, cr: 1.2 }); }
  for (let k = 0; k < nBricks; k++) ps.push(brick(a.x, a.y, 1.2, 3.5));
  return ps;
};
// the vine hangs on the arch: its z follows the arch, not the ground under it
const fixVine = () => { for (let i = 0; i < out.length; i++) if (/Prop_Vine1/.test(out[i].mesh)) { const arch = out.slice(0, i).reverse().find((s) => /Wall_Arch/.test(s.mesh)); out[i].origin.z = +(arch.origin.z + 2.5).toFixed(2); } };

// 1. broken-down wagon at a road bend, skewed off the road, with crates (one fallen off) and a loose plank floor (tailgate)
const BENDS = [segs[2].u0, segs[4].u0, segs[5].u0];   // road bends (1350,1050), (1180,1062), (1090,1070); (1260,1045) is the relay
vignette('wagon', () => { const side = R() < 0.5 ? 1 : -1, u = pick(BENDS) + span(-20, 20); const [x, y] = at(u, side * span(7, 13));
  const gx = T.groundAt(x + 1, y) - T.groundAt(x - 1, y), gy = T.groundAt(x, y + 1) - T.groundAt(x, y - 1);   // long axis (local y) along the contour: yaw-only, so it must not span the slope
  return { x, y, yaw: Math.atan2(gy, gx) * 180 / Math.PI + (R() < 0.5 ? 0 : 180) + span(-15, 15) }; }, (a) => {
  const [ox, oy] = rot(a.yaw, 0, -1.14);   // the wagon origin sits at its front; centre the 4 m body on the anchor
  const ps = [{ mesh: 'Prop_Wagon', x: a.x + ox, y: a.y + oy, yaw: a.yaw, pts: [[-0.9, -0.8], [0.9, -0.8], [-0.9, 3.1], [0.9, 3.1], [0, 1.15]], r: 0.5, sink: 0.08, maxRange: 0.5, cr: 2.2 }];
  for (const [lx, ly, opt] of [[1.7, 0.4, false], [-1.6, 2.6, true]]) { const [cx, cy] = rot(a.yaw, lx, ly); ps.push({ mesh: 'Prop_Crate', x: a.x + cx, y: a.y + cy, yaw: R() * 360, pts: [[-0.5, -0.5], [0.5, 0.5], [0, 0]], r: 0.3, sink: 0.06, maxRange: 0.3, optional: opt, cr: 0.8 }); }
  const [px, py] = rot(a.yaw, span(-2.6, -2.2), span(-0.5, 0.5)); ps.push({ mesh: 'Floor_WoodDark_Half1', x: a.x + px, y: a.y + py, yaw: a.yaw + span(-25, 25), pts: [[0, 0]], r: 0.4, z: 'mean', sink: 0.0, lift: 0.02, maxRange: 0.3, noShadow: true, optional: true, cr: 0.6 });
  return ps;
}, 4000);
// 2. two short stretches of old wooden fence along field edges, following the terrain, one segment missing
const FENCE = [[-1, 0], [0, 0], [1, 0]];
const fence = (n) => (a) => {
  const gap = 1 + Math.floor(R() * (n - 2)), ps = [];
  for (let k = 0; k < n; k++) {
    if (k === gap) continue;
    const [ox, oy] = rot(a.yaw, k * 2.04, span(-0.06, 0.06)), mesh = k === 0 || k === n - 1 ? 'Prop_WoodenFence_Single' : pick(['Prop_WoodenFence_Extension1', 'Prop_WoodenFence_Extension2']);
    ps.push({ mesh, x: a.x + ox, y: a.y + oy, yaw: a.yaw + span(-3, 3), pts: FENCE, r: 0.2, sink: 0.06, maxRange: 0.5, cr: 1.05 });
  }
  return ps;
};
vignette('fenceMeadow', () => { const u = span(55, 80); const [x, y] = at(u, span(13, 19)); return { x, y, yaw: roadYaw(u) + 180 + span(-6, 6) }; }, fence(6));
vignette('fenceField', () => { const u = span(140, 230), side = R() < 0.5 ? 1 : -1; const [x, y] = at(u, side * span(12, 20)); return { x, y, yaw: roadYaw(u) + span(-8, 8) }; }, fence(5));
// 3. ruins at the two dead relays
vignette('ruinBend', around(1262, 1033, 10, 16), ruin(2, 4, true));
vignette('ruinFord', around(992, 1079, 10, 17), ruin(2, 3, false));
// 4. a lone chimney on a brick foundation off the road (the house is gone)
vignette('chimney', () => { const u = span(200, 330), side = R() < 0.5 ? 1 : -1; const [x, y] = at(u, side * span(16, 28)); return { x, y, yaw: R() * 360 }; }, (a) => {
  const ps = [{ mesh: 'Prop_Chimney2', x: a.x, y: a.y, yaw: a.yaw, pts: [[-0.45, -0.45], [0.45, 0.45], [0.45, -0.45], [-0.45, 0.45]], r: 0.3, sink: 0.1, maxRange: 0.4, cr: 0.8 }];
  for (const [lx, ly] of [[2, 0.5], [2, -1.5]]) { const [ox, oy] = rot(a.yaw, lx, ly); ps.push({ mesh: 'Floor_UnevenBrick', x: a.x + ox, y: a.y + oy, yaw: a.yaw, pts: [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9], [0, 0]], r: 0.1, z: 'low', sink: 0, lift: 0.01, maxRange: 0.35, noShadow: true, optional: true, cr: 1.2 }); }
  for (const [lx, ly, dy] of [[2, 1.6, 0], [3.1, -0.5, 90], [0.9, -2.6, 0]]) { const [ox, oy] = rot(a.yaw, lx, ly); ps.push({ mesh: 'Wall_BottomCover', x: a.x + ox, y: a.y + oy, yaw: a.yaw + dy + span(-3, 3), pts: WALL, r: 0.3, z: 'mean', sink: 0.04, maxRange: 0.35, noShadow: true, optional: true, cr: 1 }); }
  for (let k = 0; k < 4; k++) ps.push(brick(a.x + 1, a.y, 1, 3.5));
  return ps;
});
fixVine();

const full = JSON.parse(text);
full.structures = full.structures.filter((s) => !idRe.test(s.id));
const last = full.structures.findLastIndex((s) => /^road[SLWN]\d+$/.test(s.id));
full.structures.splice(last + 1, 0, ...out.filter((s) => !/Prop_Vine/.test(s.mesh))); // OB-047 (owner): no hanging vines; kept in the stream so ids/RNG stay stable
const res = stringifyContent(full);
console.log(`${PREFIX}: ${out.length} props (seed ${SEED}; ground types path ${TYPE_PATH} water ${TYPE_WATER})\n` + log.join('\n'));
if (!dry) { fs.writeFileSync(FILE, res, 'utf8'); console.log('wrote', FILE, (res.length / 1024).toFixed(1) + ' KB'); }
