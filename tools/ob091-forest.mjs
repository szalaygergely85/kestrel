// OB-091 (owner 2026-10-12): "why so many rocks and trees on the way down to the river ... make it a nice foresty place properly designed".
// Designer pass on the tower hill -> river/ford stretch of content/worlds/world_m1.world.json. Existing meshes only (owner rule).
// Rules (deterministic, re-runnable; decisions depend on fixed design geometry, not on random draws):
//  1 corridor: no tree / rock / pebble / bush / fern / mushroom within CLEAR (4 m) + mesh radius of any walked line (road recipe path,
//    route-walk legs 7b / 8 / 9 / 9c, Burl's follow / toBend / depart walks). Path paving (RockPath_*), grass and flowers stay.
//  2 stands: trees kept where a smooth value-noise "stand field" beats a slope-dependent threshold (denser on steep sides, sparser on the
//    flat meadow beside the road = clearings); kept trees closer than 7 m form a stand; stands of 1-2 trees on flat ground are removed;
//    stand-edge trees are scaled down (<= 0.78) and get a bush at their meadow side = the forest edge.
//  3 rocks: every loose rock / pebble is removed except deliberate keep spots: one boulder at each road bend, bank rocks by the river,
//    the rocks of the forestEdge zone (QL-B2 text), one mossy outcrop (densest rock group, ferns + clover at its foot) and a seat stone
//    at the view opening.
//  4 composed spots: a sunny glade with flowers (trees cleared in r 8, framed by the stands around it), a fallen-log spot (Roof_Log as
//    in the Rook ruin poi072, a small dead snag, mushrooms, ferns), a view opening toward the river (tree-free wedge from the road).
//  5 never adds within the keep-outs (ford, stones, water, relays, waystone, breach, emberpods, bears, every entity) or near the route.
// Cap trees (red-cap pickups cap1..5 stand at their feet) are never removed. Untouched rows keep their ids; removed rows are deleted;
// added rows are ob91-### (a hyphen: an id ending _<n> counts as an editor-minted id and would trip the world's nextId check) (removed and rebuilt on every run). Spot centres + the "before" snapshot are frozen in
// tools/ob091-forest.spots.json on the first run so later runs reproduce the same design.
// Writes the preview data design/preview/ob091-forest.data.js (design/preview/ob091-forest.html draws before/after as dots).
// Usage (repo root): node tools/ob091-forest.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import { MEADOW } from './gen-meadow-meshes.mjs';
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
import { meshClass } from './editor/meshPlace.js';
void [paletteMod, detailPassMod, terrainDef, lanternMod, leverMod, voxelPropsMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, farTowerMod, ferrumLightsMod, titleMod, voxelWorldMod];

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', SPOTS = 'tools/ob091-forest.spots.json', DATA = 'design/preview/ob091-forest.data.js';
const SCATTER_RE = /^(road[A-Z]\d+|mdw\d+)$/, ADD_RE = /^ob91[-_]\d+$/;
const CLEAR = 4;
const inMeadow = (x, y) => x >= MEADOW.x0 && x <= MEADOW.x1 && y >= MEADOW.y0 && y <= MEADOW.y1;

// ---- geometry -------------------------------------------------------------------------------------------------------------------
const text = fs.readFileSync(FILE, 'utf8');
const full = JSON.parse(text);
const ent = (id) => full.entities.find((e) => e.id === id);
const bear = ent('bear').components.walks;
const ROAD = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]];   // overworld_far recipe path
const WALKS = [ROAD,
  [[1485.5, 1025.5], [1470, 1029], [1428, 1040]],                                   // route-walk 7b breach -> terrain-near -> waystone
  [[1428, 1040], [1420, 1032], [1350, 1050], [1270, 1042], [1263, 1034]],           // leg 8 waystone -> bend relay
  [[1263, 1034], [1180, 1062], [1090, 1070], [1046, 1069]],                         // leg 9 bend -> ford
  [[1046, 1069], [1090, 1070], [1180, 1062], [1260, 1045], [1310, 1048]],           // leg 9c back
  bear.follow, bear.toBend, bear.depart];                                           // Burl's walks (leg 8b + quest walks)
