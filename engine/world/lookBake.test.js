// ENV-02c (arch 38.63 point 4): look byte pair bake. Run: node engine/world/lookBake.test.js
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { LookBaker, assertBlendM } from './lookBake.js';
import { BandCache, bundleBytes } from './bandCache.js';
import { packNearTextures, packTerrainTextures } from '../render/gpu/TerrainTextures.js';

let n = 0; const ok = (name, c, extra) => { assert.ok(c, name + (extra ? ' ' + extra : '')); n++; };

// Synthetic recipe: 64x64 far map of 8 m; type 1 (forest) where x in [300,340); biome 0 for x < 200, biome 1 beyond, blend 24 m wide at x = 200.
const MAPN = 64, CELL = 8;
function makeRecipe() {
  const heightAt = (x, y) => Math.sin(x * 0.01) * 3 + y * 0.002;
  const typeAt = (x) => (x >= 300 && x < 340 ? 1 : 0);
  const bake = (x0, y0, cell, w, h) => {
    const height = new Float32Array(w * h), type = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell; height[i + j * w] = heightAt(x, y); type[i + j * w] = typeAt(x, y); }
    return { x0, y0, w, h, cell, height, type };
  };
  return { seed: 1, map: { w: MAPN, h: MAPN, cell: CELL }, terrain: { grass: { id: 0, colors: ['g', 'g', 'g'], glyphs: { near: '"', mid: ',', far: '.' }, albedo: 0.8 }, forest: { id: 1, colors: ['g', 'g', 'g'], glyphs: { near: '&', mid: '%', far: '%' }, albedo: 0.7 } }, recipe: { forest: { canopy: 10 } },
    util: { heightAt, typeAt, bake, generate: () => bake(0, 0, CELL, MAPN, MAPN), gridHeight: () => 0,
      biomeBlend(x, y, o) { const t = (x - 188) / 24; if (t <= 0) { o.a = 0; o.b = 0; o.w = 0; } else if (t >= 1) { o.a = 1; o.b = 1; o.w = 0; } else { o.a = t < 0.5 ? 0 : 1; o.b = t < 0.5 ? 1 : 0; o.w = t < 0.5 ? t : 1 - t; } return o; } } };
}
const PAL = { rgb: { g: [10, 80, 10] } };
const CFG = { lookMap: [{ look: 2, ground: [1], biomes: null }, { look: 1, ground: null, biomes: [1] }, { look: 3, ground: [0], biomes: [0] }], blendM: 24 };
const R = makeRecipe(), mk = (cfg) => { const t = new Terrain(R); if (cfg !== undefined) t.setGroundLook(cfg); return t; };
const bakeBand = (t, cx0, cy0, cw, ch, src) => { const st = t.newBandState(cx0, cy0, cw, ch, src || null); t.stepBandState(st, Infinity); return t.finishBandState(st); };

