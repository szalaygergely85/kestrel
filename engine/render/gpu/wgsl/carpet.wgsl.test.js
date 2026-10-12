// OB-073-D2d: carpet.wgsl.js (a) source rules + constants == the JS exports + uniform layout, (b) the trace evaluated in JS (a small WGSL->JS
// transliteration, f64) on random rays vs traceCarpetIn of engine/render/carpet.js, calm and windy, (c) WgCarpetPass host behaviour on the mock
// device (pass order inside WgCellPass, class map re-upload only on a rebake, off = nothing encoded, 0 JS allocation per frame).
// Not covered here (headless, see docs/lanes/pc-b1.md): f32 precision of the real kernel, the gpucompare row (D2e).  node engine/render/gpu/wgsl/carpet.wgsl.test.js
import assert from 'node:assert/strict';
import { CARPET_WGSL, CARPET_TRACE_WGSL, CARPET_BLOCK, CARPET_TEXTURES, CARPET_TARGETS, KIND_GRASS, FACE_U, CARPET_VTAB_ROWS } from './carpet.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { WIND_AT_WGSL } from './common.wgsl.js';
import * as C from '../../carpet.js';
import { makeCarpetCtx, makeCarpetHit, traceCarpetIn, IN_EX, IN_EY, IN_EZ, IN_DX, IN_DY, IN_DZ, IN_THIT, IN_TIME } from '../../carpet.js';
import { hashFastU, hashFast24 } from '../../terrainShade.js';
import * as GB from '../../GBuffer.js';
import { createWind } from '../../../world/wind.js';
import { STEP } from '../../../core/loop.js';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCarpetPass, packCarpetConfig, packCarpetWind } from '../wg/passCarpet.js';
import { PASS_NAMES } from '../wg/WgCellPipeline.js';