const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)); return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
const lineDist = (x, y, P) => { let m = Infinity; for (let i = 0; i < P.length - 1; i++) m = Math.min(m, segDist(x, y, P[i], P[i + 1])); return m; };
const corridor = (x, y) => Math.min(...WALKS.map((P) => lineDist(x, y, P)));
const roadD = (x, y) => lineDist(x, y, ROAD);
const nearestRoadPt = (x, y) => { let best = null; for (let i = 0; i < ROAD.length - 1; i++) { const a = ROAD[i], b = ROAD[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))), px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py); if (!best || d < best.d) best = { d, x: px, y: py }; } return best; };
const inStretch = (x, y) => x >= 1040 && x <= 1480 && roadD(x, y) <= 32;
const roadAt = (u) => { let acc = 0; for (let i = 0; i < ROAD.length - 1; i++) { const a = ROAD[i], b = ROAD[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (u <= acc + L) { const t = (u - acc) / L, dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L; return { x: a[0] + dx * (u - acc), y: a[1] + dy * (u - acc), nx: dy, ny: -dx, t }; } acc += L; } return null; };

// keep-outs for ADDED rows (never placed here)
const KEEP_OUT = [
  { x: 1428, y: 1040, r: 6 }, { x: 1478, y: 1025, r: 6 }, { x: 1262, y: 1033, r: 8 }, { x: 992, y: 1079, r: 8 },
  { x: 1028, y: 1068, r: 18 },                                                       // ford + stepping stones + both banks
  { x: 1043, y: 1058, r: 6 },                                                        // jetty
  ...['emberpod1', 'emberpod2', 'emberpod3'].map((id) => ({ x: ent(id).x, y: ent(id).y, r: 6 })),
  ...['blackBear1', 'blackBear2', 'blackBear3'].map((id) => ({ x: ent(id).x, y: ent(id).y, r: 20 })),
  ...full.entities.filter((e) => typeof e.x === 'number').map((e) => ({ x: e.x, y: e.y, r: 4 })),
  ...full.entities.filter((e) => e.components?.brain?.home).map((e) => ({ x: e.components.brain.home[0], y: e.components.brain.home[1], r: 4 })),
  ...full.triggers.filter((t) => t.shape === 'circle' && ['woodpile', 'fenceGap', 'riverBank', 'northLook', 'well', 'shrine', 'jetty'].includes(t.id)).map((t) => ({ x: t.x, y: t.y, r: t.r }))];
const CAPS = full.entities.filter((e) => /^cap\d+$/.test(e.id));
const isCapTree = (s) => CAPS.some((c) => Math.hypot(c.x - s.origin.x, c.y - s.origin.y) < 3);

// stand field: smooth value noise (deterministic)
const hash = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const vnoise = (x, y, s) => { const fx = x / s, fy = y / s, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v); const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1); return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv; };
const field = (x, y) => 0.65 * vnoise(x, y, 26) + 0.35 * vnoise(x + 311, y - 97, 11);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- world (terrain heights, river test, mesh bboxes) ---------------------------------------------------------------------------
const { assets } = await loadTestAssets();
const world = World.load(JSON.parse(text), assets, { physics: 'mesh' });
const G = (x, y) => { world.ensureBandFor(x, y); return world.terrain.groundAt(x, y); };
const GT = (x, y) => { world.ensureBandFor(x, y); return world.terrain.groundTypeAt(x, y); };
const slope = (x, y) => { const e = 2; return Math.hypot(G(x + e, y) - G(x - e, y), G(x, y + e) - G(x, y - e)) / (2 * e); };
const wet = (x, y) => { const o = {}; return [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => world.riverAt(x + dx, y + dy, o)); };
const bboxOf = (key) => { try { return assets.mesh(key).bbox; } catch { return null; } };
const has = (key) => !!bboxOf(key);
const extOf = (key, scale = 1) => { const b = bboxOf(key); return b ? 0.5 * Math.max(b[3] - b[0], b[4] - b[1]) * scale : 0.5; };

const cls = (key) => { const n = key.split('/').pop();
  if (/^DeadTree/.test(n)) return 'deadtree';
  if (/^Pine_[1-5]/.test(n) || /Tree/.test(n)) return 'tree';
  if (/^Bush_/.test(n)) return 'bush';
  if (/^(Fern_|Plant_)/.test(n)) return 'fern';
  if (/^(Flower_|Clover_)/.test(n)) return 'flower';
  if (/^Roof_Log/.test(n)) return 'log';
  return meshClass(key); };   // rock | rockpath | pebble | grass | mushroom | other (shelf fungus)
