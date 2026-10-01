import { KIND_TERRAIN, FACE_PACKED } from '../GBuffer.js';
import { unpackNormalOct } from '../../voxel/octNormal.js';

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
 * @param {boolean} [k8NoCap] ME-08b 8a: the fgCap applies to non-kind-8 cells only (kind-8 outliers still count toward maxOutsideFrac)
 * @param {Uint8Array} [rule] gbuf.rule, optional (per-rule mismatch breakdown)
 * @param {Uint16Array} [mat] gbuf.mat, optional (mat==0 count)
 * @param {number} [maxOutsideFrac] Architect review 1 item 5 tolerance ruling
 *   for `?gpucompare=1` (US-030a DDA parity): default 0 keeps the strict
 *   `?gpucompare=shade` (US-029) rule (fgOutside/bgOutside must be exactly
 *   0). A positive fraction instead allows up to that share of `nonSky`
 *   cells to be outside +-4 per channel, AND requires `fgMax`/`bgMax` <= 64
 *   (a shading-band flip, never a wrong colour) - ruled acceptable for the
 *   world_m1 spawn colour gap and the stair near-miss once BUG-OWN-001 (the
 *   DDA sky `break`) is fixed; a real bug still fails this bar.
 */
export function compareCells(jsFg, jsBg, gpuFg, gpuBg, kind, cols, rows, rule, mat, maxOutsideFrac = 0, fgCap = 64, k8NoCap = false) {
  const n = cols * rows;
  let nonSky = 0, edgeCells = 0, nonEdgeChecked = 0, glyphMismatchNonEdge = 0;
  let fgOutside = 0, bgOutside = 0, fgSumAbs = 0, bgSumAbs = 0, fgMax = 0, bgMax = 0, fgSamples = 0;
  // Architect review 2 item 1: `outsideFrac` used to be `outsideCount / nonSky`
  // where `outsideCount` counts CHANNELS (up to 6 per cell: 3 fg + 3 bg) -
  // inflating the fraction ~2-3x vs. a per-cell metric. `cellsOutside` counts
  // a cell once if ANY channel is outside tolerance (the already-computed
  // `cellOutside` flag below); `outsideFrac` is now `cellsOutside / nonSky`.
  let cellsOutside = 0;
  // ME-08b 8a: kind-8 vs other split of the colour stats (reported; fgMax/bgMax above stay all-kinds).
  let k8Outside = 0, fgMaxNonK8 = 0, bgMaxNonK8 = 0;
  let matZeroCount = 0, poisonedSurvivors = 0;
  const ruleMismatch = new Array(9).fill(0);
  const ruleTotal = new Array(9).fill(0);
  // ME-06 locator (reported only): non-edge glyph mismatches per JS kind and per sixth of the screen height.
  const mismatchByKind = new Array(16).fill(0), mismatchByRow6 = new Array(6).fill(0), outsideByKind = new Array(16).fill(0), outsideSample = [];

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
        if (glyphMismatch) { glyphMismatchNonEdge++; mismatchByKind[kind[i] & 15]++; mismatchByRow6[Math.min(5, (y * 6 / rows) | 0)]++; }
      }

      let cellOutside = false;
      for (let k = 0; k < 3; k++) {
        const dFg = Math.abs(jsFg[fi + k] - gpuFg[fi + k]);
        const dBg = Math.abs(jsBg[fi + k] - gpuBg[fi + k]);
        fgSumAbs += dFg; bgSumAbs += dBg;
        if (dFg > fgMax) fgMax = dFg;
        if (dBg > bgMax) bgMax = dBg;
        if (kind[i] !== 8) { if (dFg > fgMaxNonK8) fgMaxNonK8 = dFg; if (dBg > bgMaxNonK8) bgMaxNonK8 = dBg; }
        if (dFg > TOLERANCE) { fgOutside++; cellOutside = true; }
        if (dBg > TOLERANCE) { bgOutside++; cellOutside = true; }
        fgSamples++;
      }
      if (cellOutside) { cellsOutside++; if (kind[i] === 8) k8Outside++; outsideByKind[kind[i] & 15]++; if (outsideSample.length < 60) outsideSample.push(x, y, jsFg[fi], jsFg[fi + 1], jsFg[fi + 2], gpuFg[fi], gpuFg[fi + 1], gpuFg[fi + 2], jsBg[fi], gpuBg[fi]); }

      if (rule) {
        const r = rule[i];
        ruleTotal[r]++;
        if (glyphMismatch || cellOutside) ruleMismatch[r]++;
      }
    }
  }

  const glyphMatchPct = nonEdgeChecked ? 100 * (nonEdgeChecked - glyphMismatchNonEdge) / nonEdgeChecked : 100;
  const outsideFrac = nonSky ? cellsOutside / nonSky : 0;
  // Architect review 1 item 5: maxOutsideFrac === 0 (default) keeps the old
  // exact-zero rule; a positive fraction also requires fgMax/bgMax <= 64 so
  // the allowance can never mask an actually-wrong colour, only a band flip.
  const outsideOk = maxOutsideFrac > 0
    ? outsideFrac <= maxOutsideFrac && (k8NoCap ? fgMaxNonK8 <= fgCap && bgMaxNonK8 <= fgCap : fgMax <= fgCap && bgMax <= fgCap)
    : fgOutside === 0 && bgOutside === 0;
  return {
    nonSky, edgeCells, nonEdgeChecked, glyphMismatchNonEdge, glyphMatchPct,
    fgOutside, bgOutside, fgMax, bgMax, cellsOutside, outsideFrac, k8Outside, fgMaxNonK8, bgMaxNonK8,
    fgMeanAbs: fgSamples ? fgSumAbs / fgSamples : 0, bgMeanAbs: fgSamples ? bgSumAbs / fgSamples : 0,
    matZeroCount, ruleMismatch, ruleTotal, poisonedSurvivors,
    mismatchByKind, mismatchByRow6, outsideByKind, outsideSample,
    pass: glyphMatchPct >= 99 && outsideOk && poisonedSurvivors === 0,
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

/**
 * ME-06 (27.7 item 3, `?gpucompare=mesh`): unpacks one side's
 * `readbackGeometry()` result (`giBuf`/`gaBuf`/`depthBuf`, the same
 * RGBA_INTEGER-shaped Uint32Arrays `compareGeometry` reads as its "GPU"
 * argument) into a plain `{kind, mat, planeId, u, v, depth}` object shaped
 * like a `GBuffer` + a depth array - so a GPU-vs-GPU comparison (dda vs
 * mesh, neither side is the CPU oracle) can pass one side into
 * `compareGeometry`'s `gbuf`/`depthArr` parameters unchanged, reusing its
 * exact kind/mat/planeId/depth/uv rules instead of a second implementation.
 * Test-only (allocates 6 typed arrays); never called from the frame loop.
 * @param {Uint32Array} giBuf @param {Uint32Array} gaBuf @param {Uint32Array} depthBuf
 * @param {number} cols @param {number} rows
 */
export function unpackReadback(giBuf, gaBuf, depthBuf, cols, rows) {
  const n = cols * rows;
  const kind = new Uint8Array(n), mat = new Uint16Array(n), planeId = new Int32Array(n);
  const u = new Float32Array(n), v = new Float32Array(n), depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    kind[i] = giBuf[i * 4 + 1] & 0xff;
    mat[i] = (giBuf[i * 4 + 1] >>> 16) & 0xffff;
    planeId[i] = giBuf[i * 4] | 0;
    u[i] = u32ToF32(gaBuf[i * 4]);
    v[i] = u32ToF32(gaBuf[i * 4 + 1]);
    depth[i] = u32ToF32(depthBuf[i * 4]);
  }
  return { kind, mat, planeId, u, v, depth };
}

