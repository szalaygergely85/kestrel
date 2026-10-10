// WG-4a: WgCullPass on the device mock. The mock never computes, so a small JS executor runs the kernel's per-instance logic
// (cull.wgsl.js helpers via wgslProbe, fed from the REAL uniform words / buffers the pass wrote) and the drawn SET is compared with the
// CPU cull (instances.js compactGroup + the distance test) on bench-like fixtures over several camera poses (LOD hysteresis state carries over).
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { makeInstanceGroup, compactGroup, INSTANCE_STRIDE, groupRadius } from '../../../mesh/instances.js';
import { frustumPlanes } from '../../../mesh/culling.js';
import { projTerms, shearProjection } from '../../projection.js';
import { CULL_WGSL, CULL_BLOCK } from '../wgsl/cull.wgsl.js';
import { compileFn } from '../wgsl/wgslProbe.js';
import { WgCullPass, MAX_CULL_RANGES } from './passCull.js';

const mock = makeMockGpuDevice(), d = mock.device;
const f32 = (x) => Math.fround(x);

// kernel executor: one dispatch, reading the pass's own uploaded buffers + uniform views
function execDispatch() {
  const { desc } = d._lastDispatch;
  const uf = desc.uniforms, uu = new Uint32Array(uf.buffer, uf.byteOffset, uf.length);
  const W = (n) => CULL_BLOCK.field(n).word;
  const v4 = (w) => ({ x: uf[w], y: uf[w + 1], z: uf[w + 2], w: uf[w + 3] });
  const u = { planes: [0, 1, 2, 3, 4, 5].map((i) => v4(W('planes') + i * 4)), eye: v4(W('eye')), lodRow: v4(W('lodRow')), params: v4(W('params')), count: uu[W('count')], lodOn: uu[W('lodOn')], slot0: uu[W('slot0')], slot1: uu[W('slot1')], swayPad: uf[W('swayPad')] };
  const aabbOutside = compileFn(CULL_WGSL, 'aabbOutside', { u }), pickLod = compileFn(CULL_WGSL, 'pickLod', { u }), distOut = compileFn(CULL_WGSL, 'distOut', { u });
  const [src, lodPrev, dst0, dst1, args] = desc.buffers.map((b) => b.buffer);
  const sU = src._gpu.u32, sF = new Float32Array(sU.buffer, sU.byteOffset, sU.length);
  for (let i = 0; i < u.count; i++) {
    const o = i * INSTANCE_STRIDE, tx = sF[o + 3], ty = sF[o + 7], tz = sF[o + 11];
    if (aabbOutside(tx, ty, tz)) continue;
    const lod = pickLod(tx, ty, tz, lodPrev._gpu.u32[i]);
    if (u.lodOn) lodPrev._gpu.u32[i] = lod;
    if (distOut(tx, ty, tz)) continue;
    const dst = lod ? dst1 : dst0, slot = lod ? u.slot1 : u.slot0;
    const w = args._gpu.u32[slot + 1]++ * INSTANCE_STRIDE;
    for (let c = 0; c < INSTANCE_STRIDE; c++) dst._gpu.u32[w + c] = sU[o + c];
  }
}
// give every mock buffer a CPU mirror so writeBuffer + the executor have memory (the mock only records)
const origCreate = d.createBuffer, origWrite = d.writeBuffer;
d.createBuffer = (desc) => {
  const h = origCreate(desc), n = desc.data ? desc.data.byteLength : desc.bytes;
  h._gpu = { u32: new Uint32Array(n / 4) };
  if (desc.data) h._gpu.u32.set(new Uint32Array(desc.data.buffer, desc.data.byteOffset, desc.data.byteLength / 4));
  return h;
};
d.writeBuffer = (h, data, off = 0) => { origWrite(h, data, off); h._gpu.u32.set(new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4), off / 4); };
d.dispatch = (pipeline, desc, x, y, z) => { d._dispatches = (d._dispatches || 0) + 1; d._lastDispatch = { pipeline, desc, x, y, z }; execDispatch(); };

