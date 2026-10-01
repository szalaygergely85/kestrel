// @ts-check
// engine/render/gpu/device/GpuDeviceGL2.js - ME-03b. The WebGL2
// implementation of GpuDevice.js's shape: wraps glUtil.js/gridTargets.js's
// helpers and GpuTimer.js so ME-04+ code (MeshBuffers.js, GpuCellPipeline's
// `_passRaster`) never calls `gl.*` directly (check-deps rule 9,
// tools/check-deps.mjs). No behaviour change (27.11 ME-03b AC): this file
// creates NEW resources for the mesh raster pass; it does not touch or wrap
// the pre-existing per-pass textures/FBOs gridTargets.js already owns (the
// dda/terrain/voxel path keeps calling `gl.*` directly, unchanged, until
// ME-19 - see check-deps.mjs's WARN rule 9 and its own header comment).
//
// Scope kept small on purpose (27.13 risk 8: "if > ~15 functions or > 300
// lines of indirection, cut features, not the rule"): `createTarget` only
// supports attaching EXISTING textures (no implicit texture creation);
// `bind()` takes a resolved uniform view + a small fixed texture-slot list
// (no per-frame descriptor objects, 27.2); `createPipeline`'s vertex
// `layout` maps 1:1 to `vertexAttribPointer`/`vertexAttribIPointer` calls
// against ONE interleaved vertex buffer (the only shape ME-04 needs).
import { compileShader, createTexture2D, deleteTexture2D, createFramebuffer2D, deleteFramebuffer2D, formatFor as glUtilFormatFor } from '../glUtil.js';
import { GpuPassTimer } from '../GpuTimer.js';

/** @typedef {import('./GpuDevice.js').BufferDesc} BufferDesc */
/** @typedef {import('./GpuDevice.js').TextureDesc} TextureDesc */
/** @typedef {import('./GpuDevice.js').TargetDesc} TargetDesc */
/** @typedef {import('./GpuDevice.js').PipelineDesc} PipelineDesc */
/** @typedef {import('./GpuDevice.js').PassDesc} PassDesc */
/** @typedef {import('./GpuDevice.js').BindDesc} BindDesc */
/** @typedef {import('./GpuDevice.js').GpuHandle} GpuHandle */

const USAGE_TO_GL_TARGET = { vertex: 'ARRAY_BUFFER', index: 'ELEMENT_ARRAY_BUFFER', uniform: 'ARRAY_BUFFER' };

/** `TextureDesc.format` -> a WebGL2 `internalFormat` GLenum name, resolved against a live `gl` (constants are instance properties, not statics). */
function glInternalFormat(gl, format) {
  switch (format) {
    case 'rgba32ui': return gl.RGBA32UI;
    case 'r32ui': return gl.R32UI;
    case 'rgba8': return gl.RGBA8;
    case 'r8ui': return gl.R8UI;
    case 'depth24': return gl.DEPTH_COMPONENT24;
    default: throw new Error(`GpuDeviceGL2.createTexture: unhandled format "${format}"`);
  }
}

// Implements the GpuDevice.js shape (GPU_DEVICE_METHODS) - not declared via
// JSDoc `@implements` because tsc's JSDoc parser rejects an inline
// `import('./GpuDevice.js').GpuDevice` reference there; GpuDevice.test.js
// and GpuDeviceGL2.test.js both assert the method list matches instead.
// beginPass clear scratch (no per-frame allocation)
const ZERO4 = new Uint32Array(4); // never written (typed arrays cannot be frozen)
const _depthClear = new Float32Array(1);