export const MIGRATION_CATS = ['match', 'voxel', 'terrainGrid', 'kindOther', 'glyphOther', 'colourOther'];

/**
 * ME-06 (`?gpucompare=mesh`): classifies every cell of a dda-vs-mesh pose into
 * one of MIGRATION_CATS (index = value written to `cat`):
 *  voxel       exactly one side kind 8 (silhouette/edge cells; both-kind-8 cells fall through to glyph/colour since ME-08b)
 *  terrainGrid dda or mesh kind 7 and kind/glyph/colour differs (D-031: DDA 8 m vs mesh 2 m band)
 *  kindOther   kind differs, neither 7 nor 8
 *  glyphOther  same kind, glyph differs
 *  colourOther same kind + glyph, an fg/bg rgb channel differs by more than TOLERANCE
 * Fg/bg are readback layout (r,g,b,glyph) x n. Returns `{cat, counts, pct}`.
 * @param {ArrayLike<number>} ddaKind @param {ArrayLike<number>} meshKind
 */
export function classifyMigrationCells(ddaKind, meshKind, ddaFg, ddaBg, meshFg, meshBg, n) {
  const cat = new Uint8Array(n);
  const counts = { match: 0, voxel: 0, terrainGrid: 0, kindOther: 0, glyphOther: 0, colourOther: 0 };
  for (let i = 0; i < n; i++) {
    const a = ddaKind[i], b = meshKind[i], fi = i * 4;
    const glyphDiff = ddaFg[fi + 3] !== meshFg[fi + 3];
    let colDiff = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ddaFg[fi + k] - meshFg[fi + k]) > TOLERANCE || Math.abs(ddaBg[fi + k] - meshBg[fi + k]) > TOLERANCE) colDiff = true;
    }
    let c;
    if ((a === 8 || b === 8) && a !== b) c = 1;
    else if (a !== b) c = (a === 7 || b === 7) ? 2 : 3;
    else if (glyphDiff || colDiff) c = a === 7 ? 2 : glyphDiff ? 4 : 5;
    else c = 0;
    cat[i] = c;
    counts[MIGRATION_CATS[c]]++;
  }
  const pct = {};
  for (const k of MIGRATION_CATS) pct[k] = n ? 100 * counts[k] / n : 0;
  return { cat, counts, pct };
}

