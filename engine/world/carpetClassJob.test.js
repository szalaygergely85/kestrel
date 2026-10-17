// PERF-05: CarpetClassMapJob (row-sliced buildCarpetClassMap) gives the same bytes as the one-shot build for any slice size, with and
// without structures, and reuses `out`; buildCarpetClassMap returns null before the near band is baked.
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { buildCarpetClassMap, CarpetClassMapJob } from './carpet.js';

let checks = 0;
const N = 160;
function fixture() {
  const g = { x0: 40, y0: -20, w: N, h: N, cell: 2, height: new Float32Array(N * N), type: new Uint8Array(N * N) };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.type[x + y * N] = (Math.floor(x / 13) + Math.floor(y / 17)) % 5;
  const recipe = { map: { w: N, h: N, cell: 2 }, chunk: { size: 128, nearCell: 2 }, recipe: {},
    util: { heightAt: () => 0, typeAt: () => 0, gridHeight: () => 0, bake: () => g, generate: () => g, biomeAt: (x, y) => ((Math.floor(y / 48) + Math.floor(x / 80)) & 1 ? 6 : 0) } };
  const t = new Terrain(recipe);
  t.bakeNearBand(1, 1);
  t.near.x0 = 40; t.near.y0 = -20;
  return t;
}
const V = (o) => ({ name: 'v', ground: ['grass'], density: 0.5, heightM: [0.1, 0.2], ramp: ['a', 'b'], ...o });
const cfg = { seed: 3, classCellM: 1.5, variants: [V({ name: 'meadow', ground: ['grass', 'forest'], biomes: [0] }), V({ name: 'straw', ground: ['grass'], biomes: [6] }),
  V({ name: 'area', ground: ['grass', 'forest', 'path'], areas: [{ x0: 60, y0: 0, x1: 200, y1: 120 }] })] };
const t = fixture();
const structs = [];
for (let k = 0; k < 300; k++) { const x = 40 + (k * 37) % 300, y = -20 + (k * 53) % 300, s = 1 + (k % 7); structs.push({ bbox: { x0: x, y0: y, x1: x + s, y1: y + s * 0.5 } }); }
structs.push(null, { bbox: { x0: NaN, y0: 0, x1: 1, y1: 1 } });

for (const ss of [null, structs]) {
  const ref = buildCarpetClassMap(t, t.recipe, cfg, null, ss);
  assert.ok(ref && ref.classMap.some((v) => v !== 0) && ref.classMap.some((v) => v === 0)); checks++;
  for (const ms of [0, 0.01, 1e9]) {
    const j = new CarpetClassMapJob(t, t.recipe, cfg, null, ss);
    let calls = 0;
    while (!j.step(ms)) { calls++; assert.ok(calls < 1e6); }
    assert.ok(Buffer.from(j.res.classMap).equals(Buffer.from(ref.classMap)), `slice ${ms}`); checks++;
    assert.deepEqual([j.res.x0, j.res.y0, j.res.w, j.res.h, j.res.cellM], [ref.x0, ref.y0, ref.w, ref.h, ref.cellM]); checks++;
    if (ms === 0) { assert.ok(calls >= ref.h - 1, 'one row per call at ms 0'); checks++; }
    assert.equal(j.step(0), true); checks++; // done stays done
  }
  const out = { classMap: new Uint8Array(ref.classMap.length).fill(9) }, r2 = buildCarpetClassMap(t, t.recipe, cfg, out, ss);
  assert.equal(r2, out); assert.ok(Buffer.from(out.classMap).equals(Buffer.from(ref.classMap))); checks += 2;
}
const unbaked = new Terrain(t.recipe);
assert.equal(buildCarpetClassMap(unbaked, t.recipe, cfg), null); checks++;
assert.equal(new CarpetClassMapJob(unbaked, t.recipe, cfg).step(1), false); checks++;
console.log(`carpetClassJob.test: ${checks} checks OK`);
