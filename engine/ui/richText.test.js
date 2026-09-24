// engine/ui/richText.test.js (US-015). Headless Node ESM, no framework.
// Run: node engine/ui/richText.test.js
import { compileRichLine, drawRichLine, hexToRgb } from './richText.js';
import { createFadeLut } from './fade.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- hexToRgb ----
{
  ok('hexToRgb #rrggbb', JSON.stringify(hexToRgb('#ffb85a')) === JSON.stringify([255, 184, 90]));
  ok('hexToRgb #rgb shorthand', JSON.stringify(hexToRgb('#f00')) === JSON.stringify([255, 0, 0]));
}

// ---- compileRichLine ----
{
  const base = [10, 20, 30], key = [255, 200, 0];
  const line = compileRichLine('Press M', base, key, ['M']);
  ok('n matches text length', line.n === 'Press M'.length);
  ok('codes match char codes', line.codes[0] === 'P'.charCodeAt(0) && line.codes[6] === 'M'.charCodeAt(0));
  ok('non-key glyph gets baseRgb', line.rgb[0] === 10 && line.rgb[1] === 20 && line.rgb[2] === 30);
  const ki = 6 * 3;
  ok('key glyph gets keyRgb', line.rgb[ki] === 255 && line.rgb[ki + 1] === 200 && line.rgb[ki + 2] === 0);

  const multi = compileRichLine('WASD move', base, key, ['WASD']);
  ok('multi-char key highlights every char of the match', [0, 1, 2, 3].every((i) => multi.rgb[i * 3] === 255));
  ok('the space and "move" stay baseRgb', multi.rgb[4 * 3] === 10 && multi.rgb[5 * 3] === 10);
}

// ---- drawRichLine (fake RenderTarget) ----
function fakeRt(cols = 20, rows = 5) {
  const cells = new Map(); // "x,y" -> {glyphIdx, r,g,b, r2,g2,b2}
  return {
    cols, rows,
    setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) { cells.set(`${x},${y}`, { glyphIdx, r, g, b, r2, g2, b2 }); },
    _cells: cells,
  };
}

{
  const rt = fakeRt();
  const line = compileRichLine('Hi', [1, 2, 3], [4, 5, 6], []);
  drawRichLine(rt, 2, 1, line, 1, null);
  const c0 = rt._cells.get('2,1'), c1 = rt._cells.get('3,1');
  ok('drawRichLine writes each glyph at x+i', !!c0 && !!c1);
  ok('a=1 (identity): glyphIdx = code-32, unfaded color', c0.glyphIdx === 'H'.charCodeAt(0) - 32 && c0.r === 1 && c0.g === 2 && c0.b === 3);
}

{
  const rt = fakeRt();
  const line = compileRichLine('AB', [1, 2, 3], [4, 5, 6], []);
  const lut = createFadeLut(' .:-=+*#%@', 9, 0);
  drawRichLine(rt, 0, 0, line, 0, lut); // fully faded -> nothing drawn (space)
  ok('a=0 draws nothing (every glyph fades to space)', rt._cells.size === 0);
}

{
  const rt = fakeRt();
  const line = compileRichLine('AB', [100, 100, 100], [4, 5, 6], []);
  const lut = createFadeLut(' .:-=+*#%@', 9, 0.5);
  drawRichLine(rt, 0, 0, line, 0.5, lut);
  const c0 = rt._cells.get('0,0');
  ok('partial fade dims the color (minGain floor respected)', !!c0 && c0.r < 100 && c0.r >= 50);
}

{
  const rt = fakeRt();
  const line = compileRichLine('Hello', [1, 1, 1], [2, 2, 2], []);
  drawRichLine(rt, 0, 0, line, 1, null, 2); // typewriter: only first 2 glyphs
  ok('count limits the typewriter prefix', rt._cells.has('0,0') && rt._cells.has('1,0') && !rt._cells.has('2,0'));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
