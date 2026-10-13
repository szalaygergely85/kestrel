// ENV-01d (38.62): WgDecorPass + WgCullPass.addGenerated on the device mock. The mock never computes, so a small executor replays the cs_decor thread loop with the
// ENV-01a TWIN (decorCell) from the REAL uniform words / buffers the pass wrote; counts per args slot are compared with decorFrame. Covers: generated args slots
// zeroed every frame (counts are per frame, never accumulated), slot/offset layout, dispatch sizes, off = no pass, timer slot, 0 alloc per frame.
// node --expose-gc engine/render/gpu/wg/passDecor.test.js   (re-spawns itself with the flag)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCullPass } from './passCull.js';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { WgDecorPass, DECOR_MAX_ROWS } from './passDecor.js';
import { DECOR_BLOCK, DECOR_WORKGROUP } from '../wgsl/decor.wgsl.js';
import { WG_PASS_SLOT } from '../device/WebGpuTimer.js';
import { packDecorLayers, decorCell, decorFrame, makeDecorLists, decorSide, DECOR_OUT_WORDS, O_SPECIES } from '../../../mesh/decorScatter.js';
import { INSTANCE_BYTES } from '../../../mesh/instances.js';

if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=64', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const cfgPack = { layers: [
  { seed: 0x1234abcd, cellM: 3, jitterM: 1, drawM: 30, species: [{ weight: 3, lodM: 15, maxDistM: 30, grassLike: true, scaleMin: 0.8, scaleMax: 1.3 }, { weight: 1, lodM: 18, maxDistM: 28, scaleMin: 0.5, scaleMax: 1 }] },
  { seed: 0xdeadbeef, cellM: 2, jitterM: 0.8, drawM: 20, densityQ8: 384, species: [{ weight: 1, lodM: 10, maxDistM: 20, scaleMin: 0.6, scaleMax: 1 }] },
] };
const packed = packDecorLayers(cfgPack);
const fades = [Int32Array.of(2500, 2200), Int32Array.of(1800)];
const mk = (tri) => ({ triCount: tri, ranges: [{ start: 0, count: tri }] });
const parts = { m: new Float32Array(12), flags: new Uint32Array(1) };
const layerCfg = (l) => ({ species: cfgPack.layers[l].species.map((s, i) => ({ meshes: [mk(20 + i), i === 0 ? mk(6) : null], parts })), fadeCm: fades[l] });
const hostCfg = { packed, layers: [layerCfg(0), layerCfg(1)], carpetRadiusM: 8, objectId: 0x4000, radiusM: 2 };

// mirrored mock device
function makeDev() {
  const mock = makeMockGpuDevice(), d = mock.device;
  const oc = d.createBuffer, ow = d.writeBuffer;
  d.createBuffer = (desc) => {
    const h = oc(desc), n = desc.data ? desc.data.byteLength : desc.bytes;
    h._gpu = { u32: new Uint32Array(Math.ceil(n / 4)) };
    if (desc.data) h._gpu.u32.set(new Uint32Array(desc.data.buffer, desc.data.byteOffset, desc.data.byteLength >> 2));
    return h;
  };
  d.writeBuffer = (h, data, off = 0) => { ow(h, data, off); h._gpu.u32.set(new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2), off >> 2); };
  d.dispose = d.dispose || (() => {});
  return d;
}
const W = (n) => DECOR_BLOCK.field(n).word;
// cs_decor thread loop with the twin (no frustum / z: those are not decisions, covered by decor.wgsl.test.js)
function execDispatch(d) {
  const { desc, x } = d._lastDispatch, uf = desc.uniforms, ui = new Int32Array(uf.buffer, uf.byteOffset, uf.length), uu = new Uint32Array(uf.buffer, uf.byteOffset, uf.length);
  const [, maskB, dfade, , args] = desc.buffers.map((b) => b.buffer);
  const layer = uu[W('layer')], side = uu[W('side')], cap = uu[W('cap')], ix0 = ui[W('ix0')], iy0 = ui[W('iy0')], mw = ui[W('mw')], mh = ui[W('mh')];
  const eyeX = ui[W('eyeX')], eyeY = ui[W('eyeY')], carpet = ui[W('carpetCut')], base = uu[W('argsBase')];
  const fade = new Int32Array(dfade._gpu.u32.buffer), out = new Int32Array(DECOR_OUT_WORDS);
  const cell = packed.words[2 + layer * 8 + 1], half = (side - 1) >> 1;
  assert.ok(x * DECOR_WORKGROUP >= cap && (x - 1) * DECOR_WORKGROUP < cap, 'dispatch covers cap threads exactly');
  for (let t = 0; t < cap; t++) {
    const row = Math.floor(t / side), col = t - row * side;
    const ix = Math.floor(eyeX / cell) - half + col, iy = Math.floor(eyeY / cell) - half + row, mx = ix - ix0, my = iy - iy0;
    if (mx < 0 || my < 0 || mx >= mw || my >= mh) continue;
    const i = my * mw + mx, mb = (maskB._gpu.u32[i >> 2] >>> ((i & 3) * 8)) & 255;
    const r = decorCell(packed, layer, ix, iy, mb, eyeX, eyeY, fade, carpet, out);
    if (r === 0) continue;
    args._gpu.u32[base + (out[O_SPECIES] * 2 + (r - 1)) * 5 + 1]++;
  }
}

