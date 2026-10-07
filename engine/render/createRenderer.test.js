// TEST-GAPS-WG: real factory fallback with a small DOM/WebGL mock, without a browser.
import assert from 'node:assert/strict';
import { createRenderer } from './createRenderer.js';

const names = ['document', 'window', 'navigator'];
const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
const gl = { getExtension() { return null; }, getParameter() { return 'Test hardware'; },
  getShaderParameter() { return true; }, getProgramParameter() { return true; } };
for (const name of ['createShader', 'createProgram', 'createVertexArray', 'createTexture', 'getUniformLocation']) gl[name] = () => ({});
for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'useProgram',
  'uniform1i', 'uniform2f', 'bindVertexArray', 'activeTexture', 'bindTexture', 'texImage2D', 'texParameteri', 'disable']) gl[name] = () => {};
const calls = [], warnings = [];
const canvas = { style: {}, getContext(kind) { calls.push(kind); return kind === 'webgl2' ? gl : {}; }, addEventListener() {} };
try {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return { getContext(kind) { return kind === 'webgl2' ? gl : {}; } }; } } });
  // Hidden window: resize exits before font measurement; backend construction still exercises shader/texture setup.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { async requestAdapter() { return null; } } } });
  const r = await createRenderer({ canvas, cols: 400, rows: 150, backend: 'webgpu', warn: (m) => warnings.push(m) });
  assert.equal(r.rt.backend, 'gl2');
  assert.deepEqual(r.info, { requested: 'webgpu', backend: 'gl2', fallback: true, label: 'gl2 (fallback from webgpu)' });
  assert.equal(r.pipeline, null); assert.equal(r.device, null);
  assert.deepEqual([r.rt.cols, r.rt.rows], [400, 150]);
  assert.deepEqual(calls, ['webgl2']);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /no adapter.*falling back to webgl2/);
  const plain = await createRenderer({ canvas, cols: 240, rows: 90, backend: 'webgl2' });
  assert.deepEqual(plain.info, { requested: 'webgl2', backend: 'gl2', fallback: false, label: 'gl2' });
} finally {
  for (let i = 0; i < names.length; i++) {
    if (saved[i]) Object.defineProperty(globalThis, names[i], saved[i]);
    else delete globalThis[names[i]];
  }
}
console.log('createRenderer.test: WebGPU failure returns WebGL2 target and fallback label PASS');
