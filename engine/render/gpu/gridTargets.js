// US-038a (docs/architecture.md 22.4, D-025): the testable core of a grid
// resize. Owns creation/deletion of every GRID-SIZED texture + FBO
// `GpuCellPipeline` needs (architecture.md 22.3's resource table) - pulled
// out of `GpuCellPipeline._initGL` so a plain Node test can exercise the
// alloc/free pair with a counting mock `gl` (no real WebGL2 context - see
// `gridTargets.test.js`) without dragging in shader compilation.
//
// `allocGridTargets` does NOT touch `fboFinal`'s own textures (those are
// `outFgTex`/`outBgTex` - the RenderTarget's OWN fg/bg, already (re)created
// by `RenderTargetGL.setGrid` by the time this runs - see architecture.md
// 22.6's apply order: "rt goes first"). Every other texture/FBO here is
// owned by the pipeline itself and is safe to delete/recreate in isolation.
//
// Not exported: `cols`/`rows`/`rays`/`subCols`/`subRows` bookkeeping stays
// the caller's job (GpuCellPipeline already tracks those) - this file only
// allocates/frees the GL objects.

import { createTexture2D, createFramebuffer2D, deleteTexture2D, deleteFramebuffer2D, glCounts } from './glUtil.js';

// Field names of every grid-sized TEXTURE this module owns (used by both
// `allocGridTargets` and `freeGridTargets`, and by `GpuCellPipeline.
// resizeGrid`'s old-texture -> new-texture remap - see its own comment).
export const GRID_TEXTURE_FIELDS = Object.freeze([
  'texGI', 'texGA', 'texGD', 'texDepth',
  'texSGI', 'texSGA', 'texSDepth',
  'texSGI2', 'texSGA2', 'texSDepth2',
  'texMask', 'texLight', 'texShadeFg', 'texShadeBg',
]);

const GRID_FBO_FIELDS = Object.freeze([
  'fboCastSub', 'fboTerrainSub', 'fboCast', 'fboDeriv', 'fboLight', 'fboShade', 'fboFinal',
  'fboRasterSub',
]);

// ME-04 (docs/backlog.md, docs/architecture.md 27.4 MRT, 27.11 ME-04 row):
// the raster pass' own real hardware depth attachment (a triangle
// rasteriser needs a genuine per-fragment z-test between overlapping
// triangles - the DDA/terrain/voxel passes never did, so they never needed
// one). Sub-sample sized (`subCols x subRows`), a RENDERBUFFER (never
// sampled by another pass in phase 1 - `readback()`/texture sampling of
// depth is out of scope, GpuDeviceGL2.js's own comment). `fboRasterSub`
// (below) reuses the SAME `texSGI`/`texSGA`/`texSDepth` colour textures
// `fboCastSub` already owns - the raster pass, when `renderer:'mesh'`, is
// just an alternative way to fill pass A's sub-sample output (same RG32UI/
// RGBA32UI/R32UI shapes dda.frag.js writes), so resolve/deriv/light/shade
// downstream need NO changes (27.11 ME-04 AC "'dda' output unchanged").
const GRID_RENDERBUFFER_FIELDS = Object.freeze(['texRasterDepth']);

/**
 * Creates every grid-sized texture + FBO at `cols x rows` (sub-sample sets
 * at `cols*rays x rows*rays`). `outFgTex`/`outBgTex` are the RenderTarget's
 * OWN (already-sized) fg/bg textures - `fboFinal` attaches them, exactly as
 * `GpuCellPipeline._initGL` used to inline.
 * @returns {object} a plain object with the 14 texture fields + 7 FBO fields above.
 */
export function allocGridTargets(gl, cols, rows, rays, outFgTex, outBgTex) {
  const subCols = cols * rays, subRows = rows * rays;
  const t = {};
  // Architect review 1 item 2: an incomplete FBO (a realistic out-of-memory
  // failure at e.g. 480x180) throws partway through, after some textures/
  // FBOs were already created on `t` - without this try/catch those leak
  // (never freed, `t` itself goes out of scope at the throw site) and the
  // exception escapes into the caller's caller (`resizeGrid` ->
  // `applyGrid` -> `loop.render`, killing the rAF loop). Free whatever was
  // built on `t` so far, then rethrow for the caller to handle.
  try {
    return _allocGridTargetsInner(gl, cols, rows, subCols, subRows, outFgTex, outBgTex, t);
  } catch (e) {
    freeGridTargets(gl, t);
    throw e;
  }
}

