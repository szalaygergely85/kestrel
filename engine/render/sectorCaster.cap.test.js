// engine/render/sectorCaster.cap.test.js (BUG-CAST-001, docs/backlog.md row
// 25c architect tech notes item 4(a)).
// Headless Node regression test for the CPU caster's solid-cell TOP-cap
// overdraw fix (castColumn, solid branch): a farther floor/step plane must
// never win over a nearer, already-drawn wall-top cap.
// No `design/` import - a small inline level fixture only.
// Run: node engine/render/sectorCaster.cap.test.js

import { loadLevel } from '../world/Level.js';
import { castScene } from './sectorCaster.js';
import { GBuffer, KIND_TOP, KIND_FLOOR } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const sector = (floorH, ceilH, solid) => ({
  floorH, ceilH, wallMat: 'stone', floorMat: 'stone', ceilMat: ceilH === 'sky' ? 'sky' : 'stone', solid: !!solid,
});

// Fixture (tech notes item 4(a)): eye 1.6 m over a -0.3 m floor, one 1.4 m
// solid cell just ahead (a thin wall-top band: the cap is only 0.2 m below
// eye height), then rising open cells behind it at 0.3/0.6/0.9/1.35 m so the
// nearest of them ('a', 1.35 m) is "nearly as high" as the cap - the exact
// shape of the bug (architect notes item 1). The camera sits close to the
// solid cell (entryDist 0.2 m) so the cap's projected row band is wide
// (tens of rows, not sub-pixel) at this grid, which is what actually
// exposes the overdraw: a narrow/degenerate cap band collapses to exactly
// `wallRowStart-1` either way and can't show the bug (verified against a
// pre-fix copy of `castColumn` while building this fixture).
const level = loadLevel({
  name: 'bug_cast_001_fixture',
  legend: {
    '.': sector(-0.3, 'sky', false),
    '#': sector(1.4, 'sky', true),
    a: sector(1.35, 'sky', false),
    b: sector(0.9, 'sky', false),
    c: sector(0.6, 'sky', false),
    d: sector(0.3, 'sky', false),
  },
  rows: ['ddd', 'ccc', 'bbb', 'aaa', '###', '...'],
  start: { x: 1.5, y: 5.2, facingDeg: 0 },
});
if (!level) throw new Error('BUG-CAST-001 fixture level failed to load');

const COLS = 160, ROWS = 150;
const rt = { cols: COLS, rows: ROWS, pxCellW: 9, pxCellH: 16 };
const gbuf = new GBuffer(COLS, ROWS);
gbuf.beginFrame();
const depth = new DepthBuffer(COLS, ROWS);
// Minimal palette stub: only `primeAmbientLight`'s reads are needed (no
// shading happens on the gbuf path - shadeSurfaces/edgePass run separately
// and aren't exercised here).
const palette = { hue: { white: [1, 1, 1] }, lights: { ambient: { color: 'white', intensity: 0.3 } } };

// Straight down the corridor (yaw 0 = north, facing the solid cell), pitch
// 0 (see fixture comment above - the wide-band reproduction doesn't need
// the notes' -20 pitch at this grid; the mechanism is identical).
const camera = { x: 1.5, y: 5.2, z: 1.6, yawDeg: 0, pitchDeg: 0 };
castScene(rt, level, camera, palette, { gbuf, depthBuffer: depth, skyFallback: false });

const x = 80; // dirX === 0 down this column - center column IS the straight-ahead ray
const entryDist = 0.2, exitDist = 1.2; // near/far distance of the solid cell's TOP cap

// Analytically known (pure projection math on the fixed camera/level
// constants above, verified against `castPlane`'s own row-clip formula
// while building this fixture): the cap's own natural row band is
// [CAP_R0, CAP_R1] = [85, 133]. BUG-CAST-001 is exactly this: pre-fix,
// `openBottom` was narrowed only to `wallRowStart-1` (133) regardless of
// where the cap plane actually started (85), leaving rows [85,87) "open"
// for the farther 'a' floor (1.35 m, nearly as high as the cap) to draw
// into instead - verified by temporarily reverting the fix (rows 85-87
// showed kind FLOOR/depth ~1.22-1.47, a farther and WRONG sample, instead
// of kind TOP/depth ~0.90-1.17).
const CAP_R0 = 85, CAP_R1 = 133;

// (a) every row in the cap's own band is GK_TOP at a depth within the
// cap's [entryDist, exitDist] (1e-6 float slop) - tech notes 4(a). This is
// the row range a farther segment overdrew pre-fix.
let capRows = 0;
for (let y = CAP_R0; y <= CAP_R1; y++) {
  const i = y * COLS + x;
  capRows += gbuf.kind[i] === KIND_TOP ? 1 : 0;
  ok(`row ${y} is GK_TOP (cap, not overdrawn by a farther plane)`, gbuf.kind[i] === KIND_TOP, `kind=${gbuf.kind[i]}`);
  if (gbuf.kind[i] === KIND_TOP) {
    const d = depth.get(x, y);
    ok(`row ${y} TOP depth within [entryDist,exitDist]`, d >= entryDist - 1e-6 && d <= exitDist + 1e-6, `depth=${d}`);
  }
}
ok('the whole cap band [CAP_R0,CAP_R1] is TOP (no overdraw)', capRows === (CAP_R1 - CAP_R0 + 1), `capRows=${capRows}`);

// (b) no cell in this column gets a depth greater than a nearer opaque
// sample's depth on the same ray: the farther 'a' floor (own range starts
// at exitDist=1.2) must never appear at a depth inside the cap's
// [entryDist, exitDist] range.
let badFloorRows = 0;
for (let y = 0; y < ROWS; y++) {
  const i = y * COLS + x;
  if (gbuf.kind[i] !== KIND_FLOOR) continue;
  const d = depth.get(x, y);
  if (d >= entryDist - 1e-6 && d <= exitDist + 1e-6) badFloorRows++;
}
ok('no farther FLOOR sample lands inside the cap\'s own depth range', badFloorRows === 0, `badFloorRows=${badFloorRows}`);

console.log(`sectorCaster.cap.test.js: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' - ' + f);
  process.exitCode = 1;
}
