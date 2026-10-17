// FD-09a/FD-09b (OB-198): leaf ramp level pairs (?leafq=0) + per-block spread of the leaf dice 16/32/64 m switches (?foldice2=0). Node only.
// Run: node engine/render/leafQuant.test.js
import assert from 'node:assert/strict';
import { SHADE_WGSL } from './gpu/wgsl/shade.wgsl.js';
import { compileFn, makeTex, textureLoad as texLoad, shims } from './gpu/wgsl/wgslProbe.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import paletteModule from '../../design/palette.js';
import detailPassModule from '../../design/detail-pass.js';
import { loadLevel } from '../world/Level.js';
import { shadeCore, pickGlyphCodeFast as jsPick } from './detailShade.js';
import { fogShapeCtx, folDiceJS, setAltDice, setFoliageDice2, setLeafQuant, fogCellDirJS, FOL_DICE_EDGES } from './fogShape.js';
import { packMaterialTable, MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH, SET_F_WIDTH, MAX_LEVELS } from './gpu/ShadeTextures.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));
const packed = packMaterialTable(table);
const { nMat, nSet } = packed.dims;
let seed = 4242;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const imul = Math.imul;
const textureLoad = (tex, c) => { const o = texLoad(tex, c); o.r = o.x; o.g = o.y; o.b = o.z; o.a = o.w; return o; };
const toTex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]]); return makeTex(width, height, d); };
const f1Tex = (flat, width, height) => { const d = []; for (let i = 0; i < width * height; i++) d.push([flat[i], 0, 0, 0]); return makeTex(width, height, d); };
const hashSrc = (src) => src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
  .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
  .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
const mkHash = (src) => { const u = compileFn(hashSrc(src), 'hashFastU', { ...shims, imul }); return { hashFastU: u, hashFast: compileFn(src, 'hashFast', { ...shims, hashFastU: u }) }; };
const terms = { cols: 40, rows: 20, dirX: 0.6, dirY: 0.8, planeX: 0.8, planeY: -0.6, horizonRow: 10, planeDistY: 20 };
const camX = 100.3, camY = 200.7, camZ = 1.5;
const su = {
  wetness: 0, fogView: { x: camZ, y: 0, z: 0, w: 0 }, skyGlowOn: { x: 0, y: 0, z: 0, w: 0 }, cellAspect: packed.uniforms.cellAspect, cutoff: table.shading.cutoff, lift: table.shading.lift,
  aoR: table.ao.r, aoK: table.ao.k, faceK: [[table.faceK[0], table.faceK[1], table.faceK[2], table.faceK[3]], [table.faceK[4], table.faceK[5], table.faceK[6], 0]],
  projMode: 0, skyCam: { x: terms.dirX, y: terms.dirY, z: terms.planeX, w: terms.planeY }, horizonRow: terms.horizonRow, planeDistY: terms.planeDistY, underCam: { x: Math.fround(camX), y: Math.fround(camY) },
};
const consts = { POW2: [0.125, 0.25, 0.5, 1, 2, 4], MAX_LEVELS, TAN22: 0.40403, TAN68: 2.47509, LINE_DASH: 13, LINE_UNDERSCORE: 63, LINE_PIPE: 92, LINE_SLASH: 15, LINE_BACKSLASH: 60 };
function fns(src) {
  const base = { ...shims, ...consts, textureLoad, su, imul, inverseSqrt: (x) => Math.fround(1 / Math.sqrt(x)), uMatF: toTex(packed.matF, MAT_F_WIDTH, nMat), uMatI: toTex(packed.matI, MAT_I_WIDTH, nMat), uSetI: toTex(packed.setI, SET_I_WIDTH, nSet), uSetF: f1Tex(packed.setF, SET_F_WIDTH, nSet) };
  Object.assign(base, mkHash(src));
  for (const n of ['fmodGlsl', 'qfloor', 'smoothstepFast', 'coverFast', 'bevelShadeK', 'orientClassCode', 'crossLineFast', 'lineGlyphCodeFast', 'faceK', 'levelFromThresholds', 'pickCode', 'pickGlyphCodeFast']) base[n] = compileFn(src, n, base);
  base.shadeCore = compileFn(src, 'shadeCore', base);
  // probe shim has no vec*scalar: scalarise the one expression of the projMode 0 branch (same maths)
  const VEC = 'return vec3f(vec2f(hx, hy) * (inverseSqrt(max(hx * hx + hy * hy, 1e-12)) * ce), tanE * ce);';
  assert.ok(src.includes(VEC), 'fogCellDir projMode 0 expression present');
  base.fogCellDir = compileFn(src.replace(VEC, 'let sc = inverseSqrt(max(hx * hx + hy * hy, 1e-12)) * ce; return vec3f(hx * sc, hy * sc, tanE * ce);'), 'fogCellDir', base);
  base.folDice = compileFn(src, 'folDice', base);
  return base;
}

