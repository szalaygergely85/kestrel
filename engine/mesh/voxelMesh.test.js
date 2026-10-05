import { loadGolden } from '../../tools/testing/mesh-golden.mjs';
const golden = loadGolden('voxelMesh');
let oracleIndex = 0;
// engine/mesh/voxelMesh.test.js (ME-07, docs/backlog.md, docs/architecture.md
// 27.7 item 4, 27.15.6). Plain Node ESM, no framework.
// Run: node engine/mesh/voxelMesh.test.js
import { buildVoxelMesh, VoxelMeshCache, addVoxelInstances, MESH_ONLY_MAX_QUADS, downsamplePart, buildVoxelMeshLod1 } from './voxelMesh.js';
import { DrawList } from './DrawList.js';
import { validateMesh } from './MeshData.js';
import { PART_STRIDE, MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
// ME-19b: compare generated quad rays with frozen independent marcher hits.
import { unpackNormalOct } from '../voxel/octNormal.js';
import { makeOk } from '../test/assert.js';

import quadruped12 from '../voxel/fixtures/quadruped12.js';
import post12 from '../voxel/fixtures/post12.js';

// Content voxel models (side-effect classic scripts, same order/list as
// tools/content-smoke.test.mjs / tools/validate-content.mjs).
globalThis.window = globalThis.window || globalThis;
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/lantern.js';
import '../../design/models/lever.js';
import '../../design/models/boulder.js';
import '../../design/models/rubble.js';
import '../../design/models/wreckage.js';
import '../../design/models/relay.js';
import '../../design/models/voxel_props.js';
import '../../design/models/voxel_tower.js';
import '../../design/models/voxel_world.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function matIdForFactory() {
  const seen = new Map();
  let next = 1;
  return (key) => {
    let id = seen.get(key);
    if (id === undefined) { id = next++; seen.set(key, id); }
    return id;
  };
}

/** Packs `def` and returns { pm, partNames } - partNames = insertion order (VoxelModel.js rule). */
function pack(def) {
  const pm = packVoxelModel(def, matIdForFactory());
  const partNames = Object.keys(def.parts);
  return { pm, partNames };
}

// ---------------------------------------------------------------------------
// Independent (test-local) brute-force oracles: exposed-face count and a
// closed-mesh volume via the divergence theorem, both reimplemented here
// rather than reusing voxelMesh.js's own helpers, so a bug shared between
// the mesher and its own helper functions can't hide from these checks.
// ---------------------------------------------------------------------------
function localMatAtBrute(pm, p, x, y, z) {
  const base = p * PART_STRIDE;
  const x0 = pm.parts[base], y0 = pm.parts[base + 1], z0 = pm.parts[base + 2];
  const x1 = pm.parts[base + 3], y1 = pm.parts[base + 4], z1 = pm.parts[base + 5];
  if (x < x0 || x >= x1 || y < y0 || y >= y1 || z < z0 || z >= z1) return 0;
  const atlasOff = pm.parts[base + 10], bx = pm.parts[base + 11], by = pm.parts[base + 12];
  return pm.vox[atlasOff + (x - x0) + bx * ((y - y0) + by * (z - z0))];
}

/** Total exposed unit faces + solid voxel count, per part. */
function bruteForceStats(pm) {
  const perPart = [];
  for (let p = 0; p < pm.partCount; p++) {
    const base = p * PART_STRIDE;
    const x0 = pm.parts[base], y0 = pm.parts[base + 1], z0 = pm.parts[base + 2];
    const x1 = pm.parts[base + 3], y1 = pm.parts[base + 4], z1 = pm.parts[base + 5];
    let faces = 0, voxels = 0;
    for (let z = z0; z < z1; z++) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (localMatAtBrute(pm, p, x, y, z) === 0) continue;
          voxels++;
          if (localMatAtBrute(pm, p, x - 1, y, z) === 0) faces++;
          if (localMatAtBrute(pm, p, x + 1, y, z) === 0) faces++;
          if (localMatAtBrute(pm, p, x, y - 1, z) === 0) faces++;
          if (localMatAtBrute(pm, p, x, y + 1, z) === 0) faces++;
          if (localMatAtBrute(pm, p, x, y, z - 1) === 0) faces++;
          if (localMatAtBrute(pm, p, x, y, z + 1) === 0) faces++;
        }
      }
    }
    perPart.push({ faces, voxels });
  }
  return perPart;
}

function triCorners(mesh, t) {
  const i0 = t * 3, i1 = i0 + 1, i2 = i0 + 2;
  return [
    [mesh.pos[i0 * 3], mesh.pos[i0 * 3 + 1], mesh.pos[i0 * 3 + 2]],
    [mesh.pos[i1 * 3], mesh.pos[i1 * 3 + 1], mesh.pos[i1 * 3 + 2]],
    [mesh.pos[i2 * 3], mesh.pos[i2 * 3 + 1], mesh.pos[i2 * 3 + 2]],
  ];
}

