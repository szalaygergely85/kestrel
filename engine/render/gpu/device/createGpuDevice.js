// @ts-check
// engine/render/gpu/device/createGpuDevice.js - WG-1b2 (docs/architecture.md 38.3/38.7).
// `async createGpuDevice({backend, canvas})` + `selfTestDevice(device)`. A `webgpu` request that fails
// (no navigator.gpu, no adapter, limits below 38.4, device creation, self-test) warns and falls back to
// WebGL2 until WG-5 (`fallback:false` makes it throw instead). The canvas is attached to WebGPU only after
// the adapter/device/self-test succeeded, so a failed request leaves it free for a WebGL2 context.

import { GpuDeviceGL2 } from './GpuDeviceGL2.js';
import { GpuDeviceWebGPU } from './GpuDeviceWebGPU.js';
import { REQUIRED_LIMITS, evaluateWebGpuLimits } from './webgpuProbe.js';
import { defineUniformBlock } from '../wgsl/uniformBlock.js';

/**
 * @typedef {Object} CreateGpuDeviceOptions
 * @property {'webgl2'|'webgpu'} backend
 * @property {any} canvas
 * @property {boolean} [fallback] webgpu only: warn + fall back to webgl2 on failure (default true)
 * @property {boolean} [selfTest] webgpu only: run selfTestDevice before returning (default true)
 * @property {(msg: string) => void} [warn]
 * @property {any} [navigatorGpu] override for tests
 * @property {any} [gl] webgl2 only: an existing context instead of `canvas.getContext('webgl2')`
 * @property {number} [ringSlots]
 */

/** Create the raw WebGPU device (no canvas yet). Throws with a readable message on any failure. @param {CreateGpuDeviceOptions} opts */
async function createWebGpuDevice(opts) {
  const gpu = opts.navigatorGpu !== undefined ? opts.navigatorGpu
    : (typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).gpu : undefined);
  if (!gpu) throw new Error('WebGPU unavailable (no navigator.gpu)');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU unavailable (no adapter)');
  const limits = adapter.limits || {};
  const ev = evaluateWebGpuLimits(limits);
  if (!ev.requiredOk) throw new Error('WebGPU adapter below required limits: ' + ev.missing.join(', '));
  // 38.4: request the adapter's own values for the required limits (the default 32 B/sample is not enough)
  /** @type {Record<string, number>} */
  const requiredLimits = {};
  for (const name of Object.keys(REQUIRED_LIMITS)) requiredLimits[name] = limits[name];
  /** @type {string[]} */
  const requiredFeatures = [];
  if (adapter.features && adapter.features.has && adapter.features.has('timestamp-query')) requiredFeatures.push('timestamp-query');
  const gpuDevice = await adapter.requestDevice({ requiredLimits, requiredFeatures });
  const canvasFormat = typeof gpu.getPreferredCanvasFormat === 'function' ? gpu.getPreferredCanvasFormat() : 'bgra8unorm';
  return new GpuDeviceWebGPU(gpuDevice, { adapter, canvasFormat, ringSlots: opts.ringSlots });
}

/** @param {CreateGpuDeviceOptions} opts */
function createWebGl2Device(opts) {
  const gl = opts.gl || (opts.canvas && opts.canvas.getContext('webgl2'));
  if (!gl) throw new Error('WebGL2 unavailable');
  return new GpuDeviceGL2(gl);
}

/**
 * @param {CreateGpuDeviceOptions} opts
 * @returns {Promise<import('./GpuDevice.js').GpuDevice|any>}
 */
export async function createGpuDevice(opts) {
  const warn = opts.warn || ((m) => { if (typeof console !== 'undefined') console.warn(m); });
  if (opts.backend === 'webgl2') return createWebGl2Device(opts);
  if (opts.backend !== 'webgpu') throw new Error(`createGpuDevice: unknown backend "${opts.backend}"`);
  const fallback = opts.fallback !== false;
  /** @type {GpuDeviceWebGPU|null} */
  let dev = null;
  try {
    dev = await createWebGpuDevice(opts);
    if (opts.selfTest !== false) {
      const r = await selfTestDevice(dev);
      if (!r.ok) throw new Error('WebGPU self-test failed: ' + (r.error || `${r.mismatches} mismatches`) + (dev.gpuErrors.length ? ' | ' + dev.gpuErrors[0] : ''));
    }
    if (opts.canvas) dev.attachCanvas(opts.canvas);
    return dev;
  } catch (e) {
    const msg = String(e && /** @type {any} */ (e).message || e);
    if (dev) { try { dev.dispose(); } catch { /* ignore */ } }
    if (!fallback) throw e;
    warn(`createGpuDevice: webgpu failed (${msg}); falling back to webgl2`);
    return createWebGl2Device(opts);
  }
}

// ---- self test --------------------------------------------------------------------------------------------------

const ST_BLOCK = defineUniformBlock('SelfTestU', [{ name: 'v', type: 'vec4' }, { name: 'z', type: 'f32' }]);
const ST_WGSL = `
${ST_BLOCK.wgsl}
@group(1) @binding(0) var<uniform> u: SelfTestU;
struct VO { @builtin(position) pos: vec4f };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(p[i], u.z, 1.0);
  return o;
}
struct FO { @location(0) a: vec4u, @location(1) b: vec4u, @location(2) c: u32 };
@fragment fn fs_main(@builtin(position) p: vec4f) -> FO {
  let x = u32(p.x);
  let y = u32(p.y);
  let v = bitcast<vec4u>(u.v);
  var o: FO;
  o.a = vec4u(x, y, v.x, 0xDEADBEEFu);
  o.b = vec4u(x + y * 4u, v.y, v.z, v.w);
  o.c = ((x << 16u) | y) + v.x;
  return o;
}`;

