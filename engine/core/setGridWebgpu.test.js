// WG-2b (38.8a item 21): engine.setGrid runs on a webgpu target only when a ready WgCellPipeline is passed.
// Run: node engine/core/setGridWebgpu.test.js
import assert from 'node:assert/strict';
import { createEngine } from './engine.js';

const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
const canvas = () => ({ getContext: () => ctx });
globalThis.window = { innerWidth: 0, innerHeight: 0, addEventListener() {} };
globalThis.document = { createElement: canvas };
globalThis.console.warn = () => {}; const log = console.log; console.log = () => {};

function fakeRt(backend) {
  return { backend, cols: 160, rows: 60, pxCellW: 8, pxCellH: 16, calls: [],
    setGrid(c, r) { this.calls.push('rt'); this.cols = c; this.rows = r; }, setUiLayer() {}, canHoldGrid: () => ({ ok: true }) };
}
const assets = { terrain: () => null, level: () => null, contentVersion: null };
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

// ready pipeline: resize goes rt first, then the pipeline, with the new size
{
  const rt = fakeRt('webgpu'), pipe = { ready: true, resizeGrid(c, r) { rt.calls.push(`pipe ${c}x${r}`); } };
  const engine = createEngine({ canvas: canvas(), assets, renderTarget: rt, renderPipeline: pipe, cols: 160, force2d: true, inputTarget: window });
  const res = engine.setGrid(240, 90, { immediate: true });
  ok(res.cols === 240 && !res.pending, 'accepted');
  ok(rt.cols === 240 && rt.calls.join() === 'rt,pipe 240x90', 'rt.setGrid then pipeline.resizeGrid');
}
// not ready / absent pipeline: stays put
for (const pipe of [{ ready: false, resizeGrid() { throw new Error('no'); } }, null]) {
  const rt = fakeRt('webgpu');
  const engine = createEngine({ canvas: canvas(), assets, renderTarget: rt, renderPipeline: pipe, cols: 160, force2d: true, inputTarget: window });
  const res = engine.setGrid(240, 90, { immediate: true });
  ok(res.cols === 160 && rt.calls.length === 0, 'refused without a ready pipeline');
}
// gl2 path unchanged: no pipeline call
{
  const rt = fakeRt('gl2'), pipe = { ready: true, resizeGrid() { throw new Error('gl2 must not touch it'); } };
  const engine = createEngine({ canvas: canvas(), assets, renderTarget: rt, renderPipeline: pipe, cols: 160, force2d: true, inputTarget: window });
  engine.setGrid(240, 90, { immediate: true });
  ok(rt.cols === 240, 'gl2 resized');
}
console.log = log;
console.log(`setGridWebgpu.test.js: ${checks} checks passed.`);
