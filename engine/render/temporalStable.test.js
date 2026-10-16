// engine/render/temporalStable.test.js (US-073a, docs/architecture.md 38.25): pitched/ortho temporal-stability JS twin.
// Synthetic wall plane in front of the camera; static / 1-cell pan / cut / tie mask / reject rules / ortho / 0 alloc.
// Re-spawns itself with the frameAlloc flags (big semi-space, sync tier-up) like horizonAo.alloc.test.js.
// Run: node engine/render/temporalStable.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { encodeLevelByte, levelOfByte, covOfByte, vmTagOf, beginFrame, stabilize, createStableState, createStableBuffers, CHANNEL_SNAP, LEVEL_ANIM, LEVEL_NONE, UV_LIM_TEXELS, DEFAULT_DETAIL, uvDriftLimit, grazeUvLimit, GRAZE_K, GRAZE_CAP } from './temporalStable.js';
import { KIND_NONE, KIND_WALL, KIND_MODEL, KIND_MESH } from './GBuffer.js';
import { makeOk } from '../test/assert.js';

const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--max-semi-space-size=64', '--min-semi-space-size=64', '--no-concurrent-recompilation'];
if (typeof global.gc !== 'function' || !process.execArgv.includes(FLAGS[1])) {
  const res = spawnSync(process.execPath, [...FLAGS, SELF], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const newUsed = () => { const s = v8.getHeapSpaceStatistics(); for (let i = 0; i < s.length; i++) if (s[i].space_name === 'new_space') return s[i].space_used_size; return 0; };

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

let ANCHOR = false; // AA-09: the older anchor tests run with the re-anchor off (identical to the old behaviour)
const COLS = 40, ROWS = 20;
const GRID = { cols: COLS, rows: ROWS, pxCellW: 8, pxCellH: 16 };
const cam0 = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };

/** Fresh input of a wall at y = -5 seen by `cam` (pitch 0): vd per cell, u = world x, v = world z. */
function wallInput(st, fgByte = 100) {
  const n = COLS * ROWS;
  const inp = {
    cols: COLS, rows: ROWS,
    kind: new Uint8Array(n).fill(KIND_WALL), planeId: new Int32Array(n).fill(1),
    u: new Float32Array(n), v: new Float32Array(n), vd: new Float32Array(n),
    level: new Uint8Array(n).fill(5), glyph: new Uint16Array(n).fill(7),
    fg: new Uint32Array(n).fill((fgByte << 16) | (fgByte << 8) | fgByte), bg: new Uint32Array(n).fill(0x101010),
  };
  const c = st.cur;
  for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
    const a = ((2 * (q + 0.5)) / COLS - 1) * c.tanHalfX, b = (1 - (2 * r) / ROWS) * c.tanHalfY;
    const dy = c.fY + a * c.rY + b * c.uY; // = -1 at pitch 0, yaw 0
    const vd = (-5 - c.eyeY) / dy, i = r * COLS + q;
    inp.vd[i] = vd;
    inp.u[i] = c.eyeX + (c.fX + a * c.rX + b * c.uX) * vd;
    inp.v[i] = c.eyeZ + (c.fZ + b * c.uZ) * vd;
  }
  return inp;
}
/** History whose glyph encodes the column and whose fg/bg match `inp` exactly (so blend == identity). */
function colHist(inp) {
  const h = createStableBuffers(COLS, ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    h.kind[i] = inp.kind[i]; h.planeId[i] = inp.planeId[i]; h.u[i] = inp.u[i]; h.v[i] = inp.v[i];
    h.level[i] = inp.level[i]; h.glyph[i] = 100 + (i % COLS); h.fg[i] = inp.fg[i]; h.bg[i] = inp.bg[i];
  }
  return h;
}
function run(st, cam, inpFn, hist, flags) {
  beginFrame(st, cam, GRID, flags);
  const inp = inpFn(st);
  const out = createStableBuffers(COLS, ROWS);
  const used = stabilize(inp, hist, out, st);
  return { inp, out, used };
}

// 1. static camera: identity (every cell takes history at its own index, nothing is a tie)
{
  const st = createStableState();
  beginFrame(st, cam0, GRID); // frame A (invalid: no prev)
  const a = wallInput(st);
  ok('first frame: histValid false', st.histValid === false);
  const h = colHist(a);
  const r = run(st, cam0, wallInput, h);
  ok('static: histValid true', st.histValid === true);
  let same = 0, ties = 0;
  for (let i = 0; i < COLS * ROWS; i++) { if (r.out.glyph[i] === h.glyph[i] && !r.out.fresh[i]) same++; ties += r.out.tie[i]; }
  ok('static: identity for all cells', same === COLS * ROWS, `${same}/${COLS * ROWS}`);
  ok('static: no ties', ties === 0, `ties ${ties}`);
  ok('static: fg unchanged (blend of equal bytes)', r.out.fg[5] === a.fg[5]);
}

