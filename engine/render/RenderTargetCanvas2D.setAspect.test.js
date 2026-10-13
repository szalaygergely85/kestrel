// OB-117 note: RenderTargetCanvas2D.resize stores _refBox so setAspect re-fits with the same box. Run: node engine/render/RenderTargetCanvas2D.setAspect.test.js
import assert from 'node:assert/strict';
import { RenderTargetCanvas2D } from './RenderTargetCanvas2D.js';

globalThis.window = globalThis.window || { innerWidth: 1000, innerHeight: 600, devicePixelRatio: 1 };
const rt = Object.create(RenderTargetCanvas2D.prototype);
Object.assign(rt, {
  cols: 40, rows: 20, _aspect: 16 / 9, _glyphAtlas: new Array(95).fill(null),
  canvas: { width: 0, height: 0, style: {} },
  ctx: { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
  _measureCtx: { font: '', textBaseline: '', textAlign: '', measureText() { const px = parseFloat(this.font) || 1; return { width: px * 0.6, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.25 }; } },
});
rt.resize(1280, 720, 2);
assert.deepEqual(rt._refBox, { availW: 1280, availH: 720, dpr: 2 }, 'resize stores the explicit box');
const w1 = rt.canvas.style.width;
rt.setAspect(1);
assert.equal(rt.dpr, 2, 'setAspect re-fits with the stored dpr');
assert.notEqual(rt.canvas.style.width, w1, 'new ratio changes the css box');
rt.resize(); // live window
assert.deepEqual(rt._refBox, { availW: undefined, availH: undefined, dpr: undefined }, 'live resize clears the fixed box');
console.log('RenderTargetCanvas2D.setAspect.test: PASS');
