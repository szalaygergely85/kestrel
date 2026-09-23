#!/usr/bin/env node
// US-004b acceptance: headless perf + correctness bench for the sector
// caster (`castScene`, game/js/render/raycaster.js). Node, no dependencies,
// no build step.
//
//   node tools/bench-cast.mjs [--frames N] [--gc] [--shader=fast|reference]
//                             [--update-baseline]
//
// Runs `castScene` on `design levels: test_room` at a fixed 160x60 grid, at
// 4 fixed camera poses (documented in POSES below), for `--frames` measured
// frames (default 600) after a 120-frame warm-up that is NOT counted (JIT
// warm-up, matches architecture.md 12's headless methodology). `--shader`
// picks which path is used for the TIMED loop (default `fast`); the
// correctness checks below always exercise BOTH paths regardless of this
// flag, since they need to compare fast against reference anyway.
//
// Per pose it prints: avg/p50/p95/max ms, cells written, sky-cell count,
// and checksums - then runs the correctness checks (see CHECKS below) and
// exits non-zero if any of them fail, so the tester and the architect can
// rerun this and trust the exit code.
//
// CHECKS (per pose, `skyFallback:true` unless noted), architect review
// 2026-09-23 item 3:
//   (a) the reference-shader checksums (glyphIdx/fg/bg) match the recorded
//       EMBEDDED_BASELINE below. `--update-baseline` skips the comparison
//       and prints freshly computed values formatted to paste back in here
//       (the documented manual step - this script does not self-edit).
//   (b) fast vs reference, per cell: glyphIdx identical, fg/bg within +-4
//       per channel (the same tolerance `?shadetest=1` uses).
//   (c) a `skyFallback:false` pass: every column is either fully closed
//       (written exactly once, every row) or reported open in `OpenSpans`
//       (every row in `[top,bottom]` unwritten) - i.e. writes + open-span
//       rows == cols*rows, no double write, no written cell inside an open
//       span.
//
// `--gc`: also observes GC activity during the measured frames via
// `perf_hooks.PerformanceObserver({entryTypes:['gc']})` (no `--trace-gc` CLI
// flag needed - that observer works in any Node >= 8), AND (architect
// review item 4) the `process.memoryUsage().heapUsed` delta across the
// measured frames, divided by frame count. The GC-event count alone cannot
// tell 0 allocations apart from a small per-column leak that never fills a
// whole young-generation semispace (160 cols x ~40 B = ~6 KB/frame, well
// under one scavenge) - the heap-delta number can. For a trustworthy delta,
// run with `--expose-gc` too: the script forces a `gc()` right after
// warm-up (clean starting heap) and again right before the final reading
// (nets out any not-yet-collected garbage from the measured frames
// themselves, so the delta reflects real retained growth, not GC timing
// luck). Fails if the per-frame delta exceeds 2 KB. Without `--expose-gc`
// the number is printed but not enforced (too noisy to trust).

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
const HEAP_DELTA_LIMIT_BYTES_PER_FRAME = 2048;
const COLOR_TOLERANCE = 4;

// Fixed poses, in test_room LOCAL meters (test_room is 20x18; 'S' start is
// at col 2, row 2 -> x=2.5, y=2.5, facing east/yawDeg 90). eyeH 1.60 m
// matches physics/config.js `eyeHeight`.
const EYE_H = 1.60;
const POSES = [
  { name: 'start pose (S, facing east, level)', x: 2.5, y: 2.5, z: EYE_H, yawDeg: 90, pitchDeg: 0,
    // US-004b re-review #3: the two multi-cell-wide low-wall (`w`) segments
    // at level columns 120/132 must show the FAR ceiling (depth 9.5-16.5 m),
    // not sky - regression guard for "sky above a low solid cell is never
    // evaluated as a segment".
    probes: [
      { desc: 'columns 120/132 rows 22-25: far ceiling, not sky', cols: [120, 132], rows: [22, 25], kind: 'finite', min: 9.5, max: 16.5 },
    ] },
  { name: 'facing stair + 1.0m platform', x: 2.5, y: 13.5, z: EYE_H, yawDeg: 90, pitchDeg: 0 },
  // Architect review 2026-09-23 item 2: the old pose 3, (2.5, 7.5, yaw 0,
  // pitch +35), sees 0 sky cells - the '^' skylight (level cols 8-12) is
  // outside the 75 deg FOV from x=2.5, so the whole frame was ceiling. This
  // pose sees the low wall, the sky over it through the skylight AND the
  // far ceiling beyond it (6,240 sky / 3,360 geometry cells).
  { name: 'sky over the low wall, pitch +20', x: 9.5, y: 7.5, z: EYE_H, yawDeg: 0, pitchDeg: 20 },
  { name: 'long diagonal, pitch -35', x: 1.5, y: 1.5, z: EYE_H, yawDeg: 45, pitchDeg: -35 },
  // US-004b re-review #3 item 2 (new pose): sees the near `w` cell's own
  // 'sky' ceiling above it - the far side's ceiling must NOT be stretched
  // back over the `w` cell's own span.
  { name: 'low wall sky, (10, 7.5) yaw 45 pitch +25', x: 10, y: 7.5, z: EYE_H, yawDeg: 45, pitchDeg: 25,
    probes: [
      { desc: 'column 116 rows 0-3: sky over the w cell, not the far ceiling', cols: [116], rows: [0, 3], kind: 'infinite' },
    ] },
];

