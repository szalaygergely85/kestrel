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
    setPipeline() { calls.push('setPipeline'); }, setBindGroup(i, g, dyn) { calls.push('setBindGroup'); sets.push({ i, dyn: dyn && Array.from(dyn) }); }, setVertexBuffer(i) { sets.push({ vb: i }); }, setIndexBuffer() {},
    draw() { calls.push('draw'); }, drawIndexed() { calls.push('drawIndexed'); }, end() { calls.push('end'); },
  });
  const rec = (n) => () => { calls.push(n); return obj(n); };
  const queue = { writeBuffer() { calls.push('writeBuffer'); }, writeTexture(dst, data, layout, size) { calls.push('writeTexture'); this.lastWrite = { ox: dst.origin[0], oy: dst.origin[1], bpr: layout.bytesPerRow, rpi: layout.rowsPerImage, w: size[0], h: size[1] }; this.objs = [dst, layout, size]; }, submit() { calls.push('submit'); } };
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
// WG-2b: clip-y-flipped default and mirrored pipeline winding are baked independently.
{
  const g = mockGpu(), descriptors = [];
  const original = g.createRenderPipeline;
  g.createRenderPipeline = (desc) => { descriptors.push(desc); return original(desc); };
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const base = { vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 1 }, targetFormats: ['rgba8'], cull: 'back' };
  d.createPipeline(base); d.createPipeline({ ...base, frontFace: 'ccw' });
  ok('default raster frontFace remains cw', descriptors[0].primitive.frontFace === 'cw');
  ok('mirror frontFace override is ccw with back culling preserved', descriptors[1].primitive.frontFace === 'ccw' && descriptors[1].primitive.cullMode === 'back');
  d.dispose();
}
// WG-3d (38.8a 24b): a depth-only pipeline keeps its fragment stage when fragment.src.entry is named (terrain footprint carve).
{
  const g = mockGpu(), descriptors = [];
  const original = g.createRenderPipeline;
  g.createRenderPipeline = (desc) => { descriptors.push(desc); return original(desc); };
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const depthOnly = { vertex: { src: { wgsl: 'x' } }, targetFormats: [], depthFormat: 'depth32f', depth: { test: true, write: true } };
  d.createPipeline({ ...depthOnly, fragment: { src: null, targets: 0 } });
  d.createPipeline({ ...depthOnly, fragment: { src: { wgsl: 'x' }, targets: 0 } });
  d.createPipeline({ ...depthOnly, fragment: { src: { wgsl: 'x', entry: 'fs_shadow' }, targets: 0 } });
  ok('depth-only without entry: no fragment stage', !descriptors[0].fragment && !descriptors[1].fragment);
  ok('depth-only with fragment.src.entry keeps the fragment stage (0 targets)', descriptors[2].fragment && descriptors[2].fragment.entryPoint === 'fs_shadow' && descriptors[2].fragment.targets.length === 0);
  d.dispose();
}
// WG-2b: optional extra per-vertex streams (cloth uv) bind after slot 0/1.
{
  const g = mockGpu(), descriptors = [];
  const original = g.createRenderPipeline;
  g.createRenderPipeline = (desc) => { descriptors.push(desc); return original(desc); };
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const lay = [{ name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 }];
  const uv = [{ name: 'aUV', location: 1, components: 2, type: 'float', offsetBytes: 0 }];
  const base = { vertex: { src: { wgsl: 'x' }, layout: lay, strideBytes: 16, extraLayouts: [{ layout: uv, strideBytes: 8 }] }, fragment: { src: { wgsl: 'x' }, targets: 1 }, targetFormats: ['rgba8'] };
  const pipe = d.createPipeline(base);
  const bufs = descriptors[0].vertex.buffers;
  ok('extra layout appended as vertex-step buffer 1', bufs.length === 2 && bufs[1].stepMode === 'vertex' && bufs[1].arrayStride === 8 && bufs[1].attributes[0].shaderLocation === 1);
  const inst = d.createPipeline({ ...base, vertex: { ...base.vertex, instanceLayout: uv, instanceStrideBytes: 8 } });
  ok('extra stream follows the instance buffer (slot 2)', descriptors[1].vertex.buffers.length === 3 && inst.extraBase === 2 && pipe.extraBase === 1);
  const plain = d.createPipeline({ ...base, vertex: { src: { wgsl: 'x' }, layout: lay, strideBytes: 16 } });
  ok('no extra layouts: unchanged buffer list', descriptors[2].vertex.buffers.length === 1);
  const b = d.createBuffer({ usage: 'vertex', bytes: 64 });
  const tgt = d.createTarget({ color: [d.createTexture({ format: 'rgba8', width: 4, height: 4 })] });
  d.beginPass(tgt);
  g.sets.length = 0;
  d.bind(pipe, { vertexBuffer: b, extraBuffers: [b] });
  ok('extraBuffers bound at extraBase + i', g.sets.filter((x) => x.vb !== undefined).map((x) => x.vb).join() === '0,1');
  d.endPass();
  d.dispose();
}
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

