// WG-4b: WgShadowPass GPU caster cull on the device mock. The mock never computes, so a JS executor runs cullShadow.wgsl.js (helpers via wgslProbe,
// fed from the REAL uniform words / buffers the pass wrote). The drawn caster SET per band is compared with the CPU oracle buildShadowList
// (instances.js fillShadowBands) on bench-like fixtures over a moving eye; dispatch + drawIndirect, CPU fallback, gpucull=0, dirty skip, zero allocation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, DRAW_INSTANCED, LevelMeshCache } from '../../../mesh/DrawList.js';
import { buildShadowList, createShadowList, shadowWorldZ } from '../../../mesh/shadowList.js';
import { InstanceGroups, INSTANCE_STRIDE, touchInstances, writeUnitInstance } from '../../../mesh/instances.js';
import { createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar, resolveSunShadowOptions } from '../../shadowSun.js';
import { dirFromAzEl } from '../../../core/transform.js';
import { CULL_SHADOW_WGSL, CULL_SHADOW_BLOCK } from '../wgsl/cullShadow.wgsl.js';
import { compileFn } from '../wgsl/wgslProbe.js';
import { WgShadowPass } from './passShadow.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const f32 = Math.fround;
const mock = makeMockGpuDevice(), d = mock.device;
let execOn = true;

// kernel executor (one dispatch of the shadow kernel over the pass's own uploaded buffers + uniform views)
function execDispatch() {
  const { desc } = d._lastDispatch;
  const uf = desc.uniforms, uu = new Uint32Array(uf.buffer, uf.byteOffset, uf.length);
  const W = (n) => CULL_SHADOW_BLOCK.field(n).word;
  const v4 = (w) => ({ x: uf[w], y: uf[w + 1], z: uf[w + 2], w: uf[w + 3] });
  const u = { planes: [0, 1, 2, 3, 4, 5].map((i) => v4(W('planes') + i * 4)), eye: v4(W('eye')), params: v4(W('params')), count: uu[W('count')], slot0: uu[W('slot0')], slot1: uu[W('slot1')] };
  const aabbOutside = compileFn(CULL_SHADOW_WGSL, 'aabbOutside', { u }), bandUpdate = compileFn(CULL_SHADOW_WGSL, 'bandUpdate', { u });
  const [src, band, dst0, dst1, args] = desc.buffers.map((b) => b.buffer);
  const sU = src._gpu.u32, sF = new Float32Array(sU.buffer, sU.byteOffset, sU.length);
  for (let i = 0; i < u.count; i++) {
    const o = i * INSTANCE_STRIDE, tx = sF[o + 3], ty = sF[o + 7], tz = sF[o + 11];
    const dx = tx - u.eye.x, dy = ty - u.eye.y;
    const b = bandUpdate(f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy)))), band._gpu.u32[i]);
    band._gpu.u32[i] = b;
    if (b === 2 || aabbOutside(tx, ty, tz)) continue;
    const dst = b ? dst1 : dst0, slot = b ? u.slot1 : u.slot0;
    const w = args._gpu.u32[slot + 1]++ * INSTANCE_STRIDE;
    for (let c = 0; c < INSTANCE_STRIDE; c++) dst._gpu.u32[w + c] = sU[o + c];
  }
}
const origCreate = d.createBuffer, origWrite = d.writeBuffer;
d.createBuffer = (desc) => {
  const h = origCreate(desc), n = desc.data ? desc.data.byteLength : desc.bytes;
  h._gpu = { u32: new Uint32Array(n / 4) };
  if (desc.data) h._gpu.u32.set(new Uint32Array(desc.data.buffer, desc.data.byteOffset, desc.data.byteLength / 4));
  return h;
};
d.writeBuffer = (h, data, off = 0) => { origWrite(h, data, off); if (h._gpu) h._gpu.u32.set(new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4), off / 4); };
d.dispatch = (pipeline, desc, x, y, z) => { d._dispatches = (d._dispatches || 0) + 1; d._lastDispatch = { pipeline, desc, x, y, z }; if (execOn) execDispatch(); };
const draws = [];
d.beginPass = () => {}; d.draw = (count, first, instances) => { if (execOn) draws.push({ pipe: d._activePipeline, count, first, instances }); };

