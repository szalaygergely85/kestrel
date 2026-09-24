// engine/ui/fade.test.js (US-017). Headless Node ESM, no framework.
// Run: node engine/ui/fade.test.js
//
// Per the architect's tech notes (docs/backlog.md US-017 item 5): a = 1 is
// the identity, a = 0 gives space and black, letters use index 9, the fg
// gain curve, applySceneFade leaves mask cells alone, no allocation.
import { createFadeLut, fadeGlyph, applySceneFade } from './fade.js';
import { CellBuffer } from '../render/CellBuffer.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// A 10-step ramp (index 0 = space = darkest, index 9 = '@' = brightest),
// same shape/convention as design/palette.js's real ramps.
const RAMP = ' .,:;-=+*@'; // length 10, indices 0..9
const LETTER_INDEX = 9; // "letters use index 9" (test rule): arbitrary UI text starts fully bright
const MIN_GAIN = 0.1;
const lut = createFadeLut(RAMP, LETTER_INDEX, MIN_GAIN);

// ---------------------------------------------------------------------------
// 1. a = 1 is the identity.
// ---------------------------------------------------------------------------
{
  const code = 'H'.charCodeAt(0);
  ok('1a: fadeGlyph(a=1) returns the code unchanged', fadeGlyph(code, 1, lut) === code);
  ok('1b: fadeGlyph(a=1) unchanged for a ramp glyph too', fadeGlyph('*'.charCodeAt(0), 1, lut) === '*'.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// 2. a = 0 gives space (ramp[0]) - and, via applySceneFade, black.
// ---------------------------------------------------------------------------
{
  ok('2a: fadeGlyph(a=0) gives space for a letter', fadeGlyph('H'.charCodeAt(0), 0, lut) === 32);
  ok('2b: fadeGlyph(a=0) gives space for a ramp glyph', fadeGlyph('*'.charCodeAt(0), 0, lut) === 32);
}

// ---------------------------------------------------------------------------
// 3. Letters (not in the ramp) use `letterIndex` (9): halfway (a=0.5) lands
// on ramp[round(0.5*9)] = ramp[5] = '-'.
// ---------------------------------------------------------------------------
{
  const code = fadeGlyph('H'.charCodeAt(0), 0.5, lut);
  ok('3a: letters use letterIndex (9) for the ramp position', code === '-'.charCodeAt(0), String.fromCharCode(code));
}

// ---------------------------------------------------------------------------
// 4. A ramp glyph fades from its OWN index, not letterIndex: '+' is index 7
// in RAMP; at a=0.5 -> ramp[round(0.5*7)] = ramp[4] = ';'.
// ---------------------------------------------------------------------------
{
  const code = fadeGlyph('+'.charCodeAt(0), 0.5, lut);
  ok('4a: a ramp glyph fades from its own ramp index', code === ';'.charCodeAt(0), String.fromCharCode(code));
}

// ---------------------------------------------------------------------------
// 5. applySceneFade: the fg gain curve (fg *= minGain + (1-minGain)*a) and
// bg *= a, on a single non-mask cell.
// ---------------------------------------------------------------------------
{
  const cb = new CellBuffer(2, 1);
  cb.mask.fill(0); // simulate "written by the scene, not JS" (constructor leaves mask at 0)
  cb.setCellRGB(0, 0, 'H'.charCodeAt(0) - 32, 200, 100, 50, 40, 20, 10);
  cb.mask[0] = 0; // setCellRGB marks mask=1 (JS-owned) - force it back to "scene cell" for this test

  const rt = { cells: cb };
  applySceneFade(rt, 0.5, lut);

  const fgGain = MIN_GAIN + (1 - MIN_GAIN) * 0.5; // 0.55
  ok('5a: fg red channel follows the gain curve', cb.fg[0] === Math.round(200 * fgGain) || cb.fg[0] === (200 * fgGain) | 0, `${cb.fg[0]}`);
  ok('5b: bg red channel is bg * a', cb.bg[0] === (40 * 0.5) | 0, `${cb.bg[0]}`);
  // US-017 ARCH CHANGES #1 (found via ?gpucompare=1's sceneFade=0.5 pose):
  // CellBuffer duplicates the glyph index into fg[fi+3] (its RGBA8 upload
  // layout) - applySceneFade must keep BOTH copies in sync, or every reader
  // of `cb.fg` (GPU texture upload, readbackPresent, the compare tools)
  // sees the pre-fade glyph while `cb.glyphIdx` itself is correctly faded.
  ok('5c: fg[fi+3] (the duplicated glyph byte) stays in sync with glyphIdx', cb.fg[3] === cb.glyphIdx[0], `fg[3]=${cb.fg[3]} glyphIdx[0]=${cb.glyphIdx[0]}`);
}

// ---------------------------------------------------------------------------
// 6. applySceneFade leaves mask cells (mask[i] === 1) alone.
// ---------------------------------------------------------------------------
{
  const cb = new CellBuffer(2, 1);
  cb.setCellRGB(0, 0, 'H'.charCodeAt(0) - 32, 200, 100, 50, 40, 20, 10); // mask[0] = 1 (JS-drawn)
  const before = { glyph: cb.glyphIdx[0], fg0: cb.fg[0], bg0: cb.bg[0] };

  const rt = { cells: cb };
  applySceneFade(rt, 0, lut); // fully faded - would zero everything if it touched this cell

  ok('6a: mask cell glyph unchanged', cb.glyphIdx[0] === before.glyph);
  ok('6b: mask cell fg unchanged', cb.fg[0] === before.fg0);
  ok('6c: mask cell bg unchanged', cb.bg[0] === before.bg0);
}

// ---------------------------------------------------------------------------
// 7. a = 1 is a true no-op (identity) - applySceneFade must not touch the
// buffer at all, including mask cells, when fading is off.
// ---------------------------------------------------------------------------
{
  const cb = new CellBuffer(2, 1);
  cb.setCellRGB(0, 0, 'H'.charCodeAt(0) - 32, 200, 100, 50, 40, 20, 10);
  const snapshot = { glyph: cb.glyphIdx.slice(), fg: cb.fg.slice(), bg: cb.bg.slice() };

  applySceneFade({ cells: cb }, 1, lut);

  ok('7a: a=1 leaves glyphIdx untouched', cb.glyphIdx.every((v, i) => v === snapshot.glyph[i]));
  ok('7b: a=1 leaves fg untouched', cb.fg.every((v, i) => v === snapshot.fg[i]));
  ok('7c: a=1 leaves bg untouched', cb.bg.every((v, i) => v === snapshot.bg[i]));
}

// ---------------------------------------------------------------------------
// 8. No allocation: applySceneFade over many cells/frames must not grow the
// heap (a coarse smoke check - fadeGlyph/applySceneFade only ever write
// into pre-existing typed arrays, never `new` anything per cell).
// ---------------------------------------------------------------------------
{
  const cb = new CellBuffer(160, 60);
  for (let i = 0; i < cb.glyphIdx.length; i++) cb.glyphIdx[i] = i % 90;
  cb.mask.fill(0);
  const rt = { cells: cb };
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < 200; f++) applySceneFade(rt, 0.3 + (f % 10) * 0.01, lut);
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  // Loose bound (no --expose-gc guarantee in a plain `node` run): just
  // guards against a gross per-call allocation (e.g. a fresh array/object
  // per cell), not a strict zero-allocation proof (see tools/bench-cast.mjs
  // --gc for the real allocation oracle used elsewhere in this codebase).
  ok('8a: 200 applySceneFade calls over 160x60 do not blow up the heap', after - before < 20 * 1024 * 1024, `${after - before} bytes`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