// 2. 1-cell pan: cur col c shows what prev showed at c+1
{
  const st = createStableState();
  beginFrame(st, cam0, GRID);
  const a = wallInput(st);
  const h = colHist(a);
  const cellM = 2 * st.cur.tanHalfX * 5 / COLS;
  const r = run(st, { ...cam0, x: cellM }, wallInput, h);
  let good = 0, tot = 0;
  for (let rr = 2; rr < ROWS - 2; rr++) for (let c = 0; c < COLS - 1; c++) { tot++; if (!r.out.fresh[rr * COLS + c] && r.out.glyph[rr * COLS + c] === 100 + c + 1) good++; }
  ok('pan 1 cell: cells map to column +1', good === tot, `${good}/${tot}`);
  ok('pan 1 cell: last column fresh (off-grid)', r.out.fresh[5 * COLS + COLS - 1] === 1);
  // sub-cell pan 0.5: ties flagged
  const st2 = createStableState();
  beginFrame(st2, cam0, GRID);
  const h2 = colHist(wallInput(st2));
  const wideDetail = (s) => { const q = wallInput(s); q.detail = new Float32Array(COLS * ROWS).fill(1); return q; }; // lim 0.5 m: the half-cell u shift must not hide the tie
  const r2 = run(st2, { ...cam0, x: cellM * 0.5 }, wideDetail, h2);
  let ties = 0; for (let i = 0; i < COLS * ROWS; i++) ties += r2.out.tie[i];
  ok('half-cell pan: tie mask set on the half-cell cases', ties > COLS * ROWS * 0.5, `ties ${ties}`);
}

// 3. cut / invalidation: everything fresh and equals the input
{
  const mk = (flags, cam) => {
    const st = createStableState();
    beginFrame(st, cam0, GRID);
    const h = colHist(wallInput(st));
    return { st, ...run(st, cam, wallInput, h, flags), h };
  };
  for (const [name, flags, cam] of [
    ['invalidate flag', { invalidate: true }, cam0],
    ['teleport > 2 m', undefined, { ...cam0, x: 2.5 }],
    ['yaw > 3 deg', undefined, { ...cam0, yawDeg: 4 }],
    ['pitch > 3 deg', undefined, { ...cam0, pitchDeg: 4 }],
  ]) {
    const r = mk(flags, cam);
    let fresh = 0, same = 0;
    for (let i = 0; i < COLS * ROWS; i++) { fresh += r.out.fresh[i]; if (r.out.glyph[i] === r.inp.glyph[i] && r.out.fg[i] === r.inp.fg[i]) same++; }
    ok(`${name}: all fresh`, r.st.histValid === false && fresh === COLS * ROWS && same === COLS * ROWS, `fresh ${fresh} same ${same}`);
  }
  // mode change pitched -> ortho
  const st = createStableState();
  beginFrame(st, cam0, GRID);
  beginFrame(st, { ...cam0, projection: 'ortho', orthoHalfH: 5 }, GRID);
  ok('mode change: invalid', st.histValid === false);
}

