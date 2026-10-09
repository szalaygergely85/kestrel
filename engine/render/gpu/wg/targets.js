// WG-2a/3a (docs/architecture.md 38.4): the WebGPU cell pipeline's G-buffer targets, allocated through GpuDevice only.
// Raster G-buffer = 2x rgba32uint (SGI, SGA) + r32uint (SDEPTH) + depth24 = 36 B/sample, sized (cols*rays) x (rows*rays)
// like the GL sub-sample set. `resizeGrid` = free + alloc (the pipeline commits the new set only after a successful alloc).
// Pure device calls: Node-testable with makeMockGpuDevice.

export const WG_TEXTURE_FIELDS = Object.freeze(['texLevel', 'texSGI', 'texSGA', 'texSDepth', 'texRasterDepth', 'texGI', 'texGA', 'texGD', 'texDepth', 'texMask', 'texLight', 'texShadeFg', 'texShadeBg', 'texFinalFg', 'texFinalBg']);

/**
 * @param {any} device a GpuDevice (mock or WebGPU)
 * @param {number} cols @param {number} rows @param {number} rays sub-samples per cell axis (>= 1)
 * @param {{stable?: boolean}} [opts] stable (US-073b): also create `texLevel` (r8ui, shade's 3rd target) + `targetShadeLevel`; absent = identical to before
 * @returns {{texSGI: any, texSGA: any, texSDepth: any, texRasterDepth: any, targetRaster: any, subCols: number, subRows: number, cols: number, rows: number, rays: number}}
 */
export function allocWgTargets(device, cols, rows, rays = 1, opts = null) {
  const subCols = cols * rays, subRows = rows * rays;
  /** @type {any} */ const t = { cols, rows, rays, subCols, subRows };
  try {
    t.texSGI = device.createTexture({ format: 'rgba32ui', width: subCols, height: subRows });
    t.texSGA = device.createTexture({ format: 'rgba32ui', width: subCols, height: subRows });
    t.texSDepth = device.createTexture({ format: 'r32ui', width: subCols, height: subRows });
    t.texRasterDepth = device.createTexture({ format: 'depth24', width: subCols, height: subRows });
    t.targetRaster = device.createTarget({ color: [t.texSGI, t.texSGA, t.texSDepth], depth: t.texRasterDepth });
    t.targetVmDepth = device.createTarget({ color: [], depth: t.texRasterDepth });
    // WG-3a: cell-resolution set (resolve writes GI/GA/Depth, deriv writes GD) + the zero overlay-bit mask (r8ui, resolve's uMask).
    t.texGI = device.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    t.texGA = device.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    t.texGD = device.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    t.texDepth = device.createTexture({ format: 'r32ui', width: cols, height: rows });
    t.texMask = device.createTexture({ format: 'r8ui', width: cols, height: rows });
    t.targetResolve = device.createTarget({ color: [t.texGI, t.texGA, t.texDepth] });
    t.targetDeriv = device.createTarget({ color: [t.texGD] });
    // WG-3b: light output (rgba32uint, sunlit/litCount/sunN in .w)
    t.texLight = device.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    t.targetLight = device.createTarget({ color: [t.texLight] });
    // WG-3c: shade output (pass 1) and the final edge output (pass 2, fg.a = glyph/255); the CPU present keeps using rt.fgTex/bgTex until WG-3f.
    t.texShadeFg = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    t.texShadeBg = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    t.texFinalFg = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    t.texFinalBg = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    t.targetShade = device.createTarget({ color: [t.texShadeFg, t.texShadeBg] });
    t.targetFinal = device.createTarget({ color: [t.texFinalFg, t.texFinalBg] });
    if (opts && opts.stable) { // US-073b (38.25 item 3): shade's extra ramp-level byte, only when the stable pass exists
      t.texLevel = device.createTexture({ format: 'r8ui', width: cols, height: rows });
      t.targetShadeLevel = device.createTarget({ color: [t.texShadeFg, t.texShadeBg, t.texLevel] });
    }
  } catch (e) {
    freeWgTargets(device, t);
    throw e;
  }
  return t;
}

/** @param {any} device @param {any} t result of allocWgTargets (partial is fine) */
export function freeWgTargets(device, t) {
  if (!t) return;
  for (const f of ['targetRaster', 'targetVmDepth', 'targetResolve', 'targetDeriv', 'targetLight', 'targetShade', 'targetShadeLevel', 'targetFinal', ...WG_TEXTURE_FIELDS]) {
    if (t[f]) { try { device.dispose(t[f]); } catch (_) { /* best effort */ } t[f] = null; }
  }
}