// ---- fixture: a meshGroup (trees), a single-range voxel unit with a LOD1 mesh, a multi-range voxel unit (CPU fallback) ----
const mk = (tris, ranges) => ({ triCount: tris, ranges, bbox: [-1.5, -1.5, 0, 1.5, 1.5, 7], layout: 'static' });
const treeMesh = { layout: 'static', ranges: [{ start: 0, count: 6 }, { start: 6, count: 4 }], id: 'tree' };
const treeDraw = mk(10, treeMesh.ranges), v0 = mk(8, [{ start: 0, count: 8 }]), v1 = mk(3, [{ start: 0, count: 3 }]), multi = mk(2, [{ start: 0, count: 1 }, { start: 1, count: 1 }]);
const vb = d.createBuffer({ usage: 'vertex', bytes: 64 }), ib = d.createBuffer({ usage: 'index', bytes: 64 });
const vmc = { get: (pm, key, names, lod) => (key === 'multi' ? multi : lod === 1 ? v1 : v0) };
const NT = 700, NV = 500, NM = 40;
function makeScene() {
  const ig = new InstanceGroups();
  ig.bindPool({ models: new Map([['vox', {}], ['multi', {}]]), partNamesFor: () => [] });
  const gt = ig.meshGroup(treeMesh, NT), gv = ig.group('vox', NV), gm = ig.group('multi', NM);
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const [g, n, ext] of [[gt, NT, 140], [gv, NV, 120], [gm, NM, 90]]) {
    g.count = n;
    if (g !== gt) { g.parts.count = 1; g.parts.m[0] = g.parts.m[4] = g.parts.m[8] = 1; g.parts.flags[0] = 1; }
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_STRIDE;
      g.ib.f32.set([1, 0, 0, f32((rnd() - 0.5) * ext * 2), 0, 1, 0, f32((rnd() - 0.5) * ext * 2), 0, 0, 1, f32(rnd() * 2)], o);
      g.ib.u32[o + 12] = 1000 + i; g.ib.u32[o + 13] = i & 3;
    }
  }
  return { ig, gt, gv, gm };
}
const meshCache = { get: () => treeDraw };
const world = { structures: [], structVersion: 1, terrain: null };
const levelCache = new LevelMeshCache();
const camList = new DrawList(16); camList.begin();
const raster = { list: camList, levelCache, meshCache, strictMatIdFor: () => 1 };
const sun = { on: true, dir: dirFromAzEl(135, 40, new Float64Array(3)) };
const shadows = { res: 256, dirtySkip: false };
const so = resolveSunShadowOptions(shadows, 'mesh');

function makePass(opts) {
  const sh = new WgShadowPass(d, { shadows, ...opts });
  sh.buffers.getVoxel = () => ({ vertexBuffer: vb, indexBuffer: ib });
  sh.src.voxelMeshCache = vmc;
  return sh;
}
const rowKey = (u32, w) => Array.from(u32.subarray(w, w + INSTANCE_STRIDE)).join(',');
const setOf = (u32, n) => { const s = []; for (let i = 0; i < n; i++) s.push(rowKey(u32, i * INSTANCE_STRIDE)); return s.sort(); };
const itemSet = (list, mesh) => { const s = []; for (let i = 0; i < list.count; i++) { const it = list.items[i]; if (it.type === DRAW_INSTANCED && it.mesh === mesh) s.push(...setOf(it.instBuf.u32, it.instCount)); } return s.sort(); };
const mkP = (cam, ig) => ({ _light: { sun }, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: ig, terrainEnabled: false });

