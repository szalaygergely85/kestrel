// US-030b (docs/architecture.md 14.2 item 8): the GPU-side twin of
// tools/bench-cast.mjs's US-028a CPU flicker metric. Pure, Node-testable -
// no GL, no allocation inside the hot loop (`out` is the caller's reused
// scratch). Readback happens only in `?flicker=1` (game/js/main.js), never
// in the frame loop.
//
// A cell counts toward the `pct`/`interiorPct` metric when it is "the same
// surface" in both frames (kind/mat/planeId equal, kind != 0 in both) AND its
// 4 in-bounds neighbours have the same kind in both frames (excludes cells
// whose classification is still settling at a silhouette edge - the same
// "4-neighbour-kind" rule `compareCells`/`compare-detail-export.mjs` use).
// Reports the share of those cells whose final glyph (the shaded fg
// texture's alpha channel, which carries the byte-quantised glyph code -
// see shade.frag.js's `shadeFg.a = toByte01(glyphCode)`) changed.
//
// Architect review 1 item 1: that interior-only metric throws away exactly
// the surface-key churn (kind/mat/planeId flips at edges and joint lines)
// the coverage vote is meant to fix, so a vote could never move it. `total`/
// `totalPct` count every cell that is non-sky in BOTH frames (kind != 0 in
// both, no neighbour exclusion at all) whose glyph byte OR surface key
// (kind, mat, planeId) changed - this is the number the US-030b AC (>=20%
// lower than JS 1-ray) is measured on; `pct`/`interiorPct` stay for
// information (required only to not regress vs GPU n=1).
//
// `GI` is the RG32UI-shaped readback (`Uint32Array(4*n)`, as
// `GpuCellPipeline.readbackGeometry()` returns it - only .x/.y of each texel
// are meaningful, matching `RGBA_INTEGER` readback padding); `fg` is the
// RGBA8 readback (`Uint8Array(4*n)`) of the shaded (pre-edge or post-edge,
// caller's choice - see the module doc in main.js) fg layer.
//
// AA-01 (architecture.md 38.82): `colourPct` = % of the same non-sky-in-both cells whose max |delta| over the fg.rgb
// and bg.rgb bytes is > COLOUR_FLICKER_THRESHOLD (24, strictly greater). Needs the optional `prevBg`/`curBg`
// (RGBA8, `readbackCells().bg`); without them only fg.rgb is compared.
export const COLOUR_FLICKER_THRESHOLD = 24;

