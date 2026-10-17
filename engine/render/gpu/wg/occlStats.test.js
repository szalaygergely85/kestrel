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
  const c = new WgCullPass(dv, { occl: 2 }), g = group(10), h = hz(dv);
  const frame = () => { c.begin({ planes: null, viewProj: vp, rows: 60, hzb: h }); c.add(g, [mesh0, null]); c.run(); c.runPhase2(h); };
  frame();
  assert.equal(reads.length, 1); assert.equal(reads[0].bytes, 40); assert.equal(c.stats.culledOccl, 0, 'not available before the map resolves');
  frame(); assert.equal(reads.length, 1, 'one read in flight: busy frame skipped');
  reads[0].out.set([1, 3, 0, 2, 5, 0, 0, 0, 1, 0]); reads[0].cb(null, reads[0].out); // bit0 set: 1,3,5,1 -> 4
  assert.equal(c.stats.culledOccl, 4, 'success: culledOccl updated (one frame late)');
  frame(); assert.equal(reads.length, 2, 'next frame reads again');
  reads[1].cb(new Error('lost')); assert.equal(c.stats.culledOccl, 0, 'read error -> 0, not stuck busy');
  frame(); assert.equal(reads.length, 3, 'error cleared the busy flag');
  reads[2].cb('busy', reads[2].out); assert.equal(c._rbBusy, false, 'busy cb clears the flag');
  assert.equal(c.stats.culledOccl, 0, 'busy keeps the previous value');
  frame(); assert.equal(reads.length, 4);
  // no valid HZB (cut): stat resets
  reads[3].cb(null, reads[3].out);
  c.begin({ planes: null, viewProj: vp, rows: 60, hzb: null }); c.add(g, [mesh0, null]); c.run(); c.runPhase2(h);
  assert.equal(c.stats.culledOccl, 0);
  // occl off or no device hook: stays 0, no reads
  const off = new WgCullPass(dv); off.begin({ planes: null }); off.add(g, [mesh0, null]); off.run(); off.runPhase2(h);
  assert.equal(reads.length, 4); assert.equal(off.stats.culledOccl, 0);
  // occl on but stats off (default): zero readback calls
  const so = new WgCullPass(dv, { occl: true }); so.begin({ planes: null, viewProj: vp, rows: 60, hzb: h }); so.add(g, [mesh0, null]); so.run(); so.runPhase2(h); so.runPhase2(h);
  assert.equal(reads.length, 4, 'occl:true without occlStats: no readback'); assert.equal(so.occlStats, false);
  const dv2 = makeMockGpuDevice().device, nh = new WgCullPass(dv2, { occl: 2 });
  nh.begin({ planes: null, viewProj: vp, rows: 60, hzb: hz(dv2) }); nh.add(g, [mesh0, null]); nh.run(); nh.runPhase2(hz(dv2));
  assert.equal(nh.stats.culledOccl, 0, 'no readBufferAsync on the device -> 0');
}

// ---- real mock device: success, then mapAsync rejection, then busy (async) ----
{
  const { device: dv } = makeMockGpuDevice();
  const c = new WgCullPass(dv, { occlStats: true, occl: true }), g = group(10), h = hz(dv);
  const frame = () => { c.begin({ planes: null, viewProj: vp, rows: 60, hzb: h }); c.add(g, [mesh0, null]); c.run(); c.runPhase2(h); };
  frame(); assert.equal(c._rbBusy, true); await Promise.resolve(); await Promise.resolve();
  assert.equal(c._rbBusy, false, 'mock read resolved'); assert.equal(dv._readAsync, 1);
  dv._failReads = true; frame(); assert.equal(dv._readAsync, 2); await Promise.resolve(); await Promise.resolve();
  assert.equal(c._rbBusy, false, 'rejected read clears busy'); assert.equal(c.stats.culledOccl, 0);
  dv._failReads = false; frame(); assert.equal(c._rbBusy, true); await Promise.resolve(); await Promise.resolve(); assert.equal(c._rbBusy, false);
  // device-level busy: second raw read on the same buffer calls back 'busy' synchronously
  const buf = c.queue[0].occlBuf; let got = null; const out = new Uint32Array(4);
  assert.equal(dv.readBufferAsync(buf, 16, out, () => {}), true);
  assert.equal(dv.readBufferAsync(buf, 16, out, (e) => { got = e; }), false); assert.equal(got, 'busy');
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
