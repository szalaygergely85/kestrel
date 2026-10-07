// engine/render/gpu/device/GpuDeviceWebGPU.test.js - WG-1b2. Pure/mock tests (no adapter):
//   node engine/render/gpu/device/GpuDeviceWebGPU.test.js
import { textureFormatFor, depthFormatFor, vertexFormatFor, padTo256, depadRows, readbackLayout } from './webgpuFormats.js';
import { GpuDeviceWebGPU } from './GpuDeviceWebGPU.js';
import { createGpuDevice, selfTestDevice } from './createGpuDevice.js';
import { GPU_DEVICE_METHODS } from './GpuDevice.js';
import { makeOk } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const throws = (f) => { try { f(); return false; } catch { return true; } };

// ---- pure helpers
ok('format map rgba32ui', textureFormatFor('rgba32ui').gpu === 'rgba32uint' && textureFormatFor('rgba32ui').bpp === 16);
ok('format map r32ui/r8ui/rgba8', textureFormatFor('r32ui').gpu === 'r32uint' && textureFormatFor('r8ui').gpu === 'r8uint' && textureFormatFor('rgba8').gpu === 'rgba8unorm');
ok('depth24 -> depth24plus, sampled -> depth32float', textureFormatFor('depth24').gpu === 'depth24plus' && textureFormatFor('depth24', true).gpu === 'depth32float');
ok('unknown format throws', throws(() => textureFormatFor('nope')));
ok('depthFormatFor', depthFormatFor('depth24') === 'depth24plus' && depthFormatFor('depth32f') === 'depth32float');
ok('vertex formats', vertexFormatFor('float', 3) === 'float32x3' && vertexFormatFor('uint', 1) === 'uint32' && vertexFormatFor('uint', 4) === 'uint32x4');
ok('padTo256', padTo256(1) === 256 && padTo256(256) === 256 && padTo256(257) === 512 && padTo256(64) === 256);
{
  const lay = readbackLayout(4, 4, 16);
  ok('readbackLayout 4x4 rgba32uint', lay.rowBytes === 64 && lay.paddedRowBytes === 256 && lay.bufferBytes === 1024);
  const src = new Uint8Array(1024);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) src[y * 256 + x] = y * 64 + x;
  const out = new Uint8Array(256);
  depadRows(src, 256, 64, 4, out);
  let good = true;
  for (let i = 0; i < 256; i++) if (out[i] !== i) good = false;
  ok('depadRows exact', good);
  const tight = new Uint8Array(256).fill(9), o2 = new Uint8Array(256);
  depadRows(tight, 256, 256, 1, o2);
  ok('depadRows unpadded row', o2[255] === 9);
  ok('depadRows small out throws', throws(() => depadRows(src, 256, 64, 4, new Uint8Array(10))));
}