const isTree = (c) => c === 'tree' || c === 'deadtree';
const isRock = (c) => c === 'rock' || c === 'pebble';
const radius = (s) => (isTree(cls(s.mesh)) ? 0.45 : 0.65) * extOf(s.mesh, s.scale || 1);
const group = (c) => (isTree(c) ? 'trees' : isRock(c) ? 'rocks' : c === 'bush' || c === 'fern' ? 'bushes' : c === 'flower' ? 'flowers' : c === 'log' ? 'logs' : 'other');

// ---- frozen spots + before snapshot -----------------------------------------------------------------------------------------------
const base = full.structures.filter((s) => !ADD_RE.test(s.id));
const scatter = (arr) => arr.filter((s) => s.mesh && SCATTER_RE.test(s.id) && inStretch(s.origin.x, s.origin.y));
let frozen = fs.existsSync(SPOTS) ? JSON.parse(fs.readFileSync(SPOTS, 'utf8')) : null;
if (!frozen) {
  const sc = scatter(base), trees = sc.filter((s) => isTree(cls(s.mesh))), rocks = sc.filter((s) => cls(s.mesh) === 'rock');
  const far = (x, y, r) => KEEP_OUT.every((k) => Math.hypot(k.x - x, k.y - y) >= k.r + r);
  const ringTrees = (x, y, r0, r1) => trees.filter((t) => { const d = Math.hypot(t.origin.x - x, t.origin.y - y); return d >= r0 && d <= r1; }).length;
  const search = (xMin, xMax, vs, test, score) => { let best = null;
    for (let u = 0; u < 520; u += 2) { const p = roadAt(u); if (!p || p.x < xMin || p.x > xMax) continue;
      for (const v of vs) { const x = +(p.x + p.nx * v).toFixed(1), y = +(p.y + p.ny * v).toFixed(1); if (!test(x, y)) continue; const sc = score(x, y); if (!best || sc < best.sc) best = { x, y, sc }; } }
    return best && { x: best.x, y: best.y }; };
  const grassy = (x, y, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => GT(x + dx, y + dy) === 0) && !wet(x, y);
  const glade = search(1290, 1415, [-19, -16, -13, -10, 10, 13, 16, 19], (x, y) => corridor(x, y) >= 9 && far(x, y, 8) && grassy(x, y, 5) && slope(x, y) < 0.12,
    (x, y) => slope(x, y) * 10 - 0.05 * Math.min(ringTrees(x, y, 8, 16), 12));
  const log = search(1095, 1245, [-12, -10, -8, 8, 10, 12], (x, y) => corridor(x, y) >= 7 && far(x, y, 4) && grassy(x, y, 3) && slope(x, y) < 0.15 && (!glade || Math.hypot(glade.x - x, glade.y - y) > 40),
    (x, y) => slope(x, y) * 10 - 0.05 * Math.min(ringTrees(x, y, 5, 12), 10));
  let outcrop = null;
  for (const r of rocks.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) { const { x, y } = r.origin, d = roadD(x, y);
    if (x < 1100 || x > 1460 || d < 7 || d > 28) continue;
    if ([glade, log].some((p) => p && Math.hypot(p.x - x, p.y - y) < 25)) continue;
    const n = rocks.filter((q) => Math.hypot(q.origin.x - x, q.origin.y - y) <= 6).length;
    if (!outcrop || n > outcrop.n) outcrop = { x, y, n }; }
  const view = { x: 1125, y: 1066.9, tx: 1034, ty: 1090, halfDeg: 20, len: 75 };   // road at x 1125 -> down toward the river south of the ford
  frozen = { note: 'OB-091 frozen design spots + the before snapshot (tools/ob091-forest.mjs). Delete this file only to re-pick the spots.',
    spots: { glade, log, outcrop: outcrop && { x: outcrop.x, y: outcrop.y }, view },
    before: sc.map((s) => [s.origin.x, s.origin.y, cls(s.mesh)]) };
  if (!dry) fs.writeFileSync(SPOTS, JSON.stringify(frozen, null, 1) + '\n', 'utf8');
}
const { glade, log, outcrop, view } = frozen.spots;
const inView = (x, y) => { const dx = x - view.x, dy = y - view.y, d = Math.hypot(dx, dy); if (d < 4 || d > view.len) return false;
  const ax = view.tx - view.x, ay = view.ty - view.y, cos = (dx * ax + dy * ay) / (d * Math.hypot(ax, ay)); return cos >= Math.cos(view.halfDeg * Math.PI / 180); };
