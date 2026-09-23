#!/usr/bin/env node
// US-039 headless perf bench for the voxel CPU oracle (`castModels`,
// `engine/voxel/voxelMarch.js`), per architecture.md 15.1 "Budgets" and the
// backlog tech notes item 4. Node, no dependencies, no build step. Uses a
// NEW tool file (bench-cast.mjs is not touched, per the "parallel safety"
// note - another programmer is on US-030b's GPU code at the same time).
//
//   node tools/bench-voxel.mjs [--frames N]
//   node --expose-gc tools/bench-voxel.mjs [--frames N]
//
// Runs the `bearClose` pose (architect tech notes: yaw 200, walk frame 1,
// tMs 40, eye 2.2 m away at 1.6 m high - the same pose as the test suite's
// determinism/golden check) at 160x60 and 240x90, for `--frames` measured
// iterations (default 500) after a 50-iteration warm-up (not counted).
//
// Per resolution it prints avg/p50/p95/max ms, raysMarched, cellsWritten and
// (with --expose-gc) the heap delta per call. Exits non-zero if the 160x60
// gate fails: p50 <= 0.3 ms, p95 <= 0.5 ms. The heap delta is printed for
// visibility but not gated here (see the zero-alloc note near the bottom of
// this file) - engine/voxel/voxel.test.js's own 1000-iteration, 64 KB-budget
// check is the authoritative zero-alloc gate.

import { packVoxelModel } from '../engine/voxel/voxelPack.js';
import { castModels } from '../engine/voxel/voxelMarch.js';
import { GBuffer } from '../engine/render/GBuffer.js';
import quadruped12 from '../engine/voxel/fixtures/quadruped12.js';

const args = process.argv.slice(2);
function argNum(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : def;
}

const FRAMES = argNum('frames', 500);
const WARMUP = 50;
const PX_CELL_W = 9;
const PX_CELL_H = 16;

const MAT_IDS = { mat_a: 1, mat_b: 2, mat_c: 3 };
const pm = packVoxelModel(quadruped12, (k) => MAT_IDS[k]);

// bearClose: camera 2.2 m from the model, eye 1.6 m high, model at yaw 0,
// instance clip `walk` frame 1 at tMs 40 (matches voxel.test.js's
// determinism golden pose, minus the camera yaw 200 -> here the CAMERA
// looks at the model head-on for a representative "near quadruped, ~30% of
// the screen" framing, per the 15.1 budget note).
const cam = { x: 0, y: -2.2, z: 1.6, yawDeg: 180, pitchDeg: 0 };
const inst = { model: pm, x: 0, y: 0, z: 0, yawDeg: 0, clip: pm.clipIndex.walk, frame: 1, tMs: 40 };
const list = [inst];

function makeFb(cols, rows) {
  const gbuf = new GBuffer(cols, rows);
  const depth = new Float32Array(cols * rows);
  return { rt: { cols, rows, pxCellW: PX_CELL_W, pxCellH: PX_CELL_H }, depth, gbuf };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function runAt(cols, rows) {
  const fb = makeFb(cols, rows);
  const stats = { instancesCulled: 0, raysMarched: 0, cellsWritten: 0 };
  const opts = { stats }; // reused across every call - a fresh `{stats}` literal per
  // frame would itself allocate and pollute the heap-delta measurement below.
  const times = new Float64Array(FRAMES);

  for (let i = 0; i < WARMUP; i++) {
    fb.depth.fill(Infinity);
    fb.gbuf.beginFrame();
    castModels(fb, list, cam, opts);
  }

  let heapBefore = 0, heapAfter = 0;
  const hasGc = typeof globalThis.gc === 'function';
  if (hasGc) globalThis.gc();
  if (hasGc) heapBefore = process.memoryUsage().heapUsed;

  let lastRays = 0, lastCells = 0;
  for (let i = 0; i < FRAMES; i++) {
    fb.depth.fill(Infinity);
    fb.gbuf.beginFrame();
    const t0 = process.hrtime.bigint();
    castModels(fb, list, cam, opts);
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1e6;
    lastRays = stats.raysMarched;
    lastCells = stats.cellsWritten;
  }

  if (hasGc) { globalThis.gc(); heapAfter = process.memoryUsage().heapUsed; }

  const sorted = Array.from(times).sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  const heapDeltaPerCall = hasGc ? (heapAfter - heapBefore) / FRAMES : null;

  return { cols, rows, avg, p50, p95, max, raysMarched: lastRays, cellsWritten: lastCells, heapDeltaPerCall, hasGc };
}

const results = [runAt(160, 60), runAt(240, 90)];

let ok = true;
for (const r of results) {
  console.log(`\n[${r.cols}x${r.rows}] avg=${r.avg.toFixed(4)}ms p50=${r.p50.toFixed(4)}ms p95=${r.p95.toFixed(4)}ms max=${r.max.toFixed(4)}ms`);
  console.log(`  raysMarched=${r.raysMarched} cellsWritten=${r.cellsWritten}`);
  if (r.hasGc) {
    console.log(`  heapDelta/call=${r.heapDeltaPerCall.toFixed(1)} B`);
  } else {
    console.log('  heapDelta/call: not measured (run with --expose-gc)');
  }
}

const gate = results[0];
if (gate.p50 > 0.3) { console.log(`\nGATE FAIL: 160x60 p50 ${gate.p50.toFixed(4)}ms > 0.3ms`); ok = false; }
if (gate.p95 > 0.5) { console.log(`GATE FAIL: 160x60 p95 ${gate.p95.toFixed(4)}ms > 0.5ms`); ok = false; }
// The zero-alloc property itself is enforced by engine/voxel/voxel.test.js
// (1000 iterations, 64 KB budget, a far less noisy sample than this bench's
// 500 timed frames) - this number is printed for visibility, matching
// bench-cast.mjs's own "too noisy to trust as a hard gate" convention for
// small per-call heap deltas, not turned into a second, redundant gate here.
if (gate.hasGc && gate.heapDeltaPerCall > 512) { console.log(`GATE FAIL: 160x60 heap delta ${gate.heapDeltaPerCall.toFixed(1)} B/call is well above noise level`); ok = false; }

console.log(ok ? '\nALL GATES PASS' : '\nGATE FAILURE');
process.exit(ok ? 0 : 1);
