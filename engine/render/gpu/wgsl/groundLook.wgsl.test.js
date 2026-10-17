// ENV-02d (arch 38.63): GROUND_LOOK_WGSL / look-splice shadeTerrain JS-evaluated probes vs the JS twin (groundLook.js shadeLookCell, terrainShade.js shadeTerrain),
// the plain shader stays byte-identical (look off), string rules, mutations. Node only.
import assert from 'node:assert/strict';
import { SHADE_WGSL, SHADE_LEVEL_WGSL, SHADE_LOOK_WGSL, SHADE_LEVEL_LOOK_WGSL, SHADE_BLOCK, SHADE_LOOK_BLOCK, TERRAIN_SHADE_WGSL } from './shade.wgsl.js';
import { compileFn, makeTex, textureLoad as texLoad, shims } from './wgslProbe.js';
import { shadeTerrain, makeFarGrass, FOREST_FACE_NZ, FG_TYPES } from '../../terrainShade.js';
import { packLookTable, makeGroundLook, shadeLookCell, LOOK_MAX, LOOK_ROWS, LOOK_TABLE_WORDS, GROUND_LOOK_WGSL } from '../../groundLook.js';
import { setAltDice, GROUND_ALT_BIT } from '../../fogShape.js';
import { TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from '../TerrainTextures.js';

// --- look off: nothing of the look leaks into the plain shaders ---
for (const s of [SHADE_WGSL, SHADE_LEVEL_WGSL, TERRAIN_SHADE_WGSL]) assert.ok(!/lkShade|lookT|lookLo|LookOut/.test(s), 'look off = no look code');
assert.ok(/lkShade/.test(SHADE_LOOK_WGSL) && /lkShade/.test(SHADE_LEVEL_LOOK_WGSL) && /struct ShadeU/.test(SHADE_LOOK_WGSL));
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample/.test(GROUND_LOOK_WGSL), 'lint: no raw % / round / derivatives');
assert.ok(!/\b(fn|let|var)\s+(fn|var|let|const|struct|type|enum|override|loop|switch)\b/.test(GROUND_LOOK_WGSL), 'lint: no keyword identifiers');
// uniform block: look fields APPENDED (earlier word offsets unchanged), table = LOOK_MAX x LOOK_ROWS vec4
assert.equal(SHADE_LOOK_BLOCK.field('lookT').words, LOOK_TABLE_WORDS);
for (const n of ['fogFg', 'sunI', 'closeBand', 'fgT', 'cliff']) assert.equal(SHADE_LOOK_BLOCK.field(n).word, SHADE_BLOCK.field(n).word, n);
assert.ok(SHADE_LOOK_BLOCK.sizeBytes % 16 === 0 && SHADE_LOOK_BLOCK.sizeBytes <= 16384, 'look block fits a 16 KB uniform: ' + SHADE_LOOK_BLOCK.sizeBytes);
// the look shade pass keeps the 16-texture limit: the look bytes ride GA.w (no 17th sampled texture)
assert.ok(!/uNearLook|uFarLook/.test(SHADE_LOOK_WGSL) && /gaT\.w & 15u/.test(SHADE_LOOK_WGSL));