const near = (p, x, y, r) => p && Math.hypot(p.x - x, p.y - y) <= r;

// ---- decisions -------------------------------------------------------------------------------------------------------------------
const sc = scatter(base), why = new Map(), edge = new Set();
const remove = (s, w) => { if (!why.has(s.id)) why.set(s.id, w); };
// rock keep spots
const KEEP_SPOTS = [
  ...ROAD.slice(1, 6).map(([x, y]) => ({ x, y, r: 14, n: 1, rocksOnly: true, tag: 'bend' })),
  { x: 1056, y: 1070, r: 14, n: 4, minX: 1047, tag: 'bank' },
  { x: 1190, y: 1044, r: 9, n: 3, tag: 'forestEdge' },
  ...(outcrop ? [{ x: outcrop.x, y: outcrop.y, r: 6, n: 5, tag: 'outcrop' }] : []),
  { x: view.x, y: view.y, r: 8, n: 1, rocksOnly: true, tag: 'view' }];
const keepRock = new Set();
for (const k of KEEP_SPOTS) {
  const c = sc.filter((s) => { const c0 = cls(s.mesh), { x, y } = s.origin; return isRock(c0) && (!k.rocksOnly || c0 === 'rock') && !keepRock.has(s.id) && Math.hypot(x - k.x, y - k.y) <= k.r
    && corridor(x, y) >= CLEAR + radius(s) && (!k.minX || x >= k.minX) && !wet(x, y); })
    .sort((a, b) => Math.hypot(a.origin.x - k.x, a.origin.y - k.y) - Math.hypot(b.origin.x - k.x, b.origin.y - k.y) || (a.id < b.id ? -1 : 1));
  c.slice(0, k.n).forEach((s) => keepRock.add(s.id)); }
for (const s of sc.slice().sort((a, b) => a.origin.x - b.origin.x)) {
  const c = cls(s.mesh), { x, y } = s.origin, d = corridor(x, y), r = radius(s);
  if (c === 'rockpath' || c === 'grass' || c === 'other' || c === 'log') continue;
  if (isTree(c) && isCapTree(s)) continue;
  if (c === 'flower') { if (d < 1.5) remove(s, 'corridor'); continue; }
  if (d < CLEAR + r) { remove(s, 'corridor'); continue; }
  if (isRock(c)) { if (!keepRock.has(s.id) && !inMeadow(x, y)) remove(s, 'rock'); continue; }   // meadow-clear: the meadow keeps its rocks + pebbles
  if (isTree(c)) {
    if (near(glade, x, y, 8)) { remove(s, 'glade'); continue; }
    if (near(log, x, y, 3.5)) { remove(s, 'log'); continue; }
    if (inView(x, y)) { remove(s, 'view'); continue; }
    const sl = slope(x, y), f = field(x, y);
    let thr = 0.50 - 0.28 * Math.min(1, sl / 0.4);
    if (roadD(x, y) < 12 && sl < 0.15) thr += 0.12;            // meadow beside the road: wood set back
    if (f <= thr) { remove(s, 'clearing'); continue; }
    if (f <= thr + 0.08) edge.add(s.id);
    continue; }
  if ((c === 'bush' || c === 'fern') && near(glade, x, y, 5)) { remove(s, 'glade'); continue; }
}
// stands: kept trees linked within 7 m; flat stands of 1-2 trees go (cap trees + steep singles stay)
{ const kept = sc.filter((s) => isTree(cls(s.mesh)) && !why.has(s.id)), parent = kept.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) if (Math.hypot(kept[i].origin.x - kept[j].origin.x, kept[i].origin.y - kept[j].origin.y) < 7) parent[find(i)] = find(j);
  const size = {}; kept.forEach((_, i) => { size[find(i)] = (size[find(i)] || 0) + 1; });
  kept.forEach((s, i) => { if (size[find(i)] < 3 && !isCapTree(s) && slope(s.origin.x, s.origin.y) <= 0.35) { remove(s, 'lone'); edge.delete(s.id); } }); }
// shelf fungus floats once its tree is gone
const keptTrees = base.filter((s) => s.mesh && isTree(cls(s.mesh)) && !why.has(s.id));
for (const s of sc) if (/Mushroom_Laetiporus/.test(s.mesh) && !keptTrees.some((t) => Math.hypot(t.origin.x - s.origin.x, t.origin.y - s.origin.y) < 1.5)) remove(s, 'fungus');