/** Sum of triangle areas (cross product / 2) over a triangle range. */
function rangeArea(mesh, start, count) {
  let area = 0;
  for (let t = start; t < start + count; t++) {
    const [p0, p1, p2] = triCorners(mesh, t);
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return area;
}

/** Closed-mesh volume via the divergence theorem (signed tetrahedra from the origin). */
function rangeVolume(mesh, start, count) {
  let vol = 0;
  for (let t = start; t < start + count; t++) {
    const [p0, p1, p2] = triCorners(mesh, t);
    vol += (p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
      - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
      + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])) / 6;
  }
  return Math.abs(vol);
}

// ---------------------------------------------------------------------------
// 1. Area + volume invariants on quadruped12, post12 and every content
// voxel model (27.15.6 step 1 + backlog AC "area invariant", "volume/
// face-count invariants").
// ---------------------------------------------------------------------------
function checkInvariants(name, def) {
  const { pm, partNames } = pack(def);
  const mesh = buildVoxelMesh(pm, { id: `vox:${name}`, partNames });
  const { errors } = validateMesh(mesh);
  ok(`${name}: mesh validates`, errors.length === 0, errors.join('; '));

  const brute = bruteForceStats(pm);
  ok(`${name}: one range per part`, mesh.ranges.length === pm.partCount, `${mesh.ranges.length} != ${pm.partCount}`);

  let totalTris = 0;
  for (let p = 0; p < pm.partCount; p++) {
    const range = mesh.ranges[p];
    ok(`${name}.${partNames[p]}: range.part matches`, range.part === partNames[p]);
    const area = rangeArea(mesh, range.start, range.count);
    ok(`${name}.${partNames[p]}: area invariant (greedy quads == exposed unit faces)`,
      Math.abs(area - brute[p].faces) < 1e-3, `area=${area} faces=${brute[p].faces}`);
    const vol = rangeVolume(mesh, range.start, range.count);
    ok(`${name}.${partNames[p]}: volume invariant (closed part mesh == solid voxel count)`,
      Math.abs(vol - brute[p].voxels) < 1e-3, `vol=${vol} voxels=${brute[p].voxels}`);
    ok(`${name}.${partNames[p]}: face-count invariant (quad count <= brute unmerged face count)`,
      range.count <= brute[p].faces * 2 + 1e-9, `triCount=${range.count} faces=${brute[p].faces}`);
    totalTris += range.count;
  }
  ok(`${name}: <= 2000 triangles`, totalTris <= 2000, `${totalTris} tris`);
  return totalTris;
}

const contentModels = [
  ['lever', () => globalThis.ASSETS.voxelModels.lever && globalThis.ASSETS.voxelModels.lever.voxel],
  ['lantern', () => globalThis.ASSETS.voxelModels.lantern && globalThis.ASSETS.voxelModels.lantern.voxel],
  ['boulder', () => globalThis.ASSETS.voxelModels.boulder && globalThis.ASSETS.voxelModels.boulder.voxel],
  ['rubble0', () => globalThis.ASSETS.voxelModels.rubble0 && globalThis.ASSETS.voxelModels.rubble0.voxel],
  ['rubble1', () => globalThis.ASSETS.voxelModels.rubble1 && globalThis.ASSETS.voxelModels.rubble1.voxel],
  ['rubble2', () => globalThis.ASSETS.voxelModels.rubble2 && globalThis.ASSETS.voxelModels.rubble2.voxel],
  ['canvasHeap', () => globalThis.ASSETS.voxelModels.canvasHeap && globalThis.ASSETS.voxelModels.canvasHeap.voxel],
  ['gondola', () => globalThis.ASSETS.voxelModels.gondola && globalThis.ASSETS.voxelModels.gondola.voxel],
  ['strut', () => globalThis.ASSETS.voxelModels.strut && globalThis.ASSETS.voxelModels.strut.voxel],
  ['envelopeHeap', () => globalThis.ASSETS.voxelModels.envelopeHeap && globalThis.ASSETS.voxelModels.envelopeHeap.voxel],
  ['relay', () => globalThis.ASSETS.voxelModels.relay && globalThis.ASSETS.voxelModels.relay.voxel],
  ['burner', () => globalThis.ASSETS.voxelModels.burner && globalThis.ASSETS.voxelModels.burner.voxel],
  ['waystone', () => globalThis.ASSETS.voxelModels.waystone && globalThis.ASSETS.voxelModels.waystone.voxel],
];

const triReport = [];
triReport.push(`quadruped12: ${checkInvariants('quadruped12', quadruped12)} tris`);
triReport.push(`post12: ${checkInvariants('post12', post12)} tris`);
for (const [name, getDef] of contentModels) {
  const def = getDef();
  if (!def) { console.warn(`WARN voxelMesh.test.js: content model '${name}' not found - skipped`); continue; }
  triReport.push(`${name}: ${checkInvariants(name, def)} tris`);
}
console.log('Triangle counts (ME-07):\n  ' + triReport.join('\n  '));

