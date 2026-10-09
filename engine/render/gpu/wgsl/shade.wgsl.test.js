// WG-3c: shade.wgsl.js string rules, uniform layout, and JS-evaluated (wgslProbe) probes of the ported functions vs their JS twins:
//  - hashFast / hashFastU (bit-exact, Math.imul stand-in for the u32 multiply) vs terrainShade.js hashFastU/hashFast01
//  - shadeCore over the REAL content pack (every v2 material, random u/v/derivs/dist/face/kind/light) vs detailShade.js shadeCore
//  - the glyph pick (pickGlyphCodeFast / levelFromThresholds / pickCode, assembled like fs_main for n = 1) vs shadeDetailFast glyphIdx
//  - shadeTerrain (random TLOOK rows incl. close / faceMode / glint, 3 hash-cell modes) vs terrainShade.js shadeTerrain
// Mutation-checked. Not probed (no vec3 shim): fs_main's group average + hue/gain/fog byte tail and the sky branch -> compile check
// + the WG-3 gpucompare rows. node engine/render/gpu/wgsl/shade.wgsl.test.js
import assert from 'node:assert/strict';
import { SHADE_WGSL, SHADE_BLOCK, SHADE_TEXTURES, SHADE_TARGETS, TERRAIN_SHADE_WGSL } from './shade.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, makeTex, textureLoad as texLoad, shims } from './wgslProbe.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';
import { loadLevel } from '../../../world/Level.js';
import { shadeCore, shadeDetailFast, wetGain, WET_DARK, levelFromThresholds as jsLevelFromThresholds } from '../../detailShade.js';
import { SHADE_LEVEL_WGSL, SHADE_LEVEL_TARGETS } from './shade.wgsl.js';
import { createHash } from 'node:crypto';
import { shadeTerrain, hashFastU, hashFast01 } from '../../terrainShade.js';
import { packMaterialTable, MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH, SET_F_WIDTH, MAX_LEVELS } from '../ShadeTextures.js';
import { TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from '../TerrainTextures.js';
import { KIND_MODEL, KIND_MESH, KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import { FOREST_FACE_NZ } from '../../terrainShade.js';

// --- string rules (38.5) ---
assert.ok(WGSL_MODULES.some((m) => m.name === 'shade' && m.code === SHADE_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec|\bint\(|floatBitsToUint|uintBitsToFloat/.test(SHADE_WGSL), 'no raw % / GLSL names');
assert.ok(/fn vs_main/.test(SHADE_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\) -> FO/.test(SHADE_WGSL));
assert.equal(SHADE_TEXTURES.length, 16, 'exactly the WebGPU default sampled-texture limit');
assert.deepEqual(SHADE_TARGETS, ['rgba8', 'rgba8']);
const wgslTypes = { uint: 'texture_2d<u32>', sint: 'texture_2d<i32>', float: 'texture_2d<f32>' };
SHADE_TEXTURES.forEach((k, i) => assert.ok(new RegExp(`@group\\(0\\) @binding\\(${i}\\) var \\w+: ${wgslTypes[k].replace(/[<>]/g, '\\$&')}`).test(SHADE_WGSL), `binding ${i} ${k}`));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> su: ShadeU/.test(SHADE_WGSL));
assert.ok(SHADE_WGSL.includes(`(kindU == ${KIND_MODEL}u && face == ${FACE_PACKED}) || kindU == ${KIND_MESH}u) { aoDA = 1.0e30; }`), 'kind 8 face-7 + ALL kind 9 aoD force (A6, ME-20c)');
assert.ok(new RegExp(`const MAX_LEVELS: i32 = ${MAX_LEVELS};`).test(SHADE_WGSL) && new RegExp(`const MAX_FEATURES_PER_TYPE: i32 = ${MAX_FEATURES_PER_TYPE};`).test(TERRAIN_SHADE_WGSL), 'constants interpolated');
assert.ok(/\(u32\(x\) \* 0x27d4eb2du\) \^ \(u32\(y\) \* 0x165667b1u\) \^ \(u32\(s\) \* 0x9e3779b1u\)/.test(SHADE_WGSL), 'hash constants');
assert.ok(/floor\(clamp\(v255, 0\.0, 255\.0\) \+ 0\.5\) \/ 255\.0/.test(SHADE_WGSL), 'byte quantise floor(v+0.5)');

// --- uniform layout ---
const w = (n) => SHADE_BLOCK.field(n).word;
assert.deepEqual(['fogFg', 'fogStart', 'fogBg', 'sunDir', 'terrainFogNearRGB', 'terrainFogFarRGB', 'sunI', 'closeBand'].map(w), [0, 3, 4, 8, 12, 16, 20, 42]);
assert.equal(SHADE_BLOCK.field('handover').offset % 8, 0);
assert.equal(SHADE_BLOCK.field('pitchA').offset % 16, 0);
assert.equal(SHADE_BLOCK.field('faceK').words, 8);
assert.equal(SHADE_BLOCK.sizeBytes % 16, 0);

// --- shared fixtures ---
// wgslProbe textureLoad + the .r/.g/.b/.a swizzle aliases the terrain/gain/threshold code reads
const textureLoad = (tex, c) => { const o = texLoad(tex, c); o.r = o.x; o.g = o.y; o.b = o.z; o.a = o.w; return o; };
let seed = 12345;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const imul = Math.imul;
// WGSL u32 multiply is exact; the JS-evaluated twin needs Math.imul for the same low 32 bits.
function hashSrc(src) {
  return src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
    .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
    .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
}
function mkHash(src) {
  const hashFastU_w = compileFn(hashSrc(src), 'hashFastU', { ...shims, imul });
  return { hashFastU: hashFastU_w, hashFast: compileFn(src, 'hashFast', { ...shims, hashFastU: hashFastU_w }) };
}
let probes = 0;
{
  const h = mkHash(SHADE_WGSL);
  for (let i = 0; i < 4000; i++) {
    const x = Math.floor(rand() * 200) - 100, y = Math.floor(rand() * 200) - 100, s = Math.floor(rand() * 5000) - 100;
    assert.equal(h.hashFastU(x, y, s) >>> 0, hashFastU(x, y, s)); assert.equal(h.hashFast(x, y, s), hashFast01(x, y, s)); probes += 2;
  }
  const bad = SHADE_WGSL.replace('0x165667b1u', '0x165667b3u');
  const hb = mkHash(bad);
  let diff = 0; for (let i = 0; i < 50; i++) if (hb.hashFastU(i, i + 3, 7) >>> 0 !== hashFastU(i, i + 3, 7)) diff++;
  assert.ok(diff > 40, 'mutation: hash constant caught');
}

// --- real content pack ---
const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const level = loadLevel(bundle.levels.test_room);
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, level);
const packed = packMaterialTable(table);
const { nMat, nSet } = packed.dims;
const toTex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]]); return makeTex(width, height, d); };
const f1Tex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i], 0, 0, 0]); return makeTex(width, height, d); };
const faceKRows = [[table.faceK[0], table.faceK[1], table.faceK[2], table.faceK[3]], [table.faceK[4], table.faceK[5], table.faceK[6], 0]];
const shading = table.shading;
const su = {
  wetness: 0, cellAspect: packed.uniforms.cellAspect, cutoff: shading.cutoff, lift: shading.lift, aoR: table.ao.r, aoK: table.ao.k, faceK: faceKRows,
};
assert.equal(su.cellAspect, shading.cellAspect, 'uniform cellAspect == shading.cellAspect');
const POW2 = [0.125, 0.25, 0.5, 1, 2, 4];
const consts = {
  POW2, MAX_LEVELS, TAN22: 0.40403, TAN68: 2.47509, LINE_DASH: 13, LINE_UNDERSCORE: 63, LINE_PIPE: 92, LINE_SLASH: 15, LINE_BACKSLASH: 60,
};
function core(src) {
  const base = {
    ...shims, ...consts, textureLoad, su, imul,
    uMatF: toTex(packed.matF, MAT_F_WIDTH, nMat), uMatI: toTex(packed.matI, MAT_I_WIDTH, nMat), uSetI: toTex(packed.setI, SET_I_WIDTH, nSet),
    uSetF: f1Tex(packed.setF, SET_F_WIDTH, nSet),
  };
  Object.assign(base, mkHash(src));
  for (const n of ['fmodGlsl', 'qfloor', 'smoothstepFast', 'coverFast', 'orientClassCode', 'crossLineFast', 'lineGlyphCodeFast', 'faceK', 'levelFromThresholds', 'pickCode', 'pickGlyphCodeFast']) base[n] = compileFn(src, n, base);
  base.shadeCore = compileFn(src, 'shadeCore', base);
  return base;
}
const lights = () => [rand() * 1.4, rand() * 1.2, rand() * 1.0];
function runCore(src, trials) {
  const fns = core(src);
  let bad = 0, n = 0, joints = 0, lines = 0;
  // detailShade.js hashFast divides the full 32 bits by 2^32, the GLSL/WGSL twin keeps 24 (>> 8): <= 2^-24 apart (accepted, D-039).
  const closeF = (a, b) => Math.abs(a - b) <= 2e-5 * Math.max(1, Math.abs(a), Math.abs(b));
  const matIds = []; for (let id = 1; id < nMat; id++) if (table.records[id] && table.records[id].v2) matIds.push(id);
  for (let t = 0; t < trials; t++) {
    const id = matIds[t % matIds.length], rec = table.records[id].v2;
    const kind = [1, 2, 3, 4, 5, 8, 9][Math.floor(rand() * 7)], face = 1 + Math.floor(rand() * 7);
    const u = rand() * 40 - 5, v = rand() * 40 - 5, z = rand() * 12, dist = 0.5 + rand() * 60;
    const aoD = rand() < 0.3 ? 1e30 : rand() * 3;
    const dd = () => (rand() < 0.2 ? 0 : (rand() - 0.5) * (rand() < 0.75 ? 0.05 : 4));
    const dudx = dd(), dvdx = dd(), dudy = dd(), dvdy = dd();
    const light = lights();
    const want = shadeCore(table, rec, u, v, z, aoD, dudx, dvdx, dudy, dvdy, dist, face, kind, light, {});
    const got = fns.shadeCore(u, v, z, aoD, dudx, dvdx, dudy, dvdy, dist, face, kind, id, Math.max(light[0], light[1], light[2]));
    n++;
    const ok = closeF(got.b, want.b) && closeF(got.gb, want.gb) && closeF(got.cr, want.cr) && closeF(got.cg, want.cg) && closeF(got.cb, want.cb) &&
      closeF(got.bgK, want.bgK) && Math.abs(got.hA - want.hA) <= 2.5e-7 && Math.abs(got.hB - want.hB) <= 2.5e-7 && got.onJoint === want.onJoint && got.lineCode === want.lineCode && got.setId === want.setId;
    if (!ok) { bad++; if (bad < 4 && src === SHADE_WGSL) console.error('shadeCore mismatch mat', id, JSON.stringify(got), JSON.stringify(want)); }
    if (want.onJoint) joints++; if (want.lineCode >= 0) lines++;
  }
  return { bad, n, joints, lines };
}
const baseCore = runCore(SHADE_WGSL, 6000);
// float32-packed constants (grid periods, thresholds) may flip a discrete floor at a tile boundary: allow 0.2 %, never more.
assert.ok(baseCore.bad <= baseCore.n * 0.002, `shadeCore vs JS: ${baseCore.bad}/${baseCore.n} differ`);
assert.ok(baseCore.joints > 100 && baseCore.lines > 80, `joint/line coverage ${baseCore.joints}/${baseCore.lines}`);
probes += baseCore.n;
const mutC = (a, b) => { assert.ok(SHADE_WGSL.includes(a), 'anchor ' + a); return SHADE_WGSL.replace(a, b); };
assert.ok(runCore(mutC('if (kind != 8u && face >= 1 && face <= 6)', 'if (kind != 9u && face >= 1 && face <= 6)'), 1500).bad > 15, 'mutation: kind 8 fk rule');
assert.ok(runCore(mutC('shadeK = mf3.x;', 'shadeK = mf3.y;'), 3000).bad > 5, 'mutation: grid joint shade');
assert.ok(runCore(mutC('+ mf1.x;', '+ mf1.y;'), 1500).bad > 15, 'mutation: emissive slot');
assert.ok(runCore(mutC('let jit = 1.0 + jitter * (hJ * 2.0 - 1.0);', 'let jit = 1.0 + jitter * (hB * 2.0 - 1.0);'), 1500).bad > 15, 'mutation: jitter hash');
assert.ok(runCore(mutC('uo = u - select(0.0, gstagger * gu, fmodGlsl(course, 2.0) != 0.0);', 'uo = u;'), 3000).bad > 5, 'mutation: brick stagger');

