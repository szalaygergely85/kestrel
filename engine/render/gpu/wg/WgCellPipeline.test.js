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
assert.deepStrictEqual([t0.texGI, t0.texGA, t0.texGD].map(x => [x.desc.format, x.desc.width, x.desc.height]), [['rgba32ui', 10, 5], ['rgba32ui', 10, 5], ['rgba32ui', 10, 5]], 'cell-res set (WG-3a)');
assert.deepStrictEqual([t0.texDepth.desc.format, t0.texDepth.desc.width, t0.texMask.desc.format], ['r32ui', 10, 'r8ui']);
assert.deepStrictEqual(t0.targetResolve.desc.color, [t0.texGI, t0.texGA, t0.texDepth]);
assert.deepStrictEqual(t0.targetDeriv.desc.color, [t0.texGD]);
assert.deepStrictEqual(t0.targetRaster.desc.color, [t0.texSGI, t0.texSGA, t0.texSDepth]);
assert.strictEqual(t0.targetRaster.desc.color.length, 3);
assert.strictEqual(t0.targetRaster.desc.depth, t0.texRasterDepth);
const before = liveCount();
freeWgTargets(device, t0);
assert.strictEqual(liveCount(), before - 15, 'free disposes 10 textures + 5 targets');
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
assert.deepStrictEqual(p.portedPasses, ['debug', 'raster', 'resolve', 'deriv', 'light']);
assert.strictEqual(p.frameComplete, false, 'honest: no scene yet');
assert.strictEqual(typeof hook, 'function', 'cell-pass hook installed');
assert.strictEqual(rt.gpuActive, undefined, 'never takes over the CPU shading');

// stubs are safe
p.bind({}, {}); p.bindVoxels({}); p.bindViewModel({}); p.bindInstances({}); p.setPassTiming(true); p.frame(null, null, null, null); p.setWaterLooks([]);
{ const rl = await p.readbackLight(); assert.strictEqual(rl.length, 4 * p.cols * p.rows, 'readbackLight is cols*rows 4-wide'); }
assert.strictEqual(await p.readbackWater(), null);

// hook: debug off = raster clear + resolve + deriv (2 draws); with a mode: + one debug pass
hook(); assert.strictEqual(drawn, 2); assert.deepStrictEqual(passes.map(x => x.t), [p._t.targetRaster, p._t.targetResolve, p._t.targetDeriv]);
drawn = 0; passes.length = 0;
p.setDebugMode(0); hook();
assert.strictEqual(drawn, 3); assert.strictEqual(passes.length, 4);
assert.strictEqual(passes[0].t, p._t.targetRaster); assert.deepStrictEqual(passes[0].o, { clear: true });
hook(); assert.strictEqual(passes.length, 8, 'G-buffer cleared each frame');
{
  const pd = p._cellPass;
  assert.deepStrictEqual(pd.rTex.map(x => x.texture), [p._t.texSGI, p._t.texSGA, p._t.texSDepth, p._t.texMask]);
  assert.deepStrictEqual(pd.dTex.map(x => x.texture), [p._t.texGI, p._t.texGA, p._t.texDepth]);
  assert.strictEqual(pd.ri[0], 2, 'resolve n = rays');
  assert.deepStrictEqual([pd.di[0], pd.di[1]], [160, 60]);
  assert.ok(pd.du[2] > 0 && pd.du[3] > 0, 'deriv tanHalfHFov / planeDistY');
}
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

// WG-3b: light pass (fake world: no structures; ambient-only light array, then a LightSet-shaped object with the sun on)
{
  const lp = p._cellPass.lightPass, t = p._t;
  const world = { structures: [], structVersion: 1 };
  const cam = { x: 1, y: 2, z: 1.5, yawDeg: 90, pitchDeg: 0 };
  const host = { _world: world, _light: [0.1, 0.2, 0.3], _cam: cam, cols: p.cols, rows: p.rows, rt, _rasterPass: null };
  passes.length = 0; drawn = 0;
  lp.run(host, t);
  assert.deepStrictEqual(passes.map(x => x.t), [t.targetLight]); assert.strictEqual(drawn, 1);
  assert.strictEqual(device._lastBind.textures.length, 7);
  assert.strictEqual(device._lastBind.textures[6].texture, lp.texSunDummy, 'dummy depth bound until WG-3d');
  assert.strictEqual(device._lastBind.uniforms[0].toFixed(2), '0.10');
  const made = liveCount();
  const ls = { pos: new Float32Array(32), col: new Float32Array(32), count: 1, ambient: [0.5, 0.5, 0.5], sun: { on: true, dir: [0, 0, 1], col: [1, 1, 1] },
    visOx: new Float32Array(8), visOy: new Float32Array(8), visW: new Float32Array(8).fill(33), visH: new Float32Array(8).fill(33),
    visVersion: new Int32Array(8), vis: new Uint8Array(8 * 33 * 33) };
  host._light = ls; lp.run(host, t);
  assert.strictEqual(lp.texLVis._texWrites, 1, 'dirty LVIS slot uploaded once');
  lp.run(host, t); assert.strictEqual(lp.texLVis._texWrites, 1, 'unchanged LVIS slot not re-uploaded');
  assert.strictEqual(liveCount(), made, 'warm light pass creates no resources');
}

// resizeGrid reallocates, frees old
const oldGI = p._t.texSGI;
p.resizeGrid(20, 10);
assert.notStrictEqual(p._t.texSGI, oldGI); assert.strictEqual(oldGI._disposed, true);
assert.deepStrictEqual([p._t.texSGI.desc.width, p.cols, p.rows], [40, 20, 10]);
const beforeResizeHook = passes.length;
hook(); assert.strictEqual(passes.length, beforeResizeHook + 4, 'cleared again after resize');
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
  const g2 = await p.readbackGeometry(); // rays 2 reads the resolved cell-res set
  assert.strictEqual(g2.GI.length, 4 * p.cols * p.rows); assert.strictEqual(readCalls, 3);
  const q = new WgCellPipeline({ ...rt, setCellPass() {} }, { rays: 1 });
  const cells = q.cols * q.rows;
  device.readback = (tex, rect, out) => {
    assert.deepStrictEqual(rect, { x: 0, y: 0, w: q.cols, h: q.rows });
    if (tex === q._t.texDepth) for (let i = 0; i < out.length; i++) out[i] = i + 7; else out.fill(1);
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
