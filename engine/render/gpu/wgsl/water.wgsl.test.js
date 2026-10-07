// WG-3e: water.wgsl.js (clipmap vertex + fragment) + waterComposite.wgsl.js string rules, uniform layout, constants parity with the GLSL twins
// (numericLiterals sets), and JS-evaluated (wgslProbe) probes vs the JS oracles: waterInside (region shape test of rasterWaterTri: rect half-open,
// circle inclusive, sheet always) and diamondAngle (waterLook.js). Mutation-checked. Not probed (no vec3/vec4 shim): fs_main bodies, composite glyph/
// flow/shore/fog math -> compile check + the WG gpucompare water rows. node engine/render/gpu/wgsl/water.wgsl.test.js
import assert from 'node:assert/strict';
import { WATER_WGSL, WATER_BLOCK, WATER_TEXTURES, WATER_TARGETS } from './water.wgsl.js';
import { WATER_COMPOSITE_WGSL, WATER_COMPOSITE_BLOCK, WATER_COMPOSITE_TEXTURES, WATER_COMPOSITE_TARGETS } from './waterComposite.wgsl.js';
import { WATER_VERT_SRC } from '../glsl/water.vert.js';
import { WATER_FRAG_SRC } from '../glsl/water.frag.js';
import { WATER_COMPOSITE_FRAG_SRC } from '../glsl/waterComposite.frag.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, shims, numericLiterals } from './wgslProbe.js';
import { diamondAngle, WL_SLOTS, WL_STRIDE, WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT } from '../../waterLook.js';