// GRID-TEXEL-GLYPH-01b: F_GRID_TEXEL literal + hJ (block die) present; texel materials are in the fixture and covered above.
assert.ok(SHADE_WGSL.includes('(flags & 131072) != 0'), 'F_GRID_TEXEL literal');
assert.ok(SHADE_WGSL.includes('hasGrid && !gridTexel'), 'gridTexel branch');
assert.ok(SHADE_WGSL.includes('hJ = select(hA, hashFast(bix, courseI, seed), hasGrid)'), 'hJ block die');
assert.ok(runCore(mutC('hasGrid && !gridTexel', 'hasGrid'), 3000).bad > 5, 'mutation: gridTexel ignored');
assert.ok(runCore(mutC('hJ = select(hA, hashFast(bix, courseI, seed), hasGrid);', 'hJ = hA;'), 3000).bad > 5, 'mutation: hJ == hA on texel grid');

const setITex = toTex(packed.setI, SET_I_WIDTH, nSet);
// --- glyph pick vs shadeDetailFast (n = 1: lineWins == onJoint, count == 1), no fog stipple (dist < fog.start) ---
{
  const fns = core(SHADE_WGSL);
  let bad = 0, n = 0, nonZero = 0, orientedSeen = 0;
  const matIds = []; for (let id = 1; id < nMat; id++) if (table.records[id] && table.records[id].v2) matIds.push(id);
  for (let t = 0; t < 4000; t++) {
    const id = matIds[t % matIds.length], rec = table.records[id].v2;
    const kind = 1 + Math.floor(rand() * 5), face = 1 + Math.floor(rand() * 6);
    const u = rand() * 30, v = rand() * 30, z = rand() * 6, dist = rand() * Math.max(0.1, table.fog.start - 0.5);
    const dudx = (rand() - 0.5) * 0.4, dvdx = (rand() - 0.5) * 0.4, dudy = (rand() - 0.5) * 0.4, dvdy = (rand() - 0.5) * 0.4;
    const light = lights();
    const gbuf = { u: [u], v: [v], z: [z], face: [face], kind: [kind], aoD: [1e30], dudx: [dudx], dvdx: [dvdx], dudy: [dudy], dvdy: [dvdy] };
    const out = { glyphIdx: -1, fg: [0, 0, 0], bg: [0, 0, 0], f: 0, onJoint: false };
    shadeDetailFast(table, rec, 0, gbuf, dist, light, out);
    const c = fns.shadeCore(u, v, z, 1e30, dudx, dvdx, dudy, dvdy, dist, face, kind, id, Math.max(light[0], light[1], light[2]));
    let glyph;
    if (c.gb <= 0) glyph = 0;
    else if (c.onJoint && c.lineCode >= 0) glyph = c.lineCode;
    else {
      const t0 = textureLoad(setITex, { x: 0, y: c.setId });
      const oriented = t0.x, axis = t0.y;
      let classIdx = 0;
      if (oriented !== 0) { classIdx = fns.orientClassCode(axis === 0 ? dudx : dvdx, axis === 0 ? dudy : dvdy, su.cellAspect); orientedSeen++; }
      const code = fns.pickGlyphCodeFast(c.setId, c.gb, c.hA, classIdx, su.cutoff);
      glyph = code < 0 ? 0 : code;
    }
    n++; if (glyph !== 0) nonZero++;
    if (glyph !== out.glyphIdx && out.f === 0) { bad++; if (bad < 6) console.error("glyph", id, glyph, out.glyphIdx, JSON.stringify(c)); }
    probes++;
  }
  assert.ok(bad <= n * 0.002, `glyph pick vs shadeDetailFast: ${bad}/${n} differ`);
  assert.ok(nonZero > n * 0.3 && orientedSeen > 50, `glyph coverage ${nonZero}/${n}, oriented ${orientedSeen}`);
}

