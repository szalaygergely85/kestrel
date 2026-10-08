// WG-2b: scalar WGSL helpers evaluated against their shipped JS/GLSL oracles before browser checks.
import assert from 'node:assert/strict';
import { packNormalOct, unpackNormalOct } from '../../../voxel/octNormal.js';
import { meshFragSrc } from '../glsl/mesh.frag.js';
import { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_MASK_WGSL, RASTER_MASK_SHADOW_WGSL, MASK_TEXEL_WGSL, RASTER_BASE_BLOCK, RASTER_BLOCK, RASTER_MASK_BLOCK } from './raster.wgsl.js';
import { MaskAtlas } from '../../MaskAtlas.js';

function body(src, name, wgsl = true) {
  const head = wgsl ? new RegExp('fn ' + name + '\\(([^)]*)\\)\\s*->[^\\{]+\\{') : new RegExp('float ' + name + '\\(([^)]*)\\)\\s*\\{');
  const m = src.match(head); assert.ok(m, name);
  const start = m.index + m[0].length; let level = 1, end = start;
  for (; level; end++) { if (src[end] === '{') level++; if (src[end] === '}') level--; }
  const params = m[1].split(',').map(p => wgsl ? p.split(':')[0].trim() : p.trim().split(/\s+/)[1]).join(',');
  let code = src.slice(start, end - 1);
  code = code.replace(/(0x[\da-f]+|\d+)u\b/gi, '$1').replace(/\bAO_WALL\b/g, '1').replace(/\bAO_PLANE\b/g, '2');
  if (!wgsl) code = code.replace(/\bfloat\b(?!\s*\()/g, 'let').replace(/\bint\b(?!\s*\()/g, 'let').replace(/\bfloat\(/g, 'f32(').replace(/\bint\(/g, 'i32(');
  return new Function('select', 'vec3f', 'normalize', 'u32', 'f32', 'i32', 'abs', 'floor', 'clamp', 'max', 'min', `return function(${params}){${code}};`)(
    (a, b, c) => c ? b : a, (x, y, z) => ({ x, y, z }),
    n => { const s = Math.hypot(n.x, n.y, n.z); return { x: n.x / s, y: n.y / s, z: n.z / s }; },
    x => x >>> 0, Number, x => Math.trunc(x), Math.abs, Math.floor, (x, lo, hi) => Math.min(hi, Math.max(lo, x)), Math.max, Math.min);
}
const pack = body(RASTER_WGSL, 'packNormalOct'), unpack = body(RASTER_WGSL, 'unpackNormalOct');
let seed = 42;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const out = new Float64Array(3);
for (let i = 0; i < 1000; i++) {
  const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
  const expected = packNormalOct(x, y, z), actual = pack({ x, y, z }) >>> 0;
  assert.equal(actual, expected, 'oct pack operation order and lower-hemisphere fold');
  unpackNormalOct(expected, out); const n = unpack(expected);
  assert.ok(Math.abs(n.x - out[0]) < 1e-14 && Math.abs(n.y - out[1]) < 1e-14 && Math.abs(n.z - out[2]) < 1e-14);
}
const ao = body(RASTER_WGSL, 'computeAoD'), glAo = body(meshFragSrc(), 'computeAoD', false);
// GLSL symbolic AO constants are replaced by their shared literal mode values for the probe.
for (let i = 0; i < 1000; i++) {
  const args = [i % 3, rand() * 3, rand() * 4, rand(), rand() * 5, rand() * 3, rand() * 3, rand()];
  assert.equal(ao(...args), glAo(...args));
}
for (const src of [RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL]) {
  assert.ok(src.includes('o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);'));
  assert.ok(src.includes('let dist = 1.0 / v.pos.w;'));
  assert.ok(src.includes('bitcast<u32>(v.vUV.x)'));
  assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
}
assert.ok(!RASTER_VOXEL_WGSL.includes('@location(4) aAux'), 'compact voxel vertices have no generic attributes in WebGPU');
assert.ok(RASTER_CLOTH_WGSL.includes('if (!front) { nrmW = -nrmW; }'));
assert.equal(RASTER_BASE_BLOCK.sizeBytes, 160); assert.equal(RASTER_BLOCK.sizeBytes, 304);
assert.equal(RASTER_BLOCK.field('teamMat').word, 44, 'uniform vec4 team rows preserve GL team*4+slot addressing');
// ALPHA-01c: the mask texel rule (maskTexel / maskDiscard) vs MaskAtlas.texel / MaskAtlas.sample (the rasterJS oracle) on a 4x4 checker.
// The WGSL text is checked literally; its f32 evaluation is emulated with Math.fround at every WGSL op (u - floor(u) is exact in f32 except
// for tiny negatives, where it rounds to 1.0: both land on the clamp w-1).
for (const line of ['let tc = c - floor(c);', 'let t = u32(floor(tc * f32(w)));', 'return min(t, w - 1u);', 'return a < cut;']) assert.ok(MASK_TEXEL_WGSL.includes(line), line);
const f = Math.fround;
const texelW = (c, w) => { c = f(c); const tc = f(c - Math.floor(c)); return Math.min(Math.floor(f(tc * w)), w - 1); };
const checker = new Uint8Array(16);
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) checker[j * 4 + i] = (i + j) % 2 === 0 ? 255 : 0;
const atlas = new MaskAtlas(); atlas.add('t/dummy', 2, 2, new Uint8Array([255, 255, 255, 255])); atlas.add('t/checker', 4, 4, checker);
const rc = atlas.rect('t/checker'), CUT = 128;
let texelProbes = 0, discards = 0;
const specials = [0, 1, -1, 0.25, 0.5, 0.75, 1 - 2 ** -24, -(2 ** -30), 0.1 + 0.2, 2.5, -0.25, 1e-9, -1e-9];
const probe = (cu, cv) => {
  for (const [c, w] of [[cu, rc.w], [cv, rc.h]]) { assert.equal(texelW(c, w), MaskAtlas.texel(c, w), 'texel ' + c + '/' + w); texelProbes++; }
  const a = atlas.sample(rc.x0, rc.y0, rc.w, rc.h, cu, cv);
  const aw = checker[texelW(cv, rc.h) * rc.w + texelW(cu, rc.w)];
  assert.equal(aw < CUT, a < CUT, 'discard ' + cu + ',' + cv); if (a < CUT) discards++;
};
for (const cu of specials) for (const cv of specials) probe(cu, cv);
for (let i = 0; i < 20000; i++) probe(rand() * 6 - 3, rand() * 6 - 3);
for (let k = -8; k <= 8; k++) for (const e of [-1, 0, 1]) { const c = k / 4 + e * 2 ** -22; probe(c, c); probe(c, 0.3); }
assert.ok(discards > 1000 && discards < 19000 * 1.0, 'both outcomes exercised: ' + discards);
// shader text: static layout + location 10 uv stream + texMask (R8UI, textureLoad only) + two-sided flip, and the shadow module's discard-only fragment
assert.ok(RASTER_MASK_WGSL.includes('@location(10) aUVMask: vec2f') && RASTER_MASK_WGSL.includes('@location(4) aAux0123'), 'static 64 B layout + location 10');
assert.ok(RASTER_MASK_WGSL.includes('@group(0) @binding(0) var texMask: texture_2d<u32>;') && RASTER_MASK_WGSL.includes('textureLoad(texMask'));
assert.ok(RASTER_MASK_WGSL.includes('if (maskDiscard(v.vUVMask, u.maskX0, u.maskY0, u.maskW, u.maskH, u.maskCut)) { discard; }'));
assert.ok(RASTER_MASK_WGSL.indexOf('maskDiscard(v.vUVMask') < RASTER_MASK_WGSL.indexOf('out.GI = '), 'discard before any output');
assert.ok(RASTER_MASK_WGSL.includes('var nm = normalize(v.vNrmS); if (!front) { nm = -nm; }'), 'two-sided flip on masked ranges');
assert.ok(RASTER_MASK_SHADOW_WGSL.includes('fn fs_mask_shadow(v: VertexOut)') && RASTER_MASK_SHADOW_WGSL.includes('o.pos.z = 0.25 * (o.pos.z + o.pos.w) + 0.5 * o.pos.w;'));
for (const src of [RASTER_MASK_WGSL, RASTER_MASK_SHADOW_WGSL]) assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
for (const src of [RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL]) assert.ok(!/texMask|aUVMask|maskDiscard/.test(src), 'opaque variants are unchanged');
assert.equal(RASTER_MASK_BLOCK.field('maskX0').word, 38); assert.equal(RASTER_MASK_BLOCK.sizeBytes, 176);
console.log(`raster.wgsl.test.js: 2000 oracle probes, ${texelProbes} mask texel probes (${discards} discards) and shader/layout checks passed.`);
