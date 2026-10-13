// IGPU-ENTITY-COST-01: what a combat scene (4 animated voxel boars + 128 live hit sparks) costs per frame on the WebGPU path,
// counted on the Node mock device (no browser). 300 frames through the real WgCellPipeline; asserts a budget:
//   upload <= 64 KB/frame (steady state), no buffer/texture/pipeline (re)creation after frame 10, sprite pool does not grow after frame 10.
// Local fixture (kestrel-1's buildCombatScene is not in this tree): real `boarPlaceholder` model + its walk/charge clips via VoxelPool,
// engine/fx particles with defineHitSparks presets, ParticleLayer built each frame, a sun-lit LightSet (shadow casters on).
// WRITE_REPORT=1 writes docs/test-reports/IGPU-ENTITY-COST.md, otherwise the report is printed.
// Run: node engine/render/gpu/wg/WgCellPipeline.entityCost.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline } from './WgCellPipeline.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadLevel } from '../../../world/Level.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { MAX_SPRITES, SPR_STRIDE } from '../../sprites.js';
import { VoxelPool } from '../../voxelPool.js';
import { createParticles } from '../../../fx/particles.js';
import { defineHitSparks, hitSparks } from '../../../fx/hitSparks.js';
import { createParticleLayer } from '../../particleLayer.js';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';
import '../../../../design/models/voxel_beast.js';

const BUDGET_BYTES = 55680, /* measured max 37120 x 1.5 */ SETTLE = 10, FRAMES = 300;
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' - ' + d : '')); } };

const mock = makeMockGpuDevice();
const { device } = mock;
device.backend = 'webgpu';
// Counting wrappers (bytes by destination; draws).
const bytes = new Map(); let frameBytes = 0, draws = 0, instancedDraws = 0, writes = 0;
const lbl = (h, kind) => kind + ':' + ((h.desc && (h.desc.label || (h.desc.format ? h.desc.format + ' ' + h.desc.width + 'x' + h.desc.height : 'size ' + (h.desc.size || h.desc.sizeBytes || '?')))) || '?');
const add = (key, n) => { frameBytes += n; writes++; bytes.set(key, (bytes.get(key) || 0) + n); };
device.writeBuffer = (h, data) => { add(lbl(h, 'buf'), data.byteLength); };
// Bytes the device really uploads: the rect (w*h*texel size) when given, else the whole array from dataOffset (earlier versions of this
// counter used data.byteLength - dataOffset even with a rect, which over-counted the dirty-row band uploads ~25x).
const TEXEL = { rgba8: 4, rgba8ui: 4, r32f: 4, r32ui: 4, r8ui: 1, rg8ui: 2, rgba32f: 16, rgba32i: 16, rgba32ui: 16 };
device.writeTexture = (t, data, rect, dataOffset) => {
  const f = t.desc && t.desc.format, tb = TEXEL[f];
  add(lbl(t, 'tex'), rect && tb ? rect.w * rect.h * tb : data.byteLength - (dataOffset ? dataOffset * (data.BYTES_PER_ELEMENT || 1) : 0));
};
device.draw = (count, first, inst = 1) => { draws++; if (inst > 1) instancedDraws++; };
const origCreateBuffer = device.createBuffer.bind(device);
let bufCreates = 0; device.createBuffer = (d) => { bufCreates++; return origCreateBuffer(d); };
device.bind = () => {}; device.beginPass = () => {}; device.endPass = () => {}; device.dispatch = () => {}; device.drawIndirect = () => {};

let hook = null;
const COLS = 160, ROWS = 60;
const rt = { device, cols: COLS, rows: ROWS, fgTex: device.createTexture({ format: 'rgba8', width: COLS, height: ROWS }), bgTex: device.createTexture({ format: 'rgba8', width: COLS, height: ROWS }), setCellPass(f) { hook = f; }, setPresentCells() {} };
const p = new WgCellPipeline(rt, { rays: 1 });
assert.strictEqual(p.ready, true);

const palette = paletteModule.default || paletteModule, detailPass = detailPassModule.default || detailPassModule;
const { bundle, assets } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));
p.bind(table, palette);

// voxel pool with the real boar
const vpool = new VoxelPool(); vpool.bind(assets, table);
const pm = vpool.models.get('boarPlaceholder');
assert.ok(pm, 'boarPlaceholder bound');
const clipIdx = pm.clipIndex; assert.ok(clipIdx && 'charge' in clipIdx && 'walk' in clipIdx, 'boar clips');
p.bindVoxels(vpool);

// sprites + overlay + particle layer
const pool = { count: 0, spr: new Float32Array(MAX_SPRITES * SPR_STRIDE) };
const atlas = { width: 4, height: 2, data: new Uint8Array(32), pal: new Float32Array(8) };
const overlay = { cols: COLS, rows: ROWS, ovl: new Uint8Array(COLS * ROWS * 4), ovlZ: new Float32Array(COLS * ROWS), stats: { cells: 0 }, minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1 };
const layer = createParticleLayer(); layer.bind(COLS, ROWS);
assert.strictEqual(p.bindSprites({ pool, atlas, palette, particleLayer: layer, overlay }), true);

