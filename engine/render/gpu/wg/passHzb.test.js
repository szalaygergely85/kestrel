// S8-B2-10c: WgHzbPass host wiring on the device mock - op order, packed layout offsets (== cull.wgsl.js), pitch, validity, no per-frame buffers.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { hzbLevelSizes } from '../../../mesh/hzb.js';
import { HZB_BLOCK } from '../wgsl/hzb.wgsl.js';
import { WgHzbPass } from './passHzb.js';

const m = makeMockGpuDevice(), d = m.device, log = [];
const oc = d.copyTextureToBuffer, ob = d.copyBufferToBuffer;
d.copyTextureToBuffer = (...a) => { log.push('tex'); oc(...a); };
d.copyBufferToBuffer = (...a) => { log.push('buf'); ob(...a); };
const disp = [];
d.dispatch = (p, desc, x, y) => {
  const u = new Uint32Array(desc.uniforms.buffer, desc.uniforms.byteOffset, desc.uniforms.length);
  const W = (n) => HZB_BLOCK.field(n).word;
  log.push('disp'); disp.push({ x, y, srcW: u[W('srcW')], srcH: u[W('srcH')], dstW: u[W('dstW')], dstH: u[W('dstH')], pitch: u[W('srcPitch')], src: desc.buffers[0].buffer, dst: desc.buffers[1].buffer });
};
let creates = 0; const cb = d.createBuffer; d.createBuffer = (x) => { creates++; return cb(x); };

const hz = new WgHzbPass(d), W = 400, H = 150, sizes = hzbLevelSizes(W, H);
hz.resize(W, H);
const made = creates;
assert.equal(hz.levels, sizes.length); assert.equal(hz.pitch, 448, '400 f32 = 1600 B -> 1792 B rows = 448 words');
assert.equal(hz.descriptor({ x: 0, y: 1, z: 0 }), null, 'invalid before the first build (first frame -> hzbOn 0)');
const tex = { kind: 'texture' };
for (let frame = 0; frame < 3; frame++) {
  log.length = 0; disp.length = 0;
  hz.build(tex);
  assert.deepEqual(log.slice(0, 2), ['tex', 'buf'], 'depth copy, then level 0 into the packed buffer');
  assert.equal(disp.length, sizes.length - 1, 'one dispatch per level');
  for (let i = 0; i < disp.length; i++) {
    assert.equal(log[2 + i * 2], 'disp'); assert.equal(log[3 + i * 2], 'buf', 'each level is copied into the packed buffer after its dispatch');
    assert.deepEqual([disp[i].srcW, disp[i].srcH, disp[i].dstW, disp[i].dstH, disp[i].pitch], [sizes[i].w, sizes[i].h, sizes[i + 1].w, sizes[i + 1].h, i === 0 ? 448 : 0]);
    assert.ok(disp[i].src !== disp[i].dst, 'src and dst are separate buffers (no read/rw aliasing)');
  }
}
assert.equal(creates, made, 'zero buffer creation per frame');
// packed offsets: level 0 = pitch * h words, then dense levels (cull.wgsl.js off(L+1) = off(L) + pitch_L * h_L)
let off = 448 * H; const bufCopies = d._copies.filter((c) => c.kind === 'buf').slice(-sizes.length);
assert.equal(bufCopies[0].dstOff, 0);
for (let L = 1; L < sizes.length; L++) { assert.equal(bufCopies[L].dstOff, off * 4, `level ${L} offset`); off += sizes[L].w * sizes[L].h; }
const dsc = hz.descriptor({ x: 1, y: 0, z: 0 });
assert.ok(dsc && dsc.buffer === hz.buffer && dsc.pitch === 448 && dsc.levels === sizes.length && dsc.w === W && dsc.fwd[0] === 1);
hz.invalidate(); assert.equal(hz.descriptor({ x: 0, y: 1, z: 0 }), null, 'invalidate -> hzbOn 0');
hz.build(tex); assert.ok(hz.valid);
hz.resize(W, H); assert.ok(hz.valid, 'same size: no-op');
hz.resize(320, 100); assert.equal(hz.valid, false, 'resize invalidates'); assert.equal(hz.pitch, 320);
hz.dispose();
console.log('passHzb.test OK');
