// R6b tests (architecture.md 38.60): view pick, band complementarity, texel decode, depth, 0 alloc, off = unchanged.
// The gc probe runs only with `node --expose-gc engine/mesh/impostorCard.test.js` (run-tests passes no flag).
import assert from 'node:assert/strict';
import { packNormalOct, unpackNormalOct } from '../voxel/octNormal.js';
import { bakeImpostor, decodeImpNormal, impMipOffset } from './impostorBake.js';
import { impViewPick, impBandBits, impDecodeTexel, impTexelOffset, enableGroupImpostor, IMP_BAND_M, impMipPick } from './impostorCard.js';
import { makeInstanceGroup, compactGroup, createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE } from './instances.js';
import { ditherKeep, LDT_ACTIVE } from './lodDither.js';
import { createRasterTarget, rasterCards } from './rasterJS.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { KIND_MESH } from '../render/GBuffer.js';

function tree(seg = 16) {
  const P = [], N = [], F = [];
  function tri(a, b, c, mat) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); N.push(packNormalOct(nx, ny, nz)); F.push(0, (3 << 8) | (mat << 16)); }
  }
  for (const [z0, z1, r0, mat] of [[0, 1.5, 0.2, 1], [1, 3, 1.6, 2], [2.5, 4.5, 1.2, 2], [4, 6.5, 0.8, 2]]) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI;
      const p0 = [r0 * Math.cos(a0), r0 * Math.sin(a0), z0], p1 = [r0 * Math.cos(a1), r0 * Math.sin(a1), z0];
      tri(p0, p1, [0, 0, z1], mat); tri(p1, p0, [0, 0, z0], mat);
    }
  }
  return { pos: new Float32Array(P), nrm: new Uint32Array(N), flat: new Uint32Array(F), triCount: P.length / 9 };
}
const imp = bakeImpostor(tree());

// 1. view pick table: 8 instance yaws x 360 bearings == nearest of the 8 views by an independent angular search
{
  const d2r = Math.PI / 180;
  for (let yi = 0; yi < 8; yi++) {
    const yaw = yi * 45 * d2r + 0.123;
    for (let b = 0; b < 360; b++) {
      const beta = (b + 0.25) * d2r; // bearing of h from +y, CCW: h = (-sin, cos)
      const hx = -Math.sin(beta), hy = Math.cos(beta);
      const got = impViewPick(0, 0, hx * 50, hy * 50, yaw);
      let best = 0, bd = 9;
      for (let v = 0; v < 8; v++) {
        let a = beta - yaw - v * Math.PI / 4; a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(a) < bd) { bd = Math.abs(a); best = v; }
      }
      assert.equal(got, best, `view yaw ${yi} bearing ${b}`);
    }
  }
  assert.equal(impViewPick(0, -10, 0, 0, 0), 0, 'camera south of tree looking +y = view 0');
  assert.equal(impViewPick(10, 0, 0, 0, 0), 2, 'camera east of tree looking -x = view 2');
  assert.equal(impViewPick(0, 10, 0, 0, 0), 4);
  assert.equal(impViewPick(-10, 0, 0, 0, 0), 6);
}

// 2. band complementarity through compactGroup (CPU instance path)
const mkGroup = (n, on) => {
  const g = makeInstanceGroup('t', n);
  if (on) enableGroupImpostor(g, imp, 60, createInstanceBuffer);
  g.maxDistM = 300; g.count = n;
  return g;
};
{
  const dists = [10, 59.9, 60, 62, 64, 67.99, 68, 100, 299, 301];
  const g = mkGroup(dists.length, true);
  dists.forEach((d, i) => writeUnitInstance(g.ib, i, 0, d, 0, 0, 100 + i, 0));
  compactGroup(g, null, 5, null, 0, 0, { x: 0, y: 0, z: 0 });
  const mesh = [], card = [];
  for (let i = 0; i < g.drawCount[0]; i++) mesh.push(g.drawIb[0].u32.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE));
  for (let i = 0; i < g.cardCount; i++) card.push(g.cardIb.u32.subarray(i * INSTANCE_STRIDE, (i + 1) * INSTANCE_STRIDE));
  const oidOf = (r) => r[12] - 100;
  const meshIds = mesh.map(oidOf), cardIds = card.map(oidOf);
  assert.deepEqual(meshIds, [0, 1, 2, 3, 4, 5], 'mesh: d < impM + 8 only');
  assert.deepEqual(cardIds, [2, 3, 4, 5, 6, 7, 8], 'card: d >= impM only, d > maxDistM dropped');
  for (const id of [2, 3, 4, 5]) { // band: both copies, complementary
    const m = (mesh[meshIds.indexOf(id)][13] >>> 16) & 0x7ff, c = (card[cardIds.indexOf(id)][13] >>> 16) & 0x7ff;
    assert.ok((m & 0x400) && (c & 0x400), 'active bits');
    assert.equal(m & 0x200, 0, 'mesh copy not inverted'); assert.equal(c & 0x200, 0x200, 'card copy inverted');
    assert.equal(m & 0x1ff, c & 0x1ff, 'same cov');
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) assert.notEqual(ditherKeep(m, x, y), ditherKeep(c, x, y), 'exactly one of mesh/card per cell');
  }
  assert.equal(mesh[meshIds.indexOf(0)][13] >>> 16, 0, 'below impM: no dither bits');
  assert.equal(card[cardIds.indexOf(6)][13] & LDT_ACTIVE, 0, 'beyond the band: card undithered');
  assert.equal(impBandBits(59, 60, 0), 0); assert.equal(impBandBits(68, 60, 1), 0);
  assert.equal(IMP_BAND_M, 8);
}

