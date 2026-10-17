// US-073c (docs/architecture.md 38.25 item 6): the gpucompare `stable` row. Two GPU frames (A, then B after a small pan) with the
// stable pass on; the JS twin (temporalStable.js) is fed the GPU's OWN read-back inputs of B plus A's read-back output as history,
// and its output must equal the GPU's B output: 0 mismatches outside the tie mask, ties <= 0.5 % of the grid.
// `compareStableRow` is pure (Node-testable); `runStableRow` does the device calls (async readbacks) around two caller-supplied frames.
import { beginFrame, stabilize, createStableState, createStableBuffers, edgeMaskFromShade, waterMaskFromLayer, levelOfByte, covOfByte, reprojectF32 } from '../../temporalStable.js';
import { resolveCellJS } from '../../resolveBand.js';
import { RESOLVE_BLOCK } from '../wgsl/resolve.wgsl.js';
import { F_SOFT_EDGE } from '../ShadeTextures.js';
import { KIND_MODEL, KIND_MESH } from '../../GBuffer.js';


export const STABLE_TIE_MAX_FRAC = 0.005;
/** STABLE-GATE-TEST-01 liveness floor: the twin must take history on at least this share of the non-sky cells (a reject-everything bug cannot pass). */
export const STABLE_LIVE_MIN_FRAC = 0.2;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bitsToF = (b) => { u32[0] = b; return f32[0]; };
const rgb = (a, i) => (a[i * 4] << 16) | (a[i * 4 + 1] << 8) | a[i * 4 + 2];

/**
 * @param {{cols:number, rows:number, camA:object, camB:object, grid:object,
 *   A:{outFg:Uint8Array, outBg:Uint8Array, hist:Uint32Array},
 *   B:{GI:Uint32Array, GA:Uint32Array, depth:Uint32Array, shadeFg:Uint8Array, shadeBg:Uint8Array, finalFg:Uint8Array, finalBg:Uint8Array,
 *      level:Uint8Array, water:Uint32Array|null, outFg:Uint8Array, outBg:Uint8Array}}} a  all arrays cell-major, 4-wide for rgba (depth/level 1-wide)
 */
