// engine/mesh/rasterInstancedMask.test.js - ALPHA-01f step (a) (docs/architecture.md 37.17 items 2-4, 10; docs/backlog.md
// ALPHA-01f). The CPU/JS raster twin of the DRAW_INSTANCED path (rasterJS.js `rasterInstanced`) must apply the same
// per-range alpha mask (discard + two-sided flip) as the non-instanced static masked path. Oracle: an instanced draw
// of N copies of a (bark opaque + leaf masked) kind-9 mesh must be byte-identical, cell by cell, to N separate
// DRAW_STATIC draws of the same mesh at the same world positions. A direct DrawList.addInstances() call is used (not
// InstanceGroups.meshGroup(), which still throws on masked ranges until the production wiring step) so this test
// exercises rasterJS.js's capability in isolation. Run: node engine/mesh/rasterInstancedMask.test.js
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { DrawList, DRAW_STATIC, MeshDrawCache } from './DrawList.js';
import { buildMeshFromTris } from './gltf.js';
import { createInstanceBuffer, createInstanceParts, writeUnitInstance } from './instances.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { MaskAtlas, cutoffByte } from '../render/MaskAtlas.js';
import { KIND_MESH } from '../render/GBuffer.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 300, ROWS = 120, CUT = 0.5;
const atlas = new MaskAtlas();
const checker = new Uint8Array(16);
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) checker[j * 4 + i] = (i + j) % 2 === 0 ? 255 : 0;
atlas.add('test/Checker', 4, 4, checker);

// One "tree" unit, local space: a 2 m bark quad (x in [-2,0], opaque) next to a 2 m leaf quad (x in [0,2], masked),
// both facing -y at y=0, z in [0,2] (same size/uv layout as rasterMask.test.js's quadB, for the same checker coverage
// behaviour). Two ranges (opaque first, matching 37.17 item 1's range order), so the instanced per-range loop
// (rasterJS.js rasterInstanced) exercises exactly 2 iterations per instance, same as the static per-range loop.
function quad(x0, z0) {
  return [
    { p0: [x0, 0, z0], p1: [x0 + 2, 0, z0], p2: [x0 + 2, 0, z0 + 2], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 1], uv2: [1, 0] },
    { p0: [x0, 0, z0], p1: [x0 + 2, 0, z0 + 2], p2: [x0, 0, z0 + 2], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 0], uv2: [0, 0] },
  ];
}
const barkTris = quad(-2, 0), leafTris = quad(0, 0);
const unitTris = [...barkTris, ...leafTris];
const unitRanges = [
  { part: 'bark', triStart: 0, triCount: 2 },
  { part: 'leaf', triStart: 2, triCount: 2, mask: { tex: 'test/Checker', cutoff: CUT } },
];
const unitMesh = buildMeshFromTris(unitTris, unitRanges, 'test/unit');
unitMesh.mats = { leaf: 'leaf' };
// All-opaque twin (no mask on the leaf range) - used only to measure "fully solid" coverage of the leaf footprint.
const opaqueRanges = [{ part: 'bark', triStart: 0, triCount: 2 }, { part: 'leaf', triStart: 2, triCount: 2 }];
const opaqueMesh = buildMeshFromTris(unitTris, opaqueRanges, 'test/unitOpaque');
opaqueMesh.mats = { leaf: 'leaf' };

const idFor = () => 5;
const cache = new MeshDrawCache();
const unit = cache.get(unitMesh, idFor, atlas);
const opaqueUnit = cache.get(opaqueMesh, idFor, atlas);
ok('unit mesh resolves maskRanges = opaque (w -1) then masked', unit.maskRanges && unit.maskRanges.join() === `0,0,-1,0,0,0,0,4,4,${cutoffByte(CUT)}`, String(unit.maskRanges));
ok('opaque twin has no maskRanges', !opaqueUnit.maskRanges);

const N = 4, DX = 6; // instances spaced 6 m apart on x: no overlap between neighbouring units (unit footprint is 4 m wide)
const cam = { x: 1, y: -3, z: 1, yawDeg: 180, pitchDeg: 0 }; // yawDeg 180 looks +y (rasterMask.test.js convention) - the quads face -y

function setup() {
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols: COLS, rows: ROWS }, terms);
  shearProjection(terms, M);
  return { terms, M };
}

/** Builds N instances of `mesh` at world x = i*DX, via DrawList.addInstances (not InstanceGroups.meshGroup - bypasses its masked-ranges guard on purpose: this test is about rasterJS.js's capability, the production wiring gate is a later step). */
function renderInstanced(mesh) {
  const { M } = setup();
  const ib = createInstanceBuffer(N);
  for (let i = 0; i < N; i++) writeUnitInstance(ib, i, i * DX, 0, 0, 0, i, 0);
  const parts = createInstanceParts();
  // identity part matrix at slot 0 (bark range) AND slot 1 (leaf range) - one placement, two material ranges.
  parts.m[0] = 1; parts.m[4] = 1; parts.m[8] = 1;
  parts.m[12] = 1; parts.m[16] = 1; parts.m[20] = 1;
  const list = new DrawList(2);
  list.begin();
  list.addInstances(mesh, parts, ib, N, 5);
  const target = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, target, { M, maskAtlas: atlas });
  return target;
}