function setup(withMasks = true) {
  const d = makeDev();
  d.dispatch = (pipeline, desc, x) => { d._lastDispatch = { pipeline, desc, x }; (d._disp || (d._disp = [])).push(x); execDispatch(d); };
  const cull = new WgCullPass(d), dec = new WgDecorPass(d, cull);
  dec.configure(hostCfg);
  if (withMasks) {
    let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const layers = [0, 1].map((l) => { const w = 60, h = 50, m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = (Math.floor(rnd() * 128) | (rnd() < 0.3 ? 128 : 0)); return { mask: m, ix0: -30, iy0: -25, w, h }; });
    dec.setMasks({ layers }, 1);
    dec.setNear({ data: new Float32Array(32 * 32), w: 32, h: 32, x0: -48, y0: -48, cell: 3 }, 1);
  }
  return { d, cull, dec };
}
const BEGIN = { planes: null, viewProj: null, rows: 0, eye: null, maxDistM: 0 }, FR = { eye: { x: 0, y: 0 }, planes: null, swayPad: 0 }; // reused: the probe measures the pass, not the test
function frame(cull, dec, eye, p) {
  cull.begin(BEGIN); FR.eye.x = eye[0]; FR.eye.y = eye[1];
  dec.queue(); cull.run(); dec.run(FR, p);
}

// 1. off: no masks -> no pass, no batches, no dispatch
{
  const { d, cull, dec } = setup(false);
  assert.equal(dec.on, false);
  frame(cull, dec, [0, 0]);
  assert.equal(cull.batches.size, 0); assert.equal((d._disp || []).length, 0); assert.equal(dec.stats.dispatches, 0);
}

