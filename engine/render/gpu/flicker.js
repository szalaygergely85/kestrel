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
export function flickerStep(prevGI, prevFg, curGI, curFg, cols, rows, out) {
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
  return out;
}
