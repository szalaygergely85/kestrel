// OB-114: Rock_Medium_1..3 keep moss_cap on up-facing triangles only; the fix is idempotent.
import assert from 'node:assert/strict';
import { readMeshJSON } from './mesh-file.mjs';
import { remapRockMoss, MOSS_MIN_NZ } from './fix-rock-moss.mjs';
for (const n of [1, 2, 3]) {
  const j = readMeshJSON(`content/meshes/quaternius/Rock_Medium_${n}.mesh.json`);
  const moss = j.ranges.find((r) => r.part.endsWith(':moss_cap'));
  for (let t = moss ? moss.start : 0; moss && t < moss.start + moss.count; t++) {
    const p = j.pos, o = t * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const nz = (ux * vy - uy * vx) / Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    assert.ok(nz >= MOSS_MIN_NZ - 1e-3, `Rock_Medium_${n} moss tri ${t} faces nz=${nz.toFixed(2)}`);
  }
  assert.ok((moss ? moss.count : 0) < j.triCount * 0.2, `Rock_Medium_${n}: moss is a minority`);
  assert.deepEqual(remapRockMoss(j).ranges.map((r) => r.count), j.ranges.map((r) => r.count), 'idempotent');
  console.log(`ok - Rock_Medium_${n} moss ${moss ? moss.count : 0}/${j.triCount} tris, all up-facing`);
}
