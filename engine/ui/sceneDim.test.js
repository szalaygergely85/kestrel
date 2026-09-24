// engine/ui/sceneDim.test.js (US-015). Headless Node ESM, no framework.
// Run: node engine/ui/sceneDim.test.js
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

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
