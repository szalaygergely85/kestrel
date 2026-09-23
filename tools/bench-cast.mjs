#!/usr/bin/env node
// US-004b acceptance: headless perf + correctness bench for the sector
// caster (`castScene`, engine/render/sectorCaster.js - moved from
// game/js/render/raycaster.js by US-024, unchanged). Node, no dependencies,
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
import { loadLevel } from '../engine/world/Level.js';
import { castScene, beginFrame, castSectors, ambientL } from '../engine/render/sectorCaster.js';
import { GBuffer } from '../engine/render/GBuffer.js';
import { bindShading, bindLevel } from '../engine/render/MaterialTable.js';
import { computeDerivatives, shadeSurfaces } from '../engine/render/detailShade.js';
import { edgePass } from '../engine/render/edgePass.js';
import testRoomDef from '../design/levels/test_room.js';
import paletteModule from '../design/palette.js';
import detailPassModule from '../design/detail-pass.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;

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
// US-028a F1 note: this v1/legacy-path baseline does NOT change from this
// fix - `shadeAndWrite` (sectorCaster.js) remaps any v2-only material key to
// its v1 fallback before shading here (`ctx.U.shade`/`fastShade` on the v1
// palette), so it never reaches `shadeV2`'s hA/hC. Verified unchanged by
// re-running with only this story's engine diff applied (fg/bg identical to
// the pre-US-028a values below).
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

// US-028: real-CellBuffer-shaped fake render target (fg/bg Uint8Array(n*4),
// glyphIdx packed into fg[..+3] - see engine/render/CellBuffer.js), so
// `edgePass` (which patches `rt.cells` directly, never through
// `setCellRGB`) works unmodified against this bench harness. `cells` is
// `this` - the two backends' real `.cells` is a separate `CellBuffer`
// instance, but shape (glyphIdx/fg Uint8Array) is all `edgePass` needs.
class BenchRTv2 {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.pxCellW = PX_CELL_W;
    this.pxCellH = PX_CELL_H;
    this.glyphIdx = new Uint8Array(cols * rows);
    this.fg = new Uint8Array(cols * rows * 4);
    this.bg = new Uint8Array(cols * rows * 4);
    this.writeCount = new Uint16Array(cols * rows);
    this.totalWrites = 0;
    this.cells = this;
  }
  setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyphIdx[i] = glyphIdx;
    const fi = i * 4;
    this.fg[fi] = r; this.fg[fi + 1] = g; this.fg[fi + 2] = b; this.fg[fi + 3] = glyphIdx;
    this.bg[fi] = r2; this.bg[fi + 1] = g2; this.bg[fi + 2] = b2; this.bg[fi + 3] = 255;
    this.writeCount[i]++;
    this.totalWrites++;
  }
  resetFrame() {
    this.writeCount.fill(0);
    this.totalWrites = 0;
  }
}

