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
import '../design/levels/world_geo.js'; // OB-018: snap props to the SAME ground the game shows (geography + river carving)
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { plantScaleFor } from './plant-scale.mjs';
import { loadTestAssets } from './testing/content-node.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', AREAS = 'content/quests/areas.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const poiRe = /^poi\d+$/, ENT_IDS = ['post', 'notePost', 'target1', 'target2', 'target3', 'nest', 'rook', 'chestRook', 'chestMeadow', 'chestBend', 'chestCrossroads', 'chestHidden', 'hiddenScrawl', 'knot', 'boarF1', 'boarF2', 'cap1', 'cap2', 'cap3', 'cap4', 'cap5', 'smoke1', 'smoke2', 'smoke3', 'smokeRuin', 'tradeLamp', 'gondola', 'packet', 'brass1', 'brass2', 'brass3', 'brass4', 'chestBoots', 'fordMark'];
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
  const st = { id: 'poi' + String(out.length).padStart(3, '0'), mesh: mesh.includes('/') ? mesh : 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: o.z != null ? o.z : +(low(x, y, o.ext ?? 0.6) - 0.04 + (o.dz ?? 0)).toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
// OB-035: a marker post = a Prop_Support strut stuck in the ground (the mesh is a 45-degree roof brace: its foot is 1.21 m above its origin, so dz -1.21
// plants the foot; a leaning stake, there is no upright post mesh and meshes take no pitch) with ONE fence plank nailed near its top as the sign.
const BRACE_FOOT = 1.21, BRACE_TOP = 1.7;   // foot height above the origin, rise from foot to top
function markerPost(x, y, yaw, plankYaw, plankScale = 0.5) {
  put('Prop_Support', x, y, yaw, { dz: -BRACE_FOOT, ext: 0.3, collide: false });
  const [tx, ty] = rot(yaw, 0, -1.75);   // the high end of the strut lies at local y -1.75
  put('Prop_WoodenFence_Single', x + tx, y + ty, plankYaw, { dz: BRACE_TOP - 0.55, scale: plankScale, ext: 0.3, collide: false });
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
markerPost(SIGN[0], SIGN[1], 100, 100, 0.55);   // OB-035: leaning post + one plank (was a crate with two fence pieces on top)
// trade post (north verge of the road end): fence back, plank counter on two crates, a basket crate
const TP = [1000.5, 1060.5], TPY = 180;
{ const [ox, oy] = rot(TPY, 0, -0.9); put('Prop_WoodenFence_Single', TP[0] + ox, TP[1] + oy, TPY, { ext: 0.4 }); }   // back fence (middle)
// OB-038: awning = a Roof_Wooden_2x1 plank roof laid on two 2-crate stacks at the back corners (existing pieces only), over the counter
const AWN_Z = 2.12;
for (const lx of [-1.2, 1.2]) { const [ox, oy] = rot(TPY, lx, -0.9); const c = put('Prop_Crate', TP[0] + ox, TP[1] + oy, TPY + lx * 7, { ext: 0.5 }); put('Prop_Crate', TP[0] + ox, TP[1] + oy, TPY - lx * 9, { ext: 0.5, dz: 1.06, free: true }); }
{ const [ox, oy] = rot(TPY, 0, 0.55); put('Roof_Wooden_2x1', TP[0] + ox, TP[1] + oy, TPY, { dz: AWN_Z, ext: 0.5, collide: false }); }
for (const lx of [-0.8, 0.8]) { const [ox, oy] = rot(TPY, lx, 0.2); put('Prop_Crate', TP[0] + ox, TP[1] + oy, TPY, { ext: 0.4 }); }
{ const [ox, oy] = rot(TPY, 0, 0.2); put('Floor_WoodDark_Half1', TP[0] + ox, TP[1] + oy, TPY + 90, { dz: 1.07, collide: false, ext: 0.3 }); }
const [lampx, lampy] = rot(TPY, -0.5, 0.2), TP_LAMP = { x: TP[0] + lampx, y: TP[1] + lampy };
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
// ---- MAP-23 / OB-024 Rook's nest ruin (975,1058): a ruined STONE house from the Quaternius Medieval Village kit (CC0): 6x6 m footprint of 2 m
// Wall_UnevenBrick pieces (3.12 m): north wall whole (window), east wall with the arched door, west wall partly, south wall and SW corner fallen
// into rubble; corner pillars, a chimney, brick-floor patches, moss; the roof is mostly gone: two tie beams (Roof_Log) still span the room and two
// Roof_Wooden_2x1 tiles hang on the north wall = the roof deck (nest + Rook + chest). Climb: stair-block rubble ramp up the west side.
// All pieces solid (collide default true) except floors / moss / fallen tiles.
const RC = [975, 1058];
let base = 1e9; for (let dx = -3.5; dx <= 3.5; dx += 0.5) for (let dy = -3.5; dy <= 3.5; dy += 0.5) base = Math.min(base, T.groundAt(RC[0] + dx, RC[1] + dy));
const WALLH = 3.12, ROOFZ = +(base + WALLH).toFixed(2), DECK = +(ROOFZ + 1.09).toFixed(2); // roof piece collider is a box z -0.16..1.09: deck top = ROOFZ + 1.09
const wall = (mesh, x, y, yaw) => put(mesh, x, y, yaw, { ext: 1.0 });
const rubble = (x, y, yaw, i) => put(['Wall_BottomCover', 'Prop_Brick1', 'Prop_Brick2', 'Prop_Brick3', 'Prop_Brick4'][i % 5], x, y, yaw, { ext: 0.3 });
// local +y of a wall piece = its inner face: north yaw 0, east 90, south 180, west 270
[['Wall_UnevenBrick_Straight', -2], ['Wall_UnevenBrick_Window_Wide_Round', 0], ['Wall_UnevenBrick_Straight', 2]].forEach(([m, dx]) => wall(m, RC[0] + dx, RC[1] - 3, 0));   // north: whole, window
[['Wall_UnevenBrick_Straight', -2], ['Wall_UnevenBrick_Door_Round', 0]].forEach(([m, dy]) => wall(m, RC[0] + 3, RC[1] + dy, 90));                                    // east: arched door
wall('Wall_UnevenBrick_Straight', RC[0] - 3, RC[1] - 2, 270);                                                                                                       // west: north segment only
wall('Wall_UnevenBrick_Straight', RC[0] + 2, RC[1] + 3, 180);                                                                                                       // south: east segment only
[[3, 2, 90], [0, 3, 180], [-3, 0, 270]].forEach(([dx, dy, yw]) => put('Wall_BottomCover', RC[0] + dx, RC[1] + dy, yw, { ext: 1.0 }));                                  // foundation stubs of the fallen walls
for (const [dx, dy] of [[-3, -3], [3, -3], [3, 3]]) put('Corner_Exterior_Brick', RC[0] + dx, RC[1] + dy, dx < 0 ? 0 : dy < 0 ? 270 : 180, { ext: 0.5 }); // corner pillars (SW fell)
const chimney = put('Prop_Chimney2', RC[0] + 3.7, RC[1] + 2.4, 90, { ext: 0.6 });                                                                                                   // chimney stack still standing outside the east stub
for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 3]]) put('Floor_UnevenBrick', RC[0] + dx, RC[1] + dy, 0, { collide: false, noShadow: true, ext: 1.0, dz: 0.03 }); // broken brick floor
[[-1.5, 1.5], [0.8, 0.4], [-0.6, -0.9], [2.1, 1.7], [1.4, 2.4], [-2.2, 0.6], [-2.8, 2.9], [-1.6, 3.4], [-3.8, 2.0], [-2.4, 3.9]].forEach(([dx, dy], i) => rubble(RC[0] + dx, RC[1] + dy, i * 71, 1 + i)); // collapsed SW corner
// roof: two tie beams (ridge-size logs, 10.7 m long scaled to 6.2 m) across the room on the north/south... walls, resting level with the wall tops
const beamZ = +(ROOFZ - 5.24 * 0.58).toFixed(2);
for (const dy of [-1.7, 0.1]) put('Roof_Log', RC[0], RC[1] + dy, 90, { z: beamZ, scale: 0.58, ext: 0.3 });
// two roof tiles still on the north wall (deck: absolute z so they stay level on the slope); the third lies fallen in the east yard
for (const dx of [-2.3, 0]) put('Roof_Wooden_2x1', RC[0] + dx, RC[1] - 1.4, 0, { z: ROOFZ, ext: 0.3 });
put('Roof_Wooden_2x1', RC[0] + 5.2, RC[1] - 0.6, 160, { collide: false, ext: 1.0, dz: 0.1 });
put('Roof_Support2', RC[0] + 2.0, RC[1] - 0.2, 90, { z: +(ROOFZ - 0.6).toFixed(2), scale: 2, ext: 0.3 }); put('Roof_Support2', RC[0] - 1.8, RC[1] + 1.4, 20, { collide: false, scale: 2, ext: 0.3, dz: 0.3 });
// rubble ramp: a pile of 2 m stair-block columns running south from the west side of the roof (clear of the 9e line and of the world-bounds
// edge in the north), each top <= 0.7 m above the previous (jump apex 1.05 m, step-up 0.45), first top ~0.7 m over its ground, the last (against the roof box) exactly DECK.
const PX = RC[0] - 4.3, stepTops = [], stepYs = [];
{
  const Y = (n, i) => RC[1] - 2 + 2 * (n - 1 - i);
  const N = Math.max(2, Math.ceil((DECK - (low(PX, Y(7, 0), 1.0) + 0.7)) / 0.7) + 1);
  let top = low(PX, Y(N, 0), 1.0) + 0.7; const inc = (DECK - top) / (N - 1);
  for (let i = 0; i < N; i++, top += inc) {
    const y = Y(N, i), g = low(PX, y, 1.0) - 0.04, n = Math.max(1, Math.ceil(top - g - 0.05));
    for (let k = 0; k < n; k++) put('Stairs_Exterior_Straight', PX, y, k % 2 ? 180 : 0, { z: +(top - 1 - (n - 1 - k) * Math.max(0.5, Math.min(1, (top - 1 - g) / Math.max(1, n - 1))) + (k % 4) * 0.03).toFixed(2), ext: 1.0 }); // +0..9 cm per step: stacked stair meshes share tread planes otherwise (OB-053b)
    stepTops.push(+top.toFixed(2)); stepYs.push(+y.toFixed(1));
  }
}
{ rubble(PX - 2.1, stepYs[0] - 0.4, 30, 2); rubble(PX - 2.3, stepYs[2], 120, 3); rubble(PX + 2.2, stepYs[1], 75, 4); rubble(PX - 1.9, stepYs[1] + 0.5, 200, 1); } // beside the pile, never on the approach line
const nestZ = +(DECK + 0.05).toFixed(2);
// OB-036: Rook's nest = a stick bundle of 5 Roof_Log pieces (the smallest scale the world accepts is 0.25: 2.7 m x 0.29 m, so a true ring of small logs
// does not fit the 1.5 m deep roof deck) laid in a loose cross + a top layer, with grass tufts around/inside, on the roof deck. The relay.mirror pickup
// stays (questPickup on entity nest); its pickupGear sprite is kept only as the object lying IN the nest (raised): there is no glint sprite in
// the art set, and the sprite disappears when the mirror is taken while the nest stays.
{ const NX = RC[0] - 0.9, NY = RC[1] - 1.6, LS = 0.25;
  [[-0.38, 90, 0], [0.38, 90 + 14, 0], [0.0, 90 - 22, 0.27], [-0.15, 90 + 38, 0.27], [0.25, 90 - 5, 0.54]].forEach(([dy, yw, dz], i) =>
    put('Roof_Log', NX + (i % 2 ? 0.15 : -0.15), NY + dy * 0.9, yw, { z: +(DECK - 3.85 * LS + dz - 0.02).toFixed(2), scale: LS, collide: false, noShadow: true }));
  [[0.1, 0.05, 'Grass_Wispy_Short'], [-0.25, 0.18, 'Grass_Common_Short'], [0.22, -0.2, 'Grass_Wispy_Short'], [-0.15, -0.25, 'Grass_Common_Short'], [0.0, 0.3, 'Grass_Wispy_Short'], [-0.35, -0.05, 'Grass_Common_Short']].forEach(([dx, dy, m], i) =>
    put(m, NX + dx * 1.6, NY + dy * 1.4, i * 61, { z: +(DECK + 0.3).toFixed(2), scale: 0.45, collide: false, noShadow: true })); }
