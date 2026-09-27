// engine/mesh/voxelMesh.test.js (ME-07, docs/backlog.md, docs/architecture.md
// 27.7 item 4, 27.15.6). Plain Node ESM, no framework.
// Run: node engine/mesh/voxelMesh.test.js
import { buildVoxelMesh } from './voxelMesh.js';
import { validateMesh } from './MeshData.js';
import { PART_STRIDE, MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
// 27.15.0: "never import a caster... tests may" - voxelMarch.js is the
// march oracle this file checks the mesher's geometry against.
import { marchVoxelRay } from '../voxel/voxelMarch.js';
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
      const hitOk = marchVoxelRay(pm, p, pose, ox, oy, oz, dx, dy, dz, D + 0.1, hit);
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

marchOracle('quadruped12 mid-clip', quadruped12, { model: null, x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0 });
marchOracle('quadruped12 yaw37', quadruped12, { model: null, x: 1.5, y: -2, z: 0.3, yawDeg: 37, clip: -1, frame: 0, tMs: 0 });
marchOracle('post12 yaw90', post12, { model: null, x: -0.4, y: 0.8, z: 0.1, yawDeg: 90, clip: -1, frame: 0, tMs: 0 });

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