// ---- additions -------------------------------------------------------------------------------------------------------------------
const after = base.filter((s) => !why.has(s.id));
const occ = after.filter((s) => s.mesh && Math.abs(s.origin.x - 1260) < 260).map((s) => ({ x: s.origin.x, y: s.origin.y, r: radius(s) }));
const added = [];
const okAdd = (x, y, r, minD) => corridor(x, y) >= minD + r && !wet(x, y) && GT(x, y) === 0 && slope(x, y) < 0.5
  && KEEP_OUT.every((k) => Math.hypot(k.x - x, k.y - y) >= k.r + r) && occ.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + r + 0.2);
const footZ = (x, y, e, mode) => { const zs = [G(x, y), G(x + e, y), G(x - e, y), G(x, y + e), G(x, y - e)]; return mode === 'min' ? Math.min(...zs) : Math.max(...zs); };
function add(name, x, y, { scale, yawDeg = 0, minD = 2, lift = 0, zMode = 'max', shadow = false, collide } = {}) {
  const key = 'quaternius/' + name; if (!has(key)) return null;
  const id = 'ob91-' + String(added.length).padStart(3, '0');
  const sc0 = scale ?? (PLANT_SCALE[name] ? plantScaleFor(name, id) : 1), ext = extOf(key, sc0), r = (/Tree/.test(name) ? 0.45 : 0.65) * ext;
  if (!okAdd(x, y, r, minD)) return null;
  const st = { id, mesh: key, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(footZ(x, y, ext * 0.5, zMode) + lift).toFixed(2) }, yawDeg: ((Math.round(yawDeg) % 360) + 360) % 360 };
  if (sc0 !== 1) st.scale = +sc0.toFixed(2);
  if (!shadow) st.castShadow = false;
  if (collide === false) st.collide = false;
  added.push(st); occ.push({ x: st.origin.x, y: st.origin.y, r }); return st; }
const R = rng(20261012);
// 1 sunny glade: flower drifts inside r 6, flowering bushes at the rim
if (glade) {
  const FL = ['Flower_3_Group', 'Flower_4_Group', 'Flower_3_Group', 'Clover_1', 'Flower_4_Single', 'Flower_3_Single', 'Clover_2', 'Flower_4_Group'];
  for (let k = 0, n = 0; k < 60 && n < 14; k++) { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 6; if (add(FL[k % FL.length], glade.x + Math.cos(a) * d, glade.y + Math.sin(a) * d, { yawDeg: R() * 360 })) n++; }
  for (let k = 0, n = 0; k < 20 && n < 3; k++) { const a = R() * Math.PI * 2, d = 6.5 + R() * 1.5; if (add('Bush_Common_Flowers', glade.x + Math.cos(a) * d, glade.y + Math.sin(a) * d, { yawDeg: R() * 360 })) n++; } }
// 2 fallen-log spot: Roof_Log lying along the slope contour (least height spread), a small dead snag, mushrooms, ferns
if (log && has('quaternius/Roof_Log')) {
  const b = bboxOf('quaternius/Roof_Log'), s = 0.58, hx = 0.5 * (b[3] - b[0]) * s, hy = 0.5 * (b[4] - b[1]) * s;
  let best = null;
  for (let yaw = 0; yaw < 180; yaw += 10) { let worst = 0;
    for (const sg of [1, -1]) { const a = sg * yaw * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), zs = [[hx, 0], [-hx, 0], [0, hy], [0, -hy], [0, 0]].map(([px, py]) => G(log.x + px * ca - py * sa, log.y + px * sa + py * ca)); worst = Math.max(worst, Math.max(...zs) - Math.min(...zs)); }
    if (!best || worst < best.worst) best = { yaw, worst }; }
  add('Roof_Log', log.x, log.y, { scale: s, yawDeg: best.yaw, minD: 6, lift: -0.04, zMode: 'min', shadow: true });
  add('DeadTree_3', log.x + 2.6, log.y - 1.2, { scale: 0.5, yawDeg: 210, minD: 6, lift: 0.1, shadow: true });
  for (const [dx, dy, sc1] of [[1.2, 0.9, 0.42], [-1.4, 0.8, 0.36], [-0.8, -1.1, 0.4], [2.2, 0.2, 0.34]]) add('Mushroom_Common', log.x + dx, log.y + dy, { scale: sc1, yawDeg: R() * 360, minD: 5 });
  for (const [dx, dy] of [[-2.4, -0.6], [0.6, 2.1]]) add('Fern_1', log.x + dx, log.y + dy, { yawDeg: R() * 360, minD: 5 }); }
