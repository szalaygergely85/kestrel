// US-030c parity harness (AC "`?gpucompare=1` includes sprite cells and
// meets the US-029 thresholds"). Browser/test-only, never in the frame
// loop. Path-agnostic: the caller supplies `renderCpu(cam)` (the full CPU
// frame - surfaces, edge, sky - into fb.gbuf/fb.depth/rt.cells) and
// `renderGpu(cam)` (pipeline.frame + rt.present + readback -> {fg, bg}), so
// it works against US-029's upload path today and US-030a's DDA path once
// main.js wires it (see docs/backlog.md US-030c programmer notes).
//
// Per pose: place sprites -> project -> CPU frame + `drawSprites` (JS
// oracle) -> copy fg/bg + the sprite-cell set (`lastSpriteDepth`) ->
// `poisonNonSky` (the US-029 anti-tautology guard) -> GPU frame (the sprite
// pass runs inside present()) -> `compareCells` over the whole frame plus a
// sprite-cell-only breakdown (every cell the JS pass drew: glyph must match
// exactly, fg within +-4). PASS = compareCells.pass && the sprite cells hold.
import { compareCells, poisonNonSky } from './gpuCompare.js';
import { drawSprites, lastSpriteDepth } from '../sprites.js';

const TOLERANCE = 4;

/**
 * @param {Object} o
 * @param {import('../sprites.js').SpritePool} o.pool
 * @param {Object} o.fb - FrameBuffers ({ rt, depth, gbuf, palette, ... }) shared by both paths
 * @param {Array} o.poses - tools/bench-poses.js shape ({ name, x, y, z, yawDeg, pitchDeg })
 * @param {(pose, pool, cam) => void} o.placeSprites - fills the pool's raw list for this pose
 * @param {number[]} o.light - [r, g, b] (ambientL)
 * @param {(cam) => void} o.renderCpu
 * @param {(cam) => {fg: Uint8Array, bg: Uint8Array}} o.renderGpu
 */
export function runSpriteCompare(o) {
  const { pool, fb, poses, placeSprites, light, renderCpu, renderGpu } = o;
  const rt = fb.rt, cells = rt.cells, gbuf = fb.gbuf;
  const cols = cells.cols, rows = cells.rows, n = cols * rows;
  const jsFg = new Uint8Array(n * 4), jsBg = new Uint8Array(n * 4);
  const cpuKind = new Uint8Array(n);
  const isSprite = new Uint8Array(n);
  const out = [];
  let overallOk = true;

  for (const pose of poses) {
    const cam = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    pool.reset();
    placeSprites(pose, pool, cam);
    pool.project(cam, rt, light);

    // The JS oracle runs with `rt.gpuActive` forced off (US-029: `shadeSurfaces`/
    // `edgePass` no-op while a GPU pipeline owns the frame), same as runGpuCompare.
    const wasActive = rt.gpuActive;
    rt.gpuActive = false;
    renderCpu(cam);
    drawSprites(fb, pool);
    rt.gpuActive = wasActive;
    jsFg.set(cells.fg); jsBg.set(cells.bg);
    cpuKind.set(gbuf.kind);
    const sd = lastSpriteDepth();
    let spriteCells = 0;
    for (let i = 0; i < n; i++) { isSprite[i] = sd && sd[i] !== Infinity ? 1 : 0; spriteCells += isSprite[i]; }

    poisonNonSky(cells, gbuf.kind, n);
    const { fg: gpuFg, bg: gpuBg } = renderGpu(cam);

    const cmp = compareCells(jsFg, jsBg, gpuFg, gpuBg, cpuKind, cols, rows);
    let spriteGlyphMismatch = 0, spriteFgOutside = 0, spriteFgMax = 0, spriteCellsOverSky = 0;
    for (let i = 0; i < n; i++) {
      if (!isSprite[i]) continue;
      if (cpuKind[i] === 0) spriteCellsOverSky++;
      const fi = i * 4;
      if (jsFg[fi + 3] !== gpuFg[fi + 3]) spriteGlyphMismatch++;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(jsFg[fi + k] - gpuFg[fi + k]);
        if (d > spriteFgMax) spriteFgMax = d;
        if (d > TOLERANCE) spriteFgOutside++;
      }
    }
    const spritesOk = spriteGlyphMismatch === 0 && spriteFgOutside === 0;
    const ok = cmp.pass && spritesOk;
    overallOk = overallOk && ok;
    out.push({
      pose: pose.name || '(pose)', ...cmp, ok,
      spritesProjected: pool.count, spriteCells, spriteCellsOverSky, spriteGlyphMismatch, spriteFgOutside, spriteFgMax, spritesOk,
    });
  }
  return { rows: out, ok: overallOk };
}
