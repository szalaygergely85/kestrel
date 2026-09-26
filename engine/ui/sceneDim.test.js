// engine/ui/sceneDim.test.js (US-015). Headless Node ESM, no framework.
// Run: node engine/ui/sceneDim.test.js
import { performance } from 'node:perf_hooks';
import { createSceneDim, resetSceneDim, pushDimRect, applySceneDim } from './sceneDim.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function fakeRt(cols, rows) {
  const n = cols * rows;
  const mask = new Uint8Array(n);
  const fg = new Uint8Array(n * 4);
  const bg = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const fi = i * 4;
    fg[fi] = fg[fi + 1] = fg[fi + 2] = 200;
    bg[fi] = bg[fi + 1] = bg[fi + 2] = 100;
  }
  return { cols, rows, cells: { cols, rows, mask, fg, bg } };
}

// ---- identity: no-op when all=1 and n=0 ----
{
  const rt = fakeRt(10, 10);
  const d = createSceneDim();
  applySceneDim(rt, d);
  ok('identity: fg/bg untouched', rt.cells.fg[0] === 200 && rt.cells.bg[0] === 100);
}

// ---- d.all dims every non-mask cell ----
{
  const rt = fakeRt(4, 4);
  const d = createSceneDim();
  resetSceneDim(d);
  d.all = 0.5;
  applySceneDim(rt, d);
  const i = 5 * 4; // cell (1,1)
  ok('d.all=0.5 halves fg', rt.cells.fg[i] === 100, rt.cells.fg[i]);
  ok('d.all=0.5 halves bg', rt.cells.bg[i] === 50, rt.cells.bg[i]);
}

// ---- mask cells are skipped ----
{
  const rt = fakeRt(4, 4);
  rt.cells.mask[5] = 1; // cell (1,1)
  const d = createSceneDim();
  d.all = 0.1;
  applySceneDim(rt, d);
  const i = 5 * 4;
  ok('masked cell is untouched even at d.all=0.1', rt.cells.fg[i] === 200);
}

// ---- rect dim, min rule with d.all ----
{
  const rt = fakeRt(10, 10);
  const d = createSceneDim();
  resetSceneDim(d);
  d.all = 0.5;
  pushDimRect(d, 2, 2, 5, 5, 0.2); // darker than d.all inside the rect
  applySceneDim(rt, d);
  const inside = (5) * 10 + 3; // (3,5)? let's use (3,3)
  const iInside = 3 * 10 + 3;
  const iOutside = 8 * 10 + 8;
  ok('inside the rect: min(all, rectMul) = 0.2 wins', Math.abs(rt.cells.fg[iInside * 4] - 40) <= 1, rt.cells.fg[iInside * 4]);
  ok('outside the rect: d.all=0.5 applies', rt.cells.fg[iOutside * 4] === 100, rt.cells.fg[iOutside * 4]);
}

// ---- overflow: more than 4 rects drops the rest, warns once (doesn't throw) ----
{
  const d = createSceneDim();
  resetSceneDim(d);
  for (let i = 0; i < 6; i++) pushDimRect(d, 0, 0, 1, 1, 0.5);
  ok('at most 4 rects kept', d.n === 4);
}

// ---- BUG-PERF-001 (c): d.all === 1, rect(s) only - bounded scan path ------
// (docs/backlog.md row 25w) `applySceneDim` used to scan the WHOLE grid even
// when the only live dim was a single small rect (a hint's plate) - never a
// correctness bug, but a real per-frame cost proportional to grid size for
// work that only ever touches a handful of cells. These prove the bounded
// scan still produces the exact same per-cell result.
{
  const rt = fakeRt(20, 20);
  const d = createSceneDim();
  resetSceneDim(d);
  pushDimRect(d, 5, 5, 8, 8, 0.2); // a small rect, d.all left at 1 (no whole-scene dim)
  applySceneDim(rt, d);
  const iInside = 6 * 20 + 6; // inside [5,8)x[5,8)
  const iOutside = 15 * 20 + 15; // far outside the rect
  const iEdgeJustOutside = 5 * 20 + 8; // (8,5): x==8 is the half-open rect's exclusive edge
  ok('rect-only (d.all=1): inside the rect is dimmed', Math.abs(rt.cells.fg[iInside * 4] - 40) <= 1, rt.cells.fg[iInside * 4]);
  ok('rect-only (d.all=1): outside the rect is untouched', rt.cells.fg[iOutside * 4] === 200, rt.cells.fg[iOutside * 4]);
  ok('rect-only (d.all=1): the rect\'s own exclusive edge is untouched', rt.cells.fg[iEdgeJustOutside * 4] === 200, rt.cells.fg[iEdgeJustOutside * 4]);
}