// Reference-shader checksums, recorded 2026-09-23 AFTER architect review
// items 1-2 (skylight far-ceiling fix, pose 3 change) - `--shader=reference`
// on `test_room`. Regenerate with `--update-baseline` after any deliberate
// change to the caster's geometry/overdraw logic and paste the new values
// in here (this script does not self-edit).
// Re-recorded 2026-09-24 (US-004b re-review #3 fix): only the start pose
// and the new pose change, both in the columns/rows the two named bugs
// touched (solid `w` cell's own ceiling/sky segment now runs through
// castFloorCeiling instead of being skipped) - the other two poses are
// byte-identical to the previous baseline.
const EMBEDDED_BASELINE = {
  'start pose (S, facing east, level)': { glyphIdx: 'd5de32c7', fg: '642bd1ce', bg: '2f9999e9' },
  'facing stair + 1.0m platform': { glyphIdx: 'bae66e57', fg: '4498f0d1', bg: 'b1925193' },
  'sky over the low wall, pitch +20': { glyphIdx: '3530ccb8', fg: 'aa5dcf64', bg: '8da632bf' },
  'long diagonal, pitch -35': { glyphIdx: '91811e1f', fg: '92a90df4', bg: '2ad61bfb' },
  'low wall sky, (10, 7.5) yaw 45 pitch +25': { glyphIdx: '60dba32e', fg: '626d56a8', bg: 'cba2e97f' },
};

// --- allocation-free fake RenderTarget + DepthBuffer ---------------------
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

class BenchDepthBuffer {
  constructor(cols, rows) {
    this.cols = cols;
    this.depth = new Float32Array(cols * rows);
    this.reset();
  }
  reset() { this.depth.fill(Infinity); }
  set(x, y, dist) { this.depth[y * this.cols + x] = dist; }
}

function countSkyCells(depthBuffer) {
  let n = 0;
  for (let i = 0; i < depthBuffer.depth.length; i++) if (depthBuffer.depth[i] === Infinity) n++;
  return n;
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

// --- correctness checks (architect review 2026-09-23 item 3) -------------

// (b) fast vs reference, per cell: glyph identical, fg/bg within tolerance.
function compareFastVsReference(level, camera, depthBuffer) {
  const rtRef = new BenchRT(COLS, ROWS);
  depthBuffer.reset();
  castScene(rtRef, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer });
  const rtFast = new BenchRT(COLS, ROWS);
  depthBuffer.reset();
  castScene(rtFast, level, camera, palette, { skyFallback: true, shader: 'fast', depthBuffer });

  let glyphMismatches = 0, colorMismatches = 0, worstDiff = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (rtFast.glyphIdx[i] !== rtRef.glyphIdx[i]) glyphMismatches++;
    const c = i * 3;
    for (let k = 0; k < 3; k++) {
      const d1 = Math.abs(rtFast.fg[c + k] - rtRef.fg[c + k]);
      const d2 = Math.abs(rtFast.bg[c + k] - rtRef.bg[c + k]);
      worstDiff = Math.max(worstDiff, d1, d2);
      if (d1 > COLOR_TOLERANCE || d2 > COLOR_TOLERANCE) colorMismatches++;
    }
  }
  return { rtRef, glyphMismatches, colorMismatches, worstDiff, ok: glyphMismatches === 0 && colorMismatches === 0 };
}

