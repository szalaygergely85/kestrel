// engine/render/glyphAtlas.test.js - WG-1c2 (38.8a item 13). rasterizeGlyphAtlas is shared by RenderTargetGL and
// RenderTargetWebGPU, so a regression moves both identically and presentdiff cannot see it: pin it with a fake 2D context.
//   node engine/render/glyphAtlas.test.js
import { rasterizeGlyphAtlas, glyphAtlasPixels, blankGlyphs, GLYPH_COUNT } from './glyphAtlas.js';
import { FONT_STACK } from './glyphMetrics.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const log = [];
const ctx = {
  clearRect: (...a) => log.push(['clearRect', ...a]),
  fillText: (...a) => log.push(['fillText', ...a]),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), x, y, w, h }),
  set font(v) { log.push(['font', v]); }, set textBaseline(v) { log.push(['baseline', v]); },
  set textAlign(v) { log.push(['align', v]); }, set fillStyle(v) { log.push(['fill', v]); },
};
const canvas = { width: 0, height: 0 };
const m = { pxCellW: 9, pxCellH: 18, fontPx: 15, ascent: 14 };
const out = rasterizeGlyphAtlas(canvas, ctx, m);
const texts = log.filter((l) => l[0] === 'fillText');

ok('returns the canvas', out === canvas);
ok('GLYPH_COUNT = 95', GLYPH_COUNT === 95);
ok('canvas sized pxCellW*95 x pxCellH', canvas.width === 9 * 95 && canvas.height === 18);
ok('clearRect first over the whole strip', log[0][0] === 'clearRect' && log[0][1] === 0 && log[0][2] === 0 && log[0][3] === 9 * 95 && log[0][4] === 18);
ok('font string = fontPx + FONT_STACK', log.some((l) => l[0] === 'font' && l[1] === `15px ${FONT_STACK}`));
ok('alphabetic baseline, left aligned, white', log.some((l) => l[0] === 'baseline' && l[1] === 'alphabetic') && log.some((l) => l[0] === 'align' && l[1] === 'left') && log.some((l) => l[0] === 'fill' && l[1] === '#ffffff'));
ok('94 fillText calls (space skipped)', texts.length === 94);
ok('no space glyph drawn', texts.every((t) => t[1] !== ' '));
let pos = true;
for (const t of texts) {
  const idx = t[1].charCodeAt(0) - 32;
  if (t[2] !== idx * 9 || t[3] !== 14) pos = false;
}
ok('each glyph at (idx*pxCellW, ascent)', pos);
ok('first/last glyph are "!" and "~"', texts[0][1] === '!' && texts[93][1] === '~');
const px = glyphAtlasPixels(canvas, ctx);
ok('glyphAtlasPixels reads the whole strip', px.length === 9 * 95 * 18 * 4);

// ATLAS-GUARD blankGlyphs
{
  const lay = { pxCellW: 3, pxCellH: 2 }, W = 3 * 95;
  const full = new Uint8ClampedArray(W * 2 * 4).fill(255);
  ok('blankGlyphs: all filled -> []', blankGlyphs(full, lay).length === 0);
  const a = new Uint8ClampedArray(W * 2 * 4); // all blank
  ok('blankGlyphs: all blank = 94 codes, space ignored', blankGlyphs(a, lay).length === 94 && !blankGlyphs(a, lay).includes(32));
  const b = full.slice();
  for (const code of [109, 116]) for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) b[(y * W + (code - 32) * 3 + x) * 4 + 3] = 0;
  ok('blankGlyphs: two blank cells -> those codes', JSON.stringify(blankGlyphs(b, lay)) === '[109,116]');
  const c = new Uint8ClampedArray(W * 2 * 4); c[(1 * W + (65 - 32) * 3 + 2) * 4 + 3] = 1;
  ok('blankGlyphs: a single lit texel counts as filled', !blankGlyphs(c, lay, [65]).includes(65));
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