// ---- createGpuDevice failure paths (WG-5b: WebGPU only, every failure throws; no fallback)
const warns = [];
const okLimits = { maxColorAttachmentBytesPerSample: 64, maxSampledTexturesPerShaderStage: 16, maxColorAttachments: 8 };
const fakeCanvas = { getContext: () => null };
const run = async (name, opts, expect) => {
  warns.length = 0;
  let res, err = null;
  try { res = await createGpuDevice({ canvas: fakeCanvas, warn: (m) => warns.push(m), ...opts }); } catch (e) { err = e; }
  ok(name, expect(res, err), String((err && err.message) || (res && res.backend) || warns[0]));
};
await run('webgl2 request throws (removed in WG-5b)', { backend: 'webgl2' }, (r, e) => !!e && /removed/.test(e.message));
await run('webgpu: no navigator.gpu -> throws + warns', { backend: 'webgpu', navigatorGpu: null }, (r, e) => !!e && /no navigator\.gpu/.test(e.message) && warns.length === 1 && /no navigator\.gpu/.test(warns[0]));
await run('webgpu: no adapter -> throws', { backend: 'webgpu', navigatorGpu: { requestAdapter: async () => null } }, (r, e) => !!e && /no adapter/.test(e.message));
await run('webgpu: adapter below limits -> throws naming the limit', {
  backend: 'webgpu', navigatorGpu: { requestAdapter: async () => ({ limits: { ...okLimits, maxColorAttachmentBytesPerSample: 32 } }) },
}, (r, e) => !!e && /maxColorAttachmentBytesPerSample 32 < 36/.test(e.message));
await run('webgpu: requestDevice rejects -> throws', {
  backend: 'webgpu', navigatorGpu: { requestAdapter: async () => ({ limits: okLimits, features: new Set(), requestDevice: async () => { throw new Error('boom'); } }) },
}, (r, e) => !!e && /boom/.test(e.message));
{
  let asked = null;
  const adapter = { limits: okLimits, features: new Set(['timestamp-query']), requestDevice: async (d) => { asked = d; return mockGpu(); } };
  globalThis.GPUBufferUsage = consts.buf; globalThis.GPUTextureUsage = consts.tex; globalThis.GPUShaderStage = consts.stage; globalThis.GPUMapMode = consts.map;
  await run('webgpu: mock device, selfTest:false -> webgpu, adapter limits requested', {
    backend: 'webgpu', selfTest: false, canvas: null, navigatorGpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'rgba8unorm' },
  }, (r) => r && r.backend === 'webgpu' && asked.requiredLimits.maxColorAttachmentBytesPerSample === 64 && asked.requiredFeatures.includes('timestamp-query'));
  await run('webgpu: self-test failure (mock cannot readback) -> throws', {
    backend: 'webgpu', navigatorGpu: { requestAdapter: async () => adapter },
  }, (r, e) => !!e && /self-test failed/.test(e.message));
  // the canvas is attached only after success: a failure never touches canvas.getContext
  const calls = [];
  const spyCanvas = { getContext: (k) => { calls.push(k); return null; } };
  const runSpy = async (opts) => { try { await createGpuDevice({ canvas: spyCanvas, warn: () => {}, backend: 'webgpu', ...opts }); } catch (_) { /* expected */ } };
  await runSpy({ navigatorGpu: { requestAdapter: async () => null } });
  ok('no adapter: canvas.getContext never called', calls.length === 0, calls.join());
  await runSpy({ navigatorGpu: { requestAdapter: async () => adapter } });
  ok('self-test fails: canvas.getContext never called', calls.length === 0, calls.join());
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
  ok('writeTexture sets rowsPerImage = h (full + sub rect; regression for 105ea67)', w1.rpi === 4 && w2.rpi === 2);
  d.writeTexture(t, new Uint8Array(8 * 4 * 4), { x: 1, y: 0, w: 3, h: 2, stride: 8 });
  ok('writeTexture stride: bytesPerRow = stride*bpp, rowsPerImage = h', g.queue.lastWrite.bpr === 32 && g.queue.lastWrite.rpi === 2);
  d.writeTexture(t, new Uint8Array(8 * 4 * 4));
  const third = g.queue.objs;
  ok('writeTexture reuses dst/layout/size objects per texture', third[0] === first[0] && third[1] === first[1] && third[2] === first[2]);
  ok('writeTexture back to full rect resets origin', g.queue.lastWrite.ox === 0 && g.queue.lastWrite.w === 8);
  // WG-3f: dataOffset (elements) -> layout.offset in bytes, reset to 0 when absent; rgba8ui format
  d.writeTexture(t, new Uint32Array(64), { x: 0, y: 1, w: 2, h: 1 }, 8);
  ok('writeTexture dataOffset -> byte offset (elements * BYTES_PER_ELEMENT)', g.queue.objs[1].offset === 32);
  d.writeTexture(t, new Uint8Array(8 * 4 * 4));
  ok('writeTexture without dataOffset resets offset 0, same layout object', g.queue.objs[1].offset === 0 && g.queue.objs[1] === first[1]);
  const at = d.createTexture({ format: 'rgba8ui', width: 4, height: 2 });
  ok('rgba8ui -> rgba8uint 4 B/texel', at.gpuFormat === 'rgba8uint' && at.bpp === 4);
  d.writeTexture(at, new Uint8Array(32));
  ok('rgba8ui writeTexture bytesPerRow 16', g.queue.lastWrite.bpr === 16);
  d.dispose();
}

