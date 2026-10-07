// WG-2a: WgCellPipeline + targets.js on the Node mock device. node engine/render/gpu/wg/WgCellPipeline.test.js
import assert from 'node:assert';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline, PASS_NAMES } from './WgCellPipeline.js';
import { GpuCellPipeline, PASS_NAMES as GL_PASS_NAMES } from '../GpuCellPipeline.js';
import { allocWgTargets, freeWgTargets } from './targets.js';
import { DEBUG_BLOCK } from '../wgsl/debug.wgsl.js';

const { device, liveCount } = makeMockGpuDevice();
device.backend = 'webgpu';
let drawn = 0; const passes = [];
device.beginPass = (t, o) => { passes.push({ t, o }); };
device.draw = () => { drawn++; };
const fgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
const bgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
let hook = null;
const rt = { device, cols: 160, rows: 60, fgTex, bgTex, setCellPass(f) { hook = f; } };

// targets: 2x rgba32uint + r32uint + depth24, sub-sample sized
const t0 = allocWgTargets(device, 10, 5, 2);
assert.deepStrictEqual([t0.texSGI.desc.format, t0.texSGA.desc.format, t0.texSDepth.desc.format, t0.texRasterDepth.desc.format], ['rgba32ui', 'rgba32ui', 'r32ui', 'depth24']);
assert.deepStrictEqual([t0.texSGI.desc.width, t0.texSGI.desc.height], [20, 10]);
assert.ok(!('texGI' in t0) && !('texGA' in t0) && !('texGD' in t0) && !('texDepth' in t0), 'cell-resolution names reserved for WG-3a');
assert.deepStrictEqual(t0.targetRaster.desc.color, [t0.texSGI, t0.texSGA, t0.texSDepth]);
assert.strictEqual(t0.targetRaster.desc.color.length, 3);
assert.strictEqual(t0.targetRaster.desc.depth, t0.texRasterDepth);
const before = liveCount();
freeWgTargets(device, t0);
assert.strictEqual(liveCount(), before - 5, 'free disposes 4 textures + target');
// alloc failure frees the partial set
{
  let n = 0; const orig = device.createTexture;
  device.createTexture = (d) => { if (++n === 3) throw new Error('oom'); return orig(d); };
  const live0 = liveCount();
  assert.throws(() => allocWgTargets(device, 4, 4, 1), /oom/);
  device.createTexture = orig;
  assert.strictEqual(liveCount(), live0, 'partial alloc freed');
}

// surface (38.1)
const p = new WgCellPipeline(rt, { rays: 2 });
assert.strictEqual(p.ready, true);
const SURFACE = ['frame', 'bind', 'bindVoxels', 'bindViewModel', 'bindInstances', 'resizeGrid', 'setEnabled', 'setPassTiming', 'setDebugMode', 'readbackGeometry', 'readbackLight', 'readbackWater', 'readbackShadowDepthBits', 'readback', 'dispose'];
for (const m of SURFACE) {
  assert.strictEqual(typeof p[m], 'function', m);
  assert.strictEqual(typeof GpuCellPipeline.prototype[m], 'function', 'GL surface ' + m);
}
assert.deepStrictEqual([...PASS_NAMES], [...GL_PASS_NAMES]);
assert.strictEqual(p.stats.passMsP50.length, PASS_NAMES.length);
assert.deepStrictEqual(p.portedPasses, ['debug']);
assert.strictEqual(p.frameComplete, false, 'honest: no scene yet');
assert.strictEqual(typeof hook, 'function', 'cell-pass hook installed');
assert.strictEqual(rt.gpuActive, undefined, 'never takes over the CPU shading');

// stubs are safe
p.bind({}, {}); p.bindVoxels({}); p.bindViewModel({}); p.bindInstances({}); p.setPassTiming(true); p.frame(null, null, null, null); p.setWaterLooks([]);
assert.strictEqual(await p.readbackLight(), null);
assert.strictEqual(await p.readbackWater(), null);

