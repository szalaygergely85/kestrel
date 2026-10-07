// @ts-check
// engine/render/gpu/device/GpuDeviceWebGPU.js - WG-1b2 (docs/architecture.md 38.1-38.7). The WebGPU implementation
// of the GpuDevice shape (GPU_DEVICE_METHODS). With webgpuProbe.js, the ONLY engine file that uses `navigator.gpu` /
// `GPU*` globals (check-deps rule 17); everything else sees opaque handles.
//
// Conventions (also documented on GpuDevice.js typedefs):
//  - shader entry points: vertex `vs_main`, fragment `fs_main` (PipelineStageDesc.src.entry overrides).
//  - @group(0): the pipeline's textures at binding = slot (PipelineDesc.bindings.textures order); every 'filtered'
//    slot k additionally gets a sampler at binding textures.length + k (the texture's own `filter`).
//  - @group(1) @binding(0): one dynamic-offset uniform block of `bindings.uniformBytes` out of the per-frame ring.
//  - vertex buffer 0 = BindDesc.vertexBuffer, vertex buffer 1 = BindDesc.instanceBuffer (step mode instance).
//  - raster pipelines use frontFace 'cw' (38.5 item 4: the vertex shader flips y).
// Hot path (bind/draw): no allocation; descriptors and bind groups are built once and cached (38.4).

import { createUniformRing, UNIFORM_SLOT_ALIGN } from '../wgsl/uniformBlock.js';
import { MAX_DRAW_ITEMS } from '../../../mesh/DrawList.js';
import { textureFormatFor, depthFormatFor, vertexFormatFor, readbackLayout, depadRows } from './webgpuFormats.js';
import { WebGpuTimer } from './WebGpuTimer.js';

/** @typedef {import('./GpuDevice.js').GpuHandle} GpuHandle */

/** Ring size (38.4): MAX_DRAW_ITEMS * 3 + 64 slots of 256 B. */
export const DEFAULT_RING_SLOTS = MAX_DRAW_ITEMS * 3 + 64;
const ZERO4 = [0, 0, 0, 0];

/** The GPU* constant tables, read lazily so this module imports in Node. @returns {{buf: any, tex: any, stage: any, map: any}} */
function globalConsts() {
  const g = /** @type {any} */ (globalThis);
  return { buf: g.GPUBufferUsage, tex: g.GPUTextureUsage, stage: g.GPUShaderStage, map: g.GPUMapMode };
}

export class GpuDeviceWebGPU {
  /**
   * @param {any} gpuDevice a GPUDevice
   * @param {{adapter?: any, canvasFormat?: string, ringSlots?: number, consts?: {buf: any, tex: any, stage: any, map: any}}} [opts]
   */
  constructor(gpuDevice, opts = {}) {
    this.gpu = gpuDevice;
    this.backend = /** @type {'webgpu'} */ ('webgpu');
    this._c = opts.consts || globalConsts();
    this._canvasFormat = opts.canvasFormat || 'bgra8unorm';
    /** @type {any} */ this._context = null;
    /** @type {any} */ this._canvas = null;
    /** Uncaptured validation errors (WebGPU reports them asynchronously); self-test and tests read this. @type {string[]} */
    this.gpuErrors = [];
    if (typeof gpuDevice.addEventListener === 'function') {
      gpuDevice.addEventListener('uncapturederror', (/** @type {any} */ ev) => {
        const msg = String(ev && ev.error && ev.error.message || ev);
        if (this.gpuErrors.length < 20) this.gpuErrors.push(msg);
        if (typeof console !== 'undefined') console.warn('[GpuDeviceWebGPU] ' + msg);
      });
    }
    this._lostInfo = null;
    /** @type {Promise<any>} resolves when the GPUDevice is lost (no restore: reload, 38.3) */
    this.lost = gpuDevice.lost ? gpuDevice.lost.then((/** @type {any} */ info) => { this._lostInfo = info; return info; }) : new Promise(() => {});
    const info = (opts.adapter && (opts.adapter.info || {})) || {};
    this._software = !!(opts.adapter && (opts.adapter.isFallbackAdapter || info.isFallbackAdapter))
      || /swiftshader/i.test(String(info.description || info.device || info.vendor || ''));
    /** WG-1c2: for the F3 backend line */
    this.adapterInfo = { vendor: String(info.vendor || ''), architecture: String(info.architecture || ''), description: String(info.description || ''), fallback: this._software };
    this.timer = new WebGpuTimer(gpuDevice, this._c);
    this._live = /** @type {{destroy: () => void}[]} */ ([]);
    this._moduleCache = new Map();
    // uniform ring (CPU ArrayBuffer + one GPU buffer; one writeBuffer at submit)
    const slots = opts.ringSlots || DEFAULT_RING_SLOTS;
    this.uniformRing = createUniformRing(slots, UNIFORM_SLOT_ALIGN);
    this._ringBuf = gpuDevice.createBuffer({ size: slots * UNIFORM_SLOT_ALIGN, usage: this._c.buf.UNIFORM | this._c.buf.COPY_DST });
    this._live.push(this._ringBuf);
    // frame state
    /** @type {any} */ this._encoder = null;
    /** @type {any} */ this._pass = null;
    /** @type {any} */ this._curPipeline = null;
    this._dyn = [0];
    /** @type {Map<number, any[]>} */ this._staging = new Map();
    this._canvasTarget = null;
  }

