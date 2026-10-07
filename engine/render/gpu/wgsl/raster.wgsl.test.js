// WG-2b: scalar WGSL helpers evaluated against their shipped JS/GLSL oracles before browser checks.
import assert from 'node:assert/strict';
import { packNormalOct, unpackNormalOct } from '../../../voxel/octNormal.js';
import { meshFragSrc } from '../glsl/mesh.frag.js';
import { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_BASE_BLOCK, RASTER_BLOCK } from './raster.wgsl.js';

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
console.log('raster.wgsl.test.js: 2000 oracle probes and shader/layout checks passed.');