// 3. texel decode == bake values; world normal = bake normal rotated by view + yaw
{
  let covered = -1;
  for (let i = 0; i < 1024 && covered < 0; i++) if (imp.bytes[impMipOffset(3, 0) + i * 8 + 5]) covered = i;
  assert.ok(covered >= 0);
  const tx = covered % 32, ty = (covered / 32) | 0;
  const u = (tx + 0.5) / 32 * 2 * imp.radius - imp.radius, v = imp.vMax - (ty + 0.5) / 32 * (imp.vMax - imp.vMin);
  assert.equal(impTexelOffset(imp, 3, 0, u, v), impMipOffset(3, 0) + covered * 8);
  const out = {}; const yaw = 0.7;
  assert.ok(impDecodeTexel(imp, 3, 0, u, v, yaw, out));
  const base = impMipOffset(3, 0) + covered * 8, nl = new Float64Array(3);
  decodeImpNormal(imp.bytes, base, nl);
  const th = 3 * Math.PI / 4 + yaw;
  assert.ok(Math.abs(out.nx - (nl[0] * Math.cos(th) - nl[1] * Math.sin(th))) < 1 / 127);
  assert.ok(Math.abs(out.ny - (nl[0] * Math.sin(th) + nl[1] * Math.cos(th))) < 1 / 127);
  assert.ok(Math.abs(out.nz - nl[2]) < 1 / 127);
  assert.equal(out.mat, imp.bytes[base]);
  const q = imp.bytes[base + 4] > 127 ? imp.bytes[base + 4] - 256 : imp.bytes[base + 4];
  assert.equal(out.o, q / 127 * imp.radius);
  assert.equal(impMipPick(40), 0); assert.equal(impMipPick(20), 1); assert.equal(impMipPick(5), 2);
}

