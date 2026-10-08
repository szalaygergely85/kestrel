// @ts-check
// engine/render/gpu/device/GpuDeviceGL2.test.js - ME-03b. A counting mock
// `gl` (same Proxy trick as gridTargets.test.js: any ALL_CAPS property name
// is a memoized fake GL constant) - no real WebGL2 context - checks
// GpuDeviceGL2 creates/frees the right object kinds and that `dispose()`
// leaves zero live handles, mirroring gridTargets.test.js's own alloc/free
// leak check.
//
//   node engine/render/gpu/device/GpuDeviceGL2.test.js
import { GpuDeviceGL2 } from './GpuDeviceGL2.js';
import { GPU_DEVICE_METHODS } from './GpuDevice.js';
import { makeOk } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeMockGL() {
  const live = { buffer: 0, texture: 0, framebuffer: 0, program: 0, vao: 0, renderbuffer: 0, shader: 0 };
  const consts = {};
  const calls = []; // [name, ...args] of every state call (ME-15b descriptor checks)
  let nextConst = 1;
  const gl = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(prop)) {
        if (!(prop in consts)) consts[prop] = nextConst++;
        return consts[prop];
      }
      switch (prop) {
        case 'createBuffer': return () => { live.buffer++; return {}; };
        case 'deleteBuffer': return (o) => { if (o) live.buffer--; };
        case 'createTexture': return () => { live.texture++; return {}; };
        case 'deleteTexture': return (o) => { if (o) live.texture--; };
        case 'createFramebuffer': return () => { live.framebuffer++; return {}; };
        case 'deleteFramebuffer': return (o) => { if (o) live.framebuffer--; };
        case 'createRenderbuffer': return () => { live.renderbuffer++; return {}; };
        case 'deleteRenderbuffer': return (o) => { if (o) live.renderbuffer--; };
        case 'createProgram': return () => { live.program++; return {}; };
        case 'deleteProgram': return (o) => { if (o) live.program--; };
        case 'createVertexArray': return () => { live.vao++; return {}; };
        case 'deleteVertexArray': return (o) => { if (o) live.vao--; };
        case 'createShader': return () => { live.shader++; return {}; };
        case 'deleteShader': return (o) => { if (o) live.shader--; };
        case 'checkFramebufferStatus': return () => gl.FRAMEBUFFER_COMPLETE;
        case 'getShaderParameter': return () => true;
        case 'getProgramParameter': return () => true;
        case 'getParameter': return () => 8;
        case 'getUniformLocation': return () => null;
        default: return (...a) => { calls.push([prop, ...a]); };
      }
    },
  });
  return { gl, live, calls };
}

// ---- shape ----
{
  const { gl } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  for (const name of GPU_DEVICE_METHODS) ok(`GpuDeviceGL2 exposes ${name}()`, typeof device[name] === 'function');
  ok('GpuDeviceGL2 exposes caps', typeof device.caps.maxColorAttachments === 'number');
  ok('GpuDeviceGL2 backend + lost (WG-1b1)', device.backend === 'webgl2' && typeof device.lost.then === 'function');
}