// 4. per-cell rejects + integer rules
{
  const st = createStableState();
  beginFrame(st, cam0, GRID);
  const a = wallInput(st);
  const h = colHist(a);
  beginFrame(st, cam0, GRID);
  const inp = wallInput(st);
  const at = (r, c) => r * COLS + c;
  inp.kind[at(3, 3)] = KIND_NONE; inp.kind[at(3, 4)] = KIND_MODEL;
  inp.water = new Uint8Array(COLS * ROWS); inp.water[at(3, 5)] = 1;
  inp.level[at(3, 6)] = 255;
  h.level[at(3, 7)] = 255;
  inp.edge = new Uint8Array(COLS * ROWS); inp.edge[at(3, 8)] = 1;
  h.planeId[at(3, 9)] = 2;
  inp.u[at(3, 10)] += 1; // drift >> 0.5/16
  inp.vd[at(3, 11)] = 0;
  // integer rules
  inp.fg[at(4, 3)] = (100 + CHANNEL_SNAP) << 16 | 100 << 8 | 100; // diff == 48: blend; (100+148+1)>>1 = 124
  inp.fg[at(4, 4)] = (100 + CHANNEL_SNAP + 1) << 16 | 100 << 8 | 100; // diff 49: snap
  inp.level[at(4, 5)] = 6; // within one: hold glyph
  inp.level[at(4, 6)] = 7; // two apart: fresh glyph
  // AA-23 (OB-208): one channel jumps past the snap, the others move a little -> the whole colour snaps (no hue split); small moves blend all three
  h.fg[at(4, 7)] = (100 << 16) | (120 << 8) | 140; inp.fg[at(4, 7)] = (100 << 16) | ((120 + CHANNEL_SNAP + 20) << 8) | 150;
  h.fg[at(4, 8)] = (100 << 16) | (120 << 8) | 140; inp.fg[at(4, 8)] = (110 << 16) | (130 << 8) | 101;
  const out = createStableBuffers(COLS, ROWS);
  st.aaEdge = false; // AA-18 off: edge cells pass through
  stabilize(inp, h, out, st);
  const outE = createStableBuffers(COLS, ROWS);
  st.aaEdge = true; stabilize(inp, h, outE, st); st.aaEdge = false;
  ok('AA-18 aaEdge: the edge cell takes history (glyph held), other cells unchanged', outE.fresh[at(3, 8)] === 0 && outE.glyph[at(3, 8)] === h.glyph[at(3, 8)]
    && outE.glyph.every((g, k) => k === at(3, 8) || g === out.glyph[k]));
  for (const [nm, c] of [['sky', 3], ['kind 8', 4], ['water', 5], ['level 255 cur', 6], ['level 255 hist', 7], ['edge', 8], ['planeId mismatch', 9], ['uv drift', 10], ['vd 0', 11]]) {
    ok(`reject: ${nm} fresh`, out.fresh[at(3, c)] === 1 && out.glyph[at(3, c)] === inp.glyph[at(3, c)]);
  }
  ok('blend diff 48: (p+c+1)>>1', ((out.fg[at(4, 3)] >> 16) & 255) === 124, `${(out.fg[at(4, 3)] >> 16) & 255}`);
  ok('snap diff 49: cur byte', ((out.fg[at(4, 4)] >> 16) & 255) === 149);
  ok('AA-23 one channel jump: whole colour snaps (no hue split)', out.fg[at(4, 7)] === inp.fg[at(4, 7)], out.fg[at(4, 7)].toString(16));
  ok('AA-23 small moves: all three channels blend', out.fg[at(4, 8)] === ((105 << 16) | (125 << 8) | 121), out.fg[at(4, 8)].toString(16));
  { const o2 = createStableBuffers(COLS, ROWS); st.aaHue = false; stabilize(inp, h, o2, st); st.aaHue = true;
    ok('AA-23 ?aahue=0: old per-channel rule (g snaps, r/b average = hue split)', o2.fg[at(4, 7)] === ((100 << 16) | ((120 + CHANNEL_SNAP + 20) << 8) | 145)
      && o2.fg[at(4, 8)] === out.fg[at(4, 8)], o2.fg[at(4, 7)].toString(16)); }
  ok('glyph held within one level', out.glyph[at(4, 5)] === h.glyph[at(4, 5)] && out.level[at(4, 5)] === 5);
  ok('glyph fresh at two levels', out.glyph[at(4, 6)] === inp.glyph[at(4, 6)] && out.level[at(4, 6)] === 7 && out.fresh[at(4, 6)] === 0);
}

