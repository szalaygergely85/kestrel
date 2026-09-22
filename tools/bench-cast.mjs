#!/usr/bin/env node
// US-004b acceptance: headless perf + correctness bench for the sector
// caster (`castScene`, game/js/render/raycaster.js). Node, no dependencies,
// no build step.
//
//   node tools/bench-cast.mjs [--frames N] [--gc]
//
// Runs `castScene` on `design levels: test_room` at a fixed 160x60 grid, at
// 4 fixed camera poses (documented in POSES below), for `--frames` measured
// frames (default 600) after a 120-frame warm-up that is NOT counted (JIT
// warm-up, matches architecture.md 12's headless methodology).
//
// Per pose it prints: avg/p50/p95/max ms, cells written per frame, and an
// FNV-1a checksum of the cell buffer contents (glyphIdx, fg, bg separately)
// so the caller can compare against a recorded baseline (see docs/backlog.md
// US-004b "Baseline first").
//
// `--gc`: also observes GC activity during the measured frames via
// `perf_hooks.PerformanceObserver({entryTypes:['gc']})` (no `--trace-gc` CLI
// flag needed - that observer works in any Node >= 8). It reports the count
// of minor/scavenge GCs seen during the measured window for each pose; per
// AC3 this must be 0 after warm-up. For a stricter check, run with
// `node --expose-gc tools/bench-cast.mjs --gc`: the script then calls
// `gc()` once right after warm-up to start the measured window on a clean
// heap.
//
// Exit code: non-zero if any pose fails the write-count-== cols*rows check
// or (when a baseline is embedded below) the checksum check, so the tester
// and the architect can rerun this and trust the exit code.

import { performance, PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { loadLevel } from '../game/js/world/Level.js';
import { castScene } from '../game/js/render/raycaster.js';
import testRoomDef from '../game/js/world/levels/test_room.js';
import paletteModule from '../design/palette.js';

const palette = paletteModule.default || paletteModule;

const COLS = 160;
const ROWS = 60;
// Typical monospace terminal-ish cell aspect used elsewhere in this project
// (D-005 glyph metrics); fixed here so the bench's screenAspect term is
// reproducible across runs/machines (see raycaster.js's `screenAspect`).
const PX_CELL_W = 9;
const PX_CELL_H = 16;

const WARMUP_FRAMES = 120;
const DEFAULT_FRAMES = 600;

// Fixed poses, in test_room LOCAL meters (test_room is 20x18; 'S' start is
// at col 2, row 2 -> x=2.5, y=2.5, facing east/yawDeg 90). eyeH 1.60 m
// matches physics/config.js `eyeHeight`.
const EYE_H = 1.60;
const POSES = [
  { name: 'start pose (S, facing east, level)', x: 2.5, y: 2.5, z: EYE_H, yawDeg: 90, pitchDeg: 0 },
  { name: 'facing stair + 1.0m platform', x: 2.5, y: 13.5, z: EYE_H, yawDeg: 90, pitchDeg: 0 },
  { name: 'sky over the low wall, pitch +35', x: 2.5, y: 7.5, z: EYE_H, yawDeg: 0, pitchDeg: 35 },
  { name: 'long diagonal, pitch -35', x: 1.5, y: 1.5, z: EYE_H, yawDeg: 45, pitchDeg: -35 },
];

// --- allocation-free fake RenderTarget --------------------------------
class BenchRT {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.pxCellW = PX_CELL_W;
    this.pxCellH = PX_CELL_H;
    this.glyphIdx = new Uint8Array(cols * rows);
    this.fg = new Uint8Array(cols * rows * 3);
    this.bg = new Uint8Array(cols * rows * 3);
    this.writeCount = new Uint16Array(cols * rows);
    this.totalWrites = 0;
  }
  setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyphIdx[i] = glyphIdx;
    const c = i * 3;
    this.fg[c] = r; this.fg[c + 1] = g; this.fg[c + 2] = b;
    this.bg[c] = r2; this.bg[c + 1] = g2; this.bg[c + 2] = b2;
    this.writeCount[i]++;
    this.totalWrites++;
  }
  resetFrame() {
    this.writeCount.fill(0);
    this.totalWrites = 0;
  }
}

