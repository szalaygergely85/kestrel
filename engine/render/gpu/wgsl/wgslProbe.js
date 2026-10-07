// Test helper (WG-3a): evaluates a restricted WGSL fragment function in JS so Node can compare the ported expressions
// against the JS oracle (same idea as raster.wgsl.test.js, extended to whole fs_main bodies). Handles exactly the
// syntax used by resolve/deriv WGSL: let/var, small vec constructors (objects with x,y,z,w), u32/i32 casts, bitcast,
// select/clamp/floor, textureLoad stubs. Not a general WGSL interpreter; unknown constructs throw in `new Function`.
const f32buf = new Float32Array(1), u32buf = new Uint32Array(f32buf.buffer);

/** Extract the body of `fn name(...) -> ... { ... }` (balanced braces). */
export function fnBody(src, name) {
  const m = src.match(new RegExp('fn ' + name + '\\(((?:[^()]|\\([^()]*\\))*)\\)[^{]*\\{'));
  if (!m) throw new Error('no fn ' + name);
  let level = 1, i = m.index + m[0].length;
  const start = i;
  for (; level; i++) { if (src[i] === '{') level++; else if (src[i] === '}') level--; }
  return { params: m[1].replace(/@\w+\([^)]*\)\s*/g, '').split(',').map((p) => p.split(':')[0].trim()).filter(Boolean), body: src.slice(start, i - 1) };
}

/** WGSL statement text -> JS statement text (see file header for the supported subset). */
export function toJs(code) {
  return code
    .replace(/\bvar (\w+): array<[^,>]+, *(\d+)>;/g, 'let $1 = new Array($2).fill(0);')
    .replace(/\bvar (\w+): (?:f32|i32|u32);/g, 'let $1 = 0;')
    .replace(/\bvar (\w+): \w+;/g, 'let $1 = {};')
    .replace(/\b(var|let) (\w+): \w+ =/g, 'let $2 =')
    .replace(/\bvar /g, 'let ')
    .replace(/length\((\w+)\.xy\)/g, 'Math.hypot($1.x, $1.y)')
    .replace(/\.xy\b/g, '')
    .replace(/\b(0x[0-9a-fA-F]+|\d+)u\b/g, '$1')
    .replace(/>>/g, '>>>')
    .replace(/\/ uN\)/g, '/ uN | 0)')
    .replace(/\ba \/ uN;/g, 'a / uN | 0;')
    .replace(/bitcast<f32>/g, 'bcF32').replace(/bitcast<u32>/g, 'bcU32');
}

export const shims = {
  bcF32: (x) => { u32buf[0] = x >>> 0; return f32buf[0]; },
  bcU32: (x) => { f32buf[0] = x; return u32buf[0]; },
  f32: (x) => Math.fround(x),
  i32: (x) => x | 0,
  u32: (x) => x >>> 0,
  floor: (v) => (typeof v === 'object' ? { x: Math.floor(v.x), y: Math.floor(v.y) } : Math.floor(v)),
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  select: (f, t, c) => (c ? t : f),
  vec2i: (a, b) => (b === undefined ? { x: a.x, y: a.y } : { x: a, y: b }),
  vec4u: (a, b, c, d) => (b === undefined ? { x: a, y: a, z: a, w: a } : { x: a, y: b, z: c, w: d }),
  vec3f: (x, y, z) => (y === undefined ? { x, y: x, z: x } : { x, y, z }),
  vec2f: (x, y) => ({ x, y }),
  abs: Math.abs, sqrt: Math.sqrt, max: Math.max, min: Math.min,
  normalize: (n) => { const s = Math.hypot(n.x, n.y, n.z); return { x: n.x / s, y: n.y / s, z: n.z / s }; },
  giKind: (y) => y & 0xff,
  giMat: (y) => (y >>> 16) & 0xffff,
};

/** Build a JS function from the named WGSL fn of `src`; `extra` = additional bindings (textureLoad, u, ...). */
export function compileFn(src, name, extra, prelude = '') {
  const { params, body } = fnBody(src, name);
  const all = { ...shims, ...extra };
  const names = Object.keys(all);
  const f = new Function(...names, `${prelude}\nreturn function(${params.join(',')}){${toJs(body)}};`);
  return f(...names.map((n) => all[n]));
}

/** Texture stub: `data` = array of [x,y,z,w] at row-major (w x h). */
export function makeTex(w, h, data) { return { w, h, data }; }
export function textureLoad(tex, c) {
  const t = tex.data[c.y * tex.w + c.x];
  if (!t || c.x < 0 || c.y < 0 || c.x >= tex.w || c.y >= tex.h) throw new Error(`textureLoad out of range ${c.x},${c.y}`);
  return { x: t[0], y: t[1], z: t[2], w: t[3] };
}

/**
 * WG-3e/3f: distinct numeric literal values (hex, float, int; u/f suffix ignored; 0 and 1 dropped as structural) of a source text.
 * Used to check that a WGSL body contains exactly the constants of its GLSL twin (a mutated or forgotten constant shows up as a set difference).
 */
export function numericLiterals(src) {
  const out = new Set();
  const re = /\b(0x[0-9a-fA-F]+)u?\b|(?<![\w.])(\d+\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|\d+)[uf]?(?![\w])|(?<![\w])(\.\d+)/g;
  let m;
  while ((m = re.exec(src.replace(/\/\/[^\n]*/g, '')))) {
    const v = Number(m[1] ?? m[2] ?? m[3]);
    if (v !== 0 && v !== 1) out.add(v);
  }
  return out;
}