// 38.25 amendment: UV limit 1.0/detail (boundary 0.99 / 1.01), level 254 'animated', mixed/both-255 rules, fg-snap re-roll, anchor u/v
{
  const LIM = UV_LIM_TEXELS / DEFAULT_DETAIL, at = (r, c) => r * COLS + c;
  ok('UV limit constant is 1.0/detail', UV_LIM_TEXELS === 1 && LIM === 0.0625);
  // setup: static camera, history = frame A exactly; `mut(inp, hist)` edits cells, then one stabilize
  const once = (mut, flags) => {
    const st = createStableState(); st.footK = 0; st.aaAnchor = ANCHOR; st.aaGraze = false; // AA-20 graze limit tested on its own below
    beginFrame(st, cam0, GRID);
    const h = colHist(wallInput(st));
    beginFrame(st, cam0, GRID, flags);
    const inp = wallInput(st);
    mut(inp, h);
    const out = createStableBuffers(COLS, ROWS);
    const used = stabilize(inp, h, out, st);
    return { inp, h, out, used, st };
  };
  const r = once((inp, h) => {
    inp.u[at(5, 5)] = h.u[at(5, 5)] + 0.99 * LIM; // inside: takes history
    inp.u[at(5, 6)] = h.u[at(5, 6)] + 1.01 * LIM; // outside: fresh
    inp.u[at(5, 7)] = h.u[at(5, 7)] + 0.7 * LIM; // old limit was 0.5*LIM: now still history
  });
  ok('uv 0.99 x lim takes history', r.out.fresh[at(5, 5)] === 0);
  ok('uv 1.01 x lim fresh', r.out.fresh[at(5, 6)] === 1);
  ok('uv 0.7 x lim takes history (was fresh at 0.5/detail)', r.out.fresh[at(5, 7)] === 0);

  const r2 = once((inp, h) => {
    // both-255 hold: row 2
    for (const c of [3, 4, 5, 6, 7, 8]) { inp.level[at(2, c)] = LEVEL_NONE; h.level[at(2, c)] = LEVEL_NONE; inp.u[at(2, c)] = h.u[at(2, c)] + 0.3 * LIM; }
    // (2,4) fg snaps (diff 49 on one channel): glyph fresh
    inp.fg[at(2, 4)] = ((100 + CHANNEL_SNAP + 1) << 16) | (100 << 8) | 100;
    // (2,5) fg diff exactly snap (48): still held
    inp.fg[at(2, 5)] = ((100 + CHANNEL_SNAP) << 16) | (100 << 8) | 100;
    // (2,6) animated 254 on cur, (2,7) 254 in history, (2,8) mixed: cur 255 hist ramp
    inp.level[at(2, 6)] = LEVEL_ANIM; h.level[at(2, 7)] = LEVEL_ANIM; h.level[at(2, 8)] = 5;
    // ramp hold with drift: row 3
    inp.u[at(3, 3)] = h.u[at(3, 3)] + 0.3 * LIM;
  });
  const o = r2.out, H = r2.h, I = r2.inp;
  ok('both-255 static-ish: glyph held, used', o.fresh[at(2, 3)] === 0 && o.glyph[at(2, 3)] === H.glyph[at(2, 3)] && o.level[at(2, 3)] === LEVEL_NONE && o.held255[at(2, 3)] === 1);
  ok('both-255 hold writes the HISTORY anchor u/v', o.u[at(2, 3)] === H.u[at(2, 3)] && o.v[at(2, 3)] === H.v[at(2, 3)] && o.u[at(2, 3)] !== I.u[at(2, 3)]);
  ok('ramp hold writes the CURRENT u/v', o.glyph[at(3, 3)] === H.glyph[at(3, 3)] && o.u[at(3, 3)] === I.u[at(3, 3)] && o.held255[at(3, 3)] === 0);
  ok('both-255 fg snap: glyph fresh, colours snapped to cur, history still used', o.fresh[at(2, 4)] === 0 && o.glyph[at(2, 4)] === I.glyph[at(2, 4)]
    && ((o.fg[at(2, 4)] >> 16) & 255) === 149 && o.u[at(2, 4)] === I.u[at(2, 4)] && o.held255[at(2, 4)] === 0);
  ok('both-255 fg diff == snap: still held (blend)', o.glyph[at(2, 5)] === H.glyph[at(2, 5)] && ((o.fg[at(2, 5)] >> 16) & 255) === 124);
  ok('level 254 on cur: fresh', o.fresh[at(2, 6)] === 1 && o.glyph[at(2, 6)] === I.glyph[at(2, 6)] && o.level[at(2, 6)] === LEVEL_ANIM);
  ok('level 254 in history: fresh', o.fresh[at(2, 7)] === 1 && o.glyph[at(2, 7)] === I.glyph[at(2, 7)]);
  ok('mixed 255 cur / ramp hist: fresh', o.fresh[at(2, 8)] === 1 && o.glyph[at(2, 8)] === I.glyph[at(2, 8)]);
  ok('reject order: 254 never marks a tie', o.tie[at(2, 6)] === 0);
  ok('hsrc = history cell on a reached lookup, -1 before', o.hsrc[at(2, 3)] === at(2, 3) && r2.out.hsrc[at(2, 6)] === -1);

  // slow-moving surface: u advances 0.3*lim per frame; the anchor stays on the first u, so the hold ends after 3 frames
  const st = createStableState(); st.footK = 0; st.aaAnchor = false; st.aaGraze = false;
  beginFrame(st, cam0, GRID);
  const a0 = wallInput(st);
  a0.level.fill(LEVEL_NONE);
  let hist = colHist(a0), out = createStableBuffers(COLS, ROWS);
  const u0 = a0.u[at(10, 10)];
  const seq = [];
  for (let k = 1; k <= 5; k++) {
    beginFrame(st, cam0, GRID);
    const inp = wallInput(st); inp.level.fill(LEVEL_NONE);
    for (let i = 0; i < COLS * ROWS; i++) inp.u[i] = a0.u[i] + k * 0.3 * LIM;
    stabilize(inp, hist, out, st);
    seq.push(out.glyph[at(10, 10)] === hist.glyph[at(10, 10)] ? 'hold' : 'fresh');
    if (k === 4) ok('anchor kept across frames', out.u[at(10, 10)] === u0 || seq[3] === 'fresh');
    const t = hist; hist = out; out = t.glyph ? t : createStableBuffers(COLS, ROWS);
    if (seq[seq.length - 1] === 'fresh') break;
  }
  ok('slow drift: held 3 frames, refreshed once cumulative drift >= lim', seq.join() === 'hold,hold,hold,fresh', seq.join());
}