// ---- overlapping rects (d.all=1): the min mul wins, never a double-multiply ----
{
  const rt = fakeRt(20, 20);
  const d = createSceneDim();
  resetSceneDim(d);
  pushDimRect(d, 2, 2, 10, 10, 0.5);
  pushDimRect(d, 6, 6, 14, 14, 0.2); // overlaps the first in [6,10)x[6,10)
  applySceneDim(rt, d);
  const iOverlap = 7 * 20 + 7; // inside both rects
  const iFirstOnly = 3 * 20 + 3; // inside only the first rect
  const iSecondOnly = 12 * 20 + 12; // inside only the second rect
  // A double-multiply bug would land at 200*0.5*0.2=20, not min(0.5,0.2)=0.2 -> 40.
  ok('overlap: min(0.5, 0.2) applied once, not multiplied twice', Math.abs(rt.cells.fg[iOverlap * 4] - 40) <= 1, rt.cells.fg[iOverlap * 4]);
  ok('first-rect-only region: 0.5 applied', Math.abs(rt.cells.fg[iFirstOnly * 4] - 100) <= 1, rt.cells.fg[iFirstOnly * 4]);
  ok('second-rect-only region: 0.2 applied', Math.abs(rt.cells.fg[iSecondOnly * 4] - 40) <= 1, rt.cells.fg[iSecondOnly * 4]);
}

// ---- a rect outside/overhanging the grid never throws or underflows ------
{
  const rt = fakeRt(10, 10);
  const d = createSceneDim();
  resetSceneDim(d);
  pushDimRect(d, -50, -50, -40, -40, 0.2); // entirely outside, negative
  pushDimRect(d, 8, 8, 200, 200, 0.3); // hangs off the far edge
  let threw = false;
  try { applySceneDim(rt, d); } catch (e) { threw = true; }
  ok('out-of-range rects do not throw', !threw);
  ok('the on-grid corner of the overhanging rect still dims', Math.abs(rt.cells.fg[(9 * 10 + 9) * 4] - 60) <= 1, rt.cells.fg[(9 * 10 + 9) * 4]);
}

// ---- bounded-scan perf: a small rect on a big grid must be far cheaper than
// a real whole-scene dim (d.all < 1) on the same grid - proves the scan is
// actually bounded to the rect(s), not silently walking the full grid again.
// A relative comparison (not an absolute ms budget) so this stays reliable
// across machines: the bounded path should be at least 10x cheaper here.
{
  const rt = fakeRt(320, 120);
  const dRectOnly = createSceneDim();
  const dFull = createSceneDim();

  function timeIt(fn, iters) {
    for (let i = 0; i < 50; i++) fn(); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn();
    return (performance.now() - t0) / iters;
  }

  const rectMs = timeIt(() => {
    resetSceneDim(dRectOnly);
    pushDimRect(dRectOnly, 10, 50, 60, 56, 0.35); // a small hint-plate-sized rect
    applySceneDim(rt, dRectOnly);
  }, 400);

  const fullMs = timeIt(() => {
    resetSceneDim(dFull);
    dFull.all = 0.35; // a real whole-scene dim (the map card)
    applySceneDim(rt, dFull);
  }, 400);

  ok('rect-only dim is at least 10x cheaper than a whole-scene dim on the same grid',
    rectMs * 10 < fullMs, `rectMs=${rectMs.toFixed(4)} fullMs=${fullMs.toFixed(4)}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
