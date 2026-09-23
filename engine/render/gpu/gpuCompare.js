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
//
// Architect review 1 item 1 (blocking): `?gpucompare=1` used to be a
// tautology. `shadeSurfaces` sets `mask[i] = 1` on every world cell, so pass
// 1's passthrough branch (`kind == 0 || mask`) let the JS-shaded cell
// through unchanged; the "GPU" readback was really the JS result compared
// with itself, and would PASS even with a completely broken shader. The fix
// lives in `runGpuCompare`: right before `pipeline.frame`/`present()`, it
// clears `cells.mask` and overwrites the JS layer of every `kind != 0` cell
// with a poison value the shader can never legitimately produce (glyph byte
// 255 - outside the 0..94 ASCII-32 glyph range - with fg/bg rgb forced to
// 0). Sky (`kind == 0`) is left untouched (it's legitimately a passthrough
// cell on both paths). If the readback still shows the poison signature
// anywhere, some cell took the passthrough branch instead of being shaded -
// `compareCells` counts those as `poisonedSurvivors`, which PASS requires
// to be exactly 0.

const TOLERANCE = 4;
const POISON_BYTE = 0; // poisoned fg/bg rgb channels
const POISON_GLYPH = 255; // outside the legal 0..94 glyph range

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
  let matZeroCount = 0, poisonedSurvivors = 0;
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

      // Architect review 1 item 1: a surviving poison signature in the GPU
      // readback means this cell took the passthrough branch instead of
      // being shaded - the exact tautology the poisoning is meant to catch.
      if (gpuFg[fi + 3] === POISON_GLYPH && gpuFg[fi] === POISON_BYTE && gpuFg[fi + 1] === POISON_BYTE &&
        gpuFg[fi + 2] === POISON_BYTE && gpuBg[fi] === POISON_BYTE && gpuBg[fi + 1] === POISON_BYTE && gpuBg[fi + 2] === POISON_BYTE) {
        poisonedSurvivors++;
      }

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
    matZeroCount, ruleMismatch, ruleTotal, poisonedSurvivors,
    pass: glyphMatchPct >= 99 && fgOutside === 0 && bgOutside === 0 && poisonedSurvivors === 0,
  };
}

/**
 * US-030a (14.2 item 8, `?gpucompare=1`): pure geometry-parity comparison
 * between the CPU caster's `GBuffer`/`DepthBuffer` output and a
 * `readbackGeometry()` result. Reports:
 *  - `kindMatchPct` over every cell excluding 4-neighbour-kind edge cells
 *    (>= 99.5% is the AC bar);
 *  - among cells where BOTH sides agree kind != 0 and are non-edge: `mat`/
 *    `planeId` equality counts, depth relative-error and u/v absolute-error
 *    (vs `1e-3 * depth`) violation counts (0 required for PASS).
 * `giBuf`/`gaBuf`/`depthBuf` are `readbackGeometry()`'s Uint32Array results
 * (4 uint32 per cell each, RGBA_INTEGER-shaped; only the real channels are
 * read - see that method's doc comment). Float fields are bit-cast back
 * with a shared Uint32Array/Float32Array view (test-only; no per-frame cost
 * concern here).
 */
const _f32ViewBuf = new ArrayBuffer(4);
const _f32View = new Float32Array(_f32ViewBuf);
const _u32View = new Uint32Array(_f32ViewBuf);
function u32ToF32(u) { _u32View[0] = u >>> 0; return _f32View[0]; }

export function compareGeometry(gbuf, depthArr, giBuf, gaBuf, depthBuf, cols, rows) {
  const n = cols * rows;
  const kind = gbuf.kind, mat = gbuf.mat, planeId = gbuf.planeId, u = gbuf.u, v = gbuf.v;
  let kindChecked = 0, kindMismatch = 0;
  let matched = 0, matEqual = 0, planeEqual = 0, depthViol = 0, uvViol = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const gpuKind = giBuf[i * 4 + 1] & 0xff;
      const edge = isEdgeCell(kind, cols, rows, x, y, i) || isEdgeCellU32(giBuf, cols, rows, x, y, i);
      if (edge) continue;
      kindChecked++;
      if (kind[i] !== gpuKind) { kindMismatch++; continue; }
      if (kind[i] === 0) continue; // both agree "sky" - nothing else to compare

      matched++;
      const gpuMat = (giBuf[i * 4 + 1] >>> 16) & 0xffff;
      const gpuPlaneId = giBuf[i * 4] | 0; // ToInt32 - matches JS's Int32Array planeId
      if (mat[i] === gpuMat) matEqual++;
      if (planeId[i] === gpuPlaneId) planeEqual++;

      const gpuU = u32ToF32(gaBuf[i * 4]);
      const gpuV = u32ToF32(gaBuf[i * 4 + 1]);
      const gpuDepth = u32ToF32(depthBuf[i * 4]);
      const cpuDepth = depthArr[i];
      const depthOk = !Number.isFinite(cpuDepth) && !Number.isFinite(gpuDepth) ||
        (Number.isFinite(cpuDepth) && Number.isFinite(gpuDepth) && Math.abs(gpuDepth - cpuDepth) <= 0.01 * Math.max(1, Math.abs(cpuDepth)));
      if (!depthOk) depthViol++;
      const tol = 1e-3 * Math.max(1, Math.abs(cpuDepth));
      if (Number.isFinite(cpuDepth) && (Math.abs(gpuU - u[i]) > tol || Math.abs(gpuV - v[i]) > tol)) uvViol++;
    }
  }

  const kindMatchPct = kindChecked ? 100 * (kindChecked - kindMismatch) / kindChecked : 100;
  return {
    kindChecked, kindMismatch, kindMatchPct,
    matched, matEqual, planeEqual, depthViol, uvViol,
    pass: kindMatchPct >= 99.5 && depthViol === 0 && uvViol === 0,
  };
}

