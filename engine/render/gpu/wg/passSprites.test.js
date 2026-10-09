// WG-3f: WgSpritesPass + WgOverlayPass on the device mock - pipelines, uniform words == the GL pass uniform values (spritesPass.run), texture slot
// order, uploads only on change, a sprite and an overlay glyph reaching the shaders, readback shape, resize, 0 allocation / no new resources
// over 1000 frames. (Shader maths is probed in wgsl/sprites.wgsl.test.js.)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { SPRITES_BLOCK, SPRITES_TEXTURES } from '../wgsl/sprites.wgsl.js';
import { OVERLAY_TEXTURES } from '../wgsl/overlay.wgsl.js';
import { MAX_SPRITES, SPR_TEXELS, SPR_STRIDE } from '../../sprites.js';
import { createFadeLut } from '../../../ui/fade.js';
import { createSceneDim, resetSceneDim, pushDimRect } from '../../../ui/sceneDim.js';
import { createParticleLayer } from '../../particleLayer.js';
import { WgSpritesPass } from './passSprites.js';
import { WgOverlayPass } from './passOverlay.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

const COLS = 40, ROWS = 20;
const mock = makeMockGpuDevice(), d = mock.device;
const binds = [], draws = [], passes = [];
d.beginPass = (target, opts) => { passes.push({ target, opts }); };
d.bind = (pipe, desc) => { binds.push({ pipe, uniforms: Float32Array.from(desc.uniforms || []), textures: desc.textures.map((t) => t.texture), hasU: !!desc.uniforms }); };
d.draw = (count, first, instances) => draws.push({ count, first, instances });

// ---- fixtures: one sprite (rect 5,6 3x2), atlas, fade lut, dim, particle layer, overlay with one glyph ----
const pool = { count: 1, spr: new Float32Array(MAX_SPRITES * SPR_STRIDE) };
pool.spr.set([5, 6, 3, 2, /*T1*/ 1, 4, 0, 1, /*T2*/ 0, 0, 2, 2, /*T3*/ 1, 1, 1, 0, /*T4*/ 0.5, 0.5, 0.5, 0]);
const atlas = { width: 4, height: 2, data: new Uint8Array(32).map((_, i) => (i * 7) & 255), pal: new Float32Array([255, 0, 0, 0, 0, 255, 0, 0]) };
const lut = createFadeLut(' .:-=+*#%@', 9, 0.25);
const dim = createSceneDim(); resetSceneDim(dim); dim.all = 0.8; pushDimRect(dim, 2, 3, 10, 8, 0.4); pushDimRect(dim, 20, 1, 30, 5, 0.6);
const layer = createParticleLayer(); layer.bind(COLS, ROWS);
const ov = { cols: COLS, rows: ROWS, ovl: new Uint8Array(COLS * ROWS * 4), ovlZ: new Float32Array(COLS * ROWS), stats: { cells: 0 }, minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1 };

const sp = new WgSpritesPass(d, { pool, atlas });
const spd = sp.pipe.desc;
assert.deepEqual(spd.targetFormats, ['rgba8', 'rgba8']); assert.deepEqual(spd.bindings.textures, [...SPRITES_TEXTURES]); assert.equal(spd.bindings.uniformBytes, SPRITES_BLOCK.sizeBytes);
assert.equal(spd.fragment.targets, 2);
// atlas uploaded once at construct as rgba8ui; palette as f32
assert.equal(sp.texAtlas.desc.format, 'rgba8ui'); assert.equal(sp.texAtlas._texWrites, 1);
assert.equal(sp.texAtlas._lastTexWrite.data, atlas.data, 'atlas uploaded as is (Uint8Array, no widening copy)');
assert.deepEqual([sp.texPal.desc.width, sp.texPal.desc.height], [2, 1]); assert.equal(sp.texPal._lastTexWrite.data, atlas.pal);
sp.setAtlas(atlas); assert.equal(sp.texAtlas._texWrites, 1, 'same atlas: no re-upload');

