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
        default: return () => {};
      }
    },
  });
  return { gl, live };
}

// ---- shape ----
{
  const { gl } = makeMockGL();
  const device = new GpuDeviceGL2(/** @type {any} */(gl));
  for (const name of GPU_DEVICE_METHODS) ok(`GpuDeviceGL2 exposes ${name}()`, typeof device[name] === 'function');
  ok('GpuDeviceGL2 exposes caps', typeof device.caps.maxColorAttachments === 'number');
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
