// US-029 tech notes item 9 / architecture.md 14.1 file table: small WebGL2
// helpers shared by GpuCellPipeline.js and RenderTargetGL.js. Moved out of
// RenderTargetGL.js so both can use them without duplicating shader/texture
// boilerplate (RenderTargetGL imports this file).

export function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + info);
  }
  return sh;
}

export function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link failed: ' + info);
  }
  return program;
}

// General-purpose data-texture creator (US-029: G-buffer + material data
// textures), unlike RenderTargetGL's own `createDataTexture` (RGBA8-only,
// NEAREST/CLAMP, fixed unit binding). `internalFormat` picks the sampler
// kind on the GLSL side (RGBA32F -> sampler2D, RG32UI/RGBA32I -> usampler2D/
// isampler2D). Always NEAREST + CLAMP_TO_EDGE (14.1 item 2): every cell pass
// samples with `texelFetch`, never `texture()`, so filtering never applies,
// but NEAREST avoids driver-dependent completeness warnings on non-filterable
// integer/float formats.
export function createTexture2D(gl, internalFormat, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const { format, type } = formatFor(gl, internalFormat);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function formatFor(gl, internalFormat) {
  switch (internalFormat) {
    case gl.RG32UI: return { format: gl.RG_INTEGER, type: gl.UNSIGNED_INT };
    case gl.RGBA32UI: return { format: gl.RGBA_INTEGER, type: gl.UNSIGNED_INT };
    case gl.RGBA32I: return { format: gl.RGBA_INTEGER, type: gl.INT };
    case gl.R32F: return { format: gl.RED, type: gl.FLOAT };
    case gl.RGBA32F: return { format: gl.RGBA, type: gl.FLOAT };
    case gl.R8UI: return { format: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE };
    case gl.RGBA8: return { format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    default: throw new Error('createTexture2D: unhandled internalFormat');
  }
}

// US-029 tech notes item 9: no WebGL2/software-renderer fallback matrix
// (architecture.md 14.1 item 7) uses `WEBGL_debug_renderer_info` when
// present (the real GPU name), else the generic `RENDERER` string (already
// masked to something like "Mesa" on some drivers - still useful for the
// regex below).
export function isSoftwareRenderer(gl) {
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) {
    renderer = '';
  }
  return { isSoftware: /SwiftShader|llvmpipe|Basic Render/i.test(renderer || ''), renderer: renderer || '(unknown)' };
}