// 4. card raster: KIND_MESH cells, depth = card plane (+- radius offset), dither, no shadow, deterministic
const C = 120, R = 60;
const cam = { x: 0, y: 0, z: 6, yawDeg: 0, pitchDeg: 0 };
const M = new Float64Array(16);
let tgt = null;
for (const yw of [0, 90, 180, 270]) {
  cam.yawDeg = yw; const terms = {}; projTerms(cam, { cols: C, rows: R, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M);
  const ib = createInstanceBuffer(1);
  for (const [x, y] of [[0, 25], [0, -25], [25, 0], [-25, 0]]) {
    writeUnitInstance(ib, 0, x, y, 0, 0, 0x777, 0);
    const t = createRasterTarget(C, R, 1);
    rasterCards(ib, 1, imp, t, { M }, cam);
    let n = 0; for (let i = 0; i < t.kind.length; i++) if (t.kind[i] === KIND_MESH) n++;
    if (n > 40 && !tgt) { const cp = createInstanceBuffer(1); cp.u32.set(ib.u32); tgt = { t, n, ib: cp, Mc: Float64Array.from(M) }; }
  }
}
assert.ok(tgt, 'a far tree card draws KIND_MESH cells');
M.set(tgt.Mc);
{
  const t = tgt.t;
  let minD = Infinity, maxD = -Infinity, cells = 0;
  const n = new Float64Array(3);
  for (let i = 0; i < t.kind.length; i++) if (t.kind[i] === KIND_MESH) {
    cells++; minD = Math.min(minD, t.depth[i]); maxD = Math.max(maxD, t.depth[i]);
    assert.equal(t.objectId[i], 0x777); assert.equal(t.aoD[i], Infinity); assert.equal(t.vao[i], 1);
    unpackNormalOct(t.nrm[i], n); assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 0.02, 'unit normal');
  }
  assert.equal(cells, tgt.n);
  assert.ok(minD > 25 - imp.radius * 1.2 - 3 && maxD < 25 + imp.radius * 1.2 + 3, `depth ${minD}..${maxD} near plane 25 (radius ${imp.radius})`);
  const ib2 = createInstanceBuffer(1); ib2.u32.set(tgt.ib.u32.subarray(0, 16)); ib2.u32[13] = (LDT_ACTIVE | (128 << 16) | (1 << 25)) >>> 0;
  const t2 = createRasterTarget(C, R, 1); rasterCards(ib2, 1, imp, t2, { M }, cam);
  let n2 = 0; for (let i = 0; i < t2.kind.length; i++) if (t2.kind[i] === KIND_MESH) n2++;
  assert.ok(n2 > cells * 0.3 && n2 < cells * 0.7, `inverted dither keeps about half (${n2} of ${cells})`);
  const t3 = createRasterTarget(C, R, 1, { depthOnly: true }); rasterCards(tgt.ib, 1, imp, t3, { M }, cam);
  assert.ok(t3.zbuf.every((z) => z === 1), 'depth-only (shadow) target untouched');
  const t4 = createRasterTarget(C, R, 1); rasterCards(tgt.ib, 1, imp, t4, { M }, cam);
  assert.deepEqual(Buffer.from(t4.nrm.buffer), Buffer.from(t.nrm.buffer)); assert.deepEqual(Buffer.from(t4.depth.buffer), Buffer.from(t.depth.buffer));
}

// 5. impostors OFF = unchanged: no imp / impM 0 compacts exactly like before, card bucket empty
{
  const dists = [5, 40, 90, 150, 280];
  const a = makeInstanceGroup('a', 5), b = mkGroup(5, true);
  b.impM = 0;
  for (const g of [a, b]) { g.maxDistM = 200; g.count = 5; dists.forEach((d, i) => writeUnitInstance(g.ib, i, d * 0.6, d * 0.8, 1, i * 30, 50 + i, 0)); }
  compactGroup(a, null, 5, null, 0, 0, { x: 0, y: 0, z: 0 }); compactGroup(b, null, 5, null, 0, 0, { x: 0, y: 0, z: 0 });
  assert.equal(a.drawCount[0], 4); assert.equal(a.drawCount[0], b.drawCount[0]); assert.equal(b.cardCount, 0); assert.equal(a.cardCount, 0);
  assert.deepEqual(Buffer.from(a.drawIb[0].u32.buffer, 0, a.drawCount[0] * 64), Buffer.from(b.drawIb[0].u32.buffer, 0, b.drawCount[0] * 64));
  const t = createRasterTarget(C, R, 1); const before = Buffer.from(t.kind.buffer).toString('hex');
  rasterCards(b.cardIb, 0, imp, t, { M }, cam); assert.equal(Buffer.from(t.kind.buffer).toString('hex'), before);
}

// 6. zero allocation per frame (needs --expose-gc)
if (typeof global.gc === 'function') {
  const t = createRasterTarget(C, R, 1);
  const g = mkGroup(64, true);
  const eyeP = { x: 0, y: 0, z: 6 };
  for (let i = 0; i < 64; i++) writeUnitInstance(g.ib, i, (i % 8) * 6 - 20, 66 + (i >> 3) * 2, 0, i * 11, i, 0);
  const measure = (name, fn) => {
    for (let i = 0; i < 400; i++) fn();
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300; i++) fn();
    const d = process.memoryUsage().heapUsed - h0;
    assert.ok(d < 64 * 1024, `${name}: heap grew ${d} B over 300 frames`);
  };
  measure('compactGroup', () => compactGroup(g, null, 5, null, 0, 0, eyeP));
  measure('rasterCards', () => rasterCards(g.cardIb, g.cardCount, imp, t, { M }, cam));
} else console.log('  (gc probe skipped: run with node --expose-gc)');
console.log('impostorCard.test: PASS');
