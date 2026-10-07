// @ts-check
// engine/render/gpu/device/GpuDevice.js - ME-03b (docs/backlog.md, ME-03b
// row; docs/architecture.md 27.2 "GpuDevice shape (normative for ME-04)",
// 27.11 ME-03b row, 27.13 risk 8). The one thin backend interface every GPU
// resource/draw goes through from ME-04 on (D-029 item 9: "WebGL2
// everywhere, WebGPU where available") - this file is the JSDoc-typed
// SHAPE only (no backend logic: that's GpuDeviceGL2.js, the WebGL2
// implementation, and later GpuDeviceWebGPU.js, phase 4). A mock
// implementation for Node tests lives in engine/test/assert.js
// (`makeMockGpuDevice`) so ME-04+ modules (MeshBuffers.js, the raster pass)
// can be unit-tested without a real GL context.
//
// Rules (27.2, 27.13 risk 8): resources are OPAQUE handles; every descriptor
// is a plain JSON-safe object (no GLenums, no GPU* objects leak out of
// device/*); no per-frame descriptor objects (build once, reuse); no string
// keys in `bind()` on the hot path (a real implementation resolves them at
// `createPipeline` time); no backend enum outside device/*. Keep this
// interface small - if a real implementation needs > ~15 functions or
// > 300 lines of indirection, that is a "cut features, not the rule" signal
// (27.13 risk 8), not a reason to grow this file.

/**
 * @typedef {Object} BufferDesc
 * @property {'vertex'|'index'|'uniform'} usage
 * @property {number} [bytes] - allocate this many bytes, uninitialised (mutually exclusive with `data`)
 * @property {ArrayBufferView} [data] - allocate + upload this data (mutually exclusive with `bytes`)
 * @property {boolean} [dynamic] - CLOTH-1b2: the buffer is rewritten via `writeBuffer` (GL2: DYNAMIC_DRAW instead of STATIC_DRAW)
 */

/**
 * @typedef {Object} TextureDesc
 * @property {'rgba32ui'|'r32ui'|'rgba8'|'depth24'|'r8ui'} format
 * @property {number} width
 * @property {number} height
 * @property {number} [layers] - reserved (cube/array textures, phase 3); omit for a plain 2D texture
 * @property {boolean} [sampled] - `depth24` only (ME-15b, 27.9a item 7): a real texture (NEAREST, compare mode NONE, `texelFetch` on a `sampler2D`) instead of the default write-only renderbuffer
 * @property {'nearest'|'linear'} [filter] - WG-1b1 (38.3): `rgba8` only (glyph atlas); default 'nearest'. Integer/depth textures are never filtered
 */

/**
 * @typedef {Object} TargetDesc
 * @property {GpuHandle[]} color - texture handles (createTexture results), draw-buffer order; `[]` = depth-only target (ME-15b: draw buffers NONE)
 * @property {GpuHandle} [depth] - a `depth24` texture handle, or omitted for no depth attachment
 */

/**
 * @typedef {Object} PipelineStageDesc
 * @property {{glsl?: string, wgsl?: string}} src - GL2 reads `glsl`, WebGPU reads `wgsl` (38.3)
 * @property {{name: string, location: number, components: number, type: 'float'|'uint', offsetBytes: number}[]} [layout] - vertex stage only: interleaved-buffer attribute layout (stride is implicit: the caller's own upload stride)
 * @property {number} [strideBytes] - vertex stage only: interleaved-buffer stride
 * @property {{name: string, location: number, components: number, type: 'float'|'uint', offsetBytes: number}[]} [instanceLayout] - WG-1b1 (38.3, MESH-INST-01 batches): per-instance attributes read from `BindDesc.instanceBuffer` (step mode instance)
 * @property {number} [instanceStrideBytes] - stride of the instance buffer
 */

