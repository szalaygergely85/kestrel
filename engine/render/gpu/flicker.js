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
import { levelOfByte, covOfByte, uvDriftLimit, CHANNEL_SNAP, DEFAULT_DETAIL } from '../temporalStable.js';
import { KIND_MESH, KIND_MODEL } from '../GBuffer.js';

export const REPROJ_DEPTH_TOL = 0.05;
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
const bitsToF32 = (b) => { _u32[0] = b; return _f32[0]; };
let _tPrev = null, _tCur = null; const _w = new Float64Array(3), _pc = new Float64Array(3);

export function flickerReprojStep(prev, cur, camPrev, camCur, grid, out, hmap = null) {
  if (hmap) hmap.fill(-1); // AA-DIAG-01: history cell of every counted (n) cell, -1 = not counted
  if (!_tPrev) { _tPrev = createPitchedTerms(); _tCur = createPitchedTerms(); }
  pitchedTermsInto(_tPrev, camPrev, grid); pitchedTermsInto(_tCur, camCur, grid);
  const { cols, rows } = grid;
  const haveBg = !!(prev.bg && cur.bg);
  let n = 0, kind = 0, mat = 0, glyph = 0, colour = 0, excluded = 0;
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
      if (prev.fg[h * 4 + 3] !== cur.fg[i * 4 + 3]) { glyph++; continue; }
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
  out.kindPct = pct(kind); out.materialPct = pct(mat); out.glyphOnlyPct = pct(glyph); out.colourOnlyPct = pct(colour);
  out.totalPct = pct(kind + mat + glyph + colour);
  return out;
}

// AA-DIAG-01 (OB-208, ex AA-10): why do glyph-only flips survive the stable pass? Replays stableCell's reject order (temporalStable.js / stable.wgsl.js)
// for every counted cell (hmap from flickerReprojStep) whose surface key (kind, mat) is equal but whose STABLE OUTPUT glyph changed.
// `d`/`p` = this/last frame's diag readback: {GI, GA (4-wide u32), Depth (1-wide u32 f32 bits), level (u8 raw shade level byte),
// preFg (rgba8 edge output = stable input), shadeFg/shadeBg (rgba8 edge input), finalBg (rgba8), outFg (rgba8 stable output), hist (4-wide u32 OUT_HIST)}.
// `terms` = pitchedTerms of the current camera (tanHalfX/Y). Adds per-reason counts into `cnt` (keys GLYPH_REASONS) and kind counts into cnt.kinds.
export const GLYPH_REASONS = Object.freeze(['heldChanged', 'edge', 'kind', 'plane', 'mat', 'anim', 'mixed255', 'uvDrift', 'snap255', 'levelJump', 'replayHold']);
export function flickerGlyphReasons(d, p, hmap, cols, rows, terms, cnt) {
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
    else if (d.preFg[o] !== d.shadeFg[o] || d.preFg[o + 1] !== d.shadeFg[o + 1] || d.preFg[o + 2] !== d.shadeFg[o + 2] || d.preFg[o + 3] !== d.shadeFg[o + 3]
      || d.finalBg[o] !== d.shadeBg[o] || d.finalBg[o + 1] !== d.shadeBg[o + 1] || d.finalBg[o + 2] !== d.shadeBg[o + 2]) r = 'edge';
    else if (((hw >> 8) & 15) !== kind) r = 'kind';
    else if (p.hist[h * 4] !== d.GI[o] && !((hw >>> 16) === mat && (kind === KIND_MESH || kind === KIND_MODEL))) r = (hw >>> 16) === mat ? 'plane' : 'mat';
    else {
      const lvC = levelOfByte(d.level[i]), cov = covOfByte(d.level[i]), lvP = hw & 255;
      const c255 = lvC === 255, p255 = lvP === 255, joint = c255 !== p255 && cov >= 1 && cov <= 3;
      if (lvC === 254 || lvP === 254) r = 'anim';
      else if (c255 !== p255 && !joint) r = 'mixed255';
      else {
        const du = bitsToF32(d.GA[o]) - bitsToF32(p.hist[h * 4 + 1]), dv = bitsToF32(d.GA[o + 1]) - bitsToF32(p.hist[h * 4 + 2]);
        const vd = bitsToF32(d.Depth[i]);
        const lim = uvDriftLimit(vd, terms.tanHalfX, terms.tanHalfY, cols, rows, DEFAULT_DETAIL, terms.ortho === 1), dUV = Math.sqrt(du * du + dv * dv);
        if (dUV >= lim) { r = 'uvDrift'; const b = 'uv' + (dUV < 2 * lim ? '<2' : dUV < 4 * lim ? '<4' : '4+'); cnt.sub[b] = (cnt.sub[b] || 0) + 1; }
        else if (joint) r = 'replayHold';
        else if (c255) {
          let snapped = false;
          for (let k = 0; k < 3; k++) if (Math.abs(d.preFg[o + k] - p.outFg[h * 4 + k]) > CHANNEL_SNAP) snapped = true;
          r = snapped ? 'snap255' : 'replayHold';
        } else {
          const dl = Math.abs(lvC - lvP); r = dl > 1 ? 'levelJump' : 'replayHold';
          if (dl > 1) { const b = 'dl' + (dl === 2 ? '2' : dl <= 4 ? '3-4' : '5+') + (cov ? 'cov' : ''); cnt.sub[b] = (cnt.sub[b] || 0) + 1; }
        }
      }
    }
    cnt[r] = (cnt[r] || 0) + 1;
    const rk = r + ':' + kind; cnt.sub[rk] = (cnt.sub[rk] || 0) + 1;
  }
  cnt.n = (cnt.n || 0) + n; cnt.flips = (cnt.flips || 0) + flips;
  return cnt;
}
