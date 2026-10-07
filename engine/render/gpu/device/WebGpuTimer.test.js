// WG-1b3: timestamp brackets, nonblocking ring, and async cleanup on a GPU mock.
import assert from 'node:assert/strict';
import { WebGpuTimer, FRAME_TIMER_SLOT } from './WebGpuTimer.js';
import { GpuDeviceWebGPU } from './GpuDeviceWebGPU.js';
import { RenderTargetWebGPU } from '../../RenderTargetWebGPU.js';
import { WgCellPipeline } from '../wg/WgCellPipeline.js';

const c = { buf: { QUERY_RESOLVE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8, UNIFORM: 16 }, map: { READ: 1 } };
function mock(enabled = true) {
  let created = 0, destroyed = 0, maps = 0, tick = 0n;
  const reads = [], descs = [], events = [];
  const gpu = {
    features: new Set(enabled ? ['timestamp-query'] : []),
    createQuerySet(d) { created++; return { words: new BigUint64Array(d.count), destroy() { destroyed++; } }; },
    createBuffer(d) {
      created++;
      const b = { bytes: new ArrayBuffer(d.size), busy: false,
        destroy() { destroyed++; }, unmap() { b.busy = false; }, getMappedRange() { return b.bytes; },
        mapAsync() { maps++; b.busy = true; return new Promise((yes, no) => { b.yes = yes; b.no = no; }); } };
      if (d.usage & c.buf.MAP_READ) reads.push(b);
      return b;
    },
    createCommandEncoder() {
      return {
        beginRenderPass(d) {
          const w = d.timestampWrites;
          descs.push(w && { ...w });
          if (w?.beginningOfPassWriteIndex !== undefined) w.querySet.words[w.beginningOfPassWriteIndex] = tick;
          return { end() { tick += 1000000n; if (w) w.querySet.words[w.endOfPassWriteIndex] = tick; } };
        },
        resolveQuerySet(q, first, count, b, off) { events.push('resolve'); new BigUint64Array(b.bytes, off, count).set(q.words.subarray(first, first + count)); },
        copyBufferToBuffer(src, off, dst, dstOff, size) { events.push('copy'); new Uint8Array(dst.bytes, dstOff, size).set(new Uint8Array(src.bytes, off, size)); },
        finish() { events.push('finish'); return {}; },
      };
    },
    queue: { submit() { events.push('submit'); }, writeBuffer() {} },
    limits: { maxColorAttachments: 8 },
  };
  return { gpu, reads, descs, events, created: () => created, destroyed: () => destroyed, maps: () => maps };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const target = { passDesc: { colorAttachments: [] } };
function span(d, slot, passes = 1) {
  d.timer.begin(slot);
  for (let i = 0; i < passes; i++) { d.beginPass(target); d.endPass(); }
  d.timer.end();
}

{
  const m = mock(false), t = new WebGpuTimer(m.gpu, c), out = {};
  t.begin(FRAME_TIMER_SLOT); t.attach(target.passDesc); t.end(); t.resolve(null); t.writeStats(out);
  assert.equal(t.available, false); assert.equal(m.created(), 0);
  assert.equal(target.passDesc.timestampWrites, undefined);
  assert.ok(Number.isNaN(out.gpuMs) && Number.isNaN(out.gpuMsP95));
  t.dispose();
}
{
  const m = mock(), d = new GpuDeviceWebGPU(m.gpu, { consts: c, ringSlots: 2 }), out = {};
  assert.equal(d.caps.timerQueries, true);
  span(d, FRAME_TIMER_SLOT, 3);
  assert.equal(m.descs[0].beginningOfPassWriteIndex, 0);
  assert.equal(m.descs[1].beginningOfPassWriteIndex, undefined);
  assert.equal(m.descs[2].endOfPassWriteIndex, 1);
  // Same slot later in the frame accumulates, rather than overwriting its first bracket.
  span(d, FRAME_TIMER_SLOT, 2);
  span(d, 4);
  assert.equal(m.descs[3].beginningOfPassWriteIndex, 2);
  d.submit();
  assert.deepEqual(m.events, ['resolve', 'copy', 'finish', 'submit']);
  assert.equal(m.maps(), 1);
  m.reads[0].yes(); await flush();
  d.timer.writeStats(out);
  assert.equal(out.gpuMs, 5); assert.equal(out.gpuMsP50, 5); assert.equal(out.gpuMsP95, 5);
  const p50 = new Float32Array(10), p95 = new Float32Array(10);
  d.timer.writePassStats(p50, p95);
  assert.equal(p50[4], 1); assert.ok(Number.isNaN(p50[3]));
  // A pass outside any timer bracket cannot inherit a cached target's old timestampWrites.
  d.beginPass(target); d.endPass(); d.submit();
  assert.equal(m.descs.at(-1), undefined);
  assert.equal(m.maps(), 1);
  assert.throws(() => d.timer.begin(-1), /invalid slot/);
  d.timer.begin(0); assert.throws(() => d.timer.begin(1), /already open/); d.timer.end();
  // An empty span/submission resets without creating an encoder or a mapping.
  d.submit();
  assert.equal(m.maps(), 1);
  d.timer.begin(0); d.timer.end(); d.beginPass(target); d.endPass(); d.submit();
  assert.equal(m.maps(), 1, 'an empty span with unrelated pass work does not map');
  const resources = m.created();
  d.dispose(); d.dispose(); assert.equal(m.destroyed(), resources);
}
{
  const m = mock(), d = new GpuDeviceWebGPU(m.gpu, { consts: c, ringSlots: 2 });
  const n = m.created();
  for (let i = 0; i < 3; i++) { span(d, FRAME_TIMER_SLOT, i + 1); d.submit(); }
  assert.equal(m.maps(), 3);
  // All three buffers are mapping: keep rendering and skip the fourth timing sample.
  span(d, FRAME_TIMER_SLOT); d.submit();
  assert.equal(m.maps(), 3); assert.equal(m.created(), n);
  assert.equal(m.descs.at(-1), undefined);
  // Results can complete out of order: gpuMs stays the newest frame, not the latest callback.
  m.reads[2].yes(); await flush(); m.reads[0].yes(); await flush();
  const out = {}; d.timer.writeStats(out); assert.equal(out.gpuMs, 3);
  span(d, FRAME_TIMER_SLOT); d.submit(); assert.equal(m.maps(), 4);
  // Reject a pending map, then reuse that ring without a wait or resource allocation.
  m.reads[1].no(new Error('device lost')); await flush();
  span(d, FRAME_TIMER_SLOT); d.submit(); assert.equal(m.maps(), 5);
  assert.equal(m.created(), n);
  d.dispose();
  // Mapping can finish after disposal; do not touch destroyed resources or publish a sample.
  m.reads[0].yes(); m.reads[1].yes(); await flush();
  assert.equal(m.destroyed(), n);
}
{
  // Public stats reach both the render target (F3 even without a live cell pipeline) and pipeline.
  const events = [], stats = { gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN };
  const device = {
    timer: { begin(slot) { events.push(slot); }, end() { events.push('end'); },
      writeStats(out) { out.gpuMs = 2; out.gpuMsP50 = 1.5; out.gpuMsP95 = 3; } },
    writeTexture() {}, beginPass() { events.push('pass'); }, endPass() {}, submit() { events.push('submit'); },
  };
  const rt = Object.assign(Object.create(RenderTargetWebGPU.prototype), {
    ready: true, device, stats, cells: {}, _draw() {}, cols: 4, rows: 4,
    _cellPass() { events.push('hook'); },
  });
  rt.present();
  assert.deepEqual(events, [FRAME_TIMER_SLOT, 'hook', 'pass', 'end', 'submit']);
  assert.equal(rt.stats.gpuMsP95, 3);
  const pipeline = { device, stats: {} };
  WgCellPipeline.prototype.frame.call(pipeline, null, null, null, null);
  assert.equal(pipeline.stats.gpuMsP50, 1.5);
}
{
  // A finite query budget also drops excess spans without changing unrelated draws.
  const m = mock(), d = new GpuDeviceWebGPU(m.gpu, { consts: c, ringSlots: 2 });
  for (let i = 0; i < 129; i++) span(d, FRAME_TIMER_SLOT);
  assert.equal(m.descs[127].endOfPassWriteIndex, 255);
  assert.equal(m.descs[128], undefined);
  d.submit(); m.reads[0].yes(); await flush();
  const out = {}; d.timer.writeStats(out); assert.equal(out.gpuMs, 128);
  d.dispose();
}
{
  // Recording over many passes retains descriptor identity, query/resolve/read resources, and fixed arrays.
  const m = mock(), t = new WebGpuTimer(m.gpu, c), pd = {}, first = [], next = [];
  const n = m.created();
  for (let frame = 0; frame < 1000; frame++) {
    t.begin(0); t.attach(pd);
    if (frame === 0) first.push(pd.timestampWrites); else assert.equal(pd.timestampWrites, first[0]);
    t.attach(pd);
    if (frame === 0) next.push(pd.timestampWrites); else assert.equal(pd.timestampWrites, next[0]);
    t.end(); t.resolve(null);
  }
  assert.equal(m.created(), n);
  t.dispose();
}
console.log('WebGpuTimer: timestamp spans, three-frame async ring, fallback, stats, cleanup, 1000-frame recording PASS');