// ---------------------------------------------------------------------------
// 2. Determinism: two builds of the same model are byte-identical.
// ---------------------------------------------------------------------------
{
  const { pm, partNames } = pack(quadruped12);
  const m1 = buildVoxelMesh(pm, { id: 'vox:quadruped12', partNames });
  const m2 = buildVoxelMesh(pm, { id: 'vox:quadruped12', partNames });
  const sameTyped = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  ok('determinism: pos byte-identical', sameTyped(m1.pos, m2.pos));
  ok('determinism: uv byte-identical', sameTyped(m1.uv, m2.uv));
  ok('determinism: nrm byte-identical', sameTyped(m1.nrm, m2.nrm));
  ok('determinism: flat byte-identical', sameTyped(m1.flat, m2.flat));
  ok('determinism: aux byte-identical', sameTyped(m1.aux, m2.aux));
  ok('determinism: triCount equal', m1.triCount === m2.triCount);
}

// ---------------------------------------------------------------------------
// 3. No overlap within one (part, face, layer): every quad's flat0
// (planeId base, before any DrawItem OR) is exactly reproduced by the
// documented formula, and two quads on the SAME (part, face, layer) never
// share a cell in their (a, b) box-local footprint.
// ---------------------------------------------------------------------------
{
  const { pm, partNames } = pack(quadruped12);
  const mesh = buildVoxelMesh(pm, { id: 'vox:quadruped12', partNames });
  let planeIdOk = true;
  const perKey = new Map(); // (part,face,layer) -> Set of "a,b" footprint cells (uv-derived)
  let overlap = false;
  for (const range of mesh.ranges) {
    const p = partNames.indexOf(range.part);
    for (let t = range.start; t < range.start + range.count; t += 2) {
      const i0 = t * 3;
      const flat0 = mesh.flat[i0 * 2];
      const flat1 = mesh.flat[i0 * 2 + 1];
      const face = (flat1 >>> 8) & 0xf;
      const layer = flat0 & 0x3FFFF;
      const expected = ((0xF << 28) | ((p & 7) << 21) | ((face & 7) << 18) | (layer & 0x3FFFF)) | 0;
      if ((flat0 | 0) !== expected) planeIdOk = false;

      const key = `${p},${face},${layer}`;
      let set = perKey.get(key);
      if (!set) { set = new Set(); perKey.set(key, set); }
      // uv corners of this quad (corner0 and corner2 of the first triangle
      // give opposite corners of the box-local rect at this quad's density).
      const i2 = i0 + 2;
      const uvA0 = Math.round(Math.min(mesh.uv[i0 * 2], mesh.uv[i2 * 2]) * 1000);
      const uvA1 = Math.round(Math.max(mesh.uv[i0 * 2], mesh.uv[i2 * 2]) * 1000);
      const uvB0 = Math.round(Math.min(mesh.uv[i0 * 2 + 1], mesh.uv[i2 * 2 + 1]) * 1000);
      const uvB1 = Math.round(Math.max(mesh.uv[i0 * 2 + 1], mesh.uv[i2 * 2 + 1]) * 1000);
      for (let a = uvA0; a < uvA1; a++) {
        for (let b = uvB0; b < uvB1; b++) {
          const cell = `${a},${b}`;
          if (set.has(cell)) overlap = true;
          set.add(cell);
        }
      }
    }
  }
  ok('quadruped12: every quad\'s flat0 matches the documented planeId formula', planeIdOk);
  ok('quadruped12: no overlap within one (part, face, layer)', !overlap);
}