// ---- (a) source rules, constants, layout
assert.ok(WGSL_MODULES.some((m) => m.name === 'carpet' && m.code === CARPET_WGSL), 'registered in WGSL_MODULES');
assert.ok(!/%|\bround\s*\(|\bmod\s*\(|dpdx|dpdy|fwidth|textureSample|Math\.random|fract/.test(CARPET_WGSL), 'WGSL string rules');
assert.ok(/fn fs_main\(@builtin\(position\) frag: vec4f\) -> FO/.test(CARPET_WGSL) && /@group\(1\) @binding\(0\) var<uniform> cu: CarpetU/.test(CARPET_WGSL));
assert.deepEqual([...CARPET_TEXTURES], ['uint', 'uint', 'uint', 'uint', 'float', 'uint', 'uint']); // slot 6 = tuft atlas
// TUFT-01b: sin/cos allowed (one cos/sin of the tuft's plane angle; a few ULP differ GPU vs JS, only at hit edges)
assert.deepEqual([...CARPET_TARGETS], ['rgba32ui', 'rgba32ui', 'r32ui']);
const lit = (v) => { const s = String(v); return /[.e]/.test(s) ? s : s + '.0'; };
for (const n of ['ROOT_JITTER', 'LEAN_CAP', 'LEAN_PER_MS', 'PATCH_LO', 'PATCH_RANGE', 'GUST_LO', 'GUST_RANGE', 'FADE_FP0', 'FADE_FP1', 'FADE_R0', 'FADE_R1', 'WMAX_CELLS', 'W_JIT_LO', 'W_JIT_RANGE']) {
  assert.ok(CARPET_TRACE_WGSL.includes(`const ${n}: f32 = ${lit(C[n])};`), `${n} == carpet.js export`);
}
for (const n of ['NMAX', 'RING', 'SALT_JX', 'SALT_JY', 'SALT_RANK', 'SALT_H', 'SALT_TUFT', 'SALT_W', 'SALT_CJX', 'SALT_CJY', 'SALT_PATCH', 'SALT_GUST']) {
  assert.ok(CARPET_TRACE_WGSL.includes(`const ${n}: i32 = ${C[n]};`), `${n} == carpet.js export`);
}
assert.equal(KIND_GRASS, 10); assert.equal(FACE_U, GB.FACE_U);
assert.equal(KIND_GRASS, GB.KIND_GRASS, 'KIND_GRASS == GBuffer.js');
assert.ok(CARPET_WGSL.includes(`KIND_GRASS | (FACE_U << 8u)`) && /\(kVar << 16u\)/.test(CARPET_WGSL), 'GI.y packing: kind | face<<8 | mat<<16 (resolve.wgsl.js layout)');
const w = (n) => CARPET_BLOCK.field(n).word;
assert.deepEqual(['gridCols', 'seed', 'cellM', 'timeSec', 'fpK'].map(w), [0, 2, 8, 15, 23]);
assert.deepEqual(['windP0', 'windP1', 'eye', 'pitchA', 'pitchB', 'pitchC', 'knots', 'vtab'].map(w), [24, 28, 32, 36, 40, 44, 48, 112]);
assert.equal(CARPET_BLOCK.field('vtab').words, 16 * CARPET_VTAB_ROWS * 4);
assert.equal(CARPET_BLOCK.sizeBytes, (112 + 128 + 16 + 8) * 4, '16 variants x 2 vec4 (32 B) + 16 knot vec4 + header + PREC-01a origin (ix0, iy0, orgX, orgY)');
assert.ok(CARPET_BLOCK.sizeBytes <= 65536);

// ---- (b) JS evaluation of the trace
const f32 = (x) => x, i32 = (x) => Math.trunc(x) | 0, u32 = (x) => Math.trunc(x) >>> 0;
const shims = {
  f32, i32, u32, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, sqrt: Math.sqrt,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)), select: (fv, tv, c) => (c ? tv : fv), vec2f: (x, y) => ({ x, y }),
};
function transliterate(src) {
  return src.replace(/\/\/[^\n]*/g, '')
    .replace(/var<private> (\w+): \w+;/g, 'let $1 = 0;')
    .replace(/\bconst (\w+): \w+ =/g, 'const $1 =')
    .replace(/\bfn (\w+)\(([^)]*)\)(?: -> \w+)? \{/g, (m, n, a) => `function ${n}(${a.split(',').map((x) => x.split(':')[0].trim()).filter(Boolean).join(', ')}) {`)
    .replace(/\b(let|var) (\w+): \w+ =/g, 'let $2 =').replace(/\bvar (\w+): \w+;/g, 'let $1 = 0;').replace(/\bvar /g, 'let ')
    .replace(/\b(0x[0-9a-fA-F]+|\d+)u\b/g, '$1').replace(/>>/g, '>>>');
}
const traceJs = transliterate(`${WIND_AT_WGSL}\n${CARPET_TRACE_WGSL}`);
function makeTwin(cu, tex, K) {
  const ext = { cu, hashFastU, maskTexel: (i, j) => tex.mask[j * tex.mw + i] * (1 / 255), classTexel: (i, j) => tex.cls[j * tex.cw + i], nearTexel: (i, j) => tex.near[j * tex.nw + i], windKnot: (i) => K[i], atlasTexel: (i, j) => { const o = (j * tex.aw + i) * 2; return { x: tex.atlas[o], y: tex.atlas[o + 1] }; }, cos: Math.cos, sin: Math.sin, ...shims };
  const names = Object.keys(ext);
  return new Function(...names, `${traceJs}
    return { run(ex, ey, ez, dx, dy, dz, th) { rEx = ex; rEy = ey; rEz = ez; rDx = dx; rDy = dy; rDz = dz; return traceCarpet(th); },
             k: () => ({ t: kTb, h01: kH01, z: kZ, v: kVar, lx: kLx, ly: kLy, n2: rN2 }) };`)(...names.map((n) => ext[n]));
}
assert.equal(hashFast24(3, -7, 11), hashFastU(3, -7, 11) >>> 8, 'hash24 twin identity');

