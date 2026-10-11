// MAP-21/22/24 (Stage 0-2 POI): existing-mesh dressing + anchors for the berry slope, the crossroads and the straw-man field.
// Writes the "poi###" structures, the entities post / notePost / target1..3 and the `crossroads` trigger into
// content/worlds/world_m1.world.json and the `crossroads` area into content/quests/areas.json. Fixed spots, ground-snapped (no RNG):
// re-runnable, replaces only poi### rows / those entity ids / that trigger. berry1..6 stay as the QL-05 pickups (the quest counts 6);
// each gets a Bush_Common under it (plantScaleFor jitter = +-20 %, D-064). Meshes only (owner rule: no new env designs), no voxel stones.
// Usage: node tools/gen-poi-props.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { plantScaleFor } from './plant-scale.mjs';
import { loadTestAssets } from './testing/content-node.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', AREAS = 'content/quests/areas.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const poiRe = /^poi\d+$/, ENT_IDS = ['post', 'notePost', 'target1', 'target2', 'target3', 'nest', 'rook', 'chestRook', 'chestMeadow', 'chestBend', 'chestCrossroads', 'chestHidden', 'hiddenScrawl', 'cap1', 'cap2', 'cap3', 'cap4', 'cap5', 'smoke1', 'smoke2', 'smoke3'];
data.structures = data.structures.filter((s) => !poiRe.test(s.id));
data.entities = data.entities.filter((e) => !ENT_IDS.includes(e.id));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain; world.ensureBandFor(1000, 1066);
const out = [];
const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
const WATER = T.groundTypeAt(1028, 1068);
const low = (x, y, e = 0.6) => Math.min(T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e));
// lowest ground of the footprint, slight sink; o.dz stacks on a lower piece; o.scale; o.collide:false; o.ext = footprint half size
function put(mesh, x, y, yaw, o = {}) {
  const st = { id: 'poi' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: o.z != null ? o.z : +(low(x, y, o.ext ?? 0.6) - 0.04 + (o.dz ?? 0)).toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
// ---- MAP-21 berry slope: a leafy bush under every sprig
for (const e of data.entities) if (/^berry\d$/.test(e.id)) {
  const id = 'poi' + String(out.length).padStart(3, '0');
  put('Bush_Common', e.x, e.y + 0.4, (e.x * 37 + e.y * 11) % 360, { scale: plantScaleFor('Bush_Common', id), collide: false, noShadow: true });
}
// ---- MAP-22 crossroads: plaza slabs, signpost, trade post (+ basket crate, inspect anchor `post`), footpath stones north
for (const [x, y] of [[989, 1059.5], [991, 1059.5], [989, 1061.5], [991, 1061.5]]) put('RockPath_Square_Wide', x, y, 0, { collide: false, noShadow: true, ext: 1.0 });
// signpost: crate base + an upright fence section as the board + a second board turned toward the footpath
const SIGN = [990, 1060.5];
put('Prop_Crate', SIGN[0], SIGN[1], 10, { scale: 0.5, ext: 0.3 });
put('Prop_WoodenFence_Single', SIGN[0], SIGN[1], 100, { dz: 0.53, scale: 0.55, ext: 0.3 });
put('Prop_WoodenFence_Single', SIGN[0], SIGN[1], 35, { dz: 0.9, scale: 0.45, ext: 0.3 });
// trade post (north verge of the road end): fence back, plank counter on two crates, a basket crate
const TP = [1000.5, 1060.5], TPY = 180;
for (const lx of [-1.1, 1.1]) { const [ox, oy] = rot(TPY, lx, -0.9); put('Prop_WoodenFence_Single', TP[0] + ox, TP[1] + oy, TPY, { ext: 0.4 }); }
for (const lx of [-0.8, 0.8]) { const [ox, oy] = rot(TPY, lx, 0.2); put('Prop_Crate', TP[0] + ox, TP[1] + oy, TPY, { ext: 0.4 }); }
{ const [ox, oy] = rot(TPY, 0, 0.2); put('Floor_WoodDark_Half1', TP[0] + ox, TP[1] + oy, TPY + 90, { dz: 1.07, collide: false, ext: 0.3 }); }
const [bx, by] = rot(TPY, 2.3, 0.3), basket = { x: TP[0] + bx, y: TP[1] + by };
put('Prop_Crate', basket.x, basket.y, 20, { scale: 0.8, ext: 0.4 });
// footpath north toward ws_outwall (905,940): flat round stones every ~3.5 m, alternating sides
{
  const A = [986, 1056], B = [905, 940], L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  let n = 0;
  for (let d = 0; d <= 70; d += 3.5, n++) {
    const side = (n % 2 ? 1 : -1) * 0.45, x = A[0] + ux * d - uy * side, y = A[1] + uy * d + ux * side;
    if (T.groundTypeAt(x, y) === WATER) continue;
    put(['RockPath_Round_Small_1', 'RockPath_Round_Small_2', 'RockPath_Round_Small_3'][n % 3], x, y, (n * 53) % 360, { collide: false, noShadow: true, ext: 0.4 });
  }
}
// ---- MAP-23 Rook's nest ruin (975,1058): broken house of Wall_Arch walls (3 m), rubble gaps, no door, half roof (north half),
// stair-block rubble steps up the east side to the roof deck; nest + boots-chest anchors on the roof. All solid (collide default true).
const RC = [975, 1058];
let base = 1e9; for (let dx = -3.5; dx <= 3.5; dx += 0.5) for (let dy = -3.5; dy <= 3.5; dy += 0.5) base = Math.min(base, T.groundAt(RC[0] + dx, RC[1] + dy));
const WALLH = 3, ROOFZ = +(base + WALLH).toFixed(2), DECK = +(ROOFZ + 1.09).toFixed(2); // roof piece collider is a box z -0.16..1.09: deck top = ROOFZ + 1.09
const wall = (x, y, yaw) => put('Wall_Arch', x, y, yaw, { ext: 1.0 });
const rubble = (x, y, yaw, i) => put(['Wall_BottomCover', 'Prop_Brick1', 'Prop_Brick2', 'Prop_Brick3', 'Prop_Brick4'][i % 5], x, y, yaw, { ext: 0.3 });
for (const dx of [-2, 0, 2]) wall(RC[0] + dx, RC[1] - 3, 0);                     // north wall: whole
for (const dy of [-2, 0]) wall(RC[0] - 3, RC[1] + dy, 90);                       // west wall: two segments, SW corner fallen
wall(RC[0] + 3, RC[1] + 2, 90);                                                  // east wall: south segment only; the NE is open (rubble steps come in there)
for (const dx of [-2, 2]) wall(RC[0] + dx, RC[1] + 3, 0);                        // south wall: two segments, gap between (no door)
[[-3, 2, 90], [3, 0, 90], [3, -2, 90], [0, 3, 0], [-3, 3.4, 20]].forEach(([dx, dy, yw], i) => put('Wall_BottomCover', RC[0] + dx, RC[1] + dy, yw, { ext: 1.0 }));
[[-1.5, 1.5], [0.8, 0.4], [-0.6, -0.9], [2.1, 1.7], [1.4, 2.4], [-2.2, 0.6]].forEach(([dx, dy], i) => rubble(RC[0] + dx, RC[1] + dy, i * 71, 1 + i));
// half roof (north half), absolute z so the three pieces stay level on the slope
for (const dx of [-2.3, 0, 2.3]) put('Roof_Wooden_2x1', RC[0] + dx, RC[1] - 1.4, 0, { z: ROOFZ, ext: 0.3 });
// rubble steps: a pile of 2 m stair-block columns running south from the west side of the roof (south of the road end, clear of the 9e line and of the world-bounds
// edge in the north), each top <= 0.7 m above the previous (jump apex 1.05 m, step-up 0.45), first top ~0.7 m over its ground, the last (against the roof box) exactly DECK.
const PX = RC[0] - 4.3, stepTops = [], stepYs = [];
{
  const Y = (n, i) => RC[1] - 2 + 2 * (n - 1 - i);
  const N = Math.max(2, Math.ceil((DECK - (low(PX, Y(7, 0), 1.0) + 0.7)) / 0.7) + 1);
  let top = low(PX, Y(N, 0), 1.0) + 0.7; const inc = (DECK - top) / (N - 1);
  for (let i = 0; i < N; i++, top += inc) {
    const y = Y(N, i), g = low(PX, y, 1.0) - 0.04, n = Math.max(1, Math.ceil(top - g - 0.05));
    for (let k = 0; k < n; k++) put('Stairs_Exterior_Straight', PX, y, k % 2 ? 180 : 0, { z: +(top - 1 - (n - 1 - k) * Math.max(0.5, Math.min(1, (top - 1 - g) / Math.max(1, n - 1)))).toFixed(2), ext: 1.0 });
    stepTops.push(+top.toFixed(2)); stepYs.push(+y.toFixed(1));
  }
}
{ rubble(PX - 2.1, stepYs[0] - 0.4, 30, 2); rubble(PX - 2.3, stepYs[2], 120, 3); rubble(PX + 2.2, stepYs[1], 75, 4); } // beside the pile, never on the approach line
const nestZ = +(DECK + 0.05).toFixed(2);
const ruinEnts = [
  { id: 'nest', type: 'prop', x: RC[0] - 1, y: RC[1] - 1.6, z: nestZ, note: 'MAP-23 Rook nest anchor on the ruin roof (QL-16 relay.mirror pickup; QL-D1 nest sprite pending). Roof deck z ' + DECK },
  { id: 'rook', type: 'npc', x: RC[0] - 0.1, y: RC[1] - 1.6, z: nestZ, yawDeg: 90, scale: 1.6, components: { collider: { h: 0.7, kinematic: true, r: 0.3 }, dialogue: 'rook', voxel: { anim: 'perch', loop: true, model: 'crow' } }, note: 'QL-06 Rook the talking crow (crow model x1.6) on the nest of the ruin roof; [E] Talk via the dialogue component' },
  { id: 'chestRook', type: 'prop', x: RC[0] + 1.6, y: RC[1] - 1.6, z: nestZ, note: 'MAP-23 chest anchor on the ruin roof (QL-16 River Boots chest; no chest content yet, chestHook defs [])' },
];
// ---- MAP-25 loot spots + red caps + smoke anchors. Anchors are bare props (QL-18/QL-17 wire the content); caps are Quaternius mushrooms.
const free = (x, y) => T.groundTypeAt(x, y) !== WATER && T.groundTypeAt(x + 1, y) !== WATER && T.groundTypeAt(x, y + 1) !== WATER;
const anchor = (id, x, y, note) => { world.ensureBandFor(x, y); ruinEnts.push({ id, type: 'prop', x, y, z: 'ground', note }); };
anchor('chestMeadow', 1384, 1062, 'MAP-25 heart-piece chest 1 (meadow grove, N of the road near fenceMeadow)');
anchor('chestBend', 1268, 1014, 'MAP-25 heart-piece chest 2 (Bend Relay ridge, ~20 m NNE of relayBend)');
{ // chest 3 on a 1 m stair-block platform behind the ford Wall_Arch ruin (989.57,1092.29)
  const px = 986.2, py = 1094.6; put('Stairs_Exterior_Straight', px, py, 0, { ext: 1.0 });
  ruinEnts.push({ id: 'chestCrossroads', type: 'prop', x: px, y: py, z: +(low(px, py, 1.0) - 0.04 + 1.0).toFixed(2), note: 'MAP-25 heart-piece chest 3 (crossroads ruin, on a 1 m stair-block platform behind the Wall_Arch)' });
}
{ const hx = 930, hy = 968; world.ensureBandFor(hx, hy); put('Rock_Medium_1', hx + 1.5, hy + 1.2, 40, { ext: 1.2 }); put('Rock_Medium_2', hx - 1.8, hy + 1.0, 200, { ext: 1.2 });
  ruinEnts.push({ id: 'hiddenScrawl', type: 'prop', x: hx - 0.5, y: hy + 5, z: 'ground', components: { inspect: { text: 'scrawl.hiddenChest' } }, note: 'MAP-25 scrawl on the footpath north (text key scrawl.hiddenChest, writer QL-W1)' });
  anchor('chestHidden', hx, hy, 'MAP-25 hidden chest (Wayfarer Tunic): between two rocks, behind scrawl.hiddenChest (hiddenScrawl, 5 m south)'); }
{ let k = 0; const caps = ['Mushroom_Common', 'Mushroom_Laetiporus'];
  for (const [x, y] of [[1056, 1038], [1062, 1052], [1058, 1070], [1068, 1086], [1054, 1096]]) {
    world.ensureBandFor(x, y); let px = x; while (!free(px, y) && px < x + 30) px += 2;
    k++; put(caps[k % 2], px, y, k * 67, { collide: false, noShadow: true, ext: 0.3, scale: 2.2 });
    ruinEnts.push({ id: 'cap' + k, type: 'prop', x: +px.toFixed(1), y, z: 'ground', note: 'MAP-25 red-cap anchor ' + k + ' (east bank edge; QL-18 sq.rook.caps pickup)' });
  } }
[[958, 1004], [951, 1008], [962, 1000]].forEach(([x, y], i) => anchor('smoke' + (i + 1), x, y, 'MAP-25 smoke-column billboard anchor ' + (i + 1) + ' (far-only, north of northLook; QL-D1 smokeColumn sprite pending)'));
console.log('ruin: wall top', ROOFZ, 'deck', DECK, 'steps tops', stepTops.join(','), 'base', base.toFixed(2));
// ---- MAP-24 straw-man field: note post (crate + upright board) and 3 practiceTarget entities 13-23 m away
const NOTE = [966, 1086];
put('Prop_Crate', NOTE[0], NOTE[1], 0, { scale: 0.5, ext: 0.3 });
put('Prop_WoodenFence_Single', NOTE[0], NOTE[1], 90, { dz: 0.53, scale: 0.55, ext: 0.3 });
const ents = [...ruinEnts, 
  { id: 'post', type: 'prop', x: +basket.x.toFixed(2), y: +basket.y.toFixed(2), z: 'ground', components: { inspect: { text: 'post.basket' } }, note: 'MAP-22 trade post basket crate: inspect anchor (sq.packet delivers here, 20 arrows in the basket)' },
  { id: 'notePost', type: 'prop', x: NOTE[0], y: NOTE[1], z: 'ground', components: { inspect: { text: 'note.straw' } }, note: 'MAP-24 note post of the straw-man field (QL-13 sq.straw giver)' },
];
[[978, 1092], [984, 1099], [989, 1090]].forEach(([x, y], i) => ents.push({
  id: 'target' + (i + 1), type: 'prop', x, y, z: 'ground', yawDeg: Math.round(Math.atan2(NOTE[1] - y, NOTE[0] - x) * 180 / Math.PI + 360) % 360,
  components: { voxel: { anim: 'idle', loop: true, model: 'practiceTarget' }, targetable: { height: 1.6, radius: 0.35 } },
  note: `MAP-24 straw target ${i + 1} (hit volume id target${i + 1}, ${Math.hypot(x - NOTE[0], y - NOTE[1]).toFixed(0)} m from the note post; QL-13 flag target${i + 1}.hit)`,
}));
data.entities.splice(data.entities.findIndex((e) => e.id === 'berry6') + 1, 0, ...ents);
data.structures.splice(data.structures.findIndex((s) => s.id === 'burlBush') + 1, 0, ...out);
data.triggers = data.triggers.filter((t) => t.id !== 'crossroads');
data.triggers.push({ id: 'crossroads', note: 'MAP-22 area-only zone: the road-end junction west of the ford (signpost, trade post, footpath north)', r: 14, shape: 'circle', x: 990, y: 1062 });
console.log(`poi: ${out.length} meshes, ${ents.length} entities`, ents.map((e) => `${e.id}@${e.x},${e.y}`).join(' '));
if (!dry) {
  fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
  const a = JSON.parse(fs.readFileSync(AREAS, 'utf8')); a.areas.crossroads = { world: 'world_m1', trigger: 'crossroads' };
  fs.writeFileSync(AREAS, JSON.stringify(a, null, 2) + '\n', 'utf8');
  console.log('wrote', FILE, AREAS);
}