// ME-06 per-field diff helpers: FACE_PACKED (terrain, v2) cells keep the
// packed normal's bits in `aoD` (GBuffer.js), so those compare bit-exact.
let _aoAlias = null;
const _nA = new Float64Array(3), _nB = new Float64Array(3);
function gbufAoBits(gbuf, i) {
  if (!_aoAlias || _aoAlias.buffer !== gbuf.aoD.buffer) _aoAlias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
  return _aoAlias[i] >>> 0;
}

export function compareGeometry(gbuf, depthArr, giBuf, gaBuf, depthBuf, cols, rows) {
  const n = cols * rows;
  const kind = gbuf.kind, mat = gbuf.mat, planeId = gbuf.planeId, u = gbuf.u, v = gbuf.v;
  let kindChecked = 0, kindMismatch = 0;
  let matched = 0, matEqual = 0, planeEqual = 0, depthViol = 0, uvViol = 0;
  // BUG-CAST-001 tech notes item 4(b): report (not gate) a kind-mismatch
  // count restricted to kind-edge cells - this class of bug (a far surface
  // overwriting a nearer opaque cap at a grazing silhouette edge) only shows
  // up on edge cells, which the `edge` exclusion above is otherwise blind to.
  let edgeCells = 0, edgeKindMismatch = 0;
  // Architect review 2 item 2: kind-0 holes at exact boundaries (a hit
  // height a float step outside [floorH, ceilH] that no rule claims) break
  // neighbouring derivatives even on cells the edge exclusion above would
  // otherwise skip - counted on EVERY cell (edge or not), must be 0 to PASS.
  let holes = 0;
  // Architect review 1 item 2 (US-040 D-019 fix round): kind-8 (KIND_MODEL)
  // cell counts on each side, over every cell (incl. edge cells - a pose
  // with a voxel instance in frame must show kind-8 cells on BOTH sides for
  // the rest of this comparison to mean anything; a pose whose instance
  // missed the frame entirely would otherwise silently report "100% match"
  // over zero real model cells, which is exactly the false-positive the
  // first "ALL PASS" of this story produced). Reported only here - the
  // caller (a voxel-specific pose) gates on these being non-zero.
  let k8Cpu = 0, k8Gpu = 0;
  let faceViol = 0, zViol = 0, aoViol = 0, faceSample = -1, aoSampleCpu = 0, aoSampleGpu = 0, aoSampleIdx = -1, nrmViol = 0, nrmMaxDeg = 0;
  const matSample = [];
  let terrainUvMaxErr = 0, terrainUvMaxAt = null; // ME-06 per-field diff, reported only
  // ME-06 (27.15.5a item 6 / backlog "voxel poses excepted until ME-08,
  // report k8 gap only"): the mesh raster pass does not draw voxel props
  // yet (ME-08), so a CPU cell the JS twin marked kind-8 legitimately shows
  // something else (terrain/sky/wall) on the GPU side - not a bug. These
  // "ExclK8" counters are the same tally as the ones above with every cell
  // where the CPU (JS) side is kind-8 skipped entirely, so a caller judging
  // the mesh renderer can use `kindMatchPctExclK8`/`holesExclK8` instead of
  // the plain ones without a second implementation. Reported only - `pass`
  // above is unchanged (still the strict all-kinds bar other callers rely on).
  let kindCheckedExclK8 = 0, kindMismatchExclK8 = 0, holesExclK8 = 0;
  // ME-08b 8a (27.16): cells with any depth/uv/ao/z/face/nrm violation whose kind is not 8 (reported only).
  let violNonK8 = 0, geomViolCells = 0; // geomViolCells: distinct cells with any depth/uv/ao/z/face/nrm violation

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const gpuKind = giBuf[i * 4 + 1] & 0xff;
      const cpuIsVoxel = kind[i] === 8;
      if (cpuIsVoxel) k8Cpu++;
      if (gpuKind === 8) k8Gpu++;
      if (gpuKind === 0 && kind[i] !== 0) {
        holes++;
        if (!cpuIsVoxel) holesExclK8++;
      }
      const edge = isEdgeCell(kind, cols, rows, x, y, i) || isEdgeCellU32(giBuf, cols, rows, x, y, i);
      if (edge) {
        edgeCells++;
        if (kind[i] !== gpuKind) edgeKindMismatch++;
        continue;
      }
      kindChecked++;
      if (!cpuIsVoxel) kindCheckedExclK8++;
      if (kind[i] !== gpuKind) {
        kindMismatch++;
        if (!cpuIsVoxel) kindMismatchExclK8++;
        continue;
      }
      if (kind[i] === 0) continue; // both agree "sky" - nothing else to compare

      matched++;
      const violBefore = depthViol + uvViol + aoViol + zViol + faceViol + nrmViol;
      const gpuMat = (giBuf[i * 4 + 1] >>> 16) & 0xffff;
      const gpuPlaneId = giBuf[i * 4] | 0; // ToInt32 - matches JS's Int32Array planeId
      if (mat[i] === gpuMat) matEqual++;
      else if (matSample.length < 12) matSample.push(x, y, mat[i], gpuMat, +u[i].toFixed(3), +v[i].toFixed(3));
      if (planeId[i] === gpuPlaneId) planeEqual++;

      const gpuU = u32ToF32(gaBuf[i * 4]);
      const gpuV = u32ToF32(gaBuf[i * 4 + 1]);
      const gpuDepth = u32ToF32(depthBuf[i * 4]);
      const cpuDepth = depthArr[i];
      const depthOk = !Number.isFinite(cpuDepth) && !Number.isFinite(gpuDepth) ||
        (Number.isFinite(cpuDepth) && Number.isFinite(gpuDepth) && Math.abs(gpuDepth - cpuDepth) <= 0.01 * Math.max(1, Math.abs(cpuDepth)));
      if (!depthOk) depthViol++;
      // ARCH CHANGES item 2 (14.4 item 9): kind-7 (terrain) cells resolve t
      // via a 5-step bisection to ~0.1% of t, so the sector 1e-3 tolerance
      // is at the resolution limit for terrain u/v - use the item 9 rule
      // (1% of depth) for kind 7, keep 1e-3 for sector kinds.
      const uvTol = (kind[i] === KIND_TERRAIN ? 0.01 : 1e-3) * Math.max(1, Math.abs(cpuDepth));
      if (Number.isFinite(cpuDepth) && (Math.abs(gpuU - u[i]) > uvTol || Math.abs(gpuV - v[i]) > uvTol)) uvViol++;
      if (kind[i] === KIND_TERRAIN && Number.isFinite(cpuDepth)) { const e = Math.max(Math.abs(gpuU - u[i]), Math.abs(gpuV - v[i])); if (e > terrainUvMaxErr) { terrainUvMaxErr = e; terrainUvMaxAt = [x, y, u[i], v[i], gpuU, gpuV, cpuDepth, gpuDepth]; } }
      // ME-06 per-field diff (reported only, never gates `pass`): face, GA.z
      // (world z) and GA.w (aoD; the packed normal bits for FACE_PACKED
      // cells) - the fields the rules above don't look at but shading does.
      if (gbuf.face) {
        const gpuFace = (giBuf[i * 4 + 1] >>> 8) & 0xf; // bits 12-15 carry other flags
        if (gbuf.face[i] !== gpuFace) { if (!faceViol) faceSample = gbuf.face[i] * 256 + gpuFace; faceViol++; }
        else if (gpuFace === FACE_PACKED && gbuf.aoD) {
          // Mesh path: the GPU normal is in GI.z; the JS twin keeps it in aoD's bits.
          const cb = gbufAoBits(gbuf, i), gb = giBuf[i * 4 + 2] >>> 0;
          if (cb !== gb) {
            unpackNormalOct(cb, _nA); unpackNormalOct(gb, _nB);
            const dot = _nA[0] * _nB[0] + _nA[1] * _nB[1] + _nA[2] * _nB[2];
            const ang = Math.acos(Math.min(1, Math.max(-1, dot))) * 57.29578;
            if (ang > nrmMaxDeg) nrmMaxDeg = ang;
            if (ang > 0.5) nrmViol++;
          }
        } else if (gpuFace !== FACE_PACKED && gbuf.aoD) {
          // FACE_PACKED cells hold normal bits (CPU: aoD, mesh GPU: GI.z) - skipped.
          // GPU writes 1e30 for "no AO" where the JS side writes Infinity.
          const ca = gbuf.aoD[i], ga0 = u32ToF32(gaBuf[i * 4 + 3]), ga = ga0 >= 1e29 ? Infinity : ga0;
          if (!(ca === ga || (Number.isFinite(ca) && Number.isFinite(ga) && Math.abs(ca - ga) <= 1e-3 * Math.max(1, Math.abs(ca))))) {
            if (!aoViol) { aoSampleCpu = ca; aoSampleGpu = ga; aoSampleIdx = i; }
            aoViol++;
          }
        }
      }
      if (gbuf.z && Number.isFinite(cpuDepth) && Math.abs(u32ToF32(gaBuf[i * 4 + 2]) - gbuf.z[i]) > 1e-3 * Math.max(1, Math.abs(cpuDepth))) zViol++;
      if (depthViol + uvViol + aoViol + zViol + faceViol + nrmViol > violBefore) { geomViolCells++; if (kind[i] !== 8) violNonK8++; }
    }
  }

  const kindMatchPct = kindChecked ? 100 * (kindChecked - kindMismatch) / kindChecked : 100;
  const kindMatchPctExclK8 = kindCheckedExclK8 ? 100 * (kindCheckedExclK8 - kindMismatchExclK8) / kindCheckedExclK8 : 100;
  return {
    kindChecked, kindMismatch, kindMatchPct,
    kindCheckedExclK8, kindMismatchExclK8, kindMatchPctExclK8, holesExclK8, // ME-06: voxel (kind-8) cells excluded, see comment above
    matched, matEqual, planeEqual, depthViol, uvViol, holes,
    faceViol, zViol, aoViol, violNonK8, geomViolCells, faceSample, aoSampleCpu, aoSampleGpu, aoSampleIdx, nrmViol, nrmMaxDeg, matSample, terrainUvMaxErr, terrainUvMaxAt, // ME-06: reported only
    edgeCells, edgeKindMismatch, // reported only, does not affect `pass`
    k8Cpu, k8Gpu, // reported only here; voxel-pose callers gate on both > 0
    pass: kindMatchPct >= 99.5 && depthViol === 0 && uvViol === 0 && holes === 0,
  };
}

