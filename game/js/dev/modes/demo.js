// US-048: `?demo=1` dev mode - the interpolated demo scene
// (game/js/dev/demoScene.js, drawn once per frame via the normal render()
// path). Same "just runGame under a table entry" shape as glyphs.js - see
// its comment.
export const name = 'demo';

export function run(ctx) {
  ctx.runGame('demo');
}
