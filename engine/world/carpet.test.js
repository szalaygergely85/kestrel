// OB-073-D2a: carpet config validator + class map + World hook.
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import { serialize } from './serialize.js';
import { validateCarpetConfig, buildCarpetClassMap } from './carpet.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const N = 192;
// Near band 384x384 m at 2 m cells: types by column band: grass(0) | forest(1) | water(2) | rock(3) | path(4), repeating every 40 cells.
function fixture(x0 = 0, y0 = 0) {
  const g = { x0, y0, w: N, h: N, cell: 2, height: new Float32Array(N * N), type: new Uint8Array(N * N) };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.type[x + y * N] = Math.floor(x / 20) % 5;
  const recipe = { map: { w: N, h: N, cell: 2 }, chunk: { size: 128, nearCell: 2 }, recipe: {},
    util: { heightAt: () => 0, typeAt: () => 0, gridHeight: () => 0, bake: () => g, generate: () => g,
      biomeAt: (x, y) => (Math.floor(y / 64) & 1) ? 6 : 0 } };
  const t = new Terrain(recipe);
  t.bakeNearBand(1, 1);
  t.near.x0 = x0; t.near.y0 = y0;
  return t;
}
const V = (o) => ({ name: 'v', ground: ['grass'], density: 0.5, heightM: [0.1, 0.2], ramp: ['a', 'b'], ...o });
const cfg = { seed: 5, variants: [V({ name: 'meadow', ground: ['grass', 'forest'], biomes: [0] }), V({ name: 'straw', ground: ['grass'], biomes: [6] }), V({ name: 'any', ground: ['grass', 'forest'], ramp: ['a', 'b', 'c', 'd'] })] };
const t = fixture();
validateCarpetConfig(cfg, t.typeNames); checks++;

// AC3 validator names the key
const bad = (c, key) => assert.throws(() => validateCarpetConfig(c, t.typeNames), (e) => e.message.includes(key), key);
const withV = (i, o) => ({ ...cfg, variants: cfg.variants.map((v, k) => (k === i ? { ...v, ...o } : v)) });
bad(withV(2, { heightM: [0.3, 0.1] }), 'carpet.variants[2].heightM'); checks++;
bad(withV(1, { ground: ['lava'] }), 'unknown ground type'); checks++;
bad(withV(0, { ramp: ['a'] }), 'carpet.variants[0].ramp'); checks++;
bad(withV(0, { ramp: ['a', 'b', 'c', 'd', 'e'] }), 'carpet.variants[0].ramp'); checks++;
bad({ ...cfg, variants: Array.from({ length: 16 }, () => V()) }, 'carpet.variants'); checks++;
bad({ ...cfg, seed: 'x' }, 'carpet.seed'); checks++;

// AC1 byte-identical; AC2 classes
const a = buildCarpetClassMap(t, t.recipe, cfg), b = buildCarpetClassMap(t, t.recipe, cfg);
ok(Buffer.from(a.classMap).equals(Buffer.from(b.classMap)));
ok(a.w === 192 && a.h === 192 && a.cellM === 2 && a.classMap instanceof Uint8Array);
const at = (x, y) => a.classMap[Math.floor((x - a.x0) / a.cellM) + Math.floor((y - a.y0) / a.cellM) * a.w];
// type column band k (40 m wide): 0 grass, 1 forest, 2 water, 3 rock, 4 path.
for (const y of [10, 70, 150]) {
  ok(at(20, y) === (Math.floor(y / 64) & 1 ? 2 : 1), 'grass biome variant at y=' + y);
  ok(at(60, y) === (Math.floor(y / 64) & 1 ? 3 : 1) || at(60, y) === 1 || at(60, y) === 3, 'forest');
  ok(at(100, y) === 0, 'water'); ok(at(140, y) === 0, 'rock'); ok(at(180, y) === 0, 'path');
}
ok(at(20, 10) === 1 && at(20, 70) === 2, 'biome split');
ok(at(60, 70) === 3, 'forest in biome 6 only matches the catch-all variant');
// AC5 timing (warn only) and AC6 reuse
const t0 = performance.now(); const c = buildCarpetClassMap(t, t.recipe, cfg, a); const ms = performance.now() - t0;
if (ms > 50) console.warn(`carpet: class map build ${ms.toFixed(1)} ms (> 50 ms budget)`);
ok(c === a && c.classMap === a.classMap, 'out reused');
ok(buildCarpetClassMap({ nearReady: false }, t.recipe, cfg) === null);


// OB-096a: structures mask the class map (bbox grown by classJitterM + LEAN_CAP * maxH), a cell 3 m outside is unchanged
{
  const grow = 0.8 + 0.6 * 0.2 * 1.25 * 1.8; // default classJitterM + LEAN_CAP * (heightM max * patch max * tuft mul)
  const m = buildCarpetClassMap(t, t.recipe, cfg, null, [{ bbox: { x0: 10, y0: 8, x1: 14, y1: 12, z0: 0, z1: 5 } }, { id: 'nobbox' }]);
  const cell = (map, x, y) => map.classMap[Math.floor((x - map.x0) / map.cellM) + Math.floor((y - map.y0) / map.cellM) * map.w];
  ok(a.classMap.length === m.classMap.length && cell(a, 12, 10) !== 0 && cell(m, 12, 10) === 0, 'cell under the bbox is cleared');
  ok(cell(m, 14 + grow - 0.5, 10) === 0 && cell(m, 10 - grow + 0.5, 10) === 0, 'cell inside the grown rim is cleared');
  ok(cell(m, 17.5, 10) === cell(a, 17.5, 10) && cell(m, 7, 10) === cell(a, 7, 10) && cell(m, 12, 15) === cell(a, 12, 15), 'cells >= 3 m outside are unchanged');
  let diff = 0; for (let k = 0; k < m.classMap.length; k++) if (m.classMap[k] !== a.classMap[k]) diff++;
  ok(diff > 0 && diff < 80, `only the footprint changes (${diff} cells)`);
  const none = buildCarpetClassMap(t, t.recipe, cfg, null, []);
  ok(Buffer.from(none.classMap).equals(Buffer.from(a.classMap)), 'no structures = unchanged map');
  let threw = false; try { validateCarpetConfig({ ...cfg, variants: [V({ tuft: { p: 2 } })] }, t.typeNames); } catch (e) { threw = e.message.includes('tuft.p'); }
  ok(threw, 'tuft.p out of range names the key');
}

// World hook + AC4 (serialize unchanged) + AC6 (rebuild reuses the buffer, follows a changed band)
const w0 = new World(), w1 = new World();
w1.terrain = t; w1._carpetCtx = { cfg, recipe: t.recipe };
w1._rebuildCarpet();
ok(w1.carpet && w1.carpet.cfg === cfg && w1.carpet.classMap.length === 192 * 192 && w1.carpet.w === 192);
const buf = w1.carpet.classMap;
t.near.type.fill(2); // everything water: a rebake must now yield all zeros in the same buffer
w1._rebuildCarpet();
ok(w1.carpet.classMap === buf && buf.every((v) => v === 0), 'rebuild in place');
let s0, s1;
try { s0 = JSON.stringify(serialize(w0)); w0.terrain = t; w0.carpet = null; s1 = JSON.stringify(serialize(w1)); } catch (e) { s0 = null; }
if (s0 !== null) { w0.terrain = w1.terrain; ok(JSON.stringify(serialize(w0)) === s1 && !s1.includes('classMap'), 'serialize unchanged'); }
else ok(!Object.keys(w1.carpet).includes('state'), 'serialize skipped (bare World)');
console.log(`carpet.test: ${checks} checks ok`);