// --- synthetic look config (6 looks), same shape as groundLook.test.js ---
let seed = 777;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const asc = (s) => Array.from(s, (c) => c.charCodeAt(0));
const mkLook = (id, o) => Object.assign({
  id, glyphs: asc('.,\'"'), lean: asc('.,``'), ramp: [[0.05, 0.2, 0.03], [0.1, 0.3, 0.06], [0.2, 0.5, 0.1], [0.4, 0.7, 0.2]], bg: [[0.02, 0.06, 0.01], [0.04, 0.12, 0.03]],
  noiseScale: 3.5, macroScale: 24, contrast: 0.55, shimmerMode: 1, shimmerAmp: 0.4, sheen: 0.3,
  accents: [{ glyph: 46, color: [0.9, 0.9, 0.8], density: 0.4, cluster: 0.6, maxDist: 25 }, { glyph: 111, color: [0.9, 0.3, 0.3], density: 0.3, cluster: 0.5, maxDist: 18 }],
}, o);
const cfg = {
  looks: [mkLook(1, {}),
    mkLook(2, { glyphs: asc('.:;%'), lean: asc('.:;%'), shimmerMode: 0, noiseScale: 2, macroScale: 12, ramp: [[0.3, 0.2, 0.1], [0.4, 0.3, 0.15], [0.5, 0.4, 0.2], [0.7, 0.6, 0.4]] }),
    mkLook(3, { glyphs: asc('~-'), lean: asc('~-'), shimmerAmp: 0, accents: [] }),
    mkLook(4, { glyphs: asc('"^'), lean: asc('/\\'), noiseScale: 6, macroScale: 40, contrast: 0.8 }),
    mkLook(5, { glyphs: asc('abc'), lean: asc('abc'), shimmerAmp: 0.9, sheen: 0.8, accents: [{ glyph: 42, color: [1, 1, 0.2], density: 0.5, cluster: 0, maxDist: 60 }] }),
    mkLook(6, { noiseScale: 1.5, macroScale: 9 })],
};
const table = packLookTable(cfg, new Float32Array(LOOK_MAX * LOOK_ROWS * 4));
const GL = makeGroundLook(table);
const lookT = Array.from({ length: LOOK_MAX * LOOK_ROWS }, (_, i) => ({ x: table[i * 4], y: table[i * 4 + 1], z: table[i * 4 + 2], w: table[i * 4 + 3] }));

// --- fixtures (cut-down copy of shade.wgsl.test.js runTerrain) ---
const textureLoad = (tex, c) => { const o = texLoad(tex, c); o.r = o.x; o.g = o.y; o.b = o.z; o.a = o.w; return o; };
const imul = Math.imul;
const hashSrc = (src) => src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
  .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
  .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
