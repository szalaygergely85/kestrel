// WG-1c2 (docs/architecture.md 38.7, 38.8a items 14-16): async render-target factory with the runtime backend switch.
//   `createRenderer({ canvas, cols, rows, backend, force2d, cpuGrid, gpu })` -> `{ rt, pipeline, device, info }`
// backend 'webgl2' (default): exactly the old `RenderTarget()` path (device = null).
// backend 'webgpu': createGpuDevice (adapter, limits, self-test; canvas attached only after it passed) + RenderTargetWebGPU
// at `cpuGrid` (no WebGPU cell pipeline until WG-2, so never the 320x120 GPU grid). On any failure: warn and build the
// webgl2 target on the SAME canvas (the failed request leaves it free). This file and the F3 line are the only places that
// read `device.backend` (check-deps / 38.2).
import { bootNow, span as bootSpan } from '../core/bootMarks.js'; // BOOT-SPEED-01
import { RenderTarget } from './RenderTarget.js';
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';
import { createGpuDevice } from './gpu/device/createGpuDevice.js';
import { WgCellPipeline } from './gpu/wg/WgCellPipeline.js';

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
      const tG = bootNow();
      device = await createGpuDevice({ backend: 'webgpu', canvas, fallback: false, warn });
      bootSpan('createGpuDevice total (adapter, device, self-test)', tG);
      if (device.backend === 'webgpu') {
        const tR = bootNow();
        const rt = new RenderTargetWebGPU(canvas, cpuGrid.cols, cpuGrid.rows, device);
        bootSpan('new RenderTargetWebGPU', tR);
        // WG-2a: the skeleton cell pipeline (debug view only; the CPU path still renders the scene). `gpu:false` (?gpu=0) = none.
        let pipeline = null;
        const tW = bootNow();
        if (o.onCompileProgress) device.onCompileProgress = o.onCompileProgress; // boot card: (done, total) per compiled pipeline
        if (gpu) pipeline = new WgCellPipeline(rt, { rays: o.rays, terrainEnabled: o.terrainEnabled, shadows: o.shadows, gpuCull: o.gpuCull, occl: o.occl });
        bootSpan('new WgCellPipeline total', tW);
        // S8-B1-09b (38.10b): all pass pipelines were created in one async compile batch; wait for it here (the loading card is up),
        // then log per-pipeline ms (they overlap, so also the wall total) into the boot report.
        if (pipeline && pipeline.compiled) {
          const tC = bootNow();
          const list = await pipeline.compiled;
          const wall = bootNow() - tC;
          for (const x of list) bootSpan('  pipeline ' + x.label + (x.ok ? '' : ' FAILED'), bootNow() - x.ms);
          bootSpan(`pipelines compiled (${list.length}, wall wait)`, tC);
          if (list.length && typeof console !== 'undefined') console.info(`[boot] pipelines: ${list.length} in ${wall.toFixed(0)} ms wait; slowest ` + list.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((x) => `${x.label} ${x.ms.toFixed(0)}`).join(', '));
        }
        // 38.8a item 18: async validation errors (WGSL, pipeline layouts) never throw; any error = failure -> fallback
        if (typeof device.checkErrors === 'function') {
          const tE = bootNow();
          const errs = await device.checkErrors();
          bootSpan('device.checkErrors', tE);
          if (errs.length) { if (pipeline) pipeline.dispose(); throw new Error('webgpu validation error: ' + errs[0]); }
        }
        if (pipeline && !pipeline.ready) pipeline = null; // failed init already warned and freed itself
        const a = device.adapterInfo || {};
        const label = `webgpu (${[a.vendor, a.architecture].filter(Boolean).join('/') || 'unknown adapter'}${a.fallback ? ', software adapter' : ''})`;
        return { rt, pipeline, device, info: { requested, backend: 'webgpu', fallback: false, label } };
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
  return { rt, pipeline: null, device: null, info: { requested, backend: rt.backend, fallback, label: `${rt.backend}${fallback ? ' (fallback from webgpu)' : ''}` } };
}
