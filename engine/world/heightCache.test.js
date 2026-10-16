// PERF-04: Terrain's out-of-band ground height cache returns heightAt bit for bit, and flushes on edit-layer changes.
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { createEditLayer, setSampleDh, setSampleType } from './terrainEdits.js';
// mock recipe: analytic height = smooth field + the bound edit layer's delta (like overworld_far's heightAt), no near band
let EDITS = null, calls = 0;
const g0 = { w: 2, h: 2, x0: 0, y0: 0, cell: 2, height: new Float32Array(4), type: new Uint8Array(4) };
const recipe = { map: { w: 64, h: 64, cell: 2 }, chunk: { size: 128, nearCell: 2 }, recipe: {},
  util: { heightAt: (x, y) => { calls++; return Math.sin(x * 0.013) * 7 + y * 1e-3 + (EDITS ? EDITS.heightDelta(x, y) : 0); }, typeAt: () => 0,
    gridHeight: () => null, bake: () => g0, generate: () => g0, setEditLayer: (l) => { EDITS = l; }, getEditLayer: () => EDITS } };
const t = new Terrain(recipe); // no near band: every groundAtBuf read takes the analytic (cached) path
const io = new Float64Array(10);
const g = (x, y) => { io[0] = x; io[1] = y; t.groundAtBuf(io); return io[3]; };
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const pts = []; for (let i = 0; i < 600; i++) pts.push([rnd() * 4000 - 500, rnd() * 4000 - 500]);
pts.push([0, 5], [-0, 5], [7, 0], [7, -0], [NaN, 1]);
for (let pass = 0; pass < 3; pass++) for (const [x, y] of pts) assert.ok(Object.is(g(x, y), t.groundAt(x, y)), `pass ${pass} (${x}, ${y})`);
// out-of-band repeat hits the cache and equals the analytic value
const far = [3900.25, 3700.5]; const h0 = g(far[0], far[1]);
assert.ok(Object.is(h0, t.heightAt(far[0], far[1]))); const c0 = calls; assert.ok(Object.is(g(far[0], far[1]), h0)); assert.equal(calls, c0, 'repeat = cache hit');
// an edit at that point flushes (identity change and version bump)
const layer = createEditLayer(2, 128); t.setEdits(layer);
const gi = Math.round(far[0] / 2), gj = Math.round(far[1] / 2);
assert.ok(Object.is(g(far[0], far[1]), t.heightAt(far[0], far[1])), 'new layer');
for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) setSampleDh(layer, gi + a, gj + b, 300);
const h1 = g(far[0], far[1]);
assert.ok(Object.is(h1, t.heightAt(far[0], far[1])), 'after setSampleDh'); assert.notEqual(h1, h0, 'edit raised the ground');
setSampleType(layer, gi, gj, 3); assert.ok(Object.is(g(far[0], far[1]), t.heightAt(far[0], far[1])), 'after setSampleType');
t.setEdits(null); assert.ok(Object.is(g(far[0], far[1]), h0), 'edits removed');
console.log('heightCache: PASS');
