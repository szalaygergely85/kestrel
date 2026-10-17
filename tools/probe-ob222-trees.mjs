// OB-222 scratch probe: far tree card base (scatter z) vs the far terrain the card stands on. Run: node tools/probe-ob222-trees.mjs
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/models/lantern.js';
import '../design/models/lever.js';
import '../design/models/voxel_props.js';
import '../design/models/boulder.js';
import '../design/models/rubble.js';
import '../design/models/wreckage.js';
import '../design/models/relay.js';
import '../design/models/sword.js';
import '../design/models/m3_props.js';
import '../design/models/far_tower.js';
import '../design/models/ferrum_lights.js';
import { World } from '../engine/world/World.js';
import { loadTestAssets } from './testing/content-node.mjs';
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', detail: false });
const T = w.terrain; if (!T.farReady) T.bakeFarSync();
console.log('world keys', Object.keys(w).join(','));
console.log('trees', w.trees ? Object.keys(w.trees) : null, 'farReady', typeof T.farHeightAt, 'mapCell', T.mapCell, 'mapW', T.mapW);
import("../engine/world/scatter.js").then(()=>{});
const { scatterTrees } = await import("../engine/world/scatter.js");
const tr = scatterTrees(T, []);
console.log("scatter", tr && tr.count, "nearReady", T.nearReady);
if (tr && tr.count) {
  const hist = { n: 0, maxAbove: 0, maxBelow: 0, over1: 0 }, p = [];
  for (let i = 0; i < tr.count; i++) {
    const g = T.farHeightAt(tr.x[i], tr.y[i]); const d = tr.z[i] - g; // >0 = card base above far terrain ground (floating)
    hist.n++; if (d > hist.maxAbove) hist.maxAbove = d; if (-d > hist.maxBelow) hist.maxBelow = -d; if (Math.abs(d) > 1) hist.over1++;
  }
  console.log(hist);
}
for (let i = 0; i < tr.count; i += 90) console.log(i, tr.x[i].toFixed(0), tr.y[i].toFixed(0), 'z', tr.z[i].toFixed(1), 'ground', T.groundAt(tr.x[i], tr.y[i]).toFixed(1), 'farH', T.farHeightAt(tr.x[i], tr.y[i]).toFixed(1), 'type', T.typeAt ? T.typeAt(tr.x[i], tr.y[i]) : '?');
console.log('farH nonzero', T.farH.some((v) => v !== 0), 'ready flag', T.farReady);
{ // far cards: analytic ground (card base, scatter z = groundAt - 0.1) vs the baked 8 m far grid the far hill is drawn from, whole map, forest cells
  let n = 0, gt1 = 0, gt2 = 0, max = 0, wx = 0, wy = 0, s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 200000; k++) {
    const x = T.mapX0 + rnd() * T.mapW * T.mapCell, y = T.mapY0 + rnd() * T.mapH * T.mapCell;
    if (T.typeAt(x, y) !== 1) continue; const f = T.farHeightAt(x, y); if (f === null) continue;
    const d = Math.abs(T.heightAt(x, y) - 0.1 - f); n++; if (d > 1) gt1++; if (d > 2) gt2++; if (d > max) { max = d; wx = x; wy = y; }
  }
  console.log('forest cells', n, 'card-base vs far-grid |d|>1m', gt1, '>2m', gt2, 'max', max.toFixed(1), 'at', wx.toFixed(0), wy.toFixed(0));
}
{ // shade a far forest cell at noon (JS twin of the terrain pass): ambientI 0.16, sunI 1.1, sunElev 75; K = GI ambient / flat sky (probe: side faces mean 0.85, worst 0.2)
  const { packTerrainTextures } = await import('../engine/render/gpu/TerrainTextures.js');
  const { makeTerrainShadeCtx, shadeTerrain } = await import('../engine/render/terrainShade.js');
  const pal = assets.palette;
  const ctx = makeTerrainShadeCtx(T.recipe, packTerrainTextures(T, pal), pal);
  const L = (o) => Math.round(0.2126 * o.fg[0] + 0.7152 * o.fg[1] + 0.0722 * o.fg[2]), LB = (o) => Math.round(0.2126 * o.bg[0] + 0.7152 * o.bg[1] + 0.0722 * o.bg[2]);
  const amb = 0.16, sun = 1.1, ndotlTop = Math.sin(75 * Math.PI / 180);
  console.log('fog', JSON.stringify({ s: ctx.fog.start, f: ctx.fog.full, near: ctx.fog.nearRGB, far: ctx.fog.farRGB }), 'bands', JSON.stringify(ctx.bands));
  for (const t of [200, 400, 800]) for (const [name, nz, ndotl, fm] of [['canopy top', 1, ndotlTop, 0], ['shaded face', 0, 0, 1], ['sunlit face', 0, 0.4, 1]]) for (const K of [1, 0.85, 0.2]) {
    const b = amb * K + sun * ndotl; const o = shadeTerrain(t, 1, b, 100, 200, 0, ctx, { glyph: 0, level: 0, fg: [0, 0, 0], bg: [0, 0, 0] }, fm, 10, 0, 0, nz);
    console.log('t', t, name.padEnd(11), 'K', K, 'b', b.toFixed(2), 'fg', [...o.fg].join(','), 'lumaFg', L(o), 'bg', [...o.bg].join(','), 'lumaBg', LB(o));
  }
}