export function flickerStep(prevGI, prevFg, curGI, curFg, cols, rows, out, prevBg, curBg) {
  const haveBg = !!(prevBg && curBg);
  let colourChanged = 0;
  const n = cols * rows;
  const kindOf = (GI, i) => GI[i * 4 + 1] & 0xff;
  const matOf = (GI, i) => (GI[i * 4 + 1] >>> 16) & 0xffff;
  const pidOf = (GI, i) => GI[i * 4];

  let same = 0, changed = 0;
  let total = 0, totalChanged = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const pk = kindOf(prevGI, i), ck = kindOf(curGI, i);
      if (pk === 0 || ck === 0) continue;

      // `total`/`totalPct` (item 1): every non-sky-in-both cell, no
      // neighbour exclusion, counts a change on EITHER a surface-key flip
      // (kind/mat/planeId - what the vote targets) OR a glyph flip.
      total++;
      const keyChanged = pk !== ck || matOf(prevGI, i) !== matOf(curGI, i) || pidOf(prevGI, i) !== pidOf(curGI, i);
      const glyphChanged = prevFg[i * 4 + 3] !== curFg[i * 4 + 3];
      if (keyChanged || glyphChanged) totalChanged++;
      {
        const o = i * 4;
        let m = Math.abs(prevFg[o] - curFg[o]);
        let d = Math.abs(prevFg[o + 1] - curFg[o + 1]); if (d > m) m = d;
        d = Math.abs(prevFg[o + 2] - curFg[o + 2]); if (d > m) m = d;
        if (haveBg) {
          d = Math.abs(prevBg[o] - curBg[o]); if (d > m) m = d;
          d = Math.abs(prevBg[o + 1] - curBg[o + 1]); if (d > m) m = d;
          d = Math.abs(prevBg[o + 2] - curBg[o + 2]); if (d > m) m = d;
        }
        if (m > COLOUR_FLICKER_THRESHOLD) colourChanged++;
      }

      if (pk !== ck) continue;
      if (matOf(prevGI, i) !== matOf(curGI, i)) continue;
      if (pidOf(prevGI, i) !== pidOf(curGI, i)) continue;

      let neighOk = true;
      if (x > 0) { const ni = i - 1; if (kindOf(prevGI, ni) !== kindOf(curGI, ni)) neighOk = false; }
      if (neighOk && x < cols - 1) { const ni = i + 1; if (kindOf(prevGI, ni) !== kindOf(curGI, ni)) neighOk = false; }
      if (neighOk && y > 0) { const ni = i - cols; if (kindOf(prevGI, ni) !== kindOf(curGI, ni)) neighOk = false; }
      if (neighOk && y < rows - 1) { const ni = i + cols; if (kindOf(prevGI, ni) !== kindOf(curGI, ni)) neighOk = false; }
      if (!neighOk) continue;

      same++;
      if (glyphChanged) changed++;
    }
  }
  out.same = same;
  out.changed = changed;
  out.pct = same ? (100 * changed) / same : 0;
  out.total = total;
  out.totalChanged = totalChanged;
  out.totalPct = total ? (100 * totalChanged) / total : 0;
  out.colourChanged = colourChanged;
  out.colourPct = total ? (100 * colourChanged) / total : 0;
  return out;
}

// AA-01b (OB-198): the motion-compensated flicker metric. `flickerStep` compares cell i with cell i, but a 5 cm strafe moves
// the image 1-4 cells, so it measures image motion. This one reprojects each cell of the current frame into the previous
// camera (same maths as temporalStable.stabilize: unprojectPitched + worldToCell, history cell = floor(x + 0.5)) and compares
// it with the cell it lands on. Cells that land off screen, on sky, or on a surface at another depth (> DEPTH_TOL, i.e.
// disoccluded) are excluded from the denominator. Categories are mutually exclusive: kind > material > glyphOnly >
// colourOnly. planeId is NOT part of the key. `totalPct` = any of them.
// Inputs: {GI, fg, bg?, Depth} readbacks (Depth channel 0 = f32 bits, `readbackGeometry().Depth`); camPrev/camCur =
// {x,y,z,yawDeg,pitchDeg,vfovDeg?}; grid = {cols, rows, pxCellW, pxCellH}.
import { createPitchedTerms, pitchedTermsInto, unprojectPitched, worldToCell } from '../projection.js';
import { levelOfByte, covOfByte, uvDriftLimit, CHANNEL_SNAP, DEFAULT_DETAIL, GRAZE_K, GRAZE_CAP, hueShift } from '../temporalStable.js';
import { KIND_MESH, KIND_MODEL } from '../GBuffer.js';

export const REPROJ_DEPTH_TOL = 0.05;
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
const bitsToF32 = (b) => { _u32[0] = b; return _f32[0]; };
let _tPrev = null, _tCur = null; const _w = new Float64Array(3), _pc = new Float64Array(3);

