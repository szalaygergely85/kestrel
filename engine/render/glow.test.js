// EMIS-03/04: JS twin of the emissive bleed + halo pass (glow.js) + the WGSL/uniform contract of the GPU side.
import assert from 'node:assert/strict';
import { glowFrame, glowWeight, glowDepthGate, HALO_GLYPHS, GLOW_LEVELS, GLOW_TUNE, GLOW_EMIS_MIN } from './glow.js';
import { GLOW_WGSL, GLOW_BLOCK } from './gpu/wgsl/glow.wgsl.js';
import { packGlowUniforms } from './gpu/wg/passGlow.js';
import { WGSL_MODULES } from './gpu/wgsl/index.js';

const P = GLOW_TUNE;
const emis = new Float32Array(4); emis[1] = 1.0; emis[2] = 0.1; // mat 1 = lamp, mat 2 = dim, mat 0 = plain
function frame(cols, rows) {
  const n = cols * rows;
  return { cols, rows, kind: new Uint8Array(n), mat: new Uint16Array(n), depth: new Float32Array(n).fill(5), fg: new Uint8Array(n * 4), bg: new Uint8Array(n * 4), ofg: new Uint8Array(n * 4), obg: new Uint8Array(n * 4) };
}
function fill(f, kind, glyph) { for (let i = 0; i < f.cols * f.rows; i++) { f.kind[i] = kind; f.fg.set([100, 100, 100, glyph], i * 4); f.bg.set([20, 20, 20, 255], i * 4); } }
const run = (f) => glowFrame(f, f.cols, f.rows, emis, f.fg, f.bg, f.ofg, f.obg, P);
const at = (f, x, y) => y * f.cols + x;

// kernel
assert.equal(glowWeight(0, 0, 2), 1); assert.ok(glowWeight(1, 0, 2) > glowWeight(2, 0, 2));
assert.equal(glowWeight(4, 0, 2), 0, 'zero beyond the radius'); assert.equal(glowWeight(2, 1, 2), glowWeight(1, 2, 2), 'symmetric');
assert.ok(glowDepthGate(5, 5) === 1 && glowDepthGate(9, 5) < 0.05, 'depth gate kills a far source');

// no source = byte-identical copy
let f = frame(9, 9); fill(f, 8, 40); run(f);
assert.deepEqual(f.ofg, f.fg); assert.deepEqual(f.obg, f.bg);

// bleed: a lamp at the centre brightens solid neighbours, falls off with distance, keeps their glyph, spares the lamp itself
f = frame(9, 9); fill(f, 8, 40);
const c = at(f, 4, 4); f.mat[c] = 1; f.fg.set([255, 180, 60, 40], c * 4); run(f);
assert.deepEqual([...f.ofg.subarray(c * 4, c * 4 + 4)], [255, 180, 60, 40], 'emissive cell untouched');
const n1 = f.obg[at(f, 5, 4) * 4], n2 = f.obg[at(f, 6, 4) * 4], far = f.obg[at(f, 0, 0) * 4];
assert.ok(n1 > 20 && n1 > n2 && n2 > far && far === 20 && f.obg[at(f, 7, 4) * 4] === 20, `falloff ${n1} ${n2} ${far}`);
assert.ok(f.obg[at(f, 5, 4) * 4] > f.obg[at(f, 5, 4) * 4 + 2], 'tinted warm (r > b)');
assert.equal(f.ofg[at(f, 5, 4) * 4 + 3], 40, 'drawn glyph kept');
assert.equal(f.obg[at(f, 3, 4) * 4], n1, 'left/right symmetric');

// dim material (< GLOW_EMIS_MIN) is not a source
f = frame(9, 9); fill(f, 8, 40); f.mat[at(f, 4, 4)] = 2; run(f); assert.ok(0.1 < GLOW_EMIS_MIN); assert.deepEqual(f.obg, f.bg);

// depth gate: a source far behind (or in front of) the destination does not leak
f = frame(9, 9); fill(f, 8, 40); f.mat[c] = 1; f.depth[c] = 40; run(f);
assert.ok(f.obg[at(f, 5, 4) * 4] <= 21, 'no bleed across a depth silhouette');

