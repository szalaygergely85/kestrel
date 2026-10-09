// WG-2b: scalar WGSL helpers evaluated against their shipped JS/GLSL oracles before browser checks.
import assert from 'node:assert/strict';
import { packNormalOct, unpackNormalOct } from '../../../voxel/octNormal.js';
import { meshFragSrc } from './meshFrag.glslref.js';
import { RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_MASK_WGSL, RASTER_MASK_SHADOW_WGSL, MASK_TEXEL_WGSL, RASTER_BASE_BLOCK, RASTER_BLOCK, RASTER_MASK_BLOCK, RASTER_INSTANCED_MASK_WGSL, RASTER_INSTANCED_MASK_BLOCK, RASTER_INSTANCED_MASK_SHADOW_WGSL } from './raster.wgsl.js';
import { MaskAtlas } from '../../MaskAtlas.js';
import { compileFn, makeTex, textureLoad } from './wgslProbe.js';
import { WGSL_MODULES } from './index.js';

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
  assert.ok(src.includes('let dist = select(1.0 / v.pos.w, 0.05 + v.pos.z * (2000.0 - 0.05), u.projMode == 2u);'));
  assert.ok(src.includes('bitcast<u32>(v.vUV.x)'));
  assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
}
assert.ok(!RASTER_VOXEL_WGSL.includes('@location(4) aAux'), 'compact voxel vertices have no generic attributes in WebGPU');
assert.ok(RASTER_CLOTH_WGSL.includes('if (!front) { nrmW = -nrmW; }'));
assert.equal(RASTER_BASE_BLOCK.sizeBytes, 160); assert.equal(RASTER_BLOCK.sizeBytes, 608);
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
// PREC-01a (37.9 step 4): `origin` exists in the instanced variant only; the instanced vertex stage subtracts it from the f32 row translation (x, y) and not from z.
{
  assert.ok(RASTER_INSTANCED_WGSL.includes('origin: vec2f'), 'instanced block carries origin');
  assert.ok(RASTER_INSTANCED_WGSL.includes('(a.iRow0.w - u.origin.x)') && RASTER_INSTANCED_WGSL.includes('(a.iRow1.w - u.origin.y)') && RASTER_INSTANCED_WGSL.includes('dot(a.iRow2.xyz, lp) + a.iRow2.w'));
  assert.ok(RASTER_INSTANCED_WGSL.includes('o.aux4567.z = a.iRow2.w;'), 'vZBase stays absolute (z is not rebased)');
  for (const src of [RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_CLOTH_WGSL, RASTER_MASK_WGSL]) assert.ok(!/origin/.test(src), 'static/voxel/cloth/mask sources are unchanged (rebase is in uModel)');
  assert.equal(RASTER_BLOCK.field('origin').offset, 152, 'origin fills the 8-byte hole after flat; base block stays a prefix, size unchanged');
}
console.log(`raster.wgsl.test.js: 2000 oracle probes, ${texelProbes} mask texel probes (${discards} discards) and shader/layout checks passed.`);