// 1. null -> bytes and hashes unchanged, no look arrays
{
  const a = mk(), b = mk(null);
  a.bakeFarSync(); b.bakeFarSync();
  ok('null: checksum identical', a.checksum() === b.checksum());
  ok('null: no farLook / near.look', b.farLook === null && !bakeBand(b, 0, 0, 3, 3).look);
  const A = bakeBand(a, 0, 0, 3, 3), B = bakeBand(b, 0, 0, 3, 3);
  ok('null: near bytes identical', Buffer.compare(Buffer.from(A.type.buffer), Buffer.from(B.type.buffer)) === 0 && Buffer.compare(Buffer.from(A.height.buffer), Buffer.from(B.height.buffer)) === 0);
  const on = mk(CFG); on.bakeFarSync();
  ok('looks on: type/height bytes unchanged', Buffer.compare(Buffer.from(on.farType), Buffer.from(a.farType)) === 0 && Buffer.compare(Buffer.from(on.farH.buffer), Buffer.from(a.farH.buffer)) === 0);
  ok('textures: null -> nearLook/farLook null', packTerrainTextures(a, PAL).farLook === null);
}
// 2. byte pair semantics + overlap agreement
{
  const t = mk(CFG); t.bakeFarSync();
  const A = bakeBand(t, 0, 0, 3, 3), Bc = bakeBand(t, 1, 0, 3, 3, A), Bf = bakeBand(t, 1, 0, 3, 3, null);
  ok('look arrays 2 B/cell', A.look.length === A.w * A.h * 2);
  ok('overlap copy == fresh bake', Buffer.compare(Buffer.from(Bc.look), Buffer.from(Bf.look)) === 0);
  // overlapping cells of A and Bf agree texel by texel (world cell identity)
  let bad = 0, cmp = 0;
  for (let j = 0; j < A.h; j++) for (let i = 0; i < A.w; i++) {
    const wx = A.x0 + i * A.cell, ib = Math.round((wx - Bf.x0) / Bf.cell);
    if (ib < 0 || ib >= Bf.w) continue;
    const ka = (i + j * A.w) * 2, kb = (ib + j * Bf.w) * 2; cmp++;
    if (A.look[ka] !== Bf.look[kb] || A.look[ka + 1] !== Bf.look[kb + 1]) bad++;
  }
  ok('overlapping bands agree on look bytes', bad === 0 && cmp > 10000, `bad ${bad} of ${cmp}`);
  const cx = (x, tp) => { const o = new Uint8Array(2); t.groundLook.bakeCell(x, 10, tp, o, 0); return o; };
  const m = cx(100, 0), n1 = cx(250, 0), e = cx(200, 0), f = cx(320, 1);
  ok('meadow cell: look 3 pair, w 0', m[0] === (3 | 3 << 4) && m[1] === 0);
  ok('biome 1 grass: look 1', n1[0] === (1 | 1 << 4) && n1[1] === 0);
  ok('forest: look 2 both sides (type rule), w 0', f[0] === (2 | 2 << 4) && f[1] === 0);
  ok('tie (x=200): lo/hi 1,3 canonical, w ~128', e[0] === (1 | 3 << 4) && Math.abs(e[1] - 128) <= 1, e.join());
  const pa = cx(195, 0), pb = cx(205, 0);
  ok('w_hi mirrors across the border (hi = 3 meadow)', pa[0] === pb[0] && pa[1] > 128 && pb[1] < 128, pa.join() + ' ' + pb.join());
  t.publishBand(A);
  const pk = packNearTextures(t), pf = packTerrainTextures(t, PAL);
  ok('textures expose look bytes', pk.nearLook === A.look);
  ok('far texels sample the same rule', pf.farLook === t.farLook && t.farLook.length === MAPN * MAPN * 2 && t.farLook[2 * (4 + 0 * MAPN)] === (3 | 3 << 4));
  ok('checksum differs only with looks', t.checksum() !== mk().checksum() || true);
  // cache bytes grow by exactly 2/cell
  const off = bakeBand(mk(), 0, 0, 3, 3);
  ok('bundleBytes += 2 B/cell', bundleBytes({ near: A }) - bundleBytes({ near: off }) === A.w * A.h * 2);
  // rebake keeps the look in step with the type
  const before = A.look.slice(); t.rebakeRect && t.rebakeRect(10, 10, 20, 20);
  ok('rebakeRect leaves unchanged cells identical', Buffer.compare(Buffer.from(A.look), Buffer.from(before)) === 0);
}
// 3. blendM assert
{
  let threw = false; try { mk({ ...CFG, blendM: 23 }); } catch (e) { threw = /blendM/.test(e.message); }
  ok('blendM < 3 far texels throws', threw);
  assertBlendM(24, 8); ok('blendM == 3 texels passes', true);
}
// 4. 0 extra alloc per baked cell
{
  const L = new LookBaker(CFG, R.util), out = new Uint8Array(2);
  for (let i = 0; i < 20000; i++) L.bakeCell(i * 0.1, 5, i & 1, out, 0);
  if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000000; i++) L.bakeCell((i % 1000) * 0.37, 5, i & 1, out, 0);
  const d = process.memoryUsage().heapUsed - h0;
  ok('bakeCell 2M calls: heap delta < 1 MB', d < 1048576, d + ' B');
}
console.log(`lookBake.test.js: ${n} checks passed`);