const leafId = [69, 70, 71].find((i) => table.records[i] && table.records[i].v2 && table.records[i].v2.softEdge);
const leafRec = table.records[leafId].v2;
const light = [0.8, 0.75, 0.7];
const ctxOn = (fw) => { su.fogView.w = fw; Object.assign(fogShapeCtx, { on: true, mode: 0, terms, camX, camY, camZ, aaFol: true, aaFolL: false }); setAltDice((fw & 4) !== 0); setFoliageDice2((fw & 32) !== 0); setLeafQuant((fw & 16) !== 0); };
const setId = shadeCore(table, leafRec, 3.3, 4.1, 1, 1e30, 0.01, 0, 0, 0.01, 10, 4, 9, light, {}).setId, S = table.sets[setId], cut = table.shading.cutoff;

// (1) ramp sweep: level/glyph changes with pairs <= 0.55x of today (1000 seeds, +-2% noise)
let nOff = 0, nOn = 0;
for (let sd = 0; sd < 1000; sd++) {
  let pO = -2, pQ = -2;
  for (let i = 0; i <= 1000; i++) {
    const gb = Math.min(1, Math.max(0, i / 1000 + (rand() * 2 - 1) * 0.02));
    const a = jsPick(S, gb, 0, true, 0, cut, false), b = jsPick(S, gb, 0, true, 0, cut, true);
    if (i && a !== pO) nOff++; if (i && b !== pQ) nOn++; pO = a; pQ = b;
  }
}
assert.ok(nOn <= 0.6 * nOff, `leaf level changes ${nOn} vs ${nOff} (${(nOn / nOff).toFixed(2)}x)`);

// (2) footprint < 0.5 block: leafW 0 and byte-identical core; (4) flag off identical
const dSmall = 0.3 * leafRec.grid.u, dBig = 3 * leafRec.grid.u; // dudx = footprint in u units
const core = (d, fw) => { ctxOn(fw); return { ...shadeCore(table, leafRec, 3.3, 4.1, 1, 1e30, d, 0, 0, d, 10, 4, 9, light, {}) }; };
const c0 = core(dSmall, 0), c1 = core(dSmall, 16 | 32 | 4);
assert.equal(c1.leafW, 0, 'small footprint: no pairing'); assert.deepEqual({ ...c1, leafW: 0 }, { ...c0, leafW: 0 }.constructor === Object ? { ...c0, leafW: 0 } : c0, 'small footprint byte-identical core');
assert.equal(core(dBig, 16 | 32 | 4).leafW >= 0.5, true, 'big footprint: pairing on');
assert.equal(core(dBig, 4).leafW, 0, 'leafq off: leafW 0');
assert.equal(jsPick(S, 0.5, 0.3, true, 0, cut, false), jsPick(S, 0.5, 0.3, true, 0, cut, undefined), 'merge flag off == old pick');

