// WG-5b: with no WebGPU the factory calls onWebGpuMissing and returns the CPU Canvas2D target (no device/pipeline); force2d skips WebGPU.
import assert from 'node:assert/strict';
import { createRenderer } from './createRenderer.js';

const names = ['document', 'window', 'navigator'];
const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
const ctx = new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) },
  { get: (t, k) => (k in t ? t[k] : () => ({ width: 8 })), set: () => true });
const canvas = { style: {}, getContext() { return ctx; }, addEventListener() {} };
const warnings = [], missing = [];
try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return { getContext() { return ctx; } }; } } });
  // Hidden window: resize exits before font measurement.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { async requestAdapter() { return null; } } } });
  const r = await createRenderer({ canvas, cols: 400, rows: 150, backend: 'webgpu', warn: (m) => warnings.push(m), onWebGpuMissing: (why) => missing.push(why) });
  assert.equal(r.rt.backend, 'c2d-capped');
  assert.deepEqual(r.info, { requested: 'webgpu', backend: 'c2d-capped', fallback: true, webgpuMissing: true, label: 'c2d-capped (WebGPU missing)' });
  assert.equal(r.pipeline, null); assert.equal(r.device, null);
  assert.deepEqual([r.rt.cols, r.rt.rows], [160, 60]);
  assert.equal(missing.length, 1); assert.match(missing[0], /no adapter/);
  assert.ok(warnings.some((w) => /no adapter.*no GPU backend/.test(w)), 'createRenderer warns');
  const none = await createRenderer({ canvas, cols: 240, rows: 90, backend: 'webgl2', warn: (m) => warnings.push(m), onWebGpuMissing: (why) => missing.push(why) });
  assert.ok(warnings.some((w) => /webgl2 is gone/.test(w))); assert.equal(none.info.webgpuMissing, true); assert.equal(missing.length, 2);
  const plain = await createRenderer({ canvas, cols: 240, rows: 90, force2d: true, onWebGpuMissing: (why) => missing.push(why) });
  assert.deepEqual(plain.info, { requested: 'webgpu', backend: 'c2d-capped', fallback: false, webgpuMissing: false, label: 'c2d-capped' });
  assert.equal(missing.length, 2, 'force2d does not report WebGPU missing');
} finally {
  for (let i = 0; i < names.length; i++) {
    if (saved[i]) Object.defineProperty(globalThis, names[i], saved[i]);
    else delete globalThis[names[i]];
  }
}
console.log('createRenderer.test: WebGPU missing -> onWebGpuMissing + CPU target PASS');
// POINTSHADOW-WIRE-01: option forwarding into WgCellPipeline 
{
  const { wgPipelineOpts } = await import('./createRenderer.js');
  assert.equal(wgPipelineOpts({ occl: true, pointShadows: false, pointShadowLevel: 'high' }).pointShadows, false);
  const on = wgPipelineOpts({ occl: true, pointShadows: { n: 4 }, pointShadowLevel: 'high' });
  assert.deepEqual(on.pointShadows, { n: 4 }); assert.equal(on.pointShadowLevel, 'high'); assert.equal(on.occl, true);
  assert.equal(wgPipelineOpts({}).pointShadows, undefined); // pipeline default = off
}
console.log('createRenderer.test: pointShadows forwarding PASS');