// ---- WG-2a: creation-time validation scopes, without relying on uncapturederror delivery
{
  const g = mockGpu();
  const stack = [], deferred = [], scopedCalls = [];
  let flushed = 0;
  g.queue.onSubmittedWorkDone = async () => { flushed++; };
  g.pushErrorScope = (kind) => { stack.push({ kind, error: null }); };
  g.popErrorScope = () => {
    const scope = stack.pop();
    return new Promise((resolve) => deferred.push(() => resolve(scope.error)));
  };
  for (const name of ['createShaderModule', 'createRenderPipeline', 'createBindGroup']) {
    const original = g[name];
    g[name] = (desc) => {
      const scope = stack.at(-1);
      if (!scope || scope.kind !== 'validation') throw new Error(name + ' outside a creation scope');
      scopedCalls.push(name);
      if (name === 'createRenderPipeline') scope.error = { message: 'bad pipeline layout' };
      return original(desc);
    };
  }
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const a = await d.checkErrors();
  ok('checkErrors: clean device -> []', Array.isArray(a) && a.length === 0);
  ok('checkErrors preserves queue flush for uncaptured runtime errors', flushed === 1);
  const p = d.createPipeline({ vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 1 },
    bindings: { uniformBytes: 16, textures: [] }, targetFormats: ['rgba8'] });
  ok('shader and pipeline creations are scoped; identical shader stays cached',
    scopedCalls.join() === 'createBindGroup,createShaderModule,createRenderPipeline' && stack.length === 0);
  let settled = false;
  const first = d.checkErrors().then((errors) => { settled = true; return errors; });
  const concurrent = d.checkErrors();
  await Promise.resolve();
  ok('checkErrors awaits unresolved creation pops', !settled);
  for (const release of deferred.splice(0)) release();
  const b = await first, c = await concurrent;
  ok('pipeline scope error reported without uncaptured event', b.length === 1 && /createRenderPipeline: bad pipeline layout/.test(b[0]));
  ok('concurrent checkErrors also awaits the pending scopes', c.length === 1 && c[0] === b[0]);
  ok('checkErrors drains pending promises, keeps error history', d._pendingScopes.length === 0 && (await d.checkErrors()).length === 1);
  const tgt = d.createTarget({ color: [] });
  d.beginPass(tgt); d.bind(p, { uniforms: new Float32Array(4) });
  const count = scopedCalls.length;
  d.bind(p, { uniforms: new Float32Array(4) }); d.endPass();
  ok('lazy empty bind group is scoped only once', scopedCalls.at(-1) === 'createBindGroup' && scopedCalls.length === count);
  for (const release of deferred.splice(0)) release();
  await d.checkErrors();
  // A synchronous exception must still pop its creation scope.
  g.createShaderModule = () => { throw new Error('sync shader error'); };
  ok('sync creation failure pops scope', throws(() => d._module({ wgsl: 'bad' })) && stack.length === 0);
  for (const release of deferred.splice(0)) release();
  await d.checkErrors(); d.dispose();
}
{
  // Texture bind groups built on first bind use the same scope mechanism; warm binds add no promise/resource.
  const g = mockGpu(), stack = [];
  g.pushErrorScope = () => stack.push(null);
  g.popErrorScope = async () => stack.pop();
  const original = g.createBindGroup;
  g.createBindGroup = (desc) => { stack[stack.length - 1] = { message: 'bad texture binding' }; return original(desc); };
  const d = new GpuDeviceWebGPU(g, { consts, ringSlots: 8 });
  const tex = d.createTexture({ format: 'rgba8', width: 1, height: 1 });
  const p = d.createPipeline({ vertex: { src: { wgsl: 'x' } }, fragment: { src: { wgsl: 'x' }, targets: 1 },
    bindings: { uniformBytes: 0, textures: ['float'] }, targetFormats: ['rgba8'] });
  await d.checkErrors();
  d.beginPass(d.createTarget({ color: [tex] }));
  const bind = { textures: [{ slot: 0, texture: tex }] };
  d.bind(p, bind);
  const pending = d._pendingScopes.length, made = g.calls.filter((c) => c === 'createBindGroup').length;
  for (let i = 0; i < 1000; i++) d.bind(p, bind);
  d.endPass();
  ok('warm texture binds allocate no new scopes or bind groups', d._pendingScopes.length === pending && g.calls.filter((c) => c === 'createBindGroup').length === made);
  const errors = await d.checkErrors();
  ok('texture bind-group scope error reported', errors.length === 1 && /createBindGroup: bad texture binding/.test(errors[0]));
  d.dispose();
}