function fnv1a4(bytes) { // fg/bg are *4 (rgba) here - fold alpha out first so checksums stay comparable to BenchRT's *3 layout
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 4) {
    for (let k = 0; k < 3; k++) { h ^= bytes[i + k]; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const V2_GLYPH_DOT = '.'.charCodeAt(0) - 32;
const RULE_NAMES = ['cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing'];

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
  castScene(rtRef, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer, detailPass });
  const rtFast = new BenchRT(COLS, ROWS);
  depthBuffer.reset();
  castScene(rtFast, level, camera, palette, { skyFallback: true, shader: 'fast', depthBuffer, detailPass });

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
  const spans = castScene(rt, level, camera, palette, { skyFallback: false, shader: 'reference', detailPass });

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

// US-028 AC "Bench baseline": v2 checksums (glyphIdx/fg/bg, RGB only - the
// bench RT's alpha channel just carries the packed glyphIdx, not a fourth
// color plane, so it's excluded the same way BenchRT's *3 layout naturally
// is). Recorded via `--update-baseline` (prints both v1 and v2 tables).
// Re-recorded (programmer, US-028 rework, 2026-09-23): changed because of
// (a) the MaterialTable flattening (item 4 - fg/bg can differ by the +-4
// tolerance the AC allows, from the LUT-based gain curve and per-set
// threshold tables replacing the string-keyed reference path) and (b) the
// designer's `ceiling_timber` retune (albedo/grid.shade/band.edgeShade,
// commit ebd2734) - NOT from any change to the caster geometry.
// Re-recorded 2026-09-23 (US-028a F1 + designer's maxCover 0.5 -> 0.25,
// same commit as the EMBEDDED_BASELINE re-record above): `shadeDetailFast`'s
// `hA`/`hC` keying change (block/cell id, not fine texel) and the tighter
// joint spacing shift fg/bg across every pose; glyphIdx also moves here
// (unlike the reference table) because the fast path's per-set threshold
// tables pick alternates off the same hA/hC.
const EMBEDDED_BASELINE_V2 = {
  'start pose (S, facing east, level)': { glyphIdx: '49a65dfe', fg: 'b2b30d73', bg: '5d97624c' },
  'facing stair + 1.0m platform': { glyphIdx: 'a592f221', fg: '5a09038f', bg: 'e92ab1e2' },
  'sky over the low wall, pitch +20': { glyphIdx: 'a5d4abee', fg: '280c581c', bg: '935a2cda' },
  'long diagonal, pitch -35': { glyphIdx: '3a1ff668', fg: 'f9bc2119', bg: '4f2b3acb' },
  'low wall sky, (10, 7.5) yaw 45 pitch +25': { glyphIdx: '056c82fc', fg: '0974d14a', bg: '0c85db6c' },
};

// US-028 bench: pass timers (cast/deriv/shade/edge), the 9,600-writes
// invariant, glyph-diversity + edge-rule metrics (owner complaint ACs), and
// the v2 checksum. `v1Stats` is this pose's already-measured v1 `castScene`
// timing (avg/p50/p95/max, ms) - used for the "<=1.0ms p50 extra" budget.
function runDetailPassBench(pose, camera, level, rt2, depth2, fb2, gbuf, matTable, frames, v2Baseline, v1Stats, updateBaseline, repeats) {
  let ok = true;
  const cellCount = COLS * ROWS;

  function frame() {
    rt2.resetFrame();
    depth2.reset();
    const castT0 = performance.now();
    depth2.reset(); gbuf.beginFrame();
    castScene(rt2, level, camera, palette, { origin: undefined, skyFallback: true, gbuf, matTable, depthBuffer: depth2, detailPass });
    const castT1 = performance.now();
    computeDerivatives(gbuf, depth2.depth);
    const derivT1 = performance.now();
    shadeSurfaces(fb2, gbuf, matTable, detailPass, ambientL);
    const shadeT1 = performance.now();
    edgePass(gbuf, depth2.depth, rt2, detailPass.edges);
    const edgeT1 = performance.now();
    return { cast: castT1 - castT0, deriv: derivT1 - castT1, shade: shadeT1 - derivT1, edge: edgeT1 - shadeT1 };
  }

  // US-028a (timing gates flaky on a busy machine): measure `repeats`
  // independent runs (each with its own warm-up), keep the BEST (lowest)
  // total p50 for the gate checks below, and print every repeat's p50 so a
  // stray machine-load spike is visible instead of silently failing the
  // gate. Only the LAST repeat's per-pass stats/frame state feed the
  // (deterministic, pose-only) correctness checks after this loop.
  let sCast, sDeriv, sShade, sEdge, sTotal;
  const totalP50s = new Array(repeats);
  for (let rep = 0; rep < repeats; rep++) {
    for (let i = 0; i < WARMUP_FRAMES; i++) frame(); // warm-up (not measured)

    const castT = new Array(frames), derivT = new Array(frames), shadeT = new Array(frames), edgeT = new Array(frames), totalT = new Array(frames);
    for (let i = 0; i < frames; i++) {
      const t = frame();
      castT[i] = t.cast; derivT[i] = t.deriv; shadeT[i] = t.shade; edgeT[i] = t.edge;
      totalT[i] = t.cast + t.deriv + t.shade + t.edge;
    }
    sCast = stats(castT); sDeriv = stats(derivT); sShade = stats(shadeT); sEdge = stats(edgeT); sTotal = stats(totalT);
    totalP50s[rep] = sTotal.p50;
  }
  const bestTotalP50 = Math.min(...totalP50s);
  console.log(`  [v2 timing] total p50 over ${repeats} repeat(s): ` + totalP50s.map(ms).join(', ') + ` ms -> best ${ms(bestTotalP50)} ms`);

  // 9,600-writes invariant: gbuf wrote every non-sky cell, rt2 wrote every
  // sky cell during THIS LAST frame's castScene (before shadeSurfaces ran
  // again) - re-cast once, isolated, to check it cleanly.
  rt2.resetFrame();
  depth2.reset();
  depth2.reset(); gbuf.beginFrame();
  castScene(rt2, level, camera, palette, { skyFallback: true, gbuf, matTable, depthBuffer: depth2, detailPass });
  const writeInvariantOk = gbuf.writeCount + rt2.totalWrites === cellCount;
  console.log(`  [v2 check] writes: gbuf=${gbuf.writeCount} + sky=${rt2.totalWrites} = ${gbuf.writeCount + rt2.totalWrites} / ${cellCount}` +
    (writeInvariantOk ? '  OK' : '  FAIL'));
  if (!writeInvariantOk) ok = false;
  computeDerivatives(gbuf, depth2.depth);
  shadeSurfaces(fb2, gbuf, matTable, detailPass, ambientL);
  edgePass(gbuf, depth2.depth, rt2, detailPass.edges);

  // Owner-complaint metric (AC, PO ruling 2026-09-23: excludes `onJoint`
  // mortar/joint cells from the blank-share denominator and numerator - see
  // docs/backlog.md US-028 section): distinct glyphs over every non-sky
  // (kind != 0) cell, "only '.'/blank" share over non-sky, non-joint cells.
  const seen = new Set();
  let blankOrDot = 0, surfaceCells = 0, nonJointCells = 0;
  for (let i = 0; i < cellCount; i++) {
    if (gbuf.kind[i] === 0) continue;
    surfaceCells++;
    const g = rt2.glyphIdx[i];
    seen.add(g);
    if (gbuf.onJoint[i]) continue;
    nonJointCells++;
    if (g === 0 || g === V2_GLYPH_DOT) blankOrDot++;
  }
  const blankPct = nonJointCells ? (100 * blankOrDot / nonJointCells) : 0;
  const glyphOk = seen.size >= 10 && blankPct <= 5;
  console.log(`  [v2 check] distinct glyphs: ${seen.size} (>=10 required), only '.'/blank: ${blankPct.toFixed(1)}% of ${nonJointCells} non-sky non-joint cells (<=5% required)` +
    (glyphOk ? '  OK' : '  FAIL'));
  if (!glyphOk) ok = false;

  // Edge-rule counts.
  const ruleCounts = new Array(9).fill(0);
  for (let i = 0; i < cellCount; i++) ruleCounts[gbuf.rule[i]]++;
  console.log(`  [v2] edge rule counts: ` + RULE_NAMES.map((n, k) => `${n}=${ruleCounts[k + 1]}`).join(' '));

  // Timing report + budget (best-of-N repeats - see totalP50s above).
  const extraP50 = bestTotalP50 - v1Stats.p50;
  console.log(`  [v2 timing] cast p50 ${ms(sCast.p50)}  deriv p50 ${ms(sDeriv.p50)}  shade p50 ${ms(sShade.p50)}  edge p50 ${ms(sEdge.p50)}  total p50 (last repeat) ${ms(sTotal.p50)} ms`);
  console.log(`  [v2 timing] v1 fast total best p50 ${ms(v1Stats.p50)} ms, v2 total best p50 ${ms(bestTotalP50)} ms, extra ${ms(extraP50)} ms` +
    (extraP50 <= 1.0 ? '  OK (<=1.0ms)' : '  OVER BUDGET (>1.0ms) - see US-028 notes'));
  const totalUnderTrigger = bestTotalP50 < 3.5;
  console.log(`  [v2 timing] best total sectors p50 ${ms(bestTotalP50)} ms vs US-004b escalation trigger 3.5 ms` + (totalUnderTrigger ? '  OK' : '  FAIL'));
  if (!totalUnderTrigger) ok = false;

  // Checksum (new baseline; RGB-only, alpha excluded - see fnv1a4).
  const checksum = { glyphIdx: fnv1a(rt2.glyphIdx), fg: fnv1a4(rt2.fg), bg: fnv1a4(rt2.bg) };
  v2Baseline[pose.name] = checksum;
  console.log(`  [v2] checksum  glyphIdx=${checksum.glyphIdx}  fg=${checksum.fg}  bg=${checksum.bg}`);
  if (!updateBaseline) {
    const baseline = EMBEDDED_BASELINE_V2[pose.name];
    const baselineOk = !!baseline && checksum.glyphIdx === baseline.glyphIdx && checksum.fg === baseline.fg && checksum.bg === baseline.bg;
    console.log(`  [v2 check] checksum vs embedded v2 baseline: ` + (baselineOk ? 'OK' : baseline ? 'FAIL' : 'no baseline recorded yet (run --update-baseline)'));
    if (baseline && !baselineOk) ok = false;
  }

  return ok;
}

// --- US-028a flicker metric (owner feedback "shimmer when moving") -------
// Start pose, 30 steps each of 0.02 m forward, 0.02 m strafe, 0.1 deg yaw.
// A "same-surface" cell = same kind/material/planeId in both frames of a
// pair. Reports, per motion and averaged over the three: % of same-surface
// cells whose FINAL glyph (post edge-pass) changes, split into non-joint/
// non-edge (excludes cells flagged `onJoint` or touched by the edge pass,
// `gbuf.rule != 0`, in EITHER frame) vs. total. Also an A-B-A check
// (forward/back/forward): same-surface cells whose glyph at pose A differs
// from pose A again three steps later (float add/subtract round-trip, not
// time - this bench has no clock input) - "reverts".
const FLICKER_STEPS = 30;
const FLICKER_STEP_M = 0.02;
const FLICKER_STEP_DEG = 0.1;

function castFlickerFrame(camera, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2) {
  rt2.resetFrame();
  depth2.reset();
  gbuf.beginFrame();
  castScene(rt2, level, camera, palette, { skyFallback: true, gbuf, matTable, depthBuffer: depth2, detailPass });
  computeDerivatives(gbuf, depth2.depth);
  shadeSurfaces(fb2, gbuf, matTable, detailPass, ambientL);
  edgePass(gbuf, depth2.depth, rt2, detailPass.edges);
  // Typed arrays are reused in place next frame - copy out what the compare
  // needs.
  const n = gbuf.cols * gbuf.rows;
  return {
    kind: gbuf.kind.slice(0, n),
    mat: gbuf.mat.slice(0, n),
    planeId: gbuf.planeId.slice(0, n),
    onJoint: gbuf.onJoint.slice(0, n),
    rule: gbuf.rule.slice(0, n),
    glyphIdx: rt2.glyphIdx.slice(0, n),
  };
}

function compareFlickerPair(a, b, n) {
  let same = 0, changedTotal = 0, nje = 0, changedNje = 0;
  for (let i = 0; i < n; i++) {
    if (a.kind[i] === 0 || b.kind[i] === 0) continue;
    if (a.kind[i] !== b.kind[i] || a.mat[i] !== b.mat[i] || a.planeId[i] !== b.planeId[i]) continue; // not same-surface
    same++;
    const changed = a.glyphIdx[i] !== b.glyphIdx[i];
    if (changed) changedTotal++;
    if (a.onJoint[i] === 0 && b.onJoint[i] === 0 && a.rule[i] === 0 && b.rule[i] === 0) {
      nje++;
      if (changed) changedNje++;
    }
  }
  return {
    same,
    totalPct: same ? 100 * changedTotal / same : 0,
    njePct: nje ? 100 * changedNje / nje : 0,
  };
}

function runFlickerBench(level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2) {
  const base = { x: 2.5, y: 2.5, z: EYE_H, yawDeg: 90, pitchDeg: 0 }; // start pose
  const n = gbuf.cols * gbuf.rows;
  const yawRad = base.yawDeg * Math.PI / 180;
  const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad); // sectorCaster.js dirX/dirY convention
  const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad); // orthogonal to forward

  function motionSeries(dx, dy, dyaw) {
    let cam = { ...base };
    let prev = castFlickerFrame(cam, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2);
    let totalSum = 0, njeSum = 0;
    for (let s = 0; s < FLICKER_STEPS; s++) {
      cam = { x: cam.x + dx, y: cam.y + dy, z: cam.z, yawDeg: cam.yawDeg + dyaw, pitchDeg: cam.pitchDeg };
      const cur = castFlickerFrame(cam, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2);
      const cmp = compareFlickerPair(prev, cur, n);
      totalSum += cmp.totalPct; njeSum += cmp.njePct;
      prev = cur;
    }
    return { totalPct: totalSum / FLICKER_STEPS, njePct: njeSum / FLICKER_STEPS };
  }

  const fwd = motionSeries(fwdX * FLICKER_STEP_M, fwdY * FLICKER_STEP_M, 0);
  const strafe = motionSeries(rightX * FLICKER_STEP_M, rightY * FLICKER_STEP_M, 0);
  const yaw = motionSeries(0, 0, FLICKER_STEP_DEG);
  const avgTotal = (fwd.totalPct + strafe.totalPct + yaw.totalPct) / 3;

  // A-B-A: forward step, back, forward.
  let cam = { ...base };
  const f0 = castFlickerFrame(cam, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2);
  cam = { x: cam.x + fwdX * FLICKER_STEP_M, y: cam.y + fwdY * FLICKER_STEP_M, z: cam.z, yawDeg: cam.yawDeg, pitchDeg: cam.pitchDeg };
  castFlickerFrame(cam, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2); // B, discarded
  cam = { x: cam.x - fwdX * FLICKER_STEP_M, y: cam.y - fwdY * FLICKER_STEP_M, z: cam.z, yawDeg: cam.yawDeg, pitchDeg: cam.pitchDeg };
  const f2 = castFlickerFrame(cam, level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2); // A again
  const aba = compareFlickerPair(f0, f2, n);

  console.log(`\n[bench-cast] US-028a flicker metric (start pose, 30 steps x {0.02m fwd, 0.02m strafe, 0.1deg yaw}):`);
  console.log(`  forward:  non-joint/non-edge ${fwd.njePct.toFixed(2)}%  total ${fwd.totalPct.toFixed(2)}%`);
  console.log(`  strafe:   non-joint/non-edge ${strafe.njePct.toFixed(2)}%  total ${strafe.totalPct.toFixed(2)}%`);
  console.log(`  yaw:      non-joint/non-edge ${yaw.njePct.toFixed(2)}%  total ${yaw.totalPct.toFixed(2)}%`);
  console.log(`  averaged: non-joint/non-edge ${((fwd.njePct + strafe.njePct + yaw.njePct) / 3).toFixed(2)}%  total ${avgTotal.toFixed(2)}%`);
  console.log(`  A-B-A revert (same-surface cells differing pose A vs pose A again): ${aba.totalPct.toFixed(2)}%`);

  const njeOk = fwd.njePct <= 1.0 && strafe.njePct <= 1.0 && yaw.njePct <= 1.0;
  const totalOk = avgTotal <= 7.0;
  const abaOk = aba.totalPct <= 0.3;
  console.log(`  [check] non-joint/non-edge <= 1.0% per motion: ` + (njeOk ? 'OK' : 'FAIL'));
  console.log(`  [check] total averaged <= 7.0%: ` + (totalOk ? 'OK' : 'FAIL'));
  console.log(`  [check] A-B-A revert <= 0.3%: ` + (abaOk ? 'OK' : 'FAIL'));
  return njeOk && totalOk && abaOk;
}

