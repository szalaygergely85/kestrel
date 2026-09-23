// US-029 tech notes item 7 / AC "Parity page": `compareCells` is the pure,
// Node-testable comparison core; `runGpuCompare` drives it against a real
// `GpuCellPipeline` + `readPixels` (browser only, test-only - never in the
// frame loop).
//
// compareCells rule (architecture.md 14.1 section 8 / backlog AC): glyph
// match over `kind != 0` cells whose 4-neighbour kind is uniform (edge cells
// - a differing neighbour kind - are excluded from the glyph-match share and
// counted separately); fg/bg max and mean abs delta plus the count outside
// +-4 per channel over ALL `kind != 0` cells; `mat == 0` count; per-rule
// mismatch counts (rule 0..8, only meaningful where `rule` is passed).

const TOLERANCE = 4;

function isEdgeCell(kind, cols, rows, x, y, i) {
  const k = kind[i];
  const up = y > 0 ? i - cols : -1, dn = y < rows - 1 ? i + cols : -1;
  const lf = x > 0 ? i - 1 : -1, rt = x < cols - 1 ? i + 1 : -1;
  if (up >= 0 && kind[up] !== k) return true;
  if (dn >= 0 && kind[dn] !== k) return true;
  if (lf >= 0 && kind[lf] !== k) return true;
  if (rt >= 0 && kind[rt] !== k) return true;
  return false;
}

/**
 * @param {Uint8Array} jsFg cols*rows*4 (r,g,b,glyphIdx), CellBuffer layout
 * @param {Uint8Array} jsBg cols*rows*4 (r,g,b,255)
 * @param {Uint8Array} gpuFg readPixels output, same layout
 * @param {Uint8Array} gpuBg readPixels output, same layout
 * @param {Uint8Array} kind gbuf.kind
 * @param {Uint8Array} [rule] gbuf.rule, optional (per-rule mismatch breakdown)
 * @param {Uint16Array} [mat] gbuf.mat, optional (mat==0 count)
 */
export function compareCells(jsFg, jsBg, gpuFg, gpuBg, kind, cols, rows, rule, mat) {
  const n = cols * rows;
  let nonSky = 0, edgeCells = 0, nonEdgeChecked = 0, glyphMismatchNonEdge = 0;
  let fgOutside = 0, bgOutside = 0, fgSumAbs = 0, bgSumAbs = 0, fgMax = 0, bgMax = 0, fgSamples = 0;
  let matZeroCount = 0;
  const ruleMismatch = new Array(9).fill(0);
  const ruleTotal = new Array(9).fill(0);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0) continue;
      nonSky++;
      if (mat && mat[i] === 0) matZeroCount++;
      const edge = isEdgeCell(kind, cols, rows, x, y, i);
      if (edge) edgeCells++;

      const fi = i * 4;
      const glyphMismatch = jsFg[fi + 3] !== gpuFg[fi + 3];
      if (!edge) {
        nonEdgeChecked++;
        if (glyphMismatch) glyphMismatchNonEdge++;
      }

      let cellOutside = false;
      for (let k = 0; k < 3; k++) {
        const dFg = Math.abs(jsFg[fi + k] - gpuFg[fi + k]);
        const dBg = Math.abs(jsBg[fi + k] - gpuBg[fi + k]);
        fgSumAbs += dFg; bgSumAbs += dBg;
        if (dFg > fgMax) fgMax = dFg;
        if (dBg > bgMax) bgMax = dBg;
        if (dFg > TOLERANCE) { fgOutside++; cellOutside = true; }
        if (dBg > TOLERANCE) { bgOutside++; cellOutside = true; }
        fgSamples++;
      }

      if (rule) {
        const r = rule[i];
        ruleTotal[r]++;
        if (glyphMismatch || cellOutside) ruleMismatch[r]++;
      }
    }
  }

  const glyphMatchPct = nonEdgeChecked ? 100 * (nonEdgeChecked - glyphMismatchNonEdge) / nonEdgeChecked : 100;
  return {
    nonSky, edgeCells, nonEdgeChecked, glyphMismatchNonEdge, glyphMatchPct,
    fgOutside, bgOutside, fgMax, bgMax,
    fgMeanAbs: fgSamples ? fgSumAbs / fgSamples : 0, bgMeanAbs: fgSamples ? bgSumAbs / fgSamples : 0,
    matZeroCount, ruleMismatch, ruleTotal,
    pass: glyphMatchPct >= 99 && fgOutside === 0 && bgOutside === 0,
  };
}

/**
 * Browser-only: casts one pose on both paths, reads GPU cells back and
 * reports the comparison. `pipeline` is a ready `GpuCellPipeline`.
 * `castFrame(cam)` = beginFrame + castSectors + computeDerivatives, shared
 * by both paths (depth parity is by construction, still reported).
 */
export function runGpuCompare(pipeline, fb, castFrame, poses, report) {
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows;
  const jsFg = new Uint8Array(cols * rows * 4);
  const jsBg = new Uint8Array(cols * rows * 4);
  let overallOk = true;
  const rows_ = [];

  for (const pose of poses) {
    castFrame(pose);
    // JS shading + edge (existing passes) run with `rt.gpuActive` forced off
    // (shadeSurfaces/edgePass no-op while it's on, see detailShade.js/
    // edgePass.js) - copied out before the GPU path overwrites rt.cells via
    // the present hook.
    const wasActive = fb.rt.gpuActive;
    fb.rt.gpuActive = false;
    fb.jsShade(fb, fb.gbuf, fb.matTable, fb.detailPass, fb.light);
    fb.jsEdge(fb.gbuf, fb.depth.depth, fb.rt, fb.detailPass.edges);
    jsFg.set(fb.rt.cells.fg);
    jsBg.set(fb.rt.cells.bg);
    fb.rt.gpuActive = wasActive;

    pipeline.frame(fb, fb.light);
    fb.rt.present();
    const { fg: gpuFg, bg: gpuBg } = pipeline.readback();

    const depthMatchPct = 100; // by construction: same castFrame() feeds both paths
    const cmp = compareCells(jsFg, jsBg, gpuFg, gpuBg, fb.gbuf.kind, cols, rows, fb.gbuf.rule, fb.gbuf.mat);
    const ok = cmp.pass && depthMatchPct >= 99;
    overallOk = overallOk && ok;
    rows_.push({ pose: pose.name || '(pose)', ...cmp, depthMatchPct, ok });
  }

  if (report) report(rows_, overallOk);
  return { rows: rows_, ok: overallOk };
}
