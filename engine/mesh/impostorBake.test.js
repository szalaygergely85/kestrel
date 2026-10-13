// R6a tests: determinism, coverage, normal round-trip, depth range, size, speed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packNormalOct, unpackNormalOct } from '../voxel/octNormal.js';
import { bakeImpostor, decodeImpNormal, impMipOffset, IMP_BYTES, IMP_BUDGET_BYTES, IMP_VIEWS } from './impostorBake.js';

// Synthetic ~1.5k-tri tree: trunk + 3 stacked cones (radial, z up).
function tree() {
  const P = [], N = [], F = [];
  function tri(a, b, c, mat) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); N.push(packNormalOct(nx, ny, nz)); F.push(0, (3 << 8) | (mat << 16)); }
  }
  const seg = 64;
  for (const [z0, z1, r0, mat] of [[0, 1.5, 0.2, 1], [1, 3, 1.6, 2], [2.5, 4.5, 1.2, 2], [4, 6.5, 0.8, 2]]) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI;
      const p0 = [r0 * Math.cos(a0), r0 * Math.sin(a0), z0], p1 = [r0 * Math.cos(a1), r0 * Math.sin(a1), z0];
      const apex = mat === 1 ? [0.1 * Math.cos(a0), 0.1 * Math.sin(a0), z1] : [0, 0, z1];
      tri(p0, p1, apex, mat);
      tri(p1, p0, [0, 0, z0], mat);
      tri(p0, p1, [p1[0] * 0.5, p1[1] * 0.5, z1], mat);
    }
  }
  return { pos: new Float32Array(P), nrm: new Uint32Array(N), flat: new Uint32Array(F), triCount: P.length / 9 };
}
const mesh = tree();
const hash = (b) => createHash('sha256').update(b).digest('hex');

const t0 = performance.now();
const a = bakeImpostor(mesh);
const cold = performance.now() - t0;
const b = bakeImpostor(mesh);
assert.equal(hash(a.bytes), hash(b.bytes), 'two bakes identical');
assert.equal(a.bytes.length, IMP_BYTES);
assert.equal(IMP_BYTES, 86016);
assert.ok(IMP_BYTES * 20 <= IMP_BUDGET_BYTES, '20 species fit the budget');
const t1 = performance.now(); bakeImpostor(mesh); const warm = performance.now() - t1;
assert.ok(warm <= 20, `bake ${warm.toFixed(1)} ms (cold ${cold.toFixed(1)}) for ${mesh.triCount} tris`);

let minDepth = 0, maxDepth = 0;
for (let v = 0; v < IMP_VIEWS; v++) {
  for (let mip = 0; mip < 3; mip++) {
    const n = 32 >> mip, o0 = impMipOffset(v, mip);
    let cov = 0;
    for (let i = 0; i < n * n; i++) {
      const o = o0 + i * 8;
      if (a.bytes[o + 5] === 0) continue;
      cov++;
      const d = (a.bytes[o + 4] << 24) >> 24;
      if (d < minDepth) minDepth = d;
      if (d > maxDepth) maxDepth = d;
    }
    assert.ok(cov > 0, `view ${v} mip ${mip} has coverage`);
  }
}
assert.ok(minDepth >= -127 && maxDepth <= 127);

// Normal round-trip: bake a one-triangle mesh per direction, decode the texel bytes, compare with the view-rotated normal.
const out = new Float64Array(3), tmp = new Float64Array(3);
let worst = 0;
for (let i = 0; i < 300; i++) {
  const z = 1 - 2 * ((i + 0.5) / 300), r = Math.sqrt(1 - z * z), ph = i * 2.399963;
  const wx = r * Math.cos(ph), wy = r * Math.sin(ph);
  const m = { pos: new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0, 2]), nrm: new Uint32Array(3).fill(packNormalOct(wx, wy, z)), flat: new Uint32Array(6), triCount: 1 };
  const bk = bakeImpostor(m);
  const o0 = impMipOffset(i % 8, 0);
  for (let k = 0; k < 1024; k++) {
    const o = o0 + k * 8;
    if (bk.bytes[o + 5] === 0) continue;
    const ang = (i % 8) * Math.PI / 4, ca = Math.cos(ang), sa = Math.sin(ang);
    unpackNormalOct(packNormalOct(wx, wy, z), tmp);
    decodeImpNormal(bk.bytes, o, out);
    worst = Math.max(worst, Math.abs(out[0] - (tmp[0] * ca + tmp[1] * sa)), Math.abs(out[1] - (-tmp[0] * sa + tmp[1] * ca)), Math.abs(out[2] - tmp[2]));
    break;
  }
}
assert.ok(worst <= 1 / 127, `oct round-trip worst ${worst} > 1/127`);
console.log(`impostorBake: OK (warm ${warm.toFixed(1)} ms, cold ${cold.toFixed(1)} ms, ${mesh.triCount} tris, oct err ${worst.toFixed(4)}, depth ${minDepth}..${maxDepth}, ${IMP_BYTES} B)`);
