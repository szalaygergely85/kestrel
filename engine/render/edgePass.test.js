// engine/render/edgePass.test.js - US-040 arch review 1 item 4 (15.2 item 8):
// kind-8 (KIND_MODEL) edge/rim rules. Node ESM, no framework, `ok()` style
// matching engine/voxel/voxel.test.js. Run:
//
//   node engine/render/edgePass.test.js

import { GBuffer, KIND_MODEL, KIND_WALL, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U } from './GBuffer.js';
import { edgePass, RULE_CAP, RULE_SIDE } from './edgePass.js';
import detailPassMod from '../../design/detail-pass.js';

globalThis.window = globalThis.window || globalThis;
detailPassMod;
const DP = globalThis.ASSETS.detailPass;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const COLS = 3, ROWS = 3;

// A minimal render-target stand-in: `rt.cells` with the 4 typed arrays
// edgePass.js reads/writes (glyphIdx, fg, bg), `rt.gpuActive` off.
function makeRt() {
  const n = COLS * ROWS;
  return {
    gpuActive: false,
    cells: { glyphIdx: new Uint8Array(n), fg: new Uint8Array(n * 4), bg: new Uint8Array(n * 4) },
  };
}

function idx(x, y) { return y * COLS + x; }

// ---- 1. kind-8 face E, sky to the left -> RULE_SIDE ------------------------
{
  const gbuf = new GBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(2);
  // Middle row: (0,1) sky, (1,1) model face E, (2,1) model face E (same
  // planeId/depth as (1,1) so it can never itself read as "farther").
  // Every OTHER cell (rows 0 and 2) is the SAME model/planeId/depth as (1,1)
  // directly above/below it, so the CAP/LIP checks (which run before SIDE)
  // never fire here.
  for (let y = 0; y < ROWS; y++) {
    gbuf.kind[idx(1, y)] = KIND_MODEL; gbuf.face[idx(1, y)] = FACE_E; gbuf.planeId[idx(1, y)] = 1;
    gbuf.kind[idx(2, y)] = KIND_MODEL; gbuf.face[idx(2, y)] = FACE_E; gbuf.planeId[idx(2, y)] = 2;
  }
  // (0, y) stays kind 0 (sky) for every row - the left neighbour of (1,y).
  const rt = makeRt();
  rt.cells.fg.fill(200);
  rt.cells.bg.fill(150);
  edgePass(gbuf, depth, rt, DP.edges);
  ok('kind-8 face E with sky to the left: RULE_SIDE', gbuf.rule[idx(1, 1)] === RULE_SIDE);
}

// ---- 2. kind-8 face U, sky above -> RULE_CAP --------------------------------
{
  const gbuf = new GBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(2);
  // (1,0) sky (row 0 = top = "up" neighbour of row 1). (1,1) model face U.
  gbuf.kind[idx(1, 1)] = KIND_MODEL; gbuf.face[idx(1, 1)] = FACE_U; gbuf.planeId[idx(1, 1)] = 1;
  // Row 2 (the "dn" neighbour) same plane/kind so LIP can't win instead.
  gbuf.kind[idx(1, 2)] = KIND_MODEL; gbuf.face[idx(1, 2)] = FACE_U; gbuf.planeId[idx(1, 2)] = 1;
  const rt = makeRt();
  edgePass(gbuf, depth, rt, DP.edges);
  ok('kind-8 face U with sky above: RULE_CAP', gbuf.rule[idx(1, 1)] === RULE_CAP);
}

