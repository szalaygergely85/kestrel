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
    createBuffer(desc) { return makeHandle('buffer', desc); },
    // CLOTH-1b2: counts writes (tests assert "1 write per changed version, 0 when asleep"); keeps the last payload.
    writeBuffer(handle, data, dstOffsetBytes = 0) { handle._writes = (handle._writes || 0) + 1; handle._lastWrite = { data, dstOffsetBytes }; state.writeCount++; },
    createTexture(desc) { return makeHandle('texture', desc); },
    createTarget(desc) { return makeHandle('target', desc); },
    createPipeline(desc) { return makeHandle('pipeline', desc); },
    beginPass(target, opts) { device._activeTarget = target; },
    bind(pipeline, desc) { device._activePipeline = pipeline; device._lastBind = desc; },
    draw(count, first = 0, instances = 1) {
      device._drawCalls = (device._drawCalls || 0) + 1;
      device._lastDraw = { count, first, instances };
    },
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
