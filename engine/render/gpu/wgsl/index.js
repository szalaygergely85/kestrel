// WG-1c1 (docs/architecture.md 38.2): the list of every WGSL module the engine ships. `tools/capture-browser.mjs
// --mode wgsl` compiles each entry through createShaderModule + getCompilationInfo (0 errors required); later WG
// steps append their `<pass>.wgsl.js` here. Pure data + helpers, no GPU globals.

import { PRESENT_WGSL } from './present.wgsl.js';
import { DEBUG_WGSL } from './debug.wgsl.js';
import { RESOLVE_WGSL } from './resolve.wgsl.js';
import { DERIV_WGSL } from './deriv.wgsl.js';
import { LIGHT_WGSL } from './light.wgsl.js';
import { SHADE_WGSL, SHADE_LEVEL_WGSL } from './shade.wgsl.js';
import { STABLE_WGSL } from './stable.wgsl.js'; // US-073b
import { EDGE_WGSL } from './edge.wgsl.js';
import { SHADOW_WGSL, SHADOW_TERRAIN_WGSL, SHADOW_DEPTH_COPY_WGSL } from './shadow.wgsl.js';
import { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_SHADOW_WGSL, RASTER_VOXEL_SHADOW_WGSL, RASTER_INSTANCED_SHADOW_WGSL, RASTER_CLOTH_SHADOW_WGSL, RASTER_MASK_WGSL, RASTER_MASK_SHADOW_WGSL, RASTER_INSTANCED_MASK_WGSL, RASTER_INSTANCED_MASK_SHADOW_WGSL } from './raster.wgsl.js';
import { TERRAIN_RASTER_WGSL } from './terrainRaster.wgsl.js';
import { WATER_WGSL } from './water.wgsl.js';
import { WATER_COMPOSITE_WGSL } from './waterComposite.wgsl.js';
import { SPRITES_WGSL } from './sprites.wgsl.js';
import { OVERLAY_WGSL } from './overlay.wgsl.js';
import { CULL_WGSL } from './cull.wgsl.js';
import { CULL_SHADOW_WGSL } from './cullShadow.wgsl.js';
import { HZB_WGSL } from './hzb.wgsl.js'; // S8-B2-09

/** @type {ReadonlyArray<{name: string, code: string}>} */
export const WGSL_MODULES = Object.freeze([
  { name: 'present', code: PRESENT_WGSL },
  { name: 'debug', code: DEBUG_WGSL },
  { name: 'rasterStatic', code: RASTER_WGSL },
  { name: 'rasterVoxel', code: RASTER_VOXEL_WGSL },
  { name: 'rasterInstanced', code: RASTER_INSTANCED_WGSL },
  { name: 'rasterCloth', code: RASTER_CLOTH_WGSL },
  { name: 'rasterTerrain', code: TERRAIN_RASTER_WGSL },
  { name: 'resolve', code: RESOLVE_WGSL },
  { name: 'deriv', code: DERIV_WGSL },
  { name: 'light', code: LIGHT_WGSL },
  { name: 'shade', code: SHADE_WGSL },
  { name: 'shadeLevel', code: SHADE_LEVEL_WGSL }, // US-073b: shade + r8uint level target (stable enabled only)
  { name: 'stable', code: STABLE_WGSL }, // US-073b: temporal glyph stability pass (host wiring = US-073c)
  { name: 'edge', code: EDGE_WGSL },
  { name: 'shadow', code: SHADOW_WGSL },
  { name: 'shadowTerrain', code: SHADOW_TERRAIN_WGSL },
  { name: 'shadowDepthCopy', code: SHADOW_DEPTH_COPY_WGSL },
  { name: 'water', code: WATER_WGSL },
  { name: 'waterComposite', code: WATER_COMPOSITE_WGSL },
  { name: 'sprites', code: SPRITES_WGSL },
  { name: 'overlay', code: OVERLAY_WGSL },
  { name: 'cull', code: CULL_WGSL }, // WG-4a compute (entry cs_main)
  { name: 'cullShadow', code: CULL_SHADOW_WGSL }, // WG-4b compute (entry cs_main)
  // WG-3d 24b: sun shadow vertex variants (depth in [0.5, 1])
  { name: 'rasterShadowStatic', code: RASTER_SHADOW_WGSL },
  { name: 'rasterShadowVoxel', code: RASTER_VOXEL_SHADOW_WGSL },
  { name: 'rasterShadowInstanced', code: RASTER_INSTANCED_SHADOW_WGSL },
  { name: 'rasterShadowCloth', code: RASTER_CLOTH_SHADOW_WGSL },
  // ALPHA-01c: mask-discard static mesh (location 10 uv stream + texMask) and its shadow variant (fragment entry fs_mask_shadow)
  { name: 'rasterMask', code: RASTER_MASK_WGSL },
  { name: 'rasterShadowMask', code: RASTER_MASK_SHADOW_WGSL },
  { name: 'hzb', code: HZB_WGSL }, // S8-B2-09 compute (entry cs_main): HZB max-depth downsample
  // ALPHA-01f (b): instanced mesh with a per-range mask discard (location 10 aUVMask stream, same texel/discard rule as rasterMask).
  { name: 'rasterInstancedMask', code: RASTER_INSTANCED_MASK_WGSL },
  // ALPHA-01f (c): instanced masked shadow caster (fs_mask_shadow discard, depth in [0.5,1] like the other rasterShadow* variants).
  // Host wiring (passShadow.js pipeline/draw selection) is NEEDS B1, not built here.
  { name: 'rasterShadowInstancedMask', code: RASTER_INSTANCED_MASK_SHADOW_WGSL },
]);

/**
 * Folds `GPUCompilationInfo.messages` into a JSON-safe summary (pure, Node-tested).
 * @param {string} name
 * @param {ReadonlyArray<{type: string, message: string, lineNum?: number, linePos?: number}>} messages
 * @returns {{name: string, errors: number, warnings: number, firstError: string|null}}
 */
export function summarizeCompilation(name, messages) {
  let errors = 0, warnings = 0, firstError = null;
  for (const m of messages || []) {
    if (m.type === 'error') {
      errors++;
      if (firstError === null) firstError = `${m.lineNum || 0}:${m.linePos || 0} ${m.message}`;
    } else if (m.type === 'warning') warnings++;
  }
  return { name, errors, warnings, firstError };
}
