// AUD-45 parity fix: the edge-pass gate (gbuf.fogF, JS) must be the LINEAR distance fog, like edge.wgsl fogF(dist), while the
// shade colour uses the height-boosted f + sun in-scatter (shade.wgsl fs_main AUD-45 block). Before the fix JS stored the
// boosted f, so in valley cells (f boosted past edges.fogMax) JS skipped the edge rule while the GPU drew it (fg x edgeGain,
// bg untouched) -> gpucompare fg diffs on outdoor kind-9 rows. Drives the JS twin and a replay of the WGSL expressions with
// the uniform values passShade.js writes (fogStart/fogFull, fogView, skyCam, horizonRow, planeDistY, sunDir, sunI).
// Run: node engine/render/fogEdgeGate.test.js
import assert from 'node:assert/strict';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { shadeSurfaces } from './detailShade.js';
import { fogShapeCtx, FOG_SHAPE } from './fogShape.js';
import { SKY_GLOW } from './skyGlow.js';
import { projTerms, PROJ_HFOV_DEG } from './projection.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
globalThis.window = globalThis.window || globalThis; paletteMod; detailPassMod;
const { assets } = await loadTestAssets();
const COLS = 32, ROWS = 16, N = COLS * ROWS;
const table = bindShading(assets.palette, assets.detailPass, 1);
const DP = assets.detailPass, fog = table.fog, fogMax = DP.edges.fogMax;
const gbuf = new GBuffer(COLS, ROWS), depth = new DepthBuffer(COLS, ROWS);
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < N; i++) {
  gbuf.kind[i] = 1; gbuf.mat[i] = 1; gbuf.u[i] = rnd() * 4; gbuf.v[i] = rnd() * 4; gbuf.z[i] = rnd() * 2;
  depth.depth[i] = fog.start + (fog.full - fog.start) * (0.1 + 0.95 * rnd());
}
// Camera low in a valley (eye z 1 m < FOG_SHAPE.base) looking toward a low morning sun -> strong boost + scatter.
const cam = { x: 0, y: 0, z: 1, yawDeg: 80, pitchDeg: 0 };
const terms = projTerms(cam, { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 }, {});
const sun = { x: Math.sin(80 * Math.PI / 180) * 0.95, y: -Math.cos(80 * Math.PI / 180) * 0.95, z: 0.3122, I: 0.9 };
Object.assign(fogShapeCtx, { on: true, mode: 0, camZ: cam.z, terms, sunX: sun.x, sunY: sun.y, sunZ: sun.z, sunI: sun.I });
const rt = new CellBuffer(COLS, ROWS);
shadeSurfaces({ rt, depth, palette: assets.palette }, gbuf, table, DP, { uniform: true, rgb: new Float32Array([0.9, 0.8, 0.7]) });
fogShapeCtx.on = false;

// ---- WGSL replay (f32-free JS transliteration; uniforms as passShade.js writes them) ----
const th = Math.tan(PROJ_HFOV_DEG * Math.PI / 360), yr = cam.yawDeg * Math.PI / 180, dX = Math.sin(yr), dY = -Math.cos(yr);
const su = { fogStart: fog.start, fogFull: fog.full, fogView: [cam.z, 1], skyCam: [dX, dY, -dY * th, dX * th],
  horizonRow: terms.horizonRow, planeDistY: terms.planeDistY, sunDir: [sun.x, sun.y, sun.z], sunI: sun.I };
const linF = (dist) => (dist <= su.fogStart ? 0 : dist >= su.fogFull ? 1 : (dist - su.fogStart) / (su.fogFull - su.fogStart)); // shade + edge fogF
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function wgslFog(col, row, dist) { // fs_main AUD-45 block: fogCellDir (projMode 0) + fogShapeF + fogScatterW
  let f = linF(dist); let w = 0;
  if (su.fogView[1] > 0.5 && f > 0) {
    const cx = (2 * (col + 0.5)) / COLS - 1, hx = su.skyCam[0] + su.skyCam[2] * cx, hy = su.skyCam[1] + su.skyCam[3] * cx;
    const tanE = (su.horizonRow - row) / su.planeDistY, ce = 1 / Math.sqrt(1 + tanE * tanE), ih = 1 / Math.sqrt(Math.max(hx * hx + hy * hy, 1e-12));
    const fd = [hx * ih * ce, hy * ih * ce, tanE * ce], P = FOG_SHAPE;
    const v = Math.min(Math.exp(-(su.fogView[0] + fd[2] / Math.sqrt(Math.max(fd[0] ** 2 + fd[1] ** 2, 1e-12)) * dist * 0.5 - P.base) * P.k), P.maxValley);
    f = Math.min(f * (1 + P.heightGain * v), 1);
    const s = Math.min(1, Math.max(0, su.sunI)) * sm(SKY_GLOW.sunFadeLo, SKY_GLOW.sunFadeHi, su.sunDir[2]);
    w = Math.pow(Math.max(fd[0] * su.sunDir[0] + fd[1] * su.sunDir[1] + fd[2] * su.sunDir[2], 0), P.scatterK) * P.scatterGain * s;
  }
  return { f, w };
}

let boostedPast = 0, scattered = 0;
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
  const i = row * COLS + col, dist = depth.depth[i];
  // 1) edge gate: JS gbuf.fogF == edge.wgsl fogF(dist) -> same rule decision.
  assert.ok(Math.abs(gbuf.fogF[i] - linF(dist)) < 1e-6, `edge gate f cell ${i}: js ${gbuf.fogF[i]} wgsl ${linF(dist)}`);
  assert.equal(gbuf.fogF[i] <= fogMax, linF(dist) <= fogMax, `edge rule gate cell ${i}`);
  const g = wgslFog(col, row, dist);
  if (linF(dist) <= fogMax && g.f > fogMax) boostedPast++;
  if (g.w > 0.01) scattered++;
  // 2) colour: JS shade at full boosted fog == WGSL fog colour (scatter included), fg and bg.
  if (g.f >= 1) {
    for (const [arr, F] of [['fg', fog.fgRGB], ['bg', fog.bgRGB]]) for (let c = 0; c < 3; c++) {
      const want = F[c] + (SKY_GLOW.tint[c] - F[c]) * g.w, got = rt[arr][i * 4 + c];
      assert.ok(Math.abs(got - Math.min(255, Math.round(want))) <= 1, `cell ${i} ${arr}${c}: js ${got} wgsl ${want.toFixed(1)}`);
    }
  }
}
assert.ok(boostedPast > 10, 'test discriminates: cells whose boosted f passes fogMax while linear f does not (' + boostedPast + ')');
assert.ok(scattered > 5, 'test covers sun in-scatter (' + scattered + ')');
console.log(`fogEdgeGate: ok (${N} cells, ${boostedPast} boosted past fogMax, ${scattered} with scatter)`);