// ---------------------------------------------------------------------------
// 4. March oracle (27.15.6 step 3): for every quad, a ray fired from 0.5 m
// out along the WORLD face normal back toward a point just past the quad
// centre hits the SAME part/face/layer via voxelMarch.js's independent
// raymarch.
// ---------------------------------------------------------------------------
function marchOracle(name, def, inst) {
  const { pm, partNames } = pack(def);
  const mesh = buildVoxelMesh(pm, { id: `vox:${name}`, partNames });
  const pose = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
  computeVoxelPose(pm, inst, pose);
  const fwd = Float64Array.from(FORWARD); // snapshot - FORWARD is a shared scratch

  let checked = 0, mismatches = 0;
  const badDetails = [];
  for (const range of mesh.ranges) {
    const p = partNames.indexOf(range.part);
    const fbase = p * 12;
    const A0 = fwd[fbase], A1 = fwd[fbase + 1], A2 = fwd[fbase + 2];
    const A3 = fwd[fbase + 3], A4 = fwd[fbase + 4], A5 = fwd[fbase + 5];
    const A6 = fwd[fbase + 6], A7 = fwd[fbase + 7], A8 = fwd[fbase + 8];
    const bx0 = fwd[fbase + 9], by0 = fwd[fbase + 10], bz0 = fwd[fbase + 11];

    for (let t = range.start; t < range.start + range.count; t += 2) {
      const i0 = t * 3, i1 = i0 + 1, i2 = i0 + 2, i3 = (t + 1) * 3 + 2;
      const c0 = triCorners(mesh, t)[0], c1 = triCorners(mesh, t)[1], c2 = triCorners(mesh, t)[2];
      const c3 = [mesh.pos[i3 * 3], mesh.pos[i3 * 3 + 1], mesh.pos[i3 * 3 + 2]];
      const cx = (c0[0] + c1[0] + c2[0] + c3[0]) / 4;
      const cy = (c0[1] + c1[1] + c2[1] + c3[1]) / 4;
      const cz = (c0[2] + c1[2] + c2[2] + c3[2]) / 4;

      const nrmLocal = [0, 0, 0];
      unpackNormalOct(mesh.nrm[i0], nrmLocal);
      const flat0 = mesh.flat[i0 * 2], flat1 = mesh.flat[i0 * 2 + 1];
      const expFace = (flat1 >>> 8) & 0xf;
      const expLayer = flat0 & 0x3FFFF;

      const lx = cx + 1e-3 * nrmLocal[0], ly = cy + 1e-3 * nrmLocal[1], lz = cz + 1e-3 * nrmLocal[2];
      const wx = A0 * lx + A1 * ly + A2 * lz + bx0;
      const wy = A3 * lx + A4 * ly + A5 * lz + by0;
      const wz = A6 * lx + A7 * ly + A8 * lz + bz0;
      let wnx = A0 * nrmLocal[0] + A1 * nrmLocal[1] + A2 * nrmLocal[2];
      let wny = A3 * nrmLocal[0] + A4 * nrmLocal[1] + A5 * nrmLocal[2];
      let wnz = A6 * nrmLocal[0] + A7 * nrmLocal[1] + A8 * nrmLocal[2];
      const wlen = Math.hypot(wnx, wny, wnz) || 1;
      wnx /= wlen; wny /= wlen; wnz /= wlen;

      const D = 0.5;
      const ox = wx + wnx * D, oy = wy + wny * D, oz = wz + wnz * D;
      const dx = -wnx, dy = -wny, dz = -wnz;
      const hit = new Float64Array(8);
      const sample = golden.rays[oracleIndex++];
      const query = [ox, oy, oz, dx, dy, dz, D + 0.1];
      if (!sample || sample.p !== p || query.some((v, i) => Math.abs(v - sample.query[i]) > 1e-12)
        || Array.from(pose).some((v, i) => Math.abs(v - sample.pose[i]) > 1e-12)) {
        throw new Error(`${name}: quad ray differs from the frozen oracle; ARCH OK required`);
      }
      const hitOk = sample.hit;
      hit.set(sample.out);
      checked++;
      // t tolerance: the 1e-3 (local units) nudge is scaled by the part's
      // world matrix (~cellM), so the world-space t can be off from D by up
      // to ~cellM * 1e-3 (cellM <= 1 by VoxelModel.js's rule) - 1e-3 covers it.
      if (!hitOk || Math.abs(hit[0] - D) > 1e-3 || hit[4] !== expFace || hit[5] !== expLayer) {
        mismatches++;
        if (badDetails.length < 5) {
          badDetails.push(`part=${p} face=${expFace} layer=${expLayer} -> hit=${hitOk ? `t=${hit[0]},face=${hit[4]},layer=${hit[5]}` : 'MISS'}`);
        }
      }
    }
  }
  ok(`${name}: march oracle (checked > 0)`, checked > 0, `checked=${checked}`);
  ok(`${name}: march oracle hits same part/face/layer for every quad`, mismatches === 0,
    `mismatches=${mismatches}/${checked}; ${badDetails.join(' | ')}`);
}

// Real mid-clip frame (ME-07 review item 4): walk frame 1 halfway to frame 2,
// so the leg parts (children of body) carry a non-identity Ak.
{
  const walkIdx = pack(quadruped12).pm.clips.findIndex((c) => c.name === 'walk');
  const walk = pack(quadruped12).pm.clips[walkIdx];
  ok('quadruped12: walk clip found', walkIdx >= 0);
  marchOracle('quadruped12 mid-clip', quadruped12, { model: null, x: 0, y: 0, z: 0, yawDeg: 0, clip: walkIdx, frame: 1, tMs: walk.durMs[1] / 2 });
  const pm = pack(quadruped12).pm, pose = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
  computeVoxelPose(pm, { x: 0, y: 0, z: 0, yawDeg: 0, clip: walkIdx, frame: 1, tMs: walk.durMs[1] / 2 }, pose);
  let nonIdentity = false;
  for (let p = 0; p < pm.partCount; p++) {
    const f = p * 12;
    if (Math.abs(FORWARD[f + 4] / FORWARD[f + 0] - 1) > 1e-6 || Math.abs(FORWARD[f + 5]) > 1e-6) nonIdentity = true;
  }
  ok('quadruped12 mid-clip: some part matrix is not a pure yaw/scale (Ak exercised)', nonIdentity);
}
marchOracle('quadruped12 yaw37', quadruped12, { model: null, x: 1.5, y: -2, z: 0.3, yawDeg: 37, clip: -1, frame: 0, tMs: 0 });
marchOracle('post12 yaw90', post12, { model: null, x: -0.4, y: 0.8, z: 0.1, yawDeg: 90, clip: -1, frame: 0, tMs: 0 });

