// engine/test/assert.js (US-050, docs/backlog.md "PC-B QUEUE 3" item 9).
//
// This repo has no test framework - every `*.test.js`/`*.test.mjs` file is a
// plain Node script that hand-rolls its own tiny pass/fail tally and an
// `ok(name, cond, detail)` assertion helper (plus, in a few files,
// `approxEqual(a, b, eps)`). Dozens of files repeated the exact same
// `ok`/`approxEqual` bodies; this module is their single canonical home so
// the actual assertion LOGIC lives in one place, while each test file keeps
// its own local `pass`/`fail`/`failures` state and its own footer report
// (those differ enough file to file - some print a suite name, some don't -
// that centralizing them would risk changing a test's own output matching
// elsewhere, e.g. `tools/run-tests.mjs`'s "FAIL" line heuristic).
//
// Usage (per test file), unchanged pass/fail semantics and message format:
//
//   import { makeOk } from '<relative path>/engine/test/assert.js';
//   let pass = 0, fail = 0;
//   const failures = [];
//   const ok = makeOk(() => pass++, () => fail++, (msg) => failures.push(msg));
//   ...
//   ok('some check', cond, 'detail on failure');
//
// A file whose local `approxEqual` always supplies its own default `eps`
// (i.e. every call site passes `eps` explicitly) can import `approxEqual`
// directly. A file that relies on a default (some call sites omit `eps`)
// keeps a 1-line local wrapper supplying that exact default, e.g.:
//
//   import { approxEqual as approxEqualCore } from '<path>/engine/test/assert.js';
//   function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

/** Builds an `ok(name, cond, detail)` bound to this file's own tally
 * (`incPass`/`incFail`/`pushFailure` close over the caller's local
 * `pass`/`fail`/`failures` variables) - the exact same behaviour every local
 * copy had: on failure, push `${name}${detail ? ' - ' + detail : ''}`. */
export function makeOk(incPass, incFail, pushFailure) {
  return function ok(name, cond, detail) {
    if (cond) {
      incPass();
    } else {
      incFail();
      pushFailure(`${name}${detail ? ' - ' + detail : ''}`);
    }
  };
}

/** `|a - b| <= eps` - the formula every local `approxEqual` used. No default
 * `eps` here on purpose: the local copies disagreed on their default
 * (1e-3/1e-6/1e-9), so a file that needs one keeps a thin local wrapper
 * (see the module doc comment above) rather than this module picking one
 * default that would silently change another file's behaviour. */
export function approxEqual(a, b, eps) {
  return Math.abs(a - b) <= eps;
}

// ME-03b (docs/backlog.md, docs/architecture.md 27.2/27.11): a Node-only
// in-memory GpuDevice (engine/render/gpu/device/GpuDevice.js's shape) so
// MeshBuffers.js and other ME-04+ modules can be unit-tested without a real
// WebGL2 context. Every "resource" is a plain object with a `_disposed`
// flag; `createBuffer`/`createTexture` etc. just record their descriptor so
// a test can assert on alloc/free pairs and "no per-frame (re)creation"
// (compare the object identity/version across frames) - no actual pixels or
// vertices are ever computed here, this is a bookkeeping double, not a
// software rasteriser.
/**
 * @returns {{
 *   device: import('../render/gpu/device/GpuDevice.js').GpuDevice,
 *   liveCount: () => number,
 *   createCount: number,
 *   writeCount: number,
 *   texWriteCount: number,
 *   submitCount: number,
 * }}
 */