export class GpuDeviceGL2 {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    // Tracked as {obj, free} pairs (not `instanceof WebGLBuffer` etc.) so
    // `dispose()` never references a browser-only global - GpuDeviceGL2.
    // test.js exercises this class against a plain fake `gl` object in
    // Node, where WebGLBuffer/WebGLTexture/... do not exist.
    /** @type {{obj: any, free: (gl: WebGL2RenderingContext, obj: any) => void}[]} */
    this._live = [];
    this._passTimer = new GpuPassTimer(gl, 8);
    this._activeSlot = -1;
    this._boundPipeline = null;
    this._boundTarget = null;
    this.timer = {
      begin: (slot) => { this._activeSlot = slot; this._passTimer.begin(slot); },
      end: () => { this._passTimer.end(); this._activeSlot = -1; },
    };
  }

  /** @returns {import('./GpuDevice.js').GpuDeviceCaps} */
  get caps() {
    const gl = this.gl;
    return {
      maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
      timerQueries: this._passTimer.available,
      softwareRenderer: false, // caller (GpuCellPipeline) already probes this once via isSoftwareRenderer(gl)
    };
  }

  /** @param {BufferDesc} desc */
  createBuffer(desc) {
    const gl = this.gl;
    const target = gl[USAGE_TO_GL_TARGET[desc.usage]];
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    if (desc.data) gl.bufferData(target, desc.data, gl.STATIC_DRAW);
    else gl.bufferData(target, desc.bytes || 0, gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    this._live.push({ obj: buf, free: (g, o) => g.deleteBuffer(o) });
    return { kind: 'buffer', glTarget: target, handle: buf };
  }

  /** @param {TextureDesc} desc */
  createTexture(desc) {
    const gl = this.gl;
    if (desc.format === 'depth24' && desc.sampled) {
      // ME-15b (27.9a item 7): a sampled depth texture (the sun shadow map). NEAREST + compare mode NONE
      // (createTexture2D sets NEAREST/CLAMP); read with texelFetch on a plain sampler2D (.r) - never a
      // hardware compare (parity: manual fetch + explicit compare in both twins).
      const tex = createTexture2D(gl, gl.DEPTH_COMPONENT24, desc.width, desc.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
      this._live.push({ obj: tex, free: (g, o) => deleteTexture2D(g, o) });
      return { kind: 'texture', handle: tex, width: desc.width, height: desc.height, format: 'depth24' };
    }
    if (desc.format === 'depth24') {
      // Depth attachments are renderbuffers here (never sampled by another
      // pass in phase 1 - the raster pass only needs a real HW z-test
      // between its own triangles; readback()/texture sampling of depth is
      // not part of this story's scope).
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, desc.width, desc.height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      this._live.push({ obj: rb, free: (g, o) => g.deleteRenderbuffer(o) });
      return { kind: 'renderbuffer', handle: rb, width: desc.width, height: desc.height };
    }
    const internalFormat = glInternalFormat(gl, desc.format);
    const tex = createTexture2D(gl, internalFormat, desc.width, desc.height);
    this._live.push({ obj: tex, free: (g, o) => deleteTexture2D(g, o) });
    return { kind: 'texture', handle: tex, width: desc.width, height: desc.height, format: desc.format };
  }

  /** @param {TargetDesc} desc */
  createTarget(desc) {
    const gl = this.gl;
    const fbo = createFramebuffer2D(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const drawBuffers = [];
    for (let i = 0; i < desc.color.length; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, desc.color[i].handle, 0);
      drawBuffers.push(gl.COLOR_ATTACHMENT0 + i);
    }
    // Depth-only target (`color: []`, ME-15b): no draw/read buffer.
    if (drawBuffers.length === 0) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); } else gl.drawBuffers(drawBuffers);
    if (desc.depth) {
      if (desc.depth.kind === 'renderbuffer') {
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, desc.depth.handle);
      } else {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, desc.depth.handle, 0);
      }
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`GpuDeviceGL2.createTarget: incomplete FBO (status ${status})`);
    this._live.push({ obj: fbo, free: (g, o) => deleteFramebuffer2D(g, o) });
    const first = desc.color[0] || desc.depth;
    return { kind: 'target', handle: fbo, colorCount: desc.color.length, hasDepth: !!desc.depth, width: first ? first.width : 0, height: first ? first.height : 0 };
  }

  /** @param {PipelineDesc} desc */
  createPipeline(desc) {
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, desc.vertex.src.glsl);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, desc.fragment.src.glsl);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('GpuDeviceGL2.createPipeline: link failed: ' + info);
    }
    const vao = gl.createVertexArray();
    this._live.push({ obj: program, free: (g, o) => g.deleteProgram(o) });
    this._live.push({ obj: vao, free: (g, o) => g.deleteVertexArray(o) });
    // Uniform locations resolved once here (27.2: "no string keys in bind()
    // on the hot path") - `bind()` only ever indexes this array.
    const uniformLoc = gl.getUniformLocation(program, 'uBlock0') || null;
    return {
      kind: 'pipeline', program, vao,
      layout: desc.vertex.layout || [], strideBytes: desc.vertex.strideBytes || 0,
      depth: desc.depth || { test: false, write: false },
      cull: desc.cull || 'none',
      depthBias: desc.depthBias || null,
      uniformLoc,
    };
  }

  /** @param {GpuHandle} target @param {PassDesc} [opts] */
  beginPass(target, opts) {
    const gl = this.gl;
    this._boundTarget = target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.handle);
    if (target.width > 0) gl.viewport(0, 0, target.width, target.height);
    if (opts && opts.clear) {
      if (target.hasDepth) gl.depthMask(true); // a masked depth write also masks the clear
      if (target.colorCount > 0) {
        const colorClear = opts.clear === true ? null : opts.clear.color;
        for (let i = 0; i < target.colorCount; i++) {
          gl.clearBufferuiv(gl.COLOR, i, (colorClear && colorClear[i]) || ZERO4);
        }
      }
      if (target.hasDepth) {
        _depthClear[0] = opts.clear === true ? 1 : (opts.clear.depth != null ? opts.clear.depth : 1);
        gl.clearBufferfv(gl.DEPTH, 0, _depthClear);
      }
    }
  }

  /** @param {GpuHandle} pipeline @param {BindDesc} desc */
  bind(pipeline, desc) {
    const gl = this.gl;
    this._boundPipeline = pipeline;
    gl.useProgram(pipeline.program);
    gl.bindVertexArray(pipeline.vao);
    if (pipeline.depth.test) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); } else { gl.disable(gl.DEPTH_TEST); }
    gl.depthMask(!!pipeline.depth.write);
    if (pipeline.depthBias) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(pipeline.depthBias.factor, pipeline.depthBias.units); } else gl.disable(gl.POLYGON_OFFSET_FILL);
    if (pipeline.cull === 'none') gl.disable(gl.CULL_FACE);
    else { gl.enable(gl.CULL_FACE); gl.cullFace(pipeline.cull === 'back' ? gl.BACK : gl.FRONT); }

    if (desc.vertexBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, desc.vertexBuffer.handle);
      for (const attr of pipeline.layout) {
        gl.enableVertexAttribArray(attr.location);
        if (attr.type === 'uint') {
          gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, pipeline.strideBytes, attr.offsetBytes);
        } else {
          gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, pipeline.strideBytes, attr.offsetBytes);
        }
      }
    }
    if (desc.indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, desc.indexBuffer.handle);

    if (desc.uniforms) this._bindUniformView(pipeline, desc.uniforms);
    if (desc.textures) {
      for (const t of desc.textures) {
        gl.activeTexture(gl.TEXTURE0 + t.slot);
        gl.bindTexture(gl.TEXTURE_2D, t.texture.handle);
      }
    }
  }

  /**
   * ME-04's own pipelines set uniforms with plain named `gl.uniformXf/i`
   * calls right after `bind()` (same pattern every existing pass in
   * GpuCellPipeline.js already uses) rather than through this generic path -
   * `desc.uniforms` (27.2's "one Float32Array/Int32Array per pipeline") is
   * accepted for forward-compatibility with a future WebGPU-style uniform
   * buffer but is a no-op today; kept as a documented seam, not dead code
   * removed, so ME-31 (WGSL) has a real slot to fill in.
   */
  _bindUniformView(pipeline, view) { /* seam for a future uniform-buffer upload; unused in phase 1 */ }

  /** @param {number} count @param {number} [first] */
  draw(count, first = 0) {
    this.gl.drawArrays(this.gl.TRIANGLES, first, count);
  }

  endPass() {
    if (this._boundPipeline && this._boundPipeline.depthBias) this.gl.disable(this.gl.POLYGON_OFFSET_FILL);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this._boundTarget = null;
  }

  /** Test-only synchronous readback. @param {GpuHandle} tex */
  readback(tex, rect, out) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.handle, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const { format, type } = glUtilFormatFor(gl, glInternalFormat(gl, tex.format));
    gl.readPixels(rect.x, rect.y, rect.w, rect.h, format, type, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  }

  /**
   * Two call shapes, matching the Node mock (engine/test/assert.js's
   * `makeMockGpuDevice`): `dispose()` (no argument) frees every resource
   * this device ever created (context loss / whole-pipeline teardown);
   * `dispose(handle)` frees just that one (MeshBuffers.js's own eviction on
   * a mesh version bump, and its own `dispose()` looping per cached entry -
   * neither wants to tear down every OTHER cached mesh's buffer too).
   * @param {import('./GpuDevice.js').GpuHandle} [handle]
   */
  dispose(handle) {
    const gl = this.gl;
    if (handle) {
      const idx = this._live.findIndex((e) => e.obj === handle.handle);
      if (idx >= 0) { this._live[idx].free(gl, handle.handle); this._live.splice(idx, 1); }
      return;
    }
    this._passTimer.dispose();
    for (const { obj, free } of this._live) free(gl, obj);
    this._live.length = 0;
  }
}
