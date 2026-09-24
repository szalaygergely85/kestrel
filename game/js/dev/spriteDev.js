// game/js/dev/spriteDev.js (US-030c): game-side glue for billboard sprites -
// builds the atlas + pool + GPU pass once, renders sprites per frame on
// whichever path is active, spawns the `?sprite=1` test props, and runs the
// `?spritecompare=1` parity mode. Imports only engine/index.js (check-deps
// rule 3). Used by game/js/dev/spritesPage.js today; main.js wiring is a
// 4-line call surface (see docs/backlog.md US-030c programmer notes):
//
//   const sprites = createSpriteSystem({ assets, rt, gpuPipeline });     // after the pipeline gate
//   if (params.get('sprite') === '1') spawnTestSprites(world, playerHandle.data.transform);
//   sprites.render(fb, engine.world, cam);   // in render(), right after renderWorld(...), before rt.present()
//   extra += sprites.overlayLine();          // F3 overlay (optional)
import {
  buildSpriteAtlas, SpritePool, GpuSpritePass, drawSprites, runSpriteCompare, ambientL,
} from '../../../engine/index.js';

export function createSpriteSystem({ assets, rt, gpuPipeline }) {
  const atlas = buildSpriteAtlas(assets, assets.palette);
  const pool = new SpritePool(atlas, assets.palette);
  let pass = null;
  if (gpuPipeline && gpuPipeline.ready && rt.backend === 'gl2') {
    const candidate = new GpuSpritePass(rt, gpuPipeline, pool, atlas, assets.palette, { depthUint: true });
    if (candidate.ready) pass = candidate;
  }
  console.log(`[GpuSpritePass] ${pass ? 'active' : 'inactive - drawSprites (JS)'}  atlas ${atlas.width}x${atlas.height}, ${atlas.frames.length} frames, ${atlas.models.size} models`);

  return {
    atlas, pool, pass,
    /** Per frame: collect + project; JS `drawSprites` unless the GPU pass composites them inside present(). */
    render(fb, world, cam) {
      pool.collect(world);
      pool.project(cam, fb.rt, ambientL);
      // US-017: hand the GPU sprite pass this frame's scene fade (mirrors
      // `fb.sceneFade`/`fb.fadeLut`, the CPU path's own inputs) - `active`
      // is checked below for the composite itself, but the fade fields must
      // be current whenever `present()` later calls `pass.run()`.
      if (pass) {
        pass.sceneFade = typeof fb.sceneFade === 'number' ? fb.sceneFade : 1;
        if (fb.fadeLut) pass.setFadeLut(fb.fadeLut);
      }
      if (!(pass && pass.active)) drawSprites(fb, pool);
    },
    overlayLine() {
      const gpu = pass && pass.active;
      return `sprites: ${pool.count}${pool.dropped ? ` (+${pool.dropped} dropped)` : ''}  ${gpu ? `gpu ${Number.isNaN(pass.stats.gpuMsP50) ? 'n/a' : pass.stats.gpuMsP50.toFixed(2) + 'ms'}  upload ${pass.stats.uploadMs.toFixed(2)}ms` : 'js'}`;
    },
  };
}

/**
 * `?sprite=1`: three test props relative to the player's spawn (facing
 * direction `yawDeg`, compass: 0 = N = -y, clockwise): a burning brazier 5 m
 * ahead on the floor, an unlit lantern 4 m ahead / 1 m left hanging at
 * 1.3 m, and a lit lantern 14 m ahead (below the 0.75 scale -> half LOD).
 */
export function spawnTestSprites(world, t) {
  const yaw = t.yawDeg * Math.PI / 180;
  const dx = Math.sin(yaw), dy = -Math.cos(yaw), rx = -dy, ry = dx;
  const at = (ahead, right, z) => ({ x: t.x + dx * ahead + rx * right, y: t.y + dy * ahead + ry * right, z: t.z + z, yawDeg: 0, pitchDeg: 0 });
  world.spawn('prop', at(5, 0, 0), { sprite: { model: 'brazier', anim: 'burn', frame: 2 } }, 'test_brazier');
  world.spawn('prop', at(4, -1, 1.3), { sprite: { model: 'lantern', anim: 'unlit', frame: 0 } }, 'test_lantern');
  world.spawn('prop', at(14, 1, 1.3), { sprite: { model: 'lantern', anim: 'lit', frame: 1 } }, 'test_lantern_far');
}

/** The same three props, placed per pose for the parity harness (no World needed). */
export function placeCompareSprites(pose, pool) {
  const yaw = pose.yawDeg * Math.PI / 180;
  const dx = Math.sin(yaw), dy = -Math.cos(yaw), rx = -dy, ry = dx;
  const floorZ = pose.z - 1.6;
  const at = (ahead, right) => [pose.x + dx * ahead + rx * right, pose.y + dy * ahead + ry * right];
  let p = at(4, 0); pool.push('brazier', 'burn', 2, p[0], p[1], floorZ);
  p = at(3, -1); pool.push('lantern', 'unlit', 1, p[0], p[1], floorZ + 1.3);
  p = at(12, 1); pool.push('lantern', 'lit', 0, p[0], p[1], floorZ + 1.3);
}

/**
 * `?spritecompare=1`: sprite parity over the bench poses. `renderCpu`/
 * `renderGpu` come from the page (they know the pipeline/path wiring).
 */
export function runSpriteCompareMode({ sprites, fb, poses, renderCpu, renderGpu, overlay, rendererString }) {
  const { rows, ok } = runSpriteCompare({ pool: sprites.pool, fb, poses, placeSprites: placeCompareSprites, light: ambientL, renderCpu, renderGpu });
  let text = `?spritecompare=1  GpuSpritePass: ${rendererString}  grid: ${fb.rt.cols}x${fb.rt.rows}\n`;
  for (const r of rows) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  frame: glyph ${r.glyphMatchPct.toFixed(2)}%  fgOut ${r.fgOutside}  bgOut ${r.bgOutside}  fgMax ${r.fgMax} bgMax ${r.bgMax}  poisonedSurvivors ${r.poisonedSurvivors}\n` +
      `  sprites: projected ${r.spritesProjected}  cells ${r.spriteCells} (over sky ${r.spriteCellsOverSky})  glyphMismatch ${r.spriteGlyphMismatch}  fgOut ${r.spriteFgOutside}  fgMax ${r.spriteFgMax}\n`;
    console.log(`[spritecompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: spriteCells=${r.spriteCells} glyphMismatch=${r.spriteGlyphMismatch} fgOut=${r.spriteFgOutside} frameGlyph=${r.glyphMatchPct.toFixed(2)}% poisoned=${r.poisonedSurvivors}`);
  }
  text += `\n${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[spritecompare] ${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`);
  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__spriteCompare = { rows, ok };
  return { rows, ok };
}