const COLS = 160, ROWS = 60, grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 };
const mesh0 = { triCount: 300, bbox: [-1.5, -1.5, 0, 1.5, 1.5, 6], ranges: [{ first: 0, count: 900 }] };
const mesh1 = { triCount: 40, bbox: [-1.5, -1.5, 0, 1.5, 1.5, 6], ranges: [{ first: 0, count: 120 }] };

function makeGroup(n, lodCells) {
  const g = makeInstanceGroup('trees', n);
  g.parts.count = 1; g.parts.m[0] = 1; g.parts.m[4] = 1; g.parts.m[8] = 1;
  g.lodCells = lodCells; g.count = n;
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_STRIDE;
    g.ib.f32.set([1, 0, 0, f32((rnd() - 0.5) * 400), 0, 1, 0, f32((rnd() - 0.5) * 400), 0, 0, 1, f32(rnd() * 3)], o);
    g.ib.u32[o + 12] = 1000 + i; g.ib.u32[o + 13] = i & 3;
  }
  return g;
}
const rowKey = (u32, w) => Array.from(u32.subarray(w, w + INSTANCE_STRIDE)).join(',');
const setOf = (u32, n) => { const s = []; for (let i = 0; i < n; i++) s.push(rowKey(u32, i * INSTANCE_STRIDE)); return s.sort(); };

function pose(cam) {
  const terms = {}, view = new Float64Array(16), planes = new Float64Array(24);
  projTerms(cam, grid, terms); shearProjection(terms, view); frustumPlanes(view, planes);
  return { view, planes, eye: { x: cam.x, y: cam.y, z: cam.z } };
}

// ---- oracle on bench-like fixtures: 6000 instances over 400 m x 400 m, 6 poses, with and without the distance cull, LOD on/off ----
for (const [lodCells, maxDistM] of [[0, 0], [14, 0], [14, 120]]) {
  const gGpu = makeGroup(6000, lodCells), gCpu = makeGroup(6000, lodCells);
  const cull = new WgCullPass(d);
  const poses = [{ x: 0, y: -60, z: 2, yawDeg: 90, pitchDeg: -4 }, { x: 5, y: -55, z: 2, yawDeg: 85, pitchDeg: -4 }, { x: 40, y: 0, z: 2, yawDeg: 180, pitchDeg: -4 },
    { x: 41, y: 1, z: 2, yawDeg: 190, pitchDeg: -4 }, { x: -120, y: 90, z: 2, yawDeg: 300, pitchDeg: -4 }, { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: -4 }];
  let drawn = 0, lod1 = 0;
  for (const cam of poses) {
    const p = pose(cam);
    cull.begin({ planes: p.planes, viewProj: p.view, rows: ROWS, eye: p.eye, maxDistM });
    const [e0, e1] = cull.add(gGpu, [mesh0, mesh1]);
    cull.run();
    // CPU twin
    const R = Math.max(groupRadius(mesh0, gCpu.parts), groupRadius(mesh1, gCpu.parts));
    compactGroup(gCpu, p.planes, R, p.view, ROWS);
    const md2 = maxDistM * maxDistM;
    const want = [[], []];
    for (let l = 0; l < 2; l++) for (let i = 0; i < gCpu.drawCount[l]; i++) {
      const o = i * INSTANCE_STRIDE, f = gCpu.drawIb[l].f32;
      const dx = f[o + 3] - p.eye.x, dy = f[o + 7] - p.eye.y, dz = f[o + 11] - p.eye.z;
      if (maxDistM > 0 && dx * dx + dy * dy + dz * dz > md2) continue;
      want[l].push(rowKey(gCpu.drawIb[l].u32, o));
    }
    const args = cull.argsBuffer._gpu.u32;
    const n0 = args[e0.argsOffset / 4 + 1], n1 = args[e1.argsOffset / 4 + 1];
    assert.equal(n0, want[0].length, `LOD0 count lod=${lodCells} dist=${maxDistM} pose ${cam.x},${cam.y}`);
    assert.equal(n1, want[1].length, 'LOD1 count');
    assert.deepEqual(setOf(e0.instanceBuffer._gpu.u32, n0), want[0].sort(), 'LOD0 drawn set == CPU cull');
    assert.deepEqual(setOf(e1.instanceBuffer._gpu.u32, n1), want[1].sort(), 'LOD1 drawn set == CPU cull');
    // args words: indexCount (whole mesh as one range), instanceCount, 0, 0, 0
    assert.deepEqual(Array.from(args.subarray(e0.argsOffset / 4, e0.argsOffset / 4 + 5)), [900, n0, 0, 0, 0]);
    assert.deepEqual(Array.from(args.subarray(e1.argsOffset / 4, e1.argsOffset / 4 + 5)), [120, n1, 0, 0, 0]);
    drawn += n0 + n1; lod1 += n1;
  }
  assert.ok(drawn > 1000, 'fixture draws something: ' + drawn);
  if (lodCells > 0) assert.ok(lod1 > 100, 'LOD1 used: ' + lod1);
  if (lodCells === 0) assert.equal(lod1, 0);
  cull.dispose();
}