const CHEST = { voxel: { anim: 'closed', loop: false, model: 'chestSmall' } };
const ruinEnts = [
  { id: 'nest', type: 'prop', x: RC[0] - 0.9, y: RC[1] - 1.6, z: +(nestZ + 0.5).toFixed(2), components: { questPickup: { item: 'relay.mirror', n: 1 }, sprite: { model: 'pickupGear', anim: 'idle', frame: 0 } }, note: 'QL-16: relay.mirror questPickup (taken stays taken; pickupGear sprite until a mirror sprite exists). ' + 'MAP-23 Rook nest anchor on the ruin roof (QL-16 relay.mirror pickup; QL-D1 nest sprite pending). Roof deck z ' + DECK },
  { id: 'chestBoots', type: 'prop', x: RC[0] + 0.7, y: RC[1] - 1.6, z: nestZ, yawDeg: 180, components: CHEST, note: 'QL-16 River Boots chest on the ruin roof beside the nest (table chestDefs.js: gear.feet.riverBoots)' },
  { id: 'rook', type: 'npc', x: RC[0] - 0.1, y: RC[1] - 1.6, z: nestZ, yawDeg: 90, scale: 1.6, components: { dialogue: 'rook', voxel: { anim: 'perch', loop: true, model: 'crow' } }, note: 'OB-044: no collider (a perched crow must not block the 1 m deck). QL-06 Rook the talking crow (crow model x1.6) on the nest of the ruin roof; [E] Talk via the dialogue component' },
  { id: 'chestRook', type: 'prop', x: RC[0] - 2.4, y: RC[1] - 1.6, z: nestZ, yawDeg: 180, components: CHEST, note: 'MAP-23 chest on the ruin roof (EQ-10: arrows 15 + a sturdy gear roll; table in chestDefs.js)' },
];
// ---- MAP-25 loot spots + red caps + smoke anchors. Anchors are bare props (QL-18/QL-17 wire the content); caps are Quaternius mushrooms.
const free = (x, y) => T.groundTypeAt(x, y) !== WATER && T.groundTypeAt(x + 1, y) !== WATER && T.groundTypeAt(x, y + 1) !== WATER;
// EQ-10: chest anchors carry the chest voxel model (closed clip) + yaw 180 (front = +y, towards the approach); contents: game/js/quest/sim/chestDefs.js
const anchor = (id, x, y, note) => { world.ensureBandFor(x, y); ruinEnts.push({ id, type: 'prop', x, y, z: 'ground', ...(id.startsWith('chest') ? { yawDeg: 180, components: CHEST } : {}), note }); };
anchor('chestMeadow', 1386, 1024.5, 'MAP-25 heart-piece chest 1 (meadow grove, N of the road behind the fence gap of the fallen fence line; design walk 2026-10-11 moved it from (1384,1062), 21 m S of the road)');
anchor('chestBend', 1268, 1014, 'MAP-25 heart-piece chest 2 (Bend Relay ridge, ~20 m NNE of relayBend)');
{ // chest 3 on a 1 m stair-block platform behind the ford Wall_Arch ruin (989.57,1092.29)
  const px = 986.2, py = 1094.6; put('Stairs_Exterior_Straight', px, py, 0, { ext: 1.0 });
  ruinEnts.push({ id: 'chestCrossroads', type: 'prop', yawDeg: 180, components: CHEST, x: px, y: py, z: +(low(px, py, 1.0) - 0.04 + 1.0).toFixed(2), note: 'MAP-25 heart-piece chest 3 (crossroads ruin, on a 1 m stair-block platform behind the Wall_Arch)' });
}
{ const hx = 930, hy = 968; world.ensureBandFor(hx, hy); put('Rock_Medium_1', hx + 1.5, hy + 1.2, 40, { ext: 1.2 }); put('Rock_Medium_2', hx - 1.8, hy + 1.0, 200, { ext: 1.2 });
  ruinEnts.push({ id: 'hiddenScrawl', type: 'prop', x: hx - 0.5, y: hy + 5, z: 'ground', components: { inspect: { text: 'scrawl.hiddenChest' } }, note: 'MAP-25 scrawl on the footpath north (text key scrawl.hiddenChest, writer QL-W1)' });
  anchor('chestHidden', hx, hy, 'MAP-25 hidden chest (Wayfarer Tunic): between two rocks, behind scrawl.hiddenChest (hiddenScrawl, 5 m south)'); }
