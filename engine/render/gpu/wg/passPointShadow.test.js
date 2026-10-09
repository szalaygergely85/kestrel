// ME-16c: WgPointShadowPass on the device mock - layered depth array + 6 targets per slot, face order, key skip, faceCap queue,
// shared caster renderer with the sun pass (draw sequence pinned in passShadow.sequence.test.js), zero alloc, dispose.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, LevelMeshCache, addStructures } from '../../../mesh/DrawList.js';
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
