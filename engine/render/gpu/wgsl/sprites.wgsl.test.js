// WG-3f: sprites.wgsl.js + overlay.wgsl.js string rules, uniform layout, constants parity with the GLSL twins (numericLiterals sets), and
// JS-evaluated (wgslProbe) probes vs the JS oracles: sprites `fadeJ` vs fadeGlyph (engine/ui/fade.js), overlay `fs_main` (whole fragment stage with
// textureLoad stubs) vs applyOverlay (engine/ui/overlay.js). Mutation-checked. Not probed (no vec3 shim): sprites fs_main sprite loop / fog / dim
// -> compile check + the WG gpucompare sprite/overlay rows. node engine/render/gpu/wgsl/sprites.wgsl.test.js
import assert from 'node:assert/strict';
import { SPRITES_WGSL, SPRITES_BLOCK, SPRITES_TEXTURES, SPRITES_TARGETS } from './sprites.wgsl.js';
import { OVERLAY_WGSL, OVERLAY_TEXTURES, OVERLAY_TARGETS } from './overlay.wgsl.js';
import { spritesFragSrc } from '../glsl/sprites.frag.js';
import { overlayFragSrc } from '../overlayPass.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, shims, numericLiterals } from './wgslProbe.js';
import { fadeGlyph } from '../../../ui/fade.js';
import { applyOverlay, OVL_BIAS_M, OVL_BIAS_REL } from '../../../ui/overlay.js';
import { MAX_SPRITES, SPRITE_NEAR_DEPTH } from '../../sprites.js';

