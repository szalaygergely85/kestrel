// MAP-08 (owner M4): the Wall and Ferrum far in the EAST as a skyline silhouette - ONE far-only baked mesh (no collision, no
// shadows, outside the walk bounds x > 1880). OB-043 decision (architecture.md 38.46, option B): the ~260 slab placements are
// NOT placed as structures (they would take ~260 grouped-instance slots and push the camera DrawList over budget); they are
// baked into one static mesh `far/ferrum_far` (content/meshes/far/ferrum_far.mesh.json + .bin) = ONE single draw.
// Sources: the imported Quaternius Wall_UnevenBrick_Straight (solid slabs) + Wall_Arch (top course arcade), scale 4: 8 m wide,
// 12 m per course, and Corner_Exterior_Brick (spires),
// each simplified once (simplifyTriangles) before the copies are baked, planar UVs and smoothing groups rebuilt by
// buildMeshFromTris. Geography: design/levels/world_geo.js wall {x0 1985, amp 14, period 310} and ferrum {x 2450, y 1000,
// tiers r 430/300/170}. Heights are COMPRESSED (impostor): Low Wards 3 courses, mid tiers 5, the Crown 10 (+ spires).
// Also a `ferrumGlow` billboard (model ferrumLights, amber pinpoints) behind the Crown: the glow lights seen at dusk.
// Writes the mesh pair, registers it in content/manifest.json, and replaces the "fr###" structures + "ferrumGlow" entity of
// content/worlds/world_m1.world.json with ONE structure `fr000`. Re-runnable.
// Usage: node tools/gen-ferrum-far.mjs [--dry-run]
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent, simplifyTriangles, buildMeshFromTris, meshToJSON, validateMesh } from '../engine/index.js';
import { frameMatrix12 } from '../engine/dev.js';
import { readMeshJSON, writeMeshFiles } from './mesh-file.mjs';
import { loadTestAssets } from './testing/content-node.mjs';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.structures = data.structures.filter((s) => !/^fr\d+$/.test(s.id));
data.entities = data.entities.filter((e) => e.id !== 'ferrumGlow');
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const G = globalThis.ASSETS.levels.world_geo.geo || globalThis.ASSETS.levels.world_geo;
const WALL = G.wall, FER = G.ferrum;
const gz = (x, y) => { world.ensureBandFor(Math.min(x, 2040), y); return world.terrain.groundAt(Math.min(x, 2040), y); };

const S = 4, H = 3.0 * S, TH = 0;            // 12 m per course; Wall_Arch is a flat panel on local y = 0
const out = [];
const ARCH = 'Wall_Arch', SOLID = 'Wall_UnevenBrick_Straight', SPIRE = 'Corner_Exterior_Brick', YAW = Number(process.env.FR_YAW || 90);
let seed = 20261011; const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function put(mesh, x, y, z, yaw) {
  out.push({ id: 'fr' + String(out.length).padStart(3, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1) },
    yawDeg: ((Math.round(yaw) % 360) + 360) % 360, scale: S, collide: false, castShadow: false });
}
// a slab whose thickness centre sits on the line x = c (runs along y), facing the west viewer
const slabY = (x, y, z, mesh = ARCH) => put(mesh, x + TH, y, z, YAW); // SOLID below, ARCH (open arcade) on the top course: stacked archways read as dots at 900 m
const xw = (y) => WALL.x0 + WALL.amp * Math.sin(y / WALL.period);

// ---- the Wall: 2 courses (25 m, canon 24) of 8 m slabs along x_w(y), between y 800 and 1240 (what the tower crown / road see), towers every 160 m
const WY0 = 840, WY1 = 1200;
for (let y = WY0; y <= WY1; y += 8) { const x = xw(y), z = gz(x, y) - 0.3; slabY(x, y, z, SOLID); slabY(x, y, z + H); }
for (let y = Math.ceil(WY0 / WALL.towerEvery) * WALL.towerEvery; y <= WY1; y += WALL.towerEvery) {   // tower: two taller slab columns either side of the line
  const x = xw(y), z = gz(x, y) - 0.3;
  for (const dy of [-3, 3]) for (let k = 0; k < 4; k++) put(SPIRE, x, y + dy, z + k * H, 0);
}