// --- shadeTerrain vs terrainShade.js ---
{
  const rows = 4;
  const tlook = new Float32Array(4 * TLOOK_WIDTH * rows);
  const pack = (codes) => { let x = 0; for (let i = 0; i < codes.length; i++) x |= codes[i] << (8 * i); return x; };
  for (let r = 0; r < rows; r++) {
    const base = r * TLOOK_WIDTH * 4;
    for (let tx = 0; tx < 3; tx++) for (let c = 0; c < 3; c++) tlook[base + tx * 4 + c] = rand();
    tlook[base + 12] = 0.8; tlook[base + 13] = r === 1 ? 1 : 0; // albedo, glint flag
    if (r === 2) { tlook[base + 14] = pack([40, 50]); tlook[base + 15] = 2; } // face glyphs + count (forest-like row)
    for (let tx = 4; tx <= 7; tx++) { const n = 1 + Math.floor(rand() * 3); tlook[base + tx * 4] = pack(Array.from({ length: n }, () => 1 + Math.floor(rand() * 90))); tlook[base + tx * 4 + 1] = n; }
    for (let c = 0; c < 3; c++) tlook[base + 16 * 4 + c] = rand(); // trunk colour
  }
  const gainLUT = new Float32Array(256); for (let i = 0; i < 256; i++) gainLUT[i] = Math.pow(i / 255, 0.6);
  const shadingT = { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6, gainLUT };
  const bands = { near: 150, mid: 600 };
  const fog = { start: 50, full: 1500, curve: 0.7, nearRGB: [143, 168, 196], farRGB: [196, 220, 239] };
  const uTl = toTex(tlook, TLOOK_WIDTH, rows), uGain = f1Tex(gainLUT, 256, 1);
  const makeSu = (hashCell, wet = 0) => ({
    hashCell, nearDetailOn: 1, handover: { x: 40, y: 90 }, closeBand: 40, fgMin: shadingT.fgMin, fgMaxGain: shadingT.fgMaxGain, bandNear: bands.near, bandMid: bands.mid,
    terrainFogStart: fog.start, terrainFogFull: fog.full, terrainFogCurve: fog.curve,
    terrainFogNearRGB: { x: fog.nearRGB[0], y: fog.nearRGB[1], z: fog.nearRGB[2] }, terrainFogFarRGB: { x: fog.farRGB[0], y: fog.farRGB[1], z: fog.farRGB[2] },
    wetness: wet, // S8-B2-14b
  });
  const MAX_F = MAX_FEATURES_PER_TYPE;
  function runTerrain(src, trials, wet = 0) {
    let bad = 0, n = 0, faces = 0, closeN = 0;
    const h = mkHash(src);
    for (const hashCell of [0, 3, -0.05]) {
      const suT = makeSu(hashCell, wet);
      const base = { ...shims, textureLoad, su: suT, uTlook: uTl, uGain, imul, ...h, MAX_FEATURES_PER_TYPE: MAX_F, FOREST_FACE_NZ,
        exp2: (x) => Math.pow(2, x), ceil: Math.ceil, log2: Math.log2, pow: Math.pow };
      base.samplePowLUT = compileFn(SHADE_WGSL, 'samplePowLUT', base);
      // WGSL integer / truncates; the JS evaluator divides in floats, so make the truncation explicit for this one helper
      assert.ok(SHADE_WGSL.includes('fn imod(a: i32, b: i32) -> i32 { return a - b * (a / b); }'));
      base.imod = compileFn(SHADE_WGSL.replace('fn imod(a: i32, b: i32) -> i32 { return a - b * (a / b); }', 'fn imod(a: i32, b: i32) -> i32 { return a - b * Math.trunc(a / b); }'), 'imod', { ...base, Math });
      base.pickCodeFromPacked = compileFn(src, 'pickCodeFromPacked', base);
      // S8-B2-14b: shadeTerrain now calls wetGain (which calls smoothstepFast) - compile both from SHADE_WGSL (unaffected
      // by a shadeTerrain-only mutation) before shadeTerrain itself, same pattern as samplePowLUT/imod above.
      base.smoothstepFast = compileFn(SHADE_WGSL, 'smoothstepFast', base);
      base.wetGain = compileFn(SHADE_WGSL, 'wetGain', base);
      const st = compileFn(src, 'shadeTerrain', base);
      const ctx = { tlook, tlookWidth: TLOOK_WIDTH, bands, fog, shading: { ...shadingT, wetness: wet }, closeBand: 40, handover: [40, 90], features: null, hashCell };
      for (let t = 0; t < trials; t++) {
        const type = Math.floor(rand() * rows), tt = rand() < 0.5 ? rand() * 60 : rand() * 1700;
        const b = rand() * 1.3, u = rand() * 900 - 100, v = rand() * 900 - 100, time = rand() * 20, faceMode = Math.floor(rand() * 3);
        const o = { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3) };
        shadeTerrain(tt, type, b, u, v, time, ctx, o, faceMode);
        const g = st(tt, type, b, u, v, time, faceMode);
        const q = (x) => Math.floor(Math.min(255, Math.max(0, x)) + 0.5);
        n++; if (tt < 40) closeN++; if (faceMode && type === 2) faces++;
        if (g.glyph !== o.glyph || q(g.fr) !== o.fg[0] || q(g.fg) !== o.fg[1] || q(g.fb) !== o.fg[2] || q(g.br) !== o.bg[0] || q(g.bg) !== o.bg[1] || q(g.bb) !== o.bg[2]) { bad++; if (bad < 10 && src === SHADE_WGSL) console.error("terr", hashCell, JSON.stringify({ type, tt, b, u, v, time, faceMode }), JSON.stringify(g), o.glyph, Array.from(o.fg), Array.from(o.bg)); }
      }
    }
    return { bad, n, faces, closeN };
  }
  const base = runTerrain(SHADE_WGSL, 1500);
  assert.ok(base.bad <= base.n * 0.001, `shadeTerrain vs JS: ${base.bad}/${base.n} differ`);
  assert.ok(base.faces > 100 && base.closeN > 300, `terrain coverage faces ${base.faces} close ${base.closeN}`);
  probes += base.n;
  const mutT = (a, b) => { assert.ok(SHADE_WGSL.includes(a), 'anchor ' + a); return SHADE_WGSL.replace(a, b); };
  assert.ok(runTerrain(mutT('if (f > 0.85) { code = 0; }', 'if (f > 0.9) { code = 0; }'), 600).bad > 3, 'mutation: fog glyph cut');
  assert.ok(runTerrain(mutT('var br = fr * 0.3;', 'var br = fr * 0.35;'), 300).bad > 20, 'mutation: bg factor');

  // --- S8-B2-14b terrain wetness (follow-up): same WET_DARK/wetGain as detailShade, JS twin == WGSL at w 0/0.5/1 ---
  for (const wet of [0, 0.5, 1]) {
    const r = runTerrain(SHADE_WGSL, 800, wet);
    assert.ok(r.bad <= r.n * 0.001, `shadeTerrain wet ${wet} vs JS: ${r.bad}/${r.n} differ`);
    probes += r.n;
  }
  // wetness 0 == absent (ctx.shading.wetness undefined), bit-identical, explicit (not via the shared runTerrain path above)
  {
    const shadingAbsent = { ...shadingT }; delete shadingAbsent.wetness;
    const ctxAbsent = { tlook, tlookWidth: TLOOK_WIDTH, bands, fog, shading: shadingAbsent, closeBand: 40, handover: [40, 90], features: null, hashCell: 0 };
    const ctxZero = { ...ctxAbsent, shading: { ...shadingT, wetness: 0 } };
    for (let t = 0; t < 300; t++) {
      const type = Math.floor(rand() * rows), tt = rand() < 0.5 ? rand() * 60 : rand() * 1700;
      const b = rand() * 1.3, u = rand() * 900 - 100, v = rand() * 900 - 100, time = rand() * 20, faceMode = Math.floor(rand() * 3);
      const oA = { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3) }, oB = { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3) };
      shadeTerrain(tt, type, b, u, v, time, ctxAbsent, oA, faceMode);
      shadeTerrain(tt, type, b, u, v, time, ctxZero, oB, faceMode);
      assert.deepEqual(oA, oB, 'terrain wetness 0 == absent');
    }
  }
  // mean fg luminance drop 10-25 % at wetness 1 (JS oracle, same AC family as the detailShade check below)
  {
    const lum = (fg) => 0.2126 * fg[0] + 0.7152 * fg[1] + 0.0722 * fg[2];
    const meanLum = (wet) => {
      const ctx = { tlook, tlookWidth: TLOOK_WIDTH, bands, fog, shading: { ...shadingT, wetness: wet }, closeBand: 40, handover: [40, 90], features: null, hashCell: 0 };
      let sum = 0, n = 0;
      for (let t = 0; t < 3000; t++) {
        const type = t % rows, tt = 100 + (t * 1.7) % 500, b = 0.3 + (t * 0.013) % 1.0, u = (t * 7.31) % 900, v = (t * 3.17) % 900;
        const o = { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3) };
        shadeTerrain(tt, type, b, u, v, 0, ctx, o, 0);
        if (o.glyph !== 0) { sum += lum(o.fg); n++; }
      }
      return sum / n;
    };
    const l0 = meanLum(0), l1 = meanLum(1), lHalf = meanLum(0.5);
    const drop = 1 - l1 / l0;
    console.log(`terrain wetness: mean fg luminance ${l0.toFixed(1)} -> ${lHalf.toFixed(1)} (0.5) -> ${l1.toFixed(1)} (1.0), drop ${(drop * 100).toFixed(1)} %`);
    assert.ok(drop >= 0.10 && drop <= 0.25, `terrain wetness 1 lowers luminance 10-25 %: ${(drop * 100).toFixed(1)} %`);
    assert.ok(l0 > lHalf && lHalf > l1, 'monotonic in terrain wetness');
  }
  // mutation: terrain wet-darkening constant must be caught
  {
    const anchor = `let bWet = b * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness);`;
    assert.ok(SHADE_WGSL.includes(anchor), 'anchor terrain wet dark');
    const mutT2 = SHADE_WGSL.replace(anchor, 'let bWet = b * (1.0 - 0.1000 * su.wetness);');
    assert.ok(runTerrain(mutT2, 600, 1).bad > 15, 'mutation: terrain wet darkening constant caught');
  }
}

