// MAP-09 (owner D-067): the Sealed Gate - a fortified pass through the West Fells, CLOSED. Locked until Part II (not built).
// Built only from Quaternius Medieval Village pieces that are already imported (Wall_UnevenBrick_Straight / _Door_Round, Corner_Exterior_Brick,
// Door_1_Round, Prop_MetalFence_Simple, Floor_UnevenBrick, Prop_Brick1-4, Rock_Medium_*), scale 4 (the 8 m / 12.5 m wall module):
//   - curtain wall x=240 across the pass floor (y 792..888, 3 courses = 37 m), climbing the rock where the floor rises
//   - gatehouse at y=840: Wall_UnevenBrick_Door_Round (opening 5.2 x 11.6 m) + 2 more courses; two Door_1_Round leaves + iron grille fill the opening
//   - two 16 m towers either side of the gatehouse (4 courses = 50 m, corner posts, floor-tile roof), merlons on every top
//   - rubble bricks / rocks at the foot, floor lanterns at the doors, entity `sealedGate` (inspect note.sealedGate, requireItem gate.key)
// Writes the "sg###" structures and the "sgLamp#" + "sealedGate" entities of content/worlds/world_m1.world.json; re-runnable, replaces only those rows.
// Ground heights come from the installed geography (installGeo, like gen-roadside.mjs). Never hand-edit the generated rows.
// Usage: node tools/gen-sealed-gate.mjs [--dry-run]
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
data.structures = data.structures.filter((s) => !/^sg\d+$/.test(s.id));
data.entities = data.entities.filter((e) => !/^sgLamp(Flame)?\d+$/.test(e.id) && e.id !== 'sealedGate');
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;