// --- FNV-1a over a Uint8Array -------------------------------------------
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stats(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { avg, p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1] };
}
const ms = (n) => n.toFixed(3);

function main() {
  const args = process.argv.slice(2);
  const frameIdx = args.indexOf('--frames');
  const frames = frameIdx >= 0 ? parseInt(args[frameIdx + 1], 10) : DEFAULT_FRAMES;
  const withGc = args.includes('--gc');
  const shaderArg = args.find((a) => a.startsWith('--shader='));
  const shader = shaderArg ? shaderArg.split('=')[1] : 'fast'; // 'fast' (default, US-004b) or 'reference'

  const level = loadLevel(testRoomDef);
  if (!level) {
    console.error('[bench-cast] test_room failed to load - aborting.');
    process.exit(1);
  }

  const rt = new BenchRT(COLS, ROWS);
  const cellCount = COLS * ROWS;

  let ok = true;
  const results = [];

  for (const pose of POSES) {
    const camera = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };

    // Warm-up (not measured).
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      rt.resetFrame();
      castScene(rt, level, camera, palette, { skyFallback: true, shader });
    }

    let gcEvents = [];
    let observer = null;
    if (withGc) {
      if (typeof global.gc === 'function') global.gc(); // needs --expose-gc; harmless no-op check otherwise
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) gcEvents.push(entry);
      });
      observer.observe({ entryTypes: ['gc'] });
    }

    const frameTimes = new Array(frames);
    let writesThisRun = 0; // from the LAST measured frame, for the write-count check
    let anyDoubleWrite = false;

    for (let i = 0; i < frames; i++) {
      rt.resetFrame();
      const t0 = performance.now();
      castScene(rt, level, camera, palette, { skyFallback: true, shader });
      const t1 = performance.now();
      frameTimes[i] = t1 - t0;
      writesThisRun = rt.totalWrites;
      for (let c = 0; c < cellCount; c++) {
        if (rt.writeCount[c] > 1) { anyDoubleWrite = true; break; }
      }
    }

    if (observer) observer.disconnect();

    const s = stats(frameTimes);
    const checksum = {
      glyphIdx: fnv1a(rt.glyphIdx),
      fg: fnv1a(rt.fg),
      bg: fnv1a(rt.bg),
    };

    const writeCountOk = writesThisRun === cellCount && !anyDoubleWrite;
    if (!writeCountOk) ok = false;

    const minorGc = withGc
      ? gcEvents.filter((e) => e.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR).length
      : null;

    results.push({ pose: pose.name, stats: s, writes: writesThisRun, writeCountOk, checksum, minorGc, gcEventsTotal: withGc ? gcEvents.length : null });

    console.log(`\n[bench-cast] pose: ${pose.name}`);
    console.log(`  avg ${ms(s.avg)} ms  p50 ${ms(s.p50)} ms  p95 ${ms(s.p95)} ms  max ${ms(s.max)} ms`);
    console.log(`  cells written (last measured frame): ${writesThisRun} / ${cellCount} expected` +
      (writeCountOk ? '  OK' : '  FAIL (mismatch or a cell written twice)'));
    console.log(`  checksum  glyphIdx=${checksum.glyphIdx}  fg=${checksum.fg}  bg=${checksum.bg}`);
    if (withGc) {
      console.log(`  GC during measured window: ${gcEvents.length} total, ${minorGc} minor/scavenge` +
        (minorGc === 0 ? '  OK (zero scavenge)' : '  WARNING (scavenge observed - check for per-frame allocations)'));
      if (minorGc > 0) ok = false;
    }
  }

  console.log(`\n[bench-cast] ${frames} frames/pose, ${WARMUP_FRAMES} warm-up frames/pose, grid ${COLS}x${ROWS}.`);
  console.log(ok ? '[bench-cast] ALL CHECKS PASS' : '[bench-cast] FAILURES ABOVE');
  process.exit(ok ? 0 : 1);
}

main();