// --- S8-B2-12b (38.13): cloud-darkening byte (LIGHT.w bits 24..31) scales the terrain analytic sun term `bSunT`.
// `cFt` sits in fs_main's kindU==KIND_TERRAIN block, not inside the probed `shadeTerrain` fn, so the real `let cFt =
// ...;` expression is extracted from the compiled module text and wrapped in a tiny probeable fn (same technique as
// water.wgsl.test.js) - a wrong shift/mask/divisor in the real text fails here. ---
{
  const m = SHADE_WGSL.match(/let cFt = (1\.0 - f32\(\(lightT\.w >> \d+u\) & \d+u\) \* \(1\.0 \/ 255\.0\));/);
  assert.ok(m, 'cFt decode line present in shade.wgsl.js terrain branch');
  assert.ok(m[1].includes('>> 24u'), 'cFt shifts by CLOUD_SHIFT (24)');
  assert.ok(/let bSunT = su\.ambientI \+ su\.sunI \* max\(0\.0, ndotlT\) \* sunFT \* cFt;/.test(SHADE_WGSL), 'cFt scales the analytic sun term bSunT');
  const probeSrc = `fn cloudFactorProbe(lightT: vec4u) -> f32 { let cFt = ${m[1]}; return cFt; }`;
  const f = compileFn(probeSrc, 'cloudFactorProbe', shims);
  for (const q of [0, 1, 64, 127, 153, 200, 255]) {
    const got = f({ x: 0, y: 0, z: 0, w: q << 24 });
    const want = 1 - q * (1 / 255);
    assert.ok(Math.abs(got - want) < 1e-9, `cFt at q=${q}: ${got} vs ${want}`);
  }
  assert.equal(f({ x: 0, y: 0, z: 0, w: 0 }), 1, 'q=0 -> cFt exactly 1.0 (bit-identical AC)');
  // mutation: a wrong divisor (254 instead of 255) must change the probed value away from the JS formula.
  const mutSrc = probeSrc.replace('/ 255.0)', '/ 254.0)');
  const fMut = compileFn(mutSrc, 'cloudFactorProbe', shims);
  assert.ok(Math.abs(fMut({ x: 0, y: 0, z: 0, w: 153 << 24 }) - (1 - 153 * (1 / 255))) > 1e-6, 'mutation: wrong divisor caught');
}

