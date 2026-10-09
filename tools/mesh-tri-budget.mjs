#!/usr/bin/env node
// MESH-QA-01: triangle budget of the instanced tree mesh groups at the forestWalk and roadSouth poses, in Node (no browser).
//   node tools/mesh-tri-budget.mjs [--json] [--pose forestWalk|roadSouth] [--lod0-cap N] [--lod-cells C]
// Uses the runtime's own `compactGroup` (frustum cull + RE-15 projected-size LOD rule, 0.9/1.1 hysteresis, optional near-LOD0 cap) on
// real scatter placements, so the LOD split matches what the GPU draws. Per mesh group (one registry mesh): instances in the
// frustum, LOD0/LOD1 counts, LOD0/LOD1 triangle counts and the group triangle total; per family and overall totals.
//
// ASSUMPTIONS (flagged in the output): (1) world_m1's live scatter is still the six VOXEL species (the mesh-species switch is
// prepared but not active, ALPHA-01e), so placements are mapped onto the planned mesh families: Oak->CommonTree, Birch->TwistedTree,
// Pine->Pine, variant 1..5 by a deterministic weighted hash of the placement index (CommonTree 14/14/12/10/10, Pine 10/10/8/6/6,
// TwistedTree equal). (2) mesh groups have no `lodCells` wired at runtime yet (QUAT-LOD-01 part 2 NEEDS B1-main); the tool applies
// the forest recipe's `lodCells` (same field the voxel species use). (3) TwistedTree has no content mesh and no LOD1: its LOD0 tri
// count and bbox are read from design/meshes/quaternius/glTF/TwistedTree_N.gltf and it is reported as LOD0 only. (4) frustum + LOD
// only: no drawM/fog distance cull, no sun-shadow pass, no terrain/detail/structure triangles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { InstanceGroups, writeUnitInstance, compactGroup } from '../engine/mesh/instances.js';
import { frustumPlanes } from '../engine/mesh/culling.js';
import { frameMatrix } from '../engine/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRID = { cols: 240, rows: 90, pxCellW: 1, pxCellH: 1 }; // GRID_DEFAULT_COLS x round(cols*3/8), the default
export const VARIANT_WEIGHTS = {
  CommonTree: [14, 14, 12, 10, 10], Pine: [10, 10, 8, 6, 6], TwistedTree: [1, 1, 1, 1, 1],
};
export const SPECIES_FAMILY = [[/oak/i, 'CommonTree'], [/birch/i, 'TwistedTree'], [/pine/i, 'Pine']];