// ---- API: entries, static upload, args reset, planes null, no-LOD1 mesh, multi-range throws, dispose frees everything ----
{
  const live0 = mock.liveCount();
  const cull = new WgCullPass(d);
  const g = makeGroup(300, 14);
  cull.setStatic(g, true);
  cull.begin({ planes: null });
  const ents = cull.add(g, [mesh0, null]);
  assert.equal(ents.length, 2); assert.equal(ents[0].active, true); assert.equal(ents[1].active, false);
  assert.strictEqual(ents[0], cull.add(g, [mesh0, null])[0], 'entries are stable objects');
  assert.equal(ents[0].argsBuffer, cull.argsBuffer); assert.equal(ents[0].maxInstances, 300); assert.equal(ents[0].parts, g.parts);
  cull.begin({ planes: null }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull.argsBuffer._gpu.u32[ents[0].argsOffset / 4 + 1], 300, 'planes null, no LOD1 mesh: all 300 in LOD0');
  assert.equal(cull.stats.uploads, 1);
  cull.begin({ planes: null }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull.stats.uploads, 0, 'static batch: no re-upload');
  assert.equal(cull.argsBuffer._gpu.u32[ents[0].argsOffset / 4 + 1], 300, 'args reset to 0 each frame, then refilled');
  cull.invalidate(g); cull.begin({ planes: null }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull.stats.uploads, 1, 'invalidate -> re-upload');
  g.count = 0; cull.begin({ planes: null }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull.stats.dispatches, 0, 'empty batch: no dispatch');
  assert.throws(() => cull.add(makeGroup(4, 0), [{ ...mesh0, ranges: [{}, {}] }, null]), /multi-range/);
  cull.dispose();
  assert.equal(mock.liveCount(), live0, 'dispose frees every handle');
}
// ---- arch 2026-10-08 (WG-4a ARCH CHANGES): two groups marked static before add() both stay static; the args view is cached ----
{
  const cull = new WgCullPass(d);
  const ga = makeGroup(50, 3), gb = makeGroup(60, 4);
  cull.setStatic(ga, true); cull.setStatic(gb, true);
  cull.begin({ planes: null }); cull.add(ga, [mesh0, null]); cull.add(gb, [mesh0, null]); cull.run();
  assert.equal(cull.stats.uploads, 2, 'first frame uploads both');
  const view = cull._argsView;
  cull.begin({ planes: null }); cull.add(ga, [mesh0, null]); cull.add(gb, [mesh0, null]); cull.run();
  assert.equal(cull.stats.uploads, 0, 'both pending static groups kept static (no re-upload)');
  assert.strictEqual(cull._argsView, view, 'args view reused across frames (no per-frame subarray)');
  const gc = makeGroup(10, 5);
  cull.begin({ planes: null }); cull.add(gc, [mesh0, null]); cull.run();
  assert.notStrictEqual(cull._argsView, view, 'args view rebuilt when a batch slot is added');
  assert.equal(cull._argsView.length, 6 * cull.argsCpu.length / (cull.maxBatches * 2 * MAX_CULL_RANGES), 'view covers the 6 used slots');
  { // CULL-CAP-01: a full args buffer makes supports() say no (non-cull path) instead of add() throwing mid-frame
    const saved = cull._nextSlot, savedTop = cull._freeTop;
    cull._nextSlot = cull.argsCpu.length / 5; cull._freeTop = 0;
    assert.equal(cull.supports({ ib: { capacity: 8 }, mesh: null }, [mesh0, null]), false, 'full args buffer -> supports() false');
    cull._nextSlot = saved; cull._freeTop = savedTop;
  }
  cull.dispose();
}
// ---- 38.10a S8-B1-06: slot free list + idle sweep ----
// A one-range mesh whose range.count matches triCount exactly (supports() compares count to triCount directly; mesh0/mesh1
// above use count = triCount*3, the kernel args unit, so they are not a fit for the supports() ONE_PART shape check here).
const oneRangeMesh = { triCount: 4, bbox: mesh0.bbox, ranges: [{ start: 0, count: 4 }] };
// 500 add/remove cycles with a rolling window of live batches (well under the 64 cap): batches.size and _nextSlot
// stay bounded, supports() never flips to false, and no buffer leaks (constant live count once the window fills).
{
  const cull = new WgCullPass(d);
  const base = mock.liveCount();
  let maxSize = 0, maxNextSlot = 0, allSupport = true;
  const active = [];
  for (let i = 0; i < 500; i++) {
    const g = makeGroup(4, 0);
    cull.begin({ planes: null });
    cull.add(g, [oneRangeMesh, null]);
    active.push(g);
    if (!cull.supports(makeGroup(1, 0), [oneRangeMesh, null])) allSupport = false;
    maxSize = Math.max(maxSize, cull.batches.size);
    maxNextSlot = Math.max(maxNextSlot, cull._nextSlot);
    if (active.length > 32) cull.removeBatch(active.shift()); // reload/edit churn: a rolling window exercises slot reuse
  }
  while (active.length) cull.removeBatch(active.shift());
  assert.ok(maxSize <= 64, `batches.size stayed <= 64 across 500 add/remove cycles (max ${maxSize})`);
  assert.ok(allSupport, 'supports() stayed true for every new group across 500 cycles');
  assert.ok(maxNextSlot <= 128, `_nextSlot stayed <= 128 (max ${maxNextSlot})`);
  assert.equal(mock.liveCount(), base, 'constant live device-buffer count after warm-up: no leak across 500 cycles');
  cull.dispose();
}
// A freed slot is reused by the next _create (LIFO): the new batch's args offset equals the freed one's.
{
  const cull = new WgCullPass(d);
  const gA = makeGroup(4, 0);
  cull.begin({ planes: null });
  const offsetA = cull.add(gA, [mesh0, null])[0].argsOffset;
  cull.removeBatch(gA);
  const gB = makeGroup(4, 0);
  cull.begin({ planes: null });
  const offsetB = cull.add(gB, [mesh0, null])[0].argsOffset;
  assert.equal(offsetB, offsetA, 'a reused slot gives the same argsOffset');
  cull.removeBatch(gB);
  cull.dispose();
}
// Idle sweep: begin() removes a batch only once it has gone > CULL_IDLE_FRAMES (600) begin() calls without an add().
{
  const cull = new WgCullPass(d);
  const g = makeGroup(4, 0);
  cull.begin({ planes: null });
  cull.add(g, [mesh0, null]);
  for (let i = 0; i < 600; i++) cull.begin({ planes: null }); // diff reaches exactly 600: kept
  assert.equal(cull.batches.has(g), true, 'idle sweep keeps a batch at exactly 600 idle frames');
  cull.begin({ planes: null }); // diff 601 > 600: swept
  assert.equal(cull.batches.has(g), false, 'idle sweep removes a batch after 601 idle frames');
  cull.dispose();
}
// releaseAll(): every batch is removed, slots are returned to the free list, no live buffer leaked.
{
  const cull = new WgCullPass(d);
  const base = mock.liveCount();
  const ga = makeGroup(4, 0), gb = makeGroup(5, 0);
  cull.begin({ planes: null }); cull.add(ga, [mesh0, null]); cull.add(gb, [mesh0, null]);
  assert.equal(cull.batches.size, 2);
  cull.releaseAll();
  assert.equal(cull.batches.size, 0, 'releaseAll empties batches');
  assert.equal(mock.liveCount(), base, 'releaseAll frees every batch buffer');
  cull.dispose();
}