// --- S8-B2-14 wetness: uniform slot replaces pad0 (layout unchanged), JS twin == WGSL, 0 = untouched, 1 darkens 10-25 % ---
{
  assert.equal(w('wetness'), 43, 'wetness takes the old pad0 word (closeBand 42 + 1)');
  assert.equal(SHADE_BLOCK.field('closeBand').word + 1, w('wetness'));
  su.fgMaxGain = shading.fgMaxGain;
  const setWet = (x) => { su.wetness = x; shading.wetness = x; };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const matIds = []; for (let id = 1; id < nMat; id++) if (table.records[id] && table.records[id].v2) matIds.push(id);
  const meanLum = (x) => {
    setWet(x); let sum = 0, n = 0;
    for (let t = 0; t < 3000; t++) {
      const id = matIds[t % matIds.length], rec = table.records[id].v2;
      const u = (t * 7.31) % 30, v = (t * 3.17) % 30;
      const gbuf = { u: [u], v: [v], z: [1], face: [1 + (t % 6)], kind: [2], aoD: [1e30], dudx: [0.02], dvdx: [0], dudy: [0], dvdy: [0.02] };
      const out = { glyphIdx: -1, fg: [0, 0, 0], bg: [0, 0, 0], f: 0, onJoint: false };
      shadeDetailFast(table, rec, 0, gbuf, 4, [0.7, 0.66, 0.6], out);
      if (out.glyphIdx !== 0) { sum += lum(out.fg); n++; }
    }
    return sum / n;
  };
  const l0 = meanLum(0), l1 = meanLum(1), lHalf = meanLum(0.5);
  const drop = 1 - l1 / l0;
  console.log(`wetness: mean fg luminance ${l0.toFixed(1)} -> ${lHalf.toFixed(1)} (0.5) -> ${l1.toFixed(1)} (1.0), drop ${(drop * 100).toFixed(1)} %`);
  assert.ok(drop >= 0.10 && drop <= 0.25, `wetness 1 lowers luminance 10-25 %: ${(drop * 100).toFixed(1)} %`);
  assert.ok(l0 > lHalf && lHalf > l1, 'monotonic in wetness');
  // wetness 0 / absent: identical to the pre-S8-B2-14 formula (explicit, not via the same code path)
  setWet(0); delete shading.wetness;
  for (let t = 0; t < 200; t++) {
    const id = matIds[t % matIds.length], rec = table.records[id].v2, light = lights();
    const a = shadeCore(table, rec, t * 0.37, t * 0.21, 1, 1e30, 0.01, 0, 0, 0.01, 5, 1 + (t % 6), 2, light, {});
    shading.wetness = 0;
    const b0 = shadeCore(table, rec, t * 0.37, t * 0.21, 1, 1e30, 0.01, 0, 0, 0.01, 5, 1 + (t % 6), 2, light, {});
    delete shading.wetness;
    assert.deepEqual(a, b0, 'wetness 0 == absent');
  }
  // twin: shadeCore b/gb at wetness 0.5 and 1 vs the WGSL probe, and wetGain vs detailShade.wetGain
  for (const x of [0.5, 1]) {
    setWet(x);
    const r = runCore(SHADE_WGSL, 1500); assert.ok(r.bad <= r.n * 0.002, `shadeCore wet ${x} vs JS: ${r.bad}/${r.n}`); probes += r.n;
    const fns = core(SHADE_WGSL); fns.wetGain = compileFn(SHADE_WGSL, 'wetGain', fns);
    for (let t = 0; t < 300; t++) {
      const bc = rand() * 1.6, g0 = 0.15 + rand() * 0.85;
      assert.ok(Math.abs(fns.wetGain(g0, bc) - wetGain(g0, bc, x, shading.fgMaxGain)) < 1e-5, 'wetGain twin');
    }
    probes += 300;
  }
  setWet(0); delete shading.wetness;
  const mutW = SHADE_WGSL.replace(`jit * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness)`, 'jit * (1.0 - 0.1000 * su.wetness)');
  assert.notEqual(mutW, SHADE_WGSL, 'mutation anchor wet dark');
  setWet(1); assert.ok(runCore(mutW, 1500).bad > 15, 'mutation: wet darkening constant'); setWet(0); delete shading.wetness;
}

