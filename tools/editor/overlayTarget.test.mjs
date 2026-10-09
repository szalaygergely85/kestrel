import assert from 'node:assert/strict';
import { createUiLayer } from '../../engine/index.js';
import { createOverlayTarget } from './overlayTarget.js';
const ui = createUiLayer({ cols: 160 }), rt = { cols: 320, rows: 120 };
const plate = createOverlayTarget(ui, rt), glyph = createOverlayTarget(ui, rt, { glyphOnly: true });
plate.setCell(10, 10, '+', '#ffffff', '#0a0b10');
assert.equal(ui.cells.bg[(5 * 160 + 5) * 4 + 3], 255, 'scene cell (10,10) -> ui (5,5), opaque plate');
glyph.setCell(40, 20, '.', '#7cfc7c', '#0a0b10');
assert.equal(ui.cells.bg[(10 * 160 + 20) * 4 + 3], 128, 'hover is glyph-only');
plate.setCell(-1, 0, '+', '#fff', '#000'); plate.setCell(999, 0, '+', '#fff', '#000'); // out of range: no throw
console.log('overlayTarget: scene cells map onto the ui grid (plate + glyph-only) PASS');
