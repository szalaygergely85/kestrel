// WG-3d: shadow.wgsl.js string rules, uniform layout, the terrain footprint carve (inStructFoot) evaluated in JS (wgslProbe)
// against an independent twin of rasterJS.js insideStructFoot, mutation-checked. The depth-copy bits path is checked as the
// literal bitcast of a float32 depth (the exactness gpuCompare relies on). node engine/render/gpu/wgsl/shadow.wgsl.test.js
import assert from 'node:assert/strict';
import { SHADOW_WGSL, SHADOW_TERRAIN_WGSL, SHADOW_DEPTH_COPY_WGSL, SHADOW_TERRAIN_BLOCK, SHADOW_TEXTURES, SHADOW_TARGETS,
  SHADOW_DEPTH_COPY_TEXTURES, SHADOW_DEPTH_COPY_TARGETS } from './shadow.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { SHADOW_Z_LINE, RASTER_Z_LINE, RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_SHADOW_WGSL, RASTER_VOXEL_SHADOW_WGSL,
  RASTER_INSTANCED_SHADOW_WGSL, RASTER_CLOTH_SHADOW_WGSL, toShadowVertexWgsl } from './raster.wgsl.js';
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
assert.deepEqual(['model', 'viewProj', 'structCount', 'structFoot'].map((n) => SHADOW_TERRAIN_BLOCK.field(n).offset), [0, 64, 128, 144]);
assert.equal(SHADOW_TERRAIN_BLOCK.sizeBytes, 144 + MAX_STRUCTS * 16);
assert.ok(/@vertex fn vs_main/.test(SHADOW_TERRAIN_WGSL) && SHADOW_TERRAIN_WGSL.includes(SHADOW_Z_LINE), 'terrain shadow module owns its vs_main with the shadow z line');
assert.ok(!SHADOW_TERRAIN_WGSL.includes(RASTER_Z_LINE), 'no [0,1] raster z line in the terrain shadow vertex stage');

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
// ---- 38.5 item 6: shadow vertex variants map depth into [0.5, 1] so the float32 depth-bias unit is a constant 2^-24 ----
for (const [n, raster, shadow] of [['static', RASTER_WGSL, RASTER_SHADOW_WGSL], ['voxel', RASTER_VOXEL_WGSL, RASTER_VOXEL_SHADOW_WGSL],
  ['instanced', RASTER_INSTANCED_WGSL, RASTER_INSTANCED_SHADOW_WGSL], ['cloth', RASTER_CLOTH_WGSL, RASTER_CLOTH_SHADOW_WGSL]]) {
  assert.equal(raster.split(RASTER_Z_LINE).length, 2, n + ': raster has exactly one z line');
  assert.equal(shadow.split(SHADOW_Z_LINE).length, 2, n + ': shadow variant has exactly one shadow z line');
  assert.ok(!shadow.includes(RASTER_Z_LINE), n + ': no [0,1] z line left');
  assert.equal(shadow.replace(SHADOW_Z_LINE, RASTER_Z_LINE), raster, n + ': nothing else differs from the raster stage');
}
assert.throws(() => toShadowVertexWgsl('no z line here'), /exactly one/);
assert.throws(() => toShadowVertexWgsl(RASTER_Z_LINE + RASTER_Z_LINE), /exactly one/);
const zFn = (line) => new Function('o', line.replace(/o.pos.z = /, 'o.pos.z = ').replace(/o.pos.z/g, 'o.pos.z').replace(/o.pos.w/g, 'o.pos.w'));
const shadowZ = zFn(SHADOW_Z_LINE), f32r = Math.fround;
const ULP24 = 2 ** -24, f32b = new Float32Array(1), u32b = new Uint32Array(f32b.buffer);
const nextUp = (d) => { f32b[0] = d; u32b[0]++; return f32b[0]; };
let worst = 0, unitMin = Infinity, unitMax = 0;
for (let i = 0; i <= 4000; i++) {
  const sd = i / 4000;                 // the twin's [0,1] depth (= (clipZ/clipW + 1) / 2)
  const w = 0.1 + rand() * 500, o = { pos: { x: 0, y: 0, z: (2 * sd - 1) * w, w } };
  shadowZ(o);
  const depth = f32r(o.pos.z / w), want = 0.5 + 0.5 * sd;
  worst = Math.max(worst, Math.abs(depth - want) / ULP24);
  const unit = nextUp(depth) - depth;  // size of one depth-bias unit at this depth
  unitMin = Math.min(unitMin, unit); unitMax = Math.max(unitMax, unit);
}
assert.ok(worst <= 2, 'vsDepth == 0.5 + 0.5*sd within ~1 ULP (worst ' + worst.toFixed(3) + ' ULP of 2^-24)');
assert.ok(unitMin === ULP24 && unitMax === ULP24 || unitMax <= ULP24 * 2 && unitMin >= ULP24, 'depth-bias unit is constant 2^-24 over z (' + unitMin + '..' + unitMax + ')');
{ // the old [0,1] mapping is NOT constant (what this change fixes): a unit near 0 is far smaller than near 1
  const rasterZ = zFn(RASTER_Z_LINE); const unitAt = (sd) => { const o = { pos: { z: (2 * sd - 1) * 10, w: 10 } }; rasterZ(o); const d = f32r(o.pos.z / 10); return nextUp(d) - d; };
  assert.ok(unitAt(0.9) / unitAt(0.01) >= 32, 'raster mapping: bias unit drifts with depth');
}
console.log(`shadow.wgsl.test.js: string/layout rules, ${base.n} inStructFoot probes vs insideStructFoot twin (${base.hits} inside), 3 mutations caught, 500 depth bit copies exact.`);