// hook: no draw while debug off; with a mode: G-buffer clear pass once + one debug pass
hook(); assert.strictEqual(drawn, 0);
p.setDebugMode(0); hook();
assert.strictEqual(drawn, 1); assert.strictEqual(passes.length, 2);
assert.strictEqual(passes[0].t, p._t.targetRaster); assert.deepStrictEqual(passes[0].o, { clear: true });
hook(); assert.strictEqual(passes.length, 3, 'G-buffer cleared only once');
const lastBind = device._lastBind;
assert.strictEqual(lastBind.uniforms[1], 2, 'rays uniform');
assert.strictEqual(lastBind.textures.length, 3);
assert.deepStrictEqual(lastBind.textures.map((entry) => entry.texture), [p._t.texSGI, p._t.texSGA, p._t.texSDepth]);
{
  const field = DEBUG_BLOCK.field, uniforms = p._debugU, bind = p._debugBind, textures = p._debugTex;
  const created = liveCount();
  DEBUG_BLOCK.field = () => { throw new Error('per-frame field lookup'); };
  try { for (let i = 0; i < 1000; i++) { p.setDebugMode(i % 4); hook(); } }
  finally { DEBUG_BLOCK.field = field; }
  assert.strictEqual(p._debugU, uniforms); assert.strictEqual(p._debugBind, bind); assert.strictEqual(p._debugTex, textures);
  assert.strictEqual(liveCount(), created, 'warm debug hook creates no resources');
  assert.deepStrictEqual([...uniforms].slice(0, 3), [3, 2, Math.fround(0.05)]);
}

// resizeGrid reallocates, frees old
const oldGI = p._t.texSGI;
p.resizeGrid(20, 10);
assert.notStrictEqual(p._t.texSGI, oldGI); assert.strictEqual(oldGI._disposed, true);
assert.deepStrictEqual([p._t.texSGI.desc.width, p.cols, p.rows], [40, 20, 10]);
const beforeResizeHook = passes.length;
hook(); assert.strictEqual(passes.length, beforeResizeHook + 2, 'cleared again after resize');
// failed resize keeps the old set
{
  const keep = p._t; const orig = device.createTexture;
  device.createTexture = () => { throw new Error('oom'); };
  const e = console.error; console.error = () => {};
  p.resizeGrid(99, 99);
  console.error = e; device.createTexture = orig;
  assert.strictEqual(p._t, keep); assert.strictEqual(p.ready, true); assert.strictEqual(p.cols, 20);
}

// readbackGeometry: payload shape (4-wide GI/GA/Depth), Depth spread from the 1-wide r32uint
{
  let readCalls = 0;
  device.readback = () => { readCalls++; };
  await assert.rejects(p.readbackGeometry(), { message: 'readbackGeometry: rays > 1 needs the WG-3a resolve' });
  assert.strictEqual(readCalls, 0, 'no sub-resolution readback before resolve exists');
  const q = new WgCellPipeline({ ...rt, setCellPass() {} }, { rays: 1 });
  const cells = q.cols * q.rows;
  device.readback = (tex, rect, out) => {
    assert.deepStrictEqual(rect, { x: 0, y: 0, w: q.cols, h: q.rows });
    if (tex === q._t.texSDepth) for (let i = 0; i < out.length; i++) out[i] = i + 7; else out.fill(1);
  };
  const g = await q.readbackGeometry();
  assert.strictEqual(g.GI.length, 4 * cells); assert.strictEqual(g.GA.length, 4 * cells); assert.strictEqual(g.Depth.length, 4 * cells);
  assert.strictEqual(g.Depth[4 * 3], 10); assert.strictEqual(g.Depth[4 * 3 + 1], 0); assert.strictEqual(g.GI[5], 1);
  q.resizeGrid(7, 3);
  const small = await q.readbackGeometry();
  assert.strictEqual(small.GI.length, 4 * 21); assert.strictEqual(small.GA.length, 4 * 21); assert.strictEqual(small.Depth.length, 4 * 21);
  q.dispose();
}

// dispose
const debugPipeline = p._pipeDebug;
p.dispose();
assert.strictEqual(p.ready, false); assert.strictEqual(hook, null); assert.strictEqual(p._t, null);
assert.strictEqual(debugPipeline._disposed, true); assert.strictEqual(p._pipeDebug, null);
p.resizeGrid(5, 5); p.setEnabled(true); assert.strictEqual(hook, null, 'no re-enable after dispose');
p.dispose(); // idempotent

// init failure -> ready=false, no throw
{
  const bad = { ...rt, device: { ...device, createTexture() { throw new Error('nope'); } }, setCellPass() {} };
  const w = console.warn; console.warn = () => {};
  const q = new WgCellPipeline(bad);
  console.warn = w;
  assert.strictEqual(q.ready, false);
}
console.log('WgCellPipeline.test.js: all checks passed.');