// ---- 3. modelRim multiplies fg AND bg, kind-8 rule cells only --------------
{
  const gbuf = new GBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(2);
  // Cell (1,1): kind 8, face E, sky to the left (0,1) -> RULE_SIDE, as in
  // test 1. Cell (1,0) [reuse row 0 as a second column instead]... build a
  // 2-cell scenario side by side: (1,1) model, (2,1) wall (KIND_WALL), both
  // get sky to their own left and otherwise-matching neighbours so both
  // land on RULE_SIDE, to compare the rim's effect on each kind.
  gbuf.kind[idx(1, 1)] = KIND_MODEL; gbuf.face[idx(1, 1)] = FACE_E; gbuf.planeId[idx(1, 1)] = 1;
  gbuf.kind[idx(1, 0)] = KIND_MODEL; gbuf.face[idx(1, 0)] = FACE_E; gbuf.planeId[idx(1, 0)] = 1;
  gbuf.kind[idx(1, 2)] = KIND_MODEL; gbuf.face[idx(1, 2)] = FACE_E; gbuf.planeId[idx(1, 2)] = 1;
  // Sky at (0,0)/(0,1)/(0,2), left of the whole column - the model kind-8 case.
  gbuf.kind[idx(2, 1)] = KIND_WALL; gbuf.planeId[idx(2, 1)] = 1;
  gbuf.kind[idx(2, 0)] = KIND_WALL; gbuf.planeId[idx(2, 0)] = 1;
  gbuf.kind[idx(2, 2)] = KIND_WALL; gbuf.planeId[idx(2, 2)] = 1;
  // (2,1)'s own left neighbour is (1,1), a DIFFERENT plane/kind (model, not
  // sky) - not what makes it a SIDE cell. Instead give the wall column its
  // own sky to the right (col 2 is the last column, no right neighbour) -
  // this scenario only exercises the model cell for RULE_SIDE via sky; the
  // wall comparison below (test 4) proves non-model cells are untouched by
  // modelRim in a byte-identical, before/after way instead.
  const seedFg = 200, seedBg = 150;
  const rt = makeRt();
  rt.cells.fg.fill(seedFg);
  rt.cells.bg.fill(seedBg);
  edgePass(gbuf, depth, rt, DP.edges);
  ok('setup: (1,1) landed on RULE_SIDE', gbuf.rule[idx(1, 1)] === RULE_SIDE);
  const R = DP.edges.rules.side;
  const modelRim = DP.edges.modelRim;
  ok('modelRim is < 1 in the real detail-pass config (a darkening rim)', modelRim > 0 && modelRim < 1);
  const fi = idx(1, 1) * 4;
  let expectFg = Math.round(Math.min(255, seedFg * R.gain * modelRim));
  if (expectFg < 1) expectFg = 1;
  let expectBg = Math.round(Math.min(255, seedBg * modelRim));
  if (expectBg < 1) expectBg = 1;
  ok('modelRim cell: fg = seed * rule.gain * modelRim', rt.cells.fg[fi] === expectFg, `got ${rt.cells.fg[fi]}, want ${expectFg}`);
  ok('modelRim cell: bg = seed * modelRim (no rule gain on bg)', rt.cells.bg[fi] === expectBg, `got ${rt.cells.bg[fi]}, want ${expectBg}`);
}

// ---- 4. wall cells are byte-identical with modelRim = 0.55 vs modelRim = 1 (off) ----
{
  function runWallScene(edgesCfg) {
    const gbuf = new GBuffer(COLS, ROWS);
    const depth = new Float32Array(COLS * ROWS).fill(2);
    // A KIND_WALL column with sky to its left, same SIDE-rule shape as test 1
    // but with kind 1 (wall) instead of kind 8 (model) throughout.
    for (let y = 0; y < ROWS; y++) {
      gbuf.kind[idx(1, y)] = KIND_WALL; gbuf.face[idx(1, y)] = FACE_E; gbuf.planeId[idx(1, y)] = 1;
    }
    const rt = makeRt();
    rt.cells.fg.fill(200);
    rt.cells.bg.fill(150);
    edgePass(gbuf, depth, rt, edgesCfg);
    return { rt, rule: gbuf.rule[idx(1, 1)] };
  }
  const edgesOff = { ...DP.edges, modelRim: 1 };
  const edgesOn = { ...DP.edges, modelRim: 0.55 };
  const off = runWallScene(edgesOff);
  const on = runWallScene(edgesOn);
  ok('wall setup: (1,1) landed on RULE_SIDE in both runs', off.rule === RULE_SIDE && on.rule === RULE_SIDE);
  const fgEqual = Buffer.from(off.rt.cells.fg.buffer).equals(Buffer.from(on.rt.cells.fg.buffer));
  const bgEqual = Buffer.from(off.rt.cells.bg.buffer).equals(Buffer.from(on.rt.cells.bg.buffer));
  ok('wall cells: fg byte-identical whether modelRim is 0.55 or 1 (off)', fgEqual);
  ok('wall cells: bg byte-identical whether modelRim is 0.55 or 1 (off)', bgEqual);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