/**
 * 4x4 MRT draw (2x rgba32uint + r32uint + depth), two draws with different uniform-ring slots (the second sits
 * behind the first in depth and must be rejected), exact async readback incl. a sub-rect. WebGPU only
 * (the WGSL source is WebGPU-specific); a webgl2/mock device returns `{ok:true, skipped}`.
 * @param {any} device
 * @returns {Promise<{ok: boolean, backend: string, skipped?: string, mismatches: number, checked: number, error?: string, gpuErrors: string[], ms: number}>}
 */
export async function selfTestDevice(device) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const done = (/** @type {any} */ r) => ({ backend: device.backend, mismatches: 0, checked: 0, gpuErrors: device.gpuErrors ? device.gpuErrors.slice() : [], ...r, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 });
  if (device.backend !== 'webgpu') return done({ ok: true, skipped: 'backend ' + device.backend });
  const W = 4, H = 4;
  try {
    if (device.gpu.pushErrorScope) device.gpu.pushErrorScope('validation');
    const a = device.createTexture({ format: 'rgba32ui', width: W, height: H });
    const b = device.createTexture({ format: 'rgba32ui', width: W, height: H });
    const c = device.createTexture({ format: 'r32ui', width: W, height: H });
    const d = device.createTexture({ format: 'depth24', width: W, height: H });
    const target = device.createTarget({ color: [a, b, c], depth: d });
    const pipe = device.createPipeline({
      vertex: { src: { wgsl: ST_WGSL } },
      fragment: { src: { wgsl: ST_WGSL }, targets: 3 },
      depth: { test: true, write: true },
      bindings: { uniformBytes: ST_BLOCK.sizeBytes, textures: [] },
      targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'],
      depthFormat: 'depth24',
    });
    const ring = device.uniformRing;
    // raw u32 words carried in a vec4f field: keep them normal floats (0x3F800000 + n) so nothing can flush them
    const vA = [0x3F800000 + 1000, 0x3F800000 + 2000, 0x3F800000 + 3000, 0x3F800000 + 4000], vB = [0x40000007, 0x40000007, 0x40000007, 0x40000007];
    const zf = ST_BLOCK.field('z').word, vf = ST_BLOCK.field('v').word;
    ring.alloc(ST_BLOCK.sizeBytes); // a dummy slot first: the real blocks then sit at non-zero dynamic offsets
    const offA = ring.alloc(ST_BLOCK.sizeBytes), offB = ring.alloc(ST_BLOCK.sizeBytes);
    const wA = ring.word(offA), wB = ring.word(offB);
    for (let i = 0; i < 4; i++) { ring.u32[wA + vf + i] = vA[i]; ring.u32[wB + vf + i] = vB[i]; }
    ring.f32[wA + zf] = 0.25; ring.f32[wB + zf] = 0.75; // B is farther: depth test must reject it
    device.beginPass(target, { clear: true });
    device.bind(pipe, { uniformOffsetBytes: offA });
    device.draw(3);
    device.bind(pipe, { uniformOffsetBytes: offB });
    device.draw(3);
    device.endPass();
    device.submit();
    const outA = new Uint32Array(W * H * 4), outB = new Uint32Array(W * H * 4), outC = new Uint32Array(W * H);
    await device.readback(a, { x: 0, y: 0, w: W, h: H }, outA);
    await device.readback(b, { x: 0, y: 0, w: W, h: H }, outB);
    await device.readback(c, { x: 0, y: 0, w: W, h: H }, outC);
    const sub = new Uint32Array(2 * 2 * 4);
    await device.readback(a, { x: 1, y: 2, w: 2, h: 2 }, sub);
    let mismatches = 0, checked = 0;
    const want = (/** @type {number} */ got, /** @type {number} */ exp) => { checked++; if ((got >>> 0) !== (exp >>> 0)) mismatches++; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      want(outA[i * 4], x); want(outA[i * 4 + 1], y); want(outA[i * 4 + 2], vA[0]); want(outA[i * 4 + 3], 0xDEADBEEF);
      want(outB[i * 4], x + y * 4); want(outB[i * 4 + 1], vA[1]); want(outB[i * 4 + 2], vA[2]); want(outB[i * 4 + 3], vA[3]);
      want(outC[i], (((x << 16) | y) + vA[0]));
    }
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const i = sy * 2 + sx;
      want(sub[i * 4], 1 + sx); want(sub[i * 4 + 1], 2 + sy); want(sub[i * 4 + 2], vA[0]); want(sub[i * 4 + 3], 0xDEADBEEF);
    }
    let scopeErr = null;
    if (device.gpu.popErrorScope) scopeErr = await device.gpu.popErrorScope();
    if (scopeErr) return done({ ok: false, mismatches, checked, error: 'validation: ' + scopeErr.message });
    for (const h of [a, b, c, d]) device.dispose(h);
    return done({ ok: mismatches === 0 && device.gpuErrors.length === 0, mismatches, checked });
  } catch (e) {
    return done({ ok: false, error: String(e && /** @type {any} */ (e).message || e) });
  }
}
