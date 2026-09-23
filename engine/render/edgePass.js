// US-028 edge pass (docs/backlog.md tech notes item 7; reference:
// design/detail-pass.js `util.edgePass`). Runs once per frame after
// `shadeSurfaces`, over the whole G-buffer. Decides every cell's rule from
// the UNMODIFIED input first (kind/planeId/depth/fogF), then applies every
// decided rule in a second pass, so a rule never reads another cell's
// already-brightened/darkened output. Patches the render target's cell
// arrays DIRECTLY (never through `setCellRGB`), so the per-frame write
// counter `shadeSurfaces` already incremented stays put - this pass only
// ever touches cells `shadeSurfaces` wrote this same frame.
//
// Rule codes (gbuf.rule, 0 = none), in `DP.edges.rules` order:
export const RULE_CAP = 1;
export const RULE_LIP = 2;
export const RULE_SIDE = 3;
export const RULE_CONVEX = 4;
export const RULE_CONCAVE = 5;
export const RULE_SEAM_FLOOR = 6;
export const RULE_SEAM_CEIL = 7;
export const RULE_NOSING = 8;
const RULE_NAMES = ['cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing'];

function isVert(kind) { return kind === 1 || kind === 2 || kind === 3; }
function isUp(kind) { return kind === 4 || kind === 5; }

function farther(kind, planeId, depth, i, n) {
  if (n < 0) return false;
  if (kind[n] === 0) return true; // sky, or a cell never written this frame
  if (planeId[n] === planeId[i]) return false;
  return depth[n] > depth[i] * 1.18 + 0.35;
}

/**
 * @param {import('./GBuffer.js').GBuffer} gbuf
 * @param {Float32Array} depth - `fb.depth.depth`
 * @param {{cells:{glyphIdx:Uint8Array, fg:Uint8Array}}} rt - render target;
 *   `rt.cells` is the shared CellBuffer both back-ends expose (real game) or
 *   an equivalent shape (bench harness).
 * @param {object} edges - `DP.edges` (thresholds + `rules` glyph/gain table)
 */
export function edgePass(gbuf, depth, rt, edges) {
  const cols = gbuf.cols, rows = gbuf.rows;
  const kind = gbuf.kind, planeId = gbuf.planeId, fogF = gbuf.fogF, rule = gbuf.rule;
  const fogMax = edges.fogMax;
  rule.fill(0);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind[i] === 0 || fogF[i] > fogMax) continue;
      const up = y > 0 ? i - cols : -1;
      const dn = y < rows - 1 ? i + cols : -1;
      const lf = x > 0 ? i - 1 : -1;
      const rt2 = x < cols - 1 ? i + 1 : -1;

      let r = 0;
      if (farther(kind, planeId, depth, i, up)) r = RULE_CAP;
      else if (farther(kind, planeId, depth, i, dn)) r = RULE_LIP;
      else if (isVert(kind[i]) && (farther(kind, planeId, depth, i, lf) || farther(kind, planeId, depth, i, rt2))) r = RULE_SIDE;
      else if (isVert(kind[i]) && rt2 >= 0 && isVert(kind[rt2]) && planeId[rt2] !== planeId[i]) {
        const l2 = lf;
        const r2 = x < cols - 2 ? i + 2 : -1;
        const dl = l2 >= 0 && kind[l2] !== 0 ? depth[l2] : depth[i];
        const dr = r2 >= 0 && kind[r2] !== 0 ? depth[r2] : depth[rt2];
        if (depth[i] <= dl && depth[rt2] <= dr) r = RULE_CONVEX;
        else if (depth[i] >= dl && depth[rt2] >= dr) r = RULE_CONCAVE;
      }
      if (!r && isVert(kind[i]) && kind[i] !== 2 && dn >= 0 && isUp(kind[dn]) && depth[dn] <= depth[i] * 1.08) r = RULE_SEAM_FLOOR;
      if (!r && isVert(kind[i]) && up >= 0 && kind[up] === 6 && depth[up] <= depth[i] * 1.08) r = RULE_SEAM_CEIL;
      if (!r && kind[i] === 2 && up >= 0 && isUp(kind[up])) r = RULE_NOSING;
      rule[i] = r;
    }
  }

  const cells = rt.cells;
  const glyphIdxArr = cells.glyphIdx, fgArr = cells.fg;
  for (let i = 0; i < cols * rows; i++) {
    const r = rule[i];
    if (!r) continue;
    const R = edges.rules[RULE_NAMES[r - 1]];
    const code = R.glyph.charCodeAt(0);
    glyphIdxArr[i] = code < 32 || code > 126 ? 0 : code - 32;
    const fi = i * 4;
    for (let k = 0; k < 3; k++) {
      let v = Math.round(Math.min(255, fgArr[fi + k] * R.gain));
      if (v < 1) v = 1; // AC: edge colors are never pure black.
      fgArr[fi + k] = v;
    }
    fgArr[fi + 3] = glyphIdxArr[i]; // GL packing: fg alpha channel doubles as the glyph index.
  }
}
