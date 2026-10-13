// STABLE-DIAG-01: per-cell-class histogram of the N vs N-1 glyph flips with the US-073 stable pass (docs/architecture.md 38.25).
// Pure (Node-testable): works on decoded readbacks of two consecutive GPU frames + the pass' twin state (`sp.st`, after beginFrame).
// Classifies every cell that is non-sky in both frames and has an unchanged surface key, but whose glyph differs, by the reason the
// stable rules rejected (or accepted) it. Mirrors the reject chain of temporalStable.stabilize (same unproject/worldToCell).
import { unprojectPitched, worldToCell } from '../../../../engine/index.js';
const LEVEL_NONE = 255, LEVEL_ANIM = 254, DEFAULT_DETAIL = 16, UV_LIM_TEXELS = 1.0; // mirrors engine/render/temporalStable.js (not in the public entry)

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bitsToF = (b) => { u32[0] = b; return f32[0]; };

/** Decode raw readbacks (GI/GA rgba32uint, depth r32uint, level r8, fg rgba8, hist rgba32uint) into per-cell arrays. */
export function decodeBundle(n, r) {
  const o = {
    kind: new Uint8Array(n), mat: new Uint16Array(n), plane: new Int32Array(n), u: new Float32Array(n), v: new Float32Array(n), vd: new Float32Array(n),
    level: r.level, glyphFinal: new Uint8Array(n), glyphOut: new Uint8Array(n), edge: new Uint8Array(n),
    fgSame: new Uint8Array(n), hKind: new Uint8Array(n), hPlane: new Int32Array(n), hU: new Float32Array(n), hV: new Float32Array(n), hLevel: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    o.kind[i] = r.GI[i * 4 + 1] & 255; o.mat[i] = (r.GI[i * 4 + 1] >>> 16) & 0xffff; o.plane[i] = r.GI[i * 4] | 0;
    o.u[i] = bitsToF(r.GA[i * 4]); o.v[i] = bitsToF(r.GA[i * 4 + 1]); o.vd[i] = bitsToF(r.depth[i]);
    o.fgSame[i] = (r.outFg[i * 4] === r.finalFg[i * 4] && r.outFg[i * 4 + 1] === r.finalFg[i * 4 + 1] && r.outFg[i * 4 + 2] === r.finalFg[i * 4 + 2]) ? 1 : 0;
    o.glyphFinal[i] = r.finalFg[i * 4 + 3]; o.glyphOut[i] = r.outFg[i * 4 + 3];
    o.edge[i] = (r.finalFg[i * 4] !== r.shadeFg[i * 4] || r.finalFg[i * 4 + 1] !== r.shadeFg[i * 4 + 1] || r.finalFg[i * 4 + 2] !== r.shadeFg[i * 4 + 2]
      || r.finalBg[i * 4] !== r.shadeBg[i * 4] || r.finalBg[i * 4 + 1] !== r.shadeBg[i * 4 + 1] || r.finalBg[i * 4 + 2] !== r.shadeBg[i * 4 + 2]
      || r.finalFg[i * 4 + 3] !== r.shadeFg[i * 4 + 3]) ? 1 : 0;
    o.hPlane[i] = r.hist[i * 4] | 0; o.hU[i] = bitsToF(r.hist[i * 4 + 1]); o.hV[i] = bitsToF(r.hist[i * 4 + 2]);
    o.hLevel[i] = r.hist[i * 4 + 3] & 255; o.hKind[i] = (r.hist[i * 4 + 3] >> 8) & 255;
  }
  return o;
}

export function createDiag() { return { frames: 0, pairs: 0, cells: 0, key: 0, glyphFlipOff: 0, glyphFlipOn: 0, all: {}, flipOff: {}, flipOn: {}, tookLevel: {}, tookSameLevelGlyph: {}, tookGlyphDiffers: {}, tookFgRgb: {}, dE: [], uvRatio: {}, flipCamStats: { sumDUV: 0, nDUV: 0 } }; }

function inc(h, k) { h[k] = (h[k] || 0) + 1; }
function copyTerms(d, s) { Object.assign(d, s); }
const relCur = {}, relPrev = {}, w = new Float64Array(3), pc = new Float64Array(3);

/**
 * @param diag createDiag() @param prev decoded bundle of N-1 (its own outHist/out = history for N) @param cur decoded bundle of N
 * @param st the stable pass state after beginFrame(N) (cur/prev terms, dEx..)
 */
