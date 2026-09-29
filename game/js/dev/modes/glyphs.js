// US-048: `?glyphs=1` dev mode - the full glyph-ramp reference screen
// (game/js/dev/glyphsScene.js, drawn once via the normal render() path).
// This mode shares `runGame`'s render path on purpose (US-048 AC "do not
// restructure runGame's render path") - it is just `runGame('glyphs')`
// under a table entry, so the URL dispatch in main.js can be one uniform
// `MODES` lookup instead of a hand-written if/else per mode.
export const name = 'glyphs';

export function run(ctx) {
  ctx.runGame('glyphs');
}
