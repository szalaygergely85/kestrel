// S8-B1-12 (docs/sprints/sprint-8-queue.md): resize/DPR/fullscreen leak checks on the Node mock device.
// ARCH note on the story: RenderTargetWebGPU.resize(availW, availH, dpr) + atlas rebuild on DPR change already
// exist (BUG-HUD-OFFSCREEN-01/BUG-SQUARES-01 fixes) - this is a verify + leak-test story, not new resize code.
// Also takes over the 50-live-`setGrid` leak AC from S8-B1-17 (`engine.setGrid` -> `rt.setGrid` +
// `WgCellPipeline.resizeGrid`, the exact sequence engine/core/engine.js's `applyGrid` runs).
// Run: node engine/render/RenderTargetWebGPU.resize.test.js
import assert from 'node:assert/strict';
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';
import { CellBuffer } from './CellBuffer.js';
import { makeMockGpuDevice } from '../test/assert.js';
import { WgCellPipeline } from './gpu/wg/WgCellPipeline.js';

// Deterministic fake 2D contexts (same fixture shape as glyphMetrics.test.js): no `document`/DOM needed in Node.
function fakeMeasureCtx() {
  return {
    font: '', textBaseline: '', textAlign: '',
    measureText() {
      const px = parseFloat(this.font) || 1;
      return { width: px * 0.6, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.25 };
    },
  };
}
function fakeAtlasCtx() {
  const canvas = { width: 0, height: 0 };
  const ctx = {
    font: '', textBaseline: '', textAlign: '', fillStyle: '',
    clearRect() {}, fillText() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4) }; },
  };
  return { canvas, ctx };
}

/** A RenderTargetWebGPU usable for resize()/setGrid() without touching `document`/`window` (present() is not exercised here). */
function makeRt(device, cols, rows) {
  const rt = Object.create(RenderTargetWebGPU.prototype);
  const atlas = fakeAtlasCtx();
  Object.assign(rt, {
    backend: 'webgpu', device, cols, rows,
    cells: new CellBuffer(cols, rows),
    canvas: { width: 0, height: 0, style: {} },
    cellW: 1, cellH: 1, pxCellW: 1, pxCellH: 1, glyphAscent: 1, fontSize: 16, dpr: 1,
    atlasTex: null, _uiLayer: null, _refBox: undefined,
    _measureCtx: fakeMeasureCtx(), _atlasCanvas: atlas.canvas, _atlasCtx: atlas.ctx,
  });
  rt.fgTex = device.createTexture({ format: 'rgba8', width: cols, height: rows });
  rt.bgTex = device.createTexture({ format: 'rgba8', width: cols, height: rows });
  rt._presentFg = null; rt._presentBg = null;
  rt.resize(1280, 720, 1); // same call the real constructor makes (this.resize()), with an explicit initial box
  return rt;
}

// ---- AC: 200 random resizes (window size + DPR) leave resource counts flat ----
{
  const { device, liveCount } = makeMockGpuDevice();
  device.backend = 'webgpu';
  const rt = makeRt(device, 400, 150);
  const baseline = liveCount();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 200; i++) {
    const w = 400 + Math.floor(rnd() * 2000);
    const h = 300 + Math.floor(rnd() * 1400);
    const dpr = [1, 1.25, 1.5, 2, 2.5][Math.floor(rnd() * 5)];
    rt.resize(w, h, dpr);
    assert.strictEqual(liveCount(), baseline, `resize #${i} (${w}x${h} dpr${dpr}) leaked`);
  }
  console.log('RenderTargetWebGPU.resize.test: 200 random resizes PASS, resource count held at', baseline);
}

// ---- AC: F11 fullscreen enter/exit (same resize() call with a new window box, DPR changes included) leaves no leak ----
{
  const { device, liveCount } = makeMockGpuDevice();
  device.backend = 'webgpu';
  const rt = makeRt(device, 400, 150);
  const baseline = liveCount();
  rt.resize(1920, 1080, 1); // enter fullscreen
  rt.resize(1280, 720, 1); // exit fullscreen, same DPR
  rt.resize(1920, 1080, 2); // fullscreen again at a different DPR (atlas rebuild path)
  rt.resize(1280, 720, 1); // back to windowed
  assert.strictEqual(liveCount(), baseline, 'fullscreen enter/exit + DPR change leaked resources');
  console.log('RenderTargetWebGPU.resize.test: fullscreen enter/exit + DPR toggle PASS');
}

// ---- AC (taken over from S8-B1-17): 50 live `engine.setGrid`-shaped grid changes - the exact sequence
// engine/core/engine.js's `applyGrid` runs for a webgpu target (`rt.setGrid` then `WgCellPipeline.resizeGrid`) -
// leave resource counts flat ----
{
  const { device, liveCount } = makeMockGpuDevice();
  device.backend = 'webgpu';
  const rt = makeRt(device, 160, 60);
  const pipeline = new WgCellPipeline(rt, { rays: 1 });
  assert.strictEqual(pipeline.ready, true, 'pipeline built on the mock device');
  const baseline = liveCount();
  const sizes = [[160, 60], [240, 90], [400, 150], [480, 180], [120, 45], [320, 120]];
  for (let i = 0; i < 50; i++) {
    const [cols, rows] = sizes[i % sizes.length];
    rt.setGrid(cols, rows); // RenderTargetWebGPU: new fg/bg cell textures + atlas rebuild
    pipeline.resizeGrid(rt.cols, rt.rows); // WgCellPipeline: new grid-sized targets, old set freed on success
    assert.strictEqual(liveCount(), baseline, `setGrid+resizeGrid #${i} (${cols}x${rows}) leaked`);
  }
  assert.strictEqual(pipeline.ready, true, '50 live grid changes never disabled the pipeline');
  console.log('RenderTargetWebGPU.resize.test: 50 live setGrid + WgCellPipeline.resizeGrid PASS, resource count held at', baseline);
}

console.log('RenderTargetWebGPU.resize.test: ALL PASS');