/** Deterministic weighted variant (1-based) for placement index i. */
export function pickVariant(i, weights) {
  let h = Math.imul(i + 1, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  let r = (h >>> 0) % weights.reduce((a, b) => a + b, 0);
  for (let v = 0; v < weights.length; v++) { if (r < weights[v]) return v + 1; r -= weights[v]; }
  return weights.length;
}

function radius(b) {
  let r2 = 0;
  for (let c = 0; c < 8; c++) { const x = c & 1 ? b[3] : b[0], y = c & 2 ? b[4] : b[1], z = c & 4 ? b[5] : b[2]; r2 = Math.max(r2, x * x + y * y + z * z); }
  return Math.sqrt(r2);
}

/**
 * Pure core. placements: { count, x, y, z, yawDeg, family: string[] (per placement) }, meshes: { [name]: { family, tri0, tri1|null,
 * bbox0, bbox1|null } }, variantOf(i, family) -> 1-based variant. Returns the deterministic report object.
 */
export function computeBudget({ placements, meshes, variantOf, cam, grid = GRID, lodCells, lod0Cap = 0 }) {
  const M = new Float64Array(16), planes = new Float64Array(24);
  frameMatrix(cam, grid, M, 'mesh'); frustumPlanes(M, planes);
  const byName = new Map();
  for (let i = 0; i < placements.count; i++) {
    const name = `${placements.family[i]}_${variantOf(i, placements.family[i])}`;
    if (!meshes[name]) throw new Error(`mesh-tri-budget: no mesh data for ${name}`);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(i);
  }
  const set = new InstanceGroups();
  const groups = [];
  for (const name of [...byName.keys()].sort()) {
    const idx = byName.get(name), m = meshes[name];
    const g = set.meshGroup({ layout: 'static', ranges: [{}], id: name, bbox: m.bbox0 }, idx.length);
    for (const i of idx) writeUnitInstance(g.ib, g.count++, placements.x[i], placements.y[i], placements.z[i], placements.yawDeg[i], i, 0);
    let R = radius(m.bbox0);
    if (m.tri1 !== null) R = Math.max(R, radius(m.bbox1));
    g.lodCells = m.tri1 !== null ? lodCells : 0; // no LOD1 mesh -> runtime keeps the old no-LOD path
    g.lod0Cap = m.tri1 !== null ? lod0Cap : 0;
    compactGroup(g, planes, R, M, grid.rows);
    const n0 = g.drawCount[0], n1 = g.drawCount[1];
    groups.push({ mesh: name, family: m.family, placed: idx.length, inRange: n0 + n1, lod0: n0, lod1: n1,
      tri0Each: m.tri0, tri1Each: m.tri1, tris: n0 * m.tri0 + n1 * (m.tri1 ?? 0), trisIfAllLod0: (n0 + n1) * m.tri0 });
  }
  const fam = {};
  for (const g of groups) {
    const f = fam[g.family] || (fam[g.family] = { placed: 0, inRange: 0, lod0: 0, lod1: 0, tris: 0, trisIfAllLod0: 0, hasLod1: meshes[g.mesh].tri1 !== null });
    f.placed += g.placed; f.inRange += g.inRange; f.lod0 += g.lod0; f.lod1 += g.lod1; f.tris += g.tris; f.trisIfAllLod0 += g.trisIfAllLod0;
  }
  const total = { placed: 0, inRange: 0, lod0: 0, lod1: 0, tris: 0, trisIfAllLod0: 0 };
  for (const g of groups) for (const k of Object.keys(total)) total[k] += g[k];
  return { cam: { ...cam }, grid: { cols: grid.cols, rows: grid.rows }, lodCells, lod0Cap, groups, families: fam, total };
}

/** Same selection as game/js/dev/modes/gpucompare.js forestWalk (densest 30 m disc, nearest the spawn on ties, eye +2,+2). */
export function forestWalkPose(sc, spawn, groundAt, eyeH) {
  let best = -1, bestN = -1, bestD = Infinity;
  for (let i = 0; i < sc.count; i++) {
    let n = 0;
    for (let j = 0; j < sc.count; j++) if ((sc.x[j] - sc.x[i]) ** 2 + (sc.y[j] - sc.y[i]) ** 2 <= 900) n++;
    const d = (sc.x[i] - spawn.x) ** 2 + (sc.y[i] - spawn.y) ** 2;
    if (n > bestN || (n === bestN && d < bestD)) { best = i; bestN = n; bestD = d; }
  }
  if (best < 0) throw new Error('forestWalk: empty tree scatter');
  const x = sc.x[best] + 2, y = sc.y[best] + 2;
  return { x, y, z: groundAt(x, y) + eyeH, yawDeg: 270, pitchDeg: 30 };
}

/** Mesh table for Pine/CommonTree (content LOD0 + _LOD1 json/bin) and TwistedTree (glTF, LOD0 only). */
export async function loadMeshTable() {
  const { meshFromBin } = await import('../engine/mesh/meshBin.js');
  const out = {}, qdir = path.join(ROOT, 'content/meshes/quaternius');
  const read = (n) => {
    const j = path.join(qdir, n + '.mesh.json');
    if (!fs.existsSync(j)) return null;
    const meta = JSON.parse(fs.readFileSync(j, 'utf8'));
    return meshFromBin(meta, fs.readFileSync(path.join(qdir, meta.bin)));
  };
  for (const fam of ['CommonTree', 'Pine']) {
    for (let v = 1; v <= 5; v++) {
      const m0 = read(`${fam}_${v}`), m1 = read(`${fam}_${v}_LOD1`);
      out[`${fam}_${v}`] = { family: fam, tri0: m0.triCount, tri1: m1 ? m1.triCount : null, bbox0: Array.from(m0.bbox), bbox1: m1 ? Array.from(m1.bbox) : null };
    }
  }
  for (let v = 1; v <= 5; v++) {
    const g = JSON.parse(fs.readFileSync(path.join(ROOT, `design/meshes/quaternius/glTF/TwistedTree_${v}.gltf`), 'utf8'));
    let tris = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of g.meshes[0].primitives) {
      tris += g.accessors[p.indices].count / 3;
      const a = g.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a.min[k]); mx[k] = Math.max(mx[k], a.max[k]); }
    }
    // glTF (x, y, z) -> world (x, -z, y)
    out[`TwistedTree_${v}`] = { family: 'TwistedTree', tri0: tris, tri1: null, bbox0: [mn[0], -mx[2], mn[1], mx[0], -mn[2], mx[1]], bbox1: null };
  }
  return out;
}