// ---- Ferrum: stepped skyline of slab columns on three concentric tiers (west-facing arc), base on a plateau at the map-edge ground
const base = gz(2040, FER.y) - 2;
const spec = [{ t: FER.tiers[0], n: 11, courses: 3, jit: 1 }, { t: FER.tiers[1], n: 8, courses: 5, jit: 1 }, { t: FER.tiers[2], n: 6, courses: 10, jit: 1 }];
let cols = 0;
for (const sp of spec) {
  for (let i = 0; i < sp.n; i++) {
    const a = Math.PI + ((i / (sp.n - 1)) - 0.5) * 2 * (62 * Math.PI / 180);       // 124 deg arc facing west
    const x = FER.x + sp.t.r * Math.cos(a), y = FER.y + sp.t.r * Math.sin(a);
    const n = sp.courses + Math.round((rng() - 0.5) * 2 * sp.jit);
    for (let k = 0; k < n; k++) slabY(x, y, base + k * H, k < n - 1 ? SOLID : ARCH);
    if (sp === spec[2]) for (let k = 0; k < 3; k++) put(SPIRE, x, y, base + (n + k) * H, 0);   // Crown spire above the column
    cols++;
  }
}
const ents = [{ id: 'ferrumGlow', type: 'billboard', model: 'ferrumLights', x: FER.x - 200, y: FER.y, z: +(base + 5 * H).toFixed(1), unlit: true, fogModel: 'far', fogMax: 0.5,
  sizeM: { w: 640, h: 71 }, minCells: { w: 18, h: 2 }, note: 'MAP-08 Ferrum glow lights (amber pinpoints, model ferrumLights) as a world billboard behind/above the Crown (gen-ferrum-far.mjs; the removed fixed-angle horizon sprite looked bad)' }];
// ---- bake: every slab/spire placement -> world triangles -> one mesh around PIVOT ----
const SIMPLIFY = { [ARCH]: 24, [SOLID]: 16, [SPIRE]: 36 };            // far-only: a slab/spire is a few cells wide at 600+ m
const MAT = { [ARCH]: 'MI_Brick', [SOLID]: 'MI_UnevenBrick', [SPIRE]: 'MI_RockTrim' };
const src = {};
for (const name of [ARCH, SOLID, SPIRE]) {
  const j = readMeshJSON(`content/meshes/quaternius/${name}.mesh.json`);
  const P = []; for (let i = 0; i < j.pos.length; i += 3) P.push([j.pos[i], j.pos[i + 1], j.pos[i + 2]]);
  const r = simplifyTriangles(P, P.map((_, i) => i), SIMPLIFY[name]);
  src[name] = r;
}
const probe = World.load({ ...data, structures: [...data.structures, ...out] }, assets, { physics: 'none' });
const PIVOT = { x: 2200, y: 1000, z: +base.toFixed(1) };
const m = new Float64Array(12), tris = [];
for (const row of out) {
  const st = probe.structures.find((x) => x.id === row.id);
  frameMatrix12(st.frame, m);
  const k = row.scale; for (let i = 0; i < 9; i++) m[i] *= k;      // = placementMatrix12
  const name = row.mesh.slice('quaternius/'.length), r = src[name];
  const q = (v) => Math.fround(Math.round(v * 1000) / 1000); // mm grid, exact in float32 (bbox check)
  const W = r.positions.map((p) => [q(m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[9] - PIVOT.x), q(m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + m[10] - PIVOT.y), q(m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + m[11] - PIVOT.z)]);
  for (let t = 0; t < r.idx.length; t += 3) {
    const p0 = W[r.idx[t]], p1 = W[r.idx[t + 1]], p2 = W[r.idx[t + 2]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz);
    if (!(L > 1e-9)) continue;
    nx /= L; ny /= L; nz /= L;
    tris.push({ p0, p1, p2, normal: [nx, ny, nz], matName: MAT[name], uv0: null, uv1: null, uv2: null });
  }
}
const mesh = buildMeshFromTris(tris, [{ part: 'ferrum_far#0', triStart: 0, triCount: tris.length }], 'far/ferrum_far');
const full = { kind: 'mesh', schema: 1, id: 'far/ferrum_far', nextId: 1, ...JSON.parse(JSON.stringify(meshToJSON(mesh))) };
full.mats = { MI_Brick: 'brick', MI_RockTrim: 'rock_soft', MI_UnevenBrick: 'brick' };
for (const key of ['pos', 'uv', 'aux']) full[key] = full[key].map((v) => Math.round(v * 1e5) / 1e5);
validateMesh(full);
const MESH_FILE = 'content/meshes/far/ferrum_far.mesh.json';
const placed = { id: 'fr000', mesh: 'far/ferrum_far', origin: PIVOT, yawDeg: 0, collide: false, castShadow: false,
  note: 'MAP-08 far-only Ferrum + Wall silhouette, ONE baked mesh (tools/gen-ferrum-far.mjs; OB-043 / architecture.md 38.46)' };
data.structures.push(placed); data.entities.push(...ents);
console.log(`ferrum far: ${out.length} slabs baked (${cols} Ferrum columns, wall ${WY0}..${WY1}) -> ${tris.length} tris, base z ${base.toFixed(1)}, ${ents.length} entity`);
if (!dry) {
  const sz = writeMeshFiles(MESH_FILE, full);
  const man = JSON.parse(fs.readFileSync('content/manifest.json', 'utf8'));
  if (!man.files.includes('meshes/far/ferrum_far.mesh.json')) { man.files.push('meshes/far/ferrum_far.mesh.json'); fs.writeFileSync('content/manifest.json', stringifyContent(man), 'utf8'); }
  fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
  console.log('wrote', MESH_FILE, sz, 'and', FILE);
}
