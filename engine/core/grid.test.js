// engine/core/grid.test.js
//
// Headless test suite for US-018 (docs/architecture.md section 16) step 4:
// `clampGrid` (160x60..320x120, 8:3 aspect, default 240x90 on gl2). Plain
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

// ---- above the maximum clamps down to 320x120 -----------------------------
{
  const r = clampGrid(400, 150);
  ok('400 cols clamps down to 320', r.cols === 320, `cols=${r.cols}`);
  ok('rows derived from the clamped cols (320*3/8=120)', r.rows === 120, `rows=${r.rows}`);
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

// ---- min/max constants match the documented range ------------------------
{
  ok('GRID_MIN_COLS is 160', GRID_MIN_COLS === 160);
  ok('GRID_MAX_COLS is 320', GRID_MAX_COLS === 320);
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