function main() {
  const args = process.argv.slice(2);
  const frameIdx = args.indexOf('--frames');
  const frames = frameIdx >= 0 ? parseInt(args[frameIdx + 1], 10) : DEFAULT_FRAMES;
  const withGc = args.includes('--gc');
  const updateBaseline = args.includes('--update-baseline');
  const shaderArg = args.find((a) => a.startsWith('--shader='));
  const shader = shaderArg ? shaderArg.split('=')[1] : 'fast'; // which shader the TIMED loop uses
  const repeatIdx = args.indexOf('--repeat');
  // US-028a: timing gates were flaky on a busy machine (same pose 3.0 ms
  // then 4.6 ms with no code change) - measure `repeats` independent runs
  // per pose and gate on the BEST (lowest) p50, printing every repeat's
  // value so a load spike is visible instead of silently failing. Only
  // functional/correctness checks stay single-shot (deterministic, pose-only).
  const repeats = repeatIdx >= 0 ? parseInt(args[repeatIdx + 1], 10) : 3;

  const level = loadLevel(testRoomDef);
  if (!level) {
    console.error('[bench-cast] test_room failed to load - aborting.');
    process.exit(1);
  }

  const rt = new BenchRT(COLS, ROWS);
  const depthBuffer = new BenchDepthBuffer(COLS, ROWS);
  const cellCount = COLS * ROWS;

  // --- US-028 v2 pipeline setup (allocated once, reused every pose/frame,
  // exactly like createEngine/main.js does) ---------------------------------
  const rt2 = new BenchRTv2(COLS, ROWS);
  const depth2 = new BenchDepthBuffer(COLS, ROWS);
  const matTable = bindShading(palette, detailPass, PX_CELL_H / PX_CELL_W);
  bindLevel(matTable, level);
  const gbuf = new GBuffer(COLS, ROWS);
  const fb2 = { rt: rt2, depth: depth2, palette, gbuf, matTable };
  const v2Baseline = {};

  let ok = true;
  const newBaseline = {};

  for (const pose of POSES) {
    const camera = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };

    // Best-of-`repeats` timing (US-028a) - each repeat gets its own
    // warm-up. GC/heap tracking and the correctness/checksum state below
    // use only the LAST repeat (deterministic, pose-only output).
    let s, checksum, writesThisRun = 0, anyDoubleWrite = false, minorGc = null, heapDeltaPerFrame = null, gcEventsCount = 0;
    const v1P50s = new Array(repeats);
    for (let rep = 0; rep < repeats; rep++) {
      // Warm-up (not measured).
      for (let i = 0; i < WARMUP_FRAMES; i++) {
        rt.resetFrame();
        castScene(rt, level, camera, palette, { skyFallback: true, shader, detailPass });
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
      anyDoubleWrite = false;

      for (let i = 0; i < frames; i++) {
        rt.resetFrame();
        const t0 = performance.now();
        castScene(rt, level, camera, palette, { skyFallback: true, shader, detailPass });
        const t1 = performance.now();
        frameTimes[i] = t1 - t0;
        writesThisRun = rt.totalWrites;
        for (let c = 0; c < cellCount; c++) {
          if (rt.writeCount[c] > 1) { anyDoubleWrite = true; break; }
        }
      }

      if (withGc && heapUsedStart !== null) {
        global.gc();
        const heapUsedEnd = process.memoryUsage().heapUsed;
        heapDeltaPerFrame = (heapUsedEnd - heapUsedStart) / frames;
      }
      if (observer) observer.disconnect();

      s = stats(frameTimes);
      v1P50s[rep] = s.p50;
      checksum = { glyphIdx: fnv1a(rt.glyphIdx), fg: fnv1a(rt.fg), bg: fnv1a(rt.bg) };
      gcEventsCount = gcEvents.length;
      minorGc = withGc
        ? gcEvents.filter((e) => e.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR).length
        : null;
    }
    const v1BestP50 = Math.min(...v1P50s);
    newBaseline[pose.name] = checksum;

    const writeCountOk = writesThisRun === cellCount && !anyDoubleWrite;
    if (!writeCountOk) ok = false;

    // Sky-cell count (architect review item 2): a stub depth buffer, a
    // dedicated reference-shader frame so it doesn't disturb the timed loop
    // or the fast/reference comparison run below (they reset it themselves).
    depthBuffer.reset();
    rt.resetFrame();
    castScene(rt, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer, detailPass });
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
    console.log(`  v1 p50 over ${repeats} repeat(s): ` + v1P50s.map(ms).join(', ') + ` ms -> best ${ms(v1BestP50)} ms`);
    console.log(`  last repeat: avg ${ms(s.avg)} ms  p50 ${ms(s.p50)} ms  p95 ${ms(s.p95)} ms  max ${ms(s.max)} ms`);
    console.log(`  cells written (last measured frame): ${writesThisRun} / ${cellCount} expected` +
      (writeCountOk ? '  OK' : '  FAIL (mismatch or a cell written twice)'));
    console.log(`  sky cells: ${skyCells} / ${cellCount}  (geometry: ${cellCount - skyCells})`);
    for (const p of probeResults) {
      console.log(`  [probe] ${p.desc} @ (col ${p.col}, row ${p.row}): depth=${p.d}` + (p.passed ? '  OK' : '  FAIL'));
    }
    console.log(`  checksum (this run's shader='${shader}')  glyphIdx=${checksum.glyphIdx}  fg=${checksum.fg}  bg=${checksum.bg}`);
    if (withGc) {
      console.log(`  GC during measured window (last repeat): ${gcEventsCount} total, ${minorGc} minor/scavenge` +
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
        castScene(rt, level, camera, palette, { skyFallback: true, shader: 'reference', depthBuffer, detailPass });
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

    // --- US-028 v2 pipeline: bench + correctness -----------------------
    ok = runDetailPassBench(pose, camera, level, rt2, depth2, fb2, gbuf, matTable, frames, v2Baseline, { p50: v1BestP50 }, updateBaseline, repeats) && ok;
  }

  // --- US-028a: flicker metric (start pose only, reuses the v2 pipeline
  // objects above - each call resets/rebuilds them, so no pose leaks in).
  ok = runFlickerBench(level, palette, detailPass, rt2, depth2, gbuf, matTable, fb2) && ok;

  if (updateBaseline) {
    console.log('\n[bench-cast] --update-baseline: paste this into EMBEDDED_BASELINE in tools/bench-cast.mjs:\n');
    console.log('const EMBEDDED_BASELINE = {');
    for (const pose of POSES) {
      const c = newBaseline[pose.name];
      console.log(`  ${JSON.stringify(pose.name)}: { glyphIdx: ${JSON.stringify(c.glyphIdx)}, fg: ${JSON.stringify(c.fg)}, bg: ${JSON.stringify(c.bg)} },`);
    }
    console.log('};');

    console.log('\n[bench-cast] --update-baseline: paste this into EMBEDDED_BASELINE_V2 in tools/bench-cast.mjs:\n');
    console.log('const EMBEDDED_BASELINE_V2 = {');
    for (const pose of POSES) {
      const c = v2Baseline[pose.name];
      console.log(`  ${JSON.stringify(pose.name)}: { glyphIdx: ${JSON.stringify(c.glyphIdx)}, fg: ${JSON.stringify(c.fg)}, bg: ${JSON.stringify(c.bg)} },`);
    }
    console.log('};');
  }

  console.log(`\n[bench-cast] ${frames} frames/pose, ${WARMUP_FRAMES} warm-up frames/pose, grid ${COLS}x${ROWS}, timed shader='${shader}'.`);
  console.log(ok ? '[bench-cast] ALL CHECKS PASS' : '[bench-cast] FAILURES ABOVE');
  process.exit(ok ? 0 : 1);
}

main();
