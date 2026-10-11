import assert from 'node:assert/strict';
import { selectHints, createHintSet, pulseAlpha, pulseStep, buildHintColors, HINT_CAP, ALPHA_MIN, ALPHA_MAX, ALPHA_STEPS, HINT_GLYPH } from './useHints.js';

// fake projection: col = x*10, row = y*10, depth = 1 (x<0 => behind)
const project = (x, y, z, o) => { o[0] = x * 10; o[1] = y * 10; o[2] = x < 0 ? -1 : 1; return o; };
const grid = { cols: 100, rows: 50 };
const eye = { x: 0, y: 0, z: 1.6 };
const rec = (key, x, y, extra) => Object.assign({ key, x, y, z: 1.6, usedKey: null, requires: null }, extra);
const mk = (list, state = {}) => ({ interactables: list, state });
const out = createHintSet();

// reach: 3 m
let n = selectHints(mk([rec('a', 2, 2), rec('far', 3.5, 0.1)]), eye, null, project, grid, null, out);
assert.equal(n, 1); assert.equal(out.key[0], 'a');
// skip the crosshair target
n = selectHints(mk([rec('a', 1, 1), rec('b', 2, 1)]), eye, 'a', project, grid, null, out);
assert.equal(n, 1); assert.equal(out.key[0], 'b');
// used / requires
n = selectHints(mk([rec('u', 1, 1, { usedKey: 'used.u' }), rec('r', 1, 2, { requires: 'flag' }), rec('ok', 1, 2.5)], { 'used.u': true }), eye, null, project, grid, null, out);
assert.equal(n, 1); assert.equal(out.key[0], 'ok');
n = selectHints(mk([rec('r', 1, 2, { requires: 'flag' })], { flag: true }), eye, null, project, grid, null, out);
assert.equal(n, 1);
// on screen: behind (x<0), off right (col>=100 => x>=10, out of reach anyway) and below (row>=50 => y>=5, out of reach): use small grid
n = selectHints(mk([rec('behind', -1, 0.2), rec('low', 2, 1), rec('side', 2, 0.2)]), eye, null, project, { cols: 100, rows: 3 }, null, out);
assert.equal(n, 1); assert.equal(out.key[0], 'side');
// LOS stub
n = selectHints(mk([rec('blocked', 1, 1), rec('clear', 2, 1)]), eye, null, project, grid, (ax, ay, az, bx) => bx !== 1, out);
assert.equal(n, 1); assert.equal(out.key[0], 'clear');
// cap 6, nearest first, 9 candidates
const many = []; for (let i = 0; i < 9; i++) many.push(rec('k' + i, 0.2 + i * 0.3, 0.5));
n = selectHints(mk(many.slice().reverse()), eye, null, project, grid, null, out);
assert.equal(n, HINT_CAP);
assert.deepEqual(out.key.slice(0, 6), ['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
for (let i = 1; i < n; i++) assert.ok(out.dist[i] >= out.dist[i - 1]);
// pulse curve
let lo = 9, hi = 0;
for (let t = 0; t < 3.2; t += 0.01) { const a = pulseAlpha(t); lo = Math.min(lo, a); hi = Math.max(hi, a); const s = pulseStep(t); assert.ok(s >= 0 && s < ALPHA_STEPS); }
assert.ok(Math.abs(lo - ALPHA_MIN) < 1e-3 && Math.abs(hi - ALPHA_MAX) < 1e-3);
assert.ok(Math.abs(pulseAlpha(0) - pulseAlpha(1.6)) < 1e-9, 'period 1.6 s');
const cols = buildHintColors('#ffd24a'); assert.equal(cols.length, ALPHA_STEPS); assert.ok(cols.every((c) => /^#[0-9a-f]{6}$/.test(c)));
assert.ok(cols[0] < cols[ALPHA_STEPS - 1]);
// INT-HL-01 reject: glyph must survive CellBuffer.setCell (code 32..126 -> index code-32, never 0 = space)
const gcode = HINT_GLYPH.charCodeAt(0), gidx = gcode < 32 || gcode > 126 ? 0 : gcode - 32;
assert.equal(HINT_GLYPH.length, 1); assert.ok(gcode >= 33 && gcode <= 126 && gidx !== 0, 'hint glyph is visible printable ASCII');
console.log('useHints.test OK');
