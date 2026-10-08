// engine/mesh/rasterSway.test.js (S8-B2-06): foliage sway in the instanced raster twin + WGSL probe.
// Run: node engine/mesh/rasterSway.test.js
import assert from 'node:assert/strict';
import { readMeshJSON } from '../test/meshFile.test.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, MeshDrawCache } from './DrawList.js';
import { InstanceGroups, writeUnitInstance } from './instances.js';
import { rasterDrawList, createRasterTarget } from './rasterJS.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { lodDitherBits } from './lodDither.js';
import { windAt, windParams, swayOffset, INST_FLAG_SWAY, SWAY_K, SWAY_MAX } from '../core/wind.js';
import { RASTER_INSTANCED_WGSL, RASTER_INSTANCED_SHADOW_WGSL, RASTER_WGSL, RASTER_BLOCK, SWAY_WGSL } from '../render/gpu/wgsl/raster.wgsl.js';
import { WIND_AT_WGSL } from '../render/gpu/wgsl/common.wgsl.js';
import { compileFn } from '../render/gpu/wgsl/wgslProbe.js';

// 1. swayOffset == windAt * h^2 * K, base fixed, cap, zero wind
{
  const p = windParams({ dirDeg: 30, speed: 5, gust: 0.7 });
  const o = { x: 0, y: 0 };
  swayOffset(10, 20, 3, 4.5, p, o);
  const w = windAt(10, 20, 4.5, { dirDeg: 30, speed: 5, gust: 0.7 });
  assert.ok(Math.abs(o.x - w.x * 9 * SWAY_K) < 1e-12 && Math.abs(o.y - w.z * 9 * SWAY_K) < 1e-12);
  swayOffset(10, 20, 0, 4.5, p, o); assert.deepEqual([o.x, o.y], [0, 0], 'trunk base fixed');
  swayOffset(10, 20, 1000, 4.5, p, o); assert.ok(Math.hypot(o.x, o.y) <= SWAY_MAX + 1e-9, 'capped');
  swayOffset(10, 20, 3, 4.5, windParams({ speed: 0, gust: 1 }), o); assert.deepEqual([o.x, o.y], [0, 0], 'zero wind');
}

// 2. WGSL probe: swayDisp (f64 evaluation of the shipped text) vs swayOffset
{
  const wgslWind = compileFn(WIND_AT_WGSL, 'windAt', { sin: Math.sin });
  const sway = compileFn(SWAY_WGSL, 'swayDisp', { windAt: wgslWind }, `const SWAY_K=${SWAY_K}, SWAY_MAX=${SWAY_MAX};`);
  let seed = 4242; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let maxErr = 0; const o = { x: 0, y: 0 };
  for (let i = 0; i < 3000; i++) {
    const p = windParams({ dirDeg: rnd() * 360, speed: rnd() * 12, gust: rnd() });
    const bx = (rnd() - 0.5) * 3000, by = (rnd() - 0.5) * 3000, h = rnd() * 14, t = rnd() * 3600;
    swayOffset(bx, by, h, t, p, o);
    const g = sway(bx, by, h, t, p[0], p[1], p[2], p[3]);
    maxErr = Math.max(maxErr, Math.abs(o.x - g.x), Math.abs(o.y - g.y));
  }
  assert.ok(maxErr < 1e-9, `swayDisp probe ${maxErr}`);
  console.log(`  sway probe max err ${maxErr}`);
}

