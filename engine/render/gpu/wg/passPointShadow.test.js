// ME-16c: WgPointShadowPass on the device mock - layered depth array + 6 targets per slot, face order, key skip, faceCap queue,
// shared caster renderer with the sun pass (draw sequence pinned in passShadow.sequence.test.js), zero alloc, dispose.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, LevelMeshCache, addStructures } from '../../../mesh/DrawList.js';
import { createUniformRing } from '../wgsl/uniformBlock.js';
import { WgShadowPass } from './passShadow.js';
import { WgPointShadowPass } from './passPointShadow.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
const struct = (i, x, y) => ({ id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } });
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
const levelCache = new LevelMeshCache();
const camList = new DrawList(16); camList.begin(); addStructures(camList, world, cam, levelCache, 2000);
const raster = { list: camList, levelCache, meshCache: null, strictMatIdFor: null };

function makeLights(k) {
  const L = { count: k, on: new Uint8Array(8).fill(1), pos: new Float32Array(32), col: new Float32Array(32).fill(1), defX: new Float32Array(8), defY: new Float32Array(8), defZ: new Float32Array(8), entity: new Uint8Array(8) };
  for (let i = 0; i < k; i++) { L.defX[i] = 0.5; L.defY[i] = -19.5 + i * 0.1; L.defZ[i] = 1.5; L.pos[i * 4 + 3] = 8; L.col[i * 4] = 4 - i * 0.4; } // distinct scores, all near the camera
  return L;
}
const mk = (cfg) => {
  const mock = makeMockGpuDevice(), d = mock.device, passes = [], draws = [];
  d.beginPass = (t, o) => passes.push({ t, o });
  d.draw = (c, f, i) => draws.push({ pipe: d._activePipeline, c, f, i });
  const sun = new WgShadowPass(d, { shadows: { sun: 'off' }, casters: true });
  const ps = new WgPointShadowPass(d, { ...cfg, casters: sun });
  return { mock, d, passes, draws, sun, ps };
};
const frame = (lights) => ({ _light: lights, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: null, terrainEnabled: false });

// ---- construction: one layered depth array, 6 cached per-layer targets per slot, caster pipes shared with the sun pass ----
{
  const { d, passes, draws, sun, ps, mock } = mk({ level: 'medium' }); // n 2, res 256, faceCap 6
  assert.ok(ps.enabled && sun.staticPipe && !sun.depthTex, 'caster-only sun pass: pipelines, no sun map');
  assert.deepEqual([ps.depthTex.desc.format, ps.depthTex.desc.sampled, ps.depthTex.desc.layers, ps.depthTex.desc.width], ['depth24', true, 12, 256]);
  assert.equal(ps.targets.length, 12);
  ps.targets.forEach((t, l) => assert.equal(t.layerView.layer, l, 'target l attaches layer l'));
  const lights = makeLights(1), p = frame(lights);

  // one light: 6 faces in order into layers 0..5, each cleared
  assert.equal(ps.run(p, raster), true);
  assert.deepEqual(passes.map((x) => x.t), ps.targets.slice(0, 6), 'face order = layer order, slot 0');
  assert.ok(passes.every((x) => x.o.clear === true));
  assert.deepEqual([ps.ready[0], ps.slotLight[0], ps.slotLight[1], ps.renders, ps.facesRendered], [1, 0, -1, 1, 6]);
  assert.deepEqual([...ps.origins.slice(0, 4)], [0.5, -19.5, 1.5, 8]);
  assert.ok(draws.length > 0 && draws.every((x) => x.pipe === sun.staticPipe), 'level quads drawn by the sun pass pipes');
  const lastFaces = ps.stats.faces; assert.equal(lastFaces, 6);

  // unchanged key (flicker jitter lives in pos, never in defX) -> skip, no pass
  const np = passes.length; lights.pos[0] += 0.3; lights.col[0] = 9;
  ps.run(p, raster); assert.equal(passes.length, np, 'static torch renders once'); assert.ok(ps.skips >= 1); assert.equal(ps.stats.faces, 0);
  // origin moves by > 1/64 m -> re-render; sub-quantum move -> skip
  lights.defX[0] += 0.001; ps.run(p, raster); assert.equal(passes.length, np);
  lights.defX[0] += 0.5; ps.run(p, raster); assert.equal(passes.length, np + 6, 'moved light re-renders all 6 faces');
  // structVersion bump re-renders
  world.structVersion++; ps.run(p, raster); assert.equal(passes.length, np + 12); world.structVersion--;
  ps.run(p, raster);
  // lamp removed -> slot freed, not ready
  lights.on[0] = 0; ps.run(p, raster); assert.equal(ps.ready[0], 0); assert.equal(ps.active, false);

  // dispose frees the array, the targets and (shared) leaves the sun pass untouched
  const live = mock.liveCount(); ps.dispose();
  assert.equal(mock.liveCount(), live - 13); assert.equal(ps.depthTex, null); assert.ok(sun.staticPipe && !sun.staticPipe._disposed);
  const before = mock.liveCount(); sun.dispose(); assert.ok(mock.liveCount() < before, 'sun dispose frees its pipes');
}

