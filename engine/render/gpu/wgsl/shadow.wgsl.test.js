// WG-3d: shadow.wgsl.js string rules, uniform layout, the terrain footprint carve (inStructFoot) evaluated in JS (wgslProbe)
// against an independent twin of rasterJS.js insideStructFoot, mutation-checked. The depth-copy bits path is checked as the
// literal bitcast of a float32 depth (the exactness gpuCompare relies on). node engine/render/gpu/wgsl/shadow.wgsl.test.js
import assert from 'node:assert/strict';
import { SHADOW_WGSL, SHADOW_TERRAIN_WGSL, SHADOW_DEPTH_COPY_WGSL, SHADOW_TERRAIN_BLOCK, SHADOW_TEXTURES, SHADOW_TARGETS,
  SHADOW_DEPTH_COPY_TEXTURES, SHADOW_DEPTH_COPY_TARGETS } from './shadow.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, shims } from './wgslProbe.js';
import { MAX_STRUCTS } from '../WorldTextures.js';

for (const [n, c] of [['shadow', SHADOW_WGSL], ['shadowTerrain', SHADOW_TERRAIN_WGSL], ['shadowDepthCopy', SHADOW_DEPTH_COPY_WGSL]]) {
  assert.ok(WGSL_MODULES.some((m) => m.name === n && m.code === c), 'registered ' + n);
  assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|ivec2|uvec/.test(c), 'no raw % / GLSL names in ' + n);
}
assert.ok(/@fragment\s+fn fs_main\(\) \{\}/.test(SHADOW_WGSL), 'static shadow fragment stage is empty (depth only)');
assert.ok(/fn fs_main\(@location\(0\) vWorldPos: vec3f\)/.test(SHADOW_TERRAIN_WGSL) && /discard;/.test(SHADOW_TERRAIN_WGSL));
assert.ok(new RegExp(`const MAX_STRUCTS: i32 = ${MAX_STRUCTS};`).test(SHADOW_TERRAIN_WGSL), 'MAX_STRUCTS from WorldTextures.js');
assert.ok(/@group\(0\) @binding\(0\) var uShadowDepth: texture_depth_2d/.test(SHADOW_DEPTH_COPY_WGSL) && /bitcast<u32>\(textureLoad\(uShadowDepth/.test(SHADOW_DEPTH_COPY_WGSL));
assert.ok(/fn vs_main/.test(SHADOW_DEPTH_COPY_WGSL) && /-> @location\(0\) vec4u/.test(SHADOW_DEPTH_COPY_WGSL));
assert.deepEqual(SHADOW_TEXTURES, []); assert.deepEqual(SHADOW_TARGETS, []);
assert.deepEqual(SHADOW_DEPTH_COPY_TEXTURES, ['depth']); assert.deepEqual(SHADOW_DEPTH_COPY_TARGETS, ['r32uint']);
assert.equal(SHADOW_TERRAIN_BLOCK.field('structFoot').offset, 16);
assert.equal(SHADOW_TERRAIN_BLOCK.sizeBytes, 16 + MAX_STRUCTS * 16);

let seed = 5;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
// independent twin of rasterJS.js insideStructFoot (x0, y0, x1, y1 per struct, half-open boxes)
const insideFoot = (foot, count, x, y) => { for (let i = 0; i < count; i++) { const o = i * 4; if (x >= foot[o] && x < foot[o + 2] && y >= foot[o + 1] && y < foot[o + 3]) return true; } return false; };

function run(src, trials) {
  let bad = 0, hits = 0, n = 0;
  for (let t = 0; t < trials; t++) {
    const count = Math.floor(rand() * (MAX_STRUCTS + 1));
    const foot = new Float64Array(MAX_STRUCTS * 4), rows = [];
    for (let i = 0; i < MAX_STRUCTS; i++) {
      const x0 = Math.floor(rand() * 20), y0 = Math.floor(rand() * 20), x1 = x0 + 1 + Math.floor(rand() * 6), y1 = y0 + 1 + Math.floor(rand() * 6);
      foot.set([x0, y0, x1, y1], i * 4); rows.push({ x: x0, y: y0, z: x1, w: y1 });
    }
    const u = { structCount: count, structFoot: rows };
    const f = compileFn(src, 'inStructFoot', { u, MAX_STRUCTS, ...shims });
    for (let k = 0; k < 40; k++) {
      // include exact box edges (half-open rule) as well as random points
      const px = rand() < 0.3 ? Math.floor(rand() * 26) : rand() * 26, py = rand() < 0.3 ? Math.floor(rand() * 26) : rand() * 26;
      const got = f({ x: px, y: py, z: 3 }), want = insideFoot(foot, count, px, py);
      n++; if (want) hits++; if (got !== want) bad++;
    }
  }
  return { bad, hits, n };
}
const base = run(SHADOW_TERRAIN_WGSL, 60);
assert.equal(base.bad, 0, `inStructFoot mismatches ${base.bad}/${base.n}`);
assert.ok(base.hits > 100 && base.hits < base.n - 100, 'both outcomes occur: ' + base.hits + '/' + base.n);
const mut = (a, b) => { assert.ok(SHADOW_TERRAIN_WGSL.includes(a), 'anchor ' + a); return SHADOW_TERRAIN_WGSL.replace(a, b); };
assert.ok(run(mut('wp.x < b.z', 'wp.x <= b.z'), 60).bad > 0, 'mutation: closed upper x edge');
assert.ok(run(mut('wp.y >= b.y', 'wp.y > b.y'), 60).bad > 0, 'mutation: open lower y edge');
assert.ok(run(mut('if (i >= u.structCount) { break; }', ''), 60).bad > 0, 'mutation: structCount ignored');

// depth copy: bitcast of the float depth is exact for every float32 (what compareShadowDepth reads back)
const bc = compileFn(SHADOW_DEPTH_COPY_WGSL.replace('textureLoad(uShadowDepth, vec2i(floor(frag.xy)), 0)', 'd'), 'fs_main', { ...shims, vec4u: (a, b, c, d) => ({ x: a, y: b, z: c, w: d }) });
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
for (let i = 0; i < 500; i++) { f32[0] = rand(); assert.equal(compileFn(SHADOW_DEPTH_COPY_WGSL.replace('textureLoad(uShadowDepth, vec2i(floor(frag.xy)), 0)', 'dd'), 'fs_main', { ...shims, dd: f32[0], vec2i: shims.vec2i, vec4u: (a, b, c, d) => ({ x: a, y: b, z: c, w: d }) })({ x: 0, y: 0 }).x, u32[0]); }
void bc;
console.log(`shadow.wgsl.test.js: string/layout rules, ${base.n} inStructFoot probes vs insideStructFoot twin (${base.hits} inside), 3 mutations caught, 500 depth bit copies exact.`);