const gi = d.createTexture({ format: 'rgba32ui', width: COLS, height: ROWS }), depth = d.createTexture({ format: 'r32ui', width: COLS, height: ROWS });
const edgeFg = d.createTexture({ format: 'rgba8', width: COLS, height: ROWS }), edgeBg = d.createTexture({ format: 'rgba8', width: COLS, height: ROWS });
const inp = { gi, depth, edgeFg, edgeBg };
sp.run(inp); assert.equal(sp.ran, false, 'no target before resize'); assert.equal(passes.length, 0);
sp.resize(COLS, ROWS);
assert.equal(sp.outFg.desc.format, 'rgba8'); assert.deepEqual([sp.outFg.desc.width, sp.outBg.desc.height], [COLS, ROWS]);
sp.setFadeLut(lut); sp.setFadeLut(lut);
assert.equal(sp.texFadeLut._texWrites, 1); assert.equal(sp.texFadeRamp.desc.width, 10); assert.equal(sp.texFadeRamp._texWrites, 1);
assert.equal(sp.fadeRampLen, 10); assert.equal(sp.fadeMinGain, 0.25);
sp.bindParticleLayer(layer);
sp.sceneFade = 0.5; sp.setSceneDim(dim);

// ---- uniform words + draw/binding order (== GL spritesPass.run uniform uploads) ----
sp.run(inp);
assert.equal(sp.ran, true); assert.equal(passes[0].target, sp.target); assert.equal(passes[0].opts, undefined, 'no clear');
assert.deepEqual(draws, [{ count: 3, first: 0, instances: 1 }]);
{
  const b = binds[0], u = b.uniforms, ui = new Int32Array(u.buffer), F = (n) => SPRITES_BLOCK.field(n).word;
  assert.equal(b.pipe, sp.pipe);
  assert.deepEqual(b.textures, [gi, depth, edgeFg, edgeBg, sp.texSpr, sp.texAtlas, sp.texPal, sp.texFadeLut, sp.texFadeRamp, sp.texPart, sp.texPartZ]);
  assert.equal(ui[F('count')], 1); assert.equal(u[F('sceneFade')], 0.5); assert.equal(u[F('fadeMinGain')], 0.25); assert.equal(ui[F('fadeRampLen')], 10);
  assert.equal(u[F('dimAll')], Math.fround(0.8)); assert.equal(ui[F('dimCount')], 2);
  assert.deepEqual([...u.slice(F('dimMul'), F('dimMul') + 4)], [0.4, 0.6, 0, 0].map(Math.fround));
  assert.deepEqual([...u.slice(F('dimRect'), F('dimRect') + 16)], [2, 3, 10, 8, 20, 1, 30, 5, 0, 0, 0, 0, 0, 0, 0, 0]);
  // the sprite row reaches the SPR texture: rect h = count, source = the pool array itself (no copy)
  assert.equal(sp.texSpr._lastTexWrite.data, pool.spr); assert.deepEqual(sp.texSpr._lastTexWrite.rect, { x: 0, y: 0, w: SPR_TEXELS, h: 1 });
  assert.deepEqual([...pool.spr.slice(0, 4)], [5, 6, 3, 2]);
}
// particles: first run uploaded the (empty) layer once; no dirty rows afterwards -> no more writes
assert.equal(sp.texPart._texWrites, 1);
sp.run(inp); assert.equal(sp.texPart._texWrites, 1, 'clean particle layer: no upload');
layer.part[(3 * COLS + 7) * 4 + 3] = 5; layer.partZ[3 * COLS + 7] = 2; layer.minRow = 3; layer.maxRow = 3;
sp.run(inp); assert.equal(sp.texPart._texWrites, 2); assert.equal(sp.texPart._lastTexWrite.data, layer.part); assert.equal(sp.texPartZ._lastTexWrite.data, layer.partZ);
// dirty-row slice with a source offset (no subarray): row 3 only
assert.deepEqual({ ...sp.texPart._lastTexWrite.rect }, { x: 0, y: 3, w: COLS, h: 1, stride: 0 }); assert.equal(sp.texPart._lastTexWrite.dataOffset, 3 * COLS * 4); assert.equal(sp.texPartZ._lastTexWrite.dataOffset, 3 * COLS);
// current rows 5..6 + previous rows 2..4 -> union 2..6
layer.minRow = 5; layer.maxRow = 6; layer.prevMinRow = 2; layer.prevMaxRow = 4; sp.run(inp);
assert.deepEqual({ ...sp.texPart._lastTexWrite.rect }, { x: 0, y: 2, w: COLS, h: 5, stride: 0 }); assert.equal(sp.texPart._lastTexWrite.dataOffset, 2 * COLS * 4);
layer.prevMinRow = 0; layer.prevMaxRow = -1;
layer.minRow = 0; layer.maxRow = -1;
// a grid change of the layer recreates the two particle textures
layer.bind(30, 12); const oldPart = sp.texPart; sp.run(inp);
assert.notEqual(sp.texPart, oldPart); assert.deepEqual([sp.texPart.desc.width, sp.texPart.desc.height], [30, 12]);
assert.equal(sp.texPart._texWrites, 1);
// zero sprites: pass still runs (fade/dim/particles), count word 0, no SPR upload
pool.count = 0; const sprW = sp.texSpr._texWrites; binds.length = 0; sp.run(inp);
assert.equal(new Int32Array(binds[0].uniforms.buffer)[SPRITES_BLOCK.field('count').word], 0); assert.equal(sp.texSpr._texWrites, sprW); assert.equal(sp.ran, true);
pool.count = 1;
// fade off / dim reset round trip
sp.sceneFade = 1; resetSceneDim(dim); sp.setSceneDim(dim); sp.setSceneDim(null);
assert.equal(sp.dimAll, 1); assert.equal(sp.dimCount, 0);

