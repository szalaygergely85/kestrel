// engine/render/edgePass.test.js - US-040 arch review 1 item 4 (15.2 item 8):
// kind-8 (KIND_MODEL) edge/rim rules. Node ESM, no framework, `ok()` style
// matching engine/voxel/voxel.test.js. Run:
//
//   node engine/render/edgePass.test.js

import { GBuffer, KIND_MODEL, KIND_MESH, FACE_PACKED, KIND_WALL, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U } from './GBuffer.js';
import { edgePass, edgeRules, RULE_CAP, RULE_SIDE } from './edgePass.js';
import detailPassMod from '../../design/detail-pass.js';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
detailPassMod;
const DP = globalThis.ASSETS.detailPass;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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

// ---- 5. ME-14c2: kind 9 (KIND_MESH) like a solid rotated part, rim 1 ---------
{
  for (const [face, label] of [[FACE_E, 'face E'], [FACE_PACKED, 'face 7']]) {
    const gbuf = new GBuffer(COLS, ROWS);
    const depth = new Float32Array(COLS * ROWS).fill(2);
    for (let y = 0; y < ROWS; y++) { gbuf.kind[idx(1, y)] = KIND_MESH; gbuf.face[idx(1, y)] = face; gbuf.planeId[idx(1, y)] = 1; }
    const rt = makeRt(); rt.cells.fg.fill(200); rt.cells.bg.fill(150);
    edgePass(gbuf, depth, rt, DP.edges);
    ok(`kind-9 ${label} with sky to the left: RULE_SIDE`, gbuf.rule[idx(1, 1)] === RULE_SIDE);
    const R = DP.edges.rules.side, fi = idx(1, 1) * 4;
    ok(`kind-9 ${label}: rim 1 (fg = seed * gain, bg untouched)`, rt.cells.fg[fi] === Math.round(Math.min(255, 200 * R.gain)) && rt.cells.bg[fi] === 150);
  }
  const gbuf = new GBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(2);
  gbuf.kind[idx(1, 1)] = KIND_MESH; gbuf.face[idx(1, 1)] = FACE_U; gbuf.planeId[idx(1, 1)] = 1;
  gbuf.kind[idx(1, 2)] = KIND_MESH; gbuf.face[idx(1, 2)] = FACE_U; gbuf.planeId[idx(1, 2)] = 1;
  edgePass(gbuf, depth, makeRt(), DP.edges);
  ok('kind-9 face U with sky above: RULE_CAP', gbuf.rule[idx(1, 1)] === RULE_CAP);
}

