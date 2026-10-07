// WG-3d (docs/architecture.md 38.5/38.8, 27.9a item 7): WGSL port of glsl/shadow.frag.js. The sun shadow pass is DEPTH ONLY: it
// reuses the mesh / terrain / cloth VERTEX stages of raster.wgsl.js unchanged with the view-projection = M_sun (shadowSun.js), so
// the fragment stages here are tiny. No shadow-map resolution / bias literal lives in WGSL (27.9 "Do not"): the polygon offset is
// pipeline state on the JS side. JS twins: rasterJS.js depth-only (insideStructFoot carve), gpuCompare.js compareShadowDepth.
// Three fragment-only modules (a vertex stage from another module is paired with them by the pipeline builder):
//  - SHADOW_WGSL         static quads / voxel parts / cloth: `fs_main` has no output (empty). A pipeline may also omit the fragment stage.
//  - SHADOW_TERRAIN_WGSL terrain keeps the structure-footprint carve (27.9a: caster == receiver geometry under structures).
//    Input @location(0) = vWorldPos (vec3f, world metres) - the FIRST varying of the terrain vertex stage (GLSL terrain.vert `out vec3 vWorldPos`).
//    Bindings: @group(1) @binding(0) = ShadowTerrainU { structCount, structFoot[MAX_STRUCTS] = x0, y0, x1, y1 }. No textures, no colour target.
//  - SHADOW_DEPTH_COPY_WGSL  TEST-ONLY (gpucompare depth parity): copies the shadow map float depth bits into an r32uint target
//    (textureLoad, exact). @group(0) @binding(0) = depth32float (kind 'depth'); target 0 r32uint (bits in .x). No uniforms.
import { defineUniformBlock } from './uniformBlock.js';
import { FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { TERRAIN_RASTER_WGSL } from './terrainRaster.wgsl.js';

export const SHADOW_TERRAIN_BLOCK = defineUniformBlock('ShadowTerrainU', [
  { name: 'structCount', type: 'i32' }, { name: 'pad0', type: 'f32' }, { name: 'pad1', type: 'f32' }, { name: 'pad2', type: 'f32' },
  { name: 'structFoot', type: 'vec4', count: MAX_STRUCTS }, // x0, y0, x1, y1 (world m) per placed structure
]);

export const SHADOW_TEXTURES = Object.freeze([]);
export const SHADOW_TARGETS = Object.freeze([]);            // depth-only: no colour attachments
export const SHADOW_DEPTH_COPY_TEXTURES = Object.freeze(['depth']);
export const SHADOW_DEPTH_COPY_TARGETS = Object.freeze(['r32uint']);

/** Static level quads, voxel parts, cloth: nothing to write but depth. */
export const SHADOW_WGSL = `
@fragment
fn fs_main() {}
`;

export const SHADOW_TERRAIN_WGSL = `
${SHADOW_TERRAIN_BLOCK.wgsl}
@group(1) @binding(0) var<uniform> u: ShadowTerrainU;
const MAX_STRUCTS: i32 = ${MAX_STRUCTS};

// GLSL: the loop body \`discard\`s; same test here, factored so Node can probe it (rasterJS.js insideStructFoot twin).
fn inStructFoot(wp: vec3f) -> bool {
  for (var i = 0; i < MAX_STRUCTS; i++) {
    if (i >= u.structCount) { break; }
    let b = u.structFoot[i];
    if (wp.x >= b.x && wp.x < b.z && wp.y >= b.y && wp.y < b.w) { return true; }
  }
  return false;
}

@fragment
fn fs_main(@location(0) vWorldPos: vec3f) {
  if (inStructFoot(vWorldPos)) { discard; }
}
`;

export const SHADOW_DEPTH_COPY_WGSL = `
@group(0) @binding(0) var uShadowDepth: texture_depth_2d; // depth32float, textureLoad (exact, no compare)
${FULLSCREEN_VS_WGSL}
@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4u {
  let bits = bitcast<u32>(textureLoad(uShadowDepth, vec2i(floor(frag.xy)), 0));
  return vec4u(bits, 0u, 0u, 0u);
}
`;

/**
 * Terrain shadow fragment entry, appended to the terrain raster module so the vertex stage and this stage share ONE uniform block
 * (TerrainU): the stand-alone `shadowTerrain` module (ShadowTerrainU) has a different layout (structFoot at word 4, count at 0)
 * and cannot share binding 0 with the terrain vertex stage. Same test as shadow.wgsl.js inStructFoot / the terrain fs_main carve.
 */
export const SHADOW_TERRAIN_PIPE_WGSL = `${TERRAIN_RASTER_WGSL}
@fragment fn fs_shadow(v: VertexOut) {
  for (var i = 0; i < ${MAX_STRUCTS}; i++) {
    if (u32(i) >= u.structCount) { break; }
    let b = u.structFoot[i];
    if (v.vWorldPos.x >= b.x && v.vWorldPos.x < b.z && v.vWorldPos.y >= b.y && v.vWorldPos.y < b.w) { discard; }
  }
}
`;