// OB-023: the caps grow on tree TRUNKS (Laetiporus shelf fungus 0.5-1.1 m up, facing out, realistic size) with the pickup at the trunk foot;
// Mushroom_Common only on the ground beside the trunk. Trees come from existing scatter rows (never the road: pathDist >= 6 m, no water).
{ const pd = globalThis.ASSETS.levels.overworld_far.util.pathDist;
  // OB-034: the scatter is re-seeded per section (gen-roadside-meshes), so the five cap trees are picked by rule, not by row id: pines / common trees
  // of the ford stretch, >= 9 m off the road, dry on all sides, >= 18 m apart, walking west from x 1160
  const cand = data.structures.filter((t) => /^road[FG]\d+$/.test(t.id) && /Pine|CommonTree/.test(t.mesh) && t.origin.x > 1010 && t.origin.x < 1200 && (world.ensureBandFor(t.origin.x, t.origin.y), pd(t.origin.x, t.origin.y) >= 9)
    && [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [2.5, 2.5], [-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5]].every(([dx, dy]) => free(t.origin.x + dx, t.origin.y + dy))).sort((u, v) => v.origin.x - u.origin.x);
  const TREES = []; for (const t of cand) if (TREES.length < 5 && TREES.every((q) => Math.hypot(q.origin.x - t.origin.x, q.origin.y - t.origin.y) >= 18)) TREES.push(t);
  if (TREES.length < 5) throw new Error('only ' + TREES.length + ' cap trees');
  TREES.forEach((t, i) => { const tid = t.id;
    const k = i + 1, tx = t.origin.x, ty = t.origin.y, sc = t.scale || 1;
    world.ensureBandFor(tx, ty);
    const ang = (k * 67 + 20) * Math.PI / 180, rt = 0.42 * sc;           // out-direction and approx trunk radius
    const fx = tx + Math.cos(ang) * rt, fy = ty + Math.sin(ang) * rt;
    put('Mushroom_Laetiporus', fx, fy, (ang * 180 / Math.PI) + 90, { collide: false, noShadow: true, ext: 0.2, scale: 1.0, dz: 0.5 + 0.12 * k });
    const gx = tx + Math.cos(ang + 0.9) * (rt + 0.5), gy = ty + Math.sin(ang + 0.9) * (rt + 0.5);
    if (k % 2) put('Mushroom_Common', gx, gy, k * 53, { collide: false, noShadow: true, ext: 0.2, scale: 0.9 });
    const px = tx + Math.cos(ang) * (rt + 0.8), py = ty + Math.sin(ang) * (rt + 0.8);
    if (pd(px, py) < 6 || !free(px, py)) throw new Error('cap' + k + ' on road/water');
    ruinEnts.push({ id: 'cap' + k, type: 'prop', x: +px.toFixed(1), y: +py.toFixed(1), z: 'ground', components: { questPickup: { item: 'redcap', n: 1 }, sprite: { model: 'pickupRedCap', anim: 'idle', frame: 0 } }, note: 'MAP-25 red-cap pickup ' + k + ' (OB-023: at the foot of tree ' + tid + ', shelf fungus on its trunk; M4 pickupRedCap sprite, questPickup item redcap; QL-18 sq.rook.caps)' });
  }); }
