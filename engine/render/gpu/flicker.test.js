// US-030b: synthetic two-frame cases for flicker.js's pure `flickerStep`.
import { flickerStep } from './flicker.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) pass++; else { fail++; console.error('FAIL:', name); }
}

const cols = 3, rows = 3, n = cols * rows;

function makeGI(kinds, mats, pids) {
  const GI = new Uint32Array(4 * n);
  for (let i = 0; i < n; i++) {
    GI[i * 4] = pids[i];
    GI[i * 4 + 1] = (kinds[i] & 0xff) | ((mats[i] & 0xffff) << 16);
  }
  return GI;
}
function makeFg(glyphs) {
  const fg = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) fg[i * 4 + 3] = glyphs[i];
  return fg;
}

// Case 1: uniform surface, one cell's glyph changes - counts as flicker.
{
  const kinds = new Array(n).fill(1), mats = new Array(n).fill(1), pids = new Array(n).fill(5);
  const GI = makeGI(kinds, mats, pids);
  const fg0 = makeFg(new Array(n).fill(10));
  const fg1 = makeFg(new Array(n).fill(10)); fg1[4 * 4 + 3] = 11; // centre cell (1,1) changes
  const out = flickerStep(GI, fg0, GI, fg1, cols, rows, {});
  check('uniform surface: all 9 cells counted (kind/mat/pid stable, neighbours stable)', out.same === 9);
  check('uniform surface: exactly 1 changed', out.changed === 1);
  check('uniform surface: pct = 100/9', Math.abs(out.pct - (100 / 9)) < 1e-9);
  check('uniform surface: totalPct counts the same 1/9 (no key churn, no exclusion)', out.total === 9 && out.totalChanged === 1);
}

// Case 2: a moving line - the boundary cell's kind differs between frames at
// its neighbour, so it (and its neighbours) must be excluded even though the
// boundary cell itself keeps the same kind/mat/planeId.
{
  const kindsA = [1, 1, 1, 1, 1, 1, 1, 1, 1];
  const kindsB = [1, 1, 1, 1, 1, 1, 2, 2, 2]; // bottom row became kind 2 (a line moved)
  const mats = new Array(n).fill(1), pids = new Array(n).fill(5);
  const GIa = makeGI(kindsA, mats, pids);
  const GIb = makeGI(kindsB, mats, pids);
  const fg = makeFg(new Array(n).fill(10));
  const out = flickerStep(GIa, fg, GIb, fg, cols, rows, {});
  // Row 2 (bottom) cells have kind 1->2: excluded outright (pk!==ck). Row 1
  // (middle) cells are same-surface (kind 1 in both) but touch a row-2
  // neighbour whose kind changed - excluded by the 4-neighbour rule. Only
  // row 0 (top) cells, whose neighbours are row 0/1 only, survive.
  check('moving line: only the top row (3 cells) survives the edge exclusion', out.same === 3);
  check('moving line: no glyph changes among survivors', out.changed === 0);
  // Item 1: totalPct sees ALL 9 cells (no exclusion) and counts the bottom
  // row's kind flip as churn - exactly the surface-key churn the interior
  // metric above throws away.
  check('moving line: totalPct counts all 9 cells', out.total === 9);
  check('moving line: totalPct counts the 3 kind-flipped cells as changed', out.totalChanged === 3);
  check('moving line: totalPct = 100/3', Math.abs(out.totalPct - (100 / 3)) < 1e-9);
}

console.log(`[flicker.test.js] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
