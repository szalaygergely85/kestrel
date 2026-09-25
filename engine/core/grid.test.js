// engine/core/grid.test.js
//
// Headless test suite for US-018 (docs/architecture.md section 16) step 4,
// range widened by D-025 (US-038a, architecture.md 22.2/22.9 S1):
// `clampGrid` (160x60..480x180, 8:3 aspect, default 240x90 on gl2). Plain
// Node ESM, no test framework, no build step. Run with:
//
//   node engine/core/grid.test.js

import { clampGrid, GRID_DEFAULT_COLS, GRID_MIN_COLS, GRID_MAX_COLS, GRID_ASPECT } from './engine.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

// ---- below the minimum clamps up to 160x60 --------------------------------
{
  const r = clampGrid(100, 38);
  ok('100 cols clamps up to 160', r.cols === 160, `cols=${r.cols}`);
  ok('rows derived from the clamped cols (160*3/8=60)', r.rows === 60, `rows=${r.rows}`);
  ok('clamped=true when the input was out of range', r.clamped === true);
}

// ---- above the maximum clamps down to 480x180 (D-025) ---------------------
{
  const r = clampGrid(500, 188);
  ok('500 cols clamps down to 480', r.cols === 480, `cols=${r.cols}`);
  ok('rows derived from the clamped cols (480*3/8=180)', r.rows === 180, `rows=${r.rows}`);
  ok('clamped=true when the input was out of range', r.clamped === true);
}

// ---- default (240x90) is in range, unclamped, rows derived ---------------
{
  const r = clampGrid(GRID_DEFAULT_COLS, Math.round(GRID_DEFAULT_COLS * GRID_ASPECT));
  ok('GRID_DEFAULT_COLS is 240 (D-009 amendment 2)', GRID_DEFAULT_COLS === 240, `GRID_DEFAULT_COLS=${GRID_DEFAULT_COLS}`);
  ok('default cols pass through unclamped', r.cols === 240, `cols=${r.cols}`);
  ok('default rows = 90 (240*3/8)', r.rows === 90, `rows=${r.rows}`);
  ok('clamped=false for an already-matching default request', r.clamped === false);
}

// ---- min/max constants match the documented range (D-025: max is now 480) -
{
  ok('GRID_MIN_COLS is 160', GRID_MIN_COLS === 160);
  ok('GRID_MAX_COLS is 480', GRID_MAX_COLS === 480);
}

// ---- a mismatched rows value (right cols, wrong aspect) is still flagged --
{
  const r = clampGrid(240, 60); // 240 cols wants 90 rows, not 60
  ok('cols in range stay as requested', r.cols === 240, `cols=${r.cols}`);
  ok('rows is always re-derived from cols, not the caller\'s value', r.rows === 90, `rows=${r.rows}`);
  ok('clamped=true when the caller\'s rows did not match the derived aspect', r.clamped === true);
}

// ---- non-integer input rounds first, then clamps --------------------------
{
  const r = clampGrid(239.6, 90);
  ok('cols rounds before clamping (239.6 -> 240)', r.cols === 240, `cols=${r.cols}`);
}

// ---- D-025's 4 documented player grids (architecture.md 22.2 §2) ----------
{
  const r = clampGrid(400, 150);
  ok('(400, 150): cols in range, rows already matches the aspect', r.cols === 400 && r.rows === 150, `cols=${r.cols} rows=${r.rows}`);
  ok('(400, 150): not clamped', r.clamped === false);
}
{
  const r = clampGrid(400, 151);
  ok('(400, 151): cols unchanged, rows re-derived to 150', r.cols === 400 && r.rows === 150, `cols=${r.cols} rows=${r.rows}`);
  ok('(400, 151): clamped=true (caller\'s rows did not match the derived aspect)', r.clamped === true);
}
{
  // 401 is in range and passes straight through, unclamped, even though it's
  // not one of the 4 "clean" player grids - rows is just round(401*3/8).
  const r = clampGrid(401);
  ok('401 -> 401x150 (cols pass through unclamped, rows = round(401*3/8))', r.cols === 401 && r.rows === 150, `cols=${r.cols} rows=${r.rows}`);
  ok('401 -> not clamped (no rows argument to disagree with the derived one)', r.clamped === false);
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