// --- US-073b (38.25): the stable-glyph level target. OFF = byte-identical to the pre-073b shader; ON = one extra r8ui target. ---
{
  // sha256 of SHADE_WGSL taken before the 073b change, re-pinned after the 38.23 entity-tint merge (35967 chars): the stable-off shader must not move by a single byte.
  assert.equal(SHADE_WGSL.length, 35967, 'stable off: SHADE_WGSL length unchanged');
  assert.equal(createHash('sha256').update(SHADE_WGSL).digest('hex'), '8c6b91cb67f1745e239d12bc6923aa4925bac4cd1fcd186242396d32cefc65b0', 'stable off: SHADE_WGSL byte-identical to pre-073b');
  assert.ok(!/lvl|lvOut|location\(2\)/.test(SHADE_WGSL), 'stable off: no level output');
  assert.deepEqual(SHADE_TARGETS, ['rgba8', 'rgba8']);
  assert.deepEqual(SHADE_LEVEL_TARGETS, ['rgba8', 'rgba8', 'r8ui']);
  assert.ok(WGSL_MODULES.some((m) => m.name === 'shadeLevel' && m.code === SHADE_LEVEL_WGSL), 'level variant registered');
  assert.ok(/@location\(2\) lvl: u32,/.test(SHADE_LEVEL_WGSL), 'level target @location(2)');
  assert.ok(SHADE_LEVEL_WGSL.includes('var o: FO; o.lvl = 255u;'), 'every early return defaults to level 255 (none / passthrough / terrain / sky)');
  assert.ok(SHADE_LEVEL_WGSL.includes('lvOut = u32(levelFromThresholds(setIdPick, t0.z, gbAvg, su.cutoff));'), 'ramp pick sets the level');
  assert.ok(SHADE_LEVEL_WGSL.includes('glyphCode = select(code1, code0, idx == 0); lvOut = 255u;'), 'fog stipple glyph resets to 255');
  assert.ok(SHADE_LEVEL_WGSL.includes('o.lvl = lvOut;'));
  // the variant minus its splices is exactly the stable-off shader
  const stripped = SHADE_LEVEL_WGSL
    .replace('\n  @location(2) lvl: u32,', '').replace(' o.lvl = 255u;', '').replace('\n  var lvOut = 255u;', '')
    .replace('\n    lvOut = u32(levelFromThresholds(setIdPick, t0.z, gbAvg, su.cutoff));', '').replace(' lvOut = 255u;', '').replace(' o.lvl = lvOut;', '')
    .replace(' o.lvl = select(255u, 254u, textureLoad(uTlook, vec2i(3, typeId), 0).y > 0.5);', '');
  assert.equal(stripped, SHADE_WGSL, 'level variant == off shader + the 7 splices');
  assert.ok(SHADE_LEVEL_WGSL.includes('o.lvl = select(255u, 254u, textureLoad(uTlook, vec2i(3, typeId), 0).y > 0.5);\n    return o;'), '38.25 C.1: terrain shimmer branch writes level 254');
  // level value: WGSL levelFromThresholds (1 + index, 0 under the cutoff) == the JS twin over the real ramps
  const fns = core(SHADE_WGSL);
  let n = 0, nz = 0, bad = 0;
  for (let setId = 0; setId < table.sets.length; setId++) {
    const S = table.sets[setId];
    if (!S || !S.thresholds) continue;
    for (let t = 0; t < 40; t++) {
      const gb = rand() * 1.3;
      const want = jsLevelFromThresholds(S.levels, gb, S.thresholds, su.cutoff), got = fns.levelFromThresholds(setId, S.levels, gb, su.cutoff);
      n++; if (want > 0) nz++; if (got !== want || got >= 254) bad++; // 254/255 are reserved level bytes (38.25 C.1)
    }
  }
  assert.ok(n > 100 && nz > n * 0.3, `level coverage ${nz}/${n}`);
  assert.equal(bad, 0, `level byte vs JS twin: ${bad}/${n}`);
  probes += n;
  const mutL = fns && compileFn(SHADE_WGSL.replace('if (t <= gb) { i = k; }', 'if (t < gb) { i = k; }'), 'levelFromThresholds', core(SHADE_WGSL));
  let badM = 0; for (let setId = 0; setId < table.sets.length; setId++) { const S = table.sets[setId]; if (!S || !S.thresholds) continue; for (let k = 1; k < S.levels; k++) if (mutL(setId, S.levels, S.thresholds[k], su.cutoff) !== jsLevelFromThresholds(S.levels, S.thresholds[k], S.thresholds, su.cutoff)) badM++; }
  assert.ok(badM > 0, 'mutation: threshold compare (<= to <) caught at exact thresholds');
}