// ---- overlay: one glyph cell ----
const ovp = new WgOverlayPass(d, ov);
const od = ovp.pipe.desc;
assert.deepEqual(od.targetFormats, ['rgba8']); assert.deepEqual(od.bindings.textures, [...OVERLAY_TEXTURES]); assert.equal(od.bindings.uniformBytes, 0); assert.equal(od.fragment.targets, 1);
ovp.resize(COLS, ROWS); ovp.setTarget(sp.outFg);
assert.deepEqual(ovp.target.desc.color, [sp.outFg]); assert.equal(ovp.target.desc.color.length, 1);
const tgt = ovp.target; ovp.setTarget(sp.outFg); assert.equal(ovp.target, tgt, 'same target: no re-create');
passes.length = 0; draws.length = 0; binds.length = 0;
ovp.run(depth); assert.equal(ovp.ran, false); assert.equal(passes.length, 0, 'no overlay cells: nothing runs');
// glyph 'A' (index 33) at cell (10, 4), ref depth 3
const ci = 4 * COLS + 10; ov.ovl.set([200, 100, 50, 33], ci * 4); ov.ovlZ[ci] = 3; ov.stats.cells = 1; ov.minRow = 4; ov.maxRow = 4;
ovp.run(depth);
assert.equal(ovp.ran, true); assert.equal(passes.length, 1); assert.equal(passes[0].target, ovp.target); assert.equal(passes[0].opts, undefined, 'no clear: keeps sprite output');
assert.deepEqual(draws, [{ count: 3, first: 0, instances: 1 }]);
assert.deepEqual(binds[0].textures, [ovp.texOvl, ovp.texOvlZ, depth]); assert.equal(binds[0].hasU, false);
assert.equal(ovp.texOvl._lastTexWrite.data, ov.ovl); assert.equal(ovp.texOvlZ._lastTexWrite.data, ov.ovlZ);
assert.deepEqual([...ovp.texOvl._lastTexWrite.data.slice(ci * 4, ci * 4 + 4)], [200, 100, 50, 33]);
assert.equal(ovp.stats.rows, ROWS, 'first run is a full upload'); assert.equal(ovp.texOvl._texWrites, 1); assert.equal(ovp.texOvl._lastTexWrite.dataOffset, 0);
ovp.run(depth); assert.equal(ovp.stats.rows, 1); assert.equal(ovp.texOvl._texWrites, 2);
// dirty-row upload: row 4 only, source offset = row start (elements), no subarray
assert.deepEqual({ ...ovp.texOvl._lastTexWrite.rect }, { x: 0, y: 4, w: COLS, h: 1 }); assert.equal(ovp.texOvl._lastTexWrite.dataOffset, 4 * COLS * 4); assert.equal(ovp.texOvlZ._lastTexWrite.dataOffset, 4 * COLS);
// cells gone: last frame rows are re-uploaded (cleared), no draw
ov.ovl.fill(0); ov.ovlZ.fill(0); ov.stats.cells = 0; ov.minRow = 0; ov.maxRow = -1; ov.prevMinRow = 4; ov.prevMaxRow = 4;
passes.length = 0; ovp.run(depth); assert.equal(ovp.ran, false); assert.equal(passes.length, 0); assert.equal(ovp.texOvl._texWrites, 3);
ov.prevMinRow = 0; ov.prevMaxRow = -1; const w3 = ovp.texOvl._texWrites; ovp.run(depth); assert.equal(ovp.texOvl._texWrites, w3);
// layer not bound to this grid yet -> skipped
ov.cols = 99; ov.stats.cells = 1; passes.length = 0; ovp.run(depth); assert.equal(passes.length, 0); ov.cols = COLS;
// replaced layer arrays (overlay.bind at the same size) -> full upload again
ov.ovl = new Uint8Array(COLS * ROWS * 4); ov.ovlZ = new Float32Array(COLS * ROWS); ov.minRow = 2; ov.maxRow = 2; ovp.run(depth); assert.equal(ovp.stats.rows, ROWS);

