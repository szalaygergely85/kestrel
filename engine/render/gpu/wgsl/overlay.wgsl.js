// WG-3f (docs/architecture.md 28.9 items 2/4/6, 38.8): WGSL port of the GpuOverlayPass fragment shader (overlayFragSrc({depthUint:true}) in
// engine/render/gpu/overlayPass.js), line by line; JS twin = applyOverlay (engine/ui/overlay.js): `ref <= sceneDepth + max(OVL_BIAS_M,
// OVL_BIAS_REL*ref)` for cells with a glyph. Single target = rt.fgTex only (glyph + fg; bg stays), empty / hidden cells `discard`.
// Only the r32uint DEPTH variant is ported. GL `ref` is a WGSL reserved word -> `refZ`; the depth rule is the helper `overlayHidden`.
// Bindings (@group(0), textureLoad): 0 OVL rgba8 (rgb colour, a = glyph index, 0 = empty), 1 OVL_Z r32float (ref depth, 0 = no depth test),
// 2 DEPTH r32uint. No uniforms. Target 0 = rgba8 (fg). Cell = @builtin(position).xy (no flip).
import { FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { OVL_BIAS_M, OVL_BIAS_REL } from '../../../ui/overlay.js';

export const OVERLAY_TEXTURES = Object.freeze(['float', 'float', 'uint']);
export const OVERLAY_TARGETS = Object.freeze(['rgba8']);

export const OVERLAY_WGSL = `
@group(0) @binding(0) var uOvl: texture_2d<f32>;   // RGBA8: rgb colour, a = glyph index (0 = empty cell)
@group(0) @binding(1) var uOvlZ: texture_2d<f32>;  // R32F: ref depth (0 = no depth test)
@group(0) @binding(2) var uDepth: texture_2d<u32>; // R32UI bitcast<u32>(d)
const BIAS_M: f32 = ${OVL_BIAS_M.toFixed(6)};
const BIAS_REL: f32 = ${OVL_BIAS_REL.toFixed(6)};

fn depthAt(c: vec2i) -> f32 { return bitcast<f32>(textureLoad(uDepth, c, 0).r); }
${FULLSCREEN_VS_WGSL}

// Depth rule: ref = 0 -> always drawn; sky / horizon depth (>= 1e5) always passes; else hidden when ref > d + max(BIAS_M, BIAS_REL * ref).
fn overlayHidden(refZ: f32, d: f32) -> bool {
  if (refZ > 0.0) {
    if (d < 1.0e5) {
      if (refZ > d + max(BIAS_M, BIAS_REL * refZ)) { return true; }
    }
  }
  return false;
}

@fragment fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let cell = vec2i(frag.xy);
  let o = textureLoad(uOvl, cell, 0);
  let g = floor(o.a * 255.0 + 0.5);
  if (g < 0.5) { discard; return o; }
  let refZ = textureLoad(uOvlZ, cell, 0).r;
  if (overlayHidden(refZ, depthAt(cell))) { discard; return o; }
  return o; // rgb + glyph byte exactly as stored (CellBuffer fg layout: a duplicates the glyph)
}
`;
