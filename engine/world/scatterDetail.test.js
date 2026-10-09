import assert from 'node:assert/strict';
import { hash2, scatterDetail, validateDetailConfig } from './scatter.js';
let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const names = ['grass', 'forest', 'water', 'rock', 'path'];
const layer = { name: 'tufts', seed: 173, cellM: 2, jitter: 0.35, fill: 1, maxSlope: 0.5,
  clearM: 1, drawM: 28, ground: { grass: [{ model: 'tuft', weight: 1 }, { model: 'flower', weight: 2, yawStep: 90, sinkM: 0.1 }] } };
const cfg = { layers: [layer], exclude: [{ shape: 'disc', x: -7, y: 5, r: 3 },
  { shape: 'capsule', ax: -4, ay: 15, bx: 8, by: 18, r: 2 }] };
const terrain = { near: { x0: -19, y0: -7, w: 60, h: 50, cell: 1 },
  typeName: t => names[t], groundTypeAt: (x, y) => y < 0 ? 2 : x >= 20 ? 4 : 0,
  groundAt: (x, y) => x * 0.01 + y * 0.02,
  groundNormalAt: (x, y, out) => Object.assign(out, { x: x >= 12 ? 1 : 0, y: 0, z: 1 }) };
const structures = [{ kind: 'mesh', bbox: { x0: 0, x1: 4, y0: 3, y1: 7 } }];
const keepOut = [{ shape: 'disc', x: -10, y: 24, r: 1.5 }];
const before = JSON.stringify(cfg), a = scatterDetail(terrain, structures, keepOut, cfg), b = scatterDetail(terrain, structures, keepOut, cfg);
const keys = ['x', 'y', 'z', 'yawDeg', 'species', 'r2', 'tileStart'];
for (const k of keys) { assert.deepEqual(a[k], b[k]); checks++; }
ok(JSON.stringify(cfg) === before);
ok(a.count > 100 && a.x instanceof Float64Array && a.species instanceof Uint16Array && a.r2 instanceof Float32Array);
ok(a.tileStart[0] === 0 && a.tileStart[a.tileStart.length - 1] === a.count);
for (let tile = 0; tile < a.tileStart.length - 1; tile++) {
  for (let i = a.tileStart[tile]; i < a.tileStart[tile + 1]; i++) {
    assert.equal(Math.floor(a.x[i] / a.tileM) - a.tx0 + (Math.floor(a.y[i] / a.tileM) - a.ty0) * a.tilesX, tile);
    const x = a.x[i], y = a.y[i], si = a.species[i], species = layer.ground.grass[si];
    assert.ok(x >= -19 && x < 12 && y >= 1 && y < 43);
    assert.ok(!(x >= -2 && x <= 6 && y >= 1 && y <= 9));
    assert.ok(Math.hypot(x + 7, y - 5) > 3 && Math.hypot(x + 10, y - 24) > 1.5);
    const dx = 12, dy = 3, t = Math.max(0, Math.min(1, ((x + 4) * dx + (y - 15) * dy) / (dx * dx + dy * dy)));
    assert.ok(Math.hypot(x - (-4 + t * dx), y - (15 + t * dy)) > 2);
    assert.equal(a.z[i], terrain.groundAt(x, y) - (species.sinkM ?? 0.05));
    const ix = Math.floor(x / 2), iy = Math.floor(y / 2), step = species.yawStep ?? 1;
    assert.equal(a.yawDeg[i], Math.floor(hash2(ix, iy, layer.seed + 4) / 4294967296 * 360 / step) * step);
    assert.equal(a.r2[i], Math.fround((28 * (0.85 + 0.15 * hash2(ix, iy, layer.seed + 5) / 4294967296)) ** 2));
  }
}
checks += 8;
// Flat cells make stable layer/config and row-major source order observable within each tile.
const flat = { ...terrain, groundTypeAt: () => 0, groundNormalAt: (x, y, out) => Object.assign(out, { x: 0, y: 0, z: 1 }) };
// Roadside density: broad-phase output must equal a brute-force filter, including tile edges and outside boxes.
{
  const oracleCfg = { layers: [layer], tileM: 8, structClearM: 2 };
  const boxes = Array.from({ length: 300 }, (_, i) => ({ kind: 'mesh', bbox: {
    x0: (i % 30) * 8 - 100, x1: (i % 30) * 8 - 98,
    y0: Math.floor(i / 30) * 8 - 30, y1: Math.floor(i / 30) * 8 - 28 } }));
  boxes.push({ bbox: { x0: -30, x1: -16, y0: -10, y1: 8 } });
  const all = scatterDetail(flat, [], [], oracleCfg), actual = scatterDetail(flat, boxes, [], oracleCfg);
  const kept = [];
  for (let i = 0; i < all.count; i++) {
    const x = all.x[i], y = all.y[i];
    if (!boxes.some(({ bbox: b }) => x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2)) kept.push(i);
  }
  assert.equal(actual.count, kept.length); checks++;
  for (const k of ['x', 'y', 'z', 'yawDeg', 'species', 'r2']) {
    assert.deepEqual(Array.from(actual[k]), kept.map(i => all[k][i])); checks++;
  }
}
const two = scatterDetail(flat, [], [], { layers: [layer, { ...layer, name: 'rocks', ground: { grass: [{ model: 'rock', weight: 1, collider: { prism: { r: 0.5, h: 0.8 } } }] } }] });
for (let tile = 0; tile < two.tileStart.length - 1; tile++) {
  let lastLayer = -1, lastRow = -Infinity, lastCol = -Infinity;
  for (let i = two.tileStart[tile]; i < two.tileStart[tile + 1]; i++) {
    const li = two.speciesDefs[two.species[i]].layer, row = Math.floor(two.y[i] / 2), col = Math.floor(two.x[i] / 2);
    assert.ok(li >= lastLayer);
    if (li === lastLayer) assert.ok(row > lastRow || row === lastRow && col > lastCol);
    lastLayer = li; lastRow = row; lastCol = col;
  }
}
checks += 2;
const normalized = validateDetailConfig(cfg, names);
assert.deepEqual([normalized.tileM, normalized.maxDraw, normalized.refeedM, normalized.maxPlacements,
  normalized.structClearM, normalized.entityClearM, normalized.layers[0].lodCells], [16, 768, 4, 40000, 2, 1.5, 4]); checks++;
