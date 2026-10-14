// MAP-21/22/24 (Stage 0-2 POI): existing-mesh dressing + anchors for the berry slope, the crossroads and the straw-man field.
// Writes the "poi###" structures, the entities post / notePost / target1..3 and the `crossroads` trigger into
// content/worlds/world_m1.world.json and the `crossroads` area into content/quests/areas.json. Fixed spots, ground-snapped (no RNG):
// re-runnable, replaces only poi### rows / those entity ids / that trigger. berry1..6 stay as the QL-05 pickups (the quest counts 6);
// each gets a Bush_Common under it (plantScaleFor jitter = +-20 %, D-064). Meshes only (owner rule: no new env designs), no voxel stones.
// Usage: node tools/gen-poi-props.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { applyNudges } from './coplanar-nudge.mjs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js'; // OB-018: snap props to the SAME ground the game shows (geography + river carving)
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'buildings_voxel', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { plantScaleFor } from './plant-scale.mjs';
import { loadTestAssets } from './testing/content-node.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', AREAS = 'content/quests/areas.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const poiRe = /^poi\d+$/, ENT_IDS = ['bldRuinHouse', 'post', 'notePost', 'target1', 'target2', 'target3', 'nest', 'rook', 'chestRook', 'chestMeadow', 'chestBend', 'chestCrossroads', 'chestHidden', 'hiddenScrawl', 'knot', 'boarF1', 'boarF2', 'cap1', 'cap2', 'cap3', 'cap4', 'cap5', 'smoke1', 'smoke2', 'smoke3', 'smokeRuin', 'tradeLamp', 'gondola', 'packet', 'brass1', 'brass2', 'brass3', 'brass4', 'chestBoots', 'fordMark'];
data.structures = data.structures.filter((s) => !poiRe.test(s.id));
data.entities = data.entities.filter((e) => !ENT_IDS.includes(e.id));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain; world.ensureBandFor(1000, 1066);
const out = []; let idPad = 0; // BLD-01: ids poi043..poi103 belonged to the removed kit ruin; kept unused so the later rows keep their id (coplanar-nudges.json, lint notes)
const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
const WATER = T.groundTypeAt(1028, 1068);
const low = (x, y, e = 0.6) => Math.min(T.groundAt(x, y), T.groundAt(x + e, y), T.groundAt(x - e, y), T.groundAt(x, y + e), T.groundAt(x, y - e));
// lowest ground of the footprint, slight sink; o.dz stacks on a lower piece; o.scale; o.collide:false; o.ext = footprint half size
function put(mesh, x, y, yaw, o = {}) {
  const st = { id: 'poi' + String(out.length + idPad).padStart(3, '0'), mesh: mesh.includes('/') ? mesh : 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: o.z != null ? o.z : +(low(x, y, o.ext ?? 0.6) - 0.04 + (o.dz ?? 0)).toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
// OB-035: a marker post = a Prop_Support strut stuck in the ground (the mesh is a 45-degree roof brace: its foot is 1.21 m above its origin, so dz -1.21
// plants the foot; a leaning stake, there is no upright post mesh and meshes take no pitch) with ONE fence plank nailed near its top as the sign.
const BRACE_FOOT = 1.21, BRACE_TOP = 1.7;   // foot height above the origin, rise from foot to top
function markerPost(x, y, yaw, plankYaw, plankScale = 0.5) {
  return;   // OB-143 (owner): no crossed X-beam struts (Prop_Support) - they stood in the air on slopes; marker posts are no longer emitted
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
{ const [ox, oy] = rot(TPY, 0, 0.2); put('Floor_WoodDark_Half1', TP[0] + ox, TP[1] + oy, TPY + 90, { dz: 1.14, collide: false, ext: 0.3 }); }
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
// ---- MAP-23 / OB-024 Rook's nest ruin (975,1058). BLD-01 (OB-139, D-085): our own voxel house `bldRuin` (design/models/buildings_voxel.js)
// replaces the Quaternius kit pieces (OB-138 unwalkable stairs / stuck between parts, OB-129 lone chimney, OB-147 giver on a roof). One world prop
// with box colliders (World.rebuildPropColliders): no roof deck, Rook stands at walk.spots.giver on the ground outside the north wall,
// nest + chests lie inside the room (OB-152). yaw 0: model y0 side (front) faces north.
const RC = [975, 1058];
console.log('ruin block starts at poi', out.length); idPad = 53;
let base = 1e9; for (let dx = -3.5; dx <= 3.5; dx += 0.5) for (let dy = -3.5; dy <= 3.5; dy += 0.5) base = Math.min(base, T.groundAt(RC[0] + dx, RC[1] + dy));
const BLD_Z = +(base - 0.05).toFixed(2);
const SPOT = globalThis.ASSETS.models.bldRuin.walk.spots;
const bldRook = [+(RC[0] + SPOT.giver[0]).toFixed(2), +(RC[1] + SPOT.giver[1]).toFixed(2)];

const CHEST = { voxel: { anim: 'closed', loop: false, model: 'chestSmall' } };
const ruinEnts = [
  { id: 'bldRuinHouse', type: 'prop', x: RC[0], y: RC[1], z: BLD_Z, yawDeg: 0, castShadow: true, components: { voxel: { anim: 'idle', loop: true, model: 'bldRuin' } }, note: 'BLD-01 (OB-139): own voxel ruin house replaces the kit-assembled Rook ruin; box colliders from model.colliders' },
  { id: 'nest', type: 'prop', x: RC[0] + 1.95, y: RC[1] + 0.5, z: 'ground', /* OB-152: on the floor inside the ruin room */ components: { questPickup: { item: 'relay.mirror', n: 1 }, voxel: { anim: 'idle', loop: true, model: 'pickup.relay.mirror' } }, note: 'QL-16: relay.mirror questPickup (taken stays taken; pickupGear sprite until a mirror sprite exists). ' + 'MAP-23 Rook nest anchor inside the bldRuin room (QL-16 relay.mirror pickup; QL-D1 nest sprite pending)' },
  { id: 'chestBoots', type: 'prop', x: RC[0], y: RC[1] + 1.6, z: 'ground', /* OB-152: inside the ruin room */ yawDeg: 180, components: CHEST, note: 'QL-16 River Boots chest on the ruin roof beside the nest (table chestDefs.js: gear.feet.riverBoots)' },
  { id: 'rook', type: 'npc', x: bldRook[0], y: bldRook[1], z: 'ground', yawDeg: 90, scale: 1.6, components: { dialogue: 'rook', voxel: { anim: 'perch', loop: true, model: 'crow' } }, note: 'OB-044: no collider (a perched crow must not block). QL-06 Rook the talking crow (crow model x1.6) on the ground at bldRuin walk.spots.giver (BLD-01, OB-147: reachable, never on a roof); [E] Talk via the dialogue component' },
  { id: 'chestRook', type: 'prop', x: RC[0] - 1.1, y: RC[1] + 0.4, z: 'ground', /* OB-152: inside the ruin room */ yawDeg: 180, components: CHEST, note: 'MAP-23 chest on the ruin roof (EQ-10: arrows 15 + a sturdy gear roll; table in chestDefs.js)' },
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
    // OB-130 (owner): shelf fungus removed; trunk-foot pickup + ground mushrooms stay
    // put('Mushroom_Laetiporus', fx, fy, (ang * 180 / Math.PI) + 90, { collide: false, noShadow: true, ext: 0.2, scale: 1.0, dz: 0.5 + 0.12 * k });
    const gx = tx + Math.cos(ang + 0.9) * (rt + 0.5), gy = ty + Math.sin(ang + 0.9) * (rt + 0.5);
    if (k % 2) put('Mushroom_Common', gx, gy, k * 53, { collide: false, noShadow: true, ext: 0.2, scale: 0.9 });
    const px = tx + Math.cos(ang) * (rt + 0.8), py = ty + Math.sin(ang) * (rt + 0.8);
    if (pd(px, py) < 6 || !free(px, py)) throw new Error('cap' + k + ' on road/water');
    ruinEnts.push({ id: 'cap' + k, type: 'prop', x: +px.toFixed(1), y: +py.toFixed(1), z: 'ground', components: { questPickup: { item: 'redcap', n: 1 }, voxel: { anim: 'idle', loop: true, model: 'pickup.redcap' } }, note: 'MAP-25 red-cap pickup ' + k + ' (OB-023: at the foot of tree ' + tid + ', shelf fungus on its trunk; M4 pickupRedCap sprite, questPickup item redcap; QL-18 sq.rook.caps)' });
  }); }
// M4: smokeColumn far billboard (design/models/m3_props.js settings: unlit, far fog, minCells 3x6, detailRows 14); z 'ground' like the other props
// OB-020 (owner: the billboard smoke looked very bad): smoke1..3 carry a thin particle plume (preset farSmoke, game ASSETS.particles) via components.emitters.
[[958, 1004], [951, 1008], [962, 1000]].forEach(([x, y], i) => { world.ensureBandFor(x, y); ruinEnts.push({ id: 'smoke' + (i + 1), type: 'prop', x, y, z: 'ground', components: { emitters: [{ preset: 'farSmoke', offset: { up: 0.5 }, on: true }] }, note: 'MAP-25 smoke anchor ' + (i + 1) + ' (north of northLook); OB-020 particle plume (farSmoke), not a billboard' }); });
console.log('ruin: bldRuin z', BLD_Z, 'rook', bldRook.join(','));
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
ruinEnts.push({ id: 'tradeLamp', type: 'prop', x: +TP_LAMP.x.toFixed(2), y: +TP_LAMP.y.toFixed(2), z: +(low(TP_LAMP.x, TP_LAMP.y, 0.4) + 1.12).toFixed(2), components: { light: { preset: 'lanternHook', on: true, offset: { down: -0.35 } }, voxel: { anim: 'lit', loop: true, model: 'floorLanternVox' } }, note: 'OB-031: brass lamp on the trade post counter (existing floorLantern + lanternHook light)' });
// ---- M4 story quests (QL-09/11/12): gondola inspect giver (tower ground floor, sq.wreck.plate), oilcloth packet at the Bend Relay base
// (sq.packet), brass scraps brass1..4 (sq.rook.shiny; QL-11 spots). Anchors only: the gondola is the existing wreck dressing, the rest reuses the pickupGear sprite.
ruinEnts.push({ id: 'gondola', type: 'prop', x: 1496, y: 1024, z: 0, components: { inspect: { text: 'prompt.gondola' } }, note: 'QL-09 Kestrel gondola on the tower ground floor: inspect giver of sq.wreck.plate (fetch boar.hide -> Brass Buckler)' });
ruinEnts.push({ id: 'packet', type: 'prop', x: 1260.6, y: 1034.8, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'pickup.packet' } }, note: 'QL-12 oilcloth packet by the Bend Relay base: inspect = accept sq.packet (item packet, deliver to the post)' });
[[1490, 1010], [1465, 1047], [1405, 1040], [1300, 1048]].forEach(([x, y], i) => { world.ensureBandFor(x, y);
  ruinEnts.push({ id: 'brass' + (i + 1), type: 'prop', x, y, z: 'ground', components: { questPickup: { item: 'brass.scrap', n: 1 }, voxel: { anim: 'idle', loop: true, model: 'pickup.brass.scrap' } }, note: `QL-11 brass scrap ${i + 1} of 4 (sq.rook.shiny; E Pick, stays taken)` }); });
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
data.structures.splice(data.structures.findIndex((s) => s.id === 'burlBush') + 1, 0, ...applyNudges(out));
data.triggers = data.triggers.filter((t) => t.id !== 'crossroads');
data.triggers.push({ id: 'crossroads', note: 'MAP-22 area-only zone: the road-end junction west of the ford (signpost, trade post, footpath north)', r: 14, shape: 'circle', x: 990, y: 1062 });
console.log(`poi: ${out.length} meshes, ${ents.length} entities`, ents.map((e) => `${e.id}@${e.x},${e.y}`).join(' '));
if (!dry) {
  fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
  const a = JSON.parse(fs.readFileSync(AREAS, 'utf8')); a.areas.crossroads = { world: 'world_m1', trigger: 'crossroads' };
  fs.writeFileSync(AREAS, JSON.stringify(a, null, 2) + '\n', 'utf8');
  console.log('wrote', FILE, AREAS);
}