const X0 = 240, Y0 = 840;            // wall line x, gate centre y (design/levels/world_geo.js gate)
const S = 4, MOD = 2 * S, H = 3.12 * S; // wall module: 8 m wide, 12.5 m tall, ~1.6 m thick
const TH = 0.11 * S;                 // local-y centre of the wall thickness (bbox -0.09..0.31) so the wall sits ON the line
const out = [];
const gz = (x, y) => { world.ensureBandFor(x, y); return T.groundAt(x, y); };
const low = (x, y, ex, ey) => { let m = 1e9, M = -1e9; for (const dx of [-ex, 0, ex]) for (const dy of [-ey, 0, ey]) { const g = gz(x + dx, y + dy); m = Math.min(m, g); M = Math.max(M, g); } return [m, M]; };
function put(mesh, x, y, z, yaw, o = {}) {
  const st = { id: 'sg' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
// a wall module whose THICKNESS CENTRE sits on the line: runs along world y (yaw 90, line x = c) or along world x (yaw 0, line y = c)
const wallAt = (mesh, along, c, z, o = {}) => (o.alongY ? put(mesh, c + TH, along, z, 90, { scale: S, ...o }) : put(mesh, along, c - TH, z, 0, { scale: S, ...o }));
// merlons: small wall blocks on a top run (no collider: 37+ m up)
const merlon = (x, y, z, yaw) => put('Wall_UnevenBrick_Straight', x, y, z, yaw, { scale: 0.7, collide: false });

// ---- curtain wall: columns every 8 m along y, 3 courses on the pass floor, taller where the rock beside it rises; skipped where it is solid rock
const GATE_COURSES = 3, TOWER_COURSES = 4;
const TOWER_Y = [Y0 - 12, Y0 + 12];                         // 16 m square towers: y 820..836 and 844..860, x 232..248
const cols = [];
for (const dir of [-1, 1]) for (let j = 0; j < 4; j++) cols.push(Y0 + dir * (24 + 8 * j));   // 816/808/800/792 and 864/872/880/888 (centres)
const floor0 = gz(X0 - 30, Y0);
let skipped = 0, stackMax = 0;
for (const cy of cols) {
  const [mn, mx] = low(X0, cy, 1.2, MOD / 2 - 0.5);
  if (mn > floor0 + 38) { skipped++; continue; }              // the column would hang in the cliff
  const base = mn - 0.3, n = Math.min(5, Math.max(GATE_COURSES, Math.ceil((mx - base) / H) + 1));
  stackMax = Math.max(stackMax, n);
  for (let k = 0; k < n; k++) wallAt('Wall_UnevenBrick_Straight', cy, X0, base + k * H, { alongY: true });
  for (const d of [-2, 2]) merlon(X0, cy + d, base + n * H, 90);
}
// ---- gatehouse: door wall + 2 courses, two leaves + grille in the opening plane (x = X0)
{
  const [mn] = low(X0, Y0, 1.2, MOD / 2 - 0.5), base = mn - 0.1;
  wallAt('Wall_UnevenBrick_Door_Round', Y0, X0, base, { alongY: true });
  for (let k = 1; k < GATE_COURSES; k++) wallAt('Wall_UnevenBrick_Straight', Y0, X0, base + k * H, { alongY: true });
  for (const d of [-2, 2]) merlon(X0, Y0 + d, base + GATE_COURSES * H, 90);
  const HALF = 0.655 * S, LS = 2.6;                          // opening half width 2.62 m; leaf 1.07 m * 2.6 = 2.78 m
  put('Door_1_Round', X0, Y0 - HALF, base - 0.08, 90, { scale: LS });
  put('Door_1_Round', X0 - 0.12, Y0 + HALF, base - 0.04, 270, { scale: LS });
  for (const d of [-1.32, 1.32]) put('Prop_MetalFence_Simple', X0 - 0.06, Y0 + d, base + 2.35 * LS + 0.05, 90, { scale: 1.35 });
}
// ---- towers
for (const cy of TOWER_Y) {
  const [mn] = low(X0, cy, 8, 8), base = mn - 0.3;
  for (let k = 0; k < TOWER_COURSES; k++) {
    const z = base + k * H;
    for (const dy of [-4, 4]) { wallAt('Wall_UnevenBrick_Straight', cy + dy, X0 - 8, z, { alongY: true }); wallAt('Wall_UnevenBrick_Straight', cy + dy, X0 + 8, z, { alongY: true }); }
    for (const dx of [-4, 4]) { wallAt('Wall_UnevenBrick_Straight', X0 + dx, cy - 8, z + 0.04, {}); wallAt('Wall_UnevenBrick_Straight', X0 + dx, cy + 8, z + 0.04, {}); } // +4 cm: x-runs meet y-runs at the corners; no coplanar tops (OB-053b)
    for (const sx of [-8, 8]) for (const sy of [-8, 8]) put('Corner_Exterior_Brick', X0 + sx + 0.3, cy + sy + 0.3, z, 0, { scale: S });
  }
  const top = base + TOWER_COURSES * H;
  for (const dx of [-4, 4]) for (const dy of [-4, 4]) put('Floor_UnevenBrick', X0 + dx, cy + dy, top + 0.04, 0, { scale: S, collide: false });
  for (const dx of [-4, 4]) for (const e of [-8, 8]) { merlon(X0 + dx - 2, cy + e, top, 0); merlon(X0 + dx + 2, cy + e, top, 0); }
  for (const dy of [-4, 4]) for (const e of [-8, 8]) { merlon(X0 + e, cy + dy - 2, top, 90); merlon(X0 + e, cy + dy + 2, top, 90); }
}
// ---- rubble + rocks at the foot (west and east of the gate), walk-over bricks
{
  const rng = (() => { let s = 90211; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, x = X0 + side * (3 + rng() * 9), y = Y0 + (rng() - 0.5) * 70;
    if (Math.abs(y - Y0) < 6 && Math.abs(x - X0) < 5) continue;       // keep the doorstep clear
    put('Prop_Brick' + (1 + Math.floor(rng() * 4)), x, y, gz(x, y) - 0.02, rng() * 360, { scale: 1.6 + rng() * 1.2, collide: false, noShadow: true });
  }
  for (const [dx, dy, m] of [[-7, -14, 'Rock_Medium_1'], [6.5, 17, 'Rock_Medium_2'], [-8, 21, 'Rock_Medium_3'], [8, -23, 'Rock_Medium_1']]) {
    const x = X0 + dx, y = Y0 + dy; put(m, x, y, gz(x, y) - 0.2, 40 * dx, { scale: 1.6 });
  }
}

// ---- entities: floor lanterns at the doors + the inspect prop (locked)
const ents = [];
[[-5, -5], [-5, 5], [5, -5], [5, 5], [-5, -30], [-5, 30]].forEach(([dx, dy], i) => {
  const x = X0 + dx, y = Y0 + dy;
  ents.push({ id: 'sgLamp' + (i + 1), type: 'prop', x, y, z: +(gz(x, y) + 0.04).toFixed(2), components: { voxel: { anim: 'lit', loop: true, model: 'floorLanternVox' } }, note: 'MAP-09 lantern at the Sealed Gate (static, no light)' });
  ents.push({ id: 'sgLampFlame' + (i + 1), type: 'prop', x: x, y: y, z: +((gz(x, y) + 0.04) + 0.15).toFixed(2), components: { sprite: { model: 'lampFlame', anim: 'burn', loop: true } }, note: 'OB-180 (D-104): billboard flame in the lamp cage (fx)' });
});
ents.push({ id: 'sealedGate', type: 'prop', x: X0 - 2.6, y: Y0, z: 'ground', components: { inspect: { text: 'note.sealedGate', requireItem: 'gate.key' } },
  note: 'MAP-09 the Sealed Gate: [E] Look at the gate (errands.js qi.sealedGate, story.md Sealed Gate texts). requireItem gate.key = the LAST quest reward; the hook always refuses (Part II after release, not built)' });
data.structures.push(...out); data.entities.push(...ents);
console.log(`sealed gate: ${out.length} meshes, ${ents.length} entities, curtain columns skipped ${skipped}, max stack ${stackMax}, floor ${floor0}`);
if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