// ---- ALPHA-01f (d): masked meshGroup with R=3 ranges -> one args record per range, rangeCount0/1 = R, free/reuse by block size only ----
{
  const cull = new WgCullPass(d);
  const g = makeGroup(4, 0); g.mesh = {};
  const rangedMesh = { triCount: 10, bbox: mesh0.bbox, ranges: [{ start: 0, count: 2 }, { start: 2, count: 3 }, { start: 5, count: 4 }], maskRanges: [0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0] }; // third range masked
  cull.begin({ planes: null });
  const ents = cull.add(g, [rangedMesh, null]);
  assert.equal(ents.length, 6, 'R=3: 6 entries (3 ranges x 2 LODs)');
  assert.deepEqual(ents.map((e) => e.active), [true, true, true, false, false, false], 'LOD1 has no mesh: all 3 range-entries inactive');
  let slot = cull.batches.get(g).slot;
  assert.deepEqual(Array.from(cull.argsCpu.subarray(slot * 5, slot * 5 + 15)),
    [6, 0, 0, 0, 0, 9, 0, 6, 0, 0, 12, 0, 15, 0, 0], 'LOD0: 3 contiguous args records, static words from mesh.ranges[r] (*3)');
  cull.begin({ planes: null }); cull.add(g, [rangedMesh, null]); cull.run();
  const uu = cull._uv.u32, UW = (n) => CULL_BLOCK.field(n).word;
  assert.equal(uu[UW('rangeCount0')], 3, 'rangeCount0 = R'); assert.equal(uu[UW('rangeCount1')], 3, 'rangeCount1 = R');
  assert.equal(uu[UW('slot1')], (slot + 3) * 5, 'slot1 = slot + R records');
  const offsetBefore = ents[0].argsOffset;
  cull.removeBatch(g);
  const g2 = makeGroup(4, 0); g2.mesh = {};
  cull.begin({ planes: null });
  const ents2 = cull.add(g2, [rangedMesh, null]);
  assert.equal(ents2[0].argsOffset, offsetBefore, 'a freed 6-slot block is reused by the next R=3 batch');
  const g3 = makeGroup(4, 0); g3.mesh = {};
  cull.begin({ planes: null });
  const ents3 = cull.add(g3, [oneRangeMesh, null]); // R=1 (ONE_PART mesh, one range matching triCount)
  assert.notEqual(ents3[0].argsOffset, ents2[0].argsOffset, 'R=1 and R=3 batches never share a slot block');
  cull.removeBatch(g2); cull.removeBatch(g3);
  const g4 = makeGroup(4, 0); g4.mesh = {};
  cull.begin({ planes: null });
  const ents4 = cull.add(g4, [rangedMesh, null]);
  assert.equal(ents4[0].argsOffset, offsetBefore, 'R=3 free list is reused by the next R=3 batch, not an R=1 freed slot (never aliased)');
  cull.removeBatch(g4);
  cull.dispose();
}

