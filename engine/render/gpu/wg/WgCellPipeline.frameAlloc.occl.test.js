// OCCL-ALLOC-01: the 1000-frame zero-garbage gate of WgCellPipeline.frameAlloc.test.js with two-phase HZB occlusion ON
// (`occl: true` and `occl: 2` = + stats readback) and instanced groups on the GPU cull path, so the HZB build, phase-1 parking and
// the phase-2 dispatch + raster B actually run every frame. The mock readBufferAsync is a synchronous single-slot fake whose
// callback fires at the start of the next frame (no promises: the harness allocates nothing, the pass's callback path is measured).
// Run: node engine/render/gpu/wg/WgCellPipeline.frameAlloc.occl.test.js (re-spawns itself with --expose-gc)
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline } from './WgCellPipeline.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadLevel } from '../../../world/Level.js';
import { makeInstanceGroup, INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { DRAW_INSTANCED, DRAW_FLAG_ONE_PART } from '../../../mesh/DrawList.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { MAX_SPRITES, SPR_STRIDE } from '../../sprites.js';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';

const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--no-concurrent-recompilation'];
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) process.exit(spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' }).status ?? 1);

const palette = paletteModule.default || paletteModule, detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const FRAMES = 1000, BUDGET = 600 * FRAMES; // 16 KB total NOT reachable with instanced groups: measured 442 B/frame (occl off, same fixture: 364); gate = 600 B/frame regression guard

function run(occl) {
  const mock = makeMockGpuDevice(), device = mock.device;
  device.backend = 'webgpu';
  let draws = 0, disp = 0, ind = 0, reads = 0, pn = 0; const pcb = [null, null, null, null], pout = [null, null, null, null];
  device.draw = () => { draws++; }; device.bind = () => {}; device.beginPass = () => {}; device.endPass = () => {};
  device.dispatch = () => { disp++; }; device.drawIndirect = () => { ind++; };
  device.writeTexture = () => {}; device.writeBuffer = () => {}; device.copyTextureToBuffer = () => {}; device.copyBufferToBuffer = () => {}; // mock copies push records forever: harness, not pipeline
  // multi-slot fake readback (one per batch): callback fires next frame, like a mapAsync resolving between frames
  device.readBufferAsync = (buf, bytes, out, cb) => { reads++; pcb[pn] = cb; pout[pn++] = out; return true; };
  let hook = null;
  const fgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 }), bgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
  const rt = { device, cols: 160, rows: 60, fgTex, bgTex, setCellPass(f) { hook = f; }, setPresentCells() {} };
  const p = new WgCellPipeline(rt, { rays: 1, occl });
  assert.ok(p.ready && typeof hook === 'function');
  const table = bindShading(palette, detailPass, 16 / 9);
  bindLevel(table, loadLevel(bundle.levels.test_room));
  p.bind(table, palette);
  const pool = { count: 0, spr: new Float32Array(MAX_SPRITES * SPR_STRIDE) };
  const atlas = { width: 4, height: 2, data: new Uint8Array(32), pal: new Float32Array(8) };
  const overlay = { cols: 160, rows: 60, ovl: new Uint8Array(160 * 60 * 4), ovlZ: new Float32Array(160 * 60), stats: { cells: 0 }, minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1 };
  p.bindSprites({ pool, atlas, palette, particleLayer: null, overlay });

  // instanced fixture (passRaster.test.js WG-4a pattern): a meshGroup-like batch + a voxel unit with LOD1 go to the cull kernel
  const rp = p._rasterPass, dev = device;
  const mk = (tris, ranges) => ({ triCount: tris, ranges, bbox: [-1, -1, 0, 1, 1, 2], layout: 'static' });
  const one = mk(2, [{ start: 0, count: 2 }]), lod1 = mk(1, [{ start: 0, count: 1 }]);
  const vb = dev.createBuffer({ usage: 'vertex', bytes: 64 }), ib = dev.createBuffer({ usage: 'index', bytes: 24 });
  const group = (n, lodCells, meshGroup) => {
    const g = makeInstanceGroup('g' + n, 64); g.count = n; g.lodCells = lodCells;
    g.parts.count = 1; g.parts.m[0] = g.parts.m[4] = g.parts.m[8] = 1; g.parts.flags[0] = 1;
    for (let i = 0; i < n; i++) g.ib.f32.set([1, 0, 0, 10 + i * 2, 0, 1, 0, 25 + (i & 3), 0, 0, 1, 0], i * INSTANCE_STRIDE);
    if (meshGroup) g.mesh = {}; return g;
  };
  const gA = group(40, 0, true), gB = group(30, 4, false);
  rp.buffers.getVoxel = () => ({ vertexBuffer: vb, indexBuffer: ib });
  const origPrepare = rp.prepare.bind(rp); // keeps view/planes/cam setup; only the instanced batches are ours
  rp.prepare = (pp) => {
    origPrepare(pp);
    const h = rp.cull ? rp._gpuHook : null;
    if (!(h && h.accept(gA, one, null))) { const it = rp.list.push(); it.type = DRAW_INSTANCED; it.mesh = one; it.instBuf = gA.ib; it.instCount = 40; it.flags = DRAW_FLAG_ONE_PART; }
    if (!(h && h.accept(gB, one, lod1))) { const it = rp.list.push(); it.type = DRAW_INSTANCED; it.mesh = one; it.instBuf = gB.ib; it.instCount = 30; }
  };
  rp.vmList = null;

  const world = Object.freeze({ structures: Object.freeze([]), structVersion: 1 }), light = Object.freeze([0.1, 0.2, 0.3]);
  const cam = { x: 10, y: 20, z: 1.6, yawDeg: 0, pitchDeg: 0 }, fb = { timeSec: 0 };
  const step = (i) => {
    for (let k = 0; k < pn; k++) { const cb = pcb[k], o = pout[k]; o.fill(1); cb(null, o); } pn = 0; // previous frame's reads land
    cam.yawDeg = (i * 7) % 360; cam.x = 10 + Math.sin(i * 0.1) * 3; cam.y = 20 + Math.cos(i * 0.1) * 3; fb.timeSec = i / 60;
    p.frame(fb, light, cam, world); hook();
  };
  for (let i = 0; i < 20000; i++) step(i);
  assert.ok(p._cellsShaded && draws > 0, 'passes ran');
  if (occl) assert.ok(rp.hzb, "hzb built"); assert.ok(rp.cull, "cull built"); assert.ok(rp.gpuN === 2, 'both batches on the GPU cull path');
  const acc = {}; const wrap = (n, o, m) => { if (!o) return; const f = o[m].bind(o); acc[n] = 0; o[m] = (...a) => { const b = process.memoryUsage().heapUsed; const r = f(...a); acc[n] += process.memoryUsage().heapUsed - b; return r; }; };
  if (process.env.PROF) { wrap("hzb.build", rp.hzb, "build"); wrap("cull.begin", rp.cull, "begin"); wrap("cull.run", rp.cull, "run"); wrap("cull.p2", rp.cull, "runPhase2"); wrap("cullDraw", rp, "_cullDraw"); wrap("cullRun", rp, "_cullRun"); wrap("occlP2", rp, "_occlPhase2"); wrap("raster.run", rp, "run"); wrap("prepare", rp, "prepare"); }
  const live = mock.liveCount(), created = mock.createCount, d0 = disp, i0 = ind, r0 = reads;
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 20000; i < 20000 + FRAMES; i++) step(i);
  const garbage = process.memoryUsage().heapUsed - h0;
  if (process.env.PROF) console.log(JSON.stringify(acc));
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  // phase 1 (2 batches) + HZB levels + phase 2 (2 batches) per frame; indirect draws in A and B
  const dpf = (disp - d0) / FRAMES, ipf = (ind - i0) / FRAMES;
  if (occl) assert.ok(dpf >= 9, `HZB build + both phases dispatch every frame (dispatch/frame ${dpf})`);
  if (occl) assert.ok(ipf >= 6, `phase-1 and phase-2 indirect draws every frame (${ipf}/frame)`);
  assert.strictEqual(mock.liveCount(), live, 'no new device resources'); assert.strictEqual(mock.createCount, created, 'createCount flat');
  if (occl === 2) { assert.ok(reads - r0 >= FRAMES - 2, `stats readback issued each frame (${reads - r0})`); assert.strictEqual(p.stats.culledOccl, 70, 'culledOccl from the fake readback'); }
  else assert.strictEqual(reads, 0, 'occl:true without stats: no readback');
  console.log(`  [occl ${occl}] ${(garbage / FRAMES).toFixed(1)} B/frame, retained ${grew} B, dispatch/frame ${dpf}, indirect/frame ${ipf}`);
  if (!process.env.NOGATE) assert.ok(garbage < BUDGET, `occl ${occl}: per-frame garbage ${garbage} B over ${FRAMES} frames (budget ${BUDGET})`);
  if (!process.env.NOGATE) assert.ok(grew < 64 * 1024, `occl ${occl}: retained growth ${grew}`);
  p.dispose();
}
if (process.env.ONLY) run(process.env.ONLY === "0" ? false : process.env.ONLY === "2" ? 2 : true); else { run(true); run(2); }
console.log('WgCellPipeline.frameAlloc.occl.test.js: all checks passed.');
