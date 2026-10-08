import assert from 'node:assert/strict';
import { CellBuffer, makeFrame } from '../../engine/index.js';
import { drawHighlightRect, drawHoverOutline, drawMarkers, drawSelectionHighlight } from './select.js';
import { EDITOR_PLATE_BG } from './overlayStyle.js';
import '../../design/items.js';

assert.equal(EDITOR_PLATE_BG, '#0a0b10');
assert.deepEqual(globalThis.ASSETS.items.toast.colors.plate, [10, 11, 16]);
const cb = new CellBuffer(80, 40);
let writes = 0;
const rt = { setCell(x, y, glyph, fg, bg) {
  assert.match(fg, /^#[\da-f]{6}$/i);
  assert.equal(bg, EDITOR_PLATE_BG);
  cb.setCell(x, y, glyph, fg, bg);
  writes++;
} };
drawHighlightRect(rt, { minCol: 25, maxCol: 30, minRow: 10, maxRow: 15 }, '#ffd24a');
drawHoverOutline(rt, 40, 20, '#7cfc7c');
assert.deepEqual(Array.from(cb.bg.slice((20 * 80 + 40) * 4, (20 * 80 + 40) * 4 + 4)), [10, 11, 16, 255]);
const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0, projection: 'pitched' };
const frame = makeFrame(0, 0, 0, 0);
const point = { id: 'lamp', x: 0, y: -4, z: 1 };
const world = {
  structures: [{ id: 'tower', frame, level: { name: 'tower', def: { lights: [point], interactables: [{...point,id:'note'}] } } }],
  entity() { return null; },
};
const before = writes;
drawMarkers(rt, cam, 80, 40, 4, 6, world, { colors: { gold: '#ffd24a', uiDim: '#666666' } }, null, 'mesh');
assert.equal(writes, before + 2, 'Both marker paths must draw');
const doc = { files: new Map([['level/tower', { def: { lights: [point] } }]]) };
// Marker-only selection resolves through the real editor document model.
drawSelectionHighlight(rt, cam, 80, 40, 4, 6, world, {}, doc,
  { fileId: 'level/tower', collection: 'lights', id: 'lamp', structId: 'tower' }, '#ffd24a', 'mesh');
assert.equal(writes, before + 3, 'Selected marker must draw');
console.log('overlayPlate: selection brackets, hover and markers use an explicit dark plate');