/**
 * @typedef {Object} PipelineDesc
 * @property {PipelineStageDesc} vertex
 * @property {{src: {glsl?: string, wgsl?: string}, targets: number}} fragment - `targets` = number of colour draw buffers written (0 = depth-only, ME-15b)
 * @property {{test: boolean, write: boolean}} [depth]
 * @property {'none'|'back'|'front'} [cull]
 * @property {{factor: number, units: number}} [depthBias] - ME-15b (27.9a item 7): polygon offset (GL2: `POLYGON_OFFSET_FILL` enabled on bind, disabled again by `endPass`); no hardware depth compare is ever used
 * @property {{uniformBytes: number, textures: ('uint'|'sint'|'float'|'depth'|'filtered')[]}} [bindings] - WG-1b1 (38.3/38.4): explicit WebGPU bind layout (`@group(0)` textures in slot order, `@group(1)` one dynamic-offset uniform block of `uniformBytes`); GL2 ignores it
 * @property {string[]} [targetFormats] - WG-1b1: colour attachment formats (TextureDesc names, or 'canvas'); GL2 ignores it
 * @property {'depth24'|'depth32f'} [depthFormat] - WG-1b1: depth attachment format; GL2 ignores it
 */

/**
 * @typedef {Object} PassDesc
 * @property {boolean|{color?: (number[]|null)[], depth?: number}} [clear] - `true` = clear every attachment to its format's zero/1.0 default; an object clears only the given slots to the given values (color slots as 4-tuples matching the attachment's component type; `depth` a float in [0,1])
 */

/**
 * @typedef {Object} BindDesc
 * @property {Float32Array|Int32Array} [uniforms] - one flat view per pipeline (27.2: "one Float32Array/Int32Array per pipeline, uploaded whole")
 * @property {{slot: number, texture: GpuHandle}[]} [textures]
 * @property {GpuHandle} [vertexBuffer]
 * @property {GpuHandle} [indexBuffer]
 * @property {GpuHandle} [instanceBuffer] - WG-1b1 (38.3): per-instance vertex buffer for `PipelineStageDesc.instanceLayout`
 * @property {number} [uniformOffsetBytes] - WG-1b1 (38.4): dynamic offset of this draw's block in the uniform ring (WebGPU; GL2 ignores)
 */

/** Opaque handle - never inspected outside device/* (27.2). @typedef {Object} GpuHandle */

/**
 * @typedef {Object} GpuDeviceCaps
 * @property {number} maxColorAttachments
 * @property {boolean} timerQueries
 * @property {boolean} softwareRenderer
 */

/** WG-1b1 (38.3): `createGpuDevice` opts. Implemented in WG-1b2 (device/createGpuDevice.js); declared here so callers type against one shape. @typedef {{backend: 'webgl2'|'webgpu', canvas: any}} CreateGpuDeviceOpts */
/** `async createGpuDevice(opts) -> Promise<GpuDevice>` (WebGPU init is async). @typedef {(opts: CreateGpuDeviceOpts) => Promise<GpuDevice>} CreateGpuDevice */

/**
 * @typedef {Object} GpuDeviceTimer
 * @property {(slot: number) => void} begin
 * @property {() => void} end
 */

/**
 * The normative shape (27.2). A real implementation (GpuDeviceGL2, the Node
 * mock) does not have to literally implement this class - it just has to
 * expose the same method names with the same call contract; this class
 * exists so `instanceof`/shape-assertions have one canonical list
 * (`GPU_DEVICE_METHODS` below) and so the JSDoc typedefs above have one home.
 * @abstract
 */