// ---- WG-1b1: writeTexture (texSubImage2D), submit (no-op), canvasTarget (default framebuffer), filter ----
{
  const { gl, calls, live } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  const tex = device.createTexture({ format: 'rgba8', width: 8, height: 4, filter: 'linear' });
  ok('linear filter sets MIN+MAG LINEAR', calls.filter((c) => c[0] === 'texParameteri' && c[3] === gl.LINEAR).length === 2);
  calls.length = 0;
  device.writeTexture(tex, new Uint8Array(8 * 4 * 4));
  const sub = calls.find((c) => c[0] === 'texSubImage2D');
  ok('writeTexture -> texSubImage2D whole texture by default', !!sub && sub[3] === 0 && sub[4] === 0 && sub[5] === 8 && sub[6] === 4, JSON.stringify(sub && sub.slice(1, 7)));
  calls.length = 0;
  device.writeTexture(tex, new Uint8Array(16), { x: 2, y: 1, w: 2, h: 2 });
  const sub2 = calls.find((c) => c[0] === 'texSubImage2D');
  ok('writeTexture honours rect', !!sub2 && sub2[3] === 2 && sub2[4] === 1 && sub2[5] === 2 && sub2[6] === 2);
  ok('writeTexture default srcOffset 0', !!sub2 && sub2[10] === 0, JSON.stringify(sub2 && sub2.slice(9)));
  calls.length = 0;
  device.writeTexture(tex, new Uint8Array(64), { x: 0, y: 1, w: 4, h: 1 }, 16);
  const sub3 = calls.find((c) => c[0] === 'texSubImage2D');
  ok('writeTexture dataOffset -> srcOffset (elements, same array, no subarray)', !!sub3 && sub3[10] === 16 && sub3[9].length === 64, JSON.stringify(sub3 && sub3[10]));
  // rgba8ui (sprite atlas): RGBA8UI / RGBA_INTEGER / UNSIGNED_BYTE
  const atl = device.createTexture({ format: 'rgba8ui', width: 4, height: 2 });
  calls.length = 0; device.writeTexture(atl, new Uint8Array(32));
  const sub4 = calls.find((c) => c[0] === 'texSubImage2D');
  ok('rgba8ui texSubImage2D format RGBA_INTEGER/UNSIGNED_BYTE', !!sub4 && sub4[7] === gl.RGBA_INTEGER && sub4[8] === gl.UNSIGNED_BYTE);
  calls.length = 0;
  device.submit();
  ok('submit is a no-op on GL2', calls.length === 0);
  const ct = device.canvasTarget();
  ok('canvasTarget is stable, default framebuffer', ct === device.canvasTarget() && ct.handle === null && ct.width === 0);
  calls.length = 0;
  device.beginPass(ct);
  ok('beginPass(canvasTarget) binds framebuffer null, no viewport', calls.some((c) => c[0] === 'bindFramebuffer' && c[2] === null) && !calls.some((c) => c[0] === 'viewport'));
  const before = live.framebuffer;
  device.dispose();
  ok('canvasTarget owns no GL object', live.framebuffer === before);
}

// ---- createBuffer / createTexture / createTarget / createPipeline alloc + dispose() free ----
{
  const { gl, live } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  const vbuf = device.createBuffer({ usage: 'vertex', bytes: 64 });
  ok('createBuffer creates exactly one GL buffer', live.buffer === 1);

  const colorTex = device.createTexture({ format: 'rgba32ui', width: 4, height: 4 });
  const depthTex = device.createTexture({ format: 'depth24', width: 4, height: 4 });
  ok('createTexture(rgba32ui) creates a GL texture', live.texture === 1);
  ok('createTexture(depth24) creates a renderbuffer, not a texture', live.renderbuffer === 1 && live.texture === 1);

  const target = device.createTarget({ color: [colorTex], depth: depthTex });
  ok('createTarget creates one FBO', live.framebuffer === 1);

  const pipeline = device.createPipeline({
    vertex: { src: { glsl: 'x' }, layout: [{ name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 }], strideBytes: 12 },
    fragment: { src: { glsl: 'x' }, targets: 1 },
    depth: { test: true, write: true },
    cull: 'none',
  });
  ok('createPipeline creates one program', live.program === 1);
  ok('createPipeline creates one VAO', live.vao === 1);

  device.beginPass(target, { clear: true });
  device.bind(pipeline, { vertexBuffer: vbuf });
  device.draw(3, 0, 1);
  device.endPass();
  ok('beginPass/bind/draw/endPass do not throw and do not leak (no new handles)', live.buffer === 1 && live.texture === 1 && live.framebuffer === 1 && live.program === 1);

  device.dispose();
  const allZero = Object.values(live).every((n) => n === 0);
  ok('dispose() frees every handle this device created', allZero, JSON.stringify(live));
}

// ---- CLOTH-1b2: writeBuffer = bufferSubData into the existing buffer (no new GL buffer), dynamic hint ----
{
  const { gl, live, calls } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  const h = device.createBuffer({ usage: 'vertex', data: new Uint8Array(32), dynamic: true });
  ok('createBuffer({dynamic}) uses DYNAMIC_DRAW', calls.some((c) => c[0] === 'bufferData' && c[3] === gl.DYNAMIC_DRAW));
  calls.length = 0;
  const payload = new Uint8Array(16);
  device.writeBuffer(h, payload, 8);
  ok('writeBuffer: one bufferSubData(target, offset, data), no bufferData, no new buffer',
    calls.filter((c) => c[0] === 'bufferSubData').length === 1 && !calls.some((c) => c[0] === 'bufferData') && live.buffer === 1);
  const sub = calls.find((c) => c[0] === 'bufferSubData');
  ok('writeBuffer passes the target, the byte offset and the data view', sub[1] === gl.ARRAY_BUFFER && sub[2] === 8 && sub[3] === payload);
}

