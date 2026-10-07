// WG-1c2 (docs/architecture.md 38.7, 38.8a items 14-16): async render-target factory with the runtime backend switch.
//   `createRenderer({ canvas, cols, rows, backend, force2d, cpuGrid, gpu })` -> `{ rt, device, info }`
// backend 'webgl2' (default): exactly the old `RenderTarget()` path (device = null).
// backend 'webgpu': createGpuDevice (adapter, limits, self-test; canvas attached only after it passed) + RenderTargetWebGPU
// at `cpuGrid` (no WebGPU cell pipeline until WG-2, so never the 320x120 GPU grid). On any failure: warn and build the
// webgl2 target on the SAME canvas (the failed request leaves it free). This file and the F3 line are the only places that
// read `device.backend` (check-deps / 38.2).
import { RenderTarget } from './RenderTarget.js';
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';
import { createGpuDevice } from './gpu/device/createGpuDevice.js';

/**
 * @param {{canvas: any, cols?: number, rows?: number, backend?: string, force2d?: boolean, cpuGrid?: {cols:number, rows:number},
 *   gpu?: boolean, warn?: (m: string) => void}} o
 * @returns {Promise<{rt: any, device: any, info: {requested: string, backend: string, fallback: boolean, label: string}}>}
 */
export async function createRenderer(o) {
  const { canvas, cols = 320, rows = 120, force2d = false, gpu = true } = o;
  const cpuGrid = o.cpuGrid || { cols: 160, rows: 60 };
  const warn = o.warn || ((m) => console.warn(m));
  const requested = o.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  if (o.backend && o.backend !== 'webgpu' && o.backend !== 'webgl2') warn(`[createRenderer] unknown ?backend=${o.backend} - using webgl2`);
  let failed = '';
  if (requested === 'webgpu') {
    let device = null;
    try {
      // fallback:false -> we do the webgl2 fallback ourselves (createGpuDevice's own fallback would touch the canvas)
      device = await createGpuDevice({ backend: 'webgpu', canvas, fallback: false, warn });
      if (device.backend === 'webgpu') {
        const rt = new RenderTargetWebGPU(canvas, cpuGrid.cols, cpuGrid.rows, device);
        const a = device.adapterInfo || {};
        const label = `webgpu (${[a.vendor, a.architecture].filter(Boolean).join('/') || 'unknown adapter'}${a.fallback ? ', software adapter' : ''})`;
        return { rt, device, info: { requested, backend: 'webgpu', fallback: false, label } };
      }
    } catch (e) {
      // If RenderTargetWebGPU threw after the device attached the canvas, free the device. The webgl2 build below then
      // gets a cloned-node Canvas2D (a canvas already holding a webgpu context cannot give a gl2 context) - expected in this narrow case.
      if (device && typeof device.dispose === 'function') { try { device.dispose(); } catch (_) { /* best effort */ } }
      failed = String(e && e.message || e);
      warn(`[createRenderer] webgpu failed (${failed}); falling back to webgl2`);
    }
  }
  const rt = RenderTarget(canvas, cols, rows, { force2d, cpuGrid, gpu });
  const fallback = requested === 'webgpu';
  return { rt, device: null, info: { requested, backend: rt.backend, fallback, label: `${rt.backend}${fallback ? ' (fallback from webgpu)' : ''}` } };
}