export function makeMockGpuDevice() {
  const live = new Set();
  const state = { createCount: 0, writeCount: 0, texWriteCount: 0, submitCount: 0 };
  function makeHandle(kind, desc) {
    state.createCount++;
    const h = { kind, desc, _disposed: false };
    live.add(h);
    return h;
  }
  const device = {
    createBuffer(desc) { const h = makeHandle('buffer', desc); if (device.modelHazard && desc.data) h._queued = desc.data.slice(); return h; },
    // CLOTH-1b2: counts writes (tests assert "1 write per changed version, 0 when asleep"); keeps the last payload.
    // ME-16c: `device.modelHazard = true` models the real queue: writeBuffer copies at call time and lands at once, draws execute at submit, so
    // every draw sees the LAST written contents of its instance buffer; `device.hazardDraws()` returns [{buffer, seen}] resolved that way.
    writeBuffer(handle, data, dstOffsetBytes = 0) { handle._writes = (handle._writes || 0) + 1; handle._lastWrite = { data, dstOffsetBytes }; state.writeCount++; if (device.modelHazard) handle._queued = data.slice(); },
    createTexture(desc) {
      // ME-16b (38.22): 2d-array textures mirror GpuDeviceWebGPU's validation (depth24 + sampled only, integer layers >= 1)
      if (desc.layers !== undefined && (desc.format !== 'depth24' || !desc.sampled || !(desc.layers >= 1) || (desc.layers | 0) !== desc.layers)) {
        throw new Error('mock createTexture: `layers` needs format depth24 + sampled and an integer >= 1');
      }
      const h = makeHandle('texture', desc);
      if (desc.layers !== undefined) { h.layers = desc.layers; h.layerViews = new Array(desc.layers).fill(null); }
      return h;
    },
    createTarget(desc) {
      const h = makeHandle('target', desc);
      const d = desc.depth;
      if (d && d.layers !== undefined) {
        if (d._disposed) throw new Error('mock createTarget: depth texture is destroyed');
        const L = desc.layer;
        if (!(L >= 0 && L < d.layers) || (L | 0) !== L) throw new Error(`mock createTarget: layer ${L} out of range 0..${d.layers - 1}`);
        h.layerView = d.layerViews[L] || (d.layerViews[L] = { kind: 'layerView', texture: d, layer: L }); // cached: same object per layer
      } else if (desc.layer !== undefined) throw new Error('mock createTarget: `layer` on a texture without layers');
      return h;
    },
    createPipeline(desc) { return makeHandle('pipeline', desc); },
    beginPass(target, opts) {
      if (target.layerView && target.layerView.texture._disposed) throw new Error('mock beginPass: layer view of a destroyed texture');
      if (opts && opts.clear) target._clears = (target._clears || 0) + 1; // per-layer clear = clear on that layer's target
      device._activeTarget = target;
    },
    bind(pipeline, desc) {
      if (desc && desc.textures) for (const t of desc.textures) {
        if (t.texture && t.texture.layers !== undefined) {
          if (t.texture._disposed) throw new Error('mock bind: array texture is destroyed');
          if (pipeline.desc && pipeline.desc.bindings && pipeline.desc.bindings.textures && pipeline.desc.bindings.textures[t.slot] !== 'depthArray') throw new Error(`mock bind: slot ${t.slot} must be kind 'depthArray' for an array texture`);
        }
      }
      device._activePipeline = pipeline; device._lastBind = desc;
    },
    draw(count, first = 0, instances = 1) {
      device._drawCalls = (device._drawCalls || 0) + 1;
      device._lastDraw = { count, first, instances };
      if (device.modelHazard && device._lastBind && device._lastBind.instanceBuffer) (device._hazardLog || (device._hazardLog = [])).push(device._lastBind.instanceBuffer);
    },
    hazardDraws() { return (device._hazardLog || []).map((buffer) => ({ buffer, seen: buffer._queued })); },
    endPass() { device._activeTarget = null; },
    readback(tex, rect, out) { if (out && out.fill) out.fill(0); },
    // WG-1b1 (38.3): the mock records, never computes.
    writeTexture(tex, data, rect, dataOffset) { tex._texWrites = (tex._texWrites || 0) + 1; tex._lastTexWrite = { data, rect: rect || null, dataOffset: dataOffset || 0 }; state.texWriteCount++; },
    canvasTarget() { if (!device._canvasTarget) device._canvasTarget = makeHandle('target', { canvas: true }); return device._canvasTarget; },
    submit() { state.submitCount++; },
    // WG-4a (38.3): the mock records, never computes.
    createComputePipeline(desc) { return makeHandle('computePipeline', desc); },
    // S8-B1-09a: the mock links synchronously; async variants resolve at once
    createComputePipelineAsync(desc) { return Promise.resolve(makeHandle('computePipeline', desc)); },
    beginCompileBatch() { device._batchDepth = (device._batchDepth || 0) + 1; },
    endCompileBatch() { device._batchDepth = Math.max(0, (device._batchDepth || 0) - 1); return Promise.resolve([]); },
    createPipelineAsync(desc) { return Promise.resolve(makeHandle('pipeline', desc)); },
    compiling: false,
    copyTextureToBuffer(tex, buf, w, h, bytesPerRow) { (device._copies || (device._copies = [])).push({ kind: 'tex', tex, buf, w, h, bytesPerRow }); },
    copyBufferToBuffer(src, srcOff, dst, dstOff, bytes) { (device._copies || (device._copies = [])).push({ kind: 'buf', src, srcOff, dst, dstOff, bytes }); },
    // OCCL-STATS-01b: mirrors GpuDeviceWebGPU.readBufferAsync validation; resolves next tick with the buffer's last written data (or zeros)
    readBufferAsync(buf, bytes, outU32, cb) {
      if (!buf || buf.kind !== 'buffer' || buf._disposed) throw new Error('mock readBufferAsync: needs a live buffer handle');
      if (!(bytes > 0) || bytes % 4) throw new Error('mock readBufferAsync: bytes must be a positive multiple of 4');
      const size = buf.desc && (buf.desc.data ? buf.desc.data.byteLength : buf.desc.bytes || 0);
      if (bytes > Math.max(4, (size + 3) & ~3)) throw new Error('mock readBufferAsync: bytes exceeds the buffer size');
      if (!(outU32 instanceof Uint32Array) || outU32.length * 4 < bytes) throw new Error('mock readBufferAsync: outU32 too small');
      if (buf.desc.usage !== 'storage' && buf.desc.usage !== 'indirect') throw new Error('mock readBufferAsync: buffer needs COPY_SRC (storage/indirect usage)');
      if (buf._readBusy) { cb('busy', outU32); return false; }
      buf._readBusy = true; device._readAsync = (device._readAsync || 0) + 1;
      Promise.resolve().then(() => {
        if (device._failReads) { buf._readBusy = false; cb(new Error('mock mapAsync rejected')); return; } // models a mapAsync rejection
        const w = buf._lastWrite, src = w && w.data && w.dstOffsetBytes === 0 ? new Uint32Array(w.data.buffer, w.data.byteOffset, Math.min(bytes, w.data.byteLength) >> 2) : (buf.desc.data ? new Uint32Array(buf.desc.data.buffer, buf.desc.data.byteOffset, Math.min(bytes, buf.desc.data.byteLength) >> 2) : null);
        outU32.fill(0, 0, bytes >> 2); if (src) outU32.set(src);
        buf._readBusy = false; cb(null, outU32);
      });
      return true;
    },
    dispatch(pipeline, desc, x, y = 1, z = 1) {
      // WebGPU usage rule: a writable ('rw') storage binding must not alias another binding of the same buffer in one bind group
      const acc = pipeline && pipeline.desc && pipeline.desc.bindings && pipeline.desc.bindings.buffers, bs = desc && desc.buffers;
      if (acc && bs) for (const a of bs) if (acc[a.slot] === 'rw') for (const o of bs) if (o !== a && o.buffer === a.buffer) throw new Error(`mock: writable storage binding at slot ${a.slot} aliases slot ${o.slot} (same buffer)`);
      device._dispatches = (device._dispatches || 0) + 1; device._lastDispatch = { pipeline, desc, x, y, z }; },
    drawIndirect(buffer, offsetBytes) { device._indirectDraws = (device._indirectDraws || 0) + 1; device._lastIndirect = { pipeline: device._activePipeline, buffer, offsetBytes }; },
    dispose(handle) {
      // Two call shapes on purpose: `device.dispose()` (whole-device
      // teardown, GpuDevice.js's own contract) frees every live handle;
      // `device.dispose(handle)` (this mock's extra convenience, used by
      // MeshBuffers' own eviction tests) frees just one, so a test can
      // assert "evicting one mesh's buffer frees exactly that buffer".
      if (handle) { handle._disposed = true; live.delete(handle); return; }
      for (const h of live) h._disposed = true;
      live.clear();
    },
    backend: 'webgl2',
    lost: new Promise(() => {}), // never resolves, like a healthy device
    timer: { begin() {}, end() {} },
    caps: { maxColorAttachments: 4, timerQueries: false, softwareRenderer: false },
  };
  return {
    device,
    liveCount: () => live.size,
    get createCount() { return state.createCount; },
    get writeCount() { return state.writeCount; },
    get texWriteCount() { return state.texWriteCount; },
    get submitCount() { return state.submitCount; },
  };
}
