// engine/render/gpu/gpuCompare.test.js (US-029 tech notes item 10).
// Pure `compareCells` checks: edge-cell exclusion, tolerance edges 4 vs 5,
// PASS/FAIL rule. Run: node engine/render/gpu/gpuCompare.test.js
import { compareCells, compareGeometry } from './gpuCompare.js';

// f32<->u32 bit-cast helper for building synthetic readbackGeometry() data.
const _bitBuf = new ArrayBuffer(4);
const _bitF32 = new Float32Array(_bitBuf);
const _bitU32 = new Uint32Array(_bitBuf);
function f32Bits(x) { _bitF32[0] = x; return _bitU32[0]; }

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const COLS = 4, ROWS = 4, N = COLS * ROWS;

// Default glyph byte 50 (an arbitrary, valid-looking "don't care" value) -
// NOT 255, which is `poisonNonSky`'s poison marker (test 6 below): a
// baseline of 255 here would make every untouched cell in every other test
// look like a poisoned survivor once that check exists.
function makeCells(fill) {
  const fg = new Uint8Array(N * 4), bg = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { fg[i * 4 + 3] = 50; bg[i * 4 + 3] = 50; }
  fill(fg, bg);
  return { fg, bg };
}

// --- 1. identical cells: 100% match, PASS ----------------------------------
{
  const kind = new Uint8Array(N).fill(1);
  const js = makeCells((fg, bg) => { for (let i = 0; i < N; i++) { fg[i * 4] = 10; bg[i * 4] = 20; } });
  const gpu = makeCells((fg, bg) => { for (let i = 0; i < N; i++) { fg[i * 4] = 10; bg[i * 4] = 20; } });
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  ok('identical cells: glyphMatchPct 100', r.glyphMatchPct === 100);
  ok('identical cells: fgOutside 0', r.fgOutside === 0);
  ok('identical cells: pass', r.pass === true);
}

// --- 2. tolerance boundary: delta 4 passes, delta 5 fails ------------------
{
  const kind = new Uint8Array(N).fill(1);
  const js = makeCells((fg) => { fg[0] = 100; });
  const gpuOk = makeCells((fg) => { fg[0] = 104; }); // delta 4
  const gpuBad = makeCells((fg) => { fg[0] = 105; }); // delta 5
  const rOk = compareCells(js.fg, js.bg, gpuOk.fg, gpuOk.bg, kind, COLS, ROWS);
  const rBad = compareCells(js.fg, js.bg, gpuBad.fg, gpuBad.bg, kind, COLS, ROWS);
  ok('tolerance: delta 4 within tolerance', rOk.fgOutside === 0);
  ok('tolerance: delta 5 outside tolerance', rBad.fgOutside === 1);
  ok('tolerance: delta 4 -> pass', rOk.pass === true);
  ok('tolerance: delta 5 -> fail', rBad.pass === false);
}

// --- 3. edge-cell exclusion: a differing-neighbour-kind cell's glyph
//        mismatch does not count against glyphMatchPct, but IS still
//        checked for fg/bg tolerance -------------------------------------
{
  const kind = new Uint8Array(N).fill(1);
  kind[5] = 2; // cell (1,1): give it a different kind than its neighbours -> edge cell
  const js = makeCells((fg) => { fg[5 * 4 + 3] = 10; });
  const gpu = makeCells((fg) => { fg[5 * 4 + 3] = 20; }); // glyph mismatch on the edge cell only
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  // cell 5 AND its 4 orthogonal neighbours (1, 4, 6, 9) all have a
  // differing-kind neighbour, so all 5 are edge cells by the same rule
  // compare-detail-export.mjs/edgePass.js use (4-neighbour kind compare).
  ok('edge cell excluded from glyph match denominator', r.edgeCells === 5 && r.nonEdgeChecked === 11);
  ok('edge cell glyph mismatch does not fail glyphMatchPct', r.glyphMatchPct === 100);
}

// --- 4. non-edge glyph mismatch DOES count -------------------------------
{
  const kind = new Uint8Array(N).fill(1);
  const js = makeCells((fg) => { fg[5 * 4 + 3] = 10; });
  const gpu = makeCells((fg) => { fg[5 * 4 + 3] = 20; });
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  ok('non-edge glyph mismatch reduces glyphMatchPct', r.glyphMatchPct < 100 && r.glyphMismatchNonEdge === 1);
}

// --- 5. sky cells (kind 0) never counted ----------------------------------
{
  const kind = new Uint8Array(N); // all sky
  const js = makeCells(() => {});
  const gpu = makeCells((fg) => { fg[0] = 200; }); // huge diff, but sky
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  ok('sky cells excluded entirely', r.nonSky === 0 && r.fgOutside === 0 && r.pass === true);
}

