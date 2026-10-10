// S8-B1-07: WebGPU per-pass GPU timer - slot mapping on the mock device. WebGpuTimer.test.js already covers the real
// ring/query-set behaviour (ARCH note); this tests WgCellPipeline's seam instead: every real WG pass gets its own
// WG_PASS_SLOT, and - the actual risk this story runs into - those spans never nest with each other or with the
// whole-frame FRAME_TIMER_SLOT span RenderTargetWebGPU.present() opens (WebGpuTimer.begin() throws "span already open"
// if they did; see WgCellPipeline._hook's early `d.timer.end()`).
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline, WG_PASS_NAMES, WG_PASS_SLOT } from './WgCellPipeline.js';
import { WgRasterPass } from './passRaster.js';
import { FRAME_TIMER_SLOT } from '../device/WebGpuTimer.js';

// 1. Slot-mapping contract: one unique slot per name, 0..N-1 contiguous (writePassStats assumes slot === array index,
// WebGpuTimer.js), and never FRAME_TIMER_SLOT (15).
{
  const slots = WG_PASS_NAMES.map((n) => WG_PASS_SLOT[n]);
  assert.strictEqual(slots.length, WG_PASS_NAMES.length);
  assert.strictEqual(new Set(slots).size, slots.length, 'every pass has its own slot');
  assert.deepStrictEqual([...slots].sort((a, b) => a - b), [...Array(WG_PASS_NAMES.length).keys()], 'slots are 0..N-1');
  for (const n of WG_PASS_NAMES) assert.strictEqual(WG_PASS_NAMES[WG_PASS_SLOT[n]], n, `WG_PASS_SLOT.${n} indexes back to "${n}"`);
  assert.ok(!slots.includes(FRAME_TIMER_SLOT), 'no WG pass slot collides with FRAME_TIMER_SLOT');
}

// A strict spy reproduces WebGpuTimer's single-active-span invariant (begin() throws if one is already open, end()
// always clears it) without the real ring/query sets - this is what would catch two spans nesting; the mock device's
// own default `timer: { begin(){}, end(){} }` is permissive and would miss it.
function strictTimerSpy() {
  const order = []; let active = -1;
  return {
    order,
    active: () => active,
    begin(slot) { if (active >= 0) throw new Error('WebGpuTimer.begin: span already open'); active = slot; order.push(['begin', slot]); },
    end() { active = -1; order.push(['end']); },
    writeStats() {}, writePassStats(p50, p95) { p50.fill(0); p95.fill(0); },
  };
}

// 2. WgCellPipeline._hook: toggling pass timing on must never nest a WG pass span inside the frame-level span
// RenderTargetWebGPU opens (a real `present()` is not exercised here - only the pipeline's own `setPassTiming` seam).
{
  const { device } = makeMockGpuDevice();
  device.backend = 'webgpu';
  device.beginPass = () => {}; device.draw = () => {};
  const timer = strictTimerSpy(); device.timer = timer;
  const fgTex = device.createTexture({ format: 'rgba8', width: 10, height: 5 });
  const bgTex = device.createTexture({ format: 'rgba8', width: 10, height: 5 });
  let hook = null;
  const rt = { device, cols: 10, rows: 5, fgTex, bgTex, setCellPass(f) { hook = f; } };
  const p = new WgCellPipeline(rt, { rays: 1 });
  assert.strictEqual(p.ready, true);
  p.setPassTiming(true);
  p.frame(null, null, null, null); // no cam/world bound yet

  timer.order.length = 0;
  hook(); // "no scene" path: raster is a plain clear (not timed), only resolve+deriv run under one 'resolve' span
  assert.strictEqual(timer.active(), -1, 'every begin() was matched by an end() - no span left open');
  // Leading 'end': `_hook` always releases the (here: never-opened) frame-level span first - see the comment in WgCellPipeline._hook.
  assert.deepStrictEqual(timer.order, [['end'], ['begin', WG_PASS_SLOT.resolve], ['end']], 'resolve+deriv share one span (no scene: light/shade/edge/sprites do not run)');
  assert.strictEqual(p.stats.wgPassMsP50.length, WG_PASS_NAMES.length);
  assert.strictEqual(p.stats.wgPassMsP95.length, WG_PASS_NAMES.length);

  // Off: no calls into the timer at all (same as before this story).
  timer.order.length = 0;
  p.setPassTiming(false);
  hook();
  assert.deepStrictEqual(timer.order, [], 'pass timing off: WgCellPipeline never touches device.timer');
  assert.strictEqual(timer.active(), -1);
  p.dispose();
}