const mkHash = (src) => { const u = compileFn(hashSrc(src), 'hashFastU', { ...shims, imul }); return { hashFastU: u, hashFast: compileFn(src, 'hashFast', { ...shims, hashFastU: u }) }; };
const toTex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]]); return makeTex(width, height, d); };
const f1Tex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i], 0, 0, 0]); return makeTex(width, height, d); };
const rows = 4, tlook = new Float32Array(4 * TLOOK_WIDTH * rows);
const pack = (codes) => { let x = 0; for (let i = 0; i < codes.length; i++) x |= codes[i] << (8 * i); return x; };
for (let r = 0; r < rows; r++) {
  const base = r * TLOOK_WIDTH * 4;
  for (let tx = 0; tx < 3; tx++) for (let c = 0; c < 3; c++) tlook[base + tx * 4 + c] = rand();
  tlook[base + 12] = 0.8; tlook[base + 13] = r === 1 ? 1 : 0;
  if (r === 2) { tlook[base + 14] = pack([40, 50]); tlook[base + 15] = 2; }
  for (let tx = 4; tx <= 7; tx++) { const n = 1 + Math.floor(rand() * 3); tlook[base + tx * 4] = pack(Array.from({ length: n }, () => 1 + Math.floor(rand() * 90))); tlook[base + tx * 4 + 1] = n; }
  for (let c = 0; c < 3; c++) tlook[base + 16 * 4 + c] = rand();
}
const gainLUT = new Float32Array(256); for (let i = 0; i < 256; i++) gainLUT[i] = Math.pow(i / 255, 0.6);
const shadingT = { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6, gainLUT };
const bands = { near: 150, mid: 600 }, fog = { start: 50, full: 1500, curve: 0.7, nearRGB: [143, 168, 196], farRGB: [196, 220, 239] };
const uTl = toTex(tlook, TLOOK_WIDTH, rows), uGain = f1Tex(gainLUT, 256, 1);
const mkFg = () => {
  const r = makeFarGrass(); r.on = 1; r.startM = 12; r.fadeM = 6; r.dirX = 0.6; r.dirY = 0.8; r.cyc = 0.25; r.invTravel = 0.2;
  for (let i = 0; i < 3; i++) { for (let c = 0; c < 3; c++) r.types[i * 4 + c] = Math.fround(rand() * 255); r.types[i * 4 + 3] = 1; }
  return r;
};
const makeSu = (hashCell, wind, FG, fw = GROUND_ALT_BIT) => ({
  skyline: { x: 0, y: 0, z: 0, w: 0 }, hashCell, nearDetailOn: 1, handover: { x: 40, y: 90 }, closeBand: 40, fgMin: shadingT.fgMin, fgMaxGain: shadingT.fgMaxGain, bandNear: bands.near, bandMid: bands.mid,
  terrainFogStart: fog.start, terrainFogFull: fog.full, terrainFogCurve: fog.curve,
  terrainFogNearRGB: { x: fog.nearRGB[0], y: fog.nearRGB[1], z: fog.nearRGB[2] }, terrainFogFarRGB: { x: fog.farRGB[0], y: fog.farRGB[1], z: fog.farRGB[2] },
  wetness: 0, fgP: FG ? { x: 1, y: FG.startM, z: FG.fadeM, w: FG.mix } : { x: 0, y: 0, z: 1, w: 0 }, fgW: FG ? { x: FG.dirX, y: FG.dirY, z: FG.cyc, w: FG.invTravel } : { x: 0, y: 0, z: 0, w: 0 }, fgQ: FG ? { x: FG.qb, y: FG.tPrev, z: FG.qt, w: 0 } : { x: 0, y: 0, z: 0, w: 0 }, /* AA-22 */
  fgT: Array.from({ length: FG_TYPES }, (_, i) => FG ? { x: FG.types[i * 4], y: FG.types[i * 4 + 1], z: FG.types[i * 4 + 2], w: FG.types[i * 4 + 3] } : { x: 0, y: 0, z: 0, w: 0 }),
  cliff: { x: 1, y: 1, z: 0, w: 0 }, skyGlowOn: { x: 0, y: 0, z: 0, w: 0 }, faceK: [{ w: 0 }, { w: 0 }], lookT, fogView: { x: 0, y: 0, z: 0, w: fw }, lookP: { x: wind, y: 0, z: 0, w: 0 },
});
const q = (x) => Math.floor(Math.min(255, Math.max(0, x)) + 0.5);
function compileAll(src, su) {
  const h = mkHash(src);
  const base = { ...shims, gFarSky: { x: 0, y: 0, z: 0 }, textureLoad, su, uTlook: uTl, uGain, imul, ...h, MAX_FEATURES_PER_TYPE, FOREST_FACE_NZ, exp2: (x) => Math.pow(2, x), ceil: Math.ceil, log2: Math.log2, pow: Math.pow };
  base.samplePowLUT = compileFn(SHADE_WGSL, 'samplePowLUT', base);
  base.imod = compileFn(SHADE_WGSL.replace('fn imod(a: i32, b: i32) -> i32 { return a - b * (a / b); }', 'fn imod(a: i32, b: i32) -> i32 { return a - b * Math.trunc(a / b); }'), 'imod', { ...base, Math });
  base.pickCodeFromPacked = compileFn(src, 'pickCodeFromPacked', base);
  base.smoothstepFast = compileFn(SHADE_WGSL, 'smoothstepFast', base);
  base.wetGain = compileFn(SHADE_WGSL, 'wetGain', base);
  base.skylineFogF = compileFn(src, 'skylineFogF', base);
  for (const n of ['tsFootprint', 'tsOctFade', 'tsValueNoise', 'tsPatchNoise', 'lkT', 'lkOct', 'lkAccentHit']) base[n] = compileFn(src, n, base);
  base.lkShade = compileFn(src, 'lkShade', base);
  return { base, st: compileFn(src, 'shadeTerrain', base) };
}
const LOOKSRC = SHADE_LOOK_WGSL;
const rLo = () => Math.floor(rand() * 7) % 7;
const rW = () => { const r = rand(); return r < 0.2 ? 0 : r < 0.3 ? 0.5 : Math.fround(Math.round(rand() * 255) / 255); };
// fw = fogView.w; the twin's aaAlt follows bit 8 (GROUND_ALT_BIT) only, whatever the foliage bits (4/1/2) say
function run(src, trials, FG, fw = GROUND_ALT_BIT) {
  setAltDice((fw & GROUND_ALT_BIT) !== 0);
  let bad = 0, n = 0, anim = 0, lean = 0, blend = 0, maxErr = 0, lkBad = 0, lkN = 0;
  for (const hashCell of [0, 3, -0.05]) for (const wind of [0, 1.5]) {
    const su = makeSu(hashCell, wind, FG, fw);
    const { base, st } = compileAll(src, su);
    GL.wind01 = wind;
    const ctx = { tlook, tlookWidth: TLOOK_WIDTH, bands, fog, shading: { ...shadingT, wetness: 0, floorLum: 0 }, closeBand: 40, handover: [40, 90], features: null, hashCell, skyline: null, cliffType: 1, farGrass: FG || undefined, groundLook: GL };
    for (let t = 0; t < trials; t++) {
      const type = Math.floor(rand() * rows), tt = rand() < 0.5 ? rand() * 60 : rand() * 1700;
      const b = rand() * 1.3, u = rand() * 900 - 100, v = rand() * 900 - 100, time = rand() * 20, faceMode = Math.floor(rand() * 3);
      const nzr = rand(), nph = rand() * 6.2831853, nsn = Math.sqrt(1 - nzr * nzr), nx = nsn * Math.cos(nph), ny = nsn * Math.sin(nph);
      const lo = rLo(), hi = rLo(), w = rW();
      const o = { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3), level: 255 };
      shadeTerrain(tt, type, b, u, v, time, ctx, o, faceMode, 0, nx, ny, nzr, lo, hi, w);
      const g = st(tt, type, b, u, v, time, faceMode, 0, { x: nx, y: ny, z: nzr }, lo, hi, w);
      n++; if (lo && hi && lo !== hi && w > 0 && w < 1) blend++; if (o.level === 254) anim++;
      if ((g.fgw > 0 ? 254 : 255) !== o.level || g.glyph !== o.glyph || q(g.fr) !== o.fg[0] || q(g.fg) !== o.fg[1] || q(g.fb) !== o.fg[2] || q(g.br) !== o.bg[0] || q(g.bg) !== o.bg[1] || q(g.bb) !== o.bg[2]) {
        bad++; if (bad < 6 && src === LOOKSRC) console.error('look terr', JSON.stringify({ hashCell, wind, type, tt, b, u, v, time, lo, hi, w }), g.glyph, o.glyph, g.fr, o.fg[0]);
      }
      if (t % 3 === 0 && (lo | hi)) { // direct lkShade vs shadeLookCell (floats): fu/fv f32, fp ground footprint
        const fu = Math.fround(u), fv = Math.fround(v), fp = rand() < 0.5 ? rand() * 0.6 : rand() * 20;
        const Q = GL.q; Q[0] = fu; Q[1] = fv; Q[2] = fp; Q[3] = tt; Q[4] = time; Q[5] = w; shadeLookCell(GL, lo, hi, Q);
        const L = base.lkShade(fu, fv, fp, tt, time, lo, hi, w);
        lkN++;
        const e = Math.max(Math.abs(L.tone - Q[6]), Math.abs(L.fr - Q[7]), Math.abs(L.fg - Q[8]), Math.abs(L.fb - Q[9]), Math.abs(L.br - Q[10]), Math.abs(L.tr - Q[15]));
        if (e > maxErr) maxErr = e;
        if (L.code !== Q[13] || L.anim !== Q[14] || L.g0 !== Q[18] || L.g1 !== Q[19] || L.g2 !== Q[20]) lkBad++;
        if (Q[14] > 0) lean++;
      }
    }
  }
  return { bad, n, anim, blend, lean, maxErr, lkBad, lkN };
}
// look on, far grass off / on: JS-evaluated shadeTerrain == shadeTerrain twin on >= 3000 cells each (looks 0..6, blends, wind 0 and 1.5)
const r1 = run(LOOKSRC, 600, null);
assert.ok(r1.n >= 3000 && r1.bad <= r1.n * 0.001, `look shadeTerrain vs JS: ${r1.bad}/${r1.n} differ`);
const r2 = run(LOOKSRC, 600, mkFg());
// both lattices, and independence from the foliage bits: w = 0 (0.25 m), 8 (0.75 m), 12 (8 + foliage bit 4), 4 (foliage bit alone: ground stays 0.25 m)
let rw = 0;
for (const fw of [0, 4, 12]) { const r = run(LOOKSRC, 300, null, fw); rw += r.n; assert.ok(r.bad <= r.n * 0.001 && r.lkBad <= r.lkN * 0.002 && r.maxErr < 2e-4, `look parity fogView.w=${fw}: ${r.bad}/${r.n}, lk ${r.lkBad}/${r.lkN}, err ${r.maxErr}`); }
setAltDice(true);
assert.ok(r2.bad <= r2.n * 0.001, `look + far grass shadeTerrain vs JS: ${r2.bad}/${r2.n} differ`);
assert.ok(r1.lkBad <= r1.lkN * 0.002 && r1.maxErr < 2e-4, `lkShade vs shadeLookCell: codes ${r1.lkBad}/${r1.lkN}, max err ${r1.maxErr}`);
assert.ok(r1.blend > 500 && r1.anim > 100 && r1.lean > 50, `coverage blend ${r1.blend} anim ${r1.anim} lean ${r1.lean}`);
// calm (wind 0): look cells never animate
{
  const su = makeSu(0, 0, null); const { st } = compileAll(LOOKSRC, su); let a = 0;
  for (let i = 0; i < 400; i++) { const g = st(rand() * 1700, 0, 0.8, rand() * 500, rand() * 500, rand() * 30, 0, 0, { x: 0, y: 0, z: 1 }, 1 + (i % 6), 0, 0); if (g.fgw > 0) a++; }
  assert.equal(a, 0, 'wind 0: look cells never animate');
}
// mutations are caught
{
  const mc = (a, b) => { const m = LOOKSRC.replace(a, b); assert.ok(m !== LOOKSRC, 'mutation target present: ' + a); return m; };
  assert.ok(run(mc('select(lo, hi, w > h4)', 'select(lo, hi, w < h4)'), 250, null).bad > 5, 'mutation: border dither side caught');
  assert.ok(run(mc('let dith = 1.0 - df * df * (3.0 - 2.0 * df);', 'let dith = 1.0;'), 250, null).bad > 5, 'mutation: dither fade caught');
  assert.ok(run(mc('& 8u) != 0u)', '& 4u) != 0u)'), 250, null, 8).bad > 5, 'mutation: lattice gate bit caught');
  assert.ok(run(mc('0.7500000000, (u32', '0.5000000000, (u32'), 250, null, 8).bad > 5, 'mutation: ground alt size caught');
  setAltDice(true);
  assert.ok(run(mc('hashFast(cx, cy, 71)', 'hashFast(cx, cy, 72)'), 250, null).bad > 5, 'mutation: colour dice salt caught');
}
console.log(`groundLook.wgsl.test.js: look off byte-identical, ${r1.n + r2.n} shadeTerrain probes (looks 0..6, ${r1.blend + r2.blend} blends, wind 0/1.5) + ${r1.lkN + r2.lkN} lkShade probes vs JS twin, max float err ${Math.max(r1.maxErr, r2.maxErr).toExponential(1)}, mutations caught.`);