// 4b. AA-09: re-anchor of a both-255 hold on a static surface
{
  const LIM = UV_LIM_TEXELS / DEFAULT_DETAIL, at = (r, c) => r * COLS + c;
  const slide = (aaAnchor, kind, frames = 40, fgStep = 0, aaVox = true) => {
    const st = createStableState(); st.footK = 0; st.aaAnchor = aaAnchor; st.aaVox = aaVox;
    beginFrame(st, cam0, GRID);
    const mk = (k) => { const inp = wallInput(st); inp.level.fill(LEVEL_NONE); inp.kind.fill(kind); for (let i = 0; i < COLS * ROWS; i++) { inp.u[i] += k * 0.3 * LIM; inp.glyph[i] = 7 + k; if (fgStep) { const b = (100 + k * fgStep) & 255; inp.fg[i] = (b << 16) | (b << 8) | b; } } return inp; };
    let hist = createStableBuffers(COLS, ROWS), out = createStableBuffers(COLS, ROWS);
    stabilize(mk(0), createStableBuffers(COLS, ROWS), hist, st); // frame 0: invalid
    const g0 = hist.glyph[at(10, 10)];
    let held = 0, fresh = 0;
    for (let k = 1; k <= frames; k++) {
      beginFrame(st, cam0, GRID);
      stabilize(mk(k), hist, out, st);
      if (out.glyph[at(10, 10)] === g0) held++; else fresh++;
      const t = hist; hist = out; out = t;
    }
    return { held, fresh };
  };
  const on = slide(true, KIND_WALL), off = slide(false, KIND_WALL), mdl = slide(true, 8, 40, 0, false), mdlV = slide(true, 8), msh = slide(true, KIND_MESH);
  ok('AA-09 aaAnchor on: static surface panned 40 x 0.3*lim holds all frames', on.held === 40, JSON.stringify(on));
  ok('AA-09 aaAnchor off: refreshes after cumulative drift (old behaviour)', off.fresh > 5 && off.held < 40, JSON.stringify(off));
  ok('AA-09 model (kind 8) with aaVox off keeps the old anchor: refreshes', mdl.fresh > 5, JSON.stringify(mdl));
  ok('AA-21 aaVox: world voxel prop (kind 8, same plane+material) re-anchors and holds', mdlV.held === 40, JSON.stringify(mdlV));
  ok('AA-09 mesh with same plane+material re-anchors', msh.held === 40, JSON.stringify(msh));
  const snap = slide(true, KIND_WALL, 6, 60);
  ok('AA-09 fg snap still re-rolls the glyph', snap.fresh === 6, JSON.stringify(snap));
}

// 5. ortho pose: static identity, 1-cell pan
{
  const orthoCam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0, projection: 'ortho', orthoHalfH: 3 };
  // ortho wall: u/v from the unprojected point, vd = distance to the plane y = -5 along F from the eye plane
  const orthoInput = (st) => {
    const inp = wallInput(st);
    const c = st.cur;
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const a = ((2 * (q + 0.5)) / COLS - 1) * c.tanHalfX, b = (1 - (2 * r) / ROWS) * c.tanHalfY;
      const i = r * COLS + q, vd = (-5 - (c.eyeY + a * c.rY + b * c.uY)) / c.fY;
      inp.vd[i] = vd; inp.u[i] = c.eyeX + a * c.rX + b * c.uX + vd * c.fX; inp.v[i] = c.eyeZ + b * c.uZ + vd * c.fZ;
    }
    return inp;
  };
  const st = createStableState();
  beginFrame(st, orthoCam, GRID);
  const h = colHist(orthoInput(st));
  const r = run(st, orthoCam, orthoInput, h);
  let same = 0; for (let i = 0; i < COLS * ROWS; i++) if (!r.out.fresh[i] && r.out.glyph[i] === h.glyph[i]) same++;
  ok('ortho static: identity', same === COLS * ROWS, `${same}`);
  const cellM = 2 * st.cur.tanHalfX / COLS;
  const r2 = run(st, { ...orthoCam, x: cellM }, orthoInput, r.out);
  let good = 0, tot = 0;
  for (let rr = 2; rr < ROWS - 2; rr++) for (let c = 0; c < COLS - 1; c++) { tot++; if (!r2.out.fresh[rr * COLS + c] && r2.out.glyph[rr * COLS + c] === r.out.glyph[rr * COLS + c + 1]) good++; }
  ok('ortho pan 1 cell: maps to column +1', good === tot, `${good}/${tot}`);
}