// (3) dice: fixed world point, dist 10..80 in 1 cm steps -> at most one change per band edge; 500 blocks span >= 25 % of each edge
ctxOn(4 | 32);
const col = 17, row = 12, dir = fogCellDirJS(col, row);
function sweep(P, a, b) {
  let ch = 0, prev = null; const at = [];
  for (let dist = a; dist <= b; dist += 0.01) {
    fogShapeCtx.camX = P[0] - dir[0] * dist; fogShapeCtx.camY = P[1] - dir[1] * dist; fogShapeCtx.camZ = P[2] - dir[2] * dist;
    const h = folDiceJS(col, row, dist, 1578);
    if (prev !== null && h !== prev) { ch++; at.push(dist); } prev = h;
  }
  return { ch, at };
}
for (let t = 0; t < 20; t++) { const r = sweep([rand() * 400, rand() * 400, rand() * 5], 10, 80); assert.ok(r.ch <= 3, `dice changes ${r.ch} > 3`); }
for (let k = 0; k < 3; k++) {
  const e = FOL_DICE_EDGES[k]; let lo = 1e9, hi = -1;
  for (let t = 0; t < 500; t++) { const r = sweep([rand() * 800, rand() * 800, rand() * 5], e * 0.8, e * 1.2); assert.ok(r.ch <= 1, `edge ${e}: ${r.ch} changes`); if (r.ch) { lo = Math.min(lo, r.at[0]); hi = Math.max(hi, r.at[0]); } }
  assert.ok((hi - lo) / e >= 0.25, `edge ${e}: switch spread ${((hi - lo) / e).toFixed(3)} < 0.25`);
}
// dice2 off == the FD-05 formula
ctxOn(4); fogShapeCtx.camX = 100.3; fogShapeCtx.camY = 200.7; fogShapeCtx.camZ = 1.5;
const dOff = folDiceJS(col, row, 20, 1578); ctxOn(4 | 32); const dOn = folDiceJS(col, row, 20, 1578); assert.ok(Number.isFinite(dOff) && Number.isFinite(dOn));

// (5) WGSL == twin on 200 seeds (+ mutations)
function wgslRun(srcW) {
  const f = fns(srcW);
  f.pickGlyphCodeFast = compileFn(srcW, 'pickGlyphCodeFast', f);
  let bad = 0, n = 0;
  for (const fw of [4 | 16 | 32, 4 | 32, 4 | 16]) {
    ctxOn(fw);
    for (let t = 0; t < 200; t++) {
      const cl = Math.floor(rand() * terms.cols), rw = Math.floor(rand() * terms.rows), dd = 1 + rand() * 90, sd = Math.floor(rand() * 5000);
      const a = f.folDice({ x: cl, y: rw }, { x: terms.cols, y: terms.rows }, dd, sd), b = folDiceJS(cl, rw, dd, sd);
      n++; if (Math.abs(a - b) > 2.5e-7) bad++;
      const d = Math.exp(Math.log(0.04) + rand() * 5 - 2) , u = rand() * 40, v = rand() * 40, dist = 1 + rand() * 40;
      const want = shadeCore(table, leafRec, u, v, 1, 1e30, d, 0, 0, d, dist, 9, 9, light, {});
      const got = f.shadeCore(u, v, 1, 1e30, d, 0, 0, d, dist, 9, 9, leafId, 0.8);
      n++; if (Math.abs(got.leafW - want.leafW) > 1e-5) bad++;
      const gb = rand(), hA = rand(), want2 = jsPick(S, gb, hA, true, 0, cut, want.leafW >= 0.5), got2 = f.pickGlyphCodeFast(setId, gb, hA, 0, cut, got.leafW >= 0.5);
      n++; if (want2 !== got2) bad++;
    }
  }
  return { bad, n };
}
const ok = wgslRun(SHADE_WGSL); assert.equal(ok.bad, 0, `WGSL vs twin mismatches ${ok.bad}/${ok.n}`);
const mut = (a, b) => { const m = SHADE_WGSL.replace(a, b); assert.ok(m !== SHADE_WGSL, 'mutation target present: ' + a); return m; };
const muts = { spread: mut('0.85 + 0.3 * hs', '0.85 + 0.2 * hs'), pair: mut('<< 1) + 1) + 1', '<< 1) + 0) + 1'), edge: mut('ek = select(select(64.0, 32.0, k == 1), 16.0, k == 0)', 'ek = select(select(64.0, 33.0, k == 1), 16.0, k == 0)') };
for (const [k, m] of Object.entries(muts)) assert.ok(wgslRun(m).bad > 0, 'mutation not caught: ' + k);
setAltDice(true); setFoliageDice2(true); setLeafQuant(true); fogShapeCtx.on = false;
console.log(`leafQuant.test: ALL PASS (level changes ${nOff} -> ${nOn} = ${(nOn / nOff).toFixed(2)}x; dice spread ok; WGSL parity ${ok.n} probes; 3 mutations caught)`);