// AA-14b (38.84): `shiftPct` = glyph changes explained as a line moving with the image: the glyph pair involves a line code
// (shade.wgsl line glyphs, `gcls`) AND the cur glyph sits at a 4-neighbour of the history cell in prev AND the prev glyph sits at a
// 4-neighbour of the cell in cur (both directions). `glyphOnlyPct` = glyphOnlyRawPct - shiftPct; `glyphOnlyRawPct` = the old definition.
function glyphAtNeighbour(fg, i, cols, rows, want) {
  const x = i % cols, y = (i - x) / cols;
  return (x > 0 && fg[(i - 1) * 4 + 3] === want) || (x < cols - 1 && fg[(i + 1) * 4 + 3] === want)
    || (y > 0 && fg[(i - cols) * 4 + 3] === want) || (y < rows - 1 && fg[(i + cols) * 4 + 3] === want);
}
export function flickerReprojStep(prev, cur, camPrev, camCur, grid, out, hmap = null, gcls = DEFAULT_GCLS) {
  if (hmap) hmap.fill(-1); // AA-DIAG-01: history cell of every counted (n) cell, -1 = not counted
  if (!_tPrev) { _tPrev = createPitchedTerms(); _tCur = createPitchedTerms(); }
  pitchedTermsInto(_tPrev, camPrev, grid); pitchedTermsInto(_tCur, camCur, grid);
  const { cols, rows } = grid;
  const haveBg = !!(prev.bg && cur.bg);
  let n = 0, kind = 0, mat = 0, glyph = 0, shift = 0, colour = 0, excluded = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const ck = cur.GI[i * 4 + 1] & 0xff;
      if (ck === 0) continue;
      const vd = bitsToF32(cur.Depth[i * 4]);
      if (!(vd > 0) || !Number.isFinite(vd)) { excluded++; continue; }
      unprojectPitched(_tCur, c, r, vd, _w);
      worldToCell(_tPrev, _w[0], _w[1], _w[2], _pc);
      if (_pc[2] <= 0) { excluded++; continue; }
      const hc = Math.floor(_pc[0] + 0.5), hr = Math.floor(_pc[1] + 0.5);
      if (!(hc >= 0 && hc < cols && hr >= 0 && hr < rows)) { excluded++; continue; }
      const h = hr * cols + hc;
      const pk = prev.GI[h * 4 + 1] & 0xff;
      const pvd = bitsToF32(prev.Depth[h * 4]);
      if (pk === 0 || !(Math.abs(pvd - _pc[2]) <= REPROJ_DEPTH_TOL * _pc[2])) { excluded++; continue; }
      n++;
      if (hmap) hmap[i] = h;
      if (pk !== ck) { kind++; continue; }
      if (((prev.GI[h * 4 + 1] >>> 16) & 0xffff) !== ((cur.GI[i * 4 + 1] >>> 16) & 0xffff)) { mat++; continue; }
      const pg = prev.fg[h * 4 + 3], cg = cur.fg[i * 4 + 3];
      if (pg !== cg) {
        glyph++;
        if ((gcls[cg] === GC_LINE || gcls[pg] === GC_LINE) && glyphAtNeighbour(prev.fg, h, cols, rows, cg) && glyphAtNeighbour(cur.fg, i, cols, rows, pg)) shift++;
        continue;
      }
      let m = 0;
      for (let k = 0; k < 3; k++) {
        let d = Math.abs(prev.fg[h * 4 + k] - cur.fg[i * 4 + k]); if (d > m) m = d;
        if (haveBg) { d = Math.abs(prev.bg[h * 4 + k] - cur.bg[i * 4 + k]); if (d > m) m = d; }
      }
      if (m > COLOUR_FLICKER_THRESHOLD) colour++;
    }
  }
  const pct = (v) => (n ? (100 * v) / n : 0);
  out.n = n; out.excluded = excluded;
  out.kindPct = pct(kind); out.materialPct = pct(mat); out.glyphOnlyRawPct = pct(glyph); out.shiftPct = pct(shift); out.glyphOnlyPct = pct(glyph - shift); out.colourOnlyPct = pct(colour);
  out.totalPct = pct(kind + mat + glyph + colour);
  return out;
}

