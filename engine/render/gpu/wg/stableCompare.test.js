// US-073c: the gpucompare `stable` row comparator (compareStableRow) on a synthetic wall: "GPU" arrays are produced by the twin itself,
// so the row must pass; a changed GPU byte outside the tie mask must fail; a vacuous sequence (no history) must not pass.
// Run: node engine/render/gpu/wg/stableCompare.test.js
import assert from 'node:assert';
import { compareStableRow, compareResolveHyst } from './stableCompare.js';
import { F_SOFT_EDGE } from '../ShadeTextures.js';
import { beginFrame, stabilize, createStableState, createStableBuffers } from '../../temporalStable.js';
import { KIND_WALL, KIND_MESH } from '../../GBuffer.js';

const COLS = 40, ROWS = 20, N = COLS * ROWS;
const grid = { cols: COLS, rows: ROWS, pxCellW: 8, pxCellH: 16 };
const camA = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }, camB = { x: 0.01, y: 0, z: 1.6, yawDeg: 0.05, pitchDeg: 0 };
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const fb = (v) => { f32[0] = v; return u32[0]; };

/** Wall at y = -5 seen by the state's current camera, as GPU-shaped arrays (the shape compareStableRow reads back). */
function wallArrays(st, fgByte, glyph) {
  const a = { GI: new Uint32Array(N * 4), GA: new Uint32Array(N * 4), depth: new Uint32Array(N), level: new Uint8Array(N).fill(5), shadeFg: new Uint8Array(N * 4), shadeBg: new Uint8Array(N * 4), finalFg: new Uint8Array(N * 4), finalBg: new Uint8Array(N * 4) };
  const c = st.cur;
  for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
    const x = ((2 * (q + 0.5)) / COLS - 1) * c.tanHalfX, y = (1 - (2 * r) / ROWS) * c.tanHalfY, i = r * COLS + q;
    const dy = c.fY + x * c.rY + y * c.uY, vd = (-5 - c.eyeY) / dy;
    a.GI[i * 4] = 1; a.GI[i * 4 + 1] = KIND_WALL; a.depth[i] = fb(vd);
    a.GA[i * 4] = fb(c.eyeX + (c.fX + x * c.rX + y * c.uX) * vd); a.GA[i * 4 + 1] = fb(c.eyeZ + (c.fZ + y * c.uZ) * vd);
    for (const t of [a.shadeFg, a.finalFg]) { t[i * 4] = fgByte + (i % 5); t[i * 4 + 1] = fgByte; t[i * 4 + 2] = fgByte; t[i * 4 + 3] = glyph; }
    for (const t of [a.shadeBg, a.finalBg]) { t[i * 4] = 16; t[i * 4 + 1] = 16; t[i * 4 + 2] = 16; t[i * 4 + 3] = 255; }
  }
  return a;
}
const unpackRgba = (px, outFg, outBg, buf, glyphs) => { // twin buffers -> rgba8 arrays
  for (let i = 0; i < N; i++) {
    outFg[i * 4] = (buf.fg[i] >> 16) & 255; outFg[i * 4 + 1] = (buf.fg[i] >> 8) & 255; outFg[i * 4 + 2] = buf.fg[i] & 255; outFg[i * 4 + 3] = buf.glyph[i];
    outBg[i * 4] = (buf.bg[i] >> 16) & 255; outBg[i * 4 + 1] = (buf.bg[i] >> 8) & 255; outBg[i * 4 + 2] = buf.bg[i] & 255; outBg[i * 4 + 3] = 255;
  }
};