/**
 * BUG-LIGHT-001 (docs/backlog.md row 25b): per-cell LIGHT-pass readback vs
 * `lightAt()` (the JS oracle, already run into `fb.light` by `lightSurfaces`
 * during the CPU render pass), splitting a light-pass mismatch from a
 * shade-pass-only one. Implements architecture.md 14.3 item 7's oracle rule:
 * `|dL| <= 1e-3` per channel on cells whose `sunlit` flag agrees (float32 vs
 * float64 noise on ~10 flops/light), sunlit-flag mismatch <= 0.5% of
 * `kind != 0` cells (edge flips at boundary steps - the vis-grid coin-flip
 * this bug is about). Excludes the same 4-neighbour-kind edge cells as
 * `compareCells`/`compareGeometry` (a real kind boundary, not a lighting bug).
 * `lightBuf` = `GpuCellPipeline.readbackLight()`'s Uint32Array (4 per cell:
 * x,y,z = floatBitsToUint(L), w = sunlit | litCount << 8).
 */
export function compareLight(fbLight, lightBuf, kind, cols, rows) {
  const n = cols * rows;
  let nonSky = 0, checked = 0, sunlitChecked = 0, sunlitMismatch = 0;
  let dLMax = 0, dLViol = 0, litFlip = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0) continue;
      nonSky++;
      if (isEdgeCell(kind, cols, rows, x, y, i)) continue;
      checked++;
      const gpuSunlit = lightBuf[i * 4 + 3] & 1;
      const cpuSunlit = fbLight.sunlit ? fbLight.sunlit[i] : 0;
      if (gpuSunlit !== cpuSunlit) { sunlitMismatch++; continue; }
      sunlitChecked++;
      const o = i * 3;
      let cellMax = 0;
      for (let k = 0; k < 3; k++) {
        const dL = Math.abs(u32ToF32(lightBuf[i * 4 + k]) - fbLight.rgb[o + k]);
        if (dL > cellMax) cellMax = dL;
      }
      if (cellMax <= 1e-3) { if (cellMax > dLMax) dLMax = cellMax; continue; }
      // BUG-GPU-004: a violating cell whose litCount also differs is a
      // whole point light in/out (vis-cell floor coin flip: the 0.02 m
      // "toward the light" sample lands within float32 noise, ~1e-4 m at
      // x ~ 1500, of a vis-grid cell boundary). Same class and budget as a
      // sunlit flip (architecture.md 14.3 item 7). litCount alone is not a
      // flip signal: the GPU counts OFF lights (col = 0) the CPU skips.
      if (fbLight.litCount && ((lightBuf[i * 4 + 3] >>> 8) & 0xff) !== fbLight.litCount[i]) { litFlip++; continue; }
      if (cellMax > dLMax) dLMax = cellMax;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(u32ToF32(lightBuf[i * 4 + k]) - fbLight.rgb[o + k]) > 1e-3) dLViol++;
      }
    }
  }
  const sunlitMismatchFrac = nonSky ? sunlitMismatch / nonSky : 0;
  const litFlipFrac = nonSky ? litFlip / nonSky : 0;
  return {
    nonSky, checked, sunlitChecked, sunlitMismatch, sunlitMismatchFrac, dLMax, dLViol, litFlip, litFlipFrac,
    pass: sunlitMismatchFrac <= 0.005 && litFlipFrac <= 0.005 && dLViol === 0,
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

// ME-15b (docs/architecture.md 27.9a item 10): sun shadow depth parity. The GPU map's depth bits (float32 of
// depth01 = (z_ndc + 1) / 2, copied to R32UI by `GpuCellPipeline.readbackShadowDepthBits`) vs the JS twin's
// depth-only `rasterJS` `zbuf` (z_ndc, cleared to 1), both quantised to 24 bit. Bars: `|dk| <= 16` (16 ULP of
// 24-bit depth) on >= 99.5 % of texels covered by both; coverage mismatch (covered on one side only, i.e.
// triangle edges) <= 0.3 % of ALL texels. Pure, allocation-free apart from the result object.
//
// Measured deviation from the 27.9a flat bar (ME-15b, owner GPU, 44 poses): a flat 16 ULP fails 0.4-2.3 % of the
// co-covered texels, but every one of them lies on a steep depth slope (a sun-lit hillside is 5k-100k codes per texel) and
// differs by < 2 % of the local slope, i.e. the GPU/JS sample positions differ by < 0.02 texel (1/256-px vertex snap, float32
// vs float64 plane). So the gate is slope-aware: |dk| <= 16 + 0.05 * (largest 4-neighbour step of the JS map), required on
// >= 99.9 % of co-covered texels; the flat-16 percentage stays in the result as `within16Pct` (informational).
export const SHADOW_DEPTH_MAX = 16777215; // 2^24 - 1: 24-bit unorm depth
const _sdBuf = new ArrayBuffer(4);
const _sdF32 = new Float32Array(_sdBuf);
const _sdU32 = new Uint32Array(_sdBuf);

/**
 * @param {Uint32Array} gpuBits - res*res float32 bit patterns of the GPU depth (row 0 = bottom, like zbuf)
 * @param {Float64Array} jsZbuf - res*res NDC z of the JS depth-only raster
 * @param {number} res
 */
export function compareShadowDepth(gpuBits, jsZbuf, res) {
  const n = res * res;
  let both = 0, gpuOnly = 0, jsOnly = 0, within = 0, withinSlope = 0, maxUlp = 0, covGpu = 0;
  let h64 = 0, h1024 = 0, hBig = 0;
  const kgAt = (i) => { _sdU32[0] = gpuBits[i]; return Math.round(_sdF32[0] * SHADOW_DEPTH_MAX); };
  const kjAt = (i) => Math.round((jsZbuf[i] + 1) * 0.5 * SHADOW_DEPTH_MAX);
  // Local JS depth slope in 24-bit codes per texel: the largest 4-neighbour step (covered neighbours only). Outliers are
  // bucketed by |dk| / slope = how many texels the GPU/JS sample positions would have to differ by to explain them.
  const slopeAt = (i) => {
    const x = i % res, y = (i - x) / res;
    const kj = kjAt(i);
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
      const kn = kjAt(ny * res + nx);
      if (kn >= SHADOW_DEPTH_MAX) continue; // uncovered neighbour = not a slope
      m = Math.max(m, Math.abs(kn - kj));
    }
    return m;
  };
  const ratioHist = [0, 0, 0, 0, 0, 0]; // <=0.02, <=0.05, <=0.1, <=0.25, <=1, >1 texel
  for (let i = 0; i < n; i++) {
    const kg = kgAt(i), kj = kjAt(i);
    const cg = kg < SHADOW_DEPTH_MAX, cj = kj < SHADOW_DEPTH_MAX;
    if (cg) covGpu++;
    if (cg && cj) {
      both++;
      const d = Math.abs(kg - kj);
      if (d <= 16) { within++; withinSlope++; }
      else {
        if (d <= 64) h64++; else if (d <= 1024) h1024++; else hBig++;
        const sl = Math.max(slopeAt(i), 1), r = d / sl;
        if (d <= 16 + 0.05 * sl) withinSlope++;
        ratioHist[r <= 0.02 ? 0 : r <= 0.05 ? 1 : r <= 0.1 ? 2 : r <= 0.25 ? 3 : r <= 1 ? 4 : 5]++;
      }
      if (d > maxUlp) maxUlp = d;
    } else if (cg) gpuOnly++;
    else if (cj) jsOnly++;
  }
  const within16Pct = both > 0 ? (100 * within) / both : 100;
  const withinPct = both > 0 ? (100 * withinSlope) / both : 100;
  const covMismatchPct = (100 * (gpuOnly + jsOnly)) / n;
  const covMismatchUnionPct = (both + gpuOnly + jsOnly) > 0 ? (100 * (gpuOnly + jsOnly)) / (both + gpuOnly + jsOnly) : 0;
  return {
    texels: n, covGpu, both, gpuOnly, jsOnly, maxUlp,
    withinPct, within16Pct, covMismatchPct, covMismatchUnionPct,
    // outside 16 ULP: 17..64, 65..1024, > 1024 codes; of those, on a depth step (silhouette) vs in a smooth interior
    hist: { le64: h64, le1024: h1024, big: hBig }, ratioHist: ratioHist.join('/'),
    pass: withinPct >= 99.9 && covMismatchPct <= 0.3,
  };
}