export function compareStableRow(a) {
  const { cols, rows } = a, n = cols * rows, A = a.A, B = a.B;
  const st = createStableState(); st.aaLeafUv = a.aaLeafUv !== false; // AA-26: same flag as the GPU frame
  beginFrame(st, a.camA, a.grid, { invalidate: true });
  const histValid = beginFrame(st, a.camB, a.grid, { invalidate: false });
  const inp = {
    cols, rows, kind: new Uint8Array(n), planeId: new Int32Array(n), mat: new Uint16Array(n), u: new Float32Array(n), v: new Float32Array(n), vd: new Float32Array(n),
    level: new Uint8Array(n), cov: new Uint8Array(n), objectId: new Uint32Array(n), glyph: new Uint16Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n), edge: null, water: null,
  };
  const hist = createStableBuffers(cols, rows), out = createStableBuffers(cols, rows);
  const shFg = new Uint32Array(n), shBg = new Uint32Array(n), shGl = new Uint16Array(n), wx = new Uint32Array(n), ww = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    inp.kind[i] = B.GI[i * 4 + 1] & 255; inp.planeId[i] = B.GI[i * 4] | 0; inp.mat[i] = (B.GI[i * 4 + 1] >>> 16) & 0xffff;
    inp.u[i] = bitsToF(B.GA[i * 4]); inp.v[i] = bitsToF(B.GA[i * 4 + 1]); inp.vd[i] = bitsToF(B.depth[i]);
    /* AA-07: decode the shade level byte */ inp.level[i] = levelOfByte(B.level[i]); inp.cov[i] = covOfByte(B.level[i]); inp.objectId[i] = B.GI[i * 4 + 3] >>> 0; inp.glyph[i] = B.finalFg[i * 4 + 3]; inp.fg[i] = rgb(B.finalFg, i); inp.bg[i] = rgb(B.finalBg, i);
    shFg[i] = rgb(B.shadeFg, i); shBg[i] = rgb(B.shadeBg, i); shGl[i] = B.shadeFg[i * 4 + 3];
    hist.planeId[i] = A.hist[i * 4] | 0; hist.u[i] = bitsToF(A.hist[i * 4 + 1]); hist.v[i] = bitsToF(A.hist[i * 4 + 2]);
    hist.level[i] = A.hist[i * 4 + 3] & 255; hist.kind[i] = (A.hist[i * 4 + 3] >> 8) & 15; hist.vm[i] = (A.hist[i * 4 + 3] >> 12) & 15; hist.mat[i] = (A.hist[i * 4 + 3] >>> 16) & 0xffff;
    hist.glyph[i] = A.outFg[i * 4 + 3]; hist.fg[i] = rgb(A.outFg, i); hist.bg[i] = rgb(A.outBg, i);
    if (B.water) { wx[i] = B.water[i * 4]; ww[i] = B.water[i * 4 + 3]; } else { wx[i] = 0x7f800000; ww[i] = 0; }
  }
  inp.edge = edgeMaskFromShade(inp.fg, inp.bg, inp.glyph, shFg, shBg, shGl, new Uint8Array(n));
  inp.water = waterMaskFromLayer(wx, ww, new Uint8Array(n));
  if (a.matI) { const sf = new Uint8Array(n); for (let i = 0; i < n; i++) { const m = inp.mat[i]; sf[i] = inp.kind[i] === KIND_MESH && m < a.nMat && (a.matI[m * a.matIWidth * 4 + 1] & F_SOFT_EDGE) !== 0 ? 1 : 0; } inp.soft = sf; } // AA-26
  const used = stabilize(inp, hist, out, st);
  let ties = 0, mism = 0, tieMism = 0, nonSky = 0, heldTwin = 0, heldGpu = 0, held255 = 0, held255Gpu = 0; const bad = [];
  for (let i = 0; i < n; i++) {
    if (inp.kind[i] !== 0) nonSky++;
    const tie = out.tie[i] === 1; if (tie) ties++;
    if (!tie && out.hsrc[i] >= 0) { // 'held' = the output glyph is the history glyph and that differs from this frame's final glyph (a reject-everything GPU cannot hold)
      const hg = hist.glyph[out.hsrc[i]], fg0 = inp.glyph[i];
      if (hg !== fg0) { if (out.glyph[i] === hg) heldTwin++; if (B.outFg[i * 4 + 3] === hg) heldGpu++; }
    }
    if (out.held255[i] === 1 && !tie) { // amendment C: the GPU must hold the history glyph on the twin's held-255 cells too
      held255++;
      if (out.hsrc[i] >= 0 && B.outFg[i * 4 + 3] === hist.glyph[out.hsrc[i]]) held255Gpu++;
    }
    const same = out.fg[i] === rgb(B.outFg, i) && out.bg[i] === rgb(B.outBg, i) && out.glyph[i] === B.outFg[i * 4 + 3];
    if (same) continue;
    if (tie) { tieMism++; continue; }
    mism++; if (bad.length < 3) bad.push({ col: i % cols, row: (i / cols) | 0, gpuFg: rgb(B.outFg, i).toString(16), twinFg: out.fg[i].toString(16), gpuGlyph: B.outFg[i * 4 + 3], twinGlyph: out.glyph[i], fresh: out.fresh[i] });
  }
  const tieFrac = ties / n;
  const vacuous = !histValid || used < n * 0.02; // the sequence must really exercise history
  const liveFrac = nonSky > 0 ? used / nonSky : 0, liveOk = liveFrac >= STABLE_LIVE_MIN_FRAC, heldOk = heldTwin === heldGpu;
  return { ok: !vacuous && mism === 0 && tieFrac <= STABLE_TIE_MAX_FRAC && liveOk && heldOk && held255 > 0 && held255Gpu === held255, histValid, used, usedPct: 100 * used / n, nonSky, livePct: 100 * liveFrac, liveOk, heldTwin, heldGpu, heldOk, held255, held255Gpu, ties, tiePct: 100 * tieFrac, mismatches: mism, tieMismatches: tieMism, vacuous, bad };
}