// WG-4a: compute additions - buffer usages, compute pipeline layout, dispatch (bind group cache, uniform ring), drawIndirect.
{
  const g = mockGpu(), cdesc = [], bdesc = [], groups = [], dispatched = [], indirect = [];
  g.createBuffer = (d) => { bdesc.push(d); return { destroy() {} }; };
  g.createComputePipeline = (d) => { cdesc.push(d); return { cp: true }; };
  g.createBindGroup = (d) => { groups.push(d); return { bg: groups.length }; };
  const encoder = { beginRenderPass: () => ({}), beginComputePass: () => ({
    setPipeline() {}, setBindGroup(i, grp, dyn) { dispatched.push({ i, dyn: dyn && Array.from(dyn) }); }, dispatchWorkgroups(x, y, z) { dispatched.push({ x, y, z }); }, end() {},
  }), finish: () => ({}) };
  g.createCommandEncoder = () => encoder;
  const c2 = { buf: { ...consts.buf, STORAGE: 32, INDIRECT: 64, COPY_SRC: 128 }, tex: consts.tex, stage: { ...consts.stage, COMPUTE: 4 }, map: consts.map };
  const d = new GpuDeviceWebGPU(g, { consts: c2, ringSlots: 8 });
  const st = d.createBuffer({ usage: 'storage', bytes: 64 }), ind = d.createBuffer({ usage: 'indirect', bytes: 40 });
  ok('storage usage = STORAGE|VERTEX|COPY_SRC|COPY_DST', bdesc[bdesc.length - 2].usage === (32 | 4 | 128 | 2));
  ok('indirect usage = INDIRECT|STORAGE|COPY_SRC|COPY_DST', bdesc[bdesc.length - 1].usage === (64 | 32 | 128 | 2));
  const p = d.createComputePipeline({ src: { wgsl: 'x' }, bindings: { uniformBytes: 32, buffers: ['read', 'rw', 'rw'] } });
  ok('compute pipeline: entry cs_main, 3 storage binds (read-only / storage) + group 1 uniform',
    cdesc[0].compute.entryPoint === 'cs_main' && g.layouts[g.layouts.length - 2].entries.map((e) => e.buffer.type).join() === 'read-only-storage,storage,storage'
    && g.layouts[g.layouts.length - 2].entries[0].visibility === 4 && g.layouts[g.layouts.length - 1].entries[0].buffer.hasDynamicOffset === true);
  const bind = { buffers: [{ slot: 0, buffer: st }, { slot: 1, buffer: st }, { slot: 2, buffer: ind }], uniforms: new Float32Array(8) };
  const made = groups.length;
  d.dispatch(p, bind, 3, 1, 1);
  d.dispatch(p, bind, 4);
  ok('dispatch: one buffer bind group per distinct handle set (second dispatch reuses it)', groups.length === made + 1);
  ok('dispatch: group 0 + group 1 with a dynamic offset, then workgroups', dispatched[0].i === 0 && dispatched[1].i === 1 && dispatched[1].dyn.length === 1 && dispatched[2].x === 3 && dispatched[5].x === 4 && dispatched[5].y === 1);
  ok('dispatch: second call uses the next ring slot (offset 256)', dispatched[4].dyn[0] === 256);
  ok('dispatch with the wrong buffer count throws', throws(() => d.dispatch(p, { buffers: [{ slot: 0, buffer: st }] }, 1)));
  d.beginPass(d.createTarget({ color: [d.createTexture({ format: 'rgba8', width: 4, height: 4 })] }));
  ok('dispatch inside a render pass throws', throws(() => d.dispatch(p, bind, 1)));
  d._pass.drawIndirect = (b, o) => indirect.push(['draw', o]); d._pass.drawIndexedIndirect = (b, o) => indirect.push(['indexed', o]);
  d._curPipeline = { indexed: true }; d.drawIndirect(ind, 20);
  d._curPipeline = { indexed: false }; d.drawIndirect(ind, 0);
  ok('drawIndirect follows the bound pipeline (indexed -> drawIndexedIndirect)', indirect.length === 2 && indirect[0][0] === 'indexed' && indirect[0][1] === 20 && indirect[1][0] === 'draw');
  d._pass = null;
  d.dispose();
}