// 6. zero allocation over 1e4 frames (ping-pong buffers, camera wobbling inside the history window)
{
  const st = createStableState();
  let A = createStableBuffers(COLS, ROWS), B = createStableBuffers(COLS, ROWS);
  beginFrame(st, cam0, GRID);
  const inp = wallInput(st);
  const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
  function frame(i) {
    cam.x = 0.001 * (i & 7);
    beginFrame(st, cam, GRID, i % 500 === 0 ? { invalidate: true } : undefined);
    stabilize(inp, A, B, st);
    const t = A; A = B; B = t;
  }
  const WARM = 300, CALLS = 10000;
  for (let i = 0; i < WARM; i++) frame(i);
  global.gc();
  const h0 = newUsed();
  for (let i = 0; i < CALLS; i++) frame(i);
  const per = (newUsed() - h0) / CALLS;
  // The stabilize loop itself allocates 0; the garbage is projection.js pitchedTerms boxing ~30 double fields (~440 B/call, measured
  // standalone) plus copyTerms. Short-lived new-space garbage, budget 1 KB/frame (frameAlloc budget is 16 KB), and nothing retained.
  ok('1e4 frames: garbage < 1 KB/frame (pitchedTerms boxing only)', per < 1024, `${per.toFixed(1)} B/frame`);
  global.gc();
  const r0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) frame(i);
  global.gc();
  ok('no retained heap growth', process.memoryUsage().heapUsed - r0 < 64 * 1024);
  // stabilize alone (terms fixed): true zero
  beginFrame(st, cam, GRID);
  for (let i = 0; i < WARM; i++) stabilize(inp, A, B, st);
  global.gc();
  const s0 = newUsed();
  for (let i = 0; i < CALLS; i++) stabilize(inp, A, B, st);
  const per2 = (newUsed() - s0) / CALLS;
  ok('stabilize(): 0 alloc over 1e4 frames', per2 < 16, `${per2.toFixed(2)} B/frame`);
}

// US-073c: beginFrame(st, cam, grid, flags, terms) with the raster pass's terms == the self-computed path (cur/prev/dEye/histValid), device path only
{
  const { createPitchedTerms, pitchedTerms } = await import('./projection.js');
  const a = createStableState(), b = createStableState(), tm = createPitchedTerms();
  const grid = { cols: 160, rows: 60, pxCellW: 8, pxCellH: 16 };
  let same = true;
  for (let i = 0; i < 4; i++) {
    const cam = { x: 10 + i * 0.3, y: 20, z: 1.6, yawDeg: i * 0.5, pitchDeg: -20 };
    const va = beginFrame(a, cam, grid, null), vb = beginFrame(b, cam, grid, null, pitchedTerms(cam, grid, tm));
    for (const k of ['fX', 'fY', 'fZ', 'rX', 'rY', 'uX', 'uY', 'uZ', 'tanHalfX', 'tanHalfY', 'eyeX', 'eyeY', 'eyeZ']) if (a.cur[k] !== b.cur[k] || a.prev[k] !== b.prev[k]) same = false;
    if (va !== vb || a.dEx !== b.dEx || a.dEy !== b.dEy || a.dEz !== b.dEz) same = false;
  }
  ok('beginFrame with precomputed terms == own pitchedTerms (cur, prev, dEye, validity)', same);
}