/**
 * Device side: frame A (history invalid) -> read A's output -> frame B -> read B's inputs + output -> compare.
 * @param {any} p WgCellPipeline built with `stable: true` @param {() => void} renderA @param {() => void} renderB  each renders + presents one GPU frame
 */
export async function runStableRow(p, camA, camB, renderA, renderB, opts) {
  const sp = p._stablePass, d = p.device, cols = p.cols, rows = p.rows, n = cols * rows, rect = { x: 0, y: 0, w: cols, h: rows };
  if (!sp) return { ok: false, skipped: true, reason: 'no stable pass (pipeline built without stable)' };
  const wp = p._waterPass, waterOff = !!(opts && opts.waterOff), wasForce = wp ? wp.forceOff : false;
  if (waterOff && wp) wp.forceOff = true; // sub-case (ii): the 1x1 dummy is bound and waterOn = 0
  p.setStable(true);
  const rb8 = async (tex, w) => { const o = new Uint8Array(n * w); await d.readback(tex, rect, o); return o; };
  const rb32 = async (tex, w) => { const o = new Uint32Array(n * w); await d.readback(tex, rect, o); return o; };
  try {
    p.invalidateHistory(); renderA();
    if (!p._stableRan) return { ok: false, skipped: true, reason: 'stable pass did not run (cells not shaded / camera not pitched)' };
    const A = { outFg: await rb8(sp.outFg, 4), outBg: await rb8(sp.outBg, 4), hist: await rb32(sp.outHist, 4) };
    renderB();
    if (!p._stableRan) return { ok: false, skipped: true, reason: 'stable pass did not run on frame B' };
    const cp = p._cellPass, hystWords = opts && opts.hyst && cp ? resolveWordsOf(cp.ru, cp.ri) : null; // AA-04-FIX: frame B's ResolveU, before any await
    const t = p._t, inp = p._stInp, waterOn = !!(p._waterPass && p._waterPass.active);
    const B = {
      GI: await rb32(t.texGI, 4), GA: await rb32(t.texGA, 4), depth: await rb32(t.texDepth, 1), level: await rb8(t.texLevel, 1),
      shadeFg: await rb8(inp.shadeFg, 4), shadeBg: await rb8(inp.shadeBg, 4), finalFg: await rb8(t.texFinalFg, 4), finalBg: await rb8(t.texFinalBg, 4),
      water: waterOn ? await rb32(inp.water, 4) : null, outFg: await rb8(sp.outFg, 4), outBg: await rb8(sp.outBg, 4),
    };
    const grid = p._rasterPass.grid, pk0 = p._cellPass && p._cellPass.shadePass && p._cellPass.shadePass.packed; // AA-26: MAT_I soft flags for the leaf hold
    const res = compareStableRow({ cols, rows, camA, camB, grid: { cols: grid.cols, rows: grid.rows, pxCellW: grid.pxCellW, pxCellH: grid.pxCellH }, A, B,
      aaLeafUv: sp.st.aaLeafUv, matI: pk0 ? pk0.matI : null, matIWidth: pk0 ? pk0.dims.matIWidth : 0, nMat: pk0 ? pk0.dims.nMat : 0 });
    res.waterOn = waterOn; res.waterOff = waterOff;
    if (hystWords) { // AA-04-FIX (38.82 B): resolve-hyst sub-check on the same frame B
      const tt = p._t, sr = { x: 0, y: 0, w: tt.subCols, h: tt.subRows }, ns = tt.subCols * tt.subRows;
      const subGI = new Uint32Array(ns * 4), subDepth = new Uint32Array(ns);
      await d.readback(tt.texSGI, sr, subGI); await d.readback(tt.texSDepth, sr, subDepth);
      const pk = cp.shadePass && cp.shadePass.packed;
      res.hyst = compareResolveHyst({ cols, rows, words: hystWords, subGI, subDepth, hist: A.hist, gi: B.GI,
        matI: pk ? pk.matI : null, matIWidth: pk ? pk.dims.matIWidth : 0, nMat: pk ? pk.dims.nMat : 0 });
    }
    return res;
  } finally { p.setStable(false); if (wp) wp.forceOff = wasForce; }
}

