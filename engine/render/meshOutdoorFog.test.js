// OB-089: placed meshes fog like the terrain outdoors (palette.fog.far, 50..1500 m), not with the interior fogV2 (dark navy, full at 45 m).
// JS twin (detailShade.js shadeTail via fogShapeCtx.outdoor) vs a replay of the shade.wgsl fogView.z branch; indoor keeps fogV2.
// Run: node engine/render/meshOutdoorFog.test.js
import assert from 'node:assert/strict';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { shadeSurfaces } from './detailShade.js';
import { fogShapeCtx, meshOutdoorFog } from './fogShape.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
globalThis.window = globalThis.window || globalThis; paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
const P = assets.palette, table = bindShading(P, assets.detailPass, 1), fog = table.fog;
const far = P.fog.far, near = P.rgb[far.color], farC = P.rgb[far.colorFar];

function shade(dist, outdoor) {
  const gbuf = new GBuffer(2, 2), depth = new DepthBuffer(2, 2), rt = new CellBuffer(2, 2);
  for (let i = 0; i < 4; i++) { gbuf.kind[i] = 1; gbuf.mat[i] = 1; gbuf.u[i] = 1.3; gbuf.v[i] = 0.7; gbuf.z[i] = 1; depth.depth[i] = dist; }
  Object.assign(fogShapeCtx, { on: false, outdoor, tStart: far.start, tFull: far.full, tCurve: far.curve || 1, tNear: near, tFar: farC });
  shadeSurfaces({ rt, depth, palette: P }, gbuf, table, assets.detailPass, { uniform: true, rgb: new Float32Array([0.9, 0.8, 0.7]) });
  fogShapeCtx.outdoor = false;
  return { bg: [rt.bg[0], rt.bg[1], rt.bg[2]], gb: gbuf };
}
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const inFar = shade(80, false), outFar = shade(80, true);
// indoor at 80 m: fully fogged = fogV2 navy exactly
for (let c = 0; c < 3; c++) assert.ok(Math.abs(inFar.bg[c] - fog.bgRGB[c]) < 1.01, 'indoor 80 m = fogV2');
assert.ok(lum(inFar.bg) < 45, 'fogV2 is navy-dark');
// outdoor at 80 m: terrain factor ((80-50)/1450)^0.7 is small -> lit colour with a hint of the outdoor fog, never the navy
assert.ok(outFar.bg[2] < outFar.bg[0] + 5 && Math.max(...[0, 1, 2].map((c) => Math.abs(outFar.bg[c] - inFar.bg[c]))) >= 10, 'outdoor 80 m keeps the (warm, dark) lit colour, not the fogV2 navy (31,38,56)');
// indoor at 20 m: still the interior fog ramp (start 10 / full 45)
const in20 = shade(20, false), out20 = shade(20, false);
assert.deepEqual(in20.bg, out20.bg);
// WGSL replay of the fogView.z branch: bg = lit + (near + (far - near) * f - lit) * f, f = ((d - start) / (full - start)) ^ curve (lit = the unfogged cell at 40 m)
const lit = shade(40, true).bg;
const replay = (d) => { const f = Math.pow(Math.min(1, Math.max(0, (d - far.start) / (far.full - far.start))), far.curve || 1);
  return [0, 1, 2].map((c) => lit[c] + (near[c] + (farC[c] - near[c]) * f - lit[c]) * f); };
const o1200 = shade(1200, true);
for (const [d, got] of [[80, outFar.bg], [1200, o1200.bg]]) { const w = replay(d); for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - w[c]) <= 2.01, `outdoor ${d} m ch${c}: js ${got[c]} wgsl ${w[c].toFixed(1)}`); }
assert.ok(lum(o1200.bg) > 90, '1200 m outdoor mesh is light haze, not navy');
// gate helper: no terrain / indoors = off
assert.equal(meshOutdoorFog({}, { x: 0, y: 0 }, P), false, 'no terrain world -> interior fog');
const W = { terrain: {}, sectorAt: () => null };
assert.equal(meshOutdoorFog(W, { x: 0, y: 0 }, { ...P, timeOfDay: {} }), true, 'terrain world, outside every sector -> outdoor fog');
W.sectorAt = () => ({});
assert.equal(meshOutdoorFog(W, { x: 0, y: 0 }, { ...P, timeOfDay: {} }), false, 'inside a sector -> fogV2');
console.log('meshOutdoorFog.test ok', JSON.stringify({ indoor80: inFar.bg.map(Math.round), outdoor80: outFar.bg.map(Math.round), outdoor1200: o1200.bg.map(Math.round) }));