function build(camBUse) {
  // frame A: fresh (invalid) -> its output is the history; frame B: the twin on B's inputs gives the "GPU" output
  const st = createStableState();
  beginFrame(st, camA, grid, { invalidate: true });
  const a = wallArrays(st, 100, 60);
  const L255 = (i) => (i % COLS) >= COLS / 2; // right half: level-255 (non-ramp) cells, held by the amendment-C rule
  for (let i = 0; i < N; i++) if (L255(i)) a.level[i] = 255;
  const inA = { cols: COLS, rows: ROWS, kind: new Uint8Array(N).fill(KIND_WALL), planeId: new Int32Array(N).fill(1), u: new Float32Array(N), v: new Float32Array(N), vd: new Float32Array(N), level: a.level.slice(), glyph: new Uint16Array(N).fill(60), fg: new Uint32Array(N), bg: new Uint32Array(N).fill(0x101010) };
  for (let i = 0; i < N; i++) { u32[0] = a.GA[i * 4]; inA.u[i] = f32[0]; u32[0] = a.GA[i * 4 + 1]; inA.v[i] = f32[0]; u32[0] = a.depth[i]; inA.vd[i] = f32[0]; inA.fg[i] = (a.finalFg[i * 4] << 16) | (100 << 8) | 100; }
  const outA = createStableBuffers(COLS, ROWS); stabilize(inA, createStableBuffers(COLS, ROWS), outA, st);
  const A = { outFg: new Uint8Array(N * 4), outBg: new Uint8Array(N * 4), hist: new Uint32Array(N * 4) };
  unpackRgba(null, A.outFg, A.outBg, outA);
  for (let i = 0; i < N; i++) { A.hist[i * 4] = 1; A.hist[i * 4 + 1] = fb(outA.u[i]); A.hist[i * 4 + 2] = fb(outA.v[i]); A.hist[i * 4 + 3] = outA.level[i] | (outA.kind[i] << 8); }
  beginFrame(st, camBUse, grid, { invalidate: false });
  const b = wallArrays(st, 104, 61); // slightly different colours/glyph: blend + hold are exercised
  for (let i = 0; i < N; i++) if (L255(i)) b.level[i] = 255;
  const inB = { ...inA, level: b.level.slice(), u: new Float32Array(N), v: new Float32Array(N), vd: new Float32Array(N), glyph: new Uint16Array(N).fill(61), fg: new Uint32Array(N) };
  for (let i = 0; i < N; i++) { u32[0] = b.GA[i * 4]; inB.u[i] = f32[0]; u32[0] = b.GA[i * 4 + 1]; inB.v[i] = f32[0]; u32[0] = b.depth[i]; inB.vd[i] = f32[0]; inB.fg[i] = (b.finalFg[i * 4] << 16) | (104 << 8) | 104; }
  const outB = createStableBuffers(COLS, ROWS); const used = stabilize(inB, outA, outB, st);
  const B = { ...b, water: null, outFg: new Uint8Array(N * 4), outBg: new Uint8Array(N * 4) };
  unpackRgba(null, B.outFg, B.outBg, outB);
  return { A, B, used };
}

