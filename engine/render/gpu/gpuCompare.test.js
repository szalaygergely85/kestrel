// engine/render/gpu/gpuCompare.test.js (US-029 tech notes item 10).
// Pure `compareCells` checks: edge-cell exclusion, tolerance edges 4 vs 5,
// PASS/FAIL rule. Run: node engine/render/gpu/gpuCompare.test.js
import { compareCells, compareGeometry, compareLight, meshTiesCap } from './gpuCompare.js';
import { FACE_E } from '../GBuffer.js';
import { edgeRules } from '../edgePass.js';
import { makeOk } from '../../test/assert.js';
import { bindShading } from '../MaterialTable.js';
import palette from '../../../design/palette.js';
import detailPass from '../../../design/detail-pass.js';

// f32<->u32 bit-cast helper for building synthetic readbackGeometry() data.
const _bitBuf = new ArrayBuffer(4);
const _bitF32 = new Float32Array(_bitBuf);
const _bitU32 = new Uint32Array(_bitBuf);
function f32Bits(x) { _bitF32[0] = x; return _bitU32[0]; }

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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
function makeGeomFixture(kindVal, matVal, planeIdVal, uVal, vVal, depthVal, n = N) {
  const kind = new Uint8Array(n).fill(kindVal);
  const mat = new Uint16Array(n).fill(matVal);
  const planeId = new Int32Array(n).fill(planeIdVal);
  const u = new Float32Array(n).fill(uVal);
  const v = new Float32Array(n).fill(vVal);
  const depth = new Float32Array(n).fill(depthVal);
  const giBuf = new Uint32Array(4 * n), gaBuf = new Uint32Array(4 * n), depthBuf = new Uint32Array(4 * n);
  for (let i = 0; i < n; i++) {
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

// 5b. ARCH CHANGES item 2 (14.4 item 9): kind-7 (terrain) cells use a 1%-of-
//     depth u/v tolerance instead of the sector 1e-3 rule - the 5-step
//     bisection only resolves t to ~0.1% of t, so 1e-3 is at the resolution
//     limit for terrain. KIND_TERRAIN = 7 (engine/render/GBuffer.js).
{
  const f1 = makeGeomFixture(7, 5, 1, 10, 10, 50);
  for (let i = 0; i < N; i++) f1.gaBuf[i * 4] = f32Bits(10 + 0.9 * 0.01 * 50); // 0.9% of depth - within the 1% terrain tol
  const r1 = compareGeometry(f1.gbuf, f1.depth, f1.giBuf, f1.gaBuf, f1.depthBuf, COLS, ROWS);
  ok('compareGeometry kind-7 u within 1% terrain tol: no uv violation', r1.uvViol === 0);

  const f2 = makeGeomFixture(7, 5, 1, 10, 10, 50);
  for (let i = 0; i < N; i++) f2.gaBuf[i * 4] = f32Bits(10 + 5); // well beyond even the 1% terrain tol
  const r2 = compareGeometry(f2.gbuf, f2.depth, f2.giBuf, f2.gaBuf, f2.depthBuf, COLS, ROWS);
  ok('compareGeometry kind-7 u beyond 1% terrain tol: violation on every matched cell', r2.uvViol === r2.matched && r2.matched > 0);

  // The same 0.9% delta that a kind-7 cell tolerates would FAIL under the
  // sector kinds' 1e-3 rule (proves the two tolerances actually differ, not
  // just that both happen to pass/fail this magnitude of error).
  const f3 = makeGeomFixture(1, 5, 1, 10, 10, 50);
  f3.gaBuf.set(f1.gaBuf); // reuse the "0.9% of depth" delta, now on a sector kind
  const r3 = compareGeometry(f3.gbuf, f3.depth, f3.giBuf, f3.gaBuf, f3.depthBuf, COLS, ROWS);
  ok('compareGeometry sector kind at the terrain-tolerant delta: violation (1e-3 rule still applies)', r3.uvViol === r3.matched && r3.matched > 0);
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

// --- PREC-04b1 (architecture.md 37.1 A9): mesh coverage ties, cap, exact rule flips -----------------------
function setGpu(f, i, kindV, planeV, depthV) {
  f.giBuf[i * 4] = planeV >>> 0; f.giBuf[i * 4 + 1] = (kindV & 0xff) | (5 << 16);
  if (depthV !== undefined) f.depthBuf[i * 4] = f32Bits(depthV);
}
const geom = (f, opts) => compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, COLS, ROWS, opts);
// 9a. kind-crossing tie: JS kind 9 vs GPU kind 7 with a different planeId -> counted tie, no violation accounting for that cell.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  f.gbuf.kind[5] = 9; f.gbuf.planeId[5] = 77; setGpu(f, 5, 7, 88, 25);
  const r = geom(f);
  ok('A9 kind-9 vs kind-7 tie: counted (meshTies 1)', r.meshTies === 1 && r.meshTieCells[0] === 5 && r.meshTieMask[5] === 1);
  ok('A9 kind-crossing tie: no holes / violations', r.holes === 0 && r.geomViolCells === 0 && r.depthViol === 0);
  const g = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10); // kind 1 vs kind 7: no kind 9 on either twin
  g.gbuf.planeId[5] = 77; setGpu(g, 5, 7, 88, 25);
  ok('A9 non-kind-9 kind crossing: not a tie', geom(g).meshTies === 0);
  const h = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10); // GPU kind 9 vs JS kind 1: the other direction
  h.gbuf.planeId[5] = 77; setGpu(h, 5, 9, 88, 10);
  ok('A9 JS kind 1 vs GPU kind 9: tie (either twin)', geom(h).meshTies === 1);
  const k = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  k.gbuf.kind[5] = 9; k.gbuf.planeId[5] = 77; setGpu(k, 5, 7, 77, 25);
  ok('A9 equal planeId: not a tie', geom(k).meshTies === 0);
}
// 9b. silhouette: JS kind 9 edge cell where the GPU sees sky -> tie, not a hole; interior kind 9 vs sky and kind 1 vs sky stay holes.
{
  const f = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  f.gbuf.kind[5] = 9; f.gbuf.planeId[5] = 77; setGpu(f, 5, 0, 0);
  const r = geom(f);
  ok('A9 sky-vs-mesh silhouette cell: tie, no hole', r.meshTies === 1 && r.holes === 0);
  const g = makeGeomFixture(9, 5, 12345, 1.5, 2.5, 10);
  setGpu(g, 5, 0, 0); // interior JS kind-9 cell (all neighbours kind 9): not a silhouette
  const rg = geom(g);
  ok('A9 interior kind 9 vs sky: still a hole, no tie', rg.holes === 1 && rg.meshTies === 0);
  const e = makeGeomFixture(1, 5, 12345, 1.5, 2.5, 10);
  e.gbuf.planeId[5] = 77; setGpu(e, 5, 0, 0);
  const re = geom(e);
  ok('A9 non-kind-9 hole still fails', re.holes === 1 && re.meshTies === 0 && re.pass === false);
}
// 9c. cap formula max(4, ceil(0.03 * meshBoundaryCells)) and the boundary definition.
{
  ok('A9 cap: floor of 4', meshTiesCap(0) === 4 && meshTiesCap(100) === 4 && meshTiesCap(133) === 4);
  ok('A9 cap: ceil(0.03 * b) above the floor', meshTiesCap(134) === 5 && meshTiesCap(200) === 6 && meshTiesCap(1080) === 33);
  const mk = (nTies) => {
    const f = makeGeomFixture(9, 5, 12345, 1.5, 2.5, 10);
    for (let t = 0; t < nTies; t++) setGpu(f, t, 7, 999 + t, 10); // JS kind 9 plane 12345 vs GPU kind 7
    return geom(f);
  };
  const r4 = mk(4), r5 = mk(5);
  ok('A9 4 ties: at the cap (boundary 0 -> cap 4)', r4.meshTies === 4 && r4.meshTiesMax === 4 && r4.meshTiesOk && r4.meshBoundaryCells === 0);
  ok('A9 5 ties: over the cap -> meshTiesOk false, pass false', r5.meshTies === 5 && !r5.meshTiesOk && r5.pass === false);
  const f = makeGeomFixture(9, 5, 12345, 1.5, 2.5, 10); f.gbuf.planeId[5] = 1; f.giBuf[5 * 4] = 1;
  ok('A9 meshBoundaryCells: odd-plane cell + its 4 neighbours = 5', geom(f).meshBoundaryCells === 5);
}
// 9d. exact rule flips (edgeRules on the GPU G-buffer): excluded only when every read cell is a tie or agrees within the depth tolerance.
{
  const mkMesh = (gpuDepth4) => {
    const f = makeGeomFixture(9, 5, 1, 1.5, 2.5, 10);
    for (let i = 0; i < N; i++) { f.gbuf.planeId[i] = i + 1; f.giBuf[i * 4] = i + 1; f.giBuf[i * 4 + 1] = 9 | (FACE_E << 8) | (5 << 16); }
    f.gbuf.face = new Uint8Array(N).fill(FACE_E); f.gbuf.fogF = new Float32Array(N); f.gbuf.rule = new Uint8Array(N);
    edgeRules(f.gbuf.kind, f.gbuf.planeId, f.gbuf.face, f.depth, f.gbuf.fogF, COLS, ROWS, 1e9, null, f.gbuf.rule);
    f.depthBuf[4 * 4] = f32Bits(gpuDepth4);
    return f;
  };
  const run = (f) => geom(f, { fogMax: 1e9, suppress: null });
  const same = run(mkMesh(10));
  ok('A9 no flip when both twins agree', same.ruleFlips === 0 && same.ruleFlipsExcused === 0);
  const near = run(mkMesh(9.99)); // 0.1 % depth noise: convex (JS) vs concave (GPU) at cell 5
  ok('A9 near-equal depth flip is counted and excused', near.ruleFlips > 0 && near.ruleFlipsExcused === near.ruleFlips && near.excludeMask[5] === 1);
  const far = run(mkMesh(8)); // 20 % depth difference on a read cell: a real disagreement
  ok('A9 flip reading a real depth mismatch is NOT excused', far.ruleFlips > 0 && far.ruleFlipsExcused < far.ruleFlips && far.excludeMask[5] === 0);
  const jsC = makeCells(() => {}), gpuC = makeCells((fg) => { fg[5 * 4] = 200; });
  const kindU = new Uint8Array(N).fill(1);
  const mask = new Uint8Array(N); mask[5] = 1;
  ok('A9 compareCells: excludeMask drops the cell from the colour counts', compareCells(jsC.fg, jsC.bg, gpuC.fg, gpuC.bg, kindU, COLS, ROWS, undefined, undefined, 0, 64, false, mask).cellsOutside === 0);
  ok('A9 compareCells: the same cell without the mask counts', compareCells(jsC.fg, jsC.bg, gpuC.fg, gpuC.bg, kindU, COLS, ROWS, undefined, undefined, 0, 64, false, null).cellsOutside === 1);
}
// 9e. a real violation on a NON-tie kind-9 cell (same planeId, wrong depth) is still counted.
{
  const f = makeGeomFixture(9, 5, 12345, 1.5, 2.5, 10);
  f.depthBuf[5 * 4] = f32Bits(14);
  const r = geom(f);
  ok('A9 non-tie kind-9 depth violation still counted', r.depthViol === 1 && r.meshTies === 0 && r.pass === false);
}