// ---- mock GPUDevice: records calls
let g_last = null;
function mockGpu() {
  const calls = [], sets = [], layouts = [], samplers = [];
  const obj = (n) => ({
    n, createView: () => ({ view: n }), destroy() {},
    setPipeline() { calls.push('setPipeline'); }, setBindGroup(i, g, dyn) { calls.push('setBindGroup'); sets.push({ i, dyn: dyn && Array.from(dyn) }); }, setVertexBuffer() {}, setIndexBuffer() {},
    draw() { calls.push('draw'); }, drawIndexed() { calls.push('drawIndexed'); }, end() { calls.push('end'); },
  });
  const rec = (n) => () => { calls.push(n); return obj(n); };
  const queue = { writeBuffer() { calls.push('writeBuffer'); }, writeTexture(dst, data, layout, size) { calls.push('writeTexture'); this.lastWrite = { ox: dst.origin[0], oy: dst.origin[1], bpr: layout.bytesPerRow, w: size[0], h: size[1] }; this.objs = [dst, layout, size]; }, submit() { calls.push('submit'); } };
  return {
    calls, sets, layouts, queue, limits: { maxColorAttachments: 8 }, lost: new Promise(() => {}),
    createBuffer: rec('createBuffer'), createTexture: rec('createTexture'), createSampler: rec('createSampler'),
    createShaderModule: rec('createShaderModule'), createBindGroupLayout: (d) => { calls.push('createBindGroupLayout'); layouts.push(d); return obj('bgl'); }, createPipelineLayout: (d) => { calls.push('createPipelineLayout'); g_last = d; return obj('pl'); },
    createBindGroup: rec('createBindGroup'), createRenderPipeline: rec('createRenderPipeline'),
    createCommandEncoder: () => ({ beginRenderPass: rec('beginRenderPass'), finish: () => ({}) }),
  };
}
const consts = {
  buf: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, MAP_READ: 16 },
  tex: { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_SRC: 4, COPY_DST: 8 },
  stage: { VERTEX: 1, FRAGMENT: 2 }, map: { READ: 1 },
};
{
  const g = mockGpu();
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  ok('shape: GPU_DEVICE_METHODS all functions', GPU_DEVICE_METHODS.every((m) => typeof d[m] === 'function'));
  ok('backend/caps/timer/lost', d.backend === 'webgpu' && d.caps.maxColorAttachments === 8 && d.caps.timerQueries === false && typeof d.timer.begin === 'function' && d.lost instanceof Promise);
  const a = d.createTexture({ format: 'rgba32ui', width: 4, height: 4 });
  const dep = d.createTexture({ format: 'depth24', width: 4, height: 4 });
  const tgt = d.createTarget({ color: [a], depth: dep });
  const pipe = d.createPipeline({
    vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 1 }, depth: { test: true, write: true },
    bindings: { uniformBytes: 32, textures: ['uint'] }, targetFormats: ['rgba32ui'], depthFormat: 'depth24',
  });
  ok('one shader module for identical src', g.calls.filter((c) => c === 'createShaderModule').length === 1);
  ok('targetFormats/targets mismatch throws', throws(() => d.createPipeline({ vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 2 }, targetFormats: ['rgba32ui'] })));
  d.beginPass(tgt, { clear: true });
  d.bind(pipe, { uniforms: new Float32Array(8), textures: [{ slot: 0, texture: a }] });
  d.draw(3);
  const groups = g.calls.filter((c) => c === 'createBindGroup').length;
  d.bind(pipe, { uniforms: new Float32Array(8), textures: [{ slot: 0, texture: a }] });
  d.draw(3);
  ok('texture bind group cached while handles are unchanged', g.calls.filter((c) => c === 'createBindGroup').length === groups);
  ok('ring: two uniform slots used', d.uniformRing.usedSlots === 2);
  d.endPass();
  d.submit();
  ok('submit: one ring writeBuffer then submit, ring reset', g.calls.slice(-2).join() === 'writeBuffer,submit' && d.uniformRing.usedSlots === 0);
  d.beginPass(tgt);
  ok('beginPass twice throws', throws(() => d.beginPass(tgt)));
  d.endPass();
  ok('canvasTarget without canvas throws at beginPass', throws(() => d.beginPass(d.canvasTarget())));
  ok('writeTexture rejects depth', throws(() => d.writeTexture(dep, new Uint8Array(4))));
  d.dispose();
}

{
  // sampler binding numbers, uniformOffsetBytes path, no-uniform pipeline layout/group calls
  const g = mockGpu();
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const a = d.createTexture({ format: 'rgba8', width: 4, height: 4 });
  const tgt = d.createTarget({ color: [a] });
  const base = { vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 1 }, targetFormats: ['rgba8'] };
  const nl = g.layouts.length;
  d.createPipeline({ ...base, bindings: { uniformBytes: 0, textures: ['float', 'filtered', 'uint', 'filtered'] } });
  const e0 = g.layouts[nl].entries;
  ok('sampler binding of k-th filtered slot = textures.length + k', e0.filter((e) => e.sampler).map((e) => e.binding).join() === '4,5');
  ok('no uniforms: layout has only group 0', g_last.bindGroupLayouts.length === 1 && g.layouts.length === nl + 1);
  const pU = d.createPipeline({ ...base, bindings: { uniformBytes: 64, textures: [] } });
  ok('uniforms: layout has groups 0 and 1', g_last.bindGroupLayouts.length === 2);
  const pN = d.createPipeline({ ...base, bindings: { uniformBytes: 0, textures: [] } });
  d.beginPass(tgt, { clear: true });
  g.sets.length = 0;
  d.bind(pN, {});
  ok('no uniforms/textures: only empty group 0 set, no group 1', g.sets.length === 1 && g.sets[0].i === 0);
  g.sets.length = 0;
  d.bind(pU, { uniformOffsetBytes: 768 });
  ok('uniformOffsetBytes: no ring alloc, dynamic offset passed', d.uniformRing.usedBytes === 0 && g.sets.some((s) => s.i === 1 && s.dyn[0] === 768) && g.sets[0].i === 0);
  d.endPass();
}