{
  const { A, B, used } = build(camB);
  assert.ok(used > N * 0.5, `sequence uses history (${used}/${N})`);
  const r = compareStableRow({ cols: COLS, rows: ROWS, camA, camB, grid, A, B });
  assert.strictEqual(r.mismatches, 0, JSON.stringify(r.bad));
  assert.ok(r.ok && r.histValid && r.usedPct > 50, JSON.stringify(r));
  // STABLE-GATE-TEST-01: liveness floor + held counts
  assert.ok(r.liveOk && r.livePct >= 20 && r.nonSky === N, `liveness ${r.livePct}`);
  assert.ok(r.heldOk && r.heldTwin > N * 0.3 && r.held255 > 0 && r.held255Gpu === r.held255 && r.heldGpu === r.heldTwin, `held twin ${r.heldTwin} gpu ${r.heldGpu}`);
  // a reject-everything GPU (every cell shows this frame's final glyph) fails: mismatches AND held counts differ
  const allFresh = { ...B, outFg: B.finalFg.slice(), outBg: B.finalBg.slice() };
  const dead = compareStableRow({ cols: COLS, rows: ROWS, camA, camB, grid, A, B: allFresh });
  assert.ok(!dead.ok && dead.heldGpu === 0 && dead.heldTwin > 0 && !dead.heldOk, 'reject-everything GPU is caught by the held count');
  // a reject-everything TWIN (all cells model kind -> fresh): liveness floor fails even if the GPU agrees
  // amendment C: a GPU that drops the 255 hold (fresh glyph on those cells only) fails the row
  const d255 = { ...B, outFg: B.outFg.slice() };
  for (let i = 0; i < N; i++) if (B.level[i] === 255) d255.outFg[i * 4 + 3] = B.finalFg[i * 4 + 3];
  const no255 = compareStableRow({ cols: COLS, rows: ROWS, camA, camB, grid, A, B: d255 });
  assert.ok(!no255.ok && no255.held255 > 0 && no255.held255Gpu === 0, 'GPU dropping the level-255 hold FAILs');

  const sky = { ...B, GI: B.GI.slice(), outFg: B.finalFg.slice(), outBg: B.finalBg.slice() };
  for (let i = 0; i < N; i++) sky.GI[i * 4 + 1] = 0; // KIND_NONE: never takes history
  const lowLive = compareStableRow({ cols: COLS, rows: ROWS, camA, camB, grid, A, B: sky });
  assert.ok(lowLive.mismatches === 0 && !lowLive.liveOk && !lowLive.ok, 'twin that takes no history fails the liveness floor');
  // mutation: one GPU glyph byte differs on a history cell outside the tie mask
  const B2 = { ...B, outFg: B.outFg.slice() };
  let hit = -1; for (let i = 0; i < N && hit < 0; i++) if (B2.outFg[i * 4 + 3] === 60) hit = i; // a held-glyph cell
  assert.ok(hit >= 0, 'fixture has held glyph cells');
  B2.outFg[hit * 4 + 3] = 61;
  const bad = compareStableRow({ cols: COLS, rows: ROWS, camA, camB, grid, A, B: B2 });
  assert.ok(!bad.ok && bad.mismatches + bad.tieMismatches >= 1, 'a wrong GPU glyph is caught (unless it is a tie cell)');
  // vacuous: a camera cut leaves no history -> the row must not pass
  const cut = compareStableRow({ cols: COLS, rows: ROWS, camA, camB: { ...camB, x: 9 }, grid, A, B });
  assert.ok(cut.vacuous && !cut.ok, 'cut sequence is vacuous, not a pass');
}
// AA-04-FIX (38.82 B): the resolve-hyst sub-check. Identity camera terms (cur == prev) -> every cell reprojects onto itself.
{
  const C = 4, R = 2, n = 4, sc = C * n, ns = sc * R * n, ID = [0, 1, 0, 1, 1, 0, 0, 0, 1, 1];
  const words = { n, bandM: 0, histValid: 1, folEdge: 1, vox: 1, T: { cur: ID, prev: ID, dEye: [0, 0, 0], cols: C, rows: R, ortho: 0 } };
  const subGI = new Uint32Array(ns * 4), subDepth = new Uint32Array(ns), hist = new Uint32Array(C * R * 4), gi = new Uint32Array(C * R * 4);
  const put = (cx, cy, k, pid, kind, mat, d) => { const s = (cy * n + (k / n | 0)) * sc + cx * n + (k % n); subGI[s * 4] = pid; subGI[s * 4 + 1] = kind | (mat << 16); subDepth[s] = fb(d); };
  const key = (arr, c, pid, kind, mat, w = 0) => { arr[c * 4] = pid; arr[c * 4 + 1] = kind | (mat << 16); arr[c * 4 + 3] = w; };
  for (let c = 0; c < C * R; c++) { for (let k = 0; k < 16; k++) put(c % C, c / C | 0, k, 1, KIND_WALL, 3, 5); key(hist, c, 1, 0, 0, (KIND_WALL << 8) | (3 << 16)); key(gi, c, 1, KIND_WALL, 3); }
  for (let k = 0; k < 16; k++) if (k % n < 2) put(1, 0, k, 2, KIND_WALL, 4, 4); // (1,0): 8/8, the nearer Q wins the plain vote; history P keeps P
  for (let k = 3; k < 16; k++) put(2, 1, k, 2, KIND_WALL, 4, 4); key(gi, 6, 2, KIND_WALL, 4); // (2,1): P 3/16 < n^2/4 and < best - 2 -> flips to Q
  // (3,0) AA-17 soft leaf: last card (6, mat 7) 2/16, same leaf on card 9 5/16, other mesh (8, mat 2) 9/16 -> leaf as a whole (7) holds -> card 6
  for (let k = 0; k < 16; k++) put(3, 0, k, k < 2 ? 6 : k < 7 ? 9 : 8, KIND_MESH, k < 7 ? 7 : 2, 5);
  key(hist, 3, 6, 0, 0, (KIND_MESH << 8) | (7 << 16)); key(gi, 3, 6, KIND_MESH, 7);
  const matI = new Int32Array(8 * 2 * 4); matI[7 * 2 * 4 + 1] = F_SOFT_EDGE;
  const a = { cols: C, rows: R, words, subGI, subDepth, hist, gi, matI, matIWidth: 2, nMat: 8 };
  const r = compareResolveHyst(a);
  assert.ok(r.ok && r.mismatches === 0 && r.keyed === 8 && r.changed === 2, 'resolve-hyst: GPU keys of the twin pass ' + JSON.stringify(r));
  const noSoft = compareResolveHyst({ ...a, words: { ...words, folEdge: 0 } });
  assert.ok(!noSoft.ok && noSoft.mismatches === 1 && noSoft.bad[0].col === 3, 'AA-17 soft key is modelled (folEdge 0 -> the soft cell is a mismatch)');
  const g2 = gi.slice(); key(g2, 1, 2, KIND_WALL, 4);
  const r2 = compareResolveHyst({ ...a, gi: g2 });
  assert.ok(!r2.ok && r2.mismatches === 1 && r2.bad[0].col === 1, 'a GPU that ignores the history key is caught');
  const r3 = compareResolveHyst({ ...a, words: { ...words, histValid: 0 } });
  assert.ok(r3.vacuous && !r3.ok, 'histValid 0 is vacuous, not a pass');
}
console.log('stableCompare.test.js: all checks passed.');