// AA-18 (OB-208, diag only): for an 'edge' flip, was last frame's history cell an edge too (ePrev:edge|none), and which neighbour
// input fires now (first of up, dn, lf, rt; eTrig:sky = kind 0, eTrig:d<1.05 / d<1.2 / d+ = depth over the farther() threshold by that
// ratio, eTrig:other = no farther neighbour = convex/concave/seam). Soft / isVert gating of the real rule is not replayed.
function edgeWhy(d, p, i, h, cols, rows, sub) {
  const o = h * 4;
  let pe = false;
  for (let k = 0; k < 4; k++) if (p.preFg[o + k] !== p.shadeFg[o + k]) pe = true;
  const pk = 'ePrev:' + (pe ? 'edge' : 'none'); sub[pk] = (sub[pk] || 0) + 1;
  const x = i % cols, y = (i - x) / cols, dc = bitsToF32(d.Depth[i]), pl = d.GI[i * 4];
  let t = 'eTrig:other';
  for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const n = ny * cols + nx, nk = d.GI[n * 4 + 1] & 0xff;
    if (nk === 0) { t = 'eTrig:sky'; break; }
    if (d.GI[n * 4] === pl) continue;
    const q = bitsToF32(d.Depth[n]) / (dc * 1.18 + 0.35);
    if (q > 1) { t = q < 1.05 ? 'eTrig:d<1.05' : q < 1.2 ? 'eTrig:d<1.2' : 'eTrig:d+'; break; }
  }
  sub[t] = (sub[t] || 0) + 1;
  if (t === 'eTrig:other' && x + 1 < cols) { // convex/concave margin: min(|dl-di|, |dr-dRt|) / di (detail-pass rule 4/5 inputs)
    const kAt = (n) => d.GI[n * 4 + 1] & 0xff, dAt = (n) => bitsToF32(d.Depth[n]);
    const dl = x > 0 && kAt(i - 1) !== 0 ? dAt(i - 1) : dc, dRt = dAt(i + 1), dr = x + 2 < cols && kAt(i + 2) !== 0 ? dAt(i + 2) : dRt;
    const mg = Math.min(Math.abs(dl - dc), Math.abs(dr - dRt)) / dc;
    const mk = 'eM:' + (mg === 0 ? '0' : mg < 0.0001 ? '<.01%' : mg < 0.0003 ? '<.03%' : mg < 0.001 ? '<.1%' : mg < 0.002 ? '<.2%' : mg < 0.005 ? '<.5%' : '.5%+'); sub[mk] = (sub[mk] || 0) + 1;
    const ck = 'eC:' + ((d.GI[(i + 1) * 4] !== pl) ? 'plane' : 'same') + (p.GI[o] === p.GI[o + 4] ? '/pSame' : '/pDiff'); sub[ck] = (sub[ck] || 0) + 1;
  }
  const gk = 'eG:' + String.fromCharCode(32 + d.preFg[i * 4 + 3]) + (t === 'eTrig:other' ? '/o' : '/n'); sub[gk] = (sub[gk] || 0) + 1; // rule glyph now (o = no farther neighbour)
  const tk = t + (pe ? '/pe' : '/pn'); sub[tk] = (sub[tk] || 0) + 1;
}
// AA-DIAG-01 (OB-208, ex AA-10): why do glyph-only flips survive the stable pass? Replays stableCell's reject order (temporalStable.js / stable.wgsl.js)
// for every counted cell (hmap from flickerReprojStep) whose surface key (kind, mat) is equal but whose STABLE OUTPUT glyph changed.
// `d`/`p` = this/last frame's diag readback: {GI, GA (4-wide u32), Depth (1-wide u32 f32 bits), level (u8 raw shade level byte),
// preFg (rgba8 edge output = stable input), shadeFg/shadeBg (rgba8 edge input), finalBg (rgba8), outFg (rgba8 stable output), hist (4-wide u32 OUT_HIST)}.
// `terms` = pitchedTerms of the current camera (tanHalfX/Y). Adds per-reason counts into `cnt` (keys GLYPH_REASONS) and kind counts into cnt.kinds.
export const GLYPH_REASONS = Object.freeze(['heldChanged', 'edge', 'kind', 'plane', 'mat', 'anim', 'mixed255', 'uvDrift', 'snap255', 'levelJump', 'replayHold']);
// AA-14a (38.84): mixed255 split by the glyph on the 255 side + `lineShift` (the line moved with the image) + `octPop` (texel-hash octave change).
// Counts live next to the reasons in `cnt` (m255:* sum to mixed255; lineShift is a sub-count of m255:line; octPop counts any flip). Glyph byte = shade glyphCode (ascii - 32).
export const M255_KEYS = Object.freeze(['m255:line', 'm255:stip', 'm255:blank', 'm255:other', 'lineShift', 'octPop']);
export const GC_LINE = 1, GC_STIP = 2;
/** 256-entry glyph class table (0 other, GC_LINE, GC_STIP). Line codes = shade.wgsl lineGlyphCodeFast (- _ | / \); `extraLine` = e.g. a material's grid-cross code; `stipCodes` = fog haze/sparse codes. */
export function glyphClassTable(stipCodes = [], extraLine = []) {
  const t = new Uint8Array(256);
  for (const a of [45, 95, 124, 47, 92]) t[a - 32] = GC_LINE;
  for (const c of extraLine) if (c > 0 && c < 256) t[c] = GC_LINE;
  for (const c of stipCodes) if (c > 0 && c < 256 && t[c] === 0) t[c] = GC_STIP;
  return t;
}
const DEFAULT_GCLS = glyphClassTable();
// 4-neighbour of cell i holding a line glyph in `fg` (rgba8, glyph in alpha): code === want, or any line code when want < 0.
function lineAtNeighbour(fg, i, cols, rows, gcls, want) {
  const x = i % cols, y = (i - x) / cols;
  let g;
  if (x > 0) { g = fg[(i - 1) * 4 + 3]; if (gcls[g] === GC_LINE && (want < 0 || g === want)) return true; }
  if (x < cols - 1) { g = fg[(i + 1) * 4 + 3]; if (gcls[g] === GC_LINE && (want < 0 || g === want)) return true; }
  if (y > 0) { g = fg[(i - cols) * 4 + 3]; if (gcls[g] === GC_LINE && (want < 0 || g === want)) return true; }
  if (y < rows - 1) { g = fg[(i + cols) * 4 + 3]; if (gcls[g] === GC_LINE && (want < 0 || g === want)) return true; }
  return false;
}
// `terms.gcls` (glyphClassTable) and `terms.octave(frame, cellIndex)` (octave 0..3 of coverV/(maxCover*gv), diag-only) are optional.
// AA-26 (OB-208): diag twin of temporalStable.js grazeUvLimit on the measured frame's GI/GA (f64)
function diagGrazeLim(d, i, cols, rows, kind, mat, lim) {
  const x = i % cols, y = (i - x) / cols, u0 = bitsToF32(d.GA[i * 4]), v0 = bitsToF32(d.GA[i * 4 + 1]);
  const st = (j) => { const g = d.GI[j * 4 + 1]; if ((g & 0xff) !== kind || (g >>> 16) !== mat) return Infinity; const du = bitsToF32(d.GA[j * 4]) - u0, dv = bitsToF32(d.GA[j * 4 + 1]) - v0; return Math.sqrt(du * du + dv * dv); };
  let gx = Math.min(x > 0 ? st(i - 1) : Infinity, x < cols - 1 ? st(i + 1) : Infinity), gy = Math.min(y > 0 ? st(i - cols) : Infinity, y < rows - 1 ? st(i + cols) : Infinity);
  if (gx === Infinity) gx = 0; if (gy === Infinity) gy = 0;
  const g = Math.min(GRAZE_K * Math.max(gx, gy), GRAZE_CAP * lim); return g > lim ? g : lim;
}
// AA-DIAG-EDGE (OB-208): does the edge rule have a trigger at cell i? (sky neighbour, a different-plane neighbour farther than the farther() threshold,
// or a non-zero convex/concave depth margin). preFg != shadeFg without a trigger is NOT edge work (labels only; the cell falls through to its real reason).
function edgeTriggered(d, i, cols, rows) {
  const x = i % cols, y = (i - x) / cols, dc = bitsToF32(d.Depth[i]), pl = d.GI[i * 4];
  for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const n = ny * cols + nx;
    if ((d.GI[n * 4 + 1] & 0xff) === 0) return true;
    if (d.GI[n * 4] === pl) continue;
    if (bitsToF32(d.Depth[n]) / (dc * 1.18 + 0.35) > 1) return true;
  }
  if (x + 1 >= cols) return false;
  const kAt = (n) => d.GI[n * 4 + 1] & 0xff, dAt = (n) => bitsToF32(d.Depth[n]);
  const dl = x > 0 && kAt(i - 1) !== 0 ? dAt(i - 1) : dc, dRt = dAt(i + 1), dr = x + 2 < cols && kAt(i + 2) !== 0 ? dAt(i + 2) : dRt;
  return Math.min(Math.abs(dl - dc), Math.abs(dr - dRt)) / dc > 0;
}
// AA-29 (OB-208): why a mesh cell's ramp level jumped by 2+: raw light change at the cell vs the change of the AA-16 5x5 depth-gated
// same-material mean (folLight), and whether the window's member count changed. Keys: ljRaw/ljAvg <5|<15|15+ (pct), ljN= / ljN!.
const _lum = (L, o) => { const f = new Float32Array(L.buffer, o * 4, 3); return f[0] * 0.3 + f[1] * 0.59 + f[2] * 0.11; };
function folMean(D, i, cols, rows, mat) {
  const x = i % cols, y = (i / cols) | 0, dv = new Float32Array(D.Depth.buffer), d0 = dv[i], tol = 0.15 * d0 + 0.5;
  let s = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cx = x + dx, cy = y + dy; if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    const j = cy * cols + cx; if ((D.GI[j * 4 + 1] >>> 16) !== mat || Math.abs(dv[j] - d0) > tol) continue;
    s += _lum(D.Light, j * 4); n++;
  }
  return [n ? s / n : 0, n];
}
function leafJumpWhy(d, p, i, h, cols, rows, mat, up, sub) {
  const b = (a, c) => { const r = Math.abs(a - c) / Math.max(1e-4, Math.max(a, c)); return r < 0.05 ? '<5' : r < 0.15 ? '<15' : '15+'; };
  const [mc, nc] = folMean(d, i, cols, rows, mat), [mp, np] = folMean(p, h, cols, rows, mat);
  const k1 = 'ljRaw' + b(_lum(d.Light, i * 4), _lum(p.Light, h * 4)) + ':' + mat, k2 = 'ljAvg' + b(mc, mp) + ':' + mat;
  const k3 = 'ljN' + (nc === np ? '=' : '!') + ':' + mat, k4 = 'lj' + (up ? 'Up' : 'Dn') + ':' + mat;
  for (const k of [k1, k2, k3, k4]) sub[k] = (sub[k] || 0) + 1;
}
export function flickerGlyphReasons(d, p, hmap, cols, rows, terms, cnt) {
  const gcls = terms.gcls || DEFAULT_GCLS, octave = terms.octave || null;
  let n = 0, flips = 0;
  for (let i = 0; i < cols * rows; i++) {
    const h = hmap[i]; if (h < 0) continue;
    n++;
    const giY = d.GI[i * 4 + 1], kind = giY & 0xff, mat = giY >>> 16;
    const hw = p.hist[h * 4 + 3], pkind = p.GI[h * 4 + 1] & 0xff, pmat = p.GI[h * 4 + 1] >>> 16;
    if (pkind !== kind || pmat !== mat) continue; // kind / material class of the metric
    const og = d.outFg[i * 4 + 3];
    if (og === p.outFg[h * 4 + 3]) continue;
    flips++; cnt.kinds[kind] = (cnt.kinds[kind] || 0) + 1;
    const o = i * 4;
    let r;
    if (og !== d.preFg[o + 3]) r = 'heldChanged'; // the output glyph came from history, but not from the measured last frame's glyph
    else if ((d.preFg[o] !== d.shadeFg[o] || d.preFg[o + 1] !== d.shadeFg[o + 1] || d.preFg[o + 2] !== d.shadeFg[o + 2] || d.preFg[o + 3] !== d.shadeFg[o + 3]
      || d.finalBg[o] !== d.shadeBg[o] || d.finalBg[o + 1] !== d.shadeBg[o + 1] || d.finalBg[o + 2] !== d.shadeBg[o + 2])
      && (edgeTriggered(d, i, cols, rows) || (cnt.sub['edgeNoTrig:' + kind] = (cnt.sub['edgeNoTrig:' + kind] || 0) + 1, false))) r = 'edge';
    else if (((hw >> 8) & 15) !== kind) r = 'kind';
    else if (p.hist[h * 4] !== d.GI[o] && !((hw >>> 16) === mat && (kind === KIND_MESH || kind === KIND_MODEL))) r = (hw >>> 16) === mat ? 'plane' : 'mat';
    else {
      const lvC = levelOfByte(d.level[i]), cov = covOfByte(d.level[i]), lvP = hw & 255;
      const c255 = lvC === 255, p255 = lvP === 255, joint = c255 !== p255 && cov >= 1 && cov <= 3;
      if (lvC === 254 || lvP === 254) r = 'anim';
      else if (c255 !== p255 && !joint) {
        r = 'mixed255';
        const g = c255 ? og : p.outFg[h * 4 + 3], cl = gcls[g];
        const sub = g === 0 ? 'm255:blank' : cl === GC_LINE ? 'm255:line' : cl === GC_STIP ? 'm255:stip' : 'm255:other';
        cnt[sub] = (cnt[sub] || 0) + 1;
        if (cl === GC_LINE) { // the line glyph sits at a 4-neighbour of the ramp side's cell in the other frame (the line moved with the image)
          const moved = c255 ? lineAtNeighbour(p.outFg, h, cols, rows, gcls, -1) : lineAtNeighbour(d.outFg, i, cols, rows, gcls, g);
          if (moved) cnt.lineShift = (cnt.lineShift || 0) + 1;
        }
      }
      else {
        const du = bitsToF32(d.GA[o]) - bitsToF32(p.hist[h * 4 + 1]), dv = bitsToF32(d.GA[o + 1]) - bitsToF32(p.hist[h * 4 + 2]);
        const vd = bitsToF32(d.Depth[i]);
        const lim = uvDriftLimit(vd, terms.tanHalfX, terms.tanHalfY, cols, rows, DEFAULT_DETAIL, terms.ortho === 1), dUV = Math.sqrt(du * du + dv * dv);
        const gl = dUV >= lim ? diagGrazeLim(d, i, cols, rows, kind, mat, lim) : lim; // AA-26: same limit as the stable pass (AA-20 graze)
        if (dUV >= gl) { r = 'uvDrift'; const b = 'uv' + (dUV < 2 * lim ? '<2' : dUV < 4 * lim ? '<4' : '4+'); cnt.sub[b] = (cnt.sub[b] || 0) + 1;
          const lk = (lvC === lvP ? 'uvLv=:' : 'uvLv!:') + kind; cnt.sub[lk] = (cnt.sub[lk] || 0) + 1; const mk = 'uvMat:' + kind + ':' + mat; cnt.sub[mk] = (cnt.sub[mk] || 0) + 1;
          const gk = (gl <= lim ? 'gz0:' : dUV < 2 * gl ? 'gz1-2:' : 'gz2+:') + kind; // AA-26: vs the AA-20 graze limit
          cnt.sub[gk] = (cnt.sub[gk] || 0) + 1; const pk = (p.hist[h * 4] === d.GI[o] ? 'uvPl=:' : 'uvPl!:') + kind; cnt.sub[pk] = (cnt.sub[pk] || 0) + 1;
          if (p.GA) { const ru = bitsToF32(d.GA[o]) - bitsToF32(p.GA[h * 4]), rv = bitsToF32(d.GA[o + 1]) - bitsToF32(p.GA[h * 4 + 1]); // AA-30: raw prev uv vs held anchor
            const rk = (Math.sqrt(ru * ru + rv * rv) < gl ? 'uvRaw<:' : 'uvRaw>:') + kind + (p.hist[h * 4] === d.GI[o] ? '/pl=' : '/pl!'); cnt.sub[rk] = (cnt.sub[rk] || 0) + 1; }
          { let nb = 'uvNb-'; const hx = h % cols, hy = (h - hx) / cols; // AA-30: a 3x3 history neighbour with the current plane and uv in limit?
            for (let yy = hy - 1; yy <= hy + 1 && nb === 'uvNb-'; yy++) for (let xx = hx - 1; xx <= hx + 1; xx++) { if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
              const j = yy * cols + xx; if (j === h || p.hist[j * 4] !== d.GI[o]) continue; const nu = bitsToF32(d.GA[o]) - bitsToF32(p.hist[j * 4 + 1]), nv = bitsToF32(d.GA[o + 1]) - bitsToF32(p.hist[j * 4 + 2]);
              if (Math.sqrt(nu * nu + nv * nv) < gl) { nb = 'uvNb+'; break; } }
            const nk = nb + ':' + kind + (p.hist[h * 4] === d.GI[o] ? '/pl=' : '/pl!'); cnt.sub[nk] = (cnt.sub[nk] || 0) + 1; } }
        else if (joint) r = 'replayHold';
        else if (c255) {
          let snapped = false;
          for (let k = 0; k < 3; k++) if (Math.abs(d.preFg[o + k] - p.outFg[h * 4 + k]) > CHANNEL_SNAP) snapped = true;
          r = snapped ? 'snap255' : 'replayHold';
          if (snapped) { const pk = (p.outFg[h * 4] << 16) | (p.outFg[h * 4 + 1] << 8) | p.outFg[h * 4 + 2], ck = (d.preFg[o] << 16) | (d.preFg[o + 1] << 8) | d.preFg[o + 2];
            const sk = (hueShift(pk, ck) ? 'snH:' : 'snL:') + kind; cnt.sub[sk] = (cnt.sub[sk] || 0) + 1; } // AA-28: hue vs brightness-only snap
        } else {
          const dl = Math.abs(lvC - lvP); r = dl > 1 ? 'levelJump' : 'replayHold';
          if (dl > 1) { const b = 'dl' + (dl === 2 ? '2' : dl <= 4 ? '3-4' : '5+') + (cov ? 'cov' : ''); cnt.sub[b] = (cnt.sub[b] || 0) + 1; }
          if (dl > 1 && kind === KIND_MESH && d.Light && p.Light) leafJumpWhy(d, p, i, h, cols, rows, mat, lvC > lvP, cnt.sub); // AA-29
        }
      }
    }
    if (r === 'edge' || r === 'levelJump') { const mk = r + 'Mat:' + kind + ':' + mat; cnt.sub[mk] = (cnt.sub[mk] || 0) + 1; }
    if (r === 'edge') edgeWhy(d, p, i, h, cols, rows, cnt.sub); // AA-18 (OB-208): which edge-rule input made the outline
    if (octave && octave(d, i) !== octave(p, h)) cnt.octPop = (cnt.octPop || 0) + 1;
    cnt[r] = (cnt[r] || 0) + 1;
    const rk = r + ':' + kind; cnt.sub[rk] = (cnt.sub[rk] || 0) + 1;
    if (kind === KIND_MODEL) { // AA-21 (OB-208): kind-8 split static prop (objectId 0) / entity (beast, NPC, view model: objectId > 0), plane kept or not
      const ok = (d.GI[o + 3] ? 'k8e:' : 'k8s:') + r; cnt.sub[ok] = (cnt.sub[ok] || 0) + 1;
      const pk = ok + (p.hist[h * 4] === d.GI[o] ? '/pl=' : '/pl!'); cnt.sub[pk] = (cnt.sub[pk] || 0) + 1;
    }
  }
  cnt.n = (cnt.n || 0) + n; cnt.flips = (cnt.flips || 0) + flips;
  return cnt;
}