const ps = createParticles(); defineHitSparks(ps);
const world = Object.freeze({ structures: Object.freeze([]), structVersion: 1 });
const light = { pos: new Float32Array(32), col: new Float32Array(32), count: 0, ambient: [0.4, 0.4, 0.4], sun: { on: true, dir: [0.4, 0.3, 0.86], col: [1, 0.95, 0.8] } };
const cam = { x: 0, y: 6, z: 1.7, yawDeg: 0, pitchDeg: -8 };
const fb = { timeSec: 0, frameNo: 0 };

// 4 boars circling; sparks: one 6-spark burst per frame (life ~0.35 s) keeps ~128 live
const boarPos = [[-2, 0], [-0.7, -1], [0.7, 0], [2, -1]];
const perFrame = [], createHist = [], liveSparks = [];
let drawsF = 0, instF = 0;
function step(i) {
  const t = i / 60;
  vpool.beginFrame();
  for (let b = 0; b < 4; b++) {
    const a = t * 1.5 + b;
    vpool.pushInstance('boarPlaceholder', boarPos[b][0] + Math.cos(a) * 0.6, boarPos[b][1] + Math.sin(a) * 0.6, 0, (a * 57.3 + 90) % 360, b % 2 ? clipIdx.charge : clipIdx.walk, 0, (i * 16.67) % 280);
  }
  hitSparks(ps, boarPos[i & 3][0], boarPos[i & 3][1], 0.5, 0, 0, 1, 6, i % 3); // ~6/frame x ~21 frame life = ~128 live
  ps.step();
  layer.build(ps, cam, rt, light, null, palette);
  fb.timeSec = t; fb.frameNo = i;
  frameBytes = 0; const d0 = draws, i0 = instancedDraws, c0 = bufCreates;
  p.frame(fb, light, cam, world); hook();
  perFrame.push(frameBytes); drawsF = draws - d0; instF = instancedDraws - i0;
  createHist.push(mock.createCount);
  return bufCreates - c0;
}
let lateCreates = 0;
for (let i = 0; i < FRAMES; i++) { const c = step(i); if (i > SETTLE) lateCreates += c; }
assert.ok(draws > 0, 'passes drew');

const steady = perFrame.slice(SETTLE + 1);
const avg = steady.reduce((a, b) => a + b, 0) / steady.length, max = Math.max(...steady), first = perFrame.slice(0, SETTLE + 1);
const sparkCount = ps.stats.live;
ok('upload <= 55680 B/frame (max over steady frames)', max <= BUDGET_BYTES, 'max ' + max + ' avg ' + avg.toFixed(0));
ok('no buffer creation after frame 10', lateCreates === 0, lateCreates + ' createBuffer calls');
ok('no device resource creation after frame 10 (createCount flat)', createHist[FRAMES - 1] === createHist[SETTLE + 1], 'createCount ' + createHist[SETTLE + 1] + ' -> ' + createHist[FRAMES - 1]);
ok('sprite pool does not grow after frame 10', pool.spr.length === MAX_SPRITES * SPR_STRIDE && pool.count === 0, 'count ' + pool.count);
ok('voxel boars reached the raster (4 instances)', vpool.list.length === 4, 'list ' + vpool.list.length);

const rowsTxt = [...bytes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => '| ' + k + ' | ' + (v / FRAMES).toFixed(0) + ' |').join('\n');
const report = `# IGPU-ENTITY-COST-01 - per-frame cost of 4 animated voxel boars + 128 hit sparks (mock device, Node)

Test: \`engine/render/gpu/wg/WgCellPipeline.entityCost.test.js\` (${FRAMES} frames, ${COLS}x${ROWS} grid, sun on, real boarPlaceholder walk/charge clips, hitSparks presets, ParticleLayer built each frame; kestrel-1 buildCombatScene not in this tree, local fixture).
Budget: upload <= 64 KB/frame, no buffer creation after frame ${SETTLE}, sprite pool constant after frame ${SETTLE}.

| metric | value |
|---|---|
| upload bytes/frame, steady avg / max | ${avg.toFixed(0)} / ${max} |
| upload bytes, first ${SETTLE + 1} frames (sum) | ${first.reduce((a, b) => a + b, 0)} |
| writes (buffer+texture), avg per frame | ${(writes / FRAMES).toFixed(1)} |
| draw calls/frame (last frame) | ${drawsF} (instanced ${instF}) |
| voxel instances (boars) | ${vpool.list.length} |
| live sparks (last frame) | ${sparkCount} |
| sprites in pool (pool.count) | ${pool.count} (capacity ${MAX_SPRITES}; boars are voxel, not sprites) |
| particle layer cells touched | ${layer.stats.cells} |
| createBuffer calls after frame ${SETTLE} | ${lateCreates} |
| device createCount frame ${SETTLE + 1} -> ${FRAMES} | ${createHist[SETTLE + 1]} -> ${createHist[FRAMES - 1]} |
| pipeline stats voxelInstances / voxelDraws / instances | ${p.stats.voxelInstances} / ${p.stats.voxelDraws} / ${p.stats.instances} |

Bytes/frame by destination (avg over all ${FRAMES} frames):

| destination | bytes/frame |
|---|---|
${rowsTxt}
`;
if (process.env.WRITE_REPORT === '1') fs.writeFileSync(new URL('../../../../docs/test-reports/IGPU-ENTITY-COST.md', import.meta.url), report);
else console.log(report);
p.dispose();
if (fail) { console.log('FAIL entityCost:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('PASS entityCost (' + pass + ' checks) avg ' + avg.toFixed(0) + ' B/frame max ' + max);
