// @ts-check
// engine/render/gpu/device/webgpuProbe.js - WG-1a (architecture.md 38.4/38.8).
// Reports what the WebGPU adapter offers and whether it meets the limits the
// WGSL port needs. `navigator.gpu` lives only under engine/render/gpu/device/;
// the game page probes through `probeWebGpu()`.

/** Required adapter limits (38.4): the raster G-buffer is 2x rgba32uint + r32uint = 36 B/sample. */
export const REQUIRED_LIMITS = Object.freeze({
  maxColorAttachmentBytesPerSample: 36,
  maxSampledTexturesPerShaderStage: 16,
  maxColorAttachments: 4,
});

/** Limits reported (required ones + the extra 38.8 list). */
export const REPORTED_LIMITS = Object.freeze([
  'maxColorAttachmentBytesPerSample', 'maxSampledTexturesPerShaderStage', 'maxColorAttachments',
  'maxTextureDimension2D', 'maxUniformBufferBindingSize', 'maxBindGroups',
  'maxDynamicUniformBuffersPerPipelineLayout',
]);

/**
 * Pure check of a limits object against REQUIRED_LIMITS.
 * @param {Record<string, number>|null|undefined} limits  null/undefined = no adapter
 * @param {string[]} [features]  adapter features (informational; no feature is required)
 * @returns {{requiredOk: boolean, missing: string[]}}
 */
export function evaluateWebGpuLimits(limits, features = []) {
  if (!limits) return { requiredOk: false, missing: ['no adapter'] };
  const missing = [];
  for (const [name, min] of Object.entries(REQUIRED_LIMITS)) {
    const v = limits[name];
    if (typeof v !== 'number' || v < min) missing.push(`${name} ${v === undefined ? 'n/a' : v} < ${min}`);
  }
  return { requiredOk: missing.length === 0, missing };
}

/**
 * Probe the browser's WebGPU adapter. Never throws; JSON-safe result.
 * @param {{navigatorGpu?: any}} [opts]  navigatorGpu override for tests
 */
export async function probeWebGpu(opts = {}) {
  const gpu = opts.navigatorGpu !== undefined ? opts.navigatorGpu
    : (typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).gpu : undefined);
  const out = {
    available: false,
    adapter: { vendor: '', architecture: '', description: '', fallback: false },
    features: /** @type {string[]} */ ([]),
    limits: /** @type {Record<string, number>} */ ({}),
    requiredOk: false,
    missing: /** @type {string[]} */ ([]),
    error: /** @type {string|undefined} */ (undefined),
  };
  if (!gpu) { out.missing = ['no navigator.gpu']; return out; }
  let adapter = null;
  try { adapter = await gpu.requestAdapter(); } catch (e) { out.error = String(e && e.message || e); }
  if (!adapter) { out.missing = ['no adapter']; return out; }
  out.available = true;
  let info = adapter.info;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    try { info = await adapter.requestAdapterInfo(); } catch { /* ignore */ }
  }
  info = info || {};
  out.adapter = {
    vendor: String(info.vendor || ''), architecture: String(info.architecture || ''),
    description: String(info.description || info.device || ''),
    fallback: !!(adapter.isFallbackAdapter || info.isFallbackAdapter),
  };
  out.features = [...(adapter.features || [])].sort();
  for (const n of REPORTED_LIMITS) {
    const v = adapter.limits ? adapter.limits[n] : undefined;
    if (typeof v === 'number') out.limits[n] = v;
  }
  const ev = evaluateWebGpuLimits(adapter.limits ? out.limits : null, out.features);
  out.requiredOk = ev.requiredOk; out.missing = ev.missing;
  return out;
}