export function formatTable(reports) {
  const L = [];
  for (const [pose, r] of Object.entries(reports)) {
    L.push(`== ${pose}  cam (${r.cam.x.toFixed(1)}, ${r.cam.y.toFixed(1)}, ${r.cam.z.toFixed(2)}) yaw ${r.cam.yawDeg} pitch ${r.cam.pitchDeg}  grid ${r.grid.cols}x${r.grid.rows}  lodCells ${r.lodCells}  lod0Cap ${r.lod0Cap}`);
    L.push('mesh            placed inRange  lod0  lod1  tri0  tri1   tris');
    for (const g of r.groups) L.push(`${g.mesh.padEnd(15)} ${String(g.placed).padStart(6)} ${String(g.inRange).padStart(7)} ${String(g.lod0).padStart(5)} ${String(g.lod1).padStart(5)} ${String(g.tri0Each).padStart(5)} ${String(g.tri1Each ?? '-').padStart(5)} ${String(g.tris).padStart(6)}`);
    for (const [f, v] of Object.entries(r.families)) L.push(`  ${f.padEnd(11)} inRange ${v.inRange} (lod0 ${v.lod0} / lod1 ${v.lod1}) tris ${v.tris} (all-LOD0 ${v.trisIfAllLod0})${v.hasLod1 ? '' : '  [no LOD1 asset: reported as LOD0]'}`);
    L.push(`  TOTAL       inRange ${r.total.inRange} of ${r.total.placed} tris ${r.total.tris} (all-LOD0 ${r.total.trisIfAllLod0}, saved ${r.total.trisIfAllLod0 - r.total.tris})`, '');
  }
  return L.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const which = opt('--pose', null), lod0Cap = Number(opt('--lod0-cap', 0));
  globalThis.window = globalThis.window || globalThis;
  // design content registers itself on globalThis.ASSETS (same side-effect imports as tools/cine-check.mjs)
  for (const f of ['palette', 'detail-pass', 'levels/overworld_far', 'models/lantern', 'models/lever', 'models/voxel_props', 'models/boulder', 'models/rubble', 'models/wreckage', 'models/relay', 'models/sword', 'models/m3_props', 'models/far_tower', 'models/ferrum_lights']) {
    await import(pathToFileURL(path.join(ROOT, 'design', f + '.js')).href);
  }
  const { World } = await import('../engine/index.js');
  const { loadTestAssets } = await import('./testing/content-node.mjs');
  const { GATE_POSES, EYE_H } = await import('../content/dev-poses.js');
  const { assets } = await loadTestAssets();
  const world = World.load(assets.world('world_m1'), assets, { realTrees: true });
  world.terrain.bakeFarSync(); // as gpucompare does before groundAt
  const sc = world.scatter, cfg = world.terrain.recipe.recipe.forest.trees;
  const lodCells = Number(opt('--lod-cells', cfg.lodCells));
  const family = new Array(sc.count);
  for (let i = 0; i < sc.count; i++) {
    const model = cfg.species[sc.species[i]].model;
    const hit = SPECIES_FAMILY.find(([re]) => re.test(model));
    if (!hit) throw new Error(`mesh-tri-budget: no family for species ${model}`);
    family[i] = hit[1];
  }
  const placements = { count: sc.count, x: sc.x, y: sc.y, z: sc.z, yawDeg: sc.yawDeg, family };
  const meshes = await loadMeshTable();
  const variantOf = (i, fam) => pickVariant(i, VARIANT_WEIGHTS[fam]);
  const road = GATE_POSES.find((p) => p.slug === 'roadSouth').cam;
  const poses = {
    forestWalk: forestWalkPose(sc, world.get('player').data.transform, (x, y) => world.terrain.groundAt(x, y), EYE_H),
    roadSouth: { x: road.x, y: road.y, z: road.z, yawDeg: road.yawDeg, pitchDeg: road.pitchDeg },
  };
  const reports = {};
  for (const [name, cam] of Object.entries(poses)) if (!which || which === name) reports[name] = computeBudget({ placements, meshes, variantOf, cam, lodCells, lod0Cap });
  const notes = ['voxel scatter mapped to mesh families (Oak->CommonTree, Birch->TwistedTree, Pine->Pine), variants by weighted hash',
    'TwistedTree has no LOD1 asset: counted as LOD0', 'frustum + RE-15 LOD only (no drawM/fog cull, no shadows)'];
  if (args.includes('--json')) process.stdout.write(JSON.stringify({ notes, reports }, null, 2) + '\n');
  else process.stdout.write(formatTable(reports) + '\n' + notes.map((n) => 'note: ' + n).join('\n') + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