// 3. WgRasterPass.run: cull (compute) and raster (render) are separate, sequential, non-nested spans.
{
  const { device } = makeMockGpuDevice();
  device.backend = 'webgpu';
  const timer = strictTimerSpy(); device.timer = timer;
  const raster = new WgRasterPass(device, { gpuCull: false }); // no GPU cull kernel needed for this fixture (empty draw list)
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0, projection: 'shear' };
  const world = {};
  const p = {
    _passTimingOn: true, device, cols: 10, rows: 5, rt: { pxCellW: 1, pxCellH: 1 },
    _cam: cam, _world: world, _table: null, _voxelPool: null, _instances: null, _viewModel: null,
    _t: { targetRaster: {}, targetVmDepth: {} }, stats: {},
  };
  raster.run(p);
  assert.strictEqual(timer.active(), -1, 'cull then raster: both spans closed');
  assert.deepStrictEqual(timer.order, [
    ['begin', WG_PASS_SLOT.cull], ['end'],
    ['begin', WG_PASS_SLOT.raster], ['end'],
  ], 'cull opens/closes before raster opens - never nested');
  raster.dispose();
}

// 4. OCCL-STATS-01: with the HZB path active the spans run raster, hzb, cull2, raster2 (never nested); timing off = zero timer calls.
{
  for (const on of [true, false]) {
    const { device } = makeMockGpuDevice();
    device.backend = 'webgpu';
    const timer = strictTimerSpy(); device.timer = timer;
    const raster = new WgRasterPass(device, { gpuCull: false });
    const span = (slot) => (p) => { if (p && p._passTimingOn) { timer.begin(slot); timer.end(); } };
    const hb = span(WG_PASS_SLOT.hzb), c2 = span(WG_PASS_SLOT.cull2);
    raster.hzb = { build(t, p) { hb(p); }, fresh() { return {}; }, invalidate() {}, dispose() {} };
    raster.cull = { runPhase2(h, p) { c2(p); }, dispose() {} };
    const prep = raster.prepare.bind(raster); raster.prepare = (q) => { prep(q); raster.gpuN = 1; }; raster._cullRun = () => { raster._phase2 = true; }; raster._cullDraw = () => 0;
    const p = {
      _passTimingOn: on, device, cols: 10, rows: 5, rt: { pxCellW: 1, pxCellH: 1 },
      _cam: { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0, projection: 'shear' }, _world: {}, _table: null, _voxelPool: null, _instances: null, _viewModel: null,
      _t: { targetRaster: {}, targetVmDepth: {}, texSDepth: {} }, stats: {},
    };
    raster.run(p);
    const begins = timer.order.filter((e) => e[0] === 'begin').map((e) => e[1]);
    if (on) {
      assert.deepStrictEqual(begins.filter((s) => s !== WG_PASS_SLOT.cull), [WG_PASS_SLOT.raster, WG_PASS_SLOT.hzb, WG_PASS_SLOT.cull2, WG_PASS_SLOT.raster2], 'raster, hzb, cull2, raster2');
      assert.strictEqual(timer.active(), -1);
    } else assert.deepStrictEqual(timer.order, [], 'timing off: zero timer calls');
    raster.hzb = null; raster.cull = null; raster.dispose();
  }
}

console.log('WgCellPipeline per-pass GPU timer slot mapping: OK');
