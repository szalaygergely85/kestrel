// engine/render/gpu/glsl/water.vert.js - US-055a2a (docs/architecture.md 35.3): the water clipmap's vertex stage.
// GLSL twin of `waterVertexJS` (engine/mesh/waterMesh.js): the clipmap vertex is LOCAL (lx, ly) around the 8 m snapped origin
// O; `l' = clamp(l, aabbLocal)` collapses vertices outside the (0.5 m grown) region AABB onto its boundary (their triangles
// degenerate), z = the region's z (flat water, A = 0 - waves are US-143b1). The CPU folds O into the matrix in f64
// (`uMVP = viewProj * T(O, 0)`), so every f32 value here is small and local.
//
// Attribute layout = engine/render/gpu/waterLayer.js WATER_VERTEX_LAYOUT: one vec4 (lx, ly, ring, stitch). `ring`/`stitch`
// are read by the wave stage later (35.3 vertex step 4); unused while the water is flat.
import { GLSL_VERSION, PRECISION } from './common.js';

export const WATER_VERT_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) in vec4 aL;   // lx, ly, ring, stitch
uniform mat4 uMVP;                 // world -> clip, with the origin O folded in (f64 on the CPU)
uniform vec4 uAabb;                // local region AABB x0, y0, x1, y1 (grown by 0.5 m)
uniform int uKind;
uniform vec4 uShape;
uniform float uZ;                  // region z (world)
out vec2 vL;
out float vArc;                       // l' (local, clamped)

void main() {
  if (uKind == 2) {
    vL = aL.xy + uShape.xy; vArc = aL.w;
    gl_Position = uMVP * vec4(vL, aL.z, 1.0);
    return;
  }
  vArc = 0.0;
  vec2 l = clamp(aL.xy, uAabb.xy, uAabb.zw);
  vL = l;
  gl_Position = uMVP * vec4(l, uZ, 1.0);
}
`;