// ---- faceCap: medium (cap 6) = one light per frame, round-robin; high (cap 12) = two ----
{
  const { passes, ps } = mk({ level: 'medium', pointShadows: { n: 2 } });
  const lights = makeLights(2), p = frame(lights);
  ps.run(p, raster); assert.equal(passes.length, 6); assert.deepEqual([ps.ready[0], ps.ready[1]], [1, 0], 'first frame: one whole light');
  ps.run(p, raster); assert.equal(passes.length, 12); assert.deepEqual([ps.ready[0], ps.ready[1]], [1, 1], 'next frame: the queued one');
  ps.run(p, raster); assert.equal(passes.length, 12, 'both clean');
  assert.ok(passes.slice(6).every((x) => ps.targets.slice(6, 12).includes(x.t)), 'second light -> layers 6..11');
}
{
  const { passes, ps } = mk({ level: 'high' }); // n 4, faceCap 12
  assert.equal(ps.depthTex.desc.layers, 24);
  const lights = makeLights(4), p = frame(lights);
  ps.run(p, raster); assert.equal(passes.length, 12, 'cap 12 = two lights');
  assert.ok(passes.length <= ps.opts.faceCap);
  ps.run(p, raster); assert.equal(passes.length, 24); ps.run(p, raster); assert.equal(passes.length, 24);
  // moving/carried first: bump slot 3's origin and slot 0's; both dirty, cap 12 -> two lights, the moving ones
  lights.defX[3] += 1; lights.defX[1] += 1; lights.entity[3] = 1;
  passes.length = 0; ps.run(p, raster); assert.equal(passes.length, 12);
  assert.equal(ps.ready[0] + ps.ready[1] + ps.ready[2] + ps.ready[3], 4);
}

// ---- off (n = 0) and GL2-style layers failure ----
{
  const { ps, passes } = mk({ pointShadows: { n: 0 } });
  assert.equal(ps.enabled, false); assert.equal(ps.run(frame(makeLights(1)), raster), false); assert.equal(passes.length, 0); ps.dispose();
}

// ---- ME-16 fix: uniform-ring budget. 4 lights x 6 faces x ~130 draws/face on the real 832-slot ring must not throw; faces resume next frame ----
{
  const bigWorld = { structures: [], structVersion: 1, terrain: null }, all = [];
  const bigList = new DrawList(256); bigList.begin(); // addStructures caps at 8 structs per call: 17 batches of 8 = ~136 casters near the light
  for (let b = 0; b < 17; b++) {
    bigWorld.structures.length = 0;
    for (let i = 0; i < 8; i++) { const st = struct(b * 8 + i, i * 0.5, -22 + b * 0.25); bigWorld.structures.push(st); all.push(st); }
    addStructures(bigList, bigWorld, cam, levelCache, 2000);
  }
  bigWorld.structures = all;
  const bigRaster = { list: bigList, levelCache, meshCache: null, strictMatIdFor: null };
  const { d, ps } = mk({ level: 'high' });
  const ring = createUniformRing(832, 256); d.uniformRing = ring; // as GpuDeviceWebGPU: DEFAULT_RING_SLOTS = MAX_DRAW_ITEMS*3+64
  let open = 0, maxDraws = 0, perFace = 0;
  d.beginPass = () => { assert.equal(open, 0, 'previous pass not ended'); open = 1; perFace = 0; };
  d.endPass = () => { open = 0; if (perFace > maxDraws) maxDraws = perFace; };
  d.bind = () => { ring.alloc(256); };
  d.draw = () => { perFace++; };
  // shadowList caps structures, so the 130 draws/face are simulated at the renderCasters boundary (one bind+draw each, a ring slot per bind)
  const cs = ps.casters;
  cs.renderCasters = (target) => { d.beginPass(target, {}); for (let i = 0; i < 130; i++) { d.bind({}, {}); d.draw(1, 0, 1); } d.endPass(); cs.draws = 130; };
  const lights = makeLights(4), p = { ...frame(lights), _world: bigWorld };
  let frames = 0;
  const allReady = () => ps.ready[0] + ps.ready[1] + ps.ready[2] + ps.ready[3] === 4;
  while (!allReady() && frames < 60) { ring.reset(); ring.alloc(256 * 300); /* sun + raster already used 300 slots */ ps.run(p, bigRaster); frames++; assert.equal(open, 0); assert.ok(ring.usedSlots <= 832, 'ring never overflows'); }
  assert.ok(allReady(), `all 4 lights complete over ${frames} frames`);
  assert.ok(maxDraws >= 100, `stress face has ${maxDraws} draws`);
  // forced throw inside a face: no open pass left, next frame renders
  lights.defX[0] += 1; let boom = 1; d.draw = () => { if (boom) { boom = 0; throw new Error('boom'); } perFace++; };
  cs.renderCasters = (target) => { d.beginPass(target, {}); try { for (let i = 0; i < 130; i++) { d.bind({}, {}); d.draw(1, 0, 1); } } finally { d.endPass(); } cs.draws = 130; };
  ring.reset(); assert.throws(() => ps.run(p, bigRaster), /boom/); assert.equal(open, 0, 'pass ended after a throw');
  let ok = false; for (let i = 0; i < 20 && !ok; i++) { ring.reset(); ps.run(p, bigRaster); ok = ps.ready[0] === 1 && ps.faceMask[0] === 0; }
  assert.ok(ok, 'next frames render after the throw');
  // steady state: nothing dirty -> no allocation
  d.draw = () => {}; d.beginPass = () => {}; d.endPass = () => {};
  for (let i = 0; i < 2000; i++) { ring.reset(); ps.run(p, bigRaster); }
  global.gc(); const h1 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) { ring.reset(); ps.run(p, bigRaster); }
  global.gc(); const g1 = process.memoryUsage().heapUsed - h1;
  assert.ok(g1 < 64 * 1024, `steady-state heap growth ${g1} B`);
}