// --- 38.23 entity tint: layout appended at the END, branch guarded by etA.x, tintCh probe == entityTint twin ---
{
  const { tintChannel } = await import('../../entityTint.js');
  assert.equal(SHADE_BLOCK.field('etA').word, SHADE_BLOCK.field('faceK').word + 8, 'etA right after faceK (no word moved)');
  assert.equal(SHADE_BLOCK.field('etId').word, SHADE_BLOCK.field('etA').word + 4);
  assert.equal(SHADE_BLOCK.field('etC').word, SHADE_BLOCK.field('etId').word + 8);
  assert.equal(SHADE_BLOCK.field('etC').words, 32);
  assert.equal(SHADE_BLOCK.sizeBytes, (SHADE_BLOCK.field('etC').word + 32) * 4, 'tint table is the tail of the block');
  assert.ok(/if \(su\.etA\.x > 0\.0\) \{/.test(SHADE_WGSL), 'branch guarded by count (0 = skipped, bit-identical)');
  assert.ok(SHADE_WGSL.indexOf('su.etA.x > 0.0') < SHADE_WGSL.indexOf('rgbF += (su.fogFg - rgbF) * f') && SHADE_WGSL.indexOf('su.etA.x > 0.0') > SHADE_WGSL.indexOf('var rgbBg = rgbF * bgKAvg'), 'after lighting, before fog');
  const tintCh = compileFn(SHADE_WGSL, 'tintCh', shims);
  for (let i = 0; i < 2000; i++) {
    const c = rand() * 255, t = rand(), k = i % 7 === 0 ? 0 : i % 11 === 0 ? 1 : rand();
    const a = Math.fround(tintCh(Math.fround(c), Math.fround(t), Math.fround(k))), b = tintChannel(c, t, k);
    assert.ok(Math.abs(a - b) <= 1e-3, `tintCh twin ${a} vs ${b}`);
  }
  const mutT = SHADE_WGSL.replace('return c + (t * 255.0 - c) * k;', 'return c + (t * 255.0 - c) * (k * 0.9);');
  assert.notEqual(mutT, SHADE_WGSL);
  const tm = compileFn(mutT, 'tintCh', shims); let bad = 0;
  for (let i = 0; i < 200; i++) { const c = rand() * 255, t = rand(), k = 0.5 + rand() * 0.5; if (Math.abs(tm(c, t, k) - tintChannel(c, t, k)) > 1e-3) bad++; }
  assert.ok(bad > 100, 'mutation: tint formula caught');
}

console.log(`shade.wgsl.test.js: string/layout rules + ${probes} JS-evaluated probes (hash, shadeCore, glyph pick, shadeTerrain) vs JS twins passed, mutations caught (hash, 5 shadeCore, 2 terrain).`);
