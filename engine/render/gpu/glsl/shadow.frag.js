// engine/render/gpu/glsl/shadow.frag.js - ME-15b (docs/architecture.md 27.9a item 7). The sun shadow
// pass is DEPTH ONLY: it reuses mesh.vert.js / terrain.vert.js unchanged with `uViewProj = M_sun`
// (shadowSun.js), so its fragment stage is empty. No shadow-map resolution / bias literal lives in
// GLSL (27.9 "Do not"): the polygon offset is set from `createEngine({ shadows })` on the JS side.
import { GLSL_VERSION, PRECISION } from './common.js';
import { MAX_STRUCTS } from '../WorldTextures.js';

/** Static level quads, voxel parts: nothing to write but depth. */
export const SHADOW_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
void main() {}
`;

/**
 * Terrain keeps the structure-footprint carve (27.9a: "structFoot carve kept in depth-only" - caster ==
 * receiver geometry under structures), the literal twin of terrain.vert.js's raster frag / rasterJS depth-only.
 */
export const SHADOW_TERRAIN_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
in vec3 vWorldPos;
uniform vec4 uStructFoot[${MAX_STRUCTS}];
uniform int uStructCount;
void main() {
  for (int i = 0; i < ${MAX_STRUCTS}; i++) {
    if (i >= uStructCount) break;
    vec4 b = uStructFoot[i];
    if (vWorldPos.x >= b.x && vWorldPos.x < b.z && vWorldPos.y >= b.y && vWorldPos.y < b.w) discard;
  }
}
`;

/**
 * TEST-ONLY (gpucompare depth parity): depth24 cannot be `readPixels`'d, so a fullscreen pass copies the
 * shadow map's float depth bits into an R32UI target (`texelFetch`, exact). JS converts back to 24 bit.
 */
export const SHADOW_DEPTH_COPY_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uint outBits;
uniform sampler2D uShadowDepth;
void main() {
  outBits = floatBitsToUint(texelFetch(uShadowDepth, ivec2(gl_FragCoord.xy), 0).r);
}
`;