// PREC-04b2 A5: AO's precision bound applies only to equal planes; real differences still count.
{
  const makeAo = (plane, dao) => {
    const f = makeGeomFixture(2, 5, 123, 2.126031, 0.5, 27.6);
    f.gbuf.face = new Uint8Array(N); f.gbuf.aoD = new Float32Array(N).fill(0.873968);
    for (let i = 0; i < N; i++) f.gaBuf[i * 4 + 3] = f32Bits(f.gbuf.aoD[i]);
    f.giBuf[5 * 4] = plane; f.gaBuf[5 * 4 + 3] = f32Bits(f.gbuf.aoD[5] + dao);
    f.gaBuf[5 * 4] = f32Bits(f.gbuf.u[5] - 0.0012);
    return geom(f);
  };
  ok('A5 same plane, depth 27.6, dao .0012: no AO violation', makeAo(123, 0.0012).aoViol === 0);
  ok('A5 different plane keeps old AO bound', makeAo(124, 0.0012).aoViol === 1);
  ok('A5 du within uvTol but dao over uvTol counts', makeAo(123, 0.028).aoViol === 1);
}
// A9 item 4: real grid-material oracle, including failures that must never be excused.
{
  const table = bindShading(palette, detailPass, 1), id = table.idFor('stone');
  const boundary = table.records[id].v2.grid.v;
  const makeTexel = (n = N) => {
    const f = makeGeomFixture(2, id, 123, 0.2, boundary - 0.00005, 10, n);
    Object.assign(f.gbuf, { face: new Uint8Array(n), z: new Float32Array(n), aoD: new Float32Array(n).fill(Infinity),
      dudx: new Float32Array(n).fill(0.01), dvdx: new Float32Array(n), dudy: new Float32Array(n), dvdy: new Float32Array(n).fill(0.01) });
    for (let i = 0; i < n; i++) f.gaBuf[i * 4 + 3] = f32Bits(Infinity);
    return f;
  };
  const opts = { table, jsLight: { uniform: true, rgb: [1, 1, 1] } };
  const f = makeTexel(); f.gaBuf[5 * 4 + 1] = f32Bits(boundary + 0.00005);
  const beforeU = f.gbuf.u.slice(), beforeV = f.gbuf.v.slice(), r = geom(f, opts);
  ok('A9 course boundary dv .0001 is an oracle texel tie', r.texelTies === 1 && r.texelTieCells[0] === 5 && r.excludeMask[5] === 1);
  ok('A9 oracle restores all u/v values', f.gbuf.u.every((v, i) => v === beforeU[i]) && f.gbuf.v.every((v, i) => v === beforeV[i]));
  const js = makeCells(() => {}), wrong = makeCells((fg) => { fg[5 * 4] = 200; });
  const tieCmp = compareCells(js.fg, js.bg, wrong.fg, wrong.bg, f.gbuf.kind, COLS, ROWS, undefined, undefined, 0, 64, false, r.excludeMask);
  ok('A9 oracle exclusions report their class', tieCmp.texelTiesExcluded === 1 && tieCmp.cellsOutside === 0);
  f.gaBuf[5 * 4 + 1] = f32Bits(f.gbuf.v[5]);
  const same = geom(f, opts);
  const bad = compareCells(js.fg, js.bg, wrong.fg, wrong.bg, f.gbuf.kind, COLS, ROWS, undefined, undefined, 0, 64, false, same.excludeMask);
  ok('A9 identical uv with wrong GPU colour remains counted', same.texelTies === 0 && bad.cellsOutside === 1 && !bad.pass);
  f.gaBuf[5 * 4 + 1] = f32Bits(boundary + 0.00005);
  let zReads = 0, threw = false;
  const z = f.gbuf.z;
  f.gbuf.z = new Proxy(z, { get(target, key) {
    if (key === '5' && ++zReads === 2) throw new Error('second shade fails');
    return target[key];
  } });
  try { geom(f, opts); } catch (e) { threw = e.message === 'second shade fails'; }
  ok('A9 finally restores u/v when second shade throws', threw && f.gbuf.u[5] === beforeU[5] && f.gbuf.v[5] === beforeV[5]);
  f.gbuf.z = z;
  for (const field of ['kind', 'plane', 'mat', 'face', 'uv']) {
    const g = makeTexel(); g.gaBuf[5 * 4 + 1] = f32Bits(boundary + 0.00005);
    if (field === 'kind') g.giBuf[5 * 4 + 1] ^= 1;
    if (field === 'plane') g.giBuf[5 * 4]++;
    if (field === 'mat') g.giBuf[5 * 4 + 1] += 1 << 16;
    if (field === 'face') g.giBuf[5 * 4 + 1] |= FACE_E << 8;
    if (field === 'uv') g.gaBuf[5 * 4] = f32Bits(g.gbuf.u[5] + 0.02);
    ok('A9 unequal ' + field + ' is not a texel tie', geom(g, opts).texelTies === 0);
  }
  ok('A9 pitched oracle is disabled', geom(f, { ...opts, pitched: true }).texelTies === 0);
  for (const k of [0, 7, 8]) {
    f.gbuf.kind.fill(k); for (let i = 0; i < N; i++) f.giBuf[i * 4 + 1] = k | (id << 16);
    ok('A9 kind ' + k + ' is never a texel tie', geom(f, opts).texelTies === 0);
  }
  const capFixture = makeTexel(17);
  for (let i = 0; i < 17; i++) capFixture.gaBuf[i * 4 + 1] = f32Bits(boundary + 0.00005);
  const cap = compareGeometry(capFixture.gbuf, capFixture.depth, capFixture.giBuf, capFixture.gaBuf, capFixture.depthBuf, 17, 1, opts);
  ok('A9 17 ties exceed floor cap 16, geometry fails', cap.texelTies === 17 && cap.texelTiesMax === 16 && !cap.texelTiesOk && !cap.pass);
  const identical = new Uint8Array(17 * 4);
  ok('A9 excluded colours cannot override failed cap', !compareCells(identical, identical, identical, identical, capFixture.gbuf.kind, 17, 1, undefined, undefined, 0.01, 96, true, cap.excludeMask).pass);
  capFixture.gaBuf[16 * 4 + 1] = f32Bits(capFixture.gbuf.v[16]);
  const atCap = compareGeometry(capFixture.gbuf, capFixture.depth, capFixture.giBuf, capFixture.gaBuf, capFixture.depthBuf, 17, 1, opts);
  ok('A9 16 ties are accepted at cap', atCap.texelTies === 16 && atCap.texelTiesOk && atCap.pass);
  const large = makeTexel(3201);
  const largeCap = compareGeometry(large.gbuf, large.depth, large.giBuf, large.gaBuf, large.depthBuf, 3201, 1, opts);
  ok('A9 cap uses ceil(.005 nonSky) above floor', largeCap.texelTiesMax === 17);
  large.gbuf.kind[0] = large.gbuf.kind[1] = 0; large.giBuf[1] = large.giBuf[5] = 0;
  const nonSkyCap = compareGeometry(large.gbuf, large.depth, large.giBuf, large.gaBuf, large.depthBuf, 3201, 1, opts);
  ok('A9 cap denominator excludes sky', nonSkyCap.texelTiesMax === 16);
}

