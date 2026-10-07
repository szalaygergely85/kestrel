// WG-1c1 (docs/architecture.md 38.5): line-by-line WGSL port of RenderTargetGL's present shader (VERTEX_SRC +
// FRAGMENT_SRC). One fullscreen triangle per draw; present() draws twice (scene uLayer=0, UI layer uLayer=1) with two
// pipelines so each keeps its own cached bind group. Differences from the GLSL, all required by 38.5 item 4/38.8a:
//  - the cell row comes straight from @builtin(position).y (canvas row 0 = top): no `1.0 - vUv.y` GL flip; the canvas
//    size therefore comes in as a uniform (`size`) instead of an interpolated vUv;
//  - the layer is an f32 uniform (the block is one Float32Array), compared as i32(layer) == 1;
//  - `textureSampleLevel(.., 0.0)`: the atlas has no mips, so it equals GL's `texture()`, and it stays valid after `discard`.
// Bindings (38.8a): @group(0) 0 = fg, 1 = bg (rgba8, 'float' = textureLoad only), 2 = atlas ('filtered'), 3 = its sampler;
// @group(1) @binding(0) = uniform block.

import { defineUniformBlock } from './uniformBlock.js';
import { GLYPH_COUNT } from '../../glyphAtlas.js';

/** Uniform block: grid = (cols, rows) of the layer drawn, size = canvas px, layer = 0 scene / 1 UI. */
export const PRESENT_BLOCK = defineUniformBlock('PresentU', [
  { name: 'grid', type: 'vec2' },
  { name: 'size', type: 'vec2' },
  { name: 'layer', type: 'f32' },
]);

/** Texture slot kinds for PipelineDesc.bindings.textures. */
export const PRESENT_TEXTURES = Object.freeze(['float', 'float', 'filtered']);

export const PRESENT_WGSL = `
${PRESENT_BLOCK.wgsl}
@group(0) @binding(0) var uFg: texture_2d<f32>;    // RGBA8 cols x rows, textureLoad: (r,g,b,glyphIdx)
@group(0) @binding(1) var uBg: texture_2d<f32>;    // RGBA8 cols x rows, textureLoad: (r,g,b,255)
@group(0) @binding(2) var uAtlas: texture_2d<f32>; // RGBA8 95 x 1 cells, LINEAR: coverage in .a
@group(0) @binding(3) var uAtlasSampler: sampler;
@group(1) @binding(0) var<uniform> u: PresentU;

const GLYPH_COUNT: f32 = ${GLYPH_COUNT}.0;

// Fullscreen triangle from vertex_index alone: id 0,1,2 -> pos (0,0),(2,0),(0,2); *2-1 covers NDC [-1,3].
@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let pos = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
  return vec4f(pos * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  // frag.xy are memory rows (row 0 = top of the canvas): cell row 0 is the top, as setCell(x,y,...) expects.
  let uv = frag.xy / u.size;
  let cellPos = uv * u.grid;
  let cellFrac = fract(cellPos);
  let cell = clamp(vec2i(floor(cellPos)), vec2i(0), vec2i(u.grid) - vec2i(1));

  let fg = textureLoad(uFg, cell, 0);
  let bg = textureLoad(uBg, cell, 0);
  let layer = i32(u.layer);
  if (layer == 1 && bg.a < 0.5) { discard; }
  let glyphIdx = floor(fg.a * 255.0 + 0.5);

  let atlasUv = vec2f((glyphIdx + cellFrac.x) / GLYPH_COUNT, cellFrac.y);
  let a = textureSampleLevel(uAtlas, uAtlasSampler, atlasUv, 0.0).a;

  if (layer == 1 && bg.a < 0.75) {
    // Glyph-only UI cell (bg.a = 128/255): draw ONLY the glyph's fg where it covers the cell, scene shows elsewhere.
    if (a < 0.5) { discard; }
    return vec4f(fg.rgb, 1.0);
  }
  return vec4f(mix(bg.rgb, fg.rgb, a), 1.0);
}
`;
