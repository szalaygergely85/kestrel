import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { hash2, scatterTrees, validateScatterConfig } from './scatter.js';

let checks = 0;
const ok = (v) => { assert.ok(v); checks++; };
const cfg = { seed: 7349, cellM: 6, jitter: 1.5, fill: 0.8, maxTrees: 1500, lodCells: 6,
  species: [{ model: 'a', weight: 1, trunkR: 0.4, trunkH: 3 }, { model: 'b', weight: 3, trunkR: 0.7, trunkH: 4 }] };
function fixture(x0 = 0, y0 = 0, mixed = false) {
  const g = { x0, y0, w: 192, h: 192, cell: 2, height: new Float32Array(192 * 192), type: new Uint8Array(192 * 192).fill(1) };
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const wx = x0 + x * 2, wy = y0 + y * 2, i = x + y * g.w;
    g.height[i] = mixed && wx >= 240 ? wx - 240 : 0;
    if (mixed && wy < 100) g.type[i] = 0;
  }
  const gridHeight = (b, x, y) => {
    const gx = (x - b.x0) / b.cell, gy = (y - b.y0) / b.cell;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    if (ix < 0 || iy < 0 || ix + 1 >= b.w || iy + 1 >= b.h) return null;
    const tx = gx - ix, ty = gy - iy, j = ix + iy * b.w;
    return (b.height[j] * (1 - tx) + b.height[j + 1] * tx) * (1 - ty) +
      (b.height[j + b.w] * (1 - tx) + b.height[j + b.w + 1] * tx) * ty;
  };
  const recipe = { map: { w: 192, h: 192, cell: 2 }, chunk: { size: 128, nearCell: 2 },
    recipe: { forest: { canopy: 10, maxSlope: 0.5, trees: cfg } },
    util: { heightAt: (x) => mixed && x >= 240 ? x - 240 : 0, typeAt: () => 1, gridHeight,
      bake: () => g, generate: () => g } };
  const t = new Terrain(recipe);
  t.bakeNearBand(1, 1);
  t.near.x0 = x0; t.near.y0 = y0;
  return t;
}
function same(a, b) {
  return a.count === b.count && ['x', 'y', 'z', 'yawDeg', 'species'].every(k =>
    Buffer.from(a[k].buffer).equals(Buffer.from(b[k].buffer)));
}
const t = fixture(), a = scatterTrees(t), b = scatterTrees(t);
ok(same(a, b));
ok(a.x instanceof Float64Array && a.y instanceof Float64Array && a.z instanceof Float64Array &&
  a.yawDeg instanceof Int16Array && a.species instanceof Uint8Array);
ok(a.count > 1000 && new Set(a.species).size === 2);
ok([...a.z].every(z => z === -0.1));
ok([...a.yawDeg].every(yaw => yaw >= 0 && yaw < 360));
const map = (s) => new Map(Array.from({ length: s.count }, (_, i) => [`${s.x[i]},${s.y[i]}`, [s.z[i], s.yawDeg[i], s.species[i]]]));
// Avoid thinning here: its band-wide count is explicitly part of the normative keep probability.
const overlapCfg = { ...cfg, maxTrees: 10000 };
const left = map(scatterTrees(t, [], overlapCfg)), right = map(scatterTrees(fixture(128, 64), [], overlapCfg));
let shared = 0;
for (const [xy, value] of left) if (right.has(xy)) { assert.deepEqual(value, right.get(xy)); shared++; }
ok(shared > 500);
const interior = (m) => [...m.keys()].filter(k => {
  const [x, y] = k.split(',').map(Number);
  return x >= 132 && y >= 68 && x < 380 && y < 380;
}).sort();
assert.deepEqual(interior(left), interior(right)); checks++;
let spacing = true, ordered = true;
for (let i = 0; i < a.count; i++) {
  if (i && Math.floor(a.y[i] / cfg.cellM) < Math.floor(a.y[i - 1] / cfg.cellM)) ordered = false;
  for (let j = 0; j < i; j++) {
    const ra = cfg.species[a.species[i]].trunkR / Math.cos(Math.PI / 8);
    const rb = cfg.species[a.species[j]].trunkR / Math.cos(Math.PI / 8);
    if (Math.hypot(a.x[i] - a.x[j], a.y[i] - a.y[j]) < ra + rb + 1.2) spacing = false;
  }
}
ok(spacing); ok(ordered);
const exclusions = [{ bbox: { x0: 110, y0: 110, x1: 150, y1: 150 } }];
const mixed = fixture(0, 0, true), rejected = scatterTrees(mixed, exclusions);
ok(rejected.count > 0);
ok([...rejected.y].every(y => y >= 100));
ok([...rejected.x].every(x => x < 240));
ok([...rejected.x].every((x, i) => !(x >= 108 && x <= 152 && rejected.y[i] >= 108 && rejected.y[i] <= 152)));
// All four surrounding texels matter, even when the texel containing the point is forest.
const isolated = fixture();
isolated.near.type.fill(0);
for (let y = 0; y < 192; y += 2) for (let x = 0; x < 192; x += 2) isolated.near.type[x + y * 192] = 1;
ok(scatterTrees(isolated).count === 0);
const thinnedCfg = { ...cfg, maxTrees: 100 };
const thinned = scatterTrees(t, [], thinnedCfg);
ok(same(thinned, scatterTrees(t, [], thinnedCfg)) && thinned.count > 0 && thinned.count < 200);
const all = scatterTrees(t, [], overlapCfg), probability = 100 / all.count;
const expected = [];
for (let i = 0; i < all.count; i++) {
  const ix = Math.floor(all.x[i] / cfg.cellM), iy = Math.floor(all.y[i] / cfg.cellM);
  if (hash2(ix, iy, cfg.seed + 5) / 4294967296 < probability) expected.push(all.x[i]);
}
assert.deepEqual([...thinned.x], expected); checks++;
ok(scatterTrees(t, [], { ...cfg, maxTrees: 0 }).count === 0);
for (const [key, value] of [['cellM', 4], ['jitter', 3], ['fill', 2], ['maxTrees', -1], ['seed', NaN]]) {
  assert.throws(() => validateScatterConfig({ ...cfg, [key]: value }), new RegExp(key)); checks++;
}
const draw = fixture(); draw.bakeFarSync();
const far = Buffer.from(draw.farHDraw.buffer).toString('hex');
ok(draw.near.hDraw.every((h, i) => h === draw.near.height[i] + 10));
draw.realTrees = true; draw.bakeNearBand(1, 1);
ok(draw.near.hDraw.every((h, i) => h === draw.near.height[i]));
ok(Buffer.from(draw.farHDraw.buffer).toString('hex') === far);
draw.realTrees = false; draw.bakeNearBand(1, 1);
ok(draw.near.hDraw.every((h, i) => h === draw.near.height[i] + 10));
const start = performance.now(); scatterTrees(t); const ms = performance.now() - start;
console.log(`scatter band ${ms.toFixed(3)} ms${ms > 30 ? ' (WARN >30ms)' : ''}; ${checks} checks ALL PASS`);
