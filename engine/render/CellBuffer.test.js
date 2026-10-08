// UI-PLATE-01 AC2: CellBuffer._parseColor warns ONCE for undefined/invalid colour strings, keeps the white fallback.
import assert from 'node:assert/strict';
import { CellBuffer, _resetBadColorWarning } from './CellBuffer.js';

const warns = []; const w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
try {
  const cb = new CellBuffer(2, 1);
  assert.deepEqual(cb._parseColor('#ff8000'), [255, 128, 0]);
  assert.deepEqual(cb._parseColor('#f80'), [255, 136, 0]);
  assert.equal(warns.length, 0, 'valid colours never warn');
  _resetBadColorWarning();
  assert.deepEqual(cb._parseColor(undefined), [255, 255, 255], 'undefined -> white fallback');
  assert.equal(warns.length, 1); assert.ok(/invalid colour/.test(warns[0]));
  assert.deepEqual(cb._parseColor('red'), [255, 255, 255]); assert.deepEqual(cb._parseColor('#12345'), [255, 255, 255]);
  cb.setCell(0, 0, 'x', 'nope', undefined);
  assert.equal(warns.length, 1, 'warns once only');
  assert.equal(cb.fg[0], 255); assert.equal(cb.glyphIdx[0], 'x'.charCodeAt(0) - 32);
  _resetBadColorWarning(); cb._parseColor('#zzzzzz');
  assert.equal(warns.length, 2, 'latch re-armed by the test hook');
} finally { console.warn = w; }
console.log('CellBuffer.test.js: warn-once on invalid colours, white fallback unchanged.');
