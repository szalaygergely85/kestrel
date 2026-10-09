// WG-3b: light.wgsl.js (+ the shared common.wgsl.js ray/oct/falloff helpers) string rules, uniform layout, and the scalar/vec3
// functions evaluated in JS (wgslProbe) against their JS twins: lighting.js falloff/sampleVis/sunVisible, octNormal.js,
// projection.js unprojectPitched. Not probed (no vector-matrix shim): sunShadowTaps' mat4 multiply and fs_main's glue;
// those are covered by the compile check and the WG-3 gpucompare rows. node engine/render/gpu/wgsl/light.wgsl.test.js
import assert from 'node:assert/strict';
import { LIGHT_WGSL, LIGHT_BLOCK, LIGHT_TEXTURES, LIGHT_TARGETS } from './light.wgsl.js';
import { CELL_RAY_WGSL, CELL_RAY_PITCHED_WGSL, FALLOFF_FAST_WGSL, OCT_NORMAL_WGSL } from './common.wgsl.js';
import { WGSL_MODULES } from './index.js';
import { compileFn, makeTex, textureLoad, shims, numericLiterals } from './wgslProbe.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_VIS_CELLS, MAX_SUN_STEPS, falloff, sampleVis, sunVisible } from '../../lighting.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { packNormalOct, unpackNormalOct } from '../../../voxel/octNormal.js';
import { unprojectPitched } from '../../projection.js';
import { CLOUD_Q_SHIFT } from '../../shadowSun.js';
import { AO_MAX } from '../../horizonAo.js';