export function addPair(diag, prev, cur, st, cols, rows, detailArr) {
  const n = cols * rows, valid = st.histValid;
  copyTerms(relCur, st.cur); relCur.eyeX = relCur.eyeY = relCur.eyeZ = 0;
  copyTerms(relPrev, st.prev); relPrev.eyeX = relPrev.eyeY = relPrev.eyeZ = 0;
  const ortho = relCur.ortho === 1;
  diag.pairs++;
  if (diag.dE.length < 6) diag.dE.push(`${st.dEx.toFixed(4)},${st.dEy.toFixed(4)} yaw ${st.prev.yawDeg.toFixed(2)}->${st.cur.yawDeg.toFixed(2)}`);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const i = row * cols + col;
    if (prev.kind[i] === 0 || cur.kind[i] === 0) continue;
    diag.cells++;
    if (prev.kind[i] !== cur.kind[i] || prev.mat[i] !== cur.mat[i] || prev.plane[i] !== cur.plane[i]) { diag.key++; continue; }
    const flipOff = prev.glyphFinal[i] !== cur.glyphFinal[i], flipOn = prev.glyphOut[i] !== cur.glyphOut[i];
    if (flipOff) diag.glyphFlipOff++;
    if (flipOn) diag.glyphFlipOn++;
    // reason chain for cur cell i against history (= prev frame output)
    let reason = 'took', hc = -1, hr = -1, dUV = 0, lim = 0, lvC = cur.level[i], lvP = 0, h = -1;
    const kind = cur.kind[i];
    if (!valid) reason = 'histInvalid';
    else if (kind === 8) reason = 'kind8model';
    else if (lvC === LEVEL_ANIM) reason = 'anim254';
    else if (cur.edge[i]) reason = 'edge';
    else if (!(cur.vd[i] > 0) || !Number.isFinite(cur.vd[i])) reason = 'vdBad';
    else {
      unprojectPitched(relCur, col, row, cur.vd[i], w);
      w[0] += st.dEx; w[1] += st.dEy; w[2] += st.dEz;
      worldToCell(relPrev, w[0], w[1], w[2], pc);
      if (!ortho && pc[2] <= 0) reason = 'behindPrev';
      else {
        hc = Math.floor(pc[0] + 0.5); hr = Math.floor(pc[1] + 0.5);
        if (!(hc >= 0 && hc < cols && hr >= 0 && hr < rows)) reason = 'outOfGrid';
        else {
          h = hr * cols + hc;
          if (prev.hKind[h] !== kind || prev.hPlane[h] !== cur.plane[i]) reason = prev.hKind[h] !== kind ? 'histKind' : 'histPlane';
          else {
            lvP = prev.hLevel[h];
            if (lvP === LEVEL_ANIM) reason = 'anim254';
            else if ((lvC === LEVEL_NONE) !== (lvP === LEVEL_NONE)) reason = 'mixed255';
            else {
              const detail = (detailArr ? detailArr[i] : 0) || DEFAULT_DETAIL;
              const du = cur.u[i] - prev.hU[h], dv = cur.v[i] - prev.hV[h];
              dUV = Math.sqrt(du * du + dv * dv); lim = UV_LIM_TEXELS / detail;
              if (dUV >= lim) { reason = 'uvDrift'; inc(diag.uvRatio, dUV / lim < 2 ? '1-2x' : dUV / lim < 4 ? '2-4x' : dUV / lim < 16 ? '4-16x' : '>16x'); }
            }
          }
        }
      }
    }
    if (reason === 'took' && lvC === LEVEL_NONE) reason = 'both255'; // both sides non-ramp: colours blend, glyph held unless the fg snapped (38.25 C.3)
    inc(diag.all, reason);
    if (flipOff) inc(diag.flipOff, reason);
    if (flipOn) inc(diag.flipOn, reason);
    if (reason === 'took' || reason === 'both255') {
      const dl0 = Math.abs(lvC - lvP), hg = prev.glyphOut[h], cg = cur.glyphFinal[i], og = cur.glyphOut[i];
      inc(diag.tookFgRgb, cur.fgSame[i] ? 'out==final' : 'out!=final(blended)');
      if (hg !== cg) inc(diag.tookGlyphDiffers, `dLevel${dl0 > 1 ? '>1' : dl0}: gpuOut=${og === hg ? 'hist' : og === cg ? 'cur' : 'other'}`);
    }
    if ((reason === 'took' || reason === 'both255') && (flipOff || flipOn)) {
      const dl = Math.abs(lvC - lvP);
      inc(diag.tookLevel, `${flipOff ? 'flipOff' : ''}${flipOn ? '+flipOn' : ''} dLevel=${dl > 1 ? '>1' : dl}`);
      if (dl <= 1) inc(diag.tookSameLevelGlyph, `${flipOff ? 'flipOff' : ''}${flipOn ? '+flipOn' : ''} histGlyph${prev.glyphOut[h] === cur.glyphFinal[i] ? '==' : '!='}curGlyph`);
    }
  }
}