export class GpuDevice {
  /** @param {BufferDesc} desc @returns {GpuHandle} */
  createBuffer(desc) { throw new Error('GpuDevice.createBuffer: not implemented'); }
  /** @param {TextureDesc} desc @returns {GpuHandle} */
  createTexture(desc) { throw new Error('GpuDevice.createTexture: not implemented'); }
  /** @param {TargetDesc} desc @returns {GpuHandle} */
  createTarget(desc) { throw new Error('GpuDevice.createTarget: not implemented'); }
  /** @param {PipelineDesc} desc @returns {GpuHandle} */
  createPipeline(desc) { throw new Error('GpuDevice.createPipeline: not implemented'); }
  /**
   * CLOTH-1b2 (33.5): overwrite `data.byteLength` bytes of an existing buffer starting at `dstOffsetBytes` (WebGPU
   * `queue.writeBuffer`; GL2 `bufferSubData`). Never allocates a new buffer: callers upload only when their data changed.
   * @param {GpuHandle} handle @param {ArrayBufferView} data @param {number} [dstOffsetBytes]
   */
  writeBuffer(handle, data, dstOffsetBytes) { throw new Error('GpuDevice.writeBuffer: not implemented'); }
  /** @param {GpuHandle} target @param {PassDesc} [opts] */
  beginPass(target, opts) { throw new Error('GpuDevice.beginPass: not implemented'); }
  /** @param {GpuHandle} pipeline @param {BindDesc} desc */
  bind(pipeline, desc) { throw new Error('GpuDevice.bind: not implemented'); }
  /** @param {number} count @param {number} [first] @param {number} [instances] */
  draw(count, first, instances) { throw new Error('GpuDevice.draw: not implemented'); }
  endPass() { throw new Error('GpuDevice.endPass: not implemented'); }
  /**
   * WG-1b1 (38.3): upload `data` into (a rect of) an existing texture (GL2 `texSubImage2D`; WebGPU `queue.writeTexture`).
   * `rect` defaults to the whole texture; `data` is tightly packed rows of the texture's format.
   * @param {GpuHandle} tex @param {ArrayBufferView} data @param {{x:number,y:number,w:number,h:number}} [rect]
   */
  writeTexture(tex, data, rect) { throw new Error('GpuDevice.writeTexture: not implemented'); }
  /** WG-1b1 (38.3): a target handle resolved to the canvas back buffer at `beginPass` (GL2: the default framebuffer). @returns {GpuHandle} */
  canvasTarget() { throw new Error('GpuDevice.canvasTarget: not implemented'); }
  /** WG-1b1 (38.3): end of frame (WebGPU: one uniform-ring `writeBuffer` + `queue.submit`; GL2: no-op). */
  submit() { throw new Error('GpuDevice.submit: not implemented'); }
  /**
   * Test-only. WG-1b1: MAY return a Promise (WebGPU: always; GL2/mock: plain return) - callers always `await` it.
   * @param {GpuHandle} tex @param {{x:number,y:number,w:number,h:number}} rect @param {ArrayBufferView} out
   * @returns {void|Promise<void>}
   */
  readback(tex, rect, out) { throw new Error('GpuDevice.readback: not implemented'); }
  // WG-4a-LATER (38.3, typedef only, NOT in GPU_DEVICE_METHODS yet): createBuffer({usage:'storage'|'indirect'}),
  // createComputePipeline(desc), dispatch(x, y, z), drawIndirect(buffer, offsetBytes).
  /** @returns {Promise<any>} WG-1b1: resolves when the device is lost (WebGPU); never resolves on GL2/mock. */
  get lost() { throw new Error('GpuDevice.lost: not implemented'); }
  /** @returns {'webgl2'|'webgpu'} WG-1b1: read only by createRenderer.js and the F3 overlay (38.1). */
  get backend() { throw new Error('GpuDevice.backend: not implemented'); }
  /** @returns {GpuDeviceTimer} */
  get timer() { throw new Error('GpuDevice.timer: not implemented'); }
  /** @returns {GpuDeviceCaps} */
  get caps() { throw new Error('GpuDevice.caps: not implemented'); }
  /**
   * `dispose()` (no argument) frees every resource this device created
   * (context loss / whole-pipeline teardown); `dispose(handle)` frees just
   * that one (MeshBuffers.js's own per-mesh eviction).
   * @param {GpuHandle} [handle]
   */
  dispose(handle) { throw new Error('GpuDevice.dispose: not implemented'); }
}

/**
 * Every method name a conforming device must expose (used by shape-assertion
 * tests on both the mock and GpuDeviceGL2 - 27.11 ME-03b AC "mock-device
 * tests"). `timer`/`caps` are getters, not called methods, so they are kept
 * out of this list; callers check `typeof device.timer === 'object'` etc.
 * separately.
 */
export const GPU_DEVICE_METHODS = Object.freeze([
  'createBuffer', 'writeBuffer', 'createTexture', 'createTarget', 'createPipeline',
  'beginPass', 'bind', 'draw', 'endPass', 'readback', 'dispose',
  'writeTexture', 'canvasTarget', 'submit', // WG-1b1 (38.3)
]);
