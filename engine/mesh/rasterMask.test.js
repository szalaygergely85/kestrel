// engine/mesh/rasterMask.test.js - ALPHA-01b (docs/architecture.md 37.17 items 2-4, 10). Run: node engine/mesh/rasterMask.test.js
// A masked 2 m quad (4x4 checker mask) vs a brute-force ray/quad oracle at 400x150; back view flips normals; opaque ranges
// unaffected; the depth-only (shadow) twin skips the same fragments; 0 allocation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRasterTarget, clearRasterTarget, rasterDrawList } from './rasterJS.js';
import { DrawList, DRAW_STATIC, MeshDrawCache } from './DrawList.js';
import { buildMeshFromTris } from './gltf.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { MaskAtlas, cutoffByte } from '../render/MaskAtlas.js';
import { KIND_MESH, FACE_PACKED } from '../render/GBuffer.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 400, ROWS = 150, CUT = 0.5;
const atlas = new MaskAtlas();
atlas.add('test/Dummy', 2, 2, new Uint8Array([255, 255, 255, 255])); // the checker is NOT at 0,0: exercises the rect offset
const checker = new Uint8Array(16);
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) checker[j * 4 + i] = (i + j) % 2 === 0 ? 255 : 0;
atlas.add('test/Checker', 4, 4, checker);

// quad: 2 m x 2 m, yawed 35 deg about its centre so the normal is not axis aligned (face 7 packed); uv = unit square,
// v = 0 at the top edge (image row 0 = top).
const YAW = 35 * Math.PI / 180, CX = 0.4, CY = 3, CZ = 1.5;
const lx = Math.cos(YAW), ly = Math.sin(YAW);
function corner(s, t) { return [CX + s * lx, CY + s * ly, CZ + t]; } // s, t in [-1, 1]
const P = { tl: corner(-1, 1), tr: corner(1, 1), br: corner(1, -1), bl: corner(-1, -1) };
const uvOf = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
function faceNormal(a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
}
function makeTri(ka, kb, kc, matName) {
  return { p0: P[ka], p1: P[kb], p2: P[kc], normal: faceNormal(P[ka], P[kb], P[kc]), matName, uv0: uvOf[ka], uv1: uvOf[kb], uv2: uvOf[kc] };
}
let tris = [makeTri('tl', 'bl', 'br', 'leaf'), makeTri('tl', 'br', 'tr', 'leaf')];
if (tris[0].normal[1] > 0) tris = [makeTri('tl', 'br', 'bl', 'leaf'), makeTri('tl', 'tr', 'br', 'leaf')];
const maskedMesh = buildMeshFromTris(tris, [{ part: 'leaf', triStart: 0, triCount: 2, mask: { tex: 'test/Checker', cutoff: CUT } }], 'test/maskquad');
maskedMesh.mats = { leaf: 'leaf' };
const opaqueMesh = buildMeshFromTris(tris, [{ part: 'leaf', triStart: 0, triCount: 2 }], 'test/opaquequad');
opaqueMesh.mats = { leaf: 'leaf' };
const idFor = () => 5;
const cache = new MeshDrawCache();
const masked = cache.get(maskedMesh, idFor, atlas);
const opaque = cache.get(opaqueMesh, idFor, atlas);

ok('maskRanges resolved: [x0,y0,w,h,cutoffByte]', masked.maskRanges && masked.maskRanges.join() === `2,0,4,4,${cutoffByte(CUT)}`, String(masked.maskRanges));
ok('opaque mesh has no maskRanges', !opaque.maskRanges);
{
  const m2 = buildMeshFromTris(tris, [{ part: 'leaf', triStart: 0, triCount: 2, mask: { tex: 'test/Missing', cutoff: 0.5 } }], 'test/bad'); m2.mats = { leaf: 'leaf' };
  let msg = ''; try { new MeshDrawCache().get(m2, idFor, atlas); } catch (e) { msg = e.message; }
  ok('missing mask throws naming mesh and tex', /mesh "test\/bad": mask "test\/Missing" not in the atlas/.test(msg), msg);
  let msg2 = ''; try { new MeshDrawCache().get(m2, idFor, null); } catch (e) { msg2 = e.message; }
  ok('no atlas throws', /need a MaskAtlas/.test(msg2), msg2);
}