// ---------------------------------------------------------------------------
// 5. Review items 1-2: flat1 carries pm.matIds[local]; unique meshVersion per build.
// ---------------------------------------------------------------------------
{
  const ids = new Map();
  const pm = packVoxelModel(post12, (key) => { if (!ids.has(key)) ids.set(key, ids.size === 0 ? 37 : 91); return ids.get(key); });
  const partNames = Object.keys(post12.parts);
  const mesh = buildVoxelMesh(pm, { id: 'vox:post12mat', partNames });
  const found = new Set();
  for (let v = 0; v < mesh.triCount * 3; v++) found.add(mesh.flat[v * 2 + 1] >>> 16);
  const want = new Set(Array.from(pm.matIds).slice(1));
  ok('post12: pm.matIds are the remapped ids (37/91), not local 1..n', want.has(37) && want.has(91), [...want].join(','));
  ok('flat1 mat set == pm.matIds[1..] (MaterialTable ids, not local indices)',
    found.size === want.size && [...want].every((m) => found.has(m)), `found=${[...found]} want=${[...want]}`);

  const cache = new VoxelMeshCache();
  const pm2 = packVoxelModel(post12, (key) => 5);
  const m1 = cache.get(pm, 'post12', partNames), m2 = cache.get(pm2, 'post12', partNames);
  ok('VoxelMeshCache: two builds of the same id get different meshVersion', m1.id === m2.id && m1.meshVersion !== m2.meshVersion, `${m1.meshVersion} ${m2.meshVersion}`);
  ok('VoxelMeshCache: same pm -> same mesh, version unchanged', cache.get(pm, 'post12', partNames) === m1 && m1.meshVersion === cache.get(pm, 'post12', partNames).meshVersion);
}

// ---------------------------------------------------------------------------
// 6. ME-22 (architecture.md 28.12 item 3): quad budget. A checkerboard
// layout (every solid cell's 4 side neighbors AND its lone z-layer's top/
// bottom are all empty/boundary) defeats greedy merging entirely, so
// quadCount ~= 6 * solidCount - the fastest way to blow the quad budget
// with a small, cheap-to-validate grid.
// ---------------------------------------------------------------------------
function makeCheckerboardDef(sx, sy) {
  const row = (y) => {
    let s = '';
    for (let x = 0; x < sx; x++) s += ((x + y) % 2 === 0) ? '#' : '.';
    return s;
  };
  const rows = [];
  for (let y = 0; y < sy; y++) rows.push(row(y));
  return {
    version: 1, cellM: 0.05, size: [sx, sy, 1], anchor: [sx / 2, sy / 2, 0],
    mats: { '#': 'mat_a' },
    layers: [rows],
    parts: { body: { box: [0, 0, 0, sx, sy, 1], pivot: [sx / 2, sy / 2, 0] } },
    meshOnly: true,
  };
}

{
  // Between 16384 and MESH_ONLY_MAX_QUADS (32768): builds fine, warns.
  const { pm, partNames } = pack(makeCheckerboardDef(80, 80));
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  let mesh;
  try { mesh = buildVoxelMesh(pm, { id: 'vox:checker80', partNames }); } finally { console.warn = origWarn; }
  const quadCount = mesh.triCount / 2;
  ok('ME-22: checker80 lands between 16384 and MESH_ONLY_MAX_QUADS', quadCount > 16384 && quadCount <= MESH_ONLY_MAX_QUADS, `quadCount=${quadCount}`);
  ok('ME-22: > 16384 quads warns (u32 index path)', warnings.some((w) => w.indexOf('u32') >= 0), JSON.stringify(warnings));
}

{
  // Over MESH_ONLY_MAX_QUADS: throws, naming the model id.
  const { pm, partNames } = pack(makeCheckerboardDef(110, 110));
  let threw = false, msg = '';
  try { buildVoxelMesh(pm, { id: 'vox:checker110', partNames }); } catch (e) { threw = true; msg = e.message; }
  ok('ME-22: checkerboard over MESH_ONLY_MAX_QUADS throws', threw, msg);
  ok('ME-22: throw names the model id', msg.indexOf('vox:checker110') >= 0, msg);
}

