// M4 "lived-in" dressing (owner: "use the assets I added"): 8 small, story-fitting vignettes on THIS side of the river (tower -> meadow ->
// Road West -> Bend relay -> ford -> crossroads), all from Quaternius Medieval Village pieces that are already imported (no new designs):
// an abandoned cart (Road West), a fallen fence line + open gate (meadow edge), a dry well (crossroads), crates + a collapsed wayside shrine
// (trade post), a woodpile + chopping block (Burl's home), brass lamps on crates (the Bend), a rotten jetty (ford bank), rocks + fallen logs (forest edge).
// Writes the "rs###" structures and the "rsLamp#" entities of content/worlds/world_m1.world.json; re-runnable, replaces only those rows.
// Fixed anchors, ground-snapped with the geography installed (like gen-poi-props.mjs); every piece is checked: pathDist >= 3 m (+ footprint),
// no water, >= 2 m off the route-walk lines, clear of existing solid structures. Solid pieces keep the collider from their mesh json.
// Usage: node tools/gen-roadside.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { plantScaleFor, treeScaleFor } from './plant-scale.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rsRe = /^rs\d+$/, entRe = /^(rsLamp\d+|rsInspect[A-Z]\w*)$/;
data.structures = data.structures.filter((s) => !rsRe.test(s.id));
data.entities = data.entities.filter((e) => !entRe.test(e.id));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain, pathDist = globalThis.ASSETS.levels.overworld_far.util.pathDist;
const WATER = T.groundTypeAt(1028, 1068);
const LINES = [[[1485.5, 1025.5], [1470, 1029], [1428, 1040]], [[1420, 1032], [1350, 1050], [1270, 1042], [1263, 1034]],
  [[1260, 1045], [1180, 1062], [1090, 1070], [1046, 1069], [1010, 1070], [993, 1077]], [[1310, 1048], [1260, 1045]],
  [[1471, 1029.1], [1462, 1031], [1452, 1034], [1443, 1037], [1436, 1040], [1431.5, 1041.5], [1426, 1034], [1418, 1026], [1410, 1018], [1404, 1010]],
  [[1008, 1075], [950, 1075]]];