function setup(cam, cols = COLS, rows = ROWS) {
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols, rows }, terms);
  shearProjection(terms, M);
  return { terms, M };
}
function render(mesh, cam) {
  const { M, terms } = setup(cam);
  const list = new DrawList(4);
  list.begin();
  const it = list.push(mesh, DRAW_STATIC);
  it.rangeFirst = 0; it.rangeCount = mesh.triCount; it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
  it.planeIdOr = 3 << 20; it.objectId = 0xA000;
  const target = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, target, { M, maskAtlas: atlas });
  return { target, terms };
}

// brute-force oracle: ray vs the quad plane, same texel rule (atlas.sample)
function oracle(terms, col, row, useMask) {
  const cx = (2 * (col + 0.5)) / terms.cols - 1;
  const rdx = terms.dirX + terms.planeX * cx, rdy = terms.dirY + terms.planeY * cx;
  const slope = (terms.horizonRow - (row + 0.5)) / terms.planeDistY;
  const nx = -ly, ny = lx; // plane normal
  const den = nx * rdx + ny * rdy;
  if (Math.abs(den) < 1e-12) return null;
  const t = (nx * (CX - terms.eyeX) + ny * (CY - terms.eyeY)) / den;
  if (t <= 0) return null;
  const hx = terms.eyeX + rdx * t, hy = terms.eyeY + rdy * t, hz = terms.eyeZ + slope * t;
  const s = (hx - CX) * lx + (hy - CY) * ly, tt = hz - CZ;
  const edge = Math.min(1 - Math.abs(s), 1 - Math.abs(tt));
  if (s < -1 || s > 1 || tt < -1 || tt > 1) return { hit: false, edge, bnd: 1, t };
  const u = (s + 1) / 2, v = (1 - tt) / 2;
  const fu = Math.abs(u * 4 - Math.round(u * 4)), fv = Math.abs(v * 4 - Math.round(v * 4));
  const bnd = Math.min(fu, fv) / 4;
  const a = useMask ? atlas.sample(2, 0, 4, 4, u, v) : 255;
  return { hit: a >= cutoffByte(CUT), t, edge, bnd };
}

function compare(target, terms, useMask) {
  let solid = 0, mism = 0, ambiguous = 0, covered = 0;
  const bad = [];
  const expPlane = (masked.flat[0] | (3 << 20)) | 0;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const idx = row * COLS + col;
    const o = oracle(terms, col, row, useMask);
    const gotHit = target.kind[idx] === KIND_MESH;
    if (gotHit) covered++;
    const expHit = !!(o && o.hit);
    if (gotHit === expHit) {
      if (gotHit) {
        solid++;
        const dok = Math.abs(target.depth[idx] - o.t) < 2e-3 * o.t;
        if (!dok || target.planeId[idx] !== expPlane) { mism++; if (bad.length < 3) bad.push(`(${col},${row}) depth ${target.depth[idx]} vs ${o.t} plane ${target.planeId[idx]}`); }
      }
    } else if (o && (o.edge < 0.01 || o.bnd < 0.004)) {
      ambiguous++; // the sample straddles a quad edge / texel boundary within sub-pixel precision
    } else { mism++; if (bad.length < 3) bad.push(`(${col},${row}) got ${gotHit} expected ${expHit}`); }
  }
  return { solid, mism, ambiguous, covered, bad };
}
const countKind = (t) => { let n = 0; for (let i = 0; i < t.kind.length; i++) if (t.kind[i] === KIND_MESH) n++; return n; };