// ALPHA-01f (b): instanced mesh + per-range mask discard. rasterWgsl('instancedMask') must combine the instanced layout
// (locations 6-9, sway, LOD dither) with the mask uv stream (location 10) + texMask discard, exactly like RASTER_MASK_WGSL
// does for the static layout, and must use its own uniform block (instanced fields + the 5 mask fields, RASTER_INSTANCED_MASK_BLOCK)
// rather than silently reusing RASTER_BLOCK (no mask fields) or RASTER_MASK_BLOCK (no origin/team/wind fields).
{
  const src = RASTER_INSTANCED_MASK_WGSL;
  // layout: instanced attributes + location 10 mask uv, same 64 B static stream unaffected (no aAux0123/4567: compact like plain instanced)
  assert.ok(src.includes('@location(10) aUVMask: vec2f') && src.includes('@location(6) iRow0: vec4f') && src.includes('@location(9) iMeta: vec2u'), 'instanced + mask vertex layout');
  assert.ok(!src.includes('@location(4) aAux0123'), 'instanced mask stays compact (no generic aux stream), same as plain instanced');
  assert.ok(src.includes('@group(0) @binding(0) var texMask: texture_2d<u32>;') && src.includes('textureLoad(texMask'), 'texMask bound');
  // reuses the exact, already-probed mask texel rule (no reimplementation)
  assert.ok(src.includes(MASK_TEXEL_WGSL), 'instanced mask variant reuses the exact mask texel rule verbatim');
  // sway + LOD dither (instanced-only features) survive the combination
  assert.ok(src.includes('fn swayDisp(') && src.includes('INST_FLAG_SWAY'), 'sway code present');
  assert.ok(src.includes('fn ditherKeep(') && src.includes('if (!ditherKeep(v.packed.w >> 1u'), 'LOD dither code present');
  // discard ordering: mask discard, then dither discard, both before any G-buffer write
  const iMask = src.indexOf('if (maskDiscard(v.vUVMask'), iDither = src.indexOf('if (!ditherKeep('), iOut = src.indexOf('out.GI = ');
  assert.ok(iMask > 0 && iDither > iMask && iOut > iDither, 'mask discard, then dither discard, then output - in that order');
  // two-sided flip on the masked range (same rule as the static mask variant, using vNrmS not vNrmW)
  assert.ok(src.includes('var nm = normalize(v.vNrmS); if (!front) { nm = -nm; }'), 'two-sided flip on masked instanced ranges');
  assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
  // registered for compilation validation (capture-browser --mode wgsl), append-only
  assert.ok(WGSL_MODULES.some((m) => m.name === 'rasterInstancedMask' && m.code === RASTER_INSTANCED_MASK_WGSL), 'registered in WGSL_MODULES');
  // uniform block: instanced fields (origin/team/wind) + the 5 mask fields appended last, own block (not RASTER_BLOCK, not RASTER_MASK_BLOCK)
  assert.ok(src.includes(RASTER_INSTANCED_MASK_BLOCK.wgsl), 'uses its own combined uniform block literally');
  assert.ok(!src.includes(RASTER_BLOCK.wgsl), 'not the plain instanced block (it has no maskX0..maskCut)');
  assert.ok(!src.includes(RASTER_MASK_BLOCK.wgsl), 'not the static mask block (it has no origin/team/wind)');
  assert.ok(RASTER_INSTANCED_MASK_BLOCK.field('origin').word > 0 && RASTER_INSTANCED_MASK_BLOCK.field('maskX0').word === RASTER_BLOCK.field('projMode').word, 'mask fields appended right after the full instanced field set');
  assert.equal(RASTER_INSTANCED_MASK_BLOCK.sizeBytes, 624);
  // regression: the plain 'instanced' and static 'mask' variants must stay exactly as before this change (no accidental cross-talk)
  assert.ok(!/texMask|aUVMask|maskDiscard/.test(RASTER_INSTANCED_WGSL), 'plain instanced stays unaffected');
  assert.ok(!/iRow0|iRow1|iRow2|iMeta|swayDisp|ditherKeep/.test(RASTER_MASK_WGSL), 'static mask stays unaffected (no instanced attributes/sway/dither)');
}
// mutation test (same style as edge/water.wgsl.test.js's `mut` helper): maskDiscard/maskTexel are shared text with the
// already-probed static mask variant, so re-run the functional probe against the copy embedded in RASTER_INSTANCED_MASK_WGSL
// and show that mutating the cutoff comparison (`<` -> `<=`) is caught by the probe (checker atlas, CUT=0: texel value 0
// ties the cutoff exactly, so the two operators disagree deterministically on every zero cell).
{
  const maskTexelFn = compileFn(RASTER_INSTANCED_MASK_WGSL, 'maskTexel', {});
  const tex = makeTex(4, 4, Array.from(checker, (v) => [v, v, v, v]));
  const vec2u = (a, b) => ({ x: a, y: b });
  const maskDiscardFn = compileFn(RASTER_INSTANCED_MASK_WGSL, 'maskDiscard', { textureLoad, texMask: tex, vec2u, maskTexel: maskTexelFn });
  const CUT0 = 0; // 0 < 0 is false (no discard); a mutated `<=` would discard every zero texel
  let zeroCellsSeen = 0, agree = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    if (checker[j * 4 + i] !== 0) continue; // only the texel-tie case distinguishes < from <=
    zeroCellsSeen++;
    const d = maskDiscardFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0);
    assert.equal(d, false, 'unmutated: a < cut is false when a === cut === 0');
    agree++;
  }
  assert.ok(zeroCellsSeen >= 8, 'checker has enough zero texels to exercise the tie case');
  const mutatedSrc = RASTER_INSTANCED_MASK_WGSL.replace('return a < cut;', 'return a <= cut;');
  assert.notEqual(mutatedSrc, RASTER_INSTANCED_MASK_WGSL, 'mutation anchor found exactly once');
  const maskTexelMutFn = compileFn(mutatedSrc, 'maskTexel', {});
  const maskDiscardMutFn = compileFn(mutatedSrc, 'maskDiscard', { textureLoad, texMask: tex, vec2u, maskTexel: maskTexelMutFn });
  let diffs = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    if (checker[j * 4 + i] !== 0) continue;
    const got = maskDiscardFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0);
    const mut = maskDiscardMutFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0);
    if (got !== mut) diffs++;
  }
  assert.ok(diffs === zeroCellsSeen && diffs > 0, `mutation: cutoff boundary caught on all ${zeroCellsSeen} zero cells (${diffs} diverged)`);
  console.log(`raster.wgsl.test.js (ALPHA-01f b): instanced+mask layout/discard-order/two-sided checks, uniform block offsets, regression guard on the plain instanced/static mask variants, and a ${zeroCellsSeen}-cell cutoff mutation caught.`);
}

