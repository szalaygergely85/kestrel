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
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { plantScaleFor } from './plant-scale.mjs';
import { loadTestAssets } from './testing/content-node.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json', AREAS = 'content/quests/areas.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const poiRe = /^poi\d+$/, ENT_IDS = ['post', 'notePost', 'target1', 'target2', 'target3'];
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
  const st = { id: 'poi' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, o.ext ?? 0.6) - 0.04 + (o.dz ?? 0)).toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
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
// ---- MAP-24 straw-man field: note post (crate + upright board) and 3 practiceTarget entities 13-23 m away
const NOTE = [966, 1086];
put('Prop_Crate', NOTE[0], NOTE[1], 0, { scale: 0.5, ext: 0.3 });
put('Prop_WoodenFence_Single', NOTE[0], NOTE[1], 90, { dz: 0.53, scale: 0.55, ext: 0.3 });
const ents = [
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