// ---- createGpuDevice failure / fallback paths
const warns = [];
const gl = { fake: 'gl', getParameter: () => 4, getExtension: () => null, createQuery: () => ({}) };
const okLimits = { maxColorAttachmentBytesPerSample: 64, maxSampledTexturesPerShaderStage: 16, maxColorAttachments: 8 };
const fakeCanvas = { getContext: (k) => (k === 'webgl2' ? gl : null) };
const run = async (name, opts, expect) => {
  warns.length = 0;
  let res, err = null;
  try { res = await createGpuDevice({ canvas: fakeCanvas, warn: (m) => warns.push(m), ...opts }); } catch (e) { err = e; }
  ok(name, expect(res, err), String((err && err.message) || (res && res.backend) || warns[0]));
};
await run('webgl2 request returns GL2 device', { backend: 'webgl2' }, (r) => r && r.backend === 'webgl2');
await run('webgl2 without context throws', { backend: 'webgl2', canvas: { getContext: () => null } }, (r, e) => !!e && /WebGL2 unavailable/.test(e.message));
await run('webgpu: no navigator.gpu -> warn + webgl2', { backend: 'webgpu', navigatorGpu: null }, (r) => r && r.backend === 'webgl2' && warns.length === 1 && /no navigator\.gpu/.test(warns[0]));
await run('webgpu fallback:false -> throws', { backend: 'webgpu', navigatorGpu: null, fallback: false }, (r, e) => !!e && /no navigator\.gpu/.test(e.message));
await run('webgpu: no adapter -> fallback', { backend: 'webgpu', navigatorGpu: { requestAdapter: async () => null } }, (r) => r && r.backend === 'webgl2' && /no adapter/.test(warns[0]));
await run('webgpu: adapter below limits -> fallback names the limit', {
  backend: 'webgpu', navigatorGpu: { requestAdapter: async () => ({ limits: { ...okLimits, maxColorAttachmentBytesPerSample: 32 } }) },
}, (r) => r && r.backend === 'webgl2' && /maxColorAttachmentBytesPerSample 32 < 36/.test(warns[0]));
await run('webgpu: requestDevice rejects -> fallback', {
  backend: 'webgpu', navigatorGpu: { requestAdapter: async () => ({ limits: okLimits, features: new Set(), requestDevice: async () => { throw new Error('boom'); } }) },
}, (r) => r && r.backend === 'webgl2' && /boom/.test(warns[0]));
{
  let asked = null;
  const adapter = { limits: okLimits, features: new Set(['timestamp-query']), requestDevice: async (d) => { asked = d; return mockGpu(); } };
  globalThis.GPUBufferUsage = consts.buf; globalThis.GPUTextureUsage = consts.tex; globalThis.GPUShaderStage = consts.stage; globalThis.GPUMapMode = consts.map;
  await run('webgpu: mock device, selfTest:false -> webgpu, adapter limits requested', {
    backend: 'webgpu', selfTest: false, canvas: null, navigatorGpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'rgba8unorm' },
  }, (r) => r && r.backend === 'webgpu' && asked.requiredLimits.maxColorAttachmentBytesPerSample === 64 && asked.requiredFeatures.includes('timestamp-query'));
  await run('webgpu: self-test failure (mock cannot readback) -> fallback to webgl2', {
    backend: 'webgpu', navigatorGpu: { requestAdapter: async () => adapter },
  }, (r) => r && r.backend === 'webgl2' && /self-test failed/.test(warns[0]));
  // 38.8a: fallback:false must never touch canvas.getContext on a WebGPU failure (canvas stays free for the caller)
  const calls = [];
  const spyCanvas = { getContext: (k) => { calls.push(k); return null; } };
  const runSpy = async (opts) => { try { await createGpuDevice({ canvas: spyCanvas, warn: () => {}, fallback: false, backend: 'webgpu', ...opts }); } catch (_) { /* expected */ } };
  await runSpy({ navigatorGpu: { requestAdapter: async () => null } });
  ok('fallback:false, no adapter: canvas.getContext never called', calls.length === 0, calls.join());
  await runSpy({ navigatorGpu: { requestAdapter: async () => adapter } });
  ok('fallback:false, self-test fails: canvas.getContext never called', calls.length === 0, calls.join());
  const st = await selfTestDevice({ backend: 'webgl2' });
  ok('selfTestDevice on webgl2 is skipped ok', st.ok && !!st.skipped);
}

{
  // 38.8a (17): writeTexture reuses its destination/layout/size objects per texture handle (zero-alloc), values still correct
  const g = mockGpu();
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const t = d.createTexture({ format: 'rgba8', width: 8, height: 4 });
  d.writeTexture(t, new Uint8Array(8 * 4 * 4));
  const first = g.queue.objs.slice(), w1 = g.queue.lastWrite;
  ok('writeTexture full rect values', w1.ox === 0 && w1.oy === 0 && w1.bpr === 32 && w1.w === 8 && w1.h === 4);
  d.writeTexture(t, new Uint8Array(2 * 2 * 4), { x: 3, y: 1, w: 2, h: 2 });
  const w2 = g.queue.lastWrite;
  ok('writeTexture sub rect values', w2.ox === 3 && w2.oy === 1 && w2.bpr === 8 && w2.w === 2 && w2.h === 2);
  d.writeTexture(t, new Uint8Array(8 * 4 * 4));
  const third = g.queue.objs;
  ok('writeTexture reuses dst/layout/size objects per texture', third[0] === first[0] && third[1] === first[1] && third[2] === first[2]);
  ok('writeTexture back to full rect resets origin', g.queue.lastWrite.ox === 0 && g.queue.lastWrite.w === 8);
  d.dispose();
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