assert.deepEqual(normalized.layers[0].ground.grass[0], { model: 'tuft', weight: 1, sinkM: 0.05, yawStep: 1, shadow: false, sway: false }); checks++;
const bad = [ ['tileM', 0], ['maxDraw', 0], ['maxPlacements', 65537], ['refeedM', NaN], ['structClearM', -1], ['entityClearM', Infinity], ['exclude', [{}]], ['layers', null] ];
for (const [key, value] of bad) { assert.throws(() => validateDetailConfig({ ...cfg, [key]: value }), new RegExp(key)); checks++; }
for (const [key, value] of [['fill', 2], ['cellM', 0], ['clearM', -1], ['maxSlope', NaN], ['seed', 0.5]]) {
  assert.throws(() => validateDetailConfig({ layers: [{ ...layer, [key]: value }] }), new RegExp(`layers\\[0\\].${key}`)); checks++;
}
for (const [ground, key] of [[{ mud: [{ model: 'a', weight: 1 }] }, 'ground.mud'], [{ grass: [] }, 'ground.grass'],
  [{ grass: [{ model: 'a', weight: 0 }] }, 'weight'], [{ grass: [{ model: 'a', weight: 1, collider: { prism: { r: 0, h: 1 } } }] }, 'prism.r'],
  [{ grass: [{ model: 'a', weight: 1, collider: { box: { hx: 1, hy: 1, h: -1 } } }] }, 'box.h']]) {
  assert.throws(() => validateDetailConfig({ layers: [{ ...layer, ground }] }), new RegExp(key)); checks++;
}
assert.throws(() => scatterDetail(flat, [], [], { layers: [layer], maxPlacements: 1 }), /detail.maxPlacements/); checks++;
const degenerate = scatterDetail(flat, [], [{ shape: 'capsule', ax: 0, ay: 0, bx: 0, by: 0, r: 8 }], { layers: [layer] });
ok([...degenerate.x].every((x, i) => Math.hypot(x, degenerate.y[i]) > 8));
const start = performance.now(); scatterDetail(flat, [], [], { layers: [layer] }); const ms = performance.now() - start;
console.log(`scatterDetail synthetic: ${a.count} placements, 2-layer ${two.count}; ${ms.toFixed(3)} ms${ms > 40 ? ' WARN >40ms' : ''}; ${checks} checks ALL PASS`);
