// FD-05 (arch ARCH CHANGES D): flag-ON parity of the alt-glyph dice. shadeCore (texel die 0.25 scale) and folDice (leaf block q *= 3.0) taken from SHADE_WGSL and
// JS-evaluated with fogView.w = 4 and 7, vs detailShade.shadeCore / fogShape.folDiceJS with fogShapeCtx.on + setAltDice(true); w = 0 vs setAltDice(false).
// Mutations of the `0.25` die scale and of `q *= 3.0` must be caught. Node only. Run: node engine/render/gpu/wgsl/aaAlt.wgsl.test.js
import assert from 'node:assert/strict';
import { SHADE_WGSL } from './shade.wgsl.js';
import { compileFn, makeTex, textureLoad as texLoad, shims } from './wgslProbe.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';
import { loadLevel } from '../../../world/Level.js';
import { shadeCore } from '../../detailShade.js';
import { fogShapeCtx, folDiceJS, setAltDice, setFoliageDice2, setLeafQuant, fogCellDirJS } from '../../fogShape.js';
import { packMaterialTable, MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH, SET_F_WIDTH, MAX_LEVELS } from '../ShadeTextures.js';

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
const matIds = []; for (let id = 1; id < nMat; id++) if (table.records[id] && table.records[id].v2) matIds.push(id);
// run both probes at fogView.w = fw; returns mismatch counts + how many dice values actually differ between alt on/off (coverage)
function run(src, fw, trials) {
  const f = fns(src);
  su.fogView.w = fw;
  Object.assign(fogShapeCtx, { on: true, mode: 0, terms, camX, camY, camZ, aaFol: (fw & 1) !== 0, aaFolL: (fw & 2) !== 0 });
  setAltDice((fw & 4) !== 0); setFoliageDice2((fw & 32) !== 0); setLeafQuant((fw & 16) !== 0); // FD-09: bits 16/32 off here (leafQuant.test.js covers them)
  let badCore = 0, badDice = 0, n = 0, m = 0;
  for (let t = 0; t < trials; t++) {
    const id = matIds[t % matIds.length], rec = table.records[id].v2;
    const kind = [1, 2, 3, 4, 5, 8, 9][Math.floor(rand() * 7)], face = 1 + Math.floor(rand() * 7);
    const u = rand() * 40 - 5, v = rand() * 40 - 5, z = rand() * 12, dist = 0.5 + rand() * 60, d = 0.01 + rand() * 0.05;
    const light = [rand() * 1.4, rand() * 1.2, rand()];
    const want = shadeCore(table, rec, u, v, z, 1e30, d, 0, 0, d, dist, face, kind, light, {});
    const got = f.shadeCore(u, v, z, 1e30, d, 0, 0, d, dist, face, kind, id, Math.max(light[0], light[1], light[2]));
    n++; if (Math.abs(got.hA - want.hA) > 2.5e-7 || Math.abs(got.hB - want.hB) > 2.5e-7) badCore++;
    const col = Math.floor(rand() * terms.cols), row = Math.floor(rand() * terms.rows), dd = 1 + rand() * 90, sd = Math.floor(rand() * 5000);
    const a = f.folDice({ x: col, y: row }, { x: terms.cols, y: terms.rows }, dd, sd), b = folDiceJS(col, row, dd, sd);
    m++; if (Math.abs(a - b) > 2.5e-7) { badDice++; if (process.env.DBG && badDice < 4) console.error(a, b, col, row, dd, sd, JSON.stringify(f.fogCellDir({ x: col, y: row }, { x: terms.cols, y: terms.rows })), Array.from(fogCellDirJS(col, row))); }
  }
  return { badCore, badDice, n, m };
}
const mut = (a, b, all) => { const m = all ? SHADE_WGSL.split(a).join(b) : SHADE_WGSL.replace(a, b); assert.ok(m !== SHADE_WGSL, 'mutation target present: ' + a); return m; };
let total = 0;
for (const fw of [0, 4, 7]) {
  const r = run(SHADE_WGSL, fw, 3000); total += r.n + r.m;
  assert.ok(r.badCore <= r.n * 0.002, `shadeCore hA/hB vs JS at fogView.w=${fw}: ${r.badCore}/${r.n}`);
  assert.ok(r.badDice <= r.m * 0.003, `folDice vs folDiceJS at fogView.w=${fw}: ${r.badDice}/${r.m}`);
}
// mutations (flag on): the 0.25 texel-die scale and the q *= 3.0 leaf block
const m1 = run(mut('u * ds * 0.25', 'u * ds * 0.5'), 4, 3000), m2 = run(mut('select(1.0, 3.0, (u32', 'select(1.0, 2.0, (u32'), 4, 3000), m3 = run(mut('select(1.0, 3.0, (u32', 'select(1.0, 1.0, (u32'), 7, 3000);
assert.ok(m1.badCore > 5, 'mutation: 0.25 die scale (u) caught ' + m1.badCore);
assert.ok(m2.badDice > 20 && m3.badDice > 20, `mutation: q *= 3.0 caught ${m2.badDice}/${m3.badDice}`);
setAltDice(true); setFoliageDice2(true); setLeafQuant(true); fogShapeCtx.on = false;
console.log(`aaAlt.wgsl.test.js: ${total} flag-on/off probes (fogView.w 0/4/7) shadeCore + folDice vs JS twins passed, mutations caught (0.25 die scale ${m1.badCore}, q *= 3.0 ${m2.badDice}/${m3.badDice}).`);
