// @ts-check
// engine/render/gpu/device/GpuDevice.test.js - ME-03b (docs/backlog.md,
// docs/architecture.md 27.11 ME-03b AC "Mock-device tests: alloc/free
// pairs, descriptor reuse, no per-frame buffer creation"). Exercises the
// Node mock (engine/test/assert.js's `makeMockGpuDevice`) against the shape
// GpuDevice.js documents - no real WebGL2 context needed.
//
//   node engine/render/gpu/device/GpuDevice.test.js
import { GPU_DEVICE_METHODS } from './GpuDevice.js';
import { makeOk, makeMockGpuDevice } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- shape ----
{
  const { device } = makeMockGpuDevice();
  for (const name of GPU_DEVICE_METHODS) {
    ok(`mock device exposes ${name}()`, typeof device[name] === 'function');
  }
  ok('mock device exposes timer.begin/end', typeof device.timer.begin === 'function' && typeof device.timer.end === 'function');
  ok('mock device exposes caps', typeof device.caps === 'object' && typeof device.caps.maxColorAttachments === 'number');
  ok('GPU_DEVICE_METHODS lists the WG-1b1 additions', ['writeTexture', 'canvasTarget', 'submit'].every((n) => GPU_DEVICE_METHODS.includes(n)));
  ok('mock device backend + lost (WG-1b1)', device.backend === 'webgl2' && typeof device.lost.then === 'function');
}

// ---- WG-1b1: writeTexture / canvasTarget / submit / readback Promise-or-value ----
{
  const mock = makeMockGpuDevice();
  const { device } = mock;
  const tex = device.createTexture({ format: 'rgba8', width: 4, height: 4, filter: 'linear' });
  device.writeTexture(tex, new Uint8Array(64));
  device.writeTexture(tex, new Uint8Array(16), { x: 0, y: 0, w: 2, h: 2 });
  ok('writeTexture counted + last rect kept', mock.texWriteCount === 2 && tex._texWrites === 2 && tex._lastTexWrite.rect.w === 2);
  ok('canvasTarget is a stable target handle', device.canvasTarget() === device.canvasTarget() && device.canvasTarget().kind === 'target');
  device.submit();
  ok('submit counted', mock.submitCount === 1);
  const out = new Uint8Array(4).fill(9);
  const r = device.readback(tex, { x: 0, y: 0, w: 1, h: 1 }, out);
  ok('readback is await-safe (value or Promise)', out[0] === 0 && (r === undefined || typeof r.then === 'function'));
}

// ---- alloc/free pairs ----
{
  const { device, liveCount } = makeMockGpuDevice();
  const bufs = [];
  for (let i = 0; i < 50; i++) bufs.push(device.createBuffer({ usage: 'vertex', bytes: 64 }));
  ok('50 createBuffer calls leave 50 live handles', liveCount() === 50, String(liveCount()));
  for (const b of bufs) device.dispose(b);
  ok('disposing every handle individually leaves 0 live', liveCount() === 0, String(liveCount()));

  const tex = device.createTexture({ format: 'rgba32ui', width: 4, height: 4 });
  const target = device.createTarget({ color: [tex] });
  ok('createTarget produces a distinct handle from its texture', target !== tex);
  ok('2 live handles after texture + target', liveCount() === 2, String(liveCount()));
  device.dispose(); // whole-device teardown
  ok('device.dispose() with no argument frees everything', liveCount() === 0, String(liveCount()));
}

// ---- descriptor reuse / no per-frame (re)creation ----
// A well-behaved caller (MeshBuffers.js) builds each GPU resource ONCE per
// MeshData id+version and reuses the returned handle across frames - this
// probes that pattern (not the mock itself, which always creates on
// request): 1000 "frames" that only call createBuffer on a genuine cache
// miss must produce exactly 1 live buffer, never 1000.
{
  const mock = makeMockGpuDevice();
  const { device } = mock;
  const cache = new Map();
  function getOrCreate(id) {
    let h = cache.get(id);
    if (!h) { h = device.createBuffer({ usage: 'vertex', bytes: 64 }); cache.set(id, h); }
    return h;
  }
  const createsBefore = mock.createCount;
  for (let frame = 0; frame < 1000; frame++) getOrCreate('mesh:tower');
  ok('1000 frames of a cache-hit getOrCreate() call createBuffer exactly once', mock.createCount - createsBefore === 1, String(mock.createCount - createsBefore));
}

// ---- bind/draw bookkeeping (sanity - a real device's bind()/draw() do the
// equivalent GL calls; the mock just records the last call for assertions) ----
{
  const { device } = makeMockGpuDevice();
  const pipeline = device.createPipeline({ vertex: { src: { glsl: '' } }, fragment: { src: { glsl: '' }, targets: 1 } });
  device.beginPass(device.createTarget({ color: [device.createTexture({ format: 'rgba8', width: 1, height: 1 })] }));
  device.bind(pipeline, { vertexBuffer: device.createBuffer({ usage: 'vertex', bytes: 64 }) });
  device.draw(36, 0, 1);
  device.endPass();
  ok('draw() recorded the call', device._lastDraw && device._lastDraw.count === 36);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