console.log(`${pass} passed, ${fail} failed.`);
// AA-07a: view-model cells (kind 8, GI.w >= 0xFFF8) take history from the SAME cell, key objectId + mat; the +-1 level hold applies
{
  const st = createStableState();
  beginFrame(st, cam0, GRID); const a = wallInput(st); a.kind.fill(KIND_MODEL);
  const n = COLS * ROWS, VM = 0xFFFF - 2; // hand 2
  const h = colHist(a); h.vm.fill(vmTagOf(VM)); h.mat.fill(7);
  beginFrame(st, { ...cam0, yawDeg: 0.5, x: 0.2 }, GRID); // the camera moves a little: the view model must NOT be reprojected
  const mk = (oid, mat, lvl) => { const b = wallInput(st); b.kind.fill(KIND_MODEL); b.objectId = new Uint32Array(n).fill(oid); b.mat = new Uint16Array(n).fill(mat); b.level.fill(lvl);
    b.u.set(a.u); b.v.set(a.v); b.fg.set(a.fg); return b; };
  const at = 10 * COLS + 20;
  let out = createStableBuffers(COLS, ROWS); stabilize(mk(VM, 7, 6), h, out, st);
  ok('AA-07a: view-model cell, level +1, same object/mat -> held (history glyph, history level)', out.fresh[at] === 0 && out.glyph[at] === 100 + 20 && out.level[at] === 5 && out.hsrc[at] === at);
  ok('AA-07a: view-model history is tagged', out.vm[at] === vmTagOf(VM) && vmTagOf(VM) === 3 && vmTagOf(100) === 0);
  out = createStableBuffers(COLS, ROWS); stabilize(mk(VM + 1, 7, 6), h, out, st);
  ok('AA-07a: a different object drops the history', out.fresh[at] === 1 && out.glyph[at] === 7);
  out = createStableBuffers(COLS, ROWS); stabilize(mk(VM, 8, 6), h, out, st);
  ok('AA-07a: a different material drops the history', out.fresh[at] === 1);
  out = createStableBuffers(COLS, ROWS); stabilize(mk(VM, 7, 8), h, out, st);
  ok('AA-07a: level +3 switches', out.fresh[at] === 0 && out.glyph[at] === 7);
  st.aaVm = false; out = createStableBuffers(COLS, ROWS); stabilize(mk(VM, 7, 6), h, out, st);
  ok('AA-07a: ?aavm=0 -> kind 8 always fresh', out.fresh[at] === 1 && out.vm[at] === 0);
}
// AA-07a: a world kind-8 prop (no view-model id) uses the material key across a plane change, with the normal reprojection
{
  const st = createStableState();
  beginFrame(st, cam0, GRID); const a = wallInput(st); a.kind.fill(KIND_MODEL);
  const h = colHist(a); h.mat.fill(4);
  beginFrame(st, cam0, GRID);
  const b = wallInput(st); b.kind.fill(KIND_MODEL); b.planeId.fill(9); b.mat = new Uint16Array(COLS * ROWS).fill(4); b.objectId = new Uint32Array(COLS * ROWS).fill(77);
  const out = createStableBuffers(COLS, ROWS); stabilize(b, h, out, st);
  ok('AA-07a: world kind-8 prop keeps history across a planeId change (same mat)', out.fresh[10 * COLS + 20] === 0);
  b.mat.fill(5); const o2 = createStableBuffers(COLS, ROWS); stabilize(b, h, o2, st);
  ok('AA-07a: world kind-8 prop with another mat -> fresh', o2.fresh[10 * COLS + 20] === 1);
}
// AA-07b: a line<->ramp mismatch is held while the joint coverage is 1/4..3/4
{
  const st = createStableState();
  beginFrame(st, cam0, GRID); const a = wallInput(st);
  const h = colHist(a); h.level.fill(LEVEL_NONE); // history = a line cell
  beginFrame(st, cam0, GRID);
  const at = 10 * COLS + 20, n = COLS * ROWS;
  const run2 = (cov) => { const b = wallInput(st); b.level.fill(5); b.cov = new Uint8Array(n).fill(cov); const o = createStableBuffers(COLS, ROWS); stabilize(b, h, o, st); return o; };
  let o = run2(2);
  ok('AA-07b: coverage 2/4 + line->ramp mismatch -> history glyph held, history level kept', o.fresh[at] === 0 && o.glyph[at] === 120 && o.level[at] === LEVEL_NONE);
  ok('AA-07b: coverage 1/4 and 3/4 hold too', run2(1).fresh[at] === 0 && run2(3).fresh[at] === 0);
  ok('AA-07b: coverage 0/4 switches (fresh)', run2(0).fresh[at] === 1 && run2(0).glyph[at] === 7);
  ok('AA-07b: coverage 4/4 -> encoded as 0 (no info) switches', run2(4).fresh[at] === 1);
  st.aaJoint = false; ok('AA-07b: ?aajoint=0 -> mismatch always fresh', run2(2).fresh[at] === 1); st.aaJoint = true;
  // encoding round trip (shade.wgsl.js writes it, stable.wgsl.js / stableCompare.js read it)
  ok('AA-07b: level byte codec', levelOfByte(encodeLevelByte(5, 2, false)) === 5 && covOfByte(encodeLevelByte(5, 2, false)) === 2
    && levelOfByte(encodeLevelByte(255, 3, true)) === 255 && covOfByte(encodeLevelByte(255, 3, true)) === 3
    && encodeLevelByte(5, 0, false) === 5 && encodeLevelByte(5, 4, false) === 5 && encodeLevelByte(255, 2, false) === 255 && encodeLevelByte(254, 2, false) === 254
    && covOfByte(255) === 0 && covOfByte(254) === 0 && levelOfByte(254) === 254);
}

// OB-193: the drift limit grows with the cell footprint (distant walls keep their glyph), ortho keeps the texel limit.
{
  const near = uvDriftLimit(1, 0.5, 0.3, 400, 150, 16, false), far = uvDriftLimit(40, 0.5, 0.3, 400, 150, 16, false), mid = uvDriftLimit(8, 0.5, 0.3, 400, 150, 16, false);
  ok('OB-193 near wall keeps the texel limit', near === 1 / 16, String(near));
  ok('OB-193 depth 8 footprint is below the texel limit (texel limit applies)', mid === 1 / 16, String(mid));
  ok('OB-193 far wall (depth 40) limit = cell footprint 0.16, grows with depth', Math.abs(far - 0.16) < 1e-9 && far > 1 / 16 && uvDriftLimit(80, 0.5, 0.3, 400, 150, 16, false) > far, String(far));
  ok('OB-193 ortho keeps the texel limit', uvDriftLimit(8, 0.5, 0.3, 400, 150, 16, true) === 1 / 16);
}

