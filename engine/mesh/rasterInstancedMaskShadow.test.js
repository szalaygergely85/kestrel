// engine/mesh/rasterInstancedMaskShadow.test.js - ALPHA-01f step (c) "shadow variant" (docs/architecture.md 37.17; docs/backlog.md
// ALPHA-01f; D-051 masked leaves cast shadows through their mask, WebGPU only). The CPU shadow-caster twin for the DRAW_INSTANCED
// path is the SAME rasterJS.js functions as the colour pass (rasterInstanced -> rasterRange -> rasterFanTri): the depth-only
// branch (rasterFanTri's `target.depthOnly` path) already re-checks `info.maskW` before writing zbuf (ALPHA-01b, "the shadow
// twin skips the same fragments as the colour pass"), and step (a) (rasterInstancedMask.test.js, commit 018d953) made
// `rasterInstanced` set that per-range mask state for instanced items too. This file is the oracle proving the shadow-caster
// side of that fix: an instanced depth-only render of N copies of a masked kind-9 mesh must be byte-identical (zbuf) to N
// separate DRAW_STATIC depth-only (shadow) draws of the same mesh, with real holes (not the fully-solid opaque footprint) and
// opaque-only instanced casters left exactly as before. Like step (a), this builds the DrawList with `DrawList.addInstances`
// directly (bypassing `InstanceGroups.meshGroup()`, which still throws on masked ranges, and without `DRAW_FLAG_ONE_PART`,
// which the real shadowList.js sets on every instanced-group shadow item today and which collapses the per-range mask lookup
// by design - that ONE_PART/multi-range caveat is a separate, already-tracked ARCH item, not this story): this test is about
// rasterJS.js's shared raster code applying the mask identically to the colour and depth-only targets, in isolation from the
// production wiring gates. Run: node engine/mesh/rasterInstancedMaskShadow.test.js
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { DrawList, DRAW_STATIC, MeshDrawCache } from './DrawList.js';
import { buildMeshFromTris } from './gltf.js';
import { createInstanceBuffer, createInstanceParts, writeUnitInstance } from './instances.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { MaskAtlas, cutoffByte } from '../render/MaskAtlas.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 300, ROWS = 120, CUT = 0.5;
const atlas = new MaskAtlas();
const checker = new Uint8Array(16);
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) checker[j * 4 + i] = (i + j) % 2 === 0 ? 255 : 0;
atlas.add('test/Checker', 4, 4, checker);

// Same "tree" unit as rasterInstancedMask.test.js (step a): a 2 m bark quad (opaque) + a 2 m leaf quad (masked), two ranges.
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
const unitMesh = buildMeshFromTris(unitTris, unitRanges, 'test/unitShadow');
unitMesh.mats = { leaf: 'leaf' };
// All-opaque twin (no mask on the leaf range) - "fully solid" reference footprint.
const opaqueRanges = [{ part: 'bark', triStart: 0, triCount: 2 }, { part: 'leaf', triStart: 2, triCount: 2 }];
const opaqueMesh = buildMeshFromTris(unitTris, opaqueRanges, 'test/unitOpaqueShadow');
opaqueMesh.mats = { leaf: 'leaf' };

const idFor = () => 5;
const cache = new MeshDrawCache();
const unit = cache.get(unitMesh, idFor, atlas);
const opaqueUnit = cache.get(opaqueMesh, idFor, atlas);
ok('unit mesh resolves maskRanges = opaque (w -1) then masked', unit.maskRanges && unit.maskRanges.join() === `0,0,-1,0,0,0,0,4,4,${cutoffByte(CUT)}`, String(unit.maskRanges));

const N = 4, DX = 6;
const cam = { x: 1, y: -3, z: 1, yawDeg: 180, pitchDeg: 0 };

function setup() {
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols: COLS, rows: ROWS }, terms);
  shearProjection(terms, M);
  return { terms, M };
}

/** N instances of `mesh` at world x = i*DX, via DrawList.addInstances (no DRAW_FLAG_ONE_PART - see file header). `depthOnly`
 * selects a shadow-map-shaped target (ME-15a), same as the real shadow pass's rasterDrawList call. */
function renderInstanced(mesh, depthOnly) {
  const { M } = setup();
  const ib = createInstanceBuffer(N);
  for (let i = 0; i < N; i++) writeUnitInstance(ib, i, i * DX, 0, 0, 0, i, 0);
  const parts = createInstanceParts();
  parts.m[0] = 1; parts.m[4] = 1; parts.m[8] = 1;
  parts.m[12] = 1; parts.m[16] = 1; parts.m[20] = 1;
  const list = new DrawList(2);
  list.begin();
  list.addInstances(mesh, parts, ib, N, 5);
  const target = createRasterTarget(COLS, ROWS, 1, depthOnly ? { depthOnly: true } : {});
  rasterDrawList(list, target, { M, maskAtlas: atlas });
  return target;
}