// ---- oracle: gpu pass vs the CPU buildShadowList on identical (separate) groups over a moving eye (band hysteresis state carries over) ----
{
  const sh = makePass({}), A = makeScene(), B = makeScene();
  assert.ok(sh.cull && sh.cull.shadow && sh.src.gpu, 'gpuCull defaults on');
  const refList = createShadowList(), refMat = createSunShadowMatrix(), centre = new Float64Array(3);
  let drawnTotal = 0, band1 = 0;
  const poses = [[0, -60], [4, -56], [8, -50], [40, 0], [41, 3], [-70, 60], [-62, 58], [0, 0], [30, 10], [33, 14]];
  for (const [x, y] of poses) {
    const cam = { x, y, z: 1.6, yawDeg: 90, pitchDeg: 0 };
    draws.length = 0; d._dispatches = 0; d._indirectDraws = 0;
    sh.run(mkP(cam, A.ig), raster);
    sunShadowCentre(cam, so, centre);
    const zr = shadowWorldZ(world, levelCache, { min: 0, max: 0 });
    const smr = shadowSunMatrix(sun.dir, centre, so, zr, refMat);
    buildShadowList(refList, camList, world, smr.planes, { centre: { x: centre[0], y: centre[1], z: centre[2] }, eye: { x: cam.x, y: cam.y }, meshLod0M: so.meshLod0M, instCastM: so.instCastM,
      cache: levelCache, fogFarM: sunShadowFogFar(null, so), cloths: null, instances: B.ig, voxelPool: null, voxelMeshCache: vmc, meshCache, meshIdFor: () => 1 });
    assert.equal(sh.gpuN, 2, 'meshGroup + single-range voxel unit go to the kernel');
    assert.equal(d._dispatches, 2, 'one dispatch per accepted batch');
    assert.equal(d._indirectDraws, 3, 'drawIndirect: tree band 0 + voxel band 0 + band 1');
    for (let i = 0; i < sh.list.count; i++) assert.ok(sh.list.items[i].mesh === multi || sh.list.items[i].type !== DRAW_INSTANCED, 'only the fallback group stays a CPU item');
    assert.deepEqual(itemSet(sh.list, multi), itemSet(refList, multi), 'fallback group: same CPU caster set');
    const t0 = sh.gpuEntries[0][0], x0 = sh.gpuEntries[1][0], x1 = sh.gpuEntries[1][1];
    const args = sh.cull.argsBuffer._gpu.u32;
    const cnt = (e) => args[e.argsOffset / 4 + 1];
    assert.deepEqual(setOf(t0.instanceBuffer._gpu.u32, cnt(t0)), itemSet(refList, treeDraw), 'tree casters == CPU set');
    assert.deepEqual(setOf(x0.instanceBuffer._gpu.u32, cnt(x0)), itemSet(refList, v0), 'voxel band 0 == CPU set');
    assert.deepEqual(setOf(x1.instanceBuffer._gpu.u32, cnt(x1)), itemSet(refList, v1), 'voxel band 1 == CPU set');
    // args: indexCount from ranges[0] (the CPU caster loop draws range 0 of a meshGroup with the identity part), firstIndex = start * 3
    assert.deepEqual(Array.from(args.subarray(t0.argsOffset / 4, t0.argsOffset / 4 + 5)), [18, cnt(t0), 0, 0, 0]);
    assert.deepEqual(Array.from(args.subarray(x1.argsOffset / 4, x1.argsOffset / 4 + 5)), [9, cnt(x1), 0, 0, 0]);
    assert.equal(sh.gpuEntries[0][1].active, false, 'meshGroup has no band 1');
    // parity oracle list (shadowParity.js): the full CPU list incl. the GPU-owned groups, rebuilt with the hook off; the frame list is untouched
    const cl = sh.casterList();
    assert.notStrictEqual(cl, sh.list); assert.equal(sh.src.gpu, sh._gpuHook, 'hook restored');
    assert.ok(itemSet(cl, treeDraw).length > 0 && itemSet(cl, v0).length > 0, 'oracle list holds the GPU-owned groups');
    assert.deepEqual(itemSet(cl, multi), itemSet(refList, multi));
    assert.equal(sh.stats.shadowDraws, sh.draws);
    drawnTotal += cnt(t0) + cnt(x0) + cnt(x1); band1 += cnt(x1);
  }
  assert.ok(drawnTotal > 1000 && band1 > 50, `fixture draws something: ${drawnTotal}, band1 ${band1}`);
  sh.dispose();
}

// ---- gpucull=0 / no compute device: everything stays on the CPU list, no dispatch, no indirect draw ----
{
  const off = makePass({ gpuCull: false }), A = makeScene();
  assert.equal(off.cull, null); assert.equal(off.src.gpu, null);
  d._dispatches = 0; d._indirectDraws = 0; draws.length = 0;
  off.run(mkP({ x: 0, y: -60, z: 1.6, yawDeg: 90, pitchDeg: 0 }, A.ig), raster);
  assert.equal(d._dispatches, 0); assert.equal(d._indirectDraws, 0); assert.equal(off.gpuN, 0);
  assert.ok(draws.some((x) => x.instances > 1), 'CPU instanced draws');
  assert.ok(off.list.items.slice(0, off.list.count).filter((it) => it.type === DRAW_INSTANCED).length >= 3, 'all three groups are CPU items');
  off.dispose();
}

