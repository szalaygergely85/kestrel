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

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rsRe = /^rs\d+$/, entRe = /^rsLamp\d+$/;
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

// 1. abandoned cart at Road West (south verge, trigger roadWest 1340,1048): wagon tipped off the road, spilled crates, a broken shaft
put('Prop_Wagon', 1347, 1058, 28, { ext: 1.4 });
put('Prop_Crate', 1344.2, 1055.6, 70, { ext: 0.5 }); put('Prop_Crate', 1351.5, 1059.8, 200, { ext: 0.5, scale: 0.8 });
log(1337, 1055, 100, 0.25, { ext: 1.1 });
put('Prop_Support', 1349, 1054.6, 155, { ext: 0.4, collide: false });
// 2. fallen fence line + open gate at the meadow's north edge (x 1394..1378): standing sections, a gate leaf swung open, rails in the grass
{ const Y = (x) => 1029.5 - (1394 - x) * 0.02;
  put('Prop_WoodenFence_Single', 1393, Y(1393), 358, { ext: 0.9 });
  put('Prop_WoodenFence_Extension1', 1391, Y(1391), 2, { ext: 0.9 });
  put('Prop_WoodenFence_Single', 1389, Y(1389), 90, { ext: 0.9 });                         // gate leaf swung open
  put('Prop_WoodenFence_Extension2', 1385.4, Y(1385.4) + 0.4, 12, { ext: 0.9, dz: -0.15 }); // sagging section
  put('Prop_WoodenFence_Single', 1382.5, Y(1382.5) + 0.7, 101, { ext: 0.9, dz: -0.35 });    // fallen rail
  put('Prop_WoodenFence_Extension1', 1379.5, Y(1379.5) - 0.2, 352, { ext: 0.9 }); }
// 3. dry well at the crossroads, north of the trade post: ring of stone blocks, half-covered with planks, one block fallen aside
{ const C = [994, 1051.5];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.3; put('Stairs_Exterior_Straight', C[0] + Math.cos(a) * 0.95, C[1] + Math.sin(a) * 0.95, a * 180 / Math.PI + 90, { scale: 0.5, ext: 0.5 }); }
  put('Floor_WoodDark_Half1', C[0] + 0.1, C[1], 20, { collide: false, noShadow: true, ext: 0.6, dz: 0.5, scale: 0.8, free: true });
  put('Stairs_Exterior_Straight', C[0] + 2.1, C[1] + 1.2, 40, { scale: 0.45, ext: 0.5 });
  put('Prop_Brick4', C[0] + 1.4, C[1] - 1.5, 80, { collide: false, ext: 0.2, free: true }); put('Prop_Brick1', C[0] - 1.6, C[1] + 1.4, 10, { collide: false, ext: 0.2, free: true }); }
// 4. crate stack beside the trade post + collapsed wayside shrine east of it
for (const [dx, dy, yw, dz] of [[0, 0, 5, 0], [1.1, 0.1, 340, 0], [0.5, 0.05, 22, 1.06]]) put('Prop_Crate', 1007 + dx, 1056.5 + dy, yw, { ext: 0.6, dz, scale: dz ? 0.9 : 1, free: !!dz });
{ const S = [1005, 1046];
  put('Wall_BottomCover', S[0], S[1], 8, { ext: 1.0, collide: false }); put('Wall_BottomCover', S[0] + 1.9, S[1] + 0.4, 190, { ext: 1.0, collide: false, free: true });
  put('Corner_Exterior_Brick', S[0] - 0.7, S[1] - 0.2, 90, { ext: 0.6, free: true }); put('Prop_Chimney2', S[0] + 1.2, S[1] - 1.1, 250, { ext: 0.6, free: true });
  [[0.6, 0.8], [1.3, 1.3], [-0.5, 1.0], [2.4, -0.4], [0.2, -1.2], [1.9, 1.7]].forEach(([dx, dy], i) => put(['Prop_Brick1', 'Prop_Brick2', 'Prop_Brick3', 'Prop_Brick4'][i % 4], S[0] + dx, S[1] + dy, i * 61, { collide: false, ext: 0.25, free: true })); }
// 5. woodpile + chopping block at Burl's home (north of the clearing, clear of his walk and the hint stone)
{ const P = [1461, 1016];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) log(P[0], P[1] + r * 0.16 + k * 0.32 - 0.5, 90, 0.25, { ext: 1.4, dz: r * 0.26, collide: false, noShadow: r > 0, free: !(r === 0 && k === 0) });
  put('Prop_Crate', P[0] + 2.4, P[1] + 0.9, 20, { scale: 0.5, ext: 0.5 });          // chopping block
  log(P[0] + 2.8, P[1] + 2.0, 35, 0.25, { ext: 0.5, collide: false });               // a split log beside it
  log(P[0] + 1.6, P[1] - 1.1, 160, 0.25, { ext: 0.5, collide: false }); }
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

if (process.env.DBG) out.forEach((s) => console.log(s.id, s.mesh, s.origin.x, s.origin.y));
if (bad.length) { console.error('PLACEMENT PROBLEMS:\n' + bad.join('\n')); if (!dry) process.exit(1); }
data.structures.push(...out); data.entities.push(...ents);
console.log(`roadside: ${out.length} meshes, ${ents.length} entities`);
if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