// ALPHA-01f (c): instanced masked SHADOW caster. RASTER_INSTANCED_MASK_SHADOW_WGSL = toShadowVertexWgsl(RASTER_INSTANCED_MASK_WGSL):
// same vertex/layout/uniform block as the colour variant (b), only the clip-space z line swapped to the sun-shadow convention
// ([0.5, 1], 38.5 item 6), and the SAME fs_mask_shadow discard-only fragment entry (reused verbatim, not reimplemented) so leaf
// holes let the sun through for instanced mesh groups exactly as they already do for the static masked caster (RASTER_MASK_SHADOW_WGSL).
{
  const src = RASTER_INSTANCED_MASK_SHADOW_WGSL;
  // depth convention: the shadow z line present, the plain raster z line gone (toShadowVertexWgsl swapped it, not duplicated it)
  assert.ok(src.includes('o.pos.z = 0.25 * (o.pos.z + o.pos.w) + 0.5 * o.pos.w;'), 'sun shadow depth convention');
  assert.ok(!src.includes('o.pos.z = 0.5 * (o.pos.z + o.pos.w);'), 'plain raster z line replaced, not duplicated');
  // discard-only fragment entry present and textually identical to the already-probed static mask shadow fragment (same
  // maskDiscard call, same texMask binding rule) - this is what makes leaf holes cast through for instanced groups.
  assert.ok(src.includes('fn fs_mask_shadow(v: VertexOut)'), 'discard-only shadow fragment entry present');
  assert.ok(src.includes('if (maskDiscard(v.vUVMask, u.maskX0, u.maskY0, u.maskW, u.maskH, u.maskCut)) { discard; }\n}\n'), 'fs_mask_shadow body: mask discard only');
  assert.ok(src.includes(MASK_TEXEL_WGSL), 'reuses the exact, already-probed mask texel rule verbatim');
  // layout/uniform block carried over unchanged from the colour variant (same instanced attributes + mask uv stream + own block)
  assert.ok(src.includes('@location(10) aUVMask: vec2f') && src.includes('@location(6) iRow0: vec4f') && src.includes('@location(9) iMeta: vec2u'), 'instanced + mask vertex layout carried over');
  assert.ok(src.includes(RASTER_INSTANCED_MASK_BLOCK.wgsl), 'uses the same combined uniform block as the colour variant (no new block)');
  assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|%/.test(src));
  // registered for compilation validation (capture-browser --mode wgsl), append-only
  assert.ok(WGSL_MODULES.some((m) => m.name === 'rasterShadowInstancedMask' && m.code === RASTER_INSTANCED_MASK_SHADOW_WGSL), 'registered in WGSL_MODULES');
  // regression: the other shadow variants and the colour instancedMask variant are untouched by this addition
  assert.ok(RASTER_MASK_SHADOW_WGSL.includes('fn fs_mask_shadow(v: VertexOut)'), 'static mask shadow variant unaffected');
  assert.ok(!RASTER_MASK_SHADOW_WGSL.includes('iRow0'), 'static mask shadow variant still has no instanced attributes');
  assert.ok(RASTER_INSTANCED_MASK_WGSL.includes('o.pos.z = 0.5 * (o.pos.z + o.pos.w);'), 'colour instancedMask variant keeps the plain raster z line (b unaffected by c)');
  console.log('raster.wgsl.test.js (ALPHA-01f c): instanced masked shadow variant layout/z-convention/fs_mask_shadow checks + regression guards passed.');
}
// mutation test: the shadow variant's maskDiscard/maskTexel text must be the real rule, not a stub that always skips the
// discard (which would make masked leaves cast fully-opaque rectangular shadows again, the exact bug this story prevents).
// Same technique as the colour-variant mutation above (checker atlas, CUT=0 tie case), run against the SHADOW text.
{
  const maskTexelFn = compileFn(RASTER_INSTANCED_MASK_SHADOW_WGSL, 'maskTexel', {});
  const tex = makeTex(4, 4, Array.from(checker, (v) => [v, v, v, v]));
  const vec2u = (a, b) => ({ x: a, y: b });
  const maskDiscardFn = compileFn(RASTER_INSTANCED_MASK_SHADOW_WGSL, 'maskDiscard', { textureLoad, texMask: tex, vec2u, maskTexel: maskTexelFn });
  const CUT0 = 0;
  let zeroCellsSeen = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    if (checker[j * 4 + i] !== 0) continue;
    zeroCellsSeen++;
    assert.equal(maskDiscardFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0), false, 'unmutated shadow maskDiscard: a < cut is false when a === cut === 0');
  }
  // mutation A: cutoff operator widened (`<` -> `<=`) - every zero texel now discards (shadow holes grow)
  const mutCutoff = RASTER_INSTANCED_MASK_SHADOW_WGSL.replace('return a < cut;', 'return a <= cut;');
  assert.notEqual(mutCutoff, RASTER_INSTANCED_MASK_SHADOW_WGSL, 'cutoff mutation anchor found exactly once');
  const maskTexelMutFn = compileFn(mutCutoff, 'maskTexel', {});
  const maskDiscardMutFn = compileFn(mutCutoff, 'maskDiscard', { textureLoad, texMask: tex, vec2u, maskTexel: maskTexelMutFn });
  let diffsA = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    if (checker[j * 4 + i] !== 0) continue;
    if (maskDiscardFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0) !== maskDiscardMutFn({ x: (i + 0.5) / 4, y: (j + 0.5) / 4 }, 0, 0, 4, 4, CUT0)) diffsA++;
  }
  assert.ok(diffsA === zeroCellsSeen && diffsA > 0, `shadow cutoff mutation caught on all ${zeroCellsSeen} zero cells (${diffsA} diverged)`);
  // mutation B: the "mask is ignored" bug itself - fs_mask_shadow's discard call deleted (the shadow caster would then
  // write depth everywhere, same as an opaque mesh: exactly the regression ALPHA-01f (c) must prevent). Caught structurally.
  const mutIgnored = RASTER_INSTANCED_MASK_SHADOW_WGSL.replace('if (maskDiscard(v.vUVMask, u.maskX0, u.maskY0, u.maskW, u.maskH, u.maskCut)) { discard; }\n}\n', '}\n');
  assert.notEqual(mutIgnored, RASTER_INSTANCED_MASK_SHADOW_WGSL, 'mask-ignored mutation anchor found exactly once');
  assert.ok(mutIgnored.includes('fn fs_mask_shadow(v: VertexOut) {\n  }\n'), 'mutated fs_mask_shadow body is now empty (no discard at all)');
  assert.ok(mutIgnored.includes('maskDiscard(v.vUVMask'), 'the colour fragment (fs_main) still has its own, unrelated mask discard - only fs_mask_shadow was mutated');
  console.log(`raster.wgsl.test.js (ALPHA-01f c): shadow mutation tests caught cutoff widening (${diffsA}/${zeroCellsSeen} cells) and the mask-ignored regression.`);
}