const BAD = /%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|gl_FrontFacing|\bmod\s*\(|ivec2|uvec|\bint\(|floatBitsToUint|uintBitsToFloat|\bmix\s*\(/;
for (const [n, c] of [['water', WATER_WGSL], ['waterComposite', WATER_COMPOSITE_WGSL]]) {
  assert.ok(WGSL_MODULES.some((m) => m.name === n && m.code === c), 'registered ' + n);
  assert.ok(!BAD.test(c), 'no raw % / GLSL names in ' + n);
  assert.ok(!/\b(ref|type|meta|filter|target|set|shared|common|from|pass|mod)\b\s*[:=]/.test(c.replace(/\/\/[^\n]*/g, '')), 'no reserved WGSL words as identifiers in ' + n);
}

// --- water: raster rules + layout ---
assert.equal((WATER_WGSL.match(/o\.pos\.y = -o\.pos\.y; o\.pos\.z = 0\.5 \* \(o\.pos\.z \+ o\.pos\.w\);/g) || []).length, 2, 'both vertex exits flip y / remap z');
assert.ok(/fn vs_main\(@location\(0\) aL: vec4f\)/.test(WATER_WGSL) && /@builtin\(front_facing\) front: bool/.test(WATER_WGSL));
assert.ok(/let vD = 1\.0 \/ v\.pos\.w;/.test(WATER_WGSL) && /if \(!\(vD < sceneD\)\) \{ discard;/.test(WATER_WGSL), 'vD = 1/w and strict occluder test');
assert.ok(/let back = select\(1u, 0u, front\);/.test(WATER_WGSL) && /wu\.slot \| \(back << 4u\) \| select\(0u, 32u, wu\.kind == 2\)/.test(WATER_WGSL), 'slot | back << 4 | sheet << 5');
assert.ok(/packNormalOct\(vec3f\(0\.0, 0\.0, 1\.0\)\)/.test(WATER_WGSL) && /bitcast<u32>\(v\.vArc\)/.test(WATER_WGSL));
assert.ok(/@group\(0\) @binding\(0\) var uSceneDepth: texture_2d<u32>/.test(WATER_WGSL) && /@group\(1\) @binding\(0\) var<uniform> wu: WaterU/.test(WATER_WGSL));
assert.deepEqual(WATER_TEXTURES, ['uint']); assert.deepEqual(WATER_TARGETS, ['rgba32uint']);
assert.deepEqual(['mvp', 'aabb', 'shape', 'z', 'kind', 'slot'].map((n) => WATER_BLOCK.field(n).offset), [0, 64, 80, 96, 100, 104]);
assert.equal(WATER_BLOCK.sizeBytes, 112);
// constants / ops parity with GLSL (water.vert + water.frag bodies)
const glslWater = WATER_VERT_SRC.slice(WATER_VERT_SRC.indexOf('void main')) + WATER_FRAG_SRC.slice(WATER_FRAG_SRC.indexOf('void main'));
const wgslWater = WATER_WGSL.slice(WATER_WGSL.indexOf('@vertex'));
const litEq = (a, b, what) => assert.deepEqual([...numericLiterals(a)].sort((x, y) => x - y), [...numericLiterals(b)].sort((x, y) => x - y), what);
// WGSL adds the y/z raster remap (0.5) the GLSL does not have
const gW = numericLiterals(glslWater), wW = numericLiterals(wgslWater); wW.delete(0.5);
assert.deepEqual([...gW].sort((x, y) => x - y), [...wW].sort((x, y) => x - y), 'water literals');
assert.ok(WATER_FRAG_SRC.includes('inside = vL.x >= uShape.x && vL.x < uShape.z && vL.y >= uShape.y && vL.y < uShape.w;'));

// --- waterInside vs the rasterWaterTri rule (independent oracle: rect half-open, circle inclusive, sheet always) ---
let seed = 11;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const oracle = (kind, s, x, y) => (kind === 2 ? true : kind === 0 ? (x >= s.x && x < s.z && y >= s.y && y < s.w) : ((x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) <= s.z));
function runInside(src, trials) {
  const patched = src.replace('let d = vL - shape.xy;', 'let d = vsub(vL, shape);');
  const f = compileFn(patched, 'waterInside', { ...shims, vsub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }), dot: (a, b) => a.x * b.x + a.y * b.y });
  let bad = 0, hits = 0, n = 0;
  for (let t = 0; t < trials; t++) {
    const kind = Math.floor(rand() * 3);
    const x0 = Math.floor(rand() * 20), y0 = Math.floor(rand() * 20);
    const s = kind === 1 ? { x: x0, y: y0, z: 25 + Math.floor(rand() * 40), w: 0 } : { x: x0, y: y0, z: x0 + 1 + Math.floor(rand() * 8), w: y0 + 1 + Math.floor(rand() * 8) };
    for (let k = 0; k < 20; k++) {
      // integer-valued points hit exact rect edges and exact circle radii (3-4-5, 5-12-13 ...)
      const px = rand() < 0.5 ? Math.floor(rand() * 40) - 5 : rand() * 40 - 5, py = rand() < 0.5 ? Math.floor(rand() * 40) - 5 : rand() * 40 - 5;
      const want = oracle(kind, s, px, py), got = f(kind, s, { x: px, y: py });
      n++; if (want) hits++; if (got !== want) bad++;
    }
  }
  return { bad, hits, n };
}
const base = runInside(WATER_WGSL, 400);
assert.equal(base.bad, 0, `waterInside mismatches ${base.bad}/${base.n}`);
assert.ok(base.hits > 500 && base.hits < base.n - 500, 'both outcomes occur ' + base.hits + '/' + base.n);
const mutW = (a, b) => { assert.ok(WATER_WGSL.includes(a), 'anchor ' + a); return WATER_WGSL.replace(a, b); };
assert.ok(runInside(mutW('vL.x < shape.z', 'vL.x <= shape.z'), 400).bad > 0, 'mutation: closed rect upper edge');
assert.ok(runInside(mutW('vL.y >= shape.y', 'vL.y > shape.y'), 400).bad > 0, 'mutation: open rect lower edge');
assert.ok(runInside(mutW('dot(d, d) <= shape.z', 'dot(d, d) < shape.z'), 400).bad > 0, 'mutation: open circle');
assert.ok(runInside(mutW('if (kind == 2) { inside = true; }', 'if (kind == 2) { inside = false; }'), 400).bad > 0, 'mutation: sheet region');

// --- waterComposite: layout, bindings, constants ---
const C = WATER_COMPOSITE_BLOCK;
assert.deepEqual(['gridCols', 'sunMapOn', 'projMode', 'sunDir', 'ambientI', 'sunI', 'posX', 'dirX', 'horizonRow', 'timeSec', 'pitchA', 'pitchB', 'pitchC', 'wl', 'wfog'].map((n) => C.field(n).offset),
  [0, 8, 12, 16, 28, 32, 36, 48, 64, 72, 80, 96, 112, 128, 128 + WL_SLOTS * WL_STRIDE * 4]);
assert.equal(C.field('wl').count, WL_SLOTS * (WL_STRIDE / 4)); assert.equal(C.field('wfog').count, 5);
assert.equal(C.sizeBytes, 128 + (WL_SLOTS * (WL_STRIDE / 4) + 5) * 16);
assert.deepEqual(WATER_COMPOSITE_TEXTURES, ['float', 'float', 'uint', 'uint', 'uint', 'uint']);
assert.deepEqual(WATER_COMPOSITE_TARGETS, ['rgba8', 'rgba8']);
const kinds = { float: 'texture_2d<f32>', uint: 'texture_2d<u32>' };
WATER_COMPOSITE_TEXTURES.forEach((k, i) => assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${kinds[k].replace(/[<>]/g, '\\$&')}`).test(WATER_COMPOSITE_WGSL), 'binding ' + i));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> wu: WaterCompositeU/.test(WATER_COMPOSITE_WGSL));
assert.ok(/@location\(0\) fg: vec4f, @location\(1\) bg: vec4f/.test(WATER_COMPOSITE_WGSL));
for (const salt of [WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT]) assert.ok(WATER_COMPOSITE_WGSL.includes(`, ${salt}`), 'salt ' + salt);
assert.ok(WATER_COMPOSITE_WGSL.includes(`${WATER_HASH_SALT} + 31 * tick`), 'tick salt');
assert.ok(/umod\(h, u32\(nGlyph\)\)/.test(WATER_COMPOSITE_WGSL) && /umod\(h, 3u\)/.test(WATER_COMPOSITE_WGSL), 'GL uint % through umod');
assert.ok(/if \(w\.x == 0x7f800000u\) \{ return o; \}/.test(WATER_COMPOSITE_WGSL), '+Inf = cleared');
const glslC = WATER_COMPOSITE_FRAG_SRC.slice(WATER_COMPOSITE_FRAG_SRC.indexOf('// US-141a'));
const wgslC = WATER_COMPOSITE_WGSL.slice(WATER_COMPOSITE_WGSL.indexOf('// diamond angle'));
const gC = numericLiterals(glslC), wC = numericLiterals(wgslC);
assert.deepEqual([...gC].filter((v) => !wC.has(v)), [], 'GLSL constants missing in WGSL');
assert.deepEqual([...wC].filter((v) => !gC.has(v)), [], 'WGSL constants not in GLSL');

assert.ok(numericLiterals(wgslC.replaceAll('0.4794', '0.4795')).has(0.4795) && !numericLiterals(wgslC.replaceAll('0.4794', '0.4795')).has(0.4794), 'mutation: literal parity detects a changed constant');

// --- diamondAngle vs waterLook.diamondAngle ---
function runDiamond(src, trials) {
  const f = compileFn(src, 'diamondAngle', shims);
  let bad = 0;
  for (let i = 0; i < trials; i++) {
    const dx = rand() < 0.2 ? 0 : (rand() - 0.5) * 20, dy = rand() < 0.2 ? 0 : (rand() - 0.5) * 20;
    if (Math.abs(f(dx, dy) - diamondAngle(dx, dy)) > 1e-12) bad++;
  }
  return bad;
}
assert.equal(runDiamond(WATER_COMPOSITE_WGSL, 3000), 0, 'diamondAngle exact');
const mutC = (a, b) => { assert.ok(WATER_COMPOSITE_WGSL.includes(a), 'anchor ' + a); return WATER_COMPOSITE_WGSL.replace(a, b); };
assert.ok(runDiamond(mutC('4.0 + p', '4.0 - p'), 3000) > 0, 'mutation: third quadrant');
assert.ok(runDiamond(mutC('2.0 - p', '2.0 + p'), 3000) > 0, 'mutation: left half');
assert.ok(runDiamond(mutC('d < 1.0e-9', 'd < 0.5'), 3000) > 0, 'mutation: epsilon');
console.log(`water.wgsl.test.js: string/layout/literal-parity rules, ${base.n} waterInside probes (${base.hits} inside, 4 mutations caught), 3000 diamondAngle probes (3 mutations caught). water block ${WATER_BLOCK.sizeBytes} B, composite block ${C.sizeBytes} B`);
