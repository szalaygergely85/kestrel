// WG-2a (docs/architecture.md 38.4): the WebGPU cell pipeline's G-buffer targets, allocated through GpuDevice only.
// Raster G-buffer = 2x rgba32uint (GI, GA) + r32uint (DEPTH) + depth24 = 36 B/sample, sized (cols*rays) x (rows*rays)
// like the GL sub-sample set. `resizeGrid` = free + alloc (the pipeline commits the new set only after a successful alloc).
// Pure device calls: Node-testable with makeMockGpuDevice.

export const WG_TEXTURE_FIELDS = Object.freeze(['texGI', 'texGA', 'texDepth', 'texRasterDepth']);

/**
 * @param {any} device a GpuDevice (mock or WebGPU)
 * @param {number} cols @param {number} rows @param {number} rays sub-samples per cell axis (>= 1)
 * @returns {{texGI: any, texGA: any, texDepth: any, texRasterDepth: any, targetRaster: any, subCols: number, subRows: number, cols: number, rows: number, rays: number}}
 */
export function allocWgTargets(device, cols, rows, rays = 1) {
  const subCols = cols * rays, subRows = rows * rays;
  /** @type {any} */ const t = { cols, rows, rays, subCols, subRows };
  try {
    t.texGI = device.createTexture({ format: 'rgba32ui', width: subCols, height: subRows });
    t.texGA = device.createTexture({ format: 'rgba32ui', width: subCols, height: subRows });
    t.texDepth = device.createTexture({ format: 'r32ui', width: subCols, height: subRows });
    t.texRasterDepth = device.createTexture({ format: 'depth24', width: subCols, height: subRows });
    t.targetRaster = device.createTarget({ color: [t.texGI, t.texGA, t.texDepth], depth: t.texRasterDepth });
  } catch (e) {
    freeWgTargets(device, t);
    throw e;
  }
  return t;
}

/** @param {any} device @param {any} t result of allocWgTargets (partial is fine) */
export function freeWgTargets(device, t) {
  if (!t) return;
  for (const f of ['targetRaster', ...WG_TEXTURE_FIELDS]) {
    if (t[f]) { try { device.dispose(t[f]); } catch (_) { /* best effort */ } t[f] = null; }
  }
}