// --- string rules (38.5) ---
assert.ok(WGSL_MODULES.some((m) => m.name === 'light' && m.code === LIGHT_WGSL), 'registered');
assert.ok(!/%|\bround\s*\(|dpdx|dpdy|fwidth|frag_depth|textureSample|texelFetch|gl_FragCoord|\bmod\s*\(|ivec2|uvec|\bint\(/.test(LIGHT_WGSL), 'no raw % / GLSL names');
assert.ok(/fn vs_main/.test(LIGHT_WGSL) && /fn fs_main\(@builtin\(position\) frag: vec4f\) -> @location\(0\) vec4u/.test(LIGHT_WGSL));
assert.deepEqual(LIGHT_TEXTURES, ['uint', 'uint', 'uint', 'uint', 'float', 'uint', 'depth']);
assert.deepEqual(LIGHT_TARGETS, ['rgba32uint']);
const types = ['texture_2d<u32>', 'texture_2d<u32>', 'texture_2d<u32>', 'texture_2d<u32>', 'texture_2d<f32>', 'texture_2d<u32>', 'texture_depth_2d'];
types.forEach((t, i) => assert.ok(LIGHT_WGSL.includes(`@group(0) @binding(${i}) var `) && new RegExp(`@binding\\(${i}\\) var \\w+: ${t.replace(/[<>]/g, '\\$&')}`).test(LIGHT_WGSL), `binding ${i} ${t}`));
assert.ok(/@group\(1\) @binding\(0\) var<uniform> u: LightU/.test(LIGHT_WGSL));
assert.ok(new RegExp(`const MAX_VIS_DIM: i32 = ${MAX_VIS_DIM};`).test(LIGHT_WGSL) && new RegExp(`const MAX_STRUCTS: i32 = ${MAX_STRUCTS};`).test(LIGHT_WGSL), 'constants interpolated');
assert.ok(/textureLoad\(uSunShadow, t, 0\)/.test(LIGHT_WGSL) && !/textureSample/.test(LIGHT_WGSL), 'NEAREST depth read by textureLoad');
assert.ok(/t\.x < 0 \|\| t\.y < 0 \|\| t\.x >= res \|\| t\.y >= res/.test(LIGHT_WGSL), 'explicit tap bounds check');

// --- uniform layout: vec3 + f32 packing, array rows, total size ---
const w = (n) => LIGHT_BLOCK.field(n).word;
assert.deepEqual(['ambient', 'posX', 'sunDir', 'sunShadowRes', 'sunCol', 'sunShadowTexelM', 'gridCols', 'structCount', 'posY', 'sunShadowBiasM', 'pitchA'].map(w), [0, 3, 4, 7, 8, 11, 12, 16, 20, 28, 32]);
assert.equal(LIGHT_BLOCK.field('sunShadowM').offset % 16, 0);
assert.equal(LIGHT_BLOCK.field('lightPos').words, MAX_LIGHTS * 4);
assert.equal(LIGHT_BLOCK.field('structB').words, MAX_STRUCTS * 4);
// S8-B2-12c (38.13): word 30 is a pad again (cloudCover gone); cloudA/cloudB vec4 are appended at the very END (316, 320).
assert.equal(LIGHT_BLOCK.field('pad30').word, 30);
// S8-B2-20 (38.17): aoStrength takes the last pad word (31); pitchA stays at word 32.
assert.equal(LIGHT_BLOCK.field('aoStrength').word, 31);
assert.equal(LIGHT_BLOCK.field('pitchA').word, 32);
assert.equal(LIGHT_BLOCK.field('cloudA').word, 316);
assert.equal(LIGHT_BLOCK.field('cloudB').word, 320);
assert.equal(LIGHT_BLOCK.field('aoP').word, 324);
assert.equal(LIGHT_BLOCK.sizeBytes, 1312);
assert.ok(LIGHT_WGSL.includes('aoRc(u.aoP.x, u.planeDistY, dist, u.aoP.z)'), 'rc from aoP');
assert.ok(!/AO_TAP_CELLS|AO_RADIUS_M|AO_BIAS/.test(LIGHT_WGSL), 'legacy AO consts gone');


// --- S8-B2-20 (38.17): horizon AO wired into fs_main, cellPoint/aoTapCell present, never-brighten shape ---
assert.ok(/fn cellPoint\(/.test(LIGHT_WGSL), 'cellPoint fn present (taps only - P itself is not refactored)');
assert.ok(/fn aoTapCell\(/.test(LIGHT_WGSL), 'aoTapCell fn present');
assert.ok(/fn aoTapOcc\(/.test(LIGHT_WGSL), 'aoTapOcc fn present (common.wgsl.js HORIZON_AO_WGSL interpolated)');
assert.ok(/u\.aoStrength > 0\.0/.test(LIGHT_WGSL), 'AO block guarded by a uniform branch on aoStrength');
assert.ok(/L -= u\.ambient \* \(1\.0 - aoF\)/.test(LIGHT_WGSL), 'AO subtracts from L (never adds - cannot brighten)');

// --- S8-B2-12c (38.13): cloud-shadow byte wired into fs_main, CLOUD_Q_SHIFT = 24, no raw % / round ---
assert.ok(new RegExp(`const CLOUD_Q_SHIFT: u32 = ${CLOUD_Q_SHIFT}u;`).test(LIGHT_WGSL), 'CLOUD_Q_SHIFT interpolated');
assert.ok(LIGHT_WGSL.includes('fn cloudShadeQ(P: vec3f, sd: vec3f) -> u32'), 'cloudShadeQ(P, sd) -> u32 present');
assert.ok(LIGHT_WGSL.includes('u.cloudA.w > 0.0'), 'cloud branch guarded by a uniform branch on cloudA.w (strength)');
assert.ok(LIGHT_WGSL.includes('| cloudBits)'), 'LIGHT.w carries the cloud byte');
assert.ok(!/cloudCov|CLOUD_DARK|CLOUD_SHIFT/.test(LIGHT_WGSL), 'old 12a names are gone');
// Same mutation guard for AO_MAX (also 0.6 - the two consts' declarations are checked independently, never by a
// whole-text literal-set difference, for exactly the coincidence noted above).
{
  const lits = numericLiterals(LIGHT_WGSL);
  assert.ok(lits.has(AO_MAX), 'LIGHT_WGSL literal-set has AO_MAX');
  const mutated = LIGHT_WGSL.replace(`const AO_MAX: f32 = ${AO_MAX};`, 'const AO_MAX: f32 = 0.42;');
  assert.ok(numericLiterals(mutated).has(0.42) && !new RegExp(`const AO_MAX: f32 = ${AO_MAX};`).test(mutated), 'mutation: a changed AO_MAX literal is caught');
}

let seed = 7;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
let probes = 0;

// --- falloffFast vs lighting.falloff (exact: same op order) ---
{
  const f = compileFn(FALLOFF_FAST_WGSL, 'falloffFast', { ...shims });
  for (let i = 0; i < 2000; i++) { const d = rand() * 12, r = 0.5 + rand() * 10; assert.equal(f(d, r), falloff(d, r)); probes++; }
}

// --- packNormalOct / unpackNormalOct vs octNormal.js (the shared oracle; GLSL common.js twin) ---
{
  const pack = compileFn(OCT_NORMAL_WGSL, 'packNormalOct', { ...shims });
  const unpack = compileFn(OCT_NORMAL_WGSL, 'unpackNormalOct', { ...shims });
  const out = new Float64Array(3);
  for (let i = 0; i < 2000; i++) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    const e = packNormalOct(x, y, z);
    assert.equal(pack({ x, y, z }) >>> 0, e, 'pack');
    unpackNormalOct(e, out); const n = unpack(e);
    close(n.x, out[0], 1e-14, 'unpack x'); close(n.y, out[1], 1e-14, 'unpack y'); close(n.z, out[2], 1e-14, 'unpack z');
    probes += 2;
  }
}

// --- cellRayP (literal shear formula) and cellRayPitched vs projection.js unprojectPitched ---
{
  const ray = compileFn(CELL_RAY_WGSL, 'cellRayP', { ...shims });
  const dirP = compileFn(CELL_RAY_PITCHED_WGSL, 'cellDirPitched', { ...shims });
  const rayP = compileFn(CELL_RAY_PITCHED_WGSL, 'cellRayPitched', { ...shims, cellDirPitched: dirP });
  const o3 = new Float64Array(3);
  for (let i = 0; i < 1000; i++) {
    const cols = 160, rows = 60, cx = Math.floor(rand() * cols), cy = Math.floor(rand() * rows), dist = rand() * 40;
    const posX = rand() * 50, posY = rand() * 50, eyeH = rand() * 3, dirX = rand() * 2 - 1, dirY = rand() * 2 - 1, planeX = rand(), planeY = rand();
    const horizonRow = rand() * rows, planeDistY = 1 + rand() * 4;
    const r = ray({ x: cx, y: cy }, { x: cols, y: rows }, posX, posY, eyeH, dirX, dirY, planeX, planeY, horizonRow, planeDistY, dist);
    const camX = (2 * (cx + 0.5)) / cols - 1;
    assert.equal(r.x, posX + (dirX + planeX * camX) * dist); assert.equal(r.y, posY + (dirY + planeY * camX) * dist);
    assert.equal(r.z, eyeH + (-(cy - horizonRow) / planeDistY) * dist);
    const t = { cols, rows, tanHalfX: rand() + 0.3, tanHalfY: rand() * 0.5 + 0.2, fX: rand(), fY: rand(), fZ: rand() - 0.5, rX: rand(), rY: rand(), uX: rand(), uY: rand(), uZ: rand(), eyeX: posX, eyeY: posY, eyeZ: eyeH };
    const p = rayP({ x: cx, y: cy }, { x: cols, y: rows }, { x: posX, y: posY, z: eyeH }, { x: t.fX, y: t.fY, z: t.fZ }, { x: t.rX, y: t.rY },
      { x: t.uX, y: t.uY, z: t.uZ }, { x: t.tanHalfX, y: t.tanHalfY }, dist);
    unprojectPitched(t, cx, cy, dist, o3);
    assert.equal(p.x, o3[0]); assert.equal(p.y, o3[1]); assert.equal(p.z, o3[2]);
    probes += 2;
  }
}

// --- sampleVis vs lighting.sampleVis ---
{
  const lights = { visW: new Int32Array(MAX_LIGHTS), visH: new Int32Array(MAX_LIGHTS), visOx: new Float64Array(MAX_LIGHTS), visOy: new Float64Array(MAX_LIGHTS), vis: new Uint8Array(MAX_LIGHTS * MAX_VIS_CELLS) };
  const box = [], atlas = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    lights.visW[i] = i % 5 === 4 ? 0 : 3 + Math.floor(rand() * (MAX_VIS_DIM - 3)); lights.visH[i] = lights.visW[i] ? 3 + Math.floor(rand() * (MAX_VIS_DIM - 3)) : 0;
    lights.visOx[i] = Math.floor(rand() * 20); lights.visOy[i] = Math.floor(rand() * 20);
    box.push({ x: lights.visOx[i], y: lights.visOy[i], z: lights.visW[i], w: lights.visH[i] });
  }
  for (let k = 0; k < lights.vis.length; k++) lights.vis[k] = Math.floor(rand() * 256);
  for (let r = 0; r < MAX_LIGHTS * MAX_VIS_DIM; r++) for (let c = 0; c < MAX_VIS_DIM; c++) atlas.push([lights.vis[r * MAX_VIS_DIM + c], 0, 0, 0]);
  const uLVis = makeTex(MAX_VIS_DIM, MAX_LIGHTS * MAX_VIS_DIM, atlas);
  const f = compileFn(LIGHT_WGSL, 'sampleVis', { ...shims, textureLoad, MAX_VIS_DIM, VIS_FLOOR_EPS: 1e-3, uLVis, u: { visBox: box } });
  for (let i = 0; i < 3000; i++) {
    const li = Math.floor(rand() * MAX_LIGHTS), x = rand() * 45 - 5, y = rand() * 45 - 5;
    assert.equal(f(li, x, y), sampleVis(lights, li, x, y)); probes++;
  }
  // exact vis-grid boundaries (BUG-LIGHT-002 epsilon): both sides must agree on the cell
  for (let i = 0; i < 200; i++) { const li = i % MAX_LIGHTS, x = lights.visOx[li] + Math.floor(rand() * 5) - 1e-4, y = lights.visOy[li] + Math.floor(rand() * 5); assert.equal(f(li, x, y), sampleVis(lights, li, x, y)); probes++; }
}

// --- sunVisible vs lighting.sunVisible on a fake two-structure world (integer origins) ---
{
  const structs = [{ x: 2, y: 1, z: 0, w: 8, h: 8, yOff: 0, maxH: 9 }, { x: 14, y: 3, z: 1.5, w: 6, h: 5, yOff: 8, maxH: 6 }];
  const texH = 13, texW = 8;
  const geom = new Array(texW * texH).fill(null).map(() => [0, 0, 0, 0]);
  const flags = new Array(texW * texH).fill(null).map(() => [0, 0, 0, 0]);
  const sectors = structs.map(() => new Map());
  structs.forEach((s, si) => {
    for (let ly = 0; ly < s.h; ly++) for (let lx = 0; lx < s.w; lx++) {
      const floorH = [0, 0, 0, 2, 8][Math.floor(rand() * 5)];
      const sky = rand() < 0.6;
      const ceilH = sky ? 'sky' : [2, 3, 5][Math.floor(rand() * 3)];
      let topH; const tr = rand();
      if (!sky) topH = tr < 0.4 ? undefined : tr < 0.8 ? ceilH + Math.floor(rand() * 3) : 'sky';
      sectors[si].set(ly * 100 + lx, { floorH, ceilH, topH });
      const topSky = topH === 'sky', topNum = topH === undefined ? ceilH : topH;
      const t = (s.yOff + ly) * texW + lx;
      geom[t] = [floorH, sky ? 0 : ceilH, topSky || sky ? 0 : topNum, 0];
      flags[t] = [(sky ? 2 : 0) | (topSky ? 4 : 0), 0, 0, 0];
    }
  });
  const world = {
    structures: structs.map((s, si) => ({ kind: 'grid', frame: { z: s.z }, packed: { maxH: s.maxH }, origin: { x: s.x, y: s.y, z: s.z }, w: s.w, h: s.h,
      level: { sectorAt: (gx, gy) => sectors[si].get(Math.floor(gy) * 100 + Math.floor(gx)) } })),
    structureAt(x, y) { for (const s of this.structures) { const lx = x - s.origin.x, ly = y - s.origin.y; if (lx >= 0 && lx < s.w && ly >= 0 && ly < s.h) return s; } return null; },
  };
  const worldMaxH = Math.max(...structs.map((s) => s.z + s.maxH));
  const uBlock = {
    structCount: 2, worldMaxH,
    structA: structs.map((s) => ({ x: s.x, y: s.y, z: s.z, w: s.w })),
    structB: structs.map((s) => ({ x: s.h, y: s.yOff, z: 0, w: s.maxH })),
  };
  const tex = { uWorldGeom: makeTex(texW, texH, geom), uWorldFlags: makeTex(texW, texH, flags) };
  const env = { ...shims, textureLoad, ...tex, u: uBlock, MAX_STRUCTS, MAX_SUN_STEPS };
  const findStruct = compileFn(LIGHT_WGSL, 'findStruct', env);
  const fetchSunCell = compileFn(LIGHT_WGSL, 'fetchSunCell', env);
  const sunCellBlocked = compileFn(LIGHT_WGSL, 'sunCellBlocked', env);
  const sunVis = compileFn(LIGHT_WGSL, 'sunVisible', { ...env, findStruct, fetchSunCell, sunCellBlocked });
  let lit = 0, shadow = 0;
  for (let i = 0; i < 4000; i++) {
    const S = { x: rand() * 24 - 1, y: rand() * 14 - 1, z: rand() * 8 };
    let dir;
    if (i % 50 === 0) dir = { x: 0, y: 0, z: 1 };
    else { const az = rand() * Math.PI * 2, el = (8 + rand() * 75) * Math.PI / 180; dir = { x: Math.cos(az) * Math.cos(el), y: Math.sin(az) * Math.cos(el), z: Math.sin(el) }; }
    const e = sunVisible(world, S.x, S.y, S.z, [dir.x, dir.y, dir.z]);
    const g = sunVis(S, dir);
    assert.equal(g, e, `sunVisible #${i} S=${JSON.stringify(S)} dir=${JSON.stringify(dir)}`);
    if (e) lit++; else shadow++;
    probes++;
  }
  assert.ok(lit > 300 && shadow > 300, `probe set exercises both outcomes (lit ${lit}, shadow ${shadow})`);
}
console.log(`light.wgsl.test.js: string/layout rules and ${probes} JS-evaluated probes vs the JS twins passed.`);

// 38.8a 24b / 38.5 item 6: the sun map holds depth in [0.5, 1]; the taps compare against 0.5 + 0.5 * sd (box test stays on sd)
{
  const fn = LIGHT_WGSL.slice(LIGHT_WGSL.indexOf('fn sunShadowTaps'), LIGHT_WGSL.indexOf('fn faceNormal'));
  assert.ok(/let sdm = 0\.5 \+ 0\.5 \* sd;/.test(fn), 'sdm = 0.5 + 0.5 * sd');
  assert.ok(/if \(sdm <= textureLoad\(uSunShadow, t, 0\)\)/.test(fn) && !/if \(sd <= textureLoad/.test(fn), 'tap compare uses sdm');
  assert.ok(/sd < 0\.0 \|\| sd > 1\.0/.test(fn), 'receiver box test stays on sd');
}

// ME-20c (38.18): kind-9 packed normal from GI.z; the vertex-AO term sits inside the strength branch, after the horizon term, as a min.
{
  const { LIGHT_WGSL: W } = await import('./light.wgsl.js');
  assert.ok(W.includes('select(textureLoad(uGA, cell, 0).w, textureLoad(uGI, cell, 0).z, kindU == u32(KIND_MESH))'), 'kind 9 packed N from GI.z');
  const iStr = W.indexOf('if (u.aoStrength > 0.0 && kindU != u32(KIND_TERRAIN)) {'), iHor = W.indexOf('var aoF = 1.0 - u.aoStrength * AO_MAX * occ;');
  const iVao = W.indexOf('if (kindU == u32(KIND_MESH)) { aoF = min(aoF, 1.0 - u.aoStrength * AO_MAX * (1.0 - clamp(bitcast<f32>(textureLoad(uGA, cell, 0).w), 0.0, 1.0))); }');
  const iSub = W.indexOf('L -= u.ambient * (1.0 - aoF);');
  assert.ok(iStr > 0 && iStr < iHor && iHor < iVao && iVao < iSub, 'vao term inside the strength branch, after the horizon term, before the ambient subtraction');
  assert.ok(!W.includes('aoF *=') && !W.includes('aoF = aoF *'), 'min, not product');
  console.log('light.wgsl.test.js (ME-20c): vao term placement ok.');
}