// ---- ME-16c ARCH CHANGES 5.1: one GPU instance copy per consumer. The queue model (mock modelHazard): writeBuffer lands at once, draws run at submit ----
{
  const { DRAW_INSTANCED } = await import('../../../mesh/DrawList.js');
  const { createShadowList } = await import('../../../mesh/shadowList.js');
  const mk2 = makeMockGpuDevice(), dev = mk2.device; dev.modelHazard = true;
  const sun = new WgShadowPass(dev, { shadows: { sun: 'off' }, casters: true });
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), ib = dev.createBuffer({ usage: 'index', bytes: 64 });
  sun.buffers.getVoxel = () => ({ vertexBuffer: vb, indexBuffer: ib });
  const mesh = { layout: 'static', triCount: 12, ranges: [{ start: 0, count: 12 }] };
  const f32 = new Float32Array(16);
  const il = createShadowList(); il.begin(); const it = il.push(); it.type = DRAW_INSTANCED; it.mesh = mesh; it.instCount = 2; it.instBuf = { f32 };
  it.partMatrices.fill(0); it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const M = new Float32Array(16), tgt = dev.createTarget({}), idx = new Uint16Array([0]);
  f32.fill(1); sun.renderCasters(tgt, M, il, world, null, 0, false); // sun draws its banding (all 1)
  f32.fill(2); sun.renderCasters(tgt, M, il, world, idx, 1, false, 1); // torch slot 0 re-bands the same array (all 2)
  f32.fill(3); sun.renderCasters(tgt, M, il, world, idx, 1, false, 2); // torch slot 1
  const hz = dev.hazardDraws();
  assert.equal(hz.length, 3);
  assert.deepEqual(hz.map((h) => h.seen[0]), [1, 2, 3], 'each consumer draws with ITS contents (old shared buffer: [3, 3, 3])');
  assert.equal(new Set(hz.map((h) => h.buffer)).size, 3, 'three GPU copies, one per consumer');
  const live = mk2.liveCount(); sun.renderCasters(tgt, M, il, world, null, 0, false); assert.equal(mk2.liveCount(), live, 'no allocation on later frames');
  sun.dispose(); assert.ok(hz.every((h) => h.buffer._disposed), 'copies disposed with the group');
}

// ---- ME-16d/f: point faces use the SAME caster settings as the twin (pointCasterOpts) and inherit the sun depthBias [2,4] via the shared caster pipelines ----
{
  const { ps, sun } = mk({ level: 'medium' });
  const so = sun.shadowOpts, r = 8, lights = makeLights(1);
  ps.run(frame(lights), { list: new DrawList(8), levelCache: new LevelMeshCache(), meshCache: null, strictMatIdFor: null });
  const s = ps.src;
  assert.deepEqual([s.instCastM, s.fogFarM, s.meshLod0M, s.meshCastM, s.meshCastCap], [r, r + 128, so.meshLod0M, so.meshCastM, so.meshCastCap]);
  assert.deepEqual(sun.depthBias, { factor: 2, units: 4 }, 'sun bias [2,4]');
  assert.ok(ps.casters === sun && sun.pipes.length > 0);
  for (const pipe of sun.pipes) if (pipe.desc) assert.deepEqual(pipe.desc.depthBias, { factor: 2, units: 4 }, 'every caster pipeline the point faces draw with carries the sun bias');
}