const BAD = /%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec|\bint\(|floatBitsToUint|uintBitsToFloat|\bmix\s*\(/;
for (const [n, c] of [['sprites', SPRITES_WGSL], ['overlay', OVERLAY_WGSL]]) {
  assert.ok(WGSL_MODULES.some((m) => m.name === n && m.code === c), 'registered ' + n);
  assert.ok(!BAD.test(c), 'no raw % / GLSL names in ' + n);
  assert.ok(!/\b(ref|type|meta|filter|target|set|shared|common|from|pass|mod)\b\s*[:=]/.test(c.replace(/\/\/[^\n]*/g, '')), 'no reserved WGSL words as identifiers in ' + n);
  assert.ok(/fn vs_main/.test(c) && /fn fs_main\(@builtin\(position\) frag: vec4f\)/.test(c), n + ' entry points');
}
// no multi-component swizzle stores (WGSL has none)
assert.ok(!/\.(rgb|xyz|xy)\s*[*+\-]?=[^=]/.test(SPRITES_WGSL), 'no swizzle assignment');

// --- sprites: layout, bindings, constants ---
const S = SPRITES_BLOCK;
assert.deepEqual(['count', 'sceneFade', 'fadeMinGain', 'fadeRampLen', 'dimAll', 'dimCount', 'dimMul', 'dimRect'].map((n) => S.field(n).offset), [0, 4, 8, 12, 16, 20, 32, 48]);
assert.equal(S.sizeBytes, 112); assert.equal(S.field('dimRect').count, 4);
assert.equal(SPRITES_TEXTURES.length, 11);
const kinds = { float: 'texture_2d<f32>', uint: 'texture_2d<u32>' };
SPRITES_TEXTURES.forEach((k, i) => assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${kinds[k].replace(/[<>]/g, '\\$&')}`).test(SPRITES_WGSL), 'sprites binding ' + i));
assert.deepEqual(SPRITES_TARGETS, ['rgba8', 'rgba8']);
assert.ok(/@group\(1\) @binding\(0\) var<uniform> su: SpritesU/.test(SPRITES_WGSL));
assert.ok(SPRITES_WGSL.includes(`const MAX_SPRITES: i32 = ${MAX_SPRITES};`) && SPRITES_WGSL.includes(`const SPRITE_NEAR_DEPTH: f32 = ${SPRITE_NEAR_DEPTH};`), 'constants from sprites.js');
const glslS = spritesFragSrc({ depthUint: true }); // identical tokens: skip the GL declarations, compare from main()
const gS = numericLiterals(glslS.slice(glslS.indexOf('void main')));
const wS = numericLiterals(SPRITES_WGSL.slice(SPRITES_WGSL.indexOf('fn fadeJ')));
assert.deepEqual([...gS].filter((v) => !wS.has(v)), [], 'GLSL constants missing in sprites WGSL');
assert.deepEqual([...wS].filter((v) => !gS.has(v)), [], 'sprites WGSL constants not in GLSL');
assert.ok(numericLiterals(SPRITES_WGSL.slice(SPRITES_WGSL.indexOf('fn fadeJ')).replace('254.0', '253.0')).has(253), 'mutation: literal parity detects a changed constant');
for (const frag of ['(t.b & 1u) != 0u', 'p.y < SPRITE_NEAR_DEPTH', '!(p.y < cellDepth) || !(p.y < best)', 'pz > 0.0 && pz < cellDepth && pz < best', 'if (giMask(gy) != 0u) { return o; }']) assert.ok(SPRITES_WGSL.includes(frag), frag);

// --- fadeJ vs fadeGlyph ---
let seed = 3;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
function runFade(src, trials) {
  const fadeJ = compileFn(src, 'fadeJ', shims);
  let bad = 0, n = 0;
  for (let t = 0; t < trials; t++) {
    const rampLen = 2 + Math.floor(rand() * 14);
    const ramp = Array.from({ length: rampLen }, (_, i) => 32 + i * 3);
    const idx = new Uint8Array(128); for (let c = 0; c < 128; c++) idx[c] = Math.floor(rand() * rampLen);
    const lut = { idx, ramp: Uint8Array.from(ramp), minGain: 0.2 };
    for (let k = 0; k < 20; k++) {
      const code = Math.floor(rand() * 128);
      const a = rand() < 0.4 ? Math.floor(rand() * 8) / 8 : rand(); // multiples of 1/8 hit exact .5 ties; a < 1 only (the pass skips a >= 1, fadeGlyph returns the code)
      const want = fadeGlyph(code, a, lut);
      const i = idx[code]; // the GLSL fetches the same lut.idx[code] texel
      const got = lut.ramp[fadeJ(a, i, rampLen - 1)];
      n++; if (got !== want) bad++;
    }
  }
  return { bad, n };
}
const f0 = runFade(SPRITES_WGSL, 300);
assert.equal(f0.bad, 0, `fadeJ mismatches ${f0.bad}/${f0.n}`);
const mutS = (a, b) => { assert.ok(SPRITES_WGSL.includes(a), 'anchor ' + a); return SPRITES_WGSL.replace(a, b); };
assert.ok(runFade(mutS('floor(a * f32(i) + 0.5)', 'floor(a * f32(i))'), 300).bad > 0, 'mutation: no +0.5 (floor instead of round)');
assert.ok(runFade(mutS('floor(a * f32(i) + 0.5)', 'floor(a * f32(i) + 0.6)'), 300).bad > 0, 'mutation: rounding bias');

// --- overlay: layout + whole fs_main vs applyOverlay ---
assert.deepEqual(OVERLAY_TEXTURES, ['float', 'float', 'uint']); assert.deepEqual(OVERLAY_TARGETS, ['rgba8']);
OVERLAY_TEXTURES.forEach((k, i) => assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${kinds[k].replace(/[<>]/g, '\\$&')}`).test(OVERLAY_WGSL), 'overlay binding ' + i));
assert.ok(!/<uniform>/.test(OVERLAY_WGSL), 'overlay has no uniforms');
assert.ok(OVERLAY_WGSL.includes(`const BIAS_M: f32 = ${OVL_BIAS_M.toFixed(6)};`) && OVERLAY_WGSL.includes(`const BIAS_REL: f32 = ${OVL_BIAS_REL.toFixed(6)};`));
assert.ok(overlayFragSrc().includes(`const float BIAS_M = ${OVL_BIAS_M.toFixed(6)};`), 'GLSL twin has the same constants');
const gO = numericLiterals(overlayFragSrc().slice(overlayFragSrc().indexOf('void main')));
const wO = numericLiterals(OVERLAY_WGSL.slice(OVERLAY_WGSL.indexOf('fn overlayHidden')));
assert.deepEqual([...gO].filter((v) => !wO.has(v)), [], 'GLSL constants missing in overlay WGSL');
assert.deepEqual([...wO].filter((v) => !gO.has(v)), [], 'overlay WGSL constants not in GLSL');

