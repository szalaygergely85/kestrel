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
function mockGpu() {
  const calls = [];
  const obj = (n) => ({
    n, createView: () => ({ view: n }), destroy() {},
    setPipeline() { calls.push('setPipeline'); }, setBindGroup() { calls.push('setBindGroup'); }, setVertexBuffer() {}, setIndexBuffer() {},
    draw() { calls.push('draw'); }, drawIndexed() { calls.push('drawIndexed'); }, end() { calls.push('end'); },
  });
  const rec = (n) => () => { calls.push(n); return obj(n); };
  const queue = { writeBuffer() { calls.push('writeBuffer'); }, writeTexture() { calls.push('writeTexture'); }, submit() { calls.push('submit'); } };
  return {
    calls, queue, limits: { maxColorAttachments: 8 }, lost: new Promise(() => {}),
    createBuffer: rec('createBuffer'), createTexture: rec('createTexture'), createSampler: rec('createSampler'),
    createShaderModule: rec('createShaderModule'), createBindGroupLayout: rec('createBindGroupLayout'), createPipelineLayout: rec('createPipelineLayout'),
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
  const st = await selfTestDevice({ backend: 'webgl2' });
  ok('selfTestDevice on webgl2 is skipped ok', st.ok && !!st.skipped);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