// ---- 6. PREC-04b1 (37.1 A9 item 7): edgeRules() is bit-identical to the pre-refactor decision loop ------------
{
  // Frozen copy of the loop as it was in edgePass() before the refactor (8dd8c23).
  const vert = (k, f) => k === 1 || k === 2 || k === 3 || ((k === KIND_MODEL || k === KIND_MESH) && (f === FACE_N || f === FACE_E || f === FACE_S || f === FACE_W || f === FACE_PACKED));
  const up_ = (k, f) => k === 4 || k === 5 || ((k === KIND_MODEL || k === KIND_MESH) && f === FACE_U);
  function refRules(kind, planeId, face, depth, fogF, cols, rows, fogMax, suppress) {
    const far = (i, n) => n < 0 ? false : kind[n] === 0 ? true : planeId[n] === planeId[i] ? false : depth[n] > depth[i] * 1.18 + 0.35;
    const out = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0 || fogF[i] > fogMax || (suppress && suppress[i] !== 0)) continue;
      const up = y > 0 ? i - cols : -1, dn = y < rows - 1 ? i + cols : -1, lf = x > 0 ? i - 1 : -1, rt2 = x < cols - 1 ? i + 1 : -1;
      let r = 0;
      if (far(i, up)) r = 1; else if (far(i, dn)) r = 2;
      else if (vert(kind[i], face[i]) && (far(i, lf) || far(i, rt2))) r = 3;
      else if (vert(kind[i], face[i]) && rt2 >= 0 && vert(kind[rt2], face[rt2]) && planeId[rt2] !== planeId[i]) {
        const r2 = x < cols - 2 ? i + 2 : -1;
        const dl = lf >= 0 && kind[lf] !== 0 ? depth[lf] : depth[i];
        const dr = r2 >= 0 && kind[r2] !== 0 ? depth[r2] : depth[rt2];
        if (depth[i] <= dl && depth[rt2] <= dr) r = 4; else if (depth[i] >= dl && depth[rt2] >= dr) r = 5;
      }
      if (!r && vert(kind[i], face[i]) && kind[i] !== 2 && dn >= 0 && up_(kind[dn], face[dn]) && depth[dn] <= depth[i] * 1.08) r = 6;
      if (!r && vert(kind[i], face[i]) && up >= 0 && kind[up] === 6 && depth[up] <= depth[i] * 1.08) r = 7;
      if (!r && kind[i] === 2 && up >= 0 && up_(kind[up], face[up])) r = 8;
      out[i] = r;
    }
    return out;
  }
  let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const C = 17, R = 11, N = C * R;
  let same = true, anyRule = new Set();
  for (let t = 0; t < 40 && same; t++) {
    const gbuf = new GBuffer(C, R), depth = new Float32Array(N), sup = t % 3 === 0 ? new Uint8Array(N) : null;
    for (let i = 0; i < N; i++) {
      gbuf.kind[i] = Math.floor(rnd() * 10); gbuf.face[i] = Math.floor(rnd() * 8); gbuf.planeId[i] = Math.floor(rnd() * 3);
      depth[i] = 2 + Math.floor(rnd() * 4) * 0.5; gbuf.fogF[i] = rnd();
      if (sup) sup[i] = rnd() < 0.2 ? 1 : 0;
    }
    const want = refRules(gbuf.kind, gbuf.planeId, gbuf.face, depth, gbuf.fogF, C, R, DP.edges.fogMax, sup);
    const got = new Uint8Array(N).fill(9);
    edgeRules(gbuf.kind, gbuf.planeId, gbuf.face, depth, gbuf.fogF, C, R, DP.edges.fogMax, sup, got);
    const rtx = { gpuActive: false, cells: { glyphIdx: new Uint8Array(N), fg: new Uint8Array(N * 4), bg: new Uint8Array(N * 4) } };
    edgePass(gbuf, depth, rtx, DP.edges, sup);
    for (let i = 0; i < N; i++) { if (want[i] !== got[i] || want[i] !== gbuf.rule[i]) same = false; anyRule.add(want[i]); }
  }
  ok('edgeRules == pre-refactor loop == edgePass().rule on 40 random 17x11 fixtures (with/without suppress)', same);
  ok('fixtures exercise rules 1..8', [1, 2, 3, 4, 5, 6, 7, 8].every((r) => anyRule.has(r)));
}