// ---- readback shape ----
let calls = [];
d.readback = (tex, rect, out) => { calls.push({ tex, rect, out }); out.fill(7); return Promise.resolve(); };
const rb = await sp.readbackCells();
assert.ok(rb.fg instanceof Uint8Array && rb.fg.length === COLS * ROWS * 4 && rb.bg.length === COLS * ROWS * 4 && rb.fg[0] === 7);
assert.deepEqual(calls.map((c) => c.tex), [sp.outFg, sp.outBg]); assert.deepEqual(calls[0].rect, { x: 0, y: 0, w: COLS, h: ROWS });
assert.equal((await sp.readbackCells()).fg, rb.fg, 'reused buffers');

// ---- resize: new outputs, same pipelines; overlay re-targets ----
const pipes = [sp.pipe, ovp.pipe], oldFg = sp.outFg;
sp.resize(COLS, ROWS); assert.equal(sp.outFg, oldFg, 'same size no-op');
sp.resize(20, 10); assert.notEqual(sp.outFg, oldFg); assert.deepEqual([sp.outFg.desc.width, sp.outFg.desc.height], [20, 10]);
ovp.setTarget(sp.outFg); assert.notEqual(ovp.target, tgt); assert.deepEqual([sp.pipe, ovp.pipe], pipes);
sp.resize(COLS, ROWS); ovp.setTarget(sp.outFg);

// ---- zero allocation + no new resources over 1000 frames ----
d.beginPass = () => {}; d.bind = () => {}; d.draw = () => {};
ov.stats.cells = 1; ov.minRow = 4; ov.maxRow = 4; sp.sceneFade = 0.7; resetSceneDim(dim); dim.all = 0.9; pushDimRect(dim, 1, 1, 5, 5, 0.5);
const frame = () => { sp.setSceneDim(dim); sp.run(inp); ovp.run(depth); };
for (let i = 0; i < 20; i++) frame();
const created = mock.createCount, u0 = sp.u;
for (let i = 0; i < 3000; i++) frame();
global.gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) frame();
global.gc(); const grew = process.memoryUsage().heapUsed - h0;
assert.equal(mock.createCount, created, 'warm frames create no resources'); assert.equal(sp.u, u0);
assert.ok(grew < 64 * 1024, `heap growth over 1000 frames ${grew} B`);

// ---- uploadMs timing gated (default off): no performance.now() in run, stat stays 0; on -> measured ----
{
  const realNow = performance.now.bind(performance); let calls = 0;
  performance.now = () => { calls++; return realNow(); };
  try {
    assert.equal(sp.timeUploads, false); sp.run(inp);
    assert.equal(calls, 0, 'timeUploads off: no performance.now calls'); assert.equal(sp.stats.uploadMs, 0);
    sp.timeUploads = true; sp.run(inp);
    assert.equal(calls, 2, 'timeUploads on: 2 calls'); assert.ok(sp.stats.uploadMs >= 0);
  } finally { performance.now = realNow; sp.timeUploads = false; }
}

sp.dispose(); ovp.dispose();
for (const t of [gi, depth, edgeFg, edgeBg]) d.dispose(t);
assert.equal(mock.liveCount(), 0, 'dispose frees everything');
console.log(`passSprites.test.js: all checks passed (heap +${grew} B / 1000 frames).`);