// ---- AA-04-FIX (38.82 B, arch review F): the stable row's `resolve-hyst` sub-check. On frame B the resolve twin (resolveBand.js
// resolveCellJS with histKey) runs on the GPU's own sub-sample G-buffer, its own ResolveU words and the GPU HIST read-back of frame A;
// its winner key (kind, planeId, mat) per cell must equal the GPU resolve output (cell GI). Ties (reprojection lands within 1e-3 of a
// cell border, or two groups with equal count and min depth within 1e-6) are reported, never failed. Models AA-17 (soft-edge leaf key,
// folEdge + MAT_I F_SOFT_EDGE incl. the -1 rows) and AA-21 (vox: kind-8 winners vs kind-8 keys only).
const RW = (name) => RESOLVE_BLOCK.field(name).word;
const RW_TERMS = ['curA', 'curB', 'curC', 'prevA', 'prevB', 'prevC', 'dEye'].map(RW);
/** Snapshot of the ResolveU words the GPU used this frame (call right after the frame, before the next one overwrites the scratch). */
export function resolveWordsOf(ru, ri) {
  const w = (k, o) => ru[RW_TERMS[k] + o];
  const terms = (k) => [w(k, 0), w(k, 1), w(k, 2), w(k, 3), w(k + 1, 0), w(k + 1, 1), w(k + 1, 2), w(k + 1, 3), w(k + 2, 0), w(k + 2, 1)];
  return {
    n: ri[RW('n')], bandM: ru[RW('bandM')], histValid: ri[RW('histValid')], folEdge: ri[RW('folEdge')], vox: ri[RW('vox')],
    T: { cur: terms(0), prev: terms(3), dEye: [w(6, 0), w(6, 1), w(6, 2)], cols: ri[RW('gridCols')], rows: ri[RW('gridRows')], ortho: ri[RW('ortho')] },
  };
}

/**
 * @param {{cols:number, rows:number, words:ReturnType<typeof resolveWordsOf>, subGI:Uint32Array, subDepth:Uint32Array, hist:Uint32Array,
 *   gi:Uint32Array, matI:Int32Array|null, matIWidth:number, nMat:number}} a  subGI/subDepth: (cols*n) x (rows*n), 4-wide / 1-wide; hist, gi: cell-major 4-wide
 */
