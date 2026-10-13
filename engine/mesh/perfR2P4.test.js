// PERF-R2 / PERF-P4 (D-075 step 3). Run: node engine/mesh/perfR2P4.test.js
// Per-species tree lodCells + detail maxDistM data, and the distance-cull rule: JS (compactGroup) == GPU rule (passCull uniform eye.w = maxDistM^2, cull when d2 > eye.w).
import assert from 'node:assert/strict';
import { createInstanceBuffer, writeUnitInstance, compactGroup, INSTANCE_STRIDE } from './instances.js';
import { detailDrawM, validateDetailConfig } from '../world/scatter.js';
import '../../design/palette.js';
import '../../design/levels/overworld_far.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const def = globalThis.ASSETS.levels.overworld_far;
const found = (pred) => { const out = []; (function walk(o, seen) { if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o); if (pred(o)) out.push(o); for (const v of Object.values(o)) walk(v, seen); })(def, new Set()); return out; };

// R2: every mesh tree species has its own lodCells above the old flat 50 (LOD1 closer), and the table is not flat
const trees = found(o => typeof o.mesh === 'string' && o.lodCells !== undefined);
ok(trees.length === 10, 'tree mesh species: ' + trees.length);
for (const s of trees) ok(Number.isFinite(s.lodCells) && s.lodCells > 50 && s.lodCells <= 200, s.mesh + ' lodCells ' + s.lodCells);
ok(new Set(trees.map(s => s.lodCells)).size >= 3, 'lodCells differ per species');

// P4: detail species maxDistM valid, never above the layer drawM; the effective radius rule
const dets = found(o => typeof o.model === 'string' && o.maxDistM !== undefined);
ok(dets.length === 5, 'detail species with maxDistM: ' + dets.length);
for (const d of dets) ok(d.maxDistM > 0 && d.maxDistM <= 120, d.model + ' maxDistM ' + d.maxDistM);
ok(detailDrawM(70, 50) === 50 && detailDrawM(70, 120) === 70 && detailDrawM(70, undefined) === 70 && detailDrawM(70, 0) === 70, 'detailDrawM cap');
const typeNames = ['grass', 'forest'];
const mk = (v) => ({ cellM: 4, tileM: 16, maxPlacements: 100, structClearM: 1, layers: [{ name: 'a', seed: 1, cellM: 2, drawM: 70, jitter: 0.5, fill: 0.5, maxSlope: 1, clearM: 0.5, ground: { grass: [{ model: 'x', weight: 1, shadow: true, maxDistM: v }] } }] });
let bad = 0; for (const v of [-1, 0, NaN]) { try { validateDetailConfig(mk(v), typeNames); } catch { bad++; } }
ok(bad >= 2, 'invalid maxDistM rejected (' + bad + '/3)');

// cull twin: seeded instances, JS compactGroup vs the GPU rule
const N = 2000, ib = createInstanceBuffer(N);
let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const eye = { x: 100, y: 200, z: 2 };
for (let i = 0; i < N; i++) writeUnitInstance(ib, i, eye.x + (rnd() - 0.5) * 300, eye.y + (rnd() - 0.5) * 300, 0, 0, i, 0);
for (const md of [25, 60, 120]) {
  const g = { ib, count: N, lodCells: 0, maxDistM: md, lodPrev: new Uint8Array(N), lod0Cap: 0, _lod0Idx: new Int32Array(N), _lod0Cells: new Float32Array(N),
    drawIb: [createInstanceBuffer(N), createInstanceBuffer(N)], drawCount: new Uint32Array(2) };
  compactGroup(g, null, 1, null, 100, 0, eye);
  const jsKept = g.drawCount[0] + g.drawCount[1];
  let gpuKept = 0; const md2 = md * md;
  for (let i = 0; i < N; i++) { const o = i * INSTANCE_STRIDE, dx = ib.f32[o + 3] - eye.x, dy = ib.f32[o + 7] - eye.y, dz = ib.f32[o + 11] - eye.z; if (!(dx * dx + dy * dy + dz * dz > md2)) gpuKept++; }
  ok(jsKept === gpuKept, `md ${md}: JS kept ${jsKept} == GPU rule ${gpuKept}`);
  ok(gpuKept < N && gpuKept > 0, `md ${md}: some culled (${N - gpuKept}/${N})`);
}
console.log(`perfR2P4.test: ${n} checks ok`);
