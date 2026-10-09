// US-073c (docs/architecture.md 38.25 item 6): the gpucompare `stable` row. Two GPU frames (A, then B after a small pan) with the
// stable pass on; the JS twin (temporalStable.js) is fed the GPU's OWN read-back inputs of B plus A's read-back output as history,
// and its output must equal the GPU's B output: 0 mismatches outside the tie mask, ties <= 0.5 % of the grid.
// `compareStableRow` is pure (Node-testable); `runStableRow` does the device calls (async readbacks) around two caller-supplied frames.
import { beginFrame, stabilize, createStableState, createStableBuffers, edgeMaskFromShade, waterMaskFromLayer } from '../../temporalStable.js';

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
  const st = createStableState();
  beginFrame(st, a.camA, a.grid, { invalidate: true });
  const histValid = beginFrame(st, a.camB, a.grid, { invalidate: false });
  const inp = {
    cols, rows, kind: new Uint8Array(n), planeId: new Int32Array(n), u: new Float32Array(n), v: new Float32Array(n), vd: new Float32Array(n),
    level: new Uint8Array(n), glyph: new Uint16Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n), edge: null, water: null,
  };
  const hist = createStableBuffers(cols, rows), out = createStableBuffers(cols, rows);
  const shFg = new Uint32Array(n), shBg = new Uint32Array(n), shGl = new Uint16Array(n), wx = new Uint32Array(n), ww = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    inp.kind[i] = B.GI[i * 4 + 1] & 255; inp.planeId[i] = B.GI[i * 4] | 0;
    inp.u[i] = bitsToF(B.GA[i * 4]); inp.v[i] = bitsToF(B.GA[i * 4 + 1]); inp.vd[i] = bitsToF(B.depth[i]);
    inp.level[i] = B.level[i]; inp.glyph[i] = B.finalFg[i * 4 + 3]; inp.fg[i] = rgb(B.finalFg, i); inp.bg[i] = rgb(B.finalBg, i);
    shFg[i] = rgb(B.shadeFg, i); shBg[i] = rgb(B.shadeBg, i); shGl[i] = B.shadeFg[i * 4 + 3];
    hist.planeId[i] = A.hist[i * 4] | 0; hist.u[i] = bitsToF(A.hist[i * 4 + 1]); hist.v[i] = bitsToF(A.hist[i * 4 + 2]);
    hist.level[i] = A.hist[i * 4 + 3] & 255; hist.kind[i] = (A.hist[i * 4 + 3] >> 8) & 255;
    hist.glyph[i] = A.outFg[i * 4 + 3]; hist.fg[i] = rgb(A.outFg, i); hist.bg[i] = rgb(A.outBg, i);
    if (B.water) { wx[i] = B.water[i * 4]; ww[i] = B.water[i * 4 + 3]; } else { wx[i] = 0x7f800000; ww[i] = 0; }
  }
  inp.edge = edgeMaskFromShade(inp.fg, inp.bg, inp.glyph, shFg, shBg, shGl, new Uint8Array(n));
  inp.water = waterMaskFromLayer(wx, ww, new Uint8Array(n));
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
    const t = p._t, inp = p._stInp, waterOn = !!(p._waterPass && p._waterPass.active);
    const B = {
      GI: await rb32(t.texGI, 4), GA: await rb32(t.texGA, 4), depth: await rb32(t.texDepth, 1), level: await rb8(t.texLevel, 1),
      shadeFg: await rb8(inp.shadeFg, 4), shadeBg: await rb8(inp.shadeBg, 4), finalFg: await rb8(t.texFinalFg, 4), finalBg: await rb8(t.texFinalBg, 4),
      water: waterOn ? await rb32(inp.water, 4) : null, outFg: await rb8(sp.outFg, 4), outBg: await rb8(sp.outBg, 4),
    };
    const grid = p._rasterPass.grid;
    const res = compareStableRow({ cols, rows, camA, camB, grid: { cols: grid.cols, rows: grid.rows, pxCellW: grid.pxCellW, pxCellH: grid.pxCellH }, A, B });
    res.waterOn = waterOn; res.waterOff = waterOff;
    return res;
  } finally { p.setStable(false); if (wp) wp.forceOff = wasForce; }
}