// --- 6. poisonedSurvivors: a passthrough-poison signature surviving into
//        the "GPU" readback is counted and fails PASS - this is the
//        tautology architect review 1 item 1 catches (`?gpucompare=1` used
//        to pass by comparing the JS result with itself, because pass 1's
//        passthrough branch let a poisoned/untouched cell straight through
//        unshaded) ------------------------------------------------------
{
  const kind = new Uint8Array(N).fill(1);
  const js = makeCells((fg, bg) => { for (let i = 0; i < N; i++) { fg[i * 4] = 10; bg[i * 4] = 20; } });
  // Only cell 3 differs from js: it still shows the poison signature
  // (glyph byte 255, fg/bg rgb 0) instead of a real shaded value.
  const gpu = makeCells((fg, bg) => {
    for (let i = 0; i < N; i++) { fg[i * 4] = 10; bg[i * 4] = 20; }
    fg[3 * 4] = 0; fg[3 * 4 + 1] = 0; fg[3 * 4 + 2] = 0; fg[3 * 4 + 3] = 255;
    bg[3 * 4] = 0; bg[3 * 4 + 1] = 0; bg[3 * 4 + 2] = 0; bg[3 * 4 + 3] = 255;
  });
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  ok('poisoned survivor detected', r.poisonedSurvivors === 1);
  ok('poisoned survivor fails PASS', r.pass === false);
}

// --- compareGeometry (US-030a, 14.2 item 8) --------------------------------
// A uniform 4x4 grid, no edges anywhere (every cell same kind) - isolates
// each check from the edge-cell exclusion.
function makeGeomFixture(kindVal, matVal, planeIdVal, uVal, vVal, depthVal) {
  const kind = new Uint8Array(N).fill(kindVal);
  const mat = new Uint16Array(N).fill(matVal);
  const planeId = new Int32Array(N).fill(planeIdVal);
  const u = new Float32Array(N).fill(uVal);
  const v = new Float32Array(N).fill(vVal);
  const depth = new Float32Array(N).fill(depthVal);
  const giBuf = new Uint32Array(4 * N), gaBuf = new Uint32Array(4 * N), depthBuf = new Uint32Array(4 * N);
  for (let i = 0; i < N; i++) {
    giBuf[i * 4] = planeIdVal >>> 0;
    giBuf[i * 4 + 1] = (kindVal & 0xff) | ((matVal & 0xffff) << 16);
    gaBuf[i * 4] = f32Bits(uVal); gaBuf[i * 4 + 1] = f32Bits(vVal);
    depthBuf[i * 4] = f32Bits(depthVal);
  }
  return { gbuf: { kind, mat, planeId, u, v }, depth, giBuf, gaBuf, depthBuf };
}

// 1. identical geometry: 100% kind match, no violations, PASS.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('compareGeometry identical: kindMatchPct 100', r.kindMatchPct === 100);
  ok('compareGeometry identical: matEqual == matched', r.matEqual === r.matched);
  ok('compareGeometry identical: planeEqual == matched', r.planeEqual === r.matched);
  ok('compareGeometry identical: no depth/uv violations', r.depthViol === 0 && r.uvViol === 0);
  ok('compareGeometry identical: pass', r.pass === true);
}

// 2. every cell's GPU kind differs from CPU (all non-edge, uniform) -> 0% match, FAIL.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  for (let i = 0; i < N; i++) f.giBuf[i * 4 + 1] = (2 & 0xff) | ((5 & 0xffff) << 16); // GPU says kind 2 everywhere
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('compareGeometry all-kind-mismatch: kindMatchPct 0', r.kindMatchPct === 0);
  ok('compareGeometry all-kind-mismatch: fails', r.pass === false);
}

// 3. mat/planeId differ (kind still matches) -> counted, still a geometry FAIL
//    only if depth/uv also violate; mat/planeId mismatches alone don't fail
//    PASS by themselves (kindMatchPct/depthViol/uvViol gate it) but are reported.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  for (let i = 0; i < N; i++) f.giBuf[i * 4] = 99999 >>> 0; // planeId differs, kind/mat/uv/depth agree
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('compareGeometry planeId mismatch: planeEqual 0', r.planeEqual === 0);
  ok('compareGeometry planeId mismatch: kindMatchPct unaffected (100)', r.kindMatchPct === 100);
}