// M4: smokeColumn far billboard (design/models/m3_props.js settings: unlit, far fog, minCells 3x6, detailRows 14); z 'ground' like the other props
// OB-020 (owner: the billboard smoke looked very bad): smoke1..3 carry a thin particle plume (preset farSmoke, game ASSETS.particles) via components.emitters.
[[958, 1004], [951, 1008], [962, 1000]].forEach(([x, y], i) => { world.ensureBandFor(x, y); ruinEnts.push({ id: 'smoke' + (i + 1), type: 'prop', x, y, z: 'ground', components: { emitters: [{ preset: 'farSmoke', offset: { up: 0.5 }, on: true }] }, note: 'MAP-25 smoke anchor ' + (i + 1) + ' (north of northLook); OB-020 particle plume (farSmoke), not a billboard' }); });
console.log('ruin: wall top', ROOFZ, 'deck', DECK, 'steps tops', stepTops.join(','), 'base', base.toFixed(2));
// ---- MAP-24 straw-man field: note post (crate + upright board) and 3 practiceTarget entities 13-23 m away
const NOTE = [966, 1086];
markerPost(NOTE[0], NOTE[1], 90, 90, 0.55);
// ---- QL-07 knot post on the Bend relay mount (relay at 1262,1033): crate + upright board, entity `knot` = [E] Look at the knot (lore.knot.read)
const KNOT = [1264.2, 1031.6];
world.ensureBandFor(KNOT[0], KNOT[1]);
markerPost(KNOT[0], KNOT[1], 70, 70, 0.55);
ruinEnts.push({ id: 'knot', type: 'prop', x: KNOT[0], y: KNOT[1], z: 'ground', components: { inspect: { text: 'note.knot' } }, note: 'QL-07 knotted marker post beside the Bend Relay: inspect sets lore.knot.read (mq.bend.call); text note.knot (story.md QL-W1)' });
// ---- QL-17 ford mark: inspect prop on the Ford Relay base (relay 992,1079): [E] Look at the mark sets lore.fordMark.read (mq.smoke)
world.ensureBandFor(993.6, 1077.4);
ruinEnts.push({ id: 'fordMark', type: 'prop', x: 993.6, y: 1077.4, z: 'ground', components: { inspect: { text: 'note.fordMark' } }, note: 'QL-17 mark cut in the Ford Relay base (three rings and a line); inspect sets lore.fordMark.read; text note.fordMark (story.md QL-W1)' });
// ---- QL-16 two wary ford boars (DRESS-01 pattern, not in the burl.boars quest), on dry ground near the ford relay (992,1079)
[['boarF1', 958, 1078], ['boarF2', 962, 1081]].forEach(([id, x, y]) => { world.ensureBandFor(x, y); if (!free(x, y)) throw new Error(id + ' in water');
  ruinEnts.push({ id, type: 'beast', x, y, z: 'ground', components: { brain: { home: [x, y], kind: 'beast', temperament: 'wary' }, targetable: { height: 0.7, radius: 0.45 }, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } }, note: 'QL-16 wary boar grazing near the ford (DRESS-01 pattern); NOT in the burl.boars quest' }); });
