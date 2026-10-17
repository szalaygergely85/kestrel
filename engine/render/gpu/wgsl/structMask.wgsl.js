// GS-01b: structure footprint carve with the optional per-cell mask (GS-01a World.structure.carveMask), shared by terrainRaster.wgsl.js
// and shadow.wgsl.js so the two GPU carves cannot drift. JS twin: rasterJS.js `insideStructFoot` (bbox, then mask lookup).
// The masks of all structures live in ONE r8uint atlas (StructMaskAtlas.js): structure i owns rows [structMask[i].x, + h) at columns [0, w);
// structMask[i].y = 1 when the structure has a mask (0 = carve the whole bbox, as before - the texture is never read).
import { MAX_STRUCTS } from '../WorldTextures.js';

/** Declaration of the atlas texture; `binding` = slot in the pipeline's texture list (group 0). */
export const structMaskDecl = (binding) => `@group(0) @binding(${binding}) var uStructMask: texture_2d<u32>;`;

/** `inStructFoot(wp)`: needs a uniform `u` with structCount (u32 or i32), structFoot[], structMask[] and the `uStructMask` declaration. */
export const IN_STRUCT_FOOT_WGSL = `
fn inStructFoot(wp: vec3f) -> bool {
  for (var i = 0; i < ${MAX_STRUCTS}; i++) {
    if (u32(i) >= u32(u.structCount)) { break; }
    let b = u.structFoot[i];
    if (wp.x >= b.x && wp.x < b.z && wp.y >= b.y && wp.y < b.w) {
      let m = u.structMask[i];
      if (m.y < 0.5) { return true; }
      if (textureLoad(uStructMask, vec2i(i32(wp.x - b.x), i32(wp.y - b.y) + i32(m.x)), 0).x != 0u) { return true; }
    }
  }
  return false;
}
`;