// 4. depth tolerance boundary: 1% relative error passes, just over fails.
{
  const f1 = makeGeomFixture(1, 5, 1, 0, 0, 100);
  for (let i = 0; i < N; i++) f1.depthBuf[i * 4] = f32Bits(100.9); // 0.9% - within 1%
  const r1 = compareGeometry(f1.gbuf, f1.depth, f1.giBuf, f1.gaBuf, f1.depthBuf, COLS, ROWS);
  ok('compareGeometry depth +0.9%: no violation', r1.depthViol === 0);

  const f2 = makeGeomFixture(1, 5, 1, 0, 0, 100);
  for (let i = 0; i < N; i++) f2.depthBuf[i * 4] = f32Bits(102); // 2% - over
  const r2 = compareGeometry(f2.gbuf, f2.depth, f2.giBuf, f2.gaBuf, f2.depthBuf, COLS, ROWS);
  ok('compareGeometry depth +2%: violation on every matched cell', r2.depthViol === r2.matched && r2.matched > 0);
  ok('compareGeometry depth +2%: fails', r2.pass === false);
}

// 5. u/v tolerance: within 1e-3*depth passes, well beyond fails.
{
  const f1 = makeGeomFixture(1, 5, 1, 10, 10, 50);
  for (let i = 0; i < N; i++) f1.gaBuf[i * 4] = f32Bits(10 + 0.9 * 1e-3 * 50); // just inside tol
  const r1 = compareGeometry(f1.gbuf, f1.depth, f1.giBuf, f1.gaBuf, f1.depthBuf, COLS, ROWS);
  ok('compareGeometry u within tol: no uv violation', r1.uvViol === 0);

  const f2 = makeGeomFixture(1, 5, 1, 10, 10, 50);
  for (let i = 0; i < N; i++) f2.gaBuf[i * 4] = f32Bits(10 + 5); // well beyond tol
  const r2 = compareGeometry(f2.gbuf, f2.depth, f2.giBuf, f2.gaBuf, f2.depthBuf, COLS, ROWS);
  ok('compareGeometry u beyond tol: violation on every matched cell', r2.uvViol === r2.matched && r2.matched > 0);
  ok('compareGeometry u beyond tol: fails', r2.pass === false);
}

// 6. edge-cell exclusion: a single differing-kind cell in the middle marks
//    its 4 neighbours (CPU-side) as edges too, on both the CPU and GPU kind
//    arrays - none of those 5 cells is "checked"; the rest of the uniform
//    grid still passes.
{
  const f = makeGeomFixture(1, 5, 1, 0, 0, 10);
  const midX = 1, midY = 1, midI = midY * COLS + midX; // interior cell, has all 4 neighbours in a 4x4 grid
  f.gbuf.kind[midI] = 4; // CPU says a different kind here (still same GPU value -> a CPU-side edge)
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('compareGeometry edge exclusion: checked < N (edges excluded)', r.kindChecked < N);
  ok('compareGeometry edge exclusion: remaining cells still 100% match', r.kindMatchPct === 100);
}

// 7. architect review 2 item 1: outsideFrac is a per-CELL fraction, not a
//    per-channel one - a single cell with all 3 fg channels + all 3 bg
//    channels outside tolerance must count as ONE cell outside, not 6.
{
  const kind = new Uint8Array(N).fill(1);
  const js = makeCells((fg, bg) => {}); // all zero
  const gpu = makeCells((fg, bg) => {
    // cell 0: every fg/bg channel far outside tolerance (6 channel-level hits, 1 cell).
    fg[0] = 200; fg[1] = 200; fg[2] = 200;
    bg[0] = 200; bg[1] = 200; bg[2] = 200;
  });
  const r = compareCells(js.fg, js.bg, gpu.fg, gpu.bg, kind, COLS, ROWS);
  ok('outsideFrac counts cells not channels', r.cellsOutside === 1);
  ok('outsideFrac is cellsOutside / nonSky', Math.abs(r.outsideFrac - 1 / N) < 1e-9);
}

// 8. architect review 2 item 2: compareGeometry counts kind-0 GPU holes
//    (CPU says non-sky, GPU says sky/kind-0) EVEN ON EDGE CELLS, and a hole
//    fails `pass` regardless of the other metrics.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  const holeI = 0; // corner cell -> also an edge cell once its kind differs, must still be counted
  f.giBuf[holeI * 4 + 1] = 0; // GPU: kind 0 (sky) where CPU says kind 1
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('holes counted even though the cell is also an edge', r.holes === 1);
  ok('a hole fails pass', r.pass === false);
}
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  const r = compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS);
  ok('no holes on identical geometry', r.holes === 0);
}

console.log(`\n[gpuCompare.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