const frontCam = { x: 0, y: 0, z: 1.5, yawDeg: 180, pitchDeg: 0 }; // looks +y: the quad's -y side
const backCam = { x: CX * 2, y: 2 * CY, z: 1.5, yawDeg: 0, pitchDeg: 0 }; // looks -y: the quad's +y side
{
  const r = render(masked, frontCam);
  const c = compare(r.target, r.terms, true);
  ok(`masked quad == oracle at ${COLS}x${ROWS}: kind/planeId/depth, 0 mismatches`, c.mism === 0 && c.solid > 500, `mism=${c.mism} solid=${c.solid} amb=${c.ambiguous} ${c.bad.join('; ')}`);
  const ro = render(opaque, frontCam);
  const n = countKind(ro.target);
  ok('checker leaves holes (30..70% of the opaque footprint)', c.covered > n * 0.3 && c.covered < n * 0.7, `${c.covered} of ${n}`);
  const co = compare(ro.target, ro.terms, false);
  ok('opaque range: oracle (no mask) matches, 0 mismatches', co.mism === 0 && co.solid > 1500, `mism=${co.mism} solid=${co.solid} ${co.bad.join('; ')}`);
  let leaks = 0;
  for (let i = 0; i < r.target.kind.length; i++) if (r.target.kind[i] === 0 && (r.target.zbuf[i] !== 1 || r.target.planeId[i] !== 0)) leaks++;
  ok('discarded fragments write nothing (empty cells keep zbuf 1)', leaks === 0, `leaks=${leaks}`);
  let packed = 0, other = 0;
  for (let i = 0; i < r.target.kind.length; i++) if (r.target.kind[i] === KIND_MESH) { if (r.target.face[i] === FACE_PACKED) packed++; else other++; }
  ok('masked cells use face 7 packed', packed > 0 && other === 0);
}

// two-sided: the normal faces the camera from both sides (back view flipped); an opaque kind-9 range does not flip
{
  const out = [0, 0, 1];
  const nOf = (target) => { for (let i = 0; i < target.kind.length; i++) if (target.kind[i] === KIND_MESH) { unpackNormalOct(target.nrm[i], out); return [out[0], out[1], out[2]]; } return null; };
  const rf = render(masked, frontCam), rb = render(masked, backCam);
  const nf = nOf(rf.target), nb = nOf(rb.target);
  const dotF = nf ? nf[0] * (frontCam.x - CX) + nf[1] * (frontCam.y - CY) : 0;
  const dotB = nb ? nb[0] * (backCam.x - CX) + nb[1] * (backCam.y - CY) : 0;
  ok('front view: normal faces the camera', nf && dotF > 0, JSON.stringify(nf));
  ok('back view: normal is flipped, faces the camera', nb && dotB > 0, JSON.stringify(nb));
  ok('front and back normals are opposite', nf && nb && nf[0] * nb[0] + nf[1] * nb[1] + nf[2] * nb[2] < -0.99, `${JSON.stringify(nf)} ${JSON.stringify(nb)}`);
  ok('back view still renders masked holes (coverage 30..70% of the opaque back view)', (() => { const ob = render(opaque, backCam); const a = countKind(rb.target), b = countKind(ob.target); return b > 500 && a > b * 0.3 && a < b * 0.7; })());
  const ob = render(opaque, backCam);
  const no = nOf(ob.target);
  const dotO = no ? no[0] * (backCam.x - CX) + no[1] * (backCam.y - CY) : 0;
  ok('opaque kind-9 range: back face NOT flipped (unchanged behaviour)', no && dotO < 0, JSON.stringify(no));
}

// shadow twin: the depth-only raster skips the same fragments (zbuf bit-identical to the colour raster)
{
  const { M } = setup(frontCam);
  const mk = (mesh, depthOnly) => {
    const list = new DrawList(4); list.begin();
    const it = list.push(mesh, DRAW_STATIC); it.rangeFirst = 0; it.rangeCount = mesh.triCount;
    const t = createRasterTarget(COLS, ROWS, 1, depthOnly ? { depthOnly: true } : {});
    rasterDrawList(list, t, { M, maskAtlas: atlas });
    return t;
  };
  const full = mk(masked, false), only = mk(masked, true);
  let same = true, cov = 0;
  for (let i = 0; i < full.zbuf.length; i++) { if (full.zbuf[i] !== only.zbuf[i]) same = false; if (only.zbuf[i] < 1) cov++; }
  ok('shadow twin (depth-only) zbuf == colour raster zbuf', same && cov > 500, `cov=${cov}`);
  const solid = mk(opaque, true);
  let ocov = 0; for (let i = 0; i < solid.zbuf.length; i++) if (solid.zbuf[i] < 1) ocov++;
  ok('shadow twin leaves holes (30..70% of the opaque quad)', cov > ocov * 0.3 && cov < ocov * 0.7, `${cov} vs ${ocov}`);
}

