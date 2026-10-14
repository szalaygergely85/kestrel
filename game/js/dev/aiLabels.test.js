import assert from 'node:assert/strict';
import { drawAiLabels } from './aiLabels.js';
const sim = { count: 3, state: new Uint8Array([2, 0, 0]), down: new Uint8Array([0, 0, 1]), steer: { x: new Float32Array([5, 200, 1]), y: new Float32Array([0, 0, 0]) } };
const cells = {}; const ui = { sx: 1, sy: 1, setGlyph(x, y, ch) { cells[x + ',' + y] = ch; } };
const proj = (x, y, z, o) => { o[0] = 50 + x; o[1] = 20; o[2] = 10; return o; };
assert.equal(drawAiLabels(ui, sim, proj, 0, 0, () => 0), 1); // far (200 m) and down slots skipped
assert.equal(Object.values(cells).join('').includes('Chasing'), true);
assert.equal(drawAiLabels(ui, null, proj, 0, 0, () => 0), 0);
console.log('aiLabels OK');
