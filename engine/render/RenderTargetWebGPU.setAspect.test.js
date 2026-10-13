// OB-117: setAspect(null) (fill) before/after resize must size the canvas to the window (never leave the 300x150 default).
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
const { RenderTargetWebGPU } = await import('./RenderTargetWebGPU.js');
const mk = () => {
  const rt = Object.create(RenderTargetWebGPU.prototype);
  Object.assign(rt, { cols: 240, rows: 90, _aspect: 16 / 9, canvas: { width: 0, height: 0, style: {} }, _uiLayer: null, _rebuildAtlas() {},
    _measureCtx: { font: '', measureText() { const px = parseFloat(this.font) || 1; return { width: px * 0.6, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.25 }; } } });
  return rt;
};
let rt = mk(); // setAspect before the first resize
rt.setAspect(null);
assert.equal(rt.canvas.style.width, '1280px'); assert.equal(rt.canvas.style.height, '720px');
rt = mk(); // after resize
rt.resize(); rt.setAspect(null);
assert.equal(rt.canvas.style.width, '1280px'); assert.equal(rt.canvas.style.height, '720px');
window.innerWidth = 900; window.innerHeight = 500; rt.resize(); // live resize keeps filling
assert.equal(rt.canvas.style.width, '900px'); assert.equal(rt.canvas.style.height, '500px');
console.log('RenderTargetWebGPU.setAspect.test: PASS');