function _allocGridTargetsInner(gl, cols, rows, subCols, subRows, outFgTex, outBgTex, t) {
  // ME-06 (docs/architecture.md 27.1 item 5, 27.4): GI widens RG32UI ->
  // RGBA32UI (z = octahedral-packed normal, currently only the kind-7/
  // terrain raster+march writers fill it; w = objectId, unread until
  // ME-18 - every other writer fills both with 0). SGI/SGI2 (the two
  // sub-sample ping-pong sets pass A1/A2/A3 share) widen the same way so a
  // kind-7 sub-sample's normal survives into the resolve pass unchanged.
  t.texGI = createTexture2D(gl, gl.RGBA32UI, cols, rows);
  t.texGA = createTexture2D(gl, gl.RGBA32UI, cols, rows);
  t.texGD = createTexture2D(gl, gl.RGBA32UI, cols, rows);
  t.texDepth = createTexture2D(gl, gl.R32UI, cols, rows);
  t.texSGI = createTexture2D(gl, gl.RGBA32UI, subCols, subRows);
  t.texSGA = createTexture2D(gl, gl.RGBA32UI, subCols, subRows);
  t.texSDepth = createTexture2D(gl, gl.R32UI, subCols, subRows);
  t.texSGI2 = createTexture2D(gl, gl.RGBA32UI, subCols, subRows);
  t.texSGA2 = createTexture2D(gl, gl.RGBA32UI, subCols, subRows);
  t.texSDepth2 = createTexture2D(gl, gl.R32UI, subCols, subRows);
  t.texMask = createTexture2D(gl, gl.R8UI, cols, rows);
  t.texLight = createTexture2D(gl, gl.RGBA32UI, cols, rows);
  t.texShadeFg = createTexture2D(gl, gl.RGBA8, cols, rows);
  t.texShadeBg = createTexture2D(gl, gl.RGBA8, cols, rows);

  t.fboCastSub = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboCastSub);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texSGI, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.texSGA, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.texSDepth, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboCastSub incomplete');

  t.fboTerrainSub = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboTerrainSub);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texSGI2, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.texSGA2, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.texSDepth2, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboTerrainSub incomplete');

  t.fboCast = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboCast);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texGI, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.texGA, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.texDepth, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboCast incomplete');

  t.fboDeriv = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboDeriv);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texGD, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboDeriv incomplete');

  t.fboLight = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboLight);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texLight, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboLight incomplete');

  t.fboShade = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboShade);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texShadeFg, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.texShadeBg, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboShade incomplete');

  t.fboFinal = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboFinal);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outFgTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, outBgTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboFinal incomplete');

  // ME-04: the raster pass' own depth24 renderbuffer + FBO (see the
  // GRID_RENDERBUFFER_FIELDS comment above) - allocated unconditionally,
  // same "always allocate, 1x1/placeholder-sized if unused" pattern as
  // texFarH/texVOX etc. elsewhere in this pipeline, so `renderer:'mesh'`
  // never needs its own resize path.
  glCounts.renderbuffers = (glCounts.renderbuffers || 0) + 1;
  t.texRasterDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, t.texRasterDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, subCols, subRows);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  t.fboRasterSub = createFramebuffer2D(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fboRasterSub);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texSGI, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.texSGA, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, t.texSDepth, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.texRasterDepth);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('gridTargets: fboRasterSub incomplete');

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t;
}

/** Deletes every texture/FBO/renderbuffer `allocGridTargets` created (safe on a partial object). */
export function freeGridTargets(gl, t) {
  if (!t) return;
  for (const f of GRID_TEXTURE_FIELDS) deleteTexture2D(gl, t[f]);
  for (const f of GRID_FBO_FIELDS) deleteFramebuffer2D(gl, t[f]);
  for (const f of GRID_RENDERBUFFER_FIELDS) {
    if (t[f]) { gl.deleteRenderbuffer(t[f]); glCounts.renderbuffers--; }
  }
}

/**
 * US-038a (architecture.md 22.5, D-025): pre-flight check run BEFORE
 * anything is freed/recreated - `rt.canHoldGrid(cols, rows, rays)` delegates
 * here with its own `gl`/`pxCellW`/`pxCellH`. Pure function (no GL objects
 * created) so it is Node-testable against a fake `gl.getParameter`.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function computeGridLimits(gl, cols, rows, rays, pxCellW, pxCellH) {
  // Architect review 1 item 1: a lost context makes every `gl.getParameter`
  // call return null (spec), so `maxViewport[0]` below would throw instead
  // of returning the `{ok:false}` this function's own contract promises
  // ("never throws" - `engine.setGrid` doesn't wrap this call). Checked
  // first, before any getParameter call.
  if (gl.isContextLost && gl.isContextLost()) {
    return { ok: false, reason: 'context lost' };
  }
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (cols * rays > maxTex || rows * rays > maxTex) {
    return { ok: false, reason: `sub-sample grid ${cols * rays}x${rows * rays} exceeds MAX_TEXTURE_SIZE ${maxTex}` };
  }
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const vpW = (pxCellW || 1) * cols, vpH = (pxCellH || 1) * rows;
  if (vpW > maxViewport[0] || vpH > maxViewport[1]) {
    return { ok: false, reason: `canvas ${vpW}x${vpH}px exceeds MAX_VIEWPORT_DIMS ${maxViewport[0]}x${maxViewport[1]}` };
  }
  const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
  if (maxDrawBuffers < 3) {
    return { ok: false, reason: `MAX_DRAW_BUFFERS ${maxDrawBuffers} < 3` };
  }
  const est = cols * rows * (85 + rays * rays * 56);
  const MAX_BYTES = 256 * 1024 * 1024;
  if (est > MAX_BYTES) {
    return { ok: false, reason: `estimated GPU memory ${(est / (1024 * 1024)).toFixed(1)} MB exceeds 256 MB (cols=${cols} rows=${rows} rays=${rays})` };
  }
  return { ok: true };
}
