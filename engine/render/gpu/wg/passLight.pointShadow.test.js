// ME-16e (38.22): light pass binding 7 + psh words, WgCellPipeline pass order sun -> point -> light, off = byte-identical, zero per-frame alloc.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgLightPass } from './passLight.js';
import { WgCellPipeline } from './WgCellPipeline.js';
import { LIGHT_BLOCK } from '../wgsl/light.wgsl.js';
import { WG_PASS_SLOT, WG_PASS_NAMES, FRAME_TIMER_SLOT } from '../device/WebGpuTimer.js';

const W = (n) => LIGHT_BLOCK.field(n).word;
assert.equal(WG_PASS_SLOT.pshadow, 10); assert.equal(WG_PASS_NAMES[10], 'pshadow'); assert.ok(FRAME_TIMER_SLOT > 10, 'frame slot does not collide');

const mk = () => {
  const mock = makeMockGpuDevice(), d = mock.device, wl = new WgLightPass(d);
  const t = { texGI: {}, texGA: {}, texDepth: {}, targetLight: d.canvasTarget() };
  const p = { _world: null, _light: [0.1, 0.2, 0.3], _cam: { x: 0, y: 0, z: 1.5, yawDeg: 0, pitchDeg: 0 }, cols: 8, rows: 4, rt: {}, _rasterPass: null };
  return { d, wl, t, p };
};
const PA = W('pshA'), PO = W('pshO'), PS = W('pshSlot');
const fakePass = (d, ready) => ({
  enabled: true, active: true, n: 2, opts: { res: 128, biasM: 0.04, normalOffTexels: 1.5 },
  depthTex: d.createTexture({ format: 'depth24', width: 128, height: 128, sampled: true, layers: 12 }),
  slotLight: new Int32Array([3, 5]), ready: new Uint8Array(ready), origins: new Float32Array([1, 2, 3, 6, 4, 5, 6, 8]),
});

// off: dummy at 7, pshA.x = 0, no slot words; every word before pshA identical to the on-path (psh words are the only difference)
const A = mk(); A.wl.run(A.p, A.t);
assert.equal(A.d._lastBind.textures[7].texture, A.wl.texPshDummy);
assert.equal(A.wl.texPshDummy.layers, 6);
assert.equal(A.wl.lu[PA], 0);
for (let k = 0; k < 16; k++) assert.equal(A.wl.lu[PS + k], 0);
const B = mk(); B.wl.pointPass = fakePass(B.d, [1, 1]); B.wl.run(B.p, B.t);
assert.deepEqual([...A.wl.lu.subarray(0, PA)], [...B.wl.lu.subarray(0, PA)], 'non-psh words identical');
// on: real array, n/res/bias/normalOff, origins + far per slot, slot+1 per light
assert.equal(B.d._lastBind.textures[7].texture, B.wl.pointPass.depthTex);
assert.deepEqual([...B.wl.lu.subarray(PA, PA + 4)], [2, 128, Math.fround(0.04), 1.5]);
assert.deepEqual([...B.wl.lu.subarray(PO, PO + 8)], [1, 2, 3, 6, 4, 5, 6, 8]);
assert.equal(B.wl.lu[PS + 3], 1); assert.equal(B.wl.lu[PS + 5], 2);
assert.equal(B.wl.lu.subarray(PS, PS + 16).reduce((a, b) => a + b, 0), 3);
// slot not ready yet -> that light stays unshadowed (LVIS); pass inactive -> back to off
B.wl.pointPass.ready[1] = 0; B.wl.run(B.p, B.t); assert.equal(B.wl.lu[PS + 5], 0); assert.equal(B.wl.lu[PS + 3], 1);
B.wl.pointPass.active = false; B.wl.run(B.p, B.t);
assert.equal(B.wl.lu[PA], 0); assert.equal(B.d._lastBind.textures[7].texture, B.wl.texPshDummy); assert.equal(B.wl.lu[PS + 3], 0);

// pipeline: option, pass order sun -> point -> light, off option
const rtOf = (device) => ({ device, cols: 16, rows: 8, fgTex: device.createTexture({ format: 'rgba8', width: 16, height: 8 }), bgTex: device.createTexture({ format: 'rgba8', width: 16, height: 8 }), setCellPass(f) { this.hook = f; }, setPresentCells() {} });
{
  const m = makeMockGpuDevice(); m.device.backend = 'webgpu';
  const rt1 = rtOf(m.device), p = new WgCellPipeline(rt1, { rays: 1, pointShadows: true });
  assert.ok(p._pointShadowPass && p._pointShadowPass.enabled, 'default on');
  assert.strictEqual(p._cellPass.lightPass.pointPass, p._pointShadowPass);
  const order = [], sun = p._shadowPass, pp = p._pointShadowPass;
  const s0 = sun.run.bind(sun), p0 = pp.run.bind(pp), l0 = p._cellPass.run.bind(p._cellPass);
  sun.run = (...a) => { order.push('sun'); return s0(...a); }; pp.run = (...a) => { order.push('point'); return p0(...a); }; p._cellPass.run = (...a) => { order.push('light'); return l0(...a); };
  p.frame({ timeSec: 0 }, [0.1, 0.2, 0.3], { x: 1, y: 2, z: 1.5, yawDeg: 0, pitchDeg: 0 }, { structures: [], structVersion: 1 });
  rt1.hook();
  assert.deepEqual(order, ['sun', 'point', 'light']);
  p.dispose();
  const m2 = makeMockGpuDevice(); m2.device.backend = 'webgpu';
  const q = new WgCellPipeline(rtOf(m2.device), { rays: 1, pointShadows: false });
  assert.equal(q._pointShadowPass, null); assert.equal(q._cellPass.lightPass.pointPass, null);
  const q2 = new WgCellPipeline(rtOf(makeMockGpuDevice().device), { rays: 1, pointShadows: { n: 0 } });
  assert.equal(q2._pointShadowPass, null, 'n 0 = off');
}

// zero alloc: the light pass has a small pre-existing baseline (cam basis math); the psh upload must add nothing to it (noisy JIT baseline: < 64 B/run over 2000 runs).
// Absolute 16 KB gate for the whole pipeline (point shadows default on, idle) = WgCellPipeline.frameAlloc.test.js.
if (typeof global.gc === 'function') {
  const garbage = [];
  for (const on of [false, true]) {
    const X = mk(); X.d.draw = () => {}; X.d.bind = () => {}; X.d.beginPass = () => {}; X.d.endPass = () => {};
    if (on) X.wl.pointPass = fakePass(X.d, [1, 1]);
    for (let i = 0; i < 3000; i++) X.wl.run(X.p, X.t);
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) X.wl.run(X.p, X.t);
    garbage.push(process.memoryUsage().heapUsed - h0);
  }
  assert.ok(garbage[1] - garbage[0] < 128 * 1024, `psh upload adds garbage: off ${garbage[0]} B, on ${garbage[1]} B`);
}
console.log('passLight.pointShadow.test.js: all checks passed.');