// ---------------------------------------------------------------------------
// 7. ME-22 point 7 (real asset test): if design/vox/environment has any
// *.vox files, import one as a mesh-only model and confirm it packs+meshes
// under budget. Skipped gracefully (no fail) when that directory/files
// don't exist - this repo has no committed .vox binaries under design/vox
// as of this writing.
// ---------------------------------------------------------------------------
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const envDir = path.default.join(process.cwd(), 'design', 'vox', 'environment');
  let files = [];
  try { files = fs.default.readdirSync(envDir).filter((f) => f.endsWith('.vox')); } catch { /* directory doesn't exist - skip */ }
  if (!files.length) {
    console.log('SKIP ME-22 real-asset test (no design/vox/environment/*.vox present)');
  } else {
    const { parseVox, buildVoxelModel } = await import('../../tools/voxParse.js');
    const buf = fs.default.readFileSync(path.default.join(envDir, files[0]));
    const parsed = parseVox(buf);
    // A permissive map (every used index -> 'mat_a') - this test only cares
    // that the resulting model packs and meshes under budget, not real materials.
    const map = {};
    for (const v of parsed.voxels) map[String(v.c)] = 'mat_a';
    const def = buildVoxelModel(parsed, map, 0.05, undefined, { parts: false, meshOnly: true });
    const { pm: envPm, partNames: envPartNames } = pack(def);
    let envMesh, envThrew = false;
    try { envMesh = buildVoxelMesh(envPm, { id: `vox:${files[0]}`, partNames: envPartNames }); } catch { envThrew = true; }
    ok(`ME-22: real asset ${files[0]} meshes without throwing`, !envThrew);
    if (!envThrew) ok(`ME-22: real asset ${files[0]} quad count under budget`, envMesh.triCount / 2 <= MESH_ONLY_MAX_QUADS);
  }
}

// ---------------------------------------------------------------------------
// 8. RE-15b (architecture.md 28.13 point 5): LOD1 mesh build + cache.
// ---------------------------------------------------------------------------

/** Single-part, single-z-layer synthetic grid def, for direct `downsamplePart` checks. */
function makeGridDef(sx, sy, rows, mats) {
  return {
    version: 1, cellM: 0.1, size: [sx, sy, 1], anchor: [0, 0, 0],
    mats,
    layers: [rows],
    parts: { body: { box: [0, 0, 0, sx, sy, 1], pivot: [0, 0, 0] } },
  };
}

// 8.1/8.2: representative models - LOD1 has fewer quads, bbox close to LOD0's.
for (const [name, def] of [['quadruped12', quadruped12], ['post12', post12]]) {
  const { pm, partNames } = pack(def);
  const m0 = buildVoxelMesh(pm, { id: `vox:${name}`, partNames });
  const m1 = buildVoxelMeshLod1(pm, { id: `vox:${name}@1`, partNames });
  // post12 is tiny (12 quads at LOD0) and can downsample to the same quad
  // count (no further merge possible); the strict "<" AC only needs ONE
  // representative model (quadruped12, checked below with `<`) - here <=
  // just guards against LOD1 ever being MORE detailed than LOD0.
  ok(`${name}: LOD1 quad count <= LOD0 quad count`, m1.triCount / 2 <= m0.triCount / 2,
    `lod1=${m1.triCount / 2} lod0=${m0.triCount / 2}`);
  let within = true;
  for (let i = 0; i < 3; i++) {
    if (m1.bbox[i] < m0.bbox[i] - 1 || m1.bbox[i + 3] > m0.bbox[i + 3] + 1) within = false;
  }
  ok(`${name}: LOD1 bbox within LOD0 bbox + 1 cell`, within, `lod0=${[...m0.bbox]} lod1=${[...m1.bbox]}`);
}

// 8.1b: quadruped12 specifically demonstrates the strict AC ("LOD1 quad
// count < LOD0 quad count for a representative model").
{
  const { pm, partNames } = pack(quadruped12);
  const m0 = buildVoxelMesh(pm, { id: 'vox:quadruped12', partNames });
  const m1 = buildVoxelMeshLod1(pm, { id: 'vox:quadruped12@1', partNames });
  ok('quadruped12: LOD1 quad count < LOD0 quad count (strict AC)', m1.triCount / 2 < m0.triCount / 2,
    `lod1=${m1.triCount / 2} lod0=${m0.triCount / 2}`);
}