function runOverlay(src, trials) {
  // `discard; return o;` -> `return null;` (null = cell not written)
  const patched = src.replace(/discard; return o;/g, 'return null;');
  const hidden = compileFn(patched, 'overlayHidden', { ...shims, BIAS_M: OVL_BIAS_M, BIAS_REL: OVL_BIAS_REL });
  let bad = 0, drawn = 0, skipped = 0, n = 0;
  for (let t = 0; t < trials; t++) {
    const cols = 6, rows = 5, cells = cols * rows;
    const ovl = new Uint8Array(cells * 4), ovlZ = new Float32Array(cells), depth = new Float32Array(cells), touched = [];
    for (let i = 0; i < cells; i++) {
      touched.push(i);
      ovl.set([Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256), rand() < 0.25 ? 0 : 1 + Math.floor(rand() * 94)], i * 4);
      const d = rand() < 0.15 ? 1e6 : rand() < 0.1 ? Infinity : Math.fround(Math.floor(rand() * 40) + (rand() < 0.5 ? 0 : 0.25));
      depth[i] = d;
      const z = rand();
      // exact bias boundary (d + 0.25) and relative-bias boundary, plus 0 = no test, plus random
      ovlZ[i] = z < 0.2 ? 0 : z < 0.4 ? Math.fround(d + 0.25) : z < 0.55 ? Math.fround(d + 0.2501) : z < 0.65 ? 2e6 : Math.fround(Math.floor(rand() * 60));
    }
    const ov = { stats: { cells }, touched: Uint32Array.from(touched), ovl, ovlZ };
    const cpu = { glyphIdx: new Uint8Array(cells), fg: new Uint8Array(cells * 4) };
    applyOverlay(ov, cpu, depth);
    const textureLoad = (tex, c) => {
      const i = c.y * cols + c.x;
      if (tex === 'ovl') return { r: ovl[i * 4] / 255, g: ovl[i * 4 + 1] / 255, b: ovl[i * 4 + 2] / 255, a: ovl[i * 4 + 3] / 255, x: ovl[i * 4] / 255 };
      return { r: ovlZ[i], x: ovlZ[i] };
    };
    const vec2i = (a, b) => (b === undefined ? { x: Math.trunc(a.x), y: Math.trunc(a.y) } : { x: a, y: b }); // GLSL/WGSL int(float) truncates
    const fs = compileFn(patched, 'fs_main', { ...shims, vec2i, textureLoad, uOvl: 'ovl', uOvlZ: 'ovlZ', depthAt: (c) => depth[c.y * cols + c.x], overlayHidden: hidden });
    for (let i = 0; i < cells; i++) {
      const out = fs({ x: (i % cols) + 0.5, y: Math.floor(i / cols) + 0.5 });
      const wrote = cpu.glyphIdx[i] !== 0;
      n++; if (wrote) drawn++; else skipped++;
      if ((out !== null) !== wrote) { bad++; continue; }
      if (out && (Math.round(out.r * 255) !== cpu.fg[i * 4] || Math.round(out.a * 255) !== cpu.glyphIdx[i])) bad++;
    }
  }
  return { bad, drawn, skipped, n };
}
const o0 = runOverlay(OVERLAY_WGSL, 150);
assert.equal(o0.bad, 0, `overlay fs_main mismatches ${o0.bad}/${o0.n}`);
assert.ok(o0.drawn > 300 && o0.skipped > 300, `both outcomes occur ${o0.drawn}/${o0.skipped}`);
const mutO = (a, b) => { assert.ok(OVERLAY_WGSL.includes(a), 'anchor ' + a); return OVERLAY_WGSL.replace(a, b); };
assert.ok(runOverlay(mutO('if (refZ > d + max(BIAS_M, BIAS_REL * refZ))', 'if (refZ >= d + max(BIAS_M, BIAS_REL * refZ))'), 150).bad > 0, 'mutation: closed bias boundary');
assert.ok(runOverlay(mutO('if (d < 1.0e5) {', 'if (d < 1.0e9) {'), 150).bad > 0, 'mutation: sky/horizon depth no longer passes');
assert.ok(runOverlay(mutO('if (refZ > 0.0) {', 'if (refZ > 5.0) {'), 150).bad > 0, 'mutation: depth test skipped for small refs');
assert.ok(runOverlay(mutO('BIAS_REL * refZ', 'BIAS_REL * d'), 150).bad > 0, 'mutation: relative bias off the wrong depth');
assert.ok(runOverlay(mutO('if (g < 0.5) { discard; return o; }', ''), 150).bad > 0, 'mutation: empty cells drawn');
console.log(`sprites.wgsl.test.js: string/layout/literal-parity rules, ${f0.n} fadeJ probes vs fadeGlyph (2 mutations), ${o0.n} overlay fs_main probes vs applyOverlay (${o0.drawn} drawn / ${o0.skipped} skipped, 5 mutations caught). sprites block ${S.sizeBytes} B`);
