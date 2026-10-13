// engine/render/temporalStable.test.js (US-073a, docs/architecture.md 38.25): pitched/ortho temporal-stability JS twin.
// Synthetic wall plane in front of the camera; static / 1-cell pan / cut / tie mask / reject rules / ortho / 0 alloc.
// Re-spawns itself with the frameAlloc flags (big semi-space, sync tier-up) like horizonAo.alloc.test.js.
// Run: node engine/render/temporalStable.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { beginFrame, stabilize, createStableState, createStableBuffers, CHANNEL_SNAP, LEVEL_ANIM, LEVEL_NONE, UV_LIM_TEXELS, DEFAULT_DETAIL } from './temporalStable.js';
import { KIND_NONE, KIND_WALL, KIND_MODEL } from './GBuffer.js';
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
  const out = createStableBuffers(COLS, ROWS);
  stabilize(inp, h, out, st);
  for (const [nm, c] of [['sky', 3], ['kind 8', 4], ['water', 5], ['level 255 cur', 6], ['level 255 hist', 7], ['edge', 8], ['planeId mismatch', 9], ['uv drift', 10], ['vd 0', 11]]) {
    ok(`reject: ${nm} fresh`, out.fresh[at(3, c)] === 1 && out.glyph[at(3, c)] === inp.glyph[at(3, c)]);
  }
  ok('blend diff 48: (p+c+1)>>1', ((out.fg[at(4, 3)] >> 16) & 255) === 124, `${(out.fg[at(4, 3)] >> 16) & 255}`);
  ok('snap diff 49: cur byte', ((out.fg[at(4, 4)] >> 16) & 255) === 149);
  ok('glyph held within one level', out.glyph[at(4, 5)] === h.glyph[at(4, 5)] && out.level[at(4, 5)] === 5);
  ok('glyph fresh at two levels', out.glyph[at(4, 6)] === inp.glyph[at(4, 6)] && out.level[at(4, 6)] === 7 && out.fresh[at(4, 6)] === 0);
}

// 38.25 amendment: UV limit 1.0/detail (boundary 0.99 / 1.01), level 254 'animated', mixed/both-255 rules, fg-snap re-roll, anchor u/v
{
  const LIM = UV_LIM_TEXELS / DEFAULT_DETAIL, at = (r, c) => r * COLS + c;
  ok('UV limit constant is 1.0/detail', UV_LIM_TEXELS === 1 && LIM === 0.0625);
  // setup: static camera, history = frame A exactly; `mut(inp, hist)` edits cells, then one stabilize
  const once = (mut, flags) => {
    const st = createStableState();
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
  const st = createStableState();
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
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