// ---- S8-B2-05/06 host wiring: swayPad flows from begin({swayPad}) into CullU.swayPad / CullShadowU.swayPad every dispatch ----
{
  const { SWAY_MAX } = await import('../../../mesh/sway.js');
  const cull = new WgCullPass(d);
  const g = makeGroup(4, 0);
  cull.begin({ planes: null }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull._uv.f32[CULL_BLOCK.field('swayPad').word], 0, 'no sway: swayPad 0 (normal kernel)');
  cull.begin({ planes: null, swayPad: SWAY_MAX }); cull.add(g, [mesh0, null]); cull.run();
  assert.equal(cull._uv.f32[CULL_BLOCK.field('swayPad').word], SWAY_MAX, 'wind on: swayPad == SWAY_MAX (normal kernel)');
  cull.dispose();
}
{
  const { CULL_SHADOW_BLOCK } = await import('../wgsl/cullShadow.wgsl.js');
  const { SWAY_MAX } = await import('../../../mesh/sway.js');
  const m9 = makeMockGpuDevice(), dev9 = m9.device;
  const cull = new WgCullPass(dev9, { shadow: true });
  const g = makeGroup(4, 0);
  cull.begin({ planes: null, eye: { x: 0, y: 0 }, castM: 10, hystM: 1 }); cull.add(g, [mesh0, null], 5, 3); cull.run();
  assert.equal(cull._uv.f32[CULL_SHADOW_BLOCK.field('swayPad').word], 0, 'no sway: swayPad 0 (shadow kernel)');
  cull.begin({ planes: null, eye: { x: 0, y: 0 }, castM: 10, hystM: 1, swayPad: SWAY_MAX }); cull.add(g, [mesh0, null], 5, 3); cull.run();
  assert.equal(cull._uv.f32[CULL_SHADOW_BLOCK.field('swayPad').word], SWAY_MAX, 'wind on: swayPad == SWAY_MAX (shadow kernel)');
  cull.dispose();
}

