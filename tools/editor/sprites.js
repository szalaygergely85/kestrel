// tools/editor/sprites.js (US-031, docs/architecture.md 24.2) - the
// tools-side twin of `game/js/dev/spriteDev.js`'s `createSpriteSystem`:
// atlas + SpritePool + GpuSpritePass wiring, trimmed to what the editor
// needs (no `?sprite=1` test-prop spawner, no `?spritecompare=1` harness -
// those are game-only dev tools). Imports only engine/index.js (the editor
// may NOT import game/, per the engine boundary rule).
import {
  buildSpriteAtlas, SpritePool, GpuSpritePass, drawSprites, ambientL,
} from '../../engine/index.js';

export function createEditorSprites({ assets, rt, gpuPipeline }) {
  const atlas = buildSpriteAtlas(assets, assets.palette);
  const pool = new SpritePool(atlas, assets.palette);
  let pass = null;
  if (gpuPipeline && gpuPipeline.ready && rt.backend === 'gl2') {
    const candidate = new GpuSpritePass(rt, gpuPipeline, pool, atlas, assets.palette, { depthUint: true });
    if (candidate.ready) pass = candidate;
  }
  return {
    atlas, pool, pass,
    render(fb, world, cam) {
      pool.collect(world);
      pool.project(cam, fb.rt, fb.lights || ambientL, world);
      if (pass) {
        pass.sceneFade = typeof fb.sceneFade === 'number' ? fb.sceneFade : 1;
        if (fb.fadeLut) pass.setFadeLut(fb.fadeLut);
      }
      if (!(pass && pass.active)) drawSprites(fb, pool);
    },
  };
}