// 3 mossy outcrop: ferns + clover at the foot of the kept outcrop rocks
if (outcrop) for (let k = 0, n = 0; k < 24 && n < 5; k++) { const a = R() * Math.PI * 2, d = 1.4 + R() * 2.4; if (add(k % 2 ? 'Clover_1' : 'Fern_1', outcrop.x + Math.cos(a) * d, outcrop.y + Math.sin(a) * d, { yawDeg: R() * 360, minD: 4 })) n++; }
// 4 forest edge: stand-edge trees shrink, a bush on their road side
const byId = new Map(full.structures.map((s) => [s.id, s]));
let edgeBushes = 0;
for (const id of [...edge].sort()) { const s = byId.get(id); if (!s || why.has(id)) continue;
  s.scale = +Math.min(s.scale ?? 1, 0.78).toFixed(2);
  const p = nearestRoadPt(s.origin.x, s.origin.y); if (edgeBushes >= 28 || p.d > 25) continue;
  const ux = (p.x - s.origin.x) / p.d, uy = (p.y - s.origin.y) / p.d;
  if (add('Bush_Common', s.origin.x + ux * 2.2, s.origin.y + uy * 2.2, { yawDeg: R() * 360, minD: CLEAR })) edgeBushes++; }

// ---- write -----------------------------------------------------------------------------------------------------------------------
full.structures = full.structures.filter((s) => !ADD_RE.test(s.id) && !why.has(s.id));
const last = full.structures.findLastIndex((s) => SCATTER_RE.test(s.id));
full.structures.splice(last + 1, 0, ...added);
const count = (rows) => { const o = { trees: 0, rocks: 0, bushes: 0, flowers: 0, logs: 0, other: 0 }; for (const r of rows) o[group(r[2])]++; return o; };
const afterRows = [...scatter(full.structures), ...added.filter((s) => inStretch(s.origin.x, s.origin.y))].map((s) => [s.origin.x, s.origin.y, cls(s.mesh), ADD_RE.test(s.id) ? 1 : 0]);
const cb = count(frozen.before), ca = count(afterRows), reasons = {}; for (const w of why.values()) reasons[w] = (reasons[w] || 0) + 1;
const blocked = afterRows.filter(([x, y, c]) => (isTree(c) || isRock(c)) && corridor(x, y) < CLEAR && !CAPS.some((q) => Math.hypot(q.x - x, q.y - y) < 3));
console.log('OB-091 stretch (x 1040..1480, <= 32 m from the road) before', JSON.stringify(cb), '\nafter ', JSON.stringify(ca));
console.log('removed', why.size, JSON.stringify(reasons), '| added', added.length, '| edge trees scaled', edge.size, '| kept rocks', keepRock.size, '| spots', JSON.stringify(frozen.spots));
console.log(`rocks -${(100 * (1 - ca.rocks / Math.max(1, cb.rocks))).toFixed(0)} % (target >= 60 %)`, ca.rocks <= 0.4 * cb.rocks ? 'OK' : 'WARN');
console.log('trees/rocks inside the 4 m corridor (excl. cap trees):', blocked.length, blocked.length ? JSON.stringify(blocked.slice(0, 5)) : '');
const data = { item: 'OB-091', walks: WALKS, road: ROAD, clear: CLEAR, spots: frozen.spots, keepSpots: KEEP_SPOTS.map(({ x, y, r, tag }) => ({ x, y, r, tag })), caps: CAPS.map((c) => [c.x, c.y]),
  keepOut: KEEP_OUT.filter((k) => k.x >= 1020 && k.x <= 1500 && k.y >= 980 && k.y <= 1120 && k.r >= 6), before: frozen.before, after: afterRows, counts: { before: cb, after: ca }, removed: reasons };
if (!dry) {
  fs.writeFileSync(FILE, stringifyContent(full), 'utf8');
  fs.writeFileSync(DATA, '// generated by tools/ob091-forest.mjs (OB-091) - do not edit\nwindow.OB091 = ' + JSON.stringify(data) + ';\n', 'utf8');
  console.log('wrote', FILE, DATA, fs.existsSync(SPOTS) ? SPOTS : '');
}
