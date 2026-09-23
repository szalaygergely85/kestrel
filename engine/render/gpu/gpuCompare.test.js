// engine/render/gpu/gpuCompare.test.js (US-029 tech notes item 10).
// Pure `compareCells` checks: edge-cell exclusion, tolerance edges 4 vs 5,
// PASS/FAIL rule. Run: node engine/render/gpu/gpuCompare.test.js
import { compareCells } from './gpuCompare.js';

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

console.log(`\n[gpuCompare.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