// ---- ME-16c ARCH CHANGES 5.3: a slot skipped by faceCap keeps its previous origin in the light words (renderedOrigins) ----
{
  const { ps } = mk({ level: 'medium', pointShadows: { n: 2 } }); // cap 6: one light per frame
  const lights = makeLights(2), p = frame(lights);
  ps.run(p, raster); ps.run(p, raster); assert.deepEqual([ps.ready[0], ps.ready[1]], [1, 1]);
  const o1 = [...ps.renderedOrigins.slice(4, 8)]; assert.equal(o1[0], 0.5);
  lights.defX[0] += 1; lights.defX[1] += 1; lights.entity[0] = 1; // both dirty; the carried slot 0 goes first, slot 1 starves this frame
  const o0 = [...ps.renderedOrigins.slice(0, 4)];
  ps.run(p, raster);
  assert.equal(ps.origins[4], 1.5, 'build origin moved');
  assert.deepEqual([...ps.renderedOrigins.slice(4, 8)], o1, 'skipped slot keeps the origin its layers were rendered with');
  assert.equal(ps.renderedOrigins[0], 1.5); assert.notEqual(ps.renderedOrigins[0], o0[0]);
  ps.run(p, raster); assert.equal(ps.renderedOrigins[4], 1.5, 'committed once its 6 faces are in');
}

// ---- ME-16c re-review nits: (1) key flips back mid-way, (2) a never-fitting slot must not starve the others ----
{
  const { d, ps } = mk({ level: 'high' });
  const ring = createUniformRing(832, 256); d.uniformRing = ring;
  d.beginPass = () => {}; d.draw = () => {}; d.bind = () => {};
  const cs = ps.casters, lights = makeLights(1), p = frame(lights);
  let calls = 0, fillAfter = -1;
  cs.renderCasters = () => { cs.draws = 2; calls++; if (calls === fillAfter) ring.alloc(256 * 800); };
  const go = () => { ring.reset(); calls = 0; ps.run(p, raster); };
  go(); assert.equal(ps.ready[0], 1); assert.equal(ps.faceMask[0], 0);
  lights.defX[0] += 1; fillAfter = 2; go(); // partial: 2 faces, ring now full
  assert.ok(ps.faceMask[0] !== 0 && ps.faceMask[0] !== 63, 'partial render in flight');
  lights.defX[0] -= 1; fillAfter = -1; go(); // key is back at the committed one
  assert.equal(calls, 6, 'no skip while faces are mixed: all 6 re-rendered');
  assert.equal(ps.faceMask[0], 0); assert.equal(ps.ready[0], 1);
  go(); assert.equal(calls, 0, 'then the skip works again');
  // (2) slot 0 never fits (renders 0 faces); the two normal slots behind it complete
  const e = mk({ level: 'high' }); e.d.uniformRing = createUniformRing(832, 256); e.d.beginPass = () => {}; e.d.draw = () => {}; e.d.bind = () => {};
  const ps2 = e.ps; ps2.opts.faceCap = 36; ps2.casters.renderCasters = () => { ps2.casters.draws = 2; };
  const orig = ps2._renderSlot.bind(ps2); ps2._renderSlot = (s, w) => (s === 0 ? 0 : orig(s, w));
  const l3 = makeLights(3), p3 = frame(l3);
  for (let i = 0; i < 4; i++) { e.d.uniformRing.reset(); ps2.run(p3, raster); }
  assert.equal(ps2.ready[1] + ps2.ready[2], 2, 'normal slots complete behind the oversized one'); assert.equal(ps2.ready[0], 0);
}

// ---- zero allocation once warm (moving light renders every frame) ----
{
  const { d, ps } = mk({ level: 'medium' });
  const lights = makeLights(2), p = frame(lights);
  d.draw = () => {}; d.beginPass = () => {};
  let flip = 0; const step = () => { lights.defX[0] = 0.5 + ((flip++ & 1) ? 0.5 : 0); ps.run(p, raster); };
  for (let i = 0; i < 4000; i++) step();
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) step();
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  assert.ok(grew < 64 * 1024, `heap growth over 1000 frames ${grew} B`);
  console.log(`passPointShadow.test.js: all checks passed (heap +${grew} B / 1000 frames).`);
}