// 38.10a (S8-B1-06): dispose(buffer) prunes every cached dispatch bind group in p.groups that references it;
// dispose(computePipeline) drops it from the device's compute-pipeline list. Hot dispatch lookup is unchanged.
{
  const g = mockGpu(), groups2 = [];
  g.createBuffer = () => ({ destroy() {} });
  g.createComputePipeline = (d) => ({ cp: true });
  g.createBindGroup = (d) => { groups2.push(d); return { bg: groups2.length }; };
  const cp2 = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
  g.createCommandEncoder = () => ({ beginComputePass: () => cp2, finish: () => ({}) });
  const c2 = { buf: { ...consts.buf, STORAGE: 32, INDIRECT: 64, COPY_SRC: 128 }, tex: consts.tex, stage: { ...consts.stage, COMPUTE: 4 }, map: consts.map };
  const d2 = new GpuDeviceWebGPU(g, { consts: c2, ringSlots: 8 });
  const p2 = d2.createComputePipeline({ src: { wgsl: 'x' }, bindings: { buffers: ['rw', 'rw', 'rw', 'rw', 'rw'] } });
  const A = d2.createBuffer({ usage: 'storage', bytes: 16 }), B = d2.createBuffer({ usage: 'storage', bytes: 16 });
  const C = d2.createBuffer({ usage: 'storage', bytes: 16 }), De = d2.createBuffer({ usage: 'storage', bytes: 16 }), E = d2.createBuffer({ usage: 'storage', bytes: 16 });
  const bufsAll = { buffers: [{ slot: 0, buffer: A }, { slot: 1, buffer: B }, { slot: 2, buffer: C }, { slot: 3, buffer: De }, { slot: 4, buffer: E }] };
  d2.dispatch(p2, bufsAll, 1);
  ok('dispatch with set {A..E} builds exactly one bind group', p2.groups.length === 1);
  d2.dispose(A);
  ok('dispose(A) prunes the cached group referencing it', p2.groups.length === 0);
  d2.dispatch(p2, bufsAll, 1);
  ok('next dispatch with the same set builds exactly one new group', p2.groups.length === 1);
  ok('the compute pipeline is tracked', d2._computePipes.indexOf(p2) >= 0);
  d2.dispose(p2);
  ok('dispose(computePipeline) drops it from the tracked list', d2._computePipes.indexOf(p2) < 0);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
