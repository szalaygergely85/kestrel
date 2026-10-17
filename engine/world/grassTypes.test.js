// GRASS-VARIETY-01: grass carpet types (design/look/grassTypes.js) + the world-space patch picker (engine/world/carpet.js inPatch).
// Checks: table valid for the carpet validator, bands disjoint, deterministic picker, every type appears over a 200 m square, patches are
// several metres wide, no per-cell speckle; and the WGSL side stays type-agnostic (it only reads the CPU class map by variant id).
import assert from 'node:assert/strict';
import '../../design/look/grassTypes.js';
import { validateCarpetConfig, inPatch, grassPatchValue, CARPET_MAX_VARIANTS } from './carpet.js';
import { CARPET_WGSL, CARPET_VTAB_ROWS } from '../render/gpu/wgsl/carpet.wgsl.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const GT = globalThis.GRASS_TYPES;
ok(GT && GT.types.length >= 2 && GT.types.length <= 3, '2-3 types');
const types = GT.types;
validateCarpetConfig({ seed: 1, variants: types.map((t) => ({ ...t, areas: [{ shape: 'disc', x: 0, y: 0, r: 5 }] })) }, ['grass', 'flowers']); checks++;
ok(types.length + 4 <= CARPET_MAX_VARIANTS, 'room left for riverbank/straw/outwall variants');
const names = types.map((t) => t.name);
ok(new Set(names).size === names.length && names.includes('meadow'), 'unique names, original meadow kept');
ok(new Set(types.map((t) => t.ramp.join())).size === types.length, 'each type has its own ramp');
ok(types.every((t) => t.glyphs || t.name === 'meadow'), 'non-default types carry their own glyph set');
const hs = types.map((t) => t.heightM[1]).sort((a, b) => a - b);
ok(hs[hs.length - 1] >= 2 * hs[0], 'heights differ clearly (tall vs low)');
// bands: disjoint, tile [0, 1]
const bands = types.map((t) => t.patch).sort((a, b) => a.lo - b.lo);
ok(bands[0].lo === 0 && bands[bands.length - 1].hi >= 1, 'bands cover 0..1');
for (let i = 1; i < bands.length; i++) ok(bands[i].lo === bands[i - 1].hi, 'bands abut without overlap');
ok(new Set(types.map((t) => t.patch.scaleM + ':' + t.patch.salt)).size === 1, 'one shared noise field');

// pure picker = first variant whose patch claims the point (what CarpetClassMapJob does)
const pick = (x, y) => { for (let i = 0; i < types.length; i++) if (inPatch(types[i].patch, x, y)) return i; return -1; };
ok(pick(1404.3, 1010.7) === pick(1404.3, 1010.7) && grassPatchValue(10, 20, 16, 7919) === grassPatchValue(10, 20, 16, 7919), 'deterministic');
const N = 100, X0 = 1400, Y0 = 950, cell = 2;           // 200 m square, 2 m class cells
const g = new Int8Array(N * N), cnt = new Array(types.length).fill(0);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const t = pick(X0 + (i + 0.5) * cell, Y0 + (j + 0.5) * cell); assert.ok(t >= 0); g[j * N + i] = t; cnt[t]++; }
checks++;
for (let t = 0; t < types.length; t++) ok(cnt[t] / (N * N) >= 0.15, `${names[t]} covers >= 15 % (got ${(100 * cnt[t] / N / N).toFixed(1)} %)`);
// patch size: mean run length of one type along x, sampled every 0.5 m
let runs = 0, len = 0;
for (let y = Y0; y < Y0 + 200; y += 5) { let prev = -2, run = 0; for (let x = X0; x < X0 + 200; x += 0.5) { const t = pick(x, y); if (t === prev) run += 0.5; else { if (prev >= 0 && run > 0) { runs++; len += run; } prev = t; run = 0.5; } } }
const meanRun = len / runs; ok(meanRun >= 6, `mean patch run >= 6 m (got ${meanRun.toFixed(1)} m)`);
// speckle: a cell whose type differs from all four neighbours
let lone = 0;
for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const t = g[j * N + i]; if (g[j * N + i - 1] !== t && g[j * N + i + 1] !== t && g[(j - 1) * N + i] !== t && g[(j + 1) * N + i] !== t) lone++; }
ok(lone / (N * N) < 0.005, `lone cells < 0.5 % (got ${(100 * lone / N / N).toFixed(2)} %)`);

// JS twin vs WGSL: the type pick is a CPU class-map concern; the shader indexes the variant table by id only
ok(!/inPatch|grassPatch|PATCH_SALT_DEFAULT|7919/.test(CARPET_WGSL), 'WGSL has no copy of the patch noise (picked on the CPU, uploaded as the class map)');
ok(CARPET_VTAB_ROWS === 2 && /\bvtab\b/.test(CARPET_WGSL), 'variant table rows unchanged (per-type height/density/width ride the existing vtab)');
console.log(`grassTypes: ${checks} checks PASS`);