// 8.3: any-solid -> block solid, verified directly against `downsamplePart`.
{
  // 4x4 grid, single solid cell at (3,3) (opposite corner from the origin
  // block) - only the LOD1 block covering it should be solid.
  const rows = ['....', '....', '....', '...#'];
  const def = makeGridDef(4, 4, rows, { '#': 'mat_a' });
  const { pm } = pack(def);
  const d = downsamplePart(pm, 0);
  ok('downsamplePart: 2x2x1 LOD1 grid (4x4 -> 2x2)', d.bx === 2 && d.by === 2 && d.bz === 1, `${d.bx}x${d.by}x${d.bz}`);
  const expected = [0, 0, 0, 1]; // only block (1,1) (covers cell (3,3)) is solid
  ok('downsamplePart: any-solid rule (single corner cell -> only its block solid)',
    expected.every((v, i) => d.vox[i] === (v ? 1 : 0)), `vox=${[...d.vox]}`);

  // Second cell in the SAME block as an already-solid one must not create a
  // second solid block or change which block is solid.
  const rows2 = ['....', '....', '....', '..##'];
  const def2 = makeGridDef(4, 4, rows2, { '#': 'mat_a' });
  const d2 = downsamplePart(pack(def2).pm, 0);
  ok('downsamplePart: any-solid rule (two cells, same LOD1 block -> still one solid block)',
    d2.vox[0] === 0 && d2.vox[1] === 0 && d2.vox[2] === 0 && d2.vox[3] === 1, `vox=${[...d2.vox]}`);
}

// 8.4: most-frequent-mat, tie -> lowest id.
{
  // mats insertion order: 'a' -> local id 1, 'b' -> local id 2.
  // Tie (2 vs 2) in the single 2x2 block -> lowest id (1, 'a') wins.
  const tieRows = ['ab', 'ab'];
  const tieDef = makeGridDef(2, 2, tieRows, { a: 'mat_a', b: 'mat_b' });
  const dTie = downsamplePart(pack(tieDef).pm, 0);
  ok('downsamplePart: tie (2 vs 2) -> lowest local mat id wins', dTie.vox[0] === 1, `vox=${[...dTie.vox]}`);

  // No tie (3 vs 1) -> the more frequent mat ('b', local id 2) wins even
  // though its id is higher.
  const freqRows = ['bb', 'ba'];
  const freqDef = makeGridDef(2, 2, freqRows, { a: 'mat_a', b: 'mat_b' });
  const dFreq = downsamplePart(pack(freqDef).pm, 0);
  ok('downsamplePart: most-frequent mat wins over a lower id (3 vs 1)', dFreq.vox[0] === 2, `vox=${[...dFreq.vox]}`);
}

// 8.4b (RE-15b fix, architecture.md 28.13 point 5): odd box-min alignment to
// the global even grid - a part whose box min x is odd must not shift its
// LOD1 output by one cell, and sampling must never mark a LOD1 block solid
// from out-of-range padding alone.
{
  // 1-part model, box min x = 1 (odd), single solid cell at box-local x = 0
  // (absolute x = 1). Even-grid alignment: x0L = floor(1/2) = 0, x1L =
  // ceil(5/2) = 3 for a 4-wide box (x0=1, x1=5) -> bxL = 3, local x in
  // [0..3). The solid LOD0 cell (box-local cx=0, abs x=1) falls in LOD1
  // block lx=0: cx = 2*(x0L+lx)+dx-x0 = 2*(0+0)+dx-1 -> dx=0 gives cx=-1
  // (skipped, out of range), dx=1 gives cx=0 (in range, the solid cell) - so
  // block lx=0 is solid.
  const def = {
    version: 1, cellM: 0.1, size: [8, 2, 1], anchor: [0, 0, 0],
    mats: { '#': 'mat_a' },
    // size[0]=8 so the model grid is big enough for a box starting at x=1
    // with width 4 (x1=5); one z layer, solid cell only at (x=1, y=0).
    layers: [['.#......', '........']],
    parts: { body: { box: [1, 0, 0, 5, 1, 1], pivot: [0, 0, 0] } },
  };
  const { pm } = pack(def);
  const d = downsamplePart(pm, 0);
  ok('RE-15b fix: odd box-min x aligns to the even grid (bxL spans local x [0..3))',
    d.x0 === 0 && d.x1 === 3 && d.bx === 3, `x0=${d.x0} x1=${d.x1} bx=${d.bx}`);
  // The single solid LOD0 cell (abs x=1) must land in LOD1 block lx=0
  // (covers abs x 0..1, i.e. local [0..2) of LOD1 after alignment) and that
  // block must be solid.
  ok('RE-15b fix: the solid LOD0 cell maps into a solid LOD1 block at local x=0',
    d.vox[0] === 1, `vox=${[...d.vox]}`);

  // 2-part model: one part with an odd box min, one with an even box min.
  // Every solid LOD1 block (for both parts) must contain >= 1 solid LOD0
  // cell - no LOD1 cell may be marked solid purely from out-of-range
  // (alignment-padding) sampling.
  const def2 = {
    version: 1, cellM: 0.1, size: [8, 4, 1], anchor: [0, 0, 0],
    mats: { '#': 'mat_a' },
    layers: [
      ['.#......', '........', '........', '........'],
    ],
    parts: {
      oddPart: { box: [1, 0, 0, 5, 1, 1], pivot: [0, 0, 0] },
      evenPart: { box: [0, 2, 0, 4, 4, 1], pivot: [0, 0, 0] },
    },
  };
  const { pm: pm2 } = pack(def2);
  for (let p = 0; p < pm2.partCount; p++) {
    const dd = downsamplePart(pm2, p);
    const base = p * PART_STRIDE;
    const x0 = pm2.parts[base], y0 = pm2.parts[base + 1], z0 = pm2.parts[base + 2];
    const bx = pm2.parts[base + 11], by = pm2.parts[base + 12];
    const atlasOff = pm2.parts[base + 10];
    let allOk = true;
    for (let lz = 0; lz < dd.bz; lz++) {
      for (let ly = 0; ly < dd.by; ly++) {
        for (let lx = 0; lx < dd.bx; lx++) {
          if (!dd.vox[lx + dd.bx * (ly + dd.by * lz)]) continue;
          let foundSolid = false;
          for (let dz = 0; dz < 2 && !foundSolid; dz++) {
            const cz = 2 * (dd.z0 + lz) + dz - z0;
            if (cz < 0 || cz >= pm2.parts[base + 13]) continue;
            for (let dy = 0; dy < 2 && !foundSolid; dy++) {
              const cy = 2 * (dd.y0 + ly) + dy - y0;
              if (cy < 0 || cy >= by) continue;
              for (let dx = 0; dx < 2 && !foundSolid; dx++) {
                const cx = 2 * (dd.x0 + lx) + dx - x0;
                if (cx < 0 || cx >= bx) continue;
                if (pm2.vox[atlasOff + cx + bx * (cy + by * cz)] !== 0) foundSolid = true;
              }
            }
          }
          if (!foundSolid) allOk = false;
        }
      }
    }
    ok(`RE-15b fix: part ${p} - every solid LOD1 block has >= 1 solid LOD0 cell (no out-of-range false solid)`, allOk);
  }
}