// --- ALPHA-01c (37.17 item 9): mask ties (opts.maskPose) ---------------------------------------------------------
{
  const C = 8, R = 8, n = C * R;
  const mk = () => { // JS: kind 9, planeId 77 for x < 4, 88 for x >= 4 (a mask edge between two cards at column 3|4); GPU identical
    const f = makeGeomFixture(9, 5, 77, 1.5, 2.5, 10, n);
    for (let y = 0; y < R; y++) for (let x = 4; x < C; x++) { const i = y * C + x; f.gbuf.planeId[i] = 88; f.giBuf[i * 4] = 88; }
    return f;
  };
  const g = (f, opts) => compareGeometry(f.gbuf, f.depth, f.giBuf, f.gaBuf, f.depthBuf, C, R, opts);
  const f1 = mk(); const edgeCell = 2 * C + 3; f1.giBuf[edgeCell * 4] = 88; // GPU draws the other card on the JS edge cell
  const r1 = g(f1, { maskPose: true });
  ok('ALPHA-01c mask tie: coverage tie next to a JS-side edge counts as maskTies', r1.maskTies === 1 && r1.meshTies === 1 && r1.maskTiesOk && r1.meshTiesOk);
  ok('ALPHA-01c mask tie cap: max(4, 2 % of 64 geometry cells) = 4', r1.maskTiesMax === 4);
  const f2 = mk(); const deep = 4 * C + 1; f2.giBuf[deep * 4] = 88; // JS 3x3 all equal: GPU disagreement deep inside a card = twin bug
  const r2 = g(f2, { maskPose: true });
  ok('ALPHA-01c deep disagreement is NOT a mask tie (stays a violation)', r2.maskTies === 0 && r2.meshTies === 0 && r2.planeEqual < r2.matched);
  const r3 = g(f1);
  ok('ALPHA-01c outside mask poses maskTies = 0 and the old rule applies', r3.maskTies === 0 && r3.meshTies === 1 && r3.maskTiesMax === 0);
  const f4 = mk(); for (let y = 0; y < 6; y++) { const i = y * C + 3; f4.giBuf[i * 4] = 88; } // 6 edge-cell ties > cap 4
  const r4 = g(f4, { maskPose: true });
  ok('ALPHA-01c over the cap -> maskTiesOk false, pass false', r4.maskTies === 6 && !r4.maskTiesOk && !r4.meshTiesOk && r4.pass === false);
}

