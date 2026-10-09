// ED-WG-01a (docs/architecture.md 38.21): frameRenderer on a fake pipeline / CPU rt - step order, binds, idle skip, fb.gpu,
// resize, readSurface (both paths), dispose, 1000-frame zero-alloc (re-spawns itself with --expose-gc like WgCellPipeline.frameAlloc.test.js).
// Run: node engine/render/frameRenderer.test.js
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Events } from '../core/events.js';
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { createFrameRenderer, idleSkip } from './frameRenderer.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--no-concurrent-recompilation'];
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
globalThis.window = globalThis.window || globalThis;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) { if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); } }

const COLS = 40, ROWS = 20;
const worldDef = { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] };
const cam = { x: 2.5, y: 3.5, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const NOANIM = { animate: false, dt: 0, beforePresent: null };

let log = [];
function makeRig({ gpu, record = true, cols = COLS, rows = ROWS }) {
  const L = (s) => { if (record) log.push(s); };
  const rt = Object.assign(new CellBuffer(cols, rows), { pxCellW: 9, pxCellH: 16, gpuActive: gpu, cells: null, present() { L('present'); } });
  rt.cells = rt;
  const events = new Events();
  const engine = { events, ui: { clear() { L('ui.clear'); } }, depthBuffer: new DepthBuffer(cols, rows), instances: { bindPool(p) { L('instances.bindPool'); this.pool = p; }, pool: null }, overlay: {}, particleLayer: null };
  let pipeline = null;
  if (gpu) {
    const n = cols * rows;
    pipeline = {
      ready: true, frameComplete: true, cols, rows,
      compiled: Promise.resolve(), spritesCompiled: Promise.resolve(),
      binds: [],
      bind() { L('bind'); }, setWaterLooks() { L('setWaterLooks'); }, bindVoxels() { L('bindVoxels'); },
      bindViewModel() { L('bindViewModel'); }, bindInstances() { L('bindInstances'); },
      bindSprites(o) { L('bindSprites'); this.sprites = o; return true; },
      frame() { L('pipeline.frame'); },
      resizeGrid(c, r) { L('resizeGrid'); this.cols = c; this.rows = r; },
      GI: new Uint32Array(4 * n), Depth: new Uint32Array(4 * n),
      async readbackGeometry() { L('readback'); return { GI: this.GI, Depth: this.Depth }; },
    };
  }
  const fr = createFrameRenderer({ engine, rt, pipeline, assets, idleSkip: true });
  if (record) {
    const vp = fr.voxelPool, c0 = vp.collect.bind(vp);
    vp.collect = (w, c) => { L('voxel.collect'); c0(w, c); };
    const sp = fr.sprites.pool, sc = sp.collect.bind(sp), pr = sp.project.bind(sp);
    sp.collect = (w) => { L('sprites.collect'); sc(w); };
    sp.project = (...a) => { L('sprites.project'); pr(...a); };
  }
  return { rt, engine, pipeline, fr };
}

// ---- idle skip pure fn ----
ok('idleSkip: clean+idle skips', idleSkip(false, false, false).shouldRender === false);
ok('idleSkip: animate keeps dirty', idleSkip(false, true, false).nextDirty === true);
ok('idleSkip: farBaking renders', idleSkip(false, false, true).shouldRender === true);

// ---- GPU path: binds, step order, idle skip, fb.gpu ----
{
  const { rt, engine, pipeline, fr } = makeRig({ gpu: true });
  await fr.ready;
  const binds = log.filter((s) => /^(bind|setWaterLooks|bindVoxels|bindViewModel|bindInstances|bindSprites)$/.test(s));
  ok('binds: bind, voxels, instances, sprites each once, in order', binds.join() === 'bind,bindVoxels,bindInstances,bindSprites', binds.join());
  ok('sprites bind carries pool/atlas/palette/overlay', pipeline.sprites.pool === fr.sprites.pool && pipeline.sprites.atlas === fr.sprites.atlas && pipeline.sprites.palette === assets.palette && pipeline.sprites.overlay === engine.overlay);
  const world = World.load(worldDef, assets, {});
  engine.events.emit('world:loaded', { world });
  ok('lightSet built on world:loaded', fr.lightSet !== null);
  log = [];
  let hook = 0;
  const presented = fr.step(world, cam, { animate: false, dt: 0, beforePresent: () => { log.push('beforePresent'); hook++; } });
  ok('first step presents', presented === true && fr.presented === 1);
  ok('step order', log.join() === 'ui.clear,voxel.collect,sprites.collect,sprites.project,beforePresent,pipeline.frame,present', log.join());
  ok('fb.gpu follows frameComplete && gpuActive (true)', fr.fb.gpu === true && fr.gpuOwnsFrame === true);
  log = [];
  ok('clean second step idle-skips', fr.step(world, cam, NOANIM) === false && log.length === 0 && fr.presented === 1);
  fr.markDirty();
  ok('markDirty renders again', fr.step(world, cam, NOANIM) === true && fr.presented === 2);
  ok('animate:true always renders', fr.step(world, cam, { animate: true, dt: 1 / 60 }) === true && fr.step(world, cam, { animate: true, dt: 1 / 60 }) === true);
  pipeline.frameComplete = false; fr.markDirty(); fr.step(world, cam, NOANIM);
  ok('fb.gpu false when frameComplete false', fr.fb.gpu === false && fr.gpuOwnsFrame === false);
  pipeline.frameComplete = true; rt.gpuActive = false; fr.markDirty(); fr.step(world, cam, NOANIM);
  ok('fb.gpu false when rt.gpuActive false', fr.fb.gpu === false);
  rt.gpuActive = true;

  // readSurface (GPU): decodes a fake GI/Depth, flushes a pending dirty frame first
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  f32[0] = 7.5;
  const i = 3 * COLS + 5;
  pipeline.GI[i * 4] = 1234; pipeline.GI[i * 4 + 1] = (77 << 16) | (3 << 8) | 5; pipeline.Depth[i * 4] = u32[0];
  fr.markDirty(); log = [];
  const s = await fr.readSurface(5, 3);
  ok('readSurface(GPU): flushes dirty frame then reads back', log.indexOf('present') >= 0 && log.indexOf('present') < log.indexOf('readback'), log.join());
  ok('readSurface(GPU) decode', s.kind === 5 && s.face === 3 && s.mat === 77 && s.planeId === 1234 && s.depth === 7.5, JSON.stringify(s));

  // resize re-creates targets; readSurface asserts the grid matches rt
  const oldG = fr.fb.gbuf, oldL = fr.fb.light;
  fr.resize(COLS, ROWS);
  ok('resize re-creates gbuf + light buffer', fr.fb.gbuf !== oldG && fr.fb.light !== oldL);
  pipeline.cols = COLS + 4; // pipeline lags the rt
  let threw = false;
  try { await fr.readSurface(0, 0); } catch (e) { threw = /grid/.test(e.message); }
  ok('readSurface throws when pipeline grid != rt grid', threw);
  pipeline.cols = COLS;
  rt.cols = COLS + 4; // rt resized by caller; pipeline lags -> resize() fixes the pipeline
  rt.rows = ROWS;
  log = [];
  fr.resize(COLS + 4, ROWS);
  ok('resize resizes a lagging pipeline and rebinds', pipeline.cols === COLS + 4 && log.includes('resizeGrid') && log.includes('bind'));

  fr.dispose();
  log = [];
  engine.events.emit('world:loaded', { world });
  ok('dispose: world:loaded listener removed', fr.lightSet === null && log.length === 0);
  ok('dispose: refs dropped', fr.fb.gbuf === null && engine.instances.pool === null);
  fr.dispose(); // idempotent
}

// ---- ED-MESH-1e: refreshAssets + resize re-binds the voxelPool ----
{
  const { rt, pipeline, fr } = makeRig({ gpu: true });
  await fr.ready;
  const vp = fr.voxelPool;
  let binds = 0; const b0 = vp.bind.bind(vp);
  vp.bind = (...a) => { binds++; return b0(...a); };
  const atlasV = vp.atlas.version;
  const countVox = () => log.filter((s) => s === 'bindVoxels').length;
  const v0 = countVox();
  ok('refreshAssets: unchanged assets -> no re-bind', fr.refreshAssets(assets) === false && binds === 0 && vp.atlas.version === atlasV && countVox() === v0);
  const lantern = (voxelPropsMod.lantern || voxelPropsMod.models?.lantern).voxel;
  assets.add('model', 'ed_mesh_1e_test', { name: 'ed_mesh_1e_test', voxel: lantern });
  ok('refreshAssets: new model -> pool re-bound + pipeline.bindVoxels', fr.refreshAssets(assets) === true && binds === 1 && countVox() === v0 + 1 && vp.models.has('ed_mesh_1e_test'));
  ok('refreshAssets: idempotent afterwards', fr.refreshAssets(assets) === false && binds === 1);
  const vN = countVox();
  fr.resize(COLS, ROWS);
  ok('resize re-binds the voxelPool with the new matTable', binds === 2 && countVox() === vN + 1);
  void rt; void pipeline;
}

// ---- fallback: no WebGPU device (pipeline null, CPU rt) ----
{
  const { engine, fr } = makeRig({ gpu: false });
  await fr.ready;
  ok('fallback: gpuOwnsFrame false', fr.gpuOwnsFrame === false);
  const world = World.load(worldDef, assets, {});
  engine.events.emit('world:loaded', { world });
  log = [];
  ok('fallback: step presents without a pipeline', fr.step(world, cam, NOANIM) === true && fr.fb.gpu === false);
  ok('fallback: no pipeline.frame', !log.includes('pipeline.frame') && log[log.length - 1] === 'present', log.join());
  fr.fb.gbuf.kind[2 * COLS + 1] = 4; fr.fb.gbuf.planeId[2 * COLS + 1] = 9; fr.fb.depth.depth[2 * COLS + 1] = 3.25;
  const s = await fr.readSurface(1, 2);
  ok('readSurface(CPU) reads fb.gbuf / fb.depth', s.kind === 4 && s.planeId === 9 && s.depth === 3.25, JSON.stringify(s));
  fr.dispose();
}

// ---- 1000-frame zero-alloc (GPU-owned frame, steady state) ----
{
  const { rt, engine, fr } = makeRig({ gpu: true, record: false });
  const world = World.load(worldDef, assets, {});
  engine.events.emit('world:loaded', { world });
  const opts = { animate: process.env.ANIM !== "0", dt: 1 / 60, beforePresent: () => {} };
  let n = 0;
  const run = (k) => { for (let j = 0; j < k; j++) { n++; if (process.env.ANIM === "0") fr.markDirty(); cam.yawDeg = (n * 3) % 360; fr.step(world, cam, opts); } };
  run(10000);
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  run(1000);
  const garbage = process.memoryUsage().heapUsed - h0;
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok('zero-alloc: < 16 KB garbage over 1000 steps (FRAME-ALLOC-02: closure context in SpritePool/VoxelPool.collect removed)', garbage < 16 * 1024, `${garbage} B total (${(garbage / 1000).toFixed(1)} B/step)`);
  ok('zero-alloc: no retained growth', grew < 64 * 1024, `${grew} B`);
  ok('zero-alloc: presented every step', fr.presented === 11000);
  void rt;
}

if (fail > 0) {
  console.error(`FAIL: ${fail} check(s) failed:`);
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
} else {
  console.log(`frameRenderer.test.js: all ${pass} checks passed.`);
}
void assert;
