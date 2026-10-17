// AUD-47 order-of-operations twin: the JS shade applies the vegetation gain BEFORE fog (as WGSL fs_main does:
// rgbF *= vegGain; rgbBg *= vegGain; ...; fog mix). Expected fg = F*f + g*(base - F*f) where base = same cell without the marker.
// Run: node engine/render/vegTint.shade.test.js
import assert from 'node:assert/strict';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { shadeSurfaces } from './detailShade.js';
import { vegTintObjectId, vegTintGain } from '../mesh/vegTint.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
globalThis.window = globalThis.window || globalThis; paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
const COLS = 16, ROWS = 8, N = COLS * ROWS;
const table = bindShading(assets.palette, assets.detailPass, 1);
const DP = assets.detailPass;
const gbuf = new GBuffer(COLS, ROWS), depth = new DepthBuffer(COLS, ROWS);
gbuf.objectId = new Uint32Array(N);
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const fog = table.fog, span = fog.full - fog.start;
for (let i = 0; i < N; i++) {
  gbuf.kind[i] = 1; gbuf.mat[i] = 1; gbuf.u[i] = rnd() * 4; gbuf.v[i] = rnd() * 4; gbuf.z[i] = rnd() * 2;
  depth.depth[i] = fog.start + span * (0.2 + 0.6 * rnd()); // inside the fog ramp: 0.2 < f < 0.8
}
const light = { uniform: true, rgb: new Float32Array([0.9, 0.8, 0.7]) };
const run = () => { const rt = new CellBuffer(COLS, ROWS); shadeSurfaces({ rt, depth, palette: assets.palette }, gbuf, table, DP, light); return { rt, f: Float32Array.from(gbuf.fogF) }; };
gbuf.objectId.fill(0);
const base = run();
for (let i = 0; i < N; i++) gbuf.objectId[i] = vegTintObjectId(0x30000 | i, i, i * 1.7, i * 0.9);
const tinted = run();
const g = new Float32Array(3); let checked = 0, afterFogWouldFail = 0;
for (let i = 0; i < N; i++) {
  assert.ok(vegTintGain(gbuf.objectId[i], g));
  const f = base.f[i]; assert.ok(f > 0.1 && f < 1);
  for (const [arr, F] of [['fg', fog.fgRGB], ['bg', fog.bgRGB]]) {
    for (let c = 0; c < 3; c++) {
      const b = base.rt[arr][i * 4 + c], fogPart = F[c] * f;
      const want = fogPart + g[c] * (b - fogPart), afterFog = b * g[c];
      const got = tinted.rt[arr][i * 4 + c];
      assert.ok(Math.abs(got - Math.min(255, Math.max(0, want))) <= 3, `cell ${i} ${arr}${c}: got ${got}, before-fog expect ${want.toFixed(1)}`);
      if (Math.abs(got - afterFog) > 3) afterFogWouldFail++;
      checked++;
    }
  }
}
assert.ok(afterFogWouldFail > 20, 'test discriminates before-fog from after-fog (' + afterFogWouldFail + ')');
console.log('vegTint.shade: ok (' + checked + ' channels, before-fog order)');
