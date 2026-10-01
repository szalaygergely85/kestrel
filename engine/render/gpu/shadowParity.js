// engine/render/gpu/shadowParity.js - ME-15b (docs/architecture.md 27.9a item 10). Dev/test harness glue for
// `?gpucompare=1&renderer=mesh`: after `pipeline.frame()`, reads the GPU sun shadow map back (test-only R32UI
// copy) and compares it with the JS twin - rasterJS depth-only over the SAME shadow caster list, matrix and
// polygon offset the GPU pass used - with `compareShadowDepth` (16 ULP of 24-bit depth).
import { createRasterTarget, clearRasterTarget, rasterDrawList } from '../../mesh/rasterJS.js';
import { compareShadowDepth } from './gpuCompare.js';

/** @param {number} res shadow map side (must equal the pipeline's `shadowOpts.res`) */
export function createShadowParityRunner(res) {
  const bits = new Uint32Array(res * res);
  const target = createRasterTarget(res, res, 1, { depthOnly: true });
  const ctx = { M: null, depthBias: { factor: 0, units: 0 }, structFoot: null, structCount: 0 };
  return {
    /** @param {import('./GpuCellPipeline.js').GpuCellPipeline} pipeline @returns {object|null} null when no sun pass ran this frame */
    run(pipeline) {
      if (!pipeline.readbackShadowDepthBits(bits)) return null;
      const so = pipeline.shadowOpts;
      ctx.M = pipeline._sunMat.M;
      ctx.depthBias.factor = so.depthBias[0]; ctx.depthBias.units = so.depthBias[1];
      ctx.structFoot = pipeline._meshStructFoot; ctx.structCount = pipeline._structCount;
      clearRasterTarget(target);
      rasterDrawList(pipeline._shadowList, target, ctx);
      const r = compareShadowDepth(bits, target.zbuf, res);
      return { ...r, items: pipeline._shadowList.count };
    },
  };
}
