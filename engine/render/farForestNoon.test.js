// OB-222: far forest at noon. GI (baked probe ambient) must not darken far canopy faces (<= 12 luma vs flat ambient), shaded faces keep a
// luma floor, and far tree card bases stay within 1 m of the far terrain grid. Run: node engine/render/farForestNoon.test.js
import assert from 'node:assert/strict';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/levels/overworld_far.js';
import '../../design/models/lantern.js';
import '../../design/models/lever.js';
import '../../design/models/voxel_props.js';
import '../../design/models/boulder.js';
import '../../design/models/rubble.js';
import '../../design/models/wreckage.js';
import '../../design/models/relay.js';
import '../../design/models/sword.js';
import '../../design/models/m3_props.js';
import '../../design/models/far_tower.js';
import '../../design/models/ferrum_lights.js';
import { World } from '../world/World.js';
import { scatterTrees } from '../world/scatter.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { packTerrainTextures } from './gpu/TerrainTextures.js';
import { makeTerrainShadeCtx, shadeTerrain, setFarForest, setFarForestDay, farForestDayOf } from './terrainShade.js';
import { readFileSync } from 'node:fs';
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', detail: false });
const T = w.terrain; if (!T.farReady) T.bakeFarSync();
// 1) floating cards: scatter z (= card base) vs the baked far grid the far hill is drawn from
const tr = scatterTrees(T, []); assert.ok(tr.count > 100);
for (let i = 0; i < tr.count; i++) assert.ok(Math.abs(tr.z[i] - T.farHeightAt(tr.x[i], tr.y[i])) <= 1, 'card base off the far terrain at ' + i);
let s = 12345; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let k = 0, n = 0; k < 60000 && n < 4000; k++) {
  const x = T.mapX0 + rnd() * T.mapW * T.mapCell, y = T.mapY0 + rnd() * T.mapH * T.mapCell;
  if (T.typeAt(x, y) !== 1 || T.farHeightAt(x, y) === null) continue; n++;
  assert.ok(Math.abs(T.heightAt(x, y) - 0.1 - T.farHeightAt(x, y)) <= 1, 'far forest cell: analytic ground vs far grid > 1 m');
}
// 2) noon shading of a far forest cell: K = GI ambient / flat sky (baked field: side faces mean 0.85, worst 0.2 = tools/probe-ob222-gi.mjs)
const pal = assets.palette, ctx = makeTerrainShadeCtx(T.recipe, packTerrainTextures(T, pal), pal);
const luma = (o) => 0.2126 * o.fg[0] + 0.7152 * o.fg[1] + 0.0722 * o.fg[2];
const shade = (t, nz, ndotl, fm, K) => luma(shadeTerrain(t, 1, 0.16 * K + 1.1 * ndotl, 100, 200, 0, ctx, { glyph: 0, level: 0, fg: [0, 0, 0], bg: [0, 0, 0] }, fm, 10, 0, 0, nz));
for (const t of [200, 400, 800]) for (const [fm, nz, nl] of [[0, 1, Math.sin(75 * Math.PI / 180)], [1, 0, 0], [1, 0, 0.4]]) {
  assert.ok(shade(t, nz, nl, fm, 1) - shade(t, nz, nl, fm, 0.2) <= 12, 'GI darkens the far forest by > 12 luma at ' + t + ' m');
  if (fm === 0) assert.ok(shade(t, nz, nl, fm, 0.85) >= 100, 'sunlit canopy top too dark at ' + t + ' m');
  else assert.ok(shade(t, nz, nl, fm, 0.85) >= 40, 'forest face luma floor (owner: near-black navy trees) at ' + t + ' m');
}
// 3) OB-222 candidate (default ON in main.js, ?farforest=0 = old): shaded face luma >= 65 at 200 m noon, green > blue; night + off byte-identical; fades out by 500 m
const rgb = (t, nl, K) => { const o = shadeTerrain(t, 1, 0.16 * K + 1.1 * nl, 100, 200, 0, ctx, { glyph: 0, level: 0, fg: [0, 0, 0], bg: [0, 0, 0] }, 1, 10, 0, 0, 0); return [...o.fg, ...o.bg, o.glyph]; };
const day = farForestDayOf(0.9, Math.sin(75 * Math.PI / 180));
assert.ok(day > 0.99 && farForestDayOf(0.02, -0.3) === 0, 'day weight: noon 1, night 0');
setFarForest(0); setFarForestDay(day); const offDay = rgb(200, 0, 0.85), off400 = rgb(500, 0, 0.85), offNight = rgb(200, 0, 0.85);
setFarForest(1); setFarForestDay(day);
const on = rgb(200, 0, 0.85), L = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
assert.ok(L(on) >= 65, 'farforest shaded face luma >= 65 at 200 m noon, got ' + L(on));
assert.ok(on[1] > on[2], 'farforest green > blue, got ' + on.slice(0, 3));
assert.ok(L(offDay) < 55, 'baseline still dark (test sanity), got ' + L(offDay));
assert.deepEqual(rgb(500, 0, 0.85), off400, 'no change at >= 500 m (fog takeover)');
setFarForestDay(0); assert.deepEqual(rgb(200, 0, 0.85), offNight, 'night byte-identical');
setFarForest(0); setFarForestDay(day); assert.deepEqual(rgb(200, 0, 0.85), offDay, '?farforest=0 byte-identical');
setFarForest(0);
// 4) WGSL twin carries the same constants (parity string)
const src = readFileSync(new URL('./gpu/wgsl/shade.wgsl.js', import.meta.url), 'utf8');
for (const k of ['FF_FLOOR', 'FF_RANGE', 'FF_FADE_A', 'FF_FADE_B', 'FF_SUN_REF', 'FF_ELEV_LO', 'FF_ELEV_HI', 'FF_TGT']) assert.ok(src.includes(k), 'shade.wgsl.js must use ' + k);
console.log('farForestNoon: ok');