const segD = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); };
const lineD = (x, y) => Math.min(...LINES.map((l) => Math.min(...l.slice(1).map((p, i) => segD(x, y, l[i], p)))));
const plantRe = /Grass|Fern|Flower|Clover|Petal|Mushroom|Pebble|Plant_|Bush/;
const existing = data.structures.filter((s) => s.mesh && !plantRe.test(s.mesh));
const low = (x, y, e) => { let m = 1e9; for (const [dx, dy] of [[0, 0], [e, 0], [-e, 0], [0, e], [0, -e]]) m = Math.min(m, T.groundAt(x + dx, y + dy)); return m; };
const out = [], ents = [], bad = [];
function check(id, x, y, ext) {
  world.ensureBandFor(x, y);
  for (const [dx, dy] of [[0, 0], [ext, 0], [-ext, 0], [0, ext], [0, -ext], [ext, ext], [-ext, -ext]]) {
    if (T.groundTypeAt(x + dx, y + dy) === WATER) bad.push(`${id} water @${x.toFixed(1)},${y.toFixed(1)}`);
    if (pathDist(x + dx, y + dy) < 3) bad.push(`${id} road pathDist ${pathDist(x + dx, y + dy).toFixed(1)} @${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (lineD(x, y) < 2) bad.push(`${id} walk line ${lineD(x, y).toFixed(1)} @${x.toFixed(1)},${y.toFixed(1)}`);
  for (const s of existing) { const d = Math.hypot(s.origin.x - x, s.origin.y - y); if (d < ext + (/Tree|Pine/.test(s.mesh) ? 1.4 : 0.8)) bad.push(`${id} overlaps ${s.id} (${s.mesh}) d=${d.toFixed(1)}`); }
}
// o.ext footprint half size; o.scale; o.dz lift; o.zlift absolute offset of the origin; o.collide:false walk-over; o.free skips the checks (sub-pieces of a checked group)
function put(mesh, x, y, yaw, o = {}) {
  const id = 'rs' + String(out.length).padStart(3, '0'), ext = o.ext ?? 0.6;
  if (!o.free) check(id, x, y, ext);
  world.ensureBandFor(x, y);
  const st = { id, mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, ext) - 0.04 + (o.dz ?? 0) + (o.zlift ?? 0)).toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
// Roof_Log: ridge log, local y -5.35..5.35, thickness ~1.15, bottom at local z 3.85 -> lie it on the ground with a scale-aware z lift
const log = (x, y, yaw, s, o = {}) => put('Roof_Log', x, y, yaw, { scale: s, zlift: -3.85 * s + 0.05, ext: Math.max(0.3, 5.3 * s * 0.5), ...o });

// 1. abandoned cart at Road West (south verge, trigger roadWest 1340,1048): the real Prop_Wagon (no pitch/roll for meshes: the 'tipped' feel = yaw
// across the slope + one side sunk into the grass), spilled crates (0.65-0.9 m), a stack of two, a broken shaft timber
put('Prop_Wagon', 1347, 1058, 28, { ext: 1.4, dz: -0.28 });
put('Prop_Crate', 1344.2, 1055.4, 70, { ext: 0.5, scale: 0.8 }); put('Prop_Crate', 1351.8, 1059.9, 200, { ext: 0.5, scale: 0.65 });
put('Prop_Crate', 1350.9, 1055.2, 120, { ext: 0.5, scale: 0.75 }); put('Prop_Crate', 1350.9, 1055.2, 155, { ext: 0.5, scale: 0.6, dz: 0.8, free: true });
log(1337, 1055, 100, 0.25, { ext: 1.1 });
put('Prop_Support', 1349, 1054.6, 155, { ext: 0.4, collide: false });
// 2. fallen fence line + open gate at the meadow's north edge (x 1394..1378): three standing sections, a 2 m GAP, then two leaning/sagging
// sections (sunk on one side) and a rail down in the grass; the gate leaf stands swung open
{ const Y = (x) => 1029.5 - (1394 - x) * 0.02;
  put('Prop_WoodenFence_Single', 1393, Y(1393), 358, { ext: 0.9 });
  put('Prop_WoodenFence_Extension1', 1391, Y(1391), 2, { ext: 0.9 });
  put('Prop_WoodenFence_Single', 1389, Y(1389), 90, { ext: 0.9 });                         // gate leaf swung open
  // gap from 1387.4 to 1386 (a missing section)
  put('Prop_WoodenFence_Extension2', 1384.4, Y(1384.4) + 0.3, 14, { ext: 0.9, dz: -0.3 });  // leaning section
  put('Prop_WoodenFence_Single', 1381.9, Y(1381.9) + 0.55, 24, { ext: 0.9, dz: -0.38 });    // leaning the other way, nearly down
  put('Prop_WoodenFence_Single', 1386.8, Y(1386.8) + 1.6, 101, { ext: 0.9, dz: -0.2, collide: false }); // the missing rail, in the grass
  put('Prop_WoodenFence_Extension1', 1379.3, Y(1379.3) - 0.2, 352, { ext: 0.9 }); }
// 3. dry well at the crossroads, north of the trade post: ring of stone blocks, half-covered with planks, one block fallen aside
{ const C = [994, 1051.5];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.3; put('Stairs_Exterior_Straight', C[0] + Math.cos(a) * 0.95, C[1] + Math.sin(a) * 0.95, a * 180 / Math.PI + 90, { scale: 0.5, ext: 0.5 }); }
  put('Floor_WoodDark_Half1', C[0] + 0.1, C[1], 20, { collide: false, noShadow: true, ext: 0.6, dz: 0.5, scale: 0.8, free: true });
  put('Stairs_Exterior_Straight', C[0] + 2.1, C[1] + 1.2, 40, { scale: 0.45, ext: 0.5 });
  put('Prop_Brick4', C[0] + 1.4, C[1] - 1.5, 80, { collide: false, ext: 0.2, free: true }); put('Prop_Brick1', C[0] - 1.6, C[1] + 1.4, 10, { collide: false, ext: 0.2, free: true }); }
// 4. crate stack beside the trade post + collapsed wayside shrine east of it
for (const [dx, dy, yw, dz, sc] of [[0, 0, 5, 0, 0.9], [1.0, 0.1, 340, 0, 0.8], [0.45, 0.05, 22, 0.95, 0.7]]) put('Prop_Crate', 1007 + dx, 1056.5 + dy, yw, { ext: 0.6, dz, scale: sc, free: !!dz });
{ const S = [1005, 1046];
  put('Wall_BottomCover', S[0], S[1], 8, { ext: 1.0, collide: false }); put('Wall_BottomCover', S[0] + 1.9, S[1] + 0.4, 190, { ext: 1.0, collide: false, free: true });
  put('Corner_Exterior_Brick', S[0] - 0.7, S[1] - 0.2, 90, { ext: 0.6, free: true }); put('Prop_Chimney2', S[0] + 1.2, S[1] - 1.1, 250, { ext: 0.6, free: true });
  [[0.6, 0.8], [1.3, 1.3], [-0.5, 1.0], [2.4, -0.4], [0.2, -1.2], [1.9, 1.7]].forEach(([dx, dy], i) => put(['Prop_Brick1', 'Prop_Brick2', 'Prop_Brick3', 'Prop_Brick4'][i % 4], S[0] + dx, S[1] + dy, i * 61, { collide: false, ext: 0.25, free: true })); }
// 5. woodcutter's corner at Burl's home (north of the clearing, clear of his walk and the hint stone): split-wood crates (0.7-0.85 m) in a stack,
// two timbers (the shortest log the kit scales to is 2.7 m) laid across, a chopping block and a split log beside it
{ const P = [1461, 1016];
  put('Prop_Crate', P[0], P[1], 4, { scale: 0.85, ext: 0.7 }); put('Prop_Crate', P[0] + 0.95, P[1] + 0.1, 354, { scale: 0.8, ext: 0.7, free: true });
  put('Prop_Crate', P[0] + 0.45, P[1] + 0.05, 12, { scale: 0.7, ext: 0.5, dz: 0.8, free: true });
  log(P[0] + 0.5, P[1] + 1.1, 92, 0.25, { ext: 1.4, collide: false, free: true }); log(P[0] + 0.45, P[1] + 1.45, 88, 0.25, { ext: 1.4, collide: false, dz: 0.26, noShadow: true, free: true });
  put('Prop_Crate', P[0] + 2.9, P[1] + 1.0, 20, { scale: 0.5, ext: 0.5 });          // chopping block
  log(P[0] + 3.3, P[1] + 2.2, 35, 0.25, { ext: 0.5, collide: false });               // a split log beside it
  log(P[0] + 1.6, P[1] - 1.5, 160, 0.25, { ext: 0.5, collide: false }); }
// 6. brass lamps on crate posts along the Bend (south verge); static floorLantern sprite on top, no light (one light per lamp is too dear)
[[1280, 1052], [1246, 1053.5]].forEach(([x, y], i) => {
  const st = put('Prop_Crate', x, y, 15 + i * 40, { scale: 0.5, ext: 0.4 });
  ents.push({ id: 'rsLamp' + (i + 1), type: 'prop', x, y, z: +(st.origin.z + 0.53 + 0.04).toFixed(2), components: { voxel: { anim: 'lit', loop: true, model: 'floorLantern' } }, note: 'M4 lived-in: brass lamp on a crate post at the Bend (gen-roadside.mjs, static, no light)' });
  put('Rock_Medium_3', x + 1.6, y + 0.9, i * 90, { ext: 0.9 });
});
// 7. rotten jetty at the ford's east bank: broken planks running to the water's edge, two mooring bricks, a stuck log
{ const J = [1038.2, 1056], yw = 90;
  [[0, 0.08, 0], [2.0, 0.04, 6], [4.0, 0, -9]].forEach(([dx, dz, wob], i) => put('Floor_WoodDark', J[0] + dx, J[1] + (wob ? 0.15 : 0), yw + wob, { collide: false, noShadow: true, ext: 1.0, dz: dz + 0.02, free: i > 0 }));
  put('Floor_WoodDark_Half1', J[0] + 5.6, J[1] - 1.4, 70, { collide: false, noShadow: true, ext: 0.8, free: true });
  put('Prop_Brick2', J[0] - 0.9, J[1] - 1.2, 20, { collide: false, ext: 0.25, free: true }); put('Prop_Brick3', J[0] - 0.9, J[1] + 1.2, 140, { collide: false, ext: 0.25, free: true });
  log(J[0] + 3.2, J[1] + 2.6, 80, 0.25, { ext: 0.9 }); }
// 8. rocks + fallen logs at the forest edge north of the road, between Bend and ford
{ const F = [1190, 1044];
  put('Rock_Medium_2', F[0], F[1], 30, { ext: 1.4 }); put('Rock_Medium_1', F[0] + 2.4, F[1] + 1.5, 200, { ext: 1.4 }); put('Rock_Medium_3', F[0] - 1.8, F[1] + 2.4, 120, { ext: 1.4 });
  log(F[0] + 1.0, F[1] + 5.0, 12, 0.34, { ext: 1.8 }); log(F[0] + 5.5, F[1] + 3.2, 160, 0.27, { ext: 1.5 });
  log(F[0] - 4.5, F[1] - 2.5, 78, 0.3, { ext: 1.6 }); }

// ---- 9. natural detail (density, not landmarks): seeded, every plant is walk-through (mesh json collide:false), no shadow; plants keep pathDist >= 1.6
// and 1 m off the route-walk lines, stay out of water and the tower footprint; trees/props keep pathDist >= 6 / 3. Skipped spots are counted.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261011);
const TOWERBOX = [1478, 1016, 1506, 1034];
const inTower = (x, y, m = 0) => x > TOWERBOX[0] - m && x < TOWERBOX[2] + m && y > TOWERBOX[1] - m && y < TOWERBOX[3] + m;
const wet = (x, y, r = 0.5) => { world.ensureBandFor(x, y); return [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => T.groundTypeAt(x + dx, y + dy) === WATER); };
const nearWater = (x, y, r) => { world.ensureBandFor(x, y); for (let k = 0; k < 8; k++) if (T.groundTypeAt(x + Math.cos(k * 0.785) * r, y + Math.sin(k * 0.785) * r) === WATER) return true; return false; };
const solids = existing.filter((s) => !/Rock_Medium/.test(s.mesh));
const clearOf = (x, y, r) => !solids.some((s) => Math.hypot(s.origin.x - x, s.origin.y - y) < r + (/Tree|Pine/.test(s.mesh) ? 0.7 : 0.6)) && !out.some((s) => /Wagon|Fence|Crate/.test(s.mesh) && Math.hypot(s.origin.x - x, s.origin.y - y) < r + 1.0);
let skipped = 0, plants = 0;
function plant(name, x, y, o = {}) {
  const id = 'rs' + String(out.length).padStart(3, '0');
  world.ensureBandFor(x, y);
  const pd = pathDist(x, y);
  if (pd < (o.pd ?? 1.6) || lineD(x, y) < 1 || wet(x, y, o.wet ?? 0.5) || inTower(x, y, 0.5) || !clearOf(x, y, o.r ?? 0.4)) { skipped++; return null; }
  const st = { id, mesh: 'quaternius/' + name, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, o.ext ?? 0.25) - (o.sink ?? 0.04)).toFixed(2) }, yawDeg: Math.floor(R() * 360), collide: false, castShadow: false };
  const sc = o.scale === 1 ? undefined : plantScaleFor(name, id); if (sc) st.scale = sc;
  out.push(st); plants++; return st;
}
// n placed of `names` at random points in the rect accepted by `filt`
function rect(names, n, [x0, y0, x1, y1], filt, o = {}) { let placed = 0; for (let tries = 0; placed < n && tries < n * 40; tries++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0); if (!filt(x, y)) continue; const nm = Array.isArray(names) ? names[Math.floor(R() * names.length)] : names; if (plant(nm, x, y, o)) placed++; } return placed; }
// a cluster of `kinds` [[name, count]] around (cx, cy), radius r0..r1
function cluster(cx, cy, r0, r1, kinds, o = {}) { for (const [nm, n] of kinds) for (let i = 0, k = 0; i < n && k < n * 12; k++) { const a = R() * 6.283, r = r0 + R() * (r1 - r0); if (plant(nm, cx + Math.cos(a) * r, cy + Math.sin(a) * r, o)) i++; } }
const verge = (lo, hi) => (x, y) => { const d = pathDist(x, y); return d >= lo && d <= hi; };
const ROADW = [1255, 1018, 1420, 1076], MEADOW = [1426, 1006, 1494, 1064], FORD = [1020, 1036, 1078, 1086];
// meadow: flower groups, flowering bushes, clover, pebbles
rect(['Flower_3_Group', 'Flower_3_Group', 'Flower_4_Group'], 14, MEADOW, () => true);
rect('Bush_Common_Flowers', 8, MEADOW, (x, y) => pathDist(x, y) > 2.5, { r: 0.9 });
rect(['Flower_3_Single', 'Flower_4_Single'], 14, MEADOW, () => true);
rect(['Clover_1', 'Clover_2'], 16, MEADOW, () => true);
rect(['Pebble_Round_1', 'Pebble_Square_2', 'Pebble_Round_4', 'Pebble_Square_5'], 10, MEADOW, () => true, { scale: 1 });
// Road West verge: flowers, flowering bushes, clover patches, pebbles, and RockPath stones along the road edge (1.6-2.5 m from the centre line)
rect(['Flower_3_Single', 'Flower_4_Single'], 16, ROADW, verge(1.7, 7));
rect(['Flower_3_Group', 'Flower_4_Group'], 8, ROADW, verge(2, 8));
rect('Bush_Common_Flowers', 7, ROADW, verge(3, 9), { r: 0.9 });
rect(['Clover_1', 'Clover_2'], 16, ROADW, verge(1.6, 5));
rect(['Plant_7_Big', 'Plant_1_Big'], 8, ROADW, verge(2, 8));
rect(['Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Square_1', 'Pebble_Square_3', 'Pebble_Round_5'], 20, ROADW, verge(1.6, 3.5), { scale: 1 });
rect(['RockPath_Round_Small_1', 'RockPath_Round_Small_3', 'RockPath_Square_Small_2', 'RockPath_Round_Thin'], 14, ROADW, verge(1.6, 2.5), { scale: 1, r: 0.5 });
// ford bank (east): pebbles + path stones near the waterline, plants behind
rect(['Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_4', 'Pebble_Square_6', 'Pebble_Round_5'], 16, FORD, (x, y) => nearWater(x, y, 2.5), { scale: 1 });
rect(['RockPath_Round_Small_2', 'RockPath_Square_Small_1', 'RockPath_Round_Wide', 'RockPath_Square_Thin'], 9, FORD, (x, y) => nearWater(x, y, 3), { scale: 1, r: 0.6, wet: 0.7 });
rect(['Plant_1_Big', 'Plant_7_Big', 'Fern_1'], 12, FORD, (x, y) => nearWater(x, y, 5) && pathDist(x, y) > 2);
rect(['Clover_1', 'Clover_2'], 6, FORD, (x, y) => pathDist(x, y) > 1.8);
// forest edges: ferns / big plants at the feet of the trees close to the walk (<= 22 m from the route lines), mushroom groups at some feet
{ const trees = data.structures.filter((s) => /Tree|Pine/.test(s.mesh) && s.origin.x > 1000 && lineD(s.origin.x, s.origin.y) < 22 && pathDist(s.origin.x, s.origin.y) > 2.5);
  let mush = 0, tn = 0;
  for (const t of trees) {
    if (R() > 0.32) continue; tn++;
    cluster(t.origin.x, t.origin.y, 1.3, 3.2, [['Fern_1', 1 + Math.floor(R() * 3)], [R() < 0.5 ? 'Plant_1_Big' : 'Plant_7_Big', 1]]);
    if (mush < 18 && R() < 0.26) { cluster(t.origin.x, t.origin.y, 0.9, 1.8, [['Mushroom_Common', 2]], { pd: 3 }); mush++; }
  }
  console.log('forest-edge clusters at', tn, 'of', trees.length, 'trees, mushroom groups', mush); }
// accents: one gnarled tree on the tower hill (highest clear ground north of the meadow), dead trees on the marsh side (by the ford water)
function accent(name, rectA, filt, wantHigh) {
  let best = null;
  for (let i = 0; i < 600; i++) {
    const x = rectA[0] + R() * (rectA[2] - rectA[0]), y = rectA[1] + R() * (rectA[3] - rectA[1]);
    if (!filt(x, y) || pathDist(x, y) < 6 || lineD(x, y) < 5 || wet(x, y, 1.5) || inTower(x, y, 4) || !clearOf(x, y, 3.5) || out.some((s) => /Tree/.test(s.mesh) && /^rs/.test(s.id) && Math.hypot(s.origin.x - x, s.origin.y - y) < 12)) continue;
    const sc = wantHigh ? T.groundAt(x, y) : R(); if (!best || sc > best.sc) best = { x, y, sc };
  }
  if (!best) { bad.push('accent ' + name + ' no spot'); return; }
  const id = 'rs' + String(out.length).padStart(3, '0');
  out.push({ id, mesh: 'quaternius/' + name, origin: { x: +best.x.toFixed(2), y: +best.y.toFixed(2), z: +(low(best.x, best.y, 0.5) - 0.04 + 0.2).toFixed(2) }, yawDeg: Math.floor(R() * 360), scale: Math.min(1.1, treeScaleFor(id)) });
}
accent('TwistedTree_2_LOD1', [1440, 1000, 1476, 1016], () => true, true);
accent('DeadTree_3', [1030, 1040, 1075, 1090], (x, y) => nearWater(x, y, 9), false);
accent('DeadTree_4', [1030, 1040, 1075, 1090], (x, y) => nearWater(x, y, 11), false);
// vines (Prop_Vine1/2/5: hang 2.1 m, ~1.5 m wide sheet in local x-z) on wall feet: tower outer wall (south + west face, off the breach), Rook's ruin north wall, the shrine pillar
{ const vine = (mesh, x, y, yaw, top = 2.1) => put(mesh, x, y, yaw, { ext: 0.3, dz: top, collide: false, noShadow: true, free: true });
  const wallBox = JSON.parse(fs.readFileSync('content/meshes/quaternius/Wall_UnevenBrick_Straight.mesh.json', 'utf8')).bbox;
  const TWR = { south: 1032.05, west: 1479.95 };                                    // outer faces of the tower walls (verified by the shot)
  [[1486, 'Prop_Vine1'], [1492.5, 'Prop_Vine5'], [1499, 'Prop_Vine2']].forEach(([x, m]) => vine(m, x, TWR.south + 0.2, 0));
  [[1020.8, 'Prop_Vine2'], [1030.5, 'Prop_Vine5']].forEach(([y, m]) => vine(m, TWR.west - 0.2, y, 90));
  const ext = 1055 + wallBox[1];                                                       // ruin north wall exterior face (yaw 0, inner face +y)
  [[-1.6, 'Prop_Vine5'], [2.3, 'Prop_Vine1']].forEach(([dx, m]) => vine(m, 975 + dx, ext - 0.04, 0, 2.2));
  vine('Prop_Vine2', 1004.4, 1046.1, 0, 2.55);                                         // shrine pillar (Corner_Exterior_Brick, 3 m)
  cluster(975, 1055, 2.0, 4.5, [['Fern_1', 5], ['Plant_1_Big', 2], ['Clover_1', 2], ['Mushroom_Common', 2]], { pd: 2.5 });   // ruin foot
  cluster(1006, 1047, 1.8, 4.2, [['Fern_1', 4], ['Plant_7_Big', 2], ['Clover_2', 3], ['Mushroom_Common', 2]], { pd: 2.5 });  // shrine
  cluster(1491, 1033.8, 0.5, 2.6, [['Fern_1', 3], ['Plant_1_Big', 1], ['Clover_1', 2]], { pd: 3 });                          // tower foot
}
console.log('natural detail:', plants, 'plants placed,', skipped, 'spots skipped');

if (process.env.DBG) out.forEach((s) => console.log(s.id, s.mesh, s.origin.x, s.origin.y));
if (bad.length) { console.error('PLACEMENT PROBLEMS:\n' + bad.join('\n')); if (!dry) process.exit(1); }
// QL-B2 follow-up: invisible inspect anchors on the four vignettes quests refer to (a quest can name one as an object giver / hand-in:
// errands.js turns any dialogue-less giver entity into a [E] Inspect interactable). Text keys are data only (no writer text yet).
for (const [id, x, y, what] of [['rsInspectWagon', 1347, 1058, 'abandoned cart'], ['rsInspectWell', 994, 1051.5, 'dry well'], ['rsInspectShrine', 1005, 1046, 'collapsed wayside shrine'], ['rsInspectWoodpile', 1461.4, 1016.2, "woodcutter's corner"]])
  ents.push({ id, type: 'prop', x, y, z: 'ground', components: { inspect: { text: 'inspect.' + id.slice(9).toLowerCase() } }, note: 'QL-B2 follow-up inspect anchor: ' + what + ' (gen-roadside.mjs)' });
data.structures.push(...out); data.entities.push(...ents);
console.log(`roadside: ${out.length} meshes, ${ents.length} entities`);
if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