// ---- 7. ALPHA-01d (37.17 step d): edge:'soft' foliage cards - silhouette only, own gain; non-soft bit-identical ------------------------------
{
  const C = 9, R = 7, N = C * R;
  const build = () => {
    const gbuf = new GBuffer(C, R), depth = new Float32Array(N).fill(5), mat = gbuf.mat;
    for (let y = 1; y < R - 1; y++) for (let x = 1; x < C - 1; x++) { // a 7x5 crown block of mesh cards, sky around it
      const i = y * C + x;
      gbuf.kind[i] = KIND_MESH; gbuf.mat[i] = 2; gbuf.planeId[i] = 1 + ((x * 3 + y * 5) % 4);
      gbuf.face[i] = [FACE_N, FACE_E, FACE_U, FACE_W][(x + y) % 4];
      depth[i] = (x + y) % 3 === 0 ? 3 : (x + y) % 3 === 1 ? 5 : 9; // cards at different depths: farther() would fire inside a non-soft crown
    }
    void mat;
    return { gbuf, depth };
  };
  const soft = new Uint8Array([0, 0, 1]); // material 2 = soft
  const inner = (rule) => { let n = 0; for (let y = 2; y < R - 2; y++) for (let x = 2; x < C - 2; x++) if (rule[y * C + x]) n++; return n; };
  const ring = (rule) => { let n = 0; for (let y = 1; y < R - 1; y++) for (let x = 1; x < C - 1; x++) if ((x === 1 || y === 1 || x === C - 2 || y === R - 2) && rule[y * C + x]) n++; return n; };

  const a = build();
  const plain = new Uint8Array(N), withSoft = new Uint8Array(N), noTable = new Uint8Array(N);
  edgeRules(a.gbuf.kind, a.gbuf.planeId, a.gbuf.face, a.depth, a.gbuf.fogF, C, R, 1, null, plain);
  edgeRules(a.gbuf.kind, a.gbuf.planeId, a.gbuf.face, a.depth, a.gbuf.fogF, C, R, 1, null, withSoft, a.gbuf.mat, soft);
  edgeRules(a.gbuf.kind, a.gbuf.planeId, a.gbuf.face, a.depth, a.gbuf.fogF, C, R, 1, null, noTable, a.gbuf.mat, new Uint8Array([0, 0, 0]));
  ok('soft: a non-soft crown has inner edges (fixture sanity)', inner(plain) > 0);
  ok('soft: no table / all-zero table == today (bit-identical)', plain.every((v, i) => v === noTable[i]));
  ok('soft: crown has no inner edges', inner(withSoft) === 0);
  ok('soft: silhouette keeps outlines', ring(withSoft) > 0);
  let onlyCls = true;
  for (let i = 0; i < N; i++) if (withSoft[i] > RULE_SIDE) onlyCls = false;
  ok('soft: only cap / lip / side rules', onlyCls);
  ok('soft: top row against sky takes cap', withSoft[1 * C + 4] === RULE_CAP);

  // soft cell next to a NON-soft vertical neighbour (farther away): still a side rule against it; the non-soft cell is unchanged
  const b = build();
  for (let y = 1; y < R - 1; y++) { b.gbuf.mat[y * C + 4] = 1; b.gbuf.face[y * C + 4] = FACE_E; }
  const ruleB = new Uint8Array(N), ruleB0 = new Uint8Array(N);
  edgeRules(b.gbuf.kind, b.gbuf.planeId, b.gbuf.face, b.depth, b.gbuf.fogF, C, R, 1, null, ruleB, b.gbuf.mat, soft);
  edgeRules(b.gbuf.kind, b.gbuf.planeId, b.gbuf.face, b.depth, b.gbuf.fogF, C, R, 1, null, ruleB0);
  let nonSoftSame = true;
  for (let y = 2; y < R - 2; y++) { // the non-soft column: soft neighbours are ordinary neighbours for it
    const i = y * C + 4; if (ruleB[i] !== ruleB0[i]) nonSoftSame = false;
  }
  ok('soft: non-soft cells next to soft ones decide exactly as before', nonSoftSame);
  ok('soft: soft cells beside the non-soft column only take cap/lip/side', [3, 5].every((x) => { let g = true; for (let y = 1; y < R - 1; y++) { const r = ruleB[y * C + x]; if (r > RULE_SIDE) g = false; } return g; }));

  // gain: soft rule cells use edges.softGain (default 0.85), glyph kept; same cell with the table off uses the rule gain
  const run = (tbl, edges) => { const g = build(); const rt = makeRt2(); rt.cells.fg.fill(100); edgePass(g.gbuf, g.depth, rt, edges, null, tbl); return { rt, rule: g.gbuf.rule }; };
  function makeRt2() { return { gpuActive: false, cells: { glyphIdx: new Uint8Array(N), fg: new Uint8Array(N * 4), bg: new Uint8Array(N * 4) } }; }
  const i0 = 1 * C + 4;
  const on = run(soft, DP.edges), off = run(null, DP.edges);
  ok('soft: rule cell fg = round(100 * 0.85) with default softGain', on.rule[i0] === RULE_CAP && on.rt.cells.fg[i0 * 4] === 85, String(on.rt.cells.fg[i0 * 4]));
  ok('soft: glyph kept (cap glyph)', on.rt.cells.glyphIdx[i0] === DP.edges.rules.cap.glyph.charCodeAt(0) - 32 && on.rt.cells.glyphIdx[i0] === off.rt.cells.glyphIdx[i0]);
  ok('soft: no table -> cap gain 1.45', off.rt.cells.fg[i0 * 4] === 145);
  const on2 = run(soft, { ...DP.edges, softGain: 0.5 });
  ok('soft: edges.softGain overrides', on2.rt.cells.fg[i0 * 4] === 50);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