// ---- dirty skip: identical inputs -> no dispatch/pass; a moved instance (hash key part 2) renders again ----
{
  const sh = makePass({ shadows: { res: 256, dirtySkip: true } }), A = makeScene();
  const p = mkP({ x: 0, y: -60, z: 1.6, yawDeg: 90, pitchDeg: 0 }, A.ig);
  d._dispatches = 0;
  sh.run(p, raster); assert.equal(sh.renders, 1); const n = d._dispatches; assert.equal(n, 2);
  sh.run(p, raster); assert.equal(sh.skips, 1); assert.equal(d._dispatches, n, 'skipped frame: no dispatch');
  A.gt.ib.f32[3] += 1.5; touchInstances(A.gt.ib); // raw writer: explicit version bump
  sh.run(p, raster); assert.equal(sh.renders, 2, 'GPU-owned instance moved -> re-render'); assert.equal(d._dispatches, 2 * n);
  sh.run(p, raster); assert.equal(sh.skips, 2, 'static again -> skip');
  // WG-4b(c): writeUnitInstance bumps only on a real change (a static unit rewritten every frame keeps skipping)
  const v0 = A.gv.ib.version;
  writeUnitInstance(A.gv.ib, 3, 5, 6, 0, 0, 77, 1); assert.notEqual(A.gv.ib.version, v0, 'row changed -> version bump');
  const v1 = A.gv.ib.version;
  writeUnitInstance(A.gv.ib, 3, 5, 6, 0, 0, 77, 1); assert.equal(A.gv.ib.version, v1, 'identical rewrite -> no bump');
  sh.run(p, raster); assert.equal(sh.renders, 3, 'voxel group row changed -> re-render');
  writeUnitInstance(A.gv.ib, 3, 5, 6, 0, 0, 77, 1);
  sh.run(p, raster); assert.equal(sh.skips, 3, 'identical rewrite -> skip');
  A.gv.count -= 1;
  sh.run(p, raster); assert.equal(sh.renders, 4, 'count change -> re-render');
  // CPU-owned (multi-range) group rows never touch the GPU key: they go through the CPU list hash
  // the eye crossing a 1 m cell re-renders (band edge pickup), sub-cell motion skips
  const r = sh.renders, cam = p._cam;
  cam.x += 0.2; sh.run(p, raster);
  cam.x += 3; sh.run(p, raster); assert.ok(sh.renders > r, 'eye crossed a cell -> re-render');
  // no row walk on the frame path: a static scene's skip frame costs O(groups), independent of row count
  let rowReads = 0;
  const gtf = A.gt.ib, saved = gtf.f32;
  gtf.f32 = new Proxy(saved, { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) rowReads++; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } });
  const s0 = sh.skips; sh.run(p, raster); sh.run(p, raster);
  gtf.f32 = saved;
  assert.ok(sh.skips >= s0 + 1, 'static frames skip');
  assert.equal(rowReads, 0, 'skip frames read no GPU-owned rows (version key, no walk)');
  sh.dispose();
}

// ---- allocation: warm frames create no resources and keep the heap flat ----
{
  const sh = makePass({ shadows: { res: 256, dirtySkip: false } }), A = makeScene();
  const cam = { x: 0, y: -60, z: 1.6, yawDeg: 90, pitchDeg: 0 };
  const p = mkP(cam, A.ig);
  execOn = false; d.draw = () => {};
  for (let i = 0; i < 3000; i++) { cam.x = (i % 7) * 0.1; sh.run(p, raster); }
  const created = mock.createCount;
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) { cam.x = (i % 7) * 0.1; sh.run(p, raster); }
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  assert.equal(mock.createCount, created, 'warm frames create no resources');
  assert.ok(grew < 64 * 1024, `heap growth over 1000 frames ${grew} B`);
  const live0 = mock.liveCount(); sh.dispose();
  assert.ok(mock.liveCount() < live0, 'dispose frees the cull pass too');
  console.log(`passShadowCull.test.js: all checks passed (heap +${grew} B / 1000 frames).`);
}