export function compareResolveHyst(a) {
  const { cols, rows, words: W, subGI, subDepth, hist, gi } = a, n = W.n, n2 = n * n, subCols = cols * n;
  const sub = { pid: new Int32Array(n2), kind: new Uint32Array(n2), mat: new Uint32Array(n2), depth: new Float32Array(n2) };
  const dv = new Float32Array(subDepth.buffer, subDepth.byteOffset, subDepth.length);
  const out = { idx: 0, cov: 0, far: false, bestMinDepth: 0 }, pc = new Float32Array(3), hk = { kind: 0, pid: 0, mat: 0, soft: false, vox: W.vox !== 0 };
  const soft = (k, m) => W.folEdge !== 0 && k === KIND_MESH && !!a.matI && m < a.nMat && (a.matI[m * a.matIWidth * 4 + 1] & F_SOFT_EDGE) !== 0;
  let keyed = 0, changed = 0, mism = 0, ties = 0, tieMism = 0, far = 0; const bad = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const s = (cy * n + j) * subCols + cx * n + i, y = subGI[s * 4 + 1];
      sub.pid[k] = subGI[s * 4] | 0; sub.kind[k] = y & 255; sub.mat[k] = (y >>> 16) & 0xffff; sub.depth[k] = dv[s];
    }
    resolveCellJS(sub, n, W.bandM, cx, cy, out, null);
    const plain = out.idx; let tie = false, key = null;
    if (out.far) far++;
    else {
      for (let p = 0; p < n2 && !tie; p++) for (let q = 0; q < n2; q++) { // vote tie: two keys, equal count, min depth within 1e-6
        if (sub.kind[p] === sub.kind[q] && sub.pid[p] === sub.pid[q] && sub.mat[p] === sub.mat[q]) continue;
        let cp = 0, cq = 0, dp = 1e30, dq = 1e30;
        for (let b = 0; b < n2; b++) {
          const ip = sub.kind[b] === sub.kind[p] && sub.pid[b] === sub.pid[p] && sub.mat[b] === sub.mat[p], iq = sub.kind[b] === sub.kind[q] && sub.pid[b] === sub.pid[q] && sub.mat[b] === sub.mat[q];
          if (ip) { cp++; if (sub.depth[b] < dp) dp = sub.depth[b]; } if (iq) { cq++; if (sub.depth[b] < dq) dq = sub.depth[b]; }
        }
        if (cp === cq && Math.abs(dp - dq) <= 1e-6 * Math.max(1, dp)) { tie = true; break; }
      }
      const wModel = sub.kind[plain] === KIND_MODEL;
      if (W.histValid !== 0 && (!wModel || W.vox !== 0)) {
        let rd = out.bestMinDepth;
        if (sub.kind[plain] === 0) { rd = 1e30; for (let b = 0; b < n2; b++) if (sub.kind[b] !== 0 && sub.depth[b] < rd) rd = sub.depth[b]; if (rd >= 1e29) rd = 1e4; }
        reprojectF32(W.T, cx, cy, rd, pc);
        if (!(W.T.ortho === 0 && pc[2] <= 0) && pc[0] > -2 && pc[0] < W.T.cols + 2 && pc[1] > -2 && pc[1] < W.T.rows + 2) {
          const fx = pc[0] + 0.5 - Math.floor(pc[0] + 0.5), fy = pc[1] + 0.5 - Math.floor(pc[1] + 0.5);
          if (fx < 1e-3 || fx > 1 - 1e-3 || fy < 1e-3 || fy > 1 - 1e-3) tie = true; // f32/FMA rounding may pick the neighbour HIST texel
          const hc = Math.floor(pc[0] + 0.5), hr = Math.floor(pc[1] + 0.5);
          if (hc >= 0 && hc < W.T.cols && hr >= 0 && hr < W.T.rows) {
            const h = (hr * cols + hc) * 4, hw = hist[h + 3];
            hk.kind = (hw >>> 8) & 15; hk.mat = hw >>> 16; hk.pid = hist[h] | 0;
            if ((hk.kind === KIND_MODEL) === wModel) { hk.soft = soft(hk.kind, hk.mat); key = hk; keyed++; }
          }
        }
      }
      if (key) { resolveCellJS(sub, n, W.bandM, cx, cy, out, key); if (out.idx !== plain) changed++; }
    }
    const w = out.idx, c = cy * cols + cx, gy = gi[c * 4 + 1];
    if ((gi[c * 4] | 0) === sub.pid[w] && (gy & 255) === sub.kind[w] && ((gy >>> 16) & 0xffff) === sub.mat[w]) { if (tie) ties++; continue; }
    if (tie) { ties++; tieMism++; continue; }
    mism++; if (bad.length < 3) bad.push({ col: cx, row: cy, gpu: [gi[c * 4] | 0, gy & 255, (gy >>> 16) & 0xffff], twin: [sub.pid[w], sub.kind[w], sub.mat[w]], hist: key ? [key.pid, key.kind, key.mat, key.soft] : null });
  }
  const cells = cols * rows, vacuous = W.histValid === 0 || n < 2 || keyed < cells * 0.02;
  return { ok: !vacuous && mism === 0, n, histValid: W.histValid, keyed, keyedPct: 100 * keyed / cells, changed, far, mismatches: mism, ties, tieMismatches: tieMism, vacuous, bad };
}
