// US-029 tech notes item 4: shared fullscreen-triangle vertex shader for
// every pass in the hook (shade, edge, debug). Cell address comes only from
// `ivec2(gl_FragCoord.xy)` in the fragment shader (tech notes item 5 - "no
// flips anywhere in the cell passes"), so this vertex shader carries no
// varyings at all - same gl_VertexID trick as RenderTargetGL's own vertex
// shader, without vUv.
import { GLSL_VERSION } from './common.js';

export const CELL_VERT_SRC = `${GLSL_VERSION}
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;
