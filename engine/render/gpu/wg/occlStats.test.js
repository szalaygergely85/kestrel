// OCCL-STATS-01: stats.culledOccl readback plumbing (fake readBufferAsync) + timer slots hzb / cull2 (raster2 is opened by passRaster).
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { makeInstanceGroup, INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { WgCullPass } from './passCull.js';
import { WgHzbPass } from './passHzb.js';
import { WG_PASS_NAMES, WG_PASS_SLOT, FRAME_TIMER_SLOT } from '../device/WebGpuTimer.js';

const mesh0 = { triCount: 300, bbox: [-1.5, -1.5, 0, 1.5, 1.5, 6], ranges: [{ first: 0, count: 900 }] };
function group(n) {
  const g = makeInstanceGroup('trees', n);
  g.parts.count = 1; g.parts.m[0] = 1; g.parts.m[4] = 1; g.parts.m[8] = 1; g.lodCells = 0; g.count = n;
  for (let i = 0; i < n; i++) g.ib.f32.set([1, 0, 0, i, 0, 1, 0, 0, 0, 0, 1, 0], i * INSTANCE_STRIDE);
  return g;
}
assert.ok(WG_PASS_SLOT.hzb < FRAME_TIMER_SLOT && WG_PASS_SLOT.cull2 < FRAME_TIMER_SLOT && WG_PASS_SLOT.raster2 < FRAME_TIMER_SLOT && WG_PASS_NAMES.length <= FRAME_TIMER_SLOT);

function spy() { const o = []; let a = -1; return { o, begin(s) { assert.equal(a, -1, 'no nested span'); a = s; o.push(s); }, end() { a = -1; o.push('e'); } }; }
const vp = new Float64Array(16).map((_, i) => i + 1);
const hz = (dv) => ({ buffer: dv.createBuffer({ usage: 'storage', bytes: 1024 }), w: 8, h: 8, levels: 4, pitch: 64, fwd: [0, 1, 0] });

// ---- readback plumbing ----
{
  const dv = makeMockGpuDevice().device, reads = [];
  dv.readBufferAsync = (buf, bytes, out, cb) => reads.push({ buf, bytes, out, cb });
  const c = new WgCullPass(dv, { occl: true }), g = group(10), h = hz(dv);
  const frame = () => { c.begin({ planes: null, viewProj: vp, rows: 60, hzb: h }); c.add(g, [mesh0, null]); c.run(); c.runPhase2(h); };
  frame();
  assert.equal(reads.length, 1); assert.equal(reads[0].bytes, 40); assert.equal(c.stats.culledOccl, 0, 'not available before the map resolves');
  frame(); assert.equal(reads.length, 1, 'one read in flight: busy frame skipped');
  reads[0].out.set([1, 3, 0, 2, 5, 0, 0, 0, 1, 0]); reads[0].cb(null, reads[0].out, 10); // bit0 set: 1,3,5,1 -> 4
  assert.equal(c.stats.culledOccl, 4);
  frame(); assert.equal(reads.length, 2, 'next frame reads again');
  reads[1].cb(new Error('lost'), null, 0); assert.equal(c.stats.culledOccl, 0, 'read error -> 0, not stuck busy');
  frame(); assert.equal(reads.length, 3);
  // no valid HZB (cut): stat resets
  reads[2].cb(null, reads[2].out, 10);
  c.begin({ planes: null, viewProj: vp, rows: 60, hzb: null }); c.add(g, [mesh0, null]); c.run(); c.runPhase2(h);
  assert.equal(c.stats.culledOccl, 0);
  // occl off or no device hook: stays 0, no reads
  const off = new WgCullPass(dv); off.begin({ planes: null }); off.add(g, [mesh0, null]); off.run(); off.runPhase2(h);
  assert.equal(reads.length, 3); assert.equal(off.stats.culledOccl, 0);
  const dv2 = makeMockGpuDevice().device, nh = new WgCullPass(dv2, { occl: true });
  nh.begin({ planes: null, viewProj: vp, rows: 60, hzb: hz(dv2) }); nh.add(g, [mesh0, null]); nh.run(); nh.runPhase2(hz(dv2));
  assert.equal(nh.stats.culledOccl, 0, 'no readBufferAsync on the device -> 0');
}

// ---- timers: off = no calls; on = hzb then cull2 ----
{
  const dv = makeMockGpuDevice().device, t = spy(); dv.timer = t;
  const c = new WgCullPass(dv, { occl: true }), g = group(4), h = hz(dv), hp = new WgHzbPass(dv); hp.resize(64, 32);
  c.begin({ planes: null, viewProj: vp, rows: 60, hzb: h }); c.add(g, [mesh0, null]); c.run();
  const off = { _passTimingOn: false, device: dv };
  hp.build({ kind: 'tex' }, off); c.runPhase2(h, off); c.runPhase2(h); hp.build({ kind: 'tex' });
  assert.deepEqual(t.o, [], 'timing off / no host: no timer calls');
  const on = { _passTimingOn: true, device: dv };
  hp.build({ kind: 'tex' }, on); c.runPhase2(h, on);
  assert.deepEqual(t.o, [WG_PASS_SLOT.hzb, 'e', WG_PASS_SLOT.cull2, 'e'], 'hzb then cull2, closed each');
}
console.log('occlStats: OK');
