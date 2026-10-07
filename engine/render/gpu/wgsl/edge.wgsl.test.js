// WG-3c: edge.wgsl.js string rules, uniform layout, and decideRule (+ isVert/isUp/farther/kindAt/...) evaluated in JS (wgslProbe)
// against the JS twin edgePass.js edgeRules over random kind/face/plane/depth grids incl. kind 8/9. Mutation-checked.
// Not probed (no vec3 shim): the fs_main byte-gain tail; covered by the compile check + the WG-3 gpucompare rows.
// node engine/render/gpu/wgsl/edge.wgsl.test.js
import assert from 'node:assert/strict';
import { EDGE_WGSL, EDGE_BLOCK, EDGE_TEXTURES, EDGE_TARGETS } from './edge.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, makeTex, shims } from './wgslProbe.js';
import { edgeRules } from '../../edgePass.js';
import { KIND_MODEL, KIND_MESH, KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';

// --- string rules ---
assert.ok(WGSL_MODULES.some((m) => m.name === 'edge' && m.code === EDGE_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec|\bint\(/.test(EDGE_WGSL), 'no raw % / GLSL names');
assert.ok(/fn vs_main/.test(EDGE_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\) -> FO/.test(EDGE_WGSL));
assert.ok(/@location\(0\) fg: vec4f/.test(EDGE_WGSL) && /@location\(1\) bg: vec4f/.test(EDGE_WGSL));
assert.deepEqual(EDGE_TEXTURES, ['uint', 'uint', 'float', 'float', 'uint']);
assert.deepEqual(EDGE_TARGETS, ['rgba8', 'rgba8']);
['texture_2d<u32>', 'texture_2d<u32>', 'texture_2d<f32>', 'texture_2d<f32>', 'texture_2d<u32>'].forEach((t, i) =>
  assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${t.replace(/[<>]/g, '\\$&')}`).test(EDGE_WGSL), `binding ${i}`));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: EdgeU/.test(EDGE_WGSL));
assert.ok(EDGE_WGSL.includes(`kind == ${KIND_MODEL}u || kind == ${KIND_MESH}u`), 'A7: kind 9 in isVert/isUp (interpolated from GBuffer.js)');
assert.ok(EDGE_WGSL.includes('* 1.18 + 0.35') && EDGE_WGSL.includes('* 1.08'), 'farther / seam constants');
assert.ok(EDGE_WGSL.includes('0x7f800000u') && /textureLoad\(uWater/.test(EDGE_WGSL));

// --- uniform layout ---
const w = (n) => EDGE_BLOCK.field(n).word;
assert.deepEqual(['gridCols', 'fogMax', 'waterOn', 'terrainFogStart', 'pitchC', 'edgeGlyph', 'edgeGain', 'wos'].map(w), [0, 2, 4, 8, 12, 16, 24, 32]);
assert.equal(EDGE_BLOCK.field('edgeGlyph').words, 8);
assert.equal(EDGE_BLOCK.field('wos').words, 24);
assert.equal(EDGE_BLOCK.sizeBytes, 224);

// --- decideRule vs edgeRules ---
let seed = 31;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const f2u = (x) => { f32[0] = x; return u32[0]; };
// lenient textureLoad (select() evaluates both arms in the JS shim; GPU textureLoad out of range returns 0)
const tl = (tex, c) => { const t = tex.data[c.y * tex.w + c.x]; return t && c.x >= 0 && c.y >= 0 && c.x < tex.w ? { x: t[0], y: t[1], z: t[2], w: t[3] } : { x: 0, y: 0, z: 0, w: 0 }; };

function mismatches(src, trials) {
  let bad = 0, cells = 0;
  const hist = new Array(9).fill(0);
  for (let t = 0; t < trials; t++) {
    const cols = 14, rows = 10, n = cols * rows;
    const kind = new Uint8Array(n), face = new Uint8Array(n), plane = new Int32Array(n), depth = new Float32Array(n);
    const gi = [], dp = [];
    for (let i = 0; i < n; i++) {
      kind[i] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 8][Math.floor(rand() * 12)];
      face[i] = 1 + Math.floor(rand() * 7);
      plane[i] = Math.floor(rand() * 3);
      depth[i] = Math.fround(rand() < 0.5 ? 5 + Math.floor(rand() * 3) * 0.2 : 2 + rand() * 30);
      gi.push([plane[i] >>> 0, (kind[i] | (face[i] << 8)) >>> 0, 0, 0]); dp.push([f2u(depth[i]), 0, 0, 0]);
    }
    const want = new Uint8Array(n);
    edgeRules(kind, plane, face, depth, new Float32Array(n), cols, rows, 1, null, want);
    const ctx = { textureLoad: tl, uGI: makeTex(cols, rows, gi), uDepth: makeTex(cols, rows, dp), u: { gridCols: cols, gridRows: rows } };
    const fns = { ...shims, ...ctx };
    for (const name of ['giKind', 'giFace']) fns[name] = shims[name] || ((y) => (name === 'giKind' ? y & 0xff : (y >>> 8) & 0xf));
    fns.isVert = compileFn(src, 'isVert', fns); fns.isUp = compileFn(src, 'isUp', fns);
    for (const nm of ['kindAt', 'faceAt', 'planeAt', 'depthAt']) fns[nm] = compileFn(src, nm, fns);
    fns.farther = compileFn(src, 'farther', fns);
    const decide = compileFn(src, 'decideRule', fns);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!kind[i]) continue;
      const got = decide({ x, y }, kind[i], face[i], depth[i]);
      cells++; hist[got]++;
      if (got !== want[i]) bad++;
    }
  }
  return { bad, cells, hist };
}
// shims lacks giFace: provide via the WGSL (GBUF_UNPACK) bodies
const base = mismatches(EDGE_WGSL, 40);
assert.equal(base.bad, 0, `decideRule vs edgeRules: ${base.bad}/${base.cells} differ`);
assert.ok(base.hist.slice(1).every((c) => c > 0), 'every rule 1..8 occurs: ' + base.hist.join(','));

// --- mutation checks: the probe must catch each change ---
const mut = (from, to) => { assert.ok(EDGE_WGSL.includes(from), 'mutation anchor ' + from); return EDGE_WGSL.replace(from, to); };
assert.ok(mismatches(mut('* 1.18 + 0.35', '* 1.19 + 0.35'), 10).bad > 0, 'mutation: farther factor');
assert.ok(mismatches(mut(`(kind == ${KIND_MODEL}u || kind == ${KIND_MESH}u) && face == ${5}u`, `kind == ${KIND_MODEL}u && face == ${5}u`), 10).bad > 0, 'mutation: kind 9 dropped from isUp');
assert.ok(mismatches(mut('depthAt(dn) <= distRaw * 1.08', 'depthAt(dn) <= distRaw * 1.09'), 20).bad > 0, 'mutation: seam floor factor');
void KIND_TERRAIN; void FACE_PACKED;
console.log(`edge.wgsl.test.js: string/layout rules, ${base.cells} decideRule cells vs edgeRules (rules ${base.hist.slice(1).join('/')}), 3 mutations caught.`);