// ---- S8-B2-10c host wiring: 7 binds always (dummy at 5/6 when occlusion is off), two-phase when on ----
{
  const m = makeMockGpuDevice(), dv = m.device, rec = [];
  dv.dispatch = (pipeline, desc, x) => rec.push({ slots: desc.buffers.map((b) => b.slot), bufs: desc.buffers.map((b) => b.buffer), u: Uint32Array.from(new Uint32Array(desc.uniforms.buffer, desc.uniforms.byteOffset, desc.uniforms.length)), x });
  const OC = (n) => CULL_BLOCK.field(n).word;
  const g = makeGroup(40, 0);
  // occlusion off (default): 7 entries, a 16 B dummy each at 5 and 6, all occlusion words 0 -> today's behaviour
  const off = new WgCullPass(dv);
  off.begin({ planes: null }); off.add(g, [mesh0, null]); off.run();
  assert.deepEqual(rec[0].slots, [0, 1, 2, 3, 4, 5, 6], 'bind group has 7 entries');
  assert.ok(rec[0].bufs[5] === off._dummy && rec[0].bufs[6] === off._dummy2 && off._dummy !== off._dummy2, 'distinct dummies at 5 and 6 (same buffer read+rw = WebGPU usage conflict)');
  for (let i = OC('vp'); i <= OC('slot3'); i++) assert.equal(rec[0].u[i], 0, `occlusion word ${i} is 0 with occl off`);
  off.begin({ planes: null, hzb: { buffer: off._dummy, w: 8, h: 8, levels: 4, fwd: [0, 1, 0] }, viewProj: new Float64Array(16) }); off.add(g, [mesh0, null]); off.run(); off.runPhase2({ buffer: off._dummy });
  assert.equal(rec.length, 2, 'occl off: no phase-2 dispatch, hzb ignored'); assert.equal(rec[1].u[OC('hzbOn')], 0);
  // mock rejects a writable storage binding aliasing another binding of the same buffer: a shared dummy must fail
  const mk2 = makeMockGpuDevice().device, shared = new WgCullPass(mk2); shared._dummy2 = shared._dummy; shared.begin({ planes: null }); shared.add(g, [mesh0, null]);
  assert.throws(() => shared.run(), /aliases/, 'shared dummy at read slot 5 + rw slot 6 is rejected');
  off.dispose();
  // occlusion on
  rec.length = 0;
  const on = new WgCullPass(dv, { occl: true }), vp = new Float64Array(16).map((_, i) => i + 1);
  const hz = { buffer: dv.createBuffer({ usage: 'storage', bytes: 1024 }), w: 8, h: 8, levels: 4, pitch: 64, fwd: [0, 1, 0] };
  on.begin({ planes: null, viewProj: vp, rows: 60 }); const e1 = on.add(g, [mesh0, null]); on.run(); on.runPhase2(hz);
  assert.equal(rec.length, 1, 'first frame (no HZB): phase 1 only, hzbOn 0, no phase 2');
  assert.equal(rec[0].u[OC('hzbOn')], 0); assert.ok(rec[0].bufs[5] === on._dummy && rec[0].bufs[6] === on._dummy2);
  const b = on.batches.get(g), e2 = on.phase2Entries(g);
  assert.ok(e2.length === e1.length && e2[0].instanceBuffer === b.dst2[0] && e2[0].argsOffset === b.slot2 * 20 && b.slot2 !== b.slot, 'own dst2 + args records');
  rec.length = 0;
  on.begin({ planes: null, viewProj: vp, rows: 60, hzb: hz }); on.add(g, [mesh0, null]); on.run(); on.runPhase2(hz);
  assert.equal(rec.length, 2, 'phase 1 then phase 2');
  const p1 = rec[0], p2 = rec[1], W5 = 5;
  assert.equal(p1.u[OC('hzbOn')], 1); assert.equal(p1.u[OC('phase')], 0); assert.equal(p1.u[OC('hzbW')], 8); assert.equal(p1.u[OC('hzbPitch')], 64);
  assert.ok(p1.bufs[5] === hz.buffer && p1.bufs[6] === b.occlBuf && p1.bufs[2] === b.dst[0] && p1.bufs[3] === b.dst[1]);
  assert.equal(p2.u[OC('phase')], 2); assert.equal(p2.u[OC('hzbOn')], 1); assert.equal(p2.x, p1.x, 'same thread count');
  assert.ok(p2.bufs[2] === b.dst2[0] && p2.bufs[3] === b.dst2[1] && p2.bufs[5] === hz.buffer && p2.bufs[6] === b.occlBuf && p2.bufs[4] === p1.bufs[4]);
  assert.equal(p2.u[OC('slot2')], b.slot2 * W5); assert.equal(p2.u[OC('slot3')], (b.slot2 + 1) * W5);
  assert.equal(p2.u[OC('count')], p1.u[OC('count')]);
  // resize / camera cut: the host passes no hzb -> hzbOn 0 that frame (and no phase 2)
  rec.length = 0;
  on.begin({ planes: null, viewProj: vp, rows: 60, hzb: null }); on.add(g, [mesh0, null]); on.run(); on.runPhase2(hz);
  assert.equal(rec.length, 1); assert.equal(rec[0].u[OC('hzbOn')], 0);
  // removal frees both blocks (no leak): re-adding a batch reuses the same slots
  const used = on._nextSlot; on.removeBatch(g); on.begin({ planes: null }); on.add(makeGroup(4, 0), [mesh0, null]);
  assert.equal(on._nextSlot, used, 'freed slot blocks reused');
  on.dispose();
}
console.log('passCull.test OK');