// 3. WGSL text rules: instanced variants only, size, shadow variant carries it, static variant untouched
assert.ok(RASTER_INSTANCED_WGSL.includes('swayDisp(a.iRow0.w, a.iRow1.w, wp.z - a.iRow2.w'));
assert.ok(RASTER_INSTANCED_SHADOW_WGSL.includes('swayDisp('));
assert.ok(!RASTER_WGSL.includes('swayDisp') && !RASTER_WGSL.includes('windAt'));
assert.equal(RASTER_BLOCK.field('wind').word, 76); assert.equal(RASTER_BLOCK.field('windT').word, 80);
assert.ok(!/%|\bround\s*\(|\bmod\s*\(|fract/.test(RASTER_INSTANCED_WGSL));

// 4. raster twin on a real mesh group
const oak = meshFromJSON(readMeshJSON(new URL('../../content/meshes/kenney/tree_oak.mesh.json', import.meta.url)));
const COLS = 240, ROWS = 90, rt = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 };
const cam = { x: 0, y: 14, z: 1.7, yawDeg: 0, pitchDeg: 0 };
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
projTerms(cam, rt, terms); shearProjection(terms, M); frustumPlanes(M, planes);
const spots = [[-7, 0, 0], [-3.5, 1, 40], [0, 0, 90], [3.5, -1, 135], [7, 0, 200]];
function draw(flagged, wind) {
  const ig = new InstanceGroups(); const g = ig.meshGroup(oak, spots.length);
  spots.forEach(([x, y, yaw], i) => { writeUnitInstance(g.ib, g.count++, x, y, 0, yaw, 0xA000 | i, 0); if (flagged) g.ib.u32[(g.count - 1) * 16 + 13] |= INST_FLAG_SWAY; });
  const l = new DrawList(); l.begin();
  ig.addToDrawList(l, null, planes, 1, M, ROWS, { cache: new MeshDrawCache(), idFor: () => 1 });
  l.cull(planes);
  const t = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(l, t, { M, terms, snap: true, wind });
  return t;
}
const diff = (a, b) => { let n = 0, minRow = ROWS, maxRow = -1; for (let i = 0; i < COLS * ROWS; i++) if (a.kind[i] !== b.kind[i] || a.depth[i] !== b.depth[i] || a.nrm[i] !== b.nrm[i]) { n++; const r = (i / COLS) | 0; minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r); } return { n, minRow, maxRow }; };
const base = draw(false, undefined);
const P = windParams({ dirDeg: 0, speed: 8, gust: 0.5 });
assert.equal(diff(base, draw(true, undefined)).n, 0, 'flagged, no wind = identical');
assert.equal(diff(base, draw(true, { p: windParams({ speed: 0, gust: 1 }), t: 5 })).n, 0, 'flagged, zero wind = identical');
assert.equal(diff(base, draw(false, { p: P, t: 5 })).n, 0, 'wind but unflagged instances = identical');
const a = draw(true, { p: P, t: 5 }), b = draw(true, { p: P, t: 9.3 });
const dA = diff(base, a), dB = diff(a, b);
assert.ok(dA.n > 20, `sway moves pixels (${dA.n})`);
assert.ok(dB.n > 20, `different time moves again (${dB.n})`);
assert.equal(diff(a, draw(true, { p: P, t: 5 })).n, 0, 'deterministic');
// trunk base fixed: kind/depth changes concentrate in the crown (upper half of the covered rows), the bottom row of each trunk barely moves
let lastRow = -1, firstRow = ROWS; for (let i = 0; i < COLS * ROWS; i++) if (base.kind[i]) { const r = (i / COLS) | 0; lastRow = Math.max(lastRow, r); firstRow = Math.min(firstRow, r); }
const mid = (firstRow + lastRow) >> 1; let top = 0, bottom = 0;
for (let i = 0; i < COLS * ROWS; i++) if (base.kind[i] !== a.kind[i] || base.depth[i] !== a.depth[i]) { if (((i / COLS) | 0) <= mid) top++; else bottom++; }
assert.ok(top > 3 * bottom, `crown moves more than trunk: top ${top} bottom ${bottom}`);
console.log(`  raster: sway changed ${dA.n} cells (rows ${dA.minRow}..${dA.maxRow}, covered ${firstRow}..${lastRow}, top ${top} bottom ${bottom}), time change ${dB.n}`);
// 5. S8-B2-07 in the raster twin: the two dither copies of the same instances tile the plain draw exactly (no holes, no overlap)
{
  const flagsOr = (bits) => { const ig = new InstanceGroups(); const g = ig.meshGroup(oak, spots.length);
    spots.forEach(([x, y, yaw], i) => { writeUnitInstance(g.ib, g.count++, x, y, 0, yaw, 0xA000 | i, 0); g.ib.u32[(g.count - 1) * 16 + 13] |= bits; });
    const l = new DrawList(); l.begin(); ig.addToDrawList(l, null, planes, 1, M, ROWS, { cache: new MeshDrawCache(), idFor: () => 1 }); l.cull(planes);
    const t = createRasterTarget(COLS, ROWS, 1, {}); rasterDrawList(l, t, { M, terms, snap: true }); return t; };
  const plain = flagsOr(0), c0 = flagsOr(lodDitherBits(0.4, 0)), c1 = flagsOr(lodDitherBits(0.4, 1));
  let covered = 0, both = 0, miss = 0, wrongDepth = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    const a = c0.kind[i] !== 0, b = c1.kind[i] !== 0, p = plain.kind[i] !== 0;
    if (a && b) both++;
    if (p) { covered++; if (!a && !b) miss++; else if ((a ? c0 : c1).depth[i] !== plain.depth[i]) wrongDepth++; } else if (a || b) miss++;
  }
  assert.ok(covered > 300, 'scene covered ' + covered);
  assert.equal(both, 0, 'no cell drawn by both copies'); assert.equal(miss, 0, 'no hole, nothing extra'); assert.equal(wrongDepth, 0);
  console.log('  dither raster: ' + covered + ' covered cells split between the copies');
}
console.log('rasterSway: ok');