/** N separate DRAW_STATIC draws of `mesh`, same world positions as `renderInstanced` - the oracle. */
function renderStatic(mesh) {
  const { M } = setup();
  const list = new DrawList(N + 1);
  list.begin();
  for (let i = 0; i < N; i++) {
    const it = list.push(mesh, DRAW_STATIC);
    it.rangeFirst = 0; it.rangeCount = mesh.triCount;
    it.matrix[9] = i * DX; it.matrix[10] = 0; it.matrix[11] = 0;
    it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
    it.planeIdOr = (i & 0xF) << 24; // matches rasterInstanced's `(oid & 0xF) << 24` for oid = i
    it.objectId = i;
  }
  const target = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, target, { M, maskAtlas: atlas });
  return target;
}

const inst = renderInstanced(unit);
const stat = renderStatic(unit);
const statOpaque = renderStatic(opaqueUnit);

// --- Main oracle: instanced masked draw of N instances == N single masked draws, byte-identical ---
{
  let n = inst.kind.length, mism = 0, solid = 0;
  const bad = [];
  for (let i = 0; i < n; i++) {
    if (inst.kind[i] !== stat.kind[i] || inst.depth[i] !== stat.depth[i] || inst.planeId[i] !== stat.planeId[i]
      || inst.mat[i] !== stat.mat[i] || inst.nrm[i] !== stat.nrm[i] || inst.objectId[i] !== stat.objectId[i]) {
      mism++;
      if (bad.length < 3) bad.push(`i=${i} inst(k${inst.kind[i]},d${inst.depth[i]},p${inst.planeId[i]}) vs stat(k${stat.kind[i]},d${stat.depth[i]},p${stat.planeId[i]})`);
    }
    if (inst.kind[i] === KIND_MESH) solid++;
  }
  ok(`instanced (${N} instances) byte-identical to ${N} single masked draws (kind/depth/planeId/mat/nrm/objectId)`, mism === 0 && solid > 1000, `mism=${mism} solid=${solid} ${bad.join('; ')}`);
}

// --- Opaque ranges unaffected: the bark region of the instanced render matches a bark-only reference exactly ---
{
  const barkOnlyMesh = buildMeshFromTris(barkTris, [{ part: 'bark', triStart: 0, triCount: 2 }], 'test/barkOnly');
  barkOnlyMesh.mats = { leaf: 'leaf' };
  const barkOnly = cache.get(barkOnlyMesh, idFor, atlas);
  const instBark = renderInstanced(barkOnly), statBark = renderStatic(barkOnly);
  let mismI = 0, mismS = 0, cov = 0;
  for (let i = 0; i < instBark.kind.length; i++) {
    if (instBark.kind[i] === KIND_MESH) {
      cov++;
      // the same bark cell in the mixed-mesh instanced/static renders must show the identical opaque bark fragment
      if (inst.kind[i] !== KIND_MESH || inst.depth[i] !== instBark.depth[i]) mismI++;
      if (stat.kind[i] !== KIND_MESH || stat.depth[i] !== statBark.depth[i]) mismS++;
    }
  }
  ok('opaque (bark) range unaffected in the instanced render vs a bark-only reference', cov > 300 && mismI === 0, `cov=${cov} mismI=${mismI}`);
  ok('opaque (bark) range unaffected in the static render vs a bark-only reference (sanity)', cov > 300 && mismS === 0, `cov=${cov} mismS=${mismS}`);
}

// --- Mutation guard: the masked (leaf) range must actually have holes in the instanced render (catches "mask ignored" --
// the bug this story fixes: before the rasterInstanced fix, _mW stayed -1 for every range, so the leaf range rendered
// fully solid, same as the opaque reference, and this check alone (independent of the stat/inst equality above) fails.
{
  let leafCov = 0, leafFullCov = 0;
  for (let i = 0; i < inst.kind.length; i++) {
    if (statOpaque.kind[i] === KIND_MESH) {
      leafFullCov++;
      if (inst.kind[i] === KIND_MESH) leafCov++;
    }
  }
  const pct = leafCov / leafFullCov;
  ok('masked range has holes in the instanced render (30-70% of the fully-opaque footprint - mask is actually applied)', pct > 0.3 && pct < 0.7, `leafCov=${leafCov} leafFullCov=${leafFullCov} pct=${pct.toFixed(3)}`);
}

// --- opaque-only mesh groups (no mask at all): unaffected regression guard - same shape as a plain tree trunk group ---
{
  const barkOnlyMesh2 = buildMeshFromTris(barkTris, [{ part: 'bark', triStart: 0, triCount: 2 }], 'test/barkOnly2');
  barkOnlyMesh2.mats = { leaf: 'leaf' };
  const barkOnly2 = cache.get(barkOnlyMesh2, idFor, atlas);
  const a = renderInstanced(barkOnly2), b = renderStatic(barkOnly2);
  let mism = 0, solid = 0;
  for (let i = 0; i < a.kind.length; i++) { if (a.kind[i] !== b.kind[i] || a.depth[i] !== b.depth[i]) mism++; if (a.kind[i] === KIND_MESH) solid++; }
  ok('opaque-only instanced mesh (no maskRanges) still matches its static oracle exactly', mism === 0 && solid > 300, `mism=${mism} solid=${solid}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