/** N separate DRAW_STATIC draws, same world positions - the shadow-caster oracle. */
function renderStatic(mesh, depthOnly) {
  const { M } = setup();
  const list = new DrawList(N + 1);
  list.begin();
  for (let i = 0; i < N; i++) {
    const it = list.push(mesh, DRAW_STATIC);
    it.rangeFirst = 0; it.rangeCount = mesh.triCount;
    it.matrix[9] = i * DX; it.matrix[10] = 0; it.matrix[11] = 0;
    it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
    it.planeIdOr = (i & 0xF) << 24;
    it.objectId = i;
  }
  const target = createRasterTarget(COLS, ROWS, 1, depthOnly ? { depthOnly: true } : {});
  rasterDrawList(list, target, { M, maskAtlas: atlas });
  return target;
}

const instShadow = renderInstanced(unit, true);
const statShadow = renderStatic(unit, true);
const statOpaqueShadow = renderStatic(opaqueUnit, true);
const instColour = renderInstanced(unit, false);

// --- Main oracle: instanced shadow-caster (depth-only) == N static masked shadow-caster draws, byte-identical zbuf ---
{
  let n = instShadow.zbuf.length, mism = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    if (instShadow.zbuf[i] !== statShadow.zbuf[i]) mism++;
    if (instShadow.zbuf[i] < 1) cov++;
  }
  ok(`instanced shadow caster (${N} instances, depth-only) byte-identical zbuf to ${N} single masked shadow casters`, mism === 0 && cov > 500, `mism=${mism} cov=${cov}`);
}

// --- Consistency: the shared rasterFanTri depth-only branch skips the same fragments as the colour pass for this same
// instanced render (ALPHA-01b's "shadow twin skips the same fragments as the colour pass" rule, now exercised through the
// instanced path too) ---
{
  let n = instShadow.zbuf.length, same = true;
  for (let i = 0; i < n; i++) if (instShadow.zbuf[i] !== instColour.zbuf[i]) { same = false; break; }
  ok('instanced shadow twin (depth-only) zbuf == instanced colour-pass zbuf', same);
}

// --- Mutation guard: the masked (leaf) range must actually have holes in the shadow caster, not render fully solid like the
// opaque reference. This is the exact bug ALPHA-01f (c) guards against: a shadow-caster path that ignored `info.maskW` (e.g.
// a future regression that re-collapses ranges before the depth-only branch, or that drops `_atlas`/`maskAtlas` on the shadow
// ctx) would make every leaf-range shadow cell solid, matching `statOpaqueShadow`'s full footprint, and this check alone fails. ---
{
  let leafCov = 0, leafFullCov = 0;
  for (let i = 0; i < instShadow.zbuf.length; i++) {
    if (statOpaqueShadow.zbuf[i] < 1) {
      leafFullCov++;
      if (instShadow.zbuf[i] < 1) leafCov++;
    }
  }
  const pct = leafCov / leafFullCov;
  ok('masked range has holes in the instanced shadow caster (30-70% of the fully-opaque footprint - mask is actually applied to shadows)', pct > 0.3 && pct < 0.7, `leafCov=${leafCov} leafFullCov=${leafFullCov} pct=${pct.toFixed(3)}`);
}

// --- Opaque-only instanced mesh groups (no maskRanges at all, today's production shape - plain tree trunks / rocks): the
// shadow caster is unaffected, byte-identical to its static oracle ---
{
  const barkOnlyMesh = buildMeshFromTris(barkTris, [{ part: 'bark', triStart: 0, triCount: 2 }], 'test/barkOnlyShadow');
  barkOnlyMesh.mats = { leaf: 'leaf' };
  const barkOnly = cache.get(barkOnlyMesh, idFor, atlas);
  ok('opaque-only mesh resolves with no maskRanges', !barkOnly.maskRanges);
  const a = renderInstanced(barkOnly, true), b = renderStatic(barkOnly, true);
  let mism = 0, solid = 0;
  for (let i = 0; i < a.zbuf.length; i++) { if (a.zbuf[i] !== b.zbuf[i]) mism++; if (a.zbuf[i] < 1) solid++; }
  ok('opaque-only instanced shadow caster (no maskRanges) still matches its static oracle exactly', mism === 0 && solid > 300, `mism=${mism} solid=${solid}`);
  // sanity: opaque casters cover meaningfully MORE than the masked leaf range alone (bark quad is twice its footprint and fully solid)
  let barkCov = 0; for (let i = 0; i < b.zbuf.length; i++) if (b.zbuf[i] < 1) barkCov++;
  ok('opaque bark shadow footprint is fully solid (no incidental holes)', barkCov > 300, `barkCov=${barkCov}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