// mixed mesh: an opaque range + a masked range -> per-range loop, the opaque part renders exactly as alone
{
  const quadB = (dx) => [{ p0: [dx, 3, 0.5], p1: [dx + 1, 3, 0.5], p2: [dx + 1, 3, 1.5], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 1], uv2: [1, 0] },
    { p0: [dx, 3, 0.5], p1: [dx + 1, 3, 1.5], p2: [dx, 3, 1.5], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 0], uv2: [0, 0] }];
  const mixed = buildMeshFromTris([...quadB(-2), ...quadB(1)], [
    { part: 'bark', triStart: 0, triCount: 2 }, { part: 'leaf', triStart: 2, triCount: 2, mask: { tex: 'test/Checker', cutoff: CUT } }], 'test/mixed');
  mixed.mats = { leaf: 'leaf' };
  const only = buildMeshFromTris(quadB(-2), [{ part: 'bark', triStart: 0, triCount: 2 }], 'test/onlyopaque'); only.mats = { leaf: 'leaf' };
  const cm = new MeshDrawCache();
  const mm = cm.get(mixed, idFor, atlas);
  const a = render(mm, frontCam), b = render(cm.get(only, idFor, atlas), frontCam);
  ok('mixed mesh: maskRanges = opaque (w -1) then masked', mm.maskRanges.join() === `0,0,-1,0,0,2,0,4,4,${cutoffByte(CUT)}`, mm.maskRanges.join());
  let left = 0, leftSame = 0, rightCov = 0;
  for (let i = 0; i < ROWS * COLS; i++) {
    if (b.target.kind[i] === KIND_MESH) { left++; if (a.target.kind[i] === KIND_MESH && a.target.depth[i] === b.target.depth[i] && a.target.mat[i] === b.target.mat[i]) leftSame++; }
    else if (a.target.kind[i] === KIND_MESH) rightCov++;
  }
  ok('mixed mesh: the opaque range renders exactly as alone', left > 500 && left === leftSame, `${leftSame}/${left}`);
  ok('mixed mesh: the masked range is present (with holes)', rightCov > 100, `rightCov=${rightCov}`);
}

// zero allocation over 1000 frames (camera + shadow feeds). The raster loop itself carries a small pre-existing residue
// (~100 B/frame: boxed doubles in module scratch, identical for an opaque mesh), so the gate is "masked == opaque baseline".
{
  const { M } = setup(frontCam, 100, 40);
  const small = createRasterTarget(100, 40, 1, {}), smallD = createRasterTarget(100, 40, 1, { depthOnly: true });
  const grow = (mesh) => {
    const list = new DrawList(4); list.begin();
    const it = list.push(mesh, DRAW_STATIC); it.rangeFirst = 0; it.rangeCount = mesh.triCount; it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
    const ctx = { M, maskAtlas: atlas };
    const frame = () => { clearRasterTarget(small); rasterDrawList(list, small, ctx); clearRasterTarget(smallD); rasterDrawList(list, smallD, ctx); };
    for (let i = 0; i < 20; i++) frame();
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) frame();
    global.gc();
    return process.memoryUsage().heapUsed - before;
  };
  const gOpaque = grow(opaque), gMasked = grow(masked);
  ok('0 extra allocation over 1000 masked frames (colour + depth-only) vs the opaque baseline', gMasked - gOpaque < 16 * 1024 && gMasked < 256 * 1024, `masked=${gMasked} opaque=${gOpaque}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