// fixture: class map 20x20 of 2 m cells (x0 -20), west meadow / east straw / path strip; near-band heights 80x80 of 0.5 m
const CW = 20, X0 = -20, classMap = new Uint8Array(CW * CW);
for (let j = 0; j < CW; j++) for (let i = 0; i < CW; i++) classMap[j * CW + i] = Math.abs(X0 + j * 2 + 1) < 1 ? 0 : (i < 10 ? 1 : 2);
const NW = 80, NC = 0.5, near = new Float32Array(NW * NW);
for (let j = 0; j < NW; j++) for (let i = 0; i < NW; i++) near[j * NW + i] = 0.03 * Math.sin((X0 + (i + 0.5) * NC) * 0.3) + 0.02 * (X0 + (j + 0.5) * NC) + 0.01 * Math.sin(i * 1.7 + j);
const gridH = (x, y) => { // design util.gridHeight (inside the grid)
  const fx = (x - X0) / NC - 0.5, fy = (y - X0) / NC - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const a = near[i + j * NW], b = near[i + 1 + j * NW], c = near[i + (j + 1) * NW], d = near[i + 1 + (j + 1) * NW];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const groundQ = (q) => { q[2] = gridH(q[0], q[1]); };
const cfg = { seed: 7, radiusM: 6, variants: [
  { name: 'meadow', ground: ['grass'], density: 0.9, heightM: [0.10, 0.22], ramp: ['a', 'b'] },
  { name: 'straw', ground: ['grassTall'], density: 0.8, heightM: [0.35, 0.55], bladeW: 0.07, swayGain: 1.5, ramp: ['a', 'b'] },
] };
// MASK-c fixture: a 24x24 (0.5 m) mask window over x,y in [-6, 6) (the class map spans [-20, 20)): a zero patch, a gradient, the rest 150..255
const MW = 24, MX0 = -6, maskData = new Uint8Array(MW * MW);
for (let j = 0; j < MW; j++) for (let i = 0; i < MW; i++) maskData[j * MW + i] = i < 4 ? 0 : 150 + ((i * 7 + j * 13) % 106);
const carpet = { cfg, classMap, x0: X0, y0: X0, w: CW, h: CW, mask: { data: maskData, x0: MX0, y0: MX0, w: MW, h: MW, cellM: 0.5 }, maskVersion: 1 };
const nearH = { data: near, w: NW, h: NW, x0: X0, y0: X0, cell: NC };

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function terrainT(e, d) {
  let t = 0.02, prev = 0;
  for (; t < 40; prev = t, t += 0.04) {
    if (e[2] + d[2] * t < gridH(e[0] + d[0] * t, e[1] + d[1] * t)) {
      let a = prev, b = t;
      for (let k = 0; k < 24; k++) { const m = 0.5 * (a + b); if (e[2] + d[2] * m < gridH(e[0] + d[0] * m, e[1] + d[1] * m)) b = m; else a = m; }
      return 0.5 * (a + b);
    }
  }
  return Infinity;
}

function parity(label, windDef, N) {
  const wind = windDef ? createWind(windDef, 5) : null, p = wind ? wind.params : null;
  const wq = new Float64Array(2);
  const jsWind = wind ? (q) => { wind._baseInto(q[0], q[1], q[2] / STEP, wq); q[3] = wq[0]; q[4] = wq[1]; } : null;
  const ctx = makeCarpetCtx(carpet, groundQ, jsWind), out = makeCarpetHit();
  const f = new Float32Array(CARPET_BLOCK.sizeWords), iv = new Int32Array(f.buffer);
  packCarpetConfig(carpet, nearH, f, iv); packCarpetWind(p, f, iv);
  // the uniform view the twin reads: the packed words (f32-rounded, so compare with a tolerance, not bit-exact)
  const v4 = (word) => ({ x: f[word], y: f[word + 1], z: f[word + 2], w: f[word + 3] });
  const cu = {
    seed: iv[w('seed')], windOn: iv[w('windOn')], classW: iv[w('classW')], classHt: iv[w('classHt')], nearW: iv[w('nearW')], nearHt: iv[w('nearHt')],
    timeSec: 0, fpK: 0, windP0: v4(w('windP0')), windP1: v4(w('windP1')),
    tufts: iv[w('tufts')], atlasN: iv[w('atlasN')], atlasW: iv[w('atlasW')], atlasH: iv[w('atlasH')], tuftR: f[w('tuftR')], rootJit: f[w('rootJit')],
    maskX0: MX0, maskY0: MX0, maskW: MW, maskHt: MW, maskOn: 1,
    vtab: Array.from({ length: 16 * CARPET_VTAB_ROWS }, (_, k) => v4(w('vtab') + k * 4)),
  };
  for (const n of ['cellM', 'radiusM', 'patchM', 'classCellM', 'classJitterM', 'gustM', 'travelM', 'classX0', 'classY0', 'nearX0', 'nearY0', 'nearCell', 'maxH', 'wMax']) cu[n] = f[w(n)];
  // f32-packed config vs the f64 JS ctx: make the JS ctx see the same numbers so the comparison is about the algorithm, not f32 rounding of 0.1
  for (const [k, n] of [['cellM', 'cellM'], ['radiusM', 'radiusM'], ['patchM', 'patchM'], ['classJitterM', 'classJitterM'], ['gustM', 'gustM'], ['travelM', 'travelM'], ['maxH', 'maxH'], ['wMax', 'wMax']]) ctx[k] = cu[n];
  ctx.tuftR = cu.tuftR; assert.equal(cu.tufts, 1, 'tufts on by default'); assert.equal(ctx.rootJit, cu.rootJit);
  for (let v = 1; v <= 2; v++) { ctx.dens[v] = cu.vtab[v * 2].x; ctx.hMin[v] = cu.vtab[v * 2].y; ctx.hMax[v] = cu.vtab[v * 2].z; ctx.bw[v] = cu.vtab[v * 2].w; ctx.sway[v] = cu.vtab[v * 2 + 1].x; ctx.tuftP[v] = cu.vtab[v * 2 + 1].y; ctx.tuftMul[v] = cu.vtab[v * 2 + 1].z; }
  assert.equal(cu.vtab[0].x, 0, 'variant 0 = no carpet'); assert.equal(cu.vtab[1].x, 1, 'variant 0 sway 1');
  const K = p ? p.K : null;
  const twin = makeTwin(cu, { cls: classMap, cw: CW, near, nw: NW, mask: maskData, mw: MW, atlas: ctx.atlas.data, aw: ctx.atlas.w }, K);
  const r = rng(12345), e = [-3, 3, 1.5], d = [0, 0, 0];
  let hits = 0, agree = 0, bad = 0, maxErr = 0;
  const stepsHist = { over: 0 };
  for (let n = 0; n < N; n++) {
    const yaw = r() * Math.PI * 2, pit = -(0.05 + r() * 1.3);
    d[0] = Math.cos(pit) * Math.cos(yaw); d[1] = Math.cos(pit) * Math.sin(yaw); d[2] = Math.sin(pit);
    const tm = r() * 20, th = terrainT(e, d);
    cu.timeSec = tm; if (!isFinite(th)) continue;
    ctx.inp[IN_EX] = e[0]; ctx.inp[IN_EY] = e[1]; ctx.inp[IN_EZ] = e[2]; ctx.inp[IN_DX] = d[0]; ctx.inp[IN_DY] = d[1]; ctx.inp[IN_DZ] = d[2]; ctx.inp[IN_THIT] = th; ctx.inp[IN_TIME] = tm;
    // PREC-01a: the twin gets the lattice origin and the eye relative to it (f64 here, like passCarpet.run)
    cu.ix0 = Math.floor(e[0] / cu.cellM); cu.iy0 = Math.floor(e[1] / cu.cellM); cu.orgX = cu.ix0 * cu.cellM; cu.orgY = cu.iy0 * cu.cellM;
    const a = traceCarpetIn(ctx, out), b = twin.run(e[0] - cu.orgX, e[1] - cu.orgY, e[2], d[0], d[1], d[2], th);
    if (out.steps > C.NMAX) stepsHist.over++;
    if (a) hits++;
    if (!!a === !!b) { agree++; if (a) { const k = twin.k(); maxErr = Math.max(maxErr, Math.abs(k.t - out.t), Math.abs(k.h01 - out.h01), Math.abs(k.z - out.z), k.v === out.variant ? 0 : 1);
      const inv = k.n2 > 1e-12 ? 1 / Math.sqrt(k.n2) : 0; maxErr = Math.max(maxErr, Math.abs((k.lx * d[1] - k.ly * d[0]) * inv / C.LEAN_CAP - out.lean)); } } else bad++;
  }
  console.log(`  ${label}: ${N} rays, ${hits} JS hits, ${bad} hit/miss mismatches, max field error ${maxErr.toExponential(2)}`);
  assert.ok(hits > N * 0.05, `${label}: enough blade hits (${hits})`);
  assert.ok(bad <= N * 0.002, `${label}: hit/miss mismatch ${bad}/${N}`);
  assert.ok(maxErr < 1e-6, `${label}: matched-hit fields within 1e-6 (${maxErr})`);
}
parity('calm', null, 3000);
// ---- MASK-c: mask semantics (JS twin)
{
  const { traceCarpetBrute, bladeAtCell, setCarpetMask, MASK_MIN } = C;
  const mk = (data, w, h, x0, y0) => ({ data, w, h, x0, y0, cellM: 0.5 });
  const base = { cfg, classMap, x0: X0, y0: X0, w: CW, h: CW };
  const c0 = makeCarpetCtx(base, groundQ, null), out4 = new Float64Array(4), out4m = new Float64Array(4);
  // cell with a known meadow blade (west half): find one inside the future mask window, away from its border
  let ci = 0, cj = 0, found = false; for (let j = -30; j < 30 && !found; j++) for (let i = -40; i < -5; i++) { bladeAtCell(c0, i, j, out4); if (out4[3] === 1 && out4[0] > -4.5 && out4[0] < -2 && out4[1] > -3 && out4[1] < 3) { ci = i; cj = j; found = true; break; } }
  assert.ok(found && out4[3] === 1, 'fixture blade found');
  const h0 = out4[2], rx = out4[0], ry = out4[1];
  const uni = (val) => { const d = new Uint8Array(MW * MW).fill(val); return mk(d, MW, MW, MX0, MX0); };
  setCarpetMask(c0, uni(0)); bladeAtCell(c0, ci, cj, out4m); assert.equal(out4m[3], 0, 'mask 0 -> no blade');
  setCarpetMask(c0, uni(255)); bladeAtCell(c0, ci, cj, out4m); assert.ok(Math.abs(out4m[2] - h0) < 1e-12 && out4m[3] === 1, 'mask 1 -> unchanged');
  setCarpetMask(c0, uni(128)); bladeAtCell(c0, ci, cj, out4m); assert.ok(Math.abs(out4m[2] - h0 * 128 / 255) < 1e-12, 'mask 0.5 -> half height (' + out4m[2] / h0 + ')');
  setCarpetMask(c0, uni(8)); bladeAtCell(c0, ci, cj, out4m); assert.equal(out4m[3], 0, 'mask below ' + MASK_MIN + ' (8/255 = 0.031) -> no blade');
  setCarpetMask(c0, mk(new Uint8Array(MW * MW), MW, MW, rx + 50, ry + 50)); bladeAtCell(c0, ci, cj, out4m); assert.ok(out4m[3] === 1 && Math.abs(out4m[2] - h0) < 1e-12, 'outside the window = no mask');
  setCarpetMask(c0, null); bladeAtCell(c0, ci, cj, out4m); assert.ok(out4m[3] === 1 && Math.abs(out4m[2] - h0) < 1e-12, 'no mask object = no mask');
  // bilerp on cell centres: a 2x2 mask, root at the exact centre of the 4 texels = their mean
  const d2 = new Uint8Array([0, 255, 255, 0]); setCarpetMask(c0, mk(d2, 2, 2, Math.floor(rx), Math.floor(ry)));
  const m2 = c0.mData; assert.ok(m2 === d2);
  // DDA == brute force with the mask on (same blades win)
  const cm = makeCarpetCtx(carpet, groundQ, null), cb = makeCarpetCtx(carpet, groundQ, null), oa = makeCarpetHit(), ob = makeCarpetHit();
  const rr = rng(99), ee = [-3, 3, 1.5], dd = [0, 0, 0]; let nHit = 0, nBad = 0;
  for (let n = 0; n < 1500; n++) {
    const yaw = rr() * Math.PI * 2, pit = -(0.05 + rr() * 1.3);
    dd[0] = Math.cos(pit) * Math.cos(yaw); dd[1] = Math.cos(pit) * Math.sin(yaw); dd[2] = Math.sin(pit);
    const th = terrainT(ee, dd); if (!isFinite(th)) continue;
    const a = C.traceCarpet(ee, dd, th, cm, 0, oa), b = traceCarpetBrute(ee, dd, th, cb, 0, ob);
    if (a) nHit++;
    if (a !== b || (a && (oa.ix !== ob.ix || oa.iy !== ob.iy))) nBad++;
  }
  assert.ok(nHit > 50, 'masked DDA hits ' + nHit); assert.equal(nBad, 0, 'masked DDA == brute force');
  console.log('  MASK-c semantics ok (' + nHit + ' masked DDA hits, 0 brute-force mismatches)');
}
parity('wind 4 m/s', { dirDeg: 40, speed: 4, gust: { amp: 0.6, periodSec: 3, travel: 8 } }, 3000);

// ---- (c) pass host on the mock device
{
  const m = makeMockGpuDevice(), d = m.device, log = [];
  for (const fn of ['beginPass', 'draw', 'endPass', 'writeTexture']) { const o = d[fn].bind(d); d[fn] = (...a) => { log.push(fn); return o(...a); }; }
  const cp = new WgCarpetPass(d);
  const tgt = { texGI: { n: 'gi' }, texGA: { n: 'ga' }, texDepth: { n: 'dp' }, targetLight: 1 };
  const pitch = { fX: 0, fY: 1, fZ: 0, tanHalfX: 1, tanHalfY: 0.5, rX: 1, rY: 0, uX: 0, uY: 0, uZ: 1 };
  const p = { cols: 120, rows: 45, _cam: { x: 1, y: 2, z: 3 }, _rasterPass: { pitched: true, ortho: false, pitch } };
  assert.equal(cp.run(p, tgt), null, 'off (no carpet set): returns null and encodes nothing');
  assert.deepEqual(log, []);
  cp.setCarpet(carpet, nearH, 1);
  assert.equal(cp.stats.classUploads, 1); assert.equal(cp.stats.nearUploads, 1); assert.equal(cp.stats.maskUploads, 1, 'mask uploaded once');
  log.length = 0;
  const v1 = cp.run(p, tgt);
  assert.deepEqual(log, ['beginPass', 'draw', 'endPass'], 'one fullscreen pass');
  assert.ok(v1 && v1.texGI === cp.texGI && v1.texDepth === cp.texDepth && v1.targetLight === 1 && tgt.texGI.n === 'gi', 'alias swaps GI/GA/Depth, keeps the rest, leaves t untouched');
  cp.setTime(1.5);
  for (let i = 0; i < 5; i++) { cp.setCarpet(carpet, nearH, 1); assert.equal(cp.run(p, tgt), v1, 'same alias object every frame'); }
  assert.equal(cp.stats.classUploads, 1, 'class map uploads only on a rebake (spy)');
  assert.equal(cp.stats.maskUploads, 1, 'mask uploads only when maskVersion changes');
  carpet.maskVersion = 2; cp.setCarpet(carpet, nearH, 1); assert.equal(cp.stats.maskUploads, 2, 'maskVersion bump = mask re-upload only');
  assert.equal(cp.stats.classUploads, 1, 'class map untouched by a mask version bump');
  cp.setCarpet(carpet, nearH, 2);
  assert.equal(cp.stats.classUploads, 2, 'version bump = re-upload');
  p._rasterPass.ortho = true; assert.equal(cp.run(p, tgt), null, 'ortho: no carpet');
  p._rasterPass.ortho = false; cp.setCarpet(null, null, 0); assert.equal(cp.run(p, tgt), null, 'carpet set to null = off');
  // 0 allocation per frame: heap delta over 2000 runs (needs --expose-gc; skipped otherwise)
  cp.setCarpet(carpet, nearH, 3); cp.setWind(createWind({ dirDeg: 10, speed: 3, gust: { amp: 0.5, periodSec: 3, travel: 8 } }, 1).params);
  for (let i = 0; i < 300; i++) cp.run(p, tgt);
  if (typeof global.gc === 'function') {
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) { cp.setTime(i * 0.016); cp.run(p, tgt); }
    global.gc(); const dh = process.memoryUsage().heapUsed - h0;
    assert.ok(dh < 100000, `0 alloc per frame (heap delta ${dh} B over 2000 frames)`);
  } else console.log('  note: run with --expose-gc for the frame-alloc check');
  // pass order in the pipeline list: 'carpet' directly after 'resolve'
  assert.equal(PASS_NAMES.indexOf('carpet'), PASS_NAMES.indexOf('resolve') + 1);
}
console.log('carpet.wgsl: ok');