// sky halo: kind 0 + space glyph -> bg tint, halo glyph from the ramp in the glow colour, no depth term
f = frame(9, 9); fill(f, 0, 0); f.kind[c] = 8; f.mat[c] = 1; f.fg.set([255, 180, 60, 40], c * 4); f.depth[c] = 3; f.depth.fill(1e9, 0, 4); run(f);
const h = at(f, 5, 4);
assert.ok(f.obg[h * 4] > 20, 'halo tints the sky bg'); assert.ok(HALO_GLYPHS.includes(f.ofg[h * 4 + 3]) && f.ofg[h * 4 + 3] !== 0, 'halo glyph');
assert.ok(f.ofg[h * 4] > f.ofg[h * 4 + 2], 'halo glyph is warm');
assert.equal(f.ofg[at(f, 6, 4) * 4 + 3], 0, 'ring 2: tint only, no halo glyph (tight)'); assert.equal(f.ofg[at(f, 7, 4) * 4 + 3], 0);
assert.ok(GLOW_TUNE.radius === 2 && GLOW_TUNE.gain <= 0.2 && GLOW_TUNE.haloBg <= 0.25);
assert.equal(f.ofg[at(f, 0, 0) * 4 + 3], 0, 'far sky stays a space');
// ramp is monotone with distance: nearer = denser glyph index
assert.ok(HALO_GLYPHS.indexOf(f.ofg[at(f, 5, 4) * 4 + 3]) >= HALO_GLYPHS.indexOf(f.ofg[at(f, 7, 4) * 4 + 3]));
// a drawn glyph on a sky-kind cell is never replaced; passthrough (bg.a 0) cells are copied
f = frame(9, 9); fill(f, 0, 0); f.mat[c] = 1; f.kind[c] = 8; f.fg.set([255, 180, 60, 40], c * 4);
f.fg[at(f, 5, 4) * 4 + 3] = 33; f.bg[at(f, 3, 4) * 4 + 3] = 0; run(f);
assert.equal(f.ofg[at(f, 5, 4) * 4 + 3], 33); assert.equal(f.obg[at(f, 3, 4) * 4], 20, 'passthrough copied');
// terrain (kind 7) is never a source even if its terrain-type id aliases a lamp material
f = frame(9, 9); fill(f, 8, 40); f.kind[c] = 7; f.mat[c] = 1; run(f); assert.deepEqual(f.obg, f.bg);

// GPU contract: module registered, bindings match, uniforms pack, shared constants appear in the WGSL
assert.ok(WGSL_MODULES.some((m) => m.name === 'glow'));
for (let s = 0; s < 5; s++) assert.ok(GLOW_WGSL.includes('@group(0) @binding(' + s + ')'));
assert.ok(GLOW_WGSL.includes('@group(1) @binding(0) var<uniform> u: GlowU') && GLOW_WGSL.includes('fn fs_main') && !/%%|undefined|NaN/.test(GLOW_WGSL));
assert.ok(GLOW_WGSL.includes('0.12') && GLOW_WGSL.includes('0.3') && GLOW_WGSL.includes('0.05'));
const u = new Float32Array(GLOW_BLOCK.sizeWords), ui = new Int32Array(u.buffer);
packGlowUniforms(P, 100, 40, u, ui);
assert.equal(ui[GLOW_BLOCK.field('radius').word], 2); assert.equal(ui[GLOW_BLOCK.field('rampN').word], HALO_GLYPHS.length);
assert.equal(u[GLOW_BLOCK.field('ramp').word + 1], HALO_GLYPHS[1]); assert.equal(u[GLOW_BLOCK.field('gain').word], Math.fround(GLOW_TUNE.gain));

// zero alloc: a second frame must not grow the heap noticeably
f = frame(120, 45); fill(f, 8, 40); f.mat[at(f, 60, 20)] = 1; run(f);
if (global.gc) { global.gc(); for (let k = 0; k < 20; k++) run(f); run(f); global.gc(); const m1 = process.memoryUsage().heapUsed; for (let k = 0; k < 20; k++) run(f); global.gc(); assert.ok(process.memoryUsage().heapUsed - m1 < 100000, "glowFrame allocates " + (process.memoryUsage().heapUsed - m1)); }
console.log('glow.test.js ok');
