// MAP-26 (M5 sprint 1): Outwall blockout - a walled settlement west of the ford around the dead relay ws_outwall (912,952). No NPCs, no dungeon (D-065).
// Built ONLY from meshes already in content/meshes/quaternius (Medieval Village kit): Wall_UnevenBrick_* shells, Roof_Wooden_2x1 gables, Prop_Chimney2,
// Prop_WoodenFence_Single palisade/pens, Wall_Arch + Corner_Exterior_Brick gate, Door_1_Flat board, RockPath_Round_Wide track, Prop_Brick cairn, Rock_Medium_*.
//   palisade ring 60 x 60 m around (912,952), ONE gate gap in the south-east (east wall, y 925.3); 7 house shells + a forge shell inside; relay on the plaza.
//   goose farm pen (860,990), barley gate (975,900), track from owPathPost (985,1040) to the gate, signArm pickup in the ford shallows, pierStone (1045,1320).
// Anchor ids (contract for QL-21 / WOLF-01): owGate owBoard owRelay(=relayOutwall) owForge owPathPost gooseFarm barleyGate pierStone signArm wolf1..5.
// Writes "ow###" structures + the entities listed in ENT_IDS into content/worlds/world_m1.world.json; re-runnable.
// Usage: node tools/gen-outwall.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { applyNudges } from './coplanar-nudge.mjs';
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
const ENT_IDS = ['relayOutwall', 'owGate', 'owBoard', 'owForge', 'owPathPost', 'gooseFarm', 'barleyGate', 'pierStone', 'signArm', 'wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5', 'owSmoke1', 'owSmoke2', 'owSmoke3', 'owSmoke4', 'owSmoke5'];
// walk bound parts (classic capsule union, like WS2-07): track from the ford to the settlement + a disc over the settlement, goose farm, wolves and barley gate
const OW_BOUNDS = [
  { ax: 1000, ay: 1070, bx: 950, by: 960, r: 30, shape: 'capsule' },
  { r: 100, shape: 'circle', x: 915, y: 950 },
];
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.structures = data.structures.filter((s) => !/^ow\d+$/.test(s.id));
data.entities = data.entities.filter((e) => !ENT_IDS.includes(e.id));
// WM-05/D-077: world bounds are one polygon covering the whole map - the generator no longer touches them (OW_BOUNDS kept only as documentation of the old capsule union)
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
const gz = (x, y) => { world.ensureBandFor(x, y); return T.groundAt(x, y); };
const lowest = (pts) => Math.min(...pts.map(([x, y]) => gz(x, y)));