// 8.5: cached identity - two `.get(pm, key, names, 1)` calls return the same object.
{
  const { pm, partNames } = pack(quadruped12);
  const cache = new VoxelMeshCache();
  const a = cache.get(pm, 'quadruped12', partNames, 1);
  const b = cache.get(pm, 'quadruped12', partNames, 1);
  ok('VoxelMeshCache: lod=1 cached identity (same pm -> same object, not rebuilt)', a === b);
  ok('VoxelMeshCache: lod=1 id is vox:<key>@1', a.id === 'vox:quadruped12@1', a.id);
  // lod=0 and lod=1 caches are independent (different WeakMaps/ids).
  const lod0 = cache.get(pm, 'quadruped12', partNames, 0);
  ok('VoxelMeshCache: lod=0 and lod=1 are different mesh objects', lod0 !== a);
}

// 8.6 (budget, 28.13): LOD1 build is one-time per model and fast. Uses the
// content 'lever' fixture per the backlog note (small, RTS-lever-proportioned
// model already used by RE-06/06b/06c); skipped gracefully if not registered.
{
  const leverDef = globalThis.ASSETS.voxelModels.lever && globalThis.ASSETS.voxelModels.lever.voxel;
  if (!leverDef) {
    console.log('SKIP RE-15b lever timing test (lever content model not found)');
  } else {
    const { pm, partNames } = pack(leverDef);
    const cache = new VoxelMeshCache();
    const t0 = performance.now();
    cache.get(pm, 'lever', partNames, 1);
    const ms = performance.now() - t0;
    console.log(`[RE-15b] LOD1 build 'lever': ${ms.toFixed(3)} ms (budget <= 5 ms, one-time per model)`);
    ok('RE-15b: LOD1 build budget (<= 5 ms, one-time per model)', ms <= 5, `${ms.toFixed(3)} ms`);
    // Second call must not rebuild (memoized) - near-zero time.
    const t1 = performance.now();
    cache.get(pm, 'lever', partNames, 1);
    const ms2 = performance.now() - t1;
    ok('RE-15b: LOD1 second call is memoized (no rebuild)', ms2 < ms || ms2 < 0.5, `${ms2.toFixed(4)} ms`);
  }
}

// VOX-CAP-01: ordinary draws keep unique ids through the last mesh slot.
{
  const { pm, partNames } = pack(quadruped12);
  const items = Array.from({ length: 48 }, (_, i) => ({ model: pm, modelKey: 'bear', x: i, y: 0, z: 0, yawDeg: 0,
    clip: -1, frame: 0, tMs: 0, scale: 1, rect: { minX: i, minY: 0, minZ: 0, maxX: i + 1, maxY: 1, maxZ: 1 } }));
  const list = new DrawList();
  addVoxelInstances(list, { list: items }, new VoxelMeshCache(), () => partNames);
  const ids = list.items.slice(0, list.count).map(item => item.objectId);
  ok('48 mesh voxel draws have unique prop ids below unit/view-model ranges', ids.length === 48 && new Set(ids).size === 48 && ids[47] === (0x8000 | 47) && ids.every(id => id < 0xFFFF && id < 0x10000));
}

ok('all frozen oracle rays were checked', oracleIndex === golden.rays.length, `${oracleIndex}/${golden.rays.length}`);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