console.log(`\n[gpuCompare.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }

// EMIS-03/04: compareGlow - twin vs a "GPU" output equal to the twin passes; a flipped byte beyond tol 1 fails; vacuous (no emissive) fails.
{
  const { compareGlow: cg } = await import('./gpuCompare.js');
  const { glowFrame: gf, GLOW_LEVELS: GL } = await import('../glow.js');
  const cols = 8, rows = 5, n = cols * rows, kind = new Uint8Array(n).fill(1), mat = new Uint16Array(n), depth = new Float32Array(n).fill(5);
  mat[2 * cols + 3] = 1;
  const emis = new Float32Array([0, 1]);
  const fgIn = new Uint8Array(n * 4).fill(100), bgIn = new Uint8Array(n * 4).fill(20);
  for (let i = 0; i < n; i++) { fgIn[i * 4 + 3] = 40; bgIn[i * 4 + 3] = 255; }
  const P = GL.high, oF = new Uint8Array(n * 4), oB = new Uint8Array(n * 4);
  gf({ kind, mat, depth }, cols, rows, emis, fgIn, bgIn, oF, oB, P);
  const ok1 = cg({ kind, mat, depth }, cols, rows, emis, fgIn, bgIn, oF, oB, P);
  if (!ok1.ok) throw new Error('compareGlow: identical output must pass ' + JSON.stringify(ok1));
  const bad = new Uint8Array(oF); bad[(2 * cols + 4) * 4] += 5;
  if (cg({ kind, mat, depth }, cols, rows, emis, fgIn, bgIn, bad, oB, P).fg.ok) throw new Error('compareGlow: +5 byte must fail');
  if (cg({ kind, mat, depth }, cols, rows, new Float32Array([0, 0]), fgIn, bgIn, fgIn, bgIn, P).ok) throw new Error('compareGlow: vacuous pose must fail');
  console.log('compareGlow checks OK');
}