  /** WG-1b2: bind the canvas (called by createGpuDevice after adapter/device/self-test succeeded, so a failed webgpu request leaves the canvas free for WebGL2). @param {any} canvas */
  attachCanvas(canvas) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('GpuDeviceWebGPU: canvas.getContext("webgpu") returned null');
    ctx.configure({ device: this.gpu, format: this._canvasFormat, alphaMode: 'opaque', usage: this._c.tex.RENDER_ATTACHMENT | this._c.tex.COPY_SRC });
    this._context = ctx; this._canvas = canvas;
  }

  /** @returns {import('./GpuDevice.js').GpuDeviceCaps} */
  get caps() {
    return { maxColorAttachments: this.gpu.limits ? this.gpu.limits.maxColorAttachments : 4, timerQueries: this.timer.available, softwareRenderer: this._software };
  }

  // ---- resources ---------------------------------------------------------------------------------------------

  /** @param {import('./GpuDevice.js').BufferDesc} desc */
  createBuffer(desc) {
    const c = this._c.buf;
    const usage = (desc.usage === 'vertex' ? c.VERTEX : desc.usage === 'index' ? c.INDEX : c.UNIFORM) | c.COPY_DST;
    const bytes = desc.data ? desc.data.byteLength : (desc.bytes || 0);
    const buf = this.gpu.createBuffer({ size: Math.max(4, (bytes + 3) & ~3), usage });
    this._live.push(buf);
    const h = { kind: 'buffer', gpu: buf, bytes, indexFormat: desc.data instanceof Uint16Array ? 'uint16' : 'uint32' };
    if (desc.data) this.writeBuffer(h, desc.data, 0);
    return h;
  }

  /** @param {GpuHandle} handle @param {ArrayBufferView} data @param {number} [dstOffsetBytes] */
  writeBuffer(handle, data, dstOffsetBytes = 0) {
    let view = data;
    if (data.byteLength & 3) { // queue.writeBuffer wants a multiple of 4: pad (rare: odd Uint16 index counts)
      const padded = new Uint8Array((data.byteLength + 3) & ~3);
      padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      view = padded;
    }
    this.gpu.queue.writeBuffer(handle.gpu, dstOffsetBytes, view.buffer, view.byteOffset, view.byteLength);
  }

  /** @param {import('./GpuDevice.js').TextureDesc} desc */
  createTexture(desc) {
    const t = this._c.tex;
    const f = textureFormatFor(desc.format, !!desc.sampled);
    const tex = this.gpu.createTexture({
      size: [desc.width, desc.height, 1], format: f.gpu, dimension: '2d',
      usage: t.TEXTURE_BINDING | t.RENDER_ATTACHMENT | t.COPY_SRC | t.COPY_DST,
    });
    this._live.push(tex);
    const linear = desc.filter === 'linear' && desc.format === 'rgba8';
    const sampler = desc.format === 'rgba8'
      ? this.gpu.createSampler({ magFilter: linear ? 'linear' : 'nearest', minFilter: linear ? 'linear' : 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
      : null;
    return { kind: 'texture', gpu: tex, view: tex.createView(), sampler, width: desc.width, height: desc.height, format: desc.format, gpuFormat: f.gpu, bpp: f.bpp, isDepth: f.depth };
  }

  /**
   * `rect` defaults to the whole texture; `data` is tightly packed rows of the texture's format.
   * @param {GpuHandle} tex @param {ArrayBufferView} data @param {{x:number,y:number,w:number,h:number}} [rect]
   */
  writeTexture(tex, data, rect) {
    if (tex.isDepth) throw new Error('GpuDeviceWebGPU.writeTexture: depth textures cannot be written');
    // zero-alloc (38.7 / 38.8a 17): the destination/layout/size descriptors live on the texture handle and are mutated
    let wt = tex._wt;
    if (!wt) wt = tex._wt = { dst: { texture: tex.gpu, origin: [0, 0, 0] }, layout: { bytesPerRow: 0, rowsPerImage: 0 }, size: [0, 0, 1] };
    const x = rect ? rect.x : 0, y = rect ? rect.y : 0, w = rect ? rect.w : tex.width, h = rect ? rect.h : tex.height;
    wt.dst.texture = tex.gpu; wt.dst.origin[0] = x; wt.dst.origin[1] = y;
    wt.layout.bytesPerRow = w * tex.bpp; wt.layout.rowsPerImage = h;
    wt.size[0] = w; wt.size[1] = h;
    this.gpu.queue.writeTexture(wt.dst, data, wt.layout, wt.size);
  }

  /** @param {import('./GpuDevice.js').TargetDesc} desc */
  createTarget(desc) {
    const first = desc.color[0] || desc.depth;
    /** @type {any[]} */
    const colorAttachments = desc.color.map((t) => ({ view: t.view, loadOp: 'load', storeOp: 'store', clearValue: ZERO4 }));
    /** @type {any} */
    const pass = { colorAttachments };
    if (desc.depth) pass.depthStencilAttachment = { view: desc.depth.view, depthLoadOp: 'load', depthStoreOp: 'store', depthClearValue: 1 };
    return { kind: 'target', isCanvas: false, passDesc: pass, colorCount: desc.color.length, hasDepth: !!desc.depth, width: first ? first.width : 0, height: first ? first.height : 0 };
  }

  /** WG-1b1 (38.3): resolved to `context.getCurrentTexture()` at beginPass. */
  canvasTarget() {
    if (!this._canvasTarget) {
      const attach = { view: null, loadOp: 'load', storeOp: 'store', clearValue: ZERO4 };
      this._canvasTarget = { kind: 'target', isCanvas: true, passDesc: { colorAttachments: [attach] }, colorCount: 1, hasDepth: false, width: 0, height: 0 };
    }
    return this._canvasTarget;
  }

  /** @param {{wgsl?: string, entry?: string}} src */
  _module(src) {
    if (!src || !src.wgsl) throw new Error('GpuDeviceWebGPU.createPipeline: src.wgsl missing');
    let m = this._moduleCache.get(src.wgsl);
    if (!m) { m = this.gpu.createShaderModule({ code: src.wgsl }); this._moduleCache.set(src.wgsl, m); }
    return m;
  }

  /** @param {import('./GpuDevice.js').PipelineDesc} desc */
  createPipeline(desc) {
    const stage = this._c.stage;
    const bindings = desc.bindings || { uniformBytes: 0, textures: [] };
    const texKinds = bindings.textures || [];
    const vis = stage.VERTEX | stage.FRAGMENT;
    // @group(0): textures (+ samplers of 'filtered' slots)
    /** @type {any[]} */ const e0 = [];
    /** @type {number[]} */ const samplerBinding = [];
    texKinds.forEach((k, i) => {
      if (k === 'uint') e0.push({ binding: i, visibility: vis, texture: { sampleType: 'uint' } });
      else if (k === 'sint') e0.push({ binding: i, visibility: vis, texture: { sampleType: 'sint' } });
      else if (k === 'depth') e0.push({ binding: i, visibility: vis, texture: { sampleType: 'depth' } });
      else if (k === 'filtered') e0.push({ binding: i, visibility: vis, texture: { sampleType: 'float' } });
      else e0.push({ binding: i, visibility: vis, texture: { sampleType: 'unfilterable-float' } }); // 'float': textureLoad only
    });
    texKinds.forEach((k, i) => {
      if (k !== 'filtered') { samplerBinding.push(-1); return; }
      const b = texKinds.length + samplerBinding.filter((x) => x >= 0).length;
      samplerBinding.push(b);
      e0.push({ binding: b, visibility: vis, sampler: { type: 'filtering' } });
    });
    const bgl0 = this.gpu.createBindGroupLayout({ entries: e0 });
    const uBytes = bindings.uniformBytes || 0;
    // group 1 exists only when there is a uniform block: every group in the layout is set before draw (spec)
    const bgl1 = uBytes > 0
      ? this.gpu.createBindGroupLayout({ entries: [{ binding: 0, visibility: vis, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uBytes } }] })
      : null;
    const layout = this.gpu.createPipelineLayout({ bindGroupLayouts: bgl1 ? [bgl0, bgl1] : [bgl0] });
    const uniformGroup = uBytes > 0
      ? this.gpu.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: { buffer: this._ringBuf, offset: 0, size: uBytes } }] })
      : null;

    // vertex buffers: 0 = interleaved mesh buffer, 1 = per-instance buffer
    /** @type {any[]} */ const buffers = [];
    const v = desc.vertex;
    if (v.layout && v.layout.length) {
      buffers.push({ arrayStride: v.strideBytes || 0, stepMode: 'vertex', attributes: v.layout.map((a) => ({ shaderLocation: a.location, offset: a.offsetBytes, format: vertexFormatFor(a.type, a.components) })) });
    }
    if (v.instanceLayout && v.instanceLayout.length) {
      if (!buffers.length) buffers.push({ arrayStride: 0, stepMode: 'vertex', attributes: [] }); // keep instance buffer at slot 1
      buffers.push({ arrayStride: v.instanceStrideBytes || 0, stepMode: 'instance', attributes: v.instanceLayout.map((a) => ({ shaderLocation: a.location, offset: a.offsetBytes, format: vertexFormatFor(a.type, a.components) })) });
    }
    const canvasFmt = this._canvasFormat;
    const targetFormats = (desc.targetFormats || []).map((n) => n === 'canvas' ? canvasFmt : textureFormatFor(n).gpu);
    if (targetFormats.length !== desc.fragment.targets) throw new Error(`GpuDeviceWebGPU.createPipeline: targetFormats (${targetFormats.length}) != fragment.targets (${desc.fragment.targets})`);
    /** @type {any} */
    const pd = {
      layout,
      vertex: { module: this._module(v.src), entryPoint: /** @type {any} */ (v.src).entry || 'vs_main', buffers },
      primitive: { topology: 'triangle-list', frontFace: 'cw', cullMode: desc.cull || 'none' },
    };
    if (targetFormats.length) pd.fragment = { module: this._module(desc.fragment.src), entryPoint: /** @type {any} */ (desc.fragment.src).entry || 'fs_main', targets: targetFormats.map((format) => ({ format })) };
    if (desc.depthFormat) {
      const d = desc.depth || { test: false, write: false };
      pd.depthStencil = { format: depthFormatFor(desc.depthFormat), depthWriteEnabled: !!d.write, depthCompare: d.test ? 'less' : 'always' };
      if (desc.depthBias) { pd.depthStencil.depthBias = desc.depthBias.units; pd.depthStencil.depthBiasSlopeScale = desc.depthBias.factor; }
    }
    const gpu = this.gpu.createRenderPipeline(pd);
    return {
      kind: 'pipeline', gpu, bgl0, uniformGroup, uniformBytes: uBytes, texKinds, samplerBinding,
      texCur: new Array(texKinds.length).fill(null), texGroup: null, texDirty: texKinds.length > 0, indexed: false,
    };
  }

  // ---- frame -------------------------------------------------------------------------------------------------

  /** @param {GpuHandle} target @param {import('./GpuDevice.js').PassDesc} [opts] */
  beginPass(target, opts) {
    if (this._pass) throw new Error('GpuDeviceWebGPU.beginPass: previous pass not ended');
    if (!this._encoder) this._encoder = this.gpu.createCommandEncoder();
    const pd = target.passDesc;
    const att = pd.colorAttachments;
    if (target.isCanvas) {
      if (!this._context) throw new Error('GpuDeviceWebGPU.canvasTarget: no canvas attached');
      att[0].view = this._context.getCurrentTexture().createView();
    }
    const clear = opts && opts.clear;
    const colorClear = clear && clear !== true ? clear.color : null;
    for (let i = 0; i < att.length; i++) {
      att[i].loadOp = clear ? 'clear' : 'load';
      att[i].clearValue = (colorClear && colorClear[i]) || ZERO4;
    }
    const ds = pd.depthStencilAttachment;
    if (ds) {
      ds.depthLoadOp = clear ? 'clear' : 'load';
      ds.depthClearValue = clear === true || !clear ? 1 : (clear.depth != null ? clear.depth : 1);
    }
    this.timer.attach(pd);
    this._pass = this._encoder.beginRenderPass(pd);
    this._curPipeline = null;
    this._boundTarget = target;
  }

  /** @param {GpuHandle} pipeline @param {import('./GpuDevice.js').BindDesc} desc */
  bind(pipeline, desc) {
    const pass = this._pass;
    if (!pass) throw new Error('GpuDeviceWebGPU.bind: no open pass');
    const p = pipeline;
    if (p !== this._curPipeline) {
      pass.setPipeline(p.gpu); this._curPipeline = p;
      if (p.texKinds.length === 0) pass.setBindGroup(0, this._emptyGroup()); // group 0 is in the layout: always set
    }
    // textures: rebuild the cached bind group only when a handle differs (element-wise compare, no alloc)
    const texs = desc.textures;
    if (texs) {
      for (let i = 0; i < texs.length; i++) {
        const s = texs[i].slot;
        if (p.texCur[s] !== texs[i].texture) { p.texCur[s] = texs[i].texture; p.texDirty = true; }
      }
    }
    if (p.texKinds.length > 0) {
      if (p.texDirty) this._buildTexGroup(p);
      pass.setBindGroup(0, p.texGroup);
    }
    // uniforms: caller-allocated ring slot (uniformOffsetBytes) or alloc + copy `uniforms` here
    if (p.uniformGroup) {
      const ring = this.uniformRing;
      let off = desc.uniformOffsetBytes;
      if (off === undefined) {
        if (!desc.uniforms) throw new Error('GpuDeviceWebGPU.bind: pipeline has a uniform block but BindDesc has neither uniforms nor uniformOffsetBytes');
        off = ring.alloc(p.uniformBytes);
      }
      if (desc.uniforms) {
        const u = desc.uniforms;
        if (u.byteLength > p.uniformBytes) throw new Error(`GpuDeviceWebGPU.bind: uniforms ${u.byteLength} B > block ${p.uniformBytes} B`);
        (u instanceof Int32Array ? ring.i32 : ring.f32).set(/** @type {any} */ (u), off >> 2);
      }
      this._dyn[0] = off;
      pass.setBindGroup(1, p.uniformGroup, this._dyn);
    }
    if (desc.vertexBuffer) pass.setVertexBuffer(0, desc.vertexBuffer.gpu);
    if (desc.instanceBuffer) pass.setVertexBuffer(1, desc.instanceBuffer.gpu);
    if (desc.indexBuffer) { pass.setIndexBuffer(desc.indexBuffer.gpu, desc.indexBuffer.indexFormat); p.indexed = true; }
    else if (desc.vertexBuffer) p.indexed = false;
  }

  /** Device-level cached empty bind group for pipelines without textures. */
  _emptyGroup() {
    if (!this._emptyBG) this._emptyBG = this.gpu.createBindGroup({ layout: this.gpu.createBindGroupLayout({ entries: [] }), entries: [] });
    return this._emptyBG;
  }

  /** @param {any} p */
  _buildTexGroup(p) {
    /** @type {any[]} */ const entries = [];
    for (let i = 0; i < p.texKinds.length; i++) {
      const t = p.texCur[i];
      if (!t) throw new Error(`GpuDeviceWebGPU.bind: texture slot ${i} not bound`);
      entries.push({ binding: i, resource: t.view });
      if (p.samplerBinding[i] >= 0) entries.push({ binding: p.samplerBinding[i], resource: t.sampler });
    }
    p.texGroup = this.gpu.createBindGroup({ layout: p.bgl0, entries });
    p.texDirty = false;
  }

  /** @param {number} count @param {number} [first] @param {number} [instances] */
  draw(count, first = 0, instances = 1) {
    const p = this._curPipeline;
    if (p && p.indexed) this._pass.drawIndexed(count, instances, first, 0, 0);
    else this._pass.draw(count, instances, first, 0);
  }

  endPass() {
    if (!this._pass) throw new Error('GpuDeviceWebGPU.endPass: no open pass');
    this._pass.end();
    this._pass = null; this._curPipeline = null; this._boundTarget = null;
  }

  /** End of frame: one ring `writeBuffer` of the used range, then `queue.submit` (38.4). */
  submit() {
    if (this._pass) throw new Error('GpuDeviceWebGPU.submit: a pass is still open');
    const ring = this.uniformRing;
    if (ring.usedBytes > 0) this.gpu.queue.writeBuffer(this._ringBuf, 0, ring.buffer, 0, ring.usedBytes);
    ring.reset();
    if (this._encoder) {
      const timing = this.timer.resolve(this._encoder);
      this.gpu.queue.submit([this._encoder.finish()]); this._encoder = null;
      this.timer.collect(timing);
    } else this.timer.resolve(null);
  }

  /**
   * Test-only, always a Promise (38.6): records `copyTextureToBuffer` (rows padded to 256 B) into the current
   * encoder, submits it (so the result is fixed at call time), maps the staging buffer and de-pads into `out`.
   * @param {GpuHandle} tex @param {{x:number,y:number,w:number,h:number}} rect @param {ArrayBufferView} out
   * @returns {Promise<void>}
   */
  async readback(tex, rect, out) {
    if (this._pass) throw new Error('GpuDeviceWebGPU.readback: a pass is still open');
    if (tex.gpuFormat === 'depth24plus') throw new Error('GpuDeviceWebGPU.readback: depth24plus is not copyable (use a sampled depth texture)');
    const lay = readbackLayout(rect.w, rect.h, tex.bpp);
    let pool = this._staging.get(lay.bufferBytes);
    if (!pool) { pool = []; this._staging.set(lay.bufferBytes, pool); }
    const staging = pool.pop() || this.gpu.createBuffer({ size: lay.bufferBytes, usage: this._c.buf.MAP_READ | this._c.buf.COPY_DST });
    if (!this._encoder) this._encoder = this.gpu.createCommandEncoder();
    this._encoder.copyTextureToBuffer(
      { texture: tex.gpu, origin: [rect.x, rect.y, 0], aspect: tex.isDepth ? 'depth-only' : 'all' },
      { buffer: staging, bytesPerRow: lay.paddedRowBytes, rowsPerImage: rect.h }, [rect.w, rect.h, 1]);
    this.submit();
    try {
      await staging.mapAsync(this._c.map.READ);
      depadRows(new Uint8Array(staging.getMappedRange()), lay.paddedRowBytes, lay.rowBytes, rect.h, out);
      staging.unmap();
    } finally { pool.push(staging); }
  }

  /**
   * WG-2a (38.8a item 18): async validation check. WebGPU reports shader/pipeline/resource errors asynchronously (no
   * throw): a validation error scope round-trip flushes everything recorded so far, then the uncaptured-error list
   * (filled by the 'uncapturederror' listener) is returned. Empty array = no error since device creation.
   * @returns {Promise<string[]>}
   */
  async checkErrors() {
    const g = this.gpu;
    if (g.pushErrorScope) {
      g.pushErrorScope('validation');
      try { if (g.queue && g.queue.onSubmittedWorkDone) await g.queue.onSubmittedWorkDone(); } catch (_) { /* surfaced via the scope below */ }
      const e = await g.popErrorScope();
      if (e) this.gpuErrors.push(String(e.message || e));
    }
    return this.gpuErrors.slice();
  }

  /** @param {GpuHandle} [handle] */
  dispose(handle) {
    if (handle) {
      const o = handle.gpu;
      const i = this._live.indexOf(o);
      if (i >= 0) { this._live.splice(i, 1); o.destroy(); }
      return;
    }
    this.timer.dispose();
    for (const o of this._live) o.destroy();
    this._live.length = 0;
    for (const pool of this._staging.values()) for (const b of pool) b.destroy();
    this._staging.clear();
  }
}