// 2. on: counts match decorFrame per slot, per frame (args zeroed in between), layout
{
  const { d, cull, dec } = setup();
  assert.equal(dec.on, true);
  const eyes = [[2.5, -1.25], [10.1, 7.7], [-14.2, 3.3], [2.5, -1.25]];
  const pk = [0, 1].map((l) => makeDecorLists(packed, l)), out = new Int32Array(DECOR_OUT_WORDS);
  let nonzero = 0;
  for (const e of eyes) {
    d._disp = [];
    frame(cull, dec, e);
    assert.deepEqual(d._disp, [0, 1].map((l) => Math.ceil(decorSide(packed, l) ** 2 / DECOR_WORKGROUP)), 'dispatch sizes == layer lattice');
    for (let l = 0; l < 2; l++) {
      const m = dec._masks.layers[l], info = cull.generatedInfo(dec.layers[l].key);
      decorFrame(packed, l, m.mask, m.ix0, m.iy0, m.w, m.h, Math.round(e[0] * 100), Math.round(e[1] * 100), fades[l], 1000, pk[l], out);
      const slots = pk[l].counts.length;
      for (let k = 0; k < slots; k++) {
        const got = cull.argsBuffer._gpu.u32[info.argsBase + k * 5 + 1];
        assert.equal(got, pk[l].counts[k], `layer ${l} slot ${k} eye ${e}`);
        nonzero += got > 0 ? 1 : 0;
        assert.ok(got <= dec.layers[l].cap, 'append cannot overflow the slab');
      }
      // entries: index species*2+lod, args record + slab offset + activity
      const es = dec.entries[l];
      assert.equal(es.length, slots);
      for (let k = 0; k < slots; k++) {
        assert.equal(es[k].argsOffset, (info.slot + k) * 20); assert.equal(es[k].instanceOffset, k * dec.layers[l].cap * INSTANCE_BYTES);
        assert.equal(es[k].instanceBuffer, info.slab); assert.equal(es[k].argsBuffer, cull.argsBuffer);
      }
      assert.equal(es[0].active, true); assert.equal(es[1].active, true); // species 0 has LOD0 + LOD1
      if (l === 0) { assert.equal(es[2].active, true); assert.equal(es[3].active, false, 'species 1 has no LOD1 mesh'); }
      assert.equal(cull.argsBuffer._gpu.u32[info.argsBase + 0], es[0].mesh.triCount * 3, 'indexCount word');
    }
  }
  assert.ok(nonzero > 4, 'fixture produces decor');
  assert.equal(dec.stats.maskUploads, 2); assert.equal(dec.stats.nearUploads, 1);
  // 3. unchanged versions do not re-upload; a new version does
  dec.setMasks(dec._masks, 1); dec.setNear(dec.near, 1); assert.equal(dec.stats.maskUploads, 2); assert.equal(dec.stats.nearUploads, 1);
  dec.setMasks(dec._masks, 2); dec.setNear(dec.near, 2); assert.equal(dec.stats.maskUploads, 4); assert.equal(dec.stats.nearUploads, 2);
  // 4. timer slot
  const seen = []; const p = { _passTimingOn: true, device: { timer: { begin: (s) => seen.push(s), end: () => seen.push('end') } } };
  frame(cull, dec, [0, 0], p);
  assert.deepEqual(seen, [WG_PASS_SLOT.decor, 'end']); assert.equal(WG_PASS_SLOT.decor, 15);
  // 5. budget throws naming the layer
  const big = packDecorLayers({ layers: [{ seed: 1, cellM: 1, jitterM: 0.2, drawM: 60, species: [{ weight: 1, lodM: 20, maxDistM: 60, scaleMin: 1, scaleMax: 1 }] }] });
  assert.throws(() => dec.configure({ packed: big, layers: [{ species: [{ meshes: [mk(3), null], parts }], fadeCm: Int32Array.of(3000) }], carpetRadiusM: 0, objectId: 0, radiusM: 1 }), /layer 0 exceeds DECOR_MAX_ROWS/);
  assert.equal(DECOR_MAX_ROWS, 16384);
  { // rows = side^2 x 2 x species: 1 species fits, the same lattice with 3 species exceeds (real slab count)
    const sp3 = (n) => Array.from({ length: n }, () => ({ weight: 1, lodM: 15, maxDistM: 30, scaleMin: 1, scaleMax: 1 }));
    const mkc = (n) => ({ packed: packDecorLayers({ layers: [{ seed: 1, cellM: 1, jitterM: 0.2, drawM: 30, species: sp3(n) }] }), layers: [{ species: Array.from({ length: n }, () => ({ meshes: [mk(3), null], parts })), fadeCm: Int32Array.from({ length: n }, () => 3000) }], carpetRadiusM: 0, objectId: 0, radiusM: 1 });
    dec.configure(mkc(1));
    assert.throws(() => dec.configure(mkc(3)), /layer 0 exceeds DECOR_MAX_ROWS/);
  }
  dec.dispose(); assert.equal(cull.batches.size, 0, 'dispose frees the generated batches');
}

// 6. 0 allocation per frame after warm-up
{
  const { d, cull, dec } = setup();
  let n = 0;
  d.dispatch = () => { n++; }; d.writeBuffer = () => {}; // the mock's own recording allocates; the pass's JS is what is measured
  const eye = [1.5, 2.5];
  for (let i = 0; i < 4000; i++) { eye[0] += 0.37; frame(cull, dec, eye); }
  // harness baseline: the eye-double field stores alone (HeapNumber boxes, same pattern as passRaster's _eye.x = cam.x) are not the pass's allocations
  // harness baseline: the eye-double field stores alone (HeapNumber boxes, same pattern as passRaster's _eye.x = cam.x) are not the pass's allocations
  const body = (n, withPass) => { for (let i = 0; i < n; i++) { eye[0] += 0.37; eye[1] -= 0.11; if (withPass) frame(cull, dec, eye); else { FR.eye.x = eye[0]; FR.eye.y = eye[1]; } } };
  const N = 4000, r = allocProbe((k) => body(k, true), { n: N }), base = allocProbe((k) => body(k, false), { n: N });
  assert.ok(n >= 2 * N, 'dispatched every frame');
  if (!skipNote(r, 'passDecor alloc')) {
    const per = Math.max(0, r.bytes - base.bytes) / N;
    assert.ok(per < 1, `decor frame allocates ${per.toFixed(2)} B/frame beyond the harness (<1)`);
    console.log(`  alloc: ${per.toFixed(2)} B/frame (min of 5 windows x ${N} frames)`);
  }
}
console.log('passDecor.test OK');