// ME-20c (38.18): vertex AO stream + flag word. ao variants only; non-ao text differs from the legacy one by the flag line + '& 1u'.
{
  const { rasterWgsl, RASTER_FLAG_VAO } = await import('./raster.wgsl.js');
  assert.equal(RASTER_FLAG_VAO, 2, 'RASTER_FLAG_VAO === 2');
  for (const v of ['voxel', 'instanced', 'mask', 'instancedMask']) {
    const a = rasterWgsl(v, { ao: true }), n = rasterWgsl(v);
    for (const t of ['@location(11) aAo: f32', '@location(8) vAo: f32', 'o.vAo = a.aAo;', 'bitcast<u32>(v.vAo)']) assert.ok(a.includes(t), v + ': ao variant has ' + t);
    assert.ok(!n.includes('aAo') && !n.includes('vAo'), v + ': non-ao variant has no AO stream');
    assert.ok(n.includes('gaW = bitcast<u32>(1.0)'), v + ': non-ao writes 1.0 when the flag is set');
  }
  for (const v of ['static', 'cloth']) assert.throws(() => rasterWgsl(v, { ao: true }), /not available/);
  const flagLine = 'if ((u.axisAligned & RASTER_FLAG_VAO) != 0u) { gaW = bitcast<u32>(';
  assert.ok(RASTER_WGSL.includes(flagLine) && RASTER_MASK_WGSL.includes(flagLine) && !RASTER_CLOTH_WGSL.includes(flagLine), 'flag test present in the KIND_MESH branch (not cloth)');
  // the flag line is the LAST statement of the KIND_MESH branch (it overrides gaW after the rounded/packed decision)
  const iFlag = RASTER_WGSL.indexOf(flagLine), iPacked = RASTER_WGSL.indexOf('else { face = FACE_PACKED; gaW = nrmBits; }');
  const rest = RASTER_WGSL.slice(iFlag), eol = rest.indexOf(String.fromCharCode(10));
  assert.ok(iPacked > 0 && iFlag > iPacked && rest.slice(eol + 1, eol + 4) === String.fromCharCode(32, 32, 125), 'flag line is last in the KIND_MESH branch');
  assert.ok(RASTER_WGSL.includes('(u.axisAligned & 1u));') && !RASTER_WGSL.includes('u.axisAligned);'), 'static/voxel packed.w masks the flag word with & 1u');
  const attrs = rasterWgsl('instancedMask', { ao: true }).split('@location(').length - 1 - rasterWgsl('instancedMask', { ao: true }).split('struct VertexOut')[1].split('@location(').length + 1;
  assert.ok(attrs <= 10, 'instancedMask+ao attribute count ' + attrs);
  console.log('raster.wgsl.test.js (ME-20c): ao variants / flag line / & 1u ok.');
}