// ---- ME-15b (27.9a item 7): depthBias, depth-only target, sampled depth24 ----
{
  const { gl, live, calls } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  const names = () => calls.map((c) => c[0]);
  const depthTex = device.createTexture({ format: 'depth24', width: 8, height: 8, sampled: true });
  ok('sampled depth24 is a texture (not a renderbuffer)', live.renderbuffer === 0 && live.texture === 1 && depthTex.kind === 'texture');
  ok('sampled depth24 sets TEXTURE_COMPARE_MODE to NONE', calls.some((c) => c[0] === 'texParameteri' && c[2] === gl.TEXTURE_COMPARE_MODE && c[3] === gl.NONE));
  calls.length = 0;
  const target = device.createTarget({ color: [], depth: depthTex });
  ok('depth-only target: drawBuffers([NONE]) + readBuffer(NONE)', calls.some((c) => c[0] === 'drawBuffers' && c[1].length === 1 && c[1][0] === gl.NONE) && calls.some((c) => c[0] === 'readBuffer' && c[1] === gl.NONE));
  ok('depth-only target attaches the depth texture and records its size', calls.some((c) => c[0] === 'framebufferTexture2D' && c[2] === gl.DEPTH_ATTACHMENT) && target.colorCount === 0 && target.width === 8 && target.height === 8);
  const biased = device.createPipeline({ vertex: { src: { glsl: 'x' } }, fragment: { src: { glsl: 'x' }, targets: 0 }, depth: { test: true, write: true }, depthBias: { factor: 2, units: 4 } });
  const plain = device.createPipeline({ vertex: { src: { glsl: 'x' } }, fragment: { src: { glsl: 'x' }, targets: 1 } });
  calls.length = 0;
  device.beginPass(target, { clear: true });
  const n = names();
  ok('beginPass sets the viewport to the target size and unmasks depth before clearing', calls.some((c) => c[0] === 'viewport' && c[3] === 8 && c[4] === 8) && n.indexOf('depthMask') >= 0 && n.indexOf('depthMask') < n.indexOf('clearBufferfv'));
  calls.length = 0;
  device.beginPass(target, { clear: true });
  device.beginPass(target, { clear: true });
  const fvs = calls.filter((c) => c[0] === 'clearBufferfv');
  ok('beginPass(depth-only, clear) reuses the same clear array objects (no per-frame allocation) and clears no colour', fvs.length === 2 && fvs[0][3] === fvs[1][3] && !calls.some((c) => c[0] === 'clearBufferuiv'));
  calls.length = 0;
  device.bind(biased, {});
  ok('bind(depthBias pipeline) enables POLYGON_OFFSET_FILL with (factor, units)', calls.some((c) => c[0] === 'enable' && c[1] === gl.POLYGON_OFFSET_FILL) && calls.some((c) => c[0] === 'polygonOffset' && c[1] === 2 && c[2] === 4));
  calls.length = 0;
  device.endPass();
  ok('endPass disables POLYGON_OFFSET_FILL after a biased pipeline', calls.some((c) => c[0] === 'disable' && c[1] === gl.POLYGON_OFFSET_FILL));
  calls.length = 0;
  device.bind(plain, {});
  ok('bind(plain pipeline) leaves polygon offset off', !calls.some((c) => c[0] === 'enable' && c[1] === gl.POLYGON_OFFSET_FILL) && calls.some((c) => c[0] === 'disable' && c[1] === gl.POLYGON_OFFSET_FILL));
  device.dispose();
  ok('dispose() frees the sampled depth texture too', Object.values(live).every((v) => v === 0), JSON.stringify(live));
}

// ---- unhandled texture format throws (no silent GLenum fallback) ----
{
  const { gl } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  let threw = false;
  try { device.createTexture({ format: /** @type {any} */('bogus'), width: 1, height: 1 }); } catch (e) { threw = true; }
  ok('createTexture rejects an unknown format', threw);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