ruinEnts.push({ id: 'smokeRuin', type: 'prop', x: chimney.origin.x, y: chimney.origin.y, z: +(chimney.origin.z + 3.05).toFixed(2), components: { emitters: [{ preset: 'smoke', offset: { up: 0.1 }, on: true }] }, note: 'OB-031: smoke from the standing chimney of the Rook ruin (existing emitter preset smoke)' });
ruinEnts.push({ id: 'tradeLamp', type: 'prop', x: +TP_LAMP.x.toFixed(2), y: +TP_LAMP.y.toFixed(2), z: +(low(TP_LAMP.x, TP_LAMP.y, 0.4) + 1.12).toFixed(2), components: { light: { preset: 'lanternHook', on: true, offset: { down: -0.35 } }, voxel: { anim: 'lit', loop: true, model: 'floorLantern' } }, note: 'OB-031: brass lamp on the trade post counter (existing floorLantern + lanternHook light)' });
// ---- M4 story quests (QL-09/11/12): gondola inspect giver (tower ground floor, sq.wreck.plate), oilcloth packet at the Bend Relay base
// (sq.packet), brass scraps brass1..4 (sq.rook.shiny; QL-11 spots). Anchors only: the gondola is the existing wreck dressing, the rest reuses the pickupGear sprite.
ruinEnts.push({ id: 'gondola', type: 'prop', x: 1496, y: 1024, z: 0, components: { inspect: { text: 'prompt.gondola' } }, note: 'QL-09 Kestrel gondola on the tower ground floor: inspect giver of sq.wreck.plate (fetch boar.hide -> Brass Buckler)' });
ruinEnts.push({ id: 'packet', type: 'prop', x: 1260.6, y: 1034.8, z: 'ground', components: { sprite: { anim: 'idle', frame: 0, model: 'pickupGear' } }, note: 'QL-12 oilcloth packet by the Bend Relay base: inspect = accept sq.packet (item packet, deliver to the post)' });
[[1490, 1010], [1465, 1047], [1405, 1040], [1300, 1048]].forEach(([x, y], i) => { world.ensureBandFor(x, y);
  ruinEnts.push({ id: 'brass' + (i + 1), type: 'prop', x, y, z: 'ground', components: { questPickup: { item: 'brass.scrap', n: 1 }, sprite: { anim: 'idle', frame: 0, model: 'pickupGear' } }, note: `QL-11 brass scrap ${i + 1} of 4 (sq.rook.shiny; E Pick, stays taken)` }); });
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