const out = [];
function put(mesh, x, y, z, yaw, o = {}) {
  const st = { id: 'ow' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }, yawDeg: ((Math.round(yaw) % 360) + 360) % 360 };
  if (o.scale) st.scale = o.scale;
  if (o.collide === false) st.collide = false;
  if (o.noShadow) st.castShadow = false;
  out.push(st); return st;
}
const rng = (() => { let s = 26026; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();

// ---- palisade ring (Prop_WoodenFence_Single, 2.06 m x 0.81 m native)
const CX = 912, CY = 952, HALF = 30, FS = 3.23, FM = 2.065 * FS;      // 2.6 m tall, 6.67 m module
const gateY = CY - HALF + FM / 2;                                      // gate gap: east wall, south end
for (let k = 0; k < 9; k++) {
  const t = -HALF + FM / 2 + k * FM;
  const run = (x, y, yaw) => put('Prop_WoodenFence_Single', x, y, gz(x, y) - 0.3, yaw, { scale: FS });
  run(CX + t, CY - HALF, 0); run(CX + t, CY + HALF, 0);
  run(CX - HALF, CY + t, 90);
  if (k > 0) run(CX + HALF, CY + t, 90);                              // k = 0 is the gate gap
}
// gate: two brick pillars + an arch spanning the gap
{
  const gx = CX + HALF, g0 = gz(gx, gateY);
  for (const d of [-FM / 2, FM / 2]) put('Corner_Exterior_Brick', gx, gateY + d, g0 - 0.2, 0, { scale: 1.9 });
  put('Wall_Arch', gx, gateY, g0 + 5.4, 90, { scale: 2.6, collide: false });
}

// ---- house shells: 4 x 3 wall modules (scale 1.25 -> 2.5 m, 3.9 m high), gable roof, one door, one window, chimney on the gable end
const WS = 1.25, WM = 2 * WS, WH = 3.12269 * WS, TH = 0.11 * WS, RS = 2.5;
const wallRun = (mesh, along, c, z, alongY, o = {}) => (alongY ? put(mesh, c + TH, along, z, 90, { scale: WS, ...o }) : put(mesh, along, c - TH, z + 0.04, 0, { scale: WS, ...o })); // x-runs +4 cm so corner tops/ends are not coplanar with y-runs (OB-053b)
function shell(cx, cy, nx, ny, doorSide, opts = {}) {
  const W = nx * WM, D = ny * WM, g0 = lowest([[cx - W / 2, cy - D / 2], [cx + W / 2, cy - D / 2], [cx - W / 2, cy + D / 2], [cx + W / 2, cy + D / 2]]) - 0.05;
  // sides: S (y-), N (y+) run along x; W (x-), E (x+) run along y
  for (const [side, n, along0, c, alongY] of [['S', nx, cx - W / 2, cy - D / 2, false], ['N', nx, cx - W / 2, cy + D / 2, false], ['W', ny, cy - D / 2, cx - W / 2, true], ['E', ny, cy - D / 2, cx + W / 2, true]]) {
    for (let i = 0; i < n; i++) {
      const a = along0 + WM / 2 + i * WM, mid = i === Math.floor(n / 2);
      let mesh = 'Wall_UnevenBrick_Straight';
      if (side === doorSide && mid && !opts.openFront) mesh = 'Wall_UnevenBrick_Door_Round';
      else if (side === doorSide && opts.openFront) { if (!(i === 0 || i === n - 1)) continue; }
      else if (side === 'N' && i === 1 && !opts.noWindow) mesh = 'Wall_UnevenBrick_Window_Wide_Round';
      wallRun(mesh, a, c, g0, alongY);
    }
  }
  // gable roof along x: ridge line at y = cy, slopes mirrored (ridge on the local y = +0.04 edge, eave on y = -1.52)
  const span = nx * WM + 0.6, rn = Math.ceil(span / (2.257 * RS));
  const rStep = span / rn, rz = g0 + WH + 0.16 * RS - 0.05;
  for (let i = 0; i < rn; i++) {
    const x = cx - span / 2 + rStep / 2 + i * rStep;
    const rzi = rz + (i % 2) * 0.04;                       // alternate tiles +4 cm: neighbours overlap, no coplanar shingles (OB-053b)
    put('Roof_Wooden_2x1', x, cy + (i % 2) * 0.04, rzi, 0, { scale: RS, collide: false });
    put('Roof_Wooden_2x1', x, cy + (i % 2) * 0.04, rzi, 180, { scale: RS, collide: false });
  }
  // chimney beside the east gable
  const chx = cx + W / 2 + 0.6, chy = cy + 0.5, cg = gz(chx, chy) - 0.2, CHS = 2.3;
  put('Prop_Chimney2', chx, chy, cg, 0, { scale: CHS });
  return { chx, chy, top: cg + 3 * CHS, g0 };
}
const houses = [[894, 974], [912, 975], [930, 974], [894, 957], [930, 957], [894, 940], [930, 941]];
const smokes = [];
houses.forEach(([x, y], i) => {
  const r = shell(x, y, 4, 3, 'S');
  if (i === 1 || i === 3 || i === 6) smokes.push({ x: r.chx, y: r.chy, z: r.top });
});
const forge = shell(912, 935, 3, 2, 'N', { openFront: true, noWindow: true });
smokes.push({ x: forge.chx, y: forge.chy, z: forge.top });
// forge props: crates as anvil block + bench, brick hearth edge
put('Prop_Crate', 909.3, 934, gz(909.3, 934), 20, { scale: 0.9 });
put('Prop_Crate', 915, 933.4, gz(915, 933.4), 70, { scale: 0.75 });
for (let i = 0; i < 4; i++) put('Prop_Brick' + (1 + i), 912.7 + i * 0.5, 933.0, gz(912.7, 933) + 0.02, i * 40, { scale: 1.1, collide: false, noShadow: true });

// ---- plaza: notice board (door panel + crate), cart, crates
const BX = 921, BY = 945;
put('Door_1_Flat', BX, BY, gz(BX, BY), 270, { scale: 1.15 });
put('Prop_Crate', BX + 0.6, BY - 0.8, gz(BX, BY), 15, { scale: 1.0 });
put('Prop_Wagon', 905, 962, gz(905, 962), 120, { scale: 1.2 });
put('Prop_Crate', 920.6, 960.2, gz(920.6, 960.2), 40, { scale: 1.1 });
put('Prop_Crate', 920.4, 961.4, gz(920.4, 961.4), 100, { scale: 0.8 });

// ---- track: RockPath_Round_Wide stones owPathPost -> gate (walk-over, no collider)
const track = [[985, 1040], [978, 1010], [966, 985], [956, 962], [954, 940], [950, 926], [944, 925.3]];
let tn = 0;
for (let s = 0; s < track.length - 1; s++) {
  const [x0, y0] = track[s], [x1, y1] = track[s + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 2.1));
  for (let i = 0; i < n; i++) {
    const f = i / n, x = x0 + (x1 - x0) * f + (rng() - 0.5) * 0.8, y = y0 + (y1 - y0) * f + (rng() - 0.5) * 0.8;
    put('RockPath_Round_Wide', x, y, gz(x, y) + 0.02 + (tn % 3) * 0.03, rng() * 360, { scale: 0.9 + rng() * 0.25, collide: false, noShadow: true }); tn++;
  }
}
// plaza stones from the gate to the relay
for (let i = 0; i < 9; i++) { const x = 940 - i * 2.9, y = 925.3 + (952 - 925.3) * (i / 9) * 0.6 + (rng() - 0.5) * 0.6; put('RockPath_Round_Wide', x, y, gz(x, y) + 0.02, rng() * 360, { scale: 1.0, collide: false, noShadow: true }); }

// ---- path post cairn at (985,1040)
for (let i = 0; i < 5; i++) { const a = i * 72, x = 985 + Math.cos(a * Math.PI / 180) * 0.55, y = 1040 + Math.sin(a * Math.PI / 180) * 0.55; put('Prop_Brick' + (1 + (i % 4)), x, y, gz(x, y), a, { scale: 1.7, collide: false }); }
put('Rock_Medium_1', 985, 1040, gz(985, 1040) - 0.1, 30, { scale: 0.5 });
put('Prop_Brick2', 985.1, 1040.1, gz(985, 1040) + 0.55, 15, { scale: 1.6, collide: false });

// ---- goose farm pen (860,990): 16.5 x 9.9 m, fence scale 1.6 (3.3 m module), gap on the east side (towards the settlement)
{
  const PX = 860, PY = 990, PW = 16.5, PD = 9.9, PS = 1.6, PM = 2.065 * PS;
  const run = (x, y, yaw) => put('Prop_WoodenFence_Single', x, y, gz(x, y) - 0.1, yaw, { scale: PS });
  for (let k = 0; k < 5; k++) { const x = PX - PW / 2 + PM / 2 + k * PM; run(x, PY - PD / 2, 0); run(x, PY + PD / 2, 0); }
  for (let k = 0; k < 3; k++) { const y = PY - PD / 2 + PM / 2 + k * PM; run(PX - PW / 2, y, 90); if (k !== 1) run(PX + PW / 2, y, 90); }
  put('Prop_Crate', PX - 5.5, PY + 3, gz(PX - 5.5, PY + 3), 30, { scale: 1.2 });
  put('Prop_Crate', PX - 4.4, PY + 3.4, gz(PX - 4.4, PY + 3.4), 80, { scale: 0.9 });
  put('Prop_Wagon', PX + 11, PY - 4, gz(PX + 11, PY - 4), 200, { scale: 1.2 });
}
// ---- barley gate (975,900): fence run with a 3.3 m gap, one open leaf
{
  const GX = 975, GY = 900, PS = 1.6, PM = 2.065 * PS;
  for (const d of [-1, 1]) for (let k = 0; k < 3; k++) { const x = GX + d * (PM * 1.0 + k * PM); put('Prop_WoodenFence_Single', x, GY, gz(x, GY) - 0.1, 0, { scale: PS }); }
  put('Prop_WoodenFence_Single', GX + PM / 2 - 0.1, GY + 1.2, gz(GX, GY) - 0.1, 75, { scale: PS * 0.95 });
  put('Prop_Brick3', GX - PM / 2, GY, gz(GX - PM / 2, GY), 0, { scale: 1.6, collide: false });
  put('Prop_Brick4', GX + PM / 2 + 0.2, GY, gz(GX + PM / 2, GY), 40, { scale: 1.6, collide: false });
}
// ---- pier stone (1045,1320): a standing rock with a brick cairn at its foot
{
  const g = gz(1045, 1320);
  put('Rock_Medium_2', 1045, 1320, g - 0.2, 20, { scale: 1.1 });
  for (let i = 0; i < 3; i++) put('Prop_Brick' + (1 + i), 1043.3 + i * 0.6, 1318.6, g, i * 50, { scale: 1.5, collide: false });
}

// ---- entities
const ground = (id, x, y, extra) => ({ id, type: 'prop', x, y, z: 'ground', ...extra });
const wolfBeast = (id, x, y, extra) => ({ id, type: 'beast', x, y, z: 'ground', components: { brain: { home: [x, y], kind: 'beast', species: 'wolf' }, targetable: { height: 0.7, radius: 0.45 }, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } }, ...extra }); // QL-21: wolves are beast entities (WOLF-01 species wolf)
const ents = [];
const gateX = CX + HALF;
ents.push({ id: 'relayOutwall', type: 'prop', x: 912, y: 952, yawDeg: 90, z: 'ground', components: { collider: { h: 2.2, r: 0.9 }, light: { offset: { down: -1.1 }, on: false, preset: 'relay' }, voxel: { anim: 'dead', loop: true, model: 'relay' }, waystone: { id: 'ws_outwall', kind: 'relay', label: 'place.relay.ws_outwall', order: 4 } }, note: 'MAP-26 / 38.36: dead relay #3 (anchor owRelay) at ws_outwall in the Outwall plaza; no wake yet; name key place.relay.ws_outwall' });
ents.push(ground('owGate', gateX, +gateY.toFixed(2), { note: 'MAP-26 anchor owGate: south-east gate gap of the Outwall palisade (quest area owPath r10, QL-21)' }));
ents.push(ground('owBoard', BX, BY, { components: { inspect: { text: 'note.owBoard' } }, note: 'MAP-26 anchor owBoard: notice board on the Outwall plaza (text note.owBoard = NEEDS WRITER)' }));
ents.push(ground('owForge', 912, 935, { note: 'MAP-26 anchor owForge: forge shell south of the plaza (open front, hearth smoke)' }));
ents.push(ground('owPathPost', 985, 1040, { note: 'MAP-26 anchor owPathPost: cairn at the start of the Outwall track north-west of the ford (QL-21)' }));
ents.push(ground('gooseFarm', 860, 990, { note: 'MAP-26 anchor gooseFarm: centre of the goose pen (QL-21 mq.ow.fence area, 5 wolves)' }));
ents.push(ground('barleyGate', 975, 900, { note: 'MAP-26 anchor barleyGate: gate of the barley farm south-east of the settlement' }));
ents.push(ground('pierStone', 978, 1050, { components: { inspect: { text: 'note.pierStone' } }, note: 'MAP-26 anchor pierStone: standing stone north of the road (QL-21 sq.hw.piers, text note.pierStone = NEEDS WRITER); moved by QL-21 from (1045,1320, outside the walk bounds) to the Outwall track beside owPathPost' }));
ents.push(ground('signArm', 985, 1062, { components: { questPickup: { item: 'signArm', n: 1 }, voxel: { anim: 'idle', loop: true, model: 'pickup.signArm' } }, note: 'MAP-26 signArm pickup in the ford shallows (QL-21 sq.fc.sign: bring it to the crossroads signpost); item def design/items.js signArm' }));
const wolves = [[150, 12], [200, 15], [250, 10], [310, 18], [100, 14]];
wolves.forEach(([a, d], i) => ents.push(wolfBeast('wolf' + (i + 1), +(860 + Math.cos(a * Math.PI / 180) * d).toFixed(1), +(990 + Math.sin(a * Math.PI / 180) * d).toFixed(1), { note: `MAP-26 wolf spawn anchor ${i + 1} (${d} m from gooseFarm; WOLF-01 pack home)` })));
smokes.forEach((s, i) => ents.push({ id: 'owSmoke' + (i + 1), type: 'prop', x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), components: { emitters: [{ offset: { up: 0.1 }, on: true, preset: 'smoke' }] }, note: 'MAP-26 chimney smoke (existing emitter preset smoke) on an Outwall chimney' }));
data.structures.push(...applyNudges(out)); data.entities.push(...ents);
console.log(`outwall: ${out.length} meshes (${tn} track stones), ${ents.length} entities, ${smokes.length} smokes, ground at relay ${gz(912, 952).toFixed(2)}`);
if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