// (c) skyFallback:false invariant: writes + open-span rows == cols*rows, no
// double write, no written cell inside an open span.
function checkSkyFallbackFalseInvariant(level, camera) {
  const rt = new BenchRT(COLS, ROWS);
  const spans = castScene(rt, level, camera, palette, { skyFallback: false, shader: 'reference' });

  let doubleWrites = 0, openRows = 0, overlapViolations = 0;
  for (let x = 0; x < COLS; x++) {
    const open = spans.isOpen(x);
    const top = spans.top[x], bottom = spans.bottom[x];
    for (let y = 0; y < ROWS; y++) {
      const wc = rt.writeCount[y * COLS + x];
      if (wc > 1) doubleWrites++;
      const inOpenSpan = open && y >= top && y <= bottom;
      if (inOpenSpan) {
        openRows++;
        if (wc !== 0) overlapViolations++; // written cell inside an open span
      } else if (wc !== 1) {
        overlapViolations++; // a "closed" cell must be written exactly once
      }
    }
  }
  const total = rt.totalWrites + openRows;
  return {
    writes: rt.totalWrites, openRows, doubleWrites, overlapViolations,
    total, ok: doubleWrites === 0 && overlapViolations === 0 && total === COLS * ROWS,
  };
}

function main() {
  const args = process.argv.slice(2);
  const frameIdx = args.indexOf('--frames');
  const frames = frameIdx >= 0 ? parseInt(args[frameIdx + 1], 10) : DEFAULT_FRAMES;
  const withGc = args.includes('--gc');
  const updateBaseline = args.includes('--update-baseline');
  const shaderArg = args.find((a) => a.startsWith('--shader='));
  const shader = shaderArg ? shaderArg.split('=')[1] : 'fast'; // which shader the TIMED loop uses

  const level = loadLevel(testRoomDef);
  if (!level) {
    console.error('[bench-cast] test_room failed to load - aborting.');
    process.exit(1);
  }

  const rt = new BenchRT(COLS, ROWS);
  const depthBuffer = new BenchDepthBuffer(COLS, ROWS);
  const cellCount = COLS * ROWS;

  let ok = true;
  const newBaseline = {};

  for (const pose of POSES) {
    const camera = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };

    // Warm-up (not measured).
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      rt.resetFrame();
      castScene(rt, level, camera, palette, { skyFallback: true, shader });
    }

    let gcEvents = [];
    let observer = null;
    let heapUsedStart = null;
    if (withGc) {
      if (typeof global.gc === 'function') { global.gc(); heapUsedStart = process.memoryUsage().heapUsed; }
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

    let heapDeltaPerFrame = null;
    if (withGc && heapUsedStart !== null) {
      global.gc();
      const heapUsedEnd = process.memoryUsage().heapUsed;
      heapDeltaPerFrame = (heapUsedEnd - heapUsedStart) / frames;
    }

    if (observer) observer.disconnect();

    const s = stats(frameTimes);
    const checksum = { glyphIdx: fnv1a(rt.glyphIdx), fg: fnv1a(rt.fg), bg: fnv1a(rt.bg) };
    newBaseline[pose.name] = checksum;

    const writeCountOk = writesThisRun === cellCount && !anyDoubleWrite;
    if (!writeCountOk) ok = false;

    const minorGc = withGc
      ? gcEvents.filter((e) => e.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR).length
      : null;

    // Sky-cell count (architect review item 2): a stub depth buffer, a
    // dedicated reference-shader frame so it doesn't disturb the timed loop
    // or the fast/reference comparison run below (they reset it themselves).
    depthBuffer.reset();
    rt.resetFrame();
    castScene(rt, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer });
    const skyCells = countSkyCells(depthBuffer);

    // Per-cell probes (US-004b re-review #3 regression guards): specific
    // (col, row-range) cells that must be finite-depth geometry within a
    // range, or infinite (sky/open), read from the reference-shader
    // depthBuffer frame just cast above.
    const probeResults = [];
    if (pose.probes) {
      for (const probe of pose.probes) {
        for (const col of probe.cols) {
          for (let row = probe.rows[0]; row <= probe.rows[1]; row++) {
            const d = depthBuffer.depth[row * COLS + col];
            const isFinite_ = Number.isFinite(d);
            const passed = probe.kind === 'infinite' ? !isFinite_ : (isFinite_ && d >= probe.min && d <= probe.max);
            probeResults.push({ desc: probe.desc, col, row, d, passed });
            if (!passed) ok = false;
          }
        }
      }
    }

    console.log(`\n[bench-cast] pose: ${pose.name}`);
    console.log(`  avg ${ms(s.avg)} ms  p50 ${ms(s.p50)} ms  p95 ${ms(s.p95)} ms  max ${ms(s.max)} ms`);
    console.log(`  cells written (last measured frame): ${writesThisRun} / ${cellCount} expected` +
      (writeCountOk ? '  OK' : '  FAIL (mismatch or a cell written twice)'));
    console.log(`  sky cells: ${skyCells} / ${cellCount}  (geometry: ${cellCount - skyCells})`);
    for (const p of probeResults) {
      console.log(`  [probe] ${p.desc} @ (col ${p.col}, row ${p.row}): depth=${p.d}` + (p.passed ? '  OK' : '  FAIL'));
    }
    console.log(`  checksum (this run's shader='${shader}')  glyphIdx=${checksum.glyphIdx}  fg=${checksum.fg}  bg=${checksum.bg}`);
    if (withGc) {
      console.log(`  GC during measured window: ${gcEvents.length} total, ${minorGc} minor/scavenge` +
        (minorGc === 0 ? '  OK (zero scavenge)' : '  WARNING (scavenge observed - check for per-frame allocations)'));
      if (minorGc > 0) ok = false;
      if (heapDeltaPerFrame !== null) {
        const heapOk = heapDeltaPerFrame <= HEAP_DELTA_LIMIT_BYTES_PER_FRAME;
        console.log(`  heapUsed delta: ${heapDeltaPerFrame.toFixed(1)} B/frame` +
          (heapOk ? `  OK (<= ${HEAP_DELTA_LIMIT_BYTES_PER_FRAME} B)` : `  FAIL (> ${HEAP_DELTA_LIMIT_BYTES_PER_FRAME} B)`));
        if (!heapOk) ok = false;
      } else {
        console.log('  heapUsed delta: not measured (run with --expose-gc for a trustworthy number)');
      }
    }

    // --- correctness checks (item 3) ---
    if (!updateBaseline) {
      const baseline = EMBEDDED_BASELINE[pose.name];
      const refChecksum = shader === 'reference' ? checksum : (() => {
        depthBuffer.reset(); rt.resetFrame();
        castScene(rt, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer });
        return { glyphIdx: fnv1a(rt.glyphIdx), fg: fnv1a(rt.fg), bg: fnv1a(rt.bg) };
      })();
      const baselineOk = !!baseline && refChecksum.glyphIdx === baseline.glyphIdx &&
        refChecksum.fg === baseline.fg && refChecksum.bg === baseline.bg;
      console.log(`  [check] reference checksum vs embedded baseline: ` +
        (baselineOk ? 'OK' : `FAIL (got glyphIdx=${refChecksum.glyphIdx} fg=${refChecksum.fg} bg=${refChecksum.bg})`));
      if (!baselineOk) ok = false;

      const cmp = compareFastVsReference(level, camera, depthBuffer);
      console.log(`  [check] fast vs reference per-cell: glyph mismatches=${cmp.glyphMismatches}, ` +
        `color-tolerance violations=${cmp.colorMismatches}, worst channel diff=${cmp.worstDiff}` +
        (cmp.ok ? '  OK' : '  FAIL'));
      if (!cmp.ok) ok = false;

      const inv = checkSkyFallbackFalseInvariant(level, camera);
      console.log(`  [check] skyFallback:false invariant: writes=${inv.writes} openRows=${inv.openRows} ` +
        `(sum ${inv.total}/${cellCount}), doubleWrites=${inv.doubleWrites}, overlapViolations=${inv.overlapViolations}` +
        (inv.ok ? '  OK' : '  FAIL'));
      if (!inv.ok) ok = false;
    }
  }

  if (updateBaseline) {
    console.log('\n[bench-cast] --update-baseline: paste this into EMBEDDED_BASELINE in tools/bench-cast.mjs:\n');
    console.log('const EMBEDDED_BASELINE = {');
    for (const pose of POSES) {
      const c = newBaseline[pose.name];
      console.log(`  ${JSON.stringify(pose.name)}: { glyphIdx: ${JSON.stringify(c.glyphIdx)}, fg: ${JSON.stringify(c.fg)}, bg: ${JSON.stringify(c.bg)} },`);
    }
    console.log('};');
  }

  console.log(`\n[bench-cast] ${frames} frames/pose, ${WARMUP_FRAMES} warm-up frames/pose, grid ${COLS}x${ROWS}, timed shader='${shader}'.`);
  console.log(ok ? '[bench-cast] ALL CHECKS PASS' : '[bench-cast] FAILURES ABOVE');
  process.exit(ok ? 0 : 1);
}

main();