// GPU-side edge-cell exclusion (mirrors isEdgeCell, reading the packed uint
// GI buffer instead of a plain kind array) - a cell whose CPU-side and
// GPU-side kind agree can still sit on a GPU-only "edge" (a boundary the CPU
// classifies differently one cell over); excluding both sides' edges keeps
// the comparison to cells where a mismatch is unambiguous.
function isEdgeCellU32(giBuf, cols, rows, x, y, i) {
  const k = giBuf[i * 4 + 1] & 0xff;
  const up = y > 0 ? i - cols : -1, dn = y < rows - 1 ? i + cols : -1;
  const lf = x > 0 ? i - 1 : -1, rt = x < cols - 1 ? i + 1 : -1;
  if (up >= 0 && (giBuf[up * 4 + 1] & 0xff) !== k) return true;
  if (dn >= 0 && (giBuf[dn * 4 + 1] & 0xff) !== k) return true;
  if (lf >= 0 && (giBuf[lf * 4 + 1] & 0xff) !== k) return true;
  if (rt >= 0 && (giBuf[rt * 4 + 1] & 0xff) !== k) return true;
  return false;
}

/**
 * Browser-only: casts one pose on both paths, reads GPU cells back and
 * reports the comparison. `pipeline` is a ready `GpuCellPipeline`.
 * `castFrame(cam)` = beginFrame + castSectors + computeDerivatives, shared
 * by both paths (depth parity is by construction, still reported).
 */
export function runGpuCompare(pipeline, fb, castFrame, poses, report) {
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows;
  const n = cols * rows;
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

    // Architect review 1 item 1: force the real GPU path instead of a
    // passthrough of the JS result just copied out above - clear the mask
    // and poison every non-sky cell of the JS layer (`fb.rt.cells`) that
    // `present()` is about to read, so a mismatch or a `poisonedSurvivors`
    // count > 0 is the only way this can still pass.
    poisonNonSky(fb.rt.cells, fb.gbuf.kind, n);

    pipeline.frame(fb, fb.light);
    fb.rt.present();
    // Read back exactly what present() sampled (the textures bound on its
    // units 0/1 after the draw - `RenderTargetGL.readbackPresent`), not a
    // texture picked by name; `pipeline.readback()` is the same thing on a
    // real target, and the fallback for test doubles without it.
    const { fg: gpuFg, bg: gpuBg } = fb.rt.readbackPresent ? fb.rt.readbackPresent() : pipeline.readback();

    const depthMatchPct = 100; // by construction: same castFrame() feeds both paths
    const cmp = compareCells(jsFg, jsBg, gpuFg, gpuBg, fb.gbuf.kind, cols, rows, fb.gbuf.rule, fb.gbuf.mat);
    const ok = cmp.pass && depthMatchPct >= 99;
    overallOk = overallOk && ok;
    rows_.push({ pose: pose.name || '(pose)', ...cmp, depthMatchPct, ok });
  }

  if (report) report(rows_, overallOk);
  return { rows: rows_, ok: overallOk };
}

// Clears `cells.mask` (so pass 1 can never take the "JS wins" passthrough
// branch for a real world cell) and overwrites the JS fg/bg layer of every
// `kind != 0` cell with the poison signature `compareCells` checks for
// (glyph byte 255, rgb 0) - test-only, never called from the frame loop.
export function poisonNonSky(cells, kind, n) {
  cells.mask.fill(0);
  const fg = cells.fg, bg = cells.bg;
  for (let i = 0; i < n; i++) {
    if (kind[i] === 0) continue; // sky legitimately passes through on both paths
    const fi = i * 4;
    fg[fi] = POISON_BYTE; fg[fi + 1] = POISON_BYTE; fg[fi + 2] = POISON_BYTE; fg[fi + 3] = POISON_GLYPH;
    bg[fi] = POISON_BYTE; bg[fi + 1] = POISON_BYTE; bg[fi + 2] = POISON_BYTE; bg[fi + 3] = 255;
  }
}

// Same poison, every cell, no `kind` needed - for the DDA parity page
// (`?gpucompare=1`), which runs the GPU frame BEFORE the CPU oracle so the
// GPU result can't borrow any CPU-pass side effect (the `ambientL` bug: the
// GPU path only looked right after a CPU cast had primed the light). On the
// DDA path sky is GPU-shaded too (`uGpuSky`), so poisoning it is harmless;
// `compareCells` counts survivors over `kind != 0` cells only, as before.
export function poisonAllCells(cells, n) {
  cells.mask.fill(0);
  const fg = cells.fg, bg = cells.bg;
  for (let i = 0; i < n; i++) {
    const fi = i * 4;
    fg[fi] = POISON_BYTE; fg[fi + 1] = POISON_BYTE; fg[fi + 2] = POISON_BYTE; fg[fi + 3] = POISON_GLYPH;
    bg[fi] = POISON_BYTE; bg[fi + 1] = POISON_BYTE; bg[fi + 2] = POISON_BYTE; bg[fi + 3] = 255;
  }
}