// ---------------- OB-198: glyph hysteresis + mesh material key (synthetic 2-frame cases) ----------------
{
  const mk = (kind, mat, plane, lvl) => {
    const st = createStableState();
    beginFrame(st, cam0, GRID);
    const a = wallInput(st);
    a.kind.fill(kind); a.planeId.fill(1); a.mat = new Uint16Array(COLS * ROWS).fill(5);
    const h = colHist(a); h.mat = new Uint16Array(COLS * ROWS).fill(5); h.level.fill(5);
    beginFrame(st, cam0, GRID);
    const b = wallInput(st);
    b.kind.fill(kind); b.planeId.fill(plane); b.mat = new Uint16Array(COLS * ROWS).fill(mat); b.level.fill(lvl);
    const out = createStableBuffers(COLS, ROWS);
    stabilize(b, h, out, st);
    return { out, i: 10 * COLS + 20, st, b, h };
  };
  // glyph level +1 held, +2 switches (history glyph 100 + col; fresh glyph 7)
  let r = mk(KIND_WALL, 5, 1, 6); assert.equal(r.out.glyph[r.i], 100 + 20, 'level +1 held');
  r = mk(KIND_WALL, 5, 1, 7); assert.equal(r.out.glyph[r.i], 7, 'level +2 switches');
  // aaGlyph off: strict equality only
  { const st = createStableState(); st.aaGlyph = false; beginFrame(st, cam0, GRID); const a = wallInput(st); const h = colHist(a); beginFrame(st, cam0, GRID);
    const b = wallInput(st); b.level.fill(6); const out = createStableBuffers(COLS, ROWS); stabilize(b, h, out, st); assert.equal(out.glyph[10 * COLS + 20], 7, 'aaGlyph=0: +1 switches'); }
  // mesh: planeId flip with same material keeps history, different material drops it
  r = mk(KIND_MESH, 5, 9, 5); assert.equal(r.out.fresh[r.i], 0, 'mesh planeId flip, same material: history kept');
  r = mk(KIND_MESH, 6, 9, 5); assert.equal(r.out.fresh[r.i], 1, 'mesh planeId flip, other material: dropped');
  r = mk(KIND_WALL, 5, 9, 5); assert.equal(r.out.fresh[r.i], 1, 'non-mesh planeId flip still drops');
  { const st = createStableState(); st.aaMesh = false; beginFrame(st, cam0, GRID); const a = wallInput(st); a.kind.fill(KIND_MESH); const h = colHist(a); beginFrame(st, cam0, GRID);
    const b = wallInput(st); b.kind.fill(KIND_MESH); b.planeId.fill(9); const out = createStableBuffers(COLS, ROWS); stabilize(b, h, out, st); assert.equal(out.fresh[10 * COLS + 20], 1, 'aaMesh=0: planeId flip drops'); }
}
console.log('temporalStable OB-198 cases ok');

// AA-20 (OB-208): graze limit = GRAZE_K x the smaller same-kind+mat UV step per axis (larger axis wins), capped, never below the base limit
{
  const C = 3, R = 3, u = new Float32Array(9), v = new Float32Array(9), kind = new Uint8Array(9).fill(7), mat = new Uint16Array(9), o = new Float64Array(1);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { u[r * C + c] = c * 0.1; v[r * C + c] = r * 1.0; } // grazing: 1 m per row, 0.1 m per column
  const inp = { cols: C, rows: R, u, v, kind, mat };
  grazeUvLimit(inp, 1, 1, 0.05, o); assert.ok(Math.abs(o[0] - GRAZE_K * 1.0) < 1e-6, 'graze: row footprint (1 m) x K');
  v[7] = 50; grazeUvLimit(inp, 1, 1, 0.05, o); assert.ok(Math.abs(o[0] - GRAZE_K * 1.0) < 1e-6, 'graze: a silhouette side (far row below) is ignored');
  v[7] = 2; kind[1] = 9; kind[7] = 9; grazeUvLimit(inp, 1, 1, 0.05, o); assert.ok(Math.abs(o[0] - GRAZE_K * 0.1) < 1e-6, 'graze: no same-kind row neighbour -> column step only');
  kind[1] = 7; kind[7] = 7; grazeUvLimit(inp, 1, 1, 0.01, o); assert.ok(Math.abs(o[0] - GRAZE_CAP * 0.01) < 1e-9, 'graze: capped at GRAZE_CAP x base');
  grazeUvLimit(inp, 1, 1, 5, o); assert.equal(o[0], 5, 'graze: never below the base limit');
}
console.log('temporalStable AA-20 graze cases ok');
// AA-26 (OB-208): a soft-edge leaf cell (inp.soft) keeps history past the UV drift limit (world-keyed dice); off / not soft = fresh
for (const [leaf, soft, want] of [[true, 1, 0], [false, 1, 1], [true, 0, 1]]) {
  const st = createStableState(); st.aaGraze = false; st.aaLeafUv = leaf; beginFrame(st, cam0, GRID); const a = wallInput(st); a.kind.fill(KIND_MESH); const h = colHist(a); beginFrame(st, cam0, GRID);
  const b = wallInput(st); b.kind.fill(KIND_MESH); for (let k = 0; k < b.u.length; k++) b.u[k] += 3; b.soft = new Uint8Array(b.u.length).fill(soft);
  const out = createStableBuffers(COLS, ROWS); stabilize(b, h, out, st); ok(`AA-26 leaf=${leaf} soft=${soft}: fresh ${want}`, out.fresh[10 * COLS + 20] === want, String(out.fresh[10 * COLS + 20]));
}
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
