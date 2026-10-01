// engine/mesh/rasterDepthOnly.test.js (ME-15a, docs/architecture.md 27.9a item 9).
// rasterJS depth-only mode (`createRasterTarget(..., {depthOnly: true})`) + `ctx.depthBias`.
// Run: node engine/mesh/rasterDepthOnly.test.js
import { DrawList, DRAW_STATIC } from './DrawList.js';
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { KIND_FLOOR, FACE_U } from '../render/GBuffer.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function quad(id, p12) {
  const b = new StaticMeshBuilder(id);
  const mat = b.matIndex('floor');
  b.addQuad(p12, [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(KIND_FLOOR, FACE_U, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  return b.build();
}
function listOf(...meshes) {
  const l = new DrawList(8);
  l.begin();
  for (const m of meshes) l.push(m, DRAW_STATIC).rangeCount = m.triCount;
  return l;
}
// Orthographic-ish "light" M: x/y span [-8, 8] m, clip z = (z - 10) / 10 (z up = farther... depth = z).
const M = new Float64Array(16);
M[0] = 1 / 8; M[5] = 1 / 8; M[10] = 0.1; M[14] = -1; M[15] = 1; // z_clip = 0.1 z - 1 -> z in [0,20] -> [-1, 1]

const flat = quad('flat', [-6, -6, 5, 6, -6, 5, 6, 6, 5, -6, 6, 5]); // constant depth z=5 -> zn = -0.5
const slope = quad('slope', [-6, -6, 2, 6, -6, 2, 6, 6, 12, -6, 6, 12]); // depth ramps along y

{
  const full = createRasterTarget(64, 64, 1);
  const only = createRasterTarget(64, 64, 1, { depthOnly: true });
  const l = listOf(flat, slope);
  rasterDrawList(l, full, { M });
  rasterDrawList(l, only, { M });
  let same = true, covered = 0;
  for (let i = 0; i < full.zbuf.length; i++) { if (full.zbuf[i] !== only.zbuf[i]) same = false; if (only.zbuf[i] < 1) covered++; }
  ok('depth-only zbuf == full raster zbuf (bit-identical)', same);
  ok('depth-only covers the quad area (~ 12/16 of the map)', covered > 64 * 64 * 0.5 && covered < 64 * 64 * 0.7, `covered=${covered}`);
  ok('depth-only skips attribute planes', only.kind.length === 0 && only.nrm.length === 0 && only.depth.length === 0);
}

{
  // Flat triangle: slope 0 -> bias = 2 * units * 2^-24 exactly (the GPU polygon-offset "units * r" term, NDC z span 2).
  const t0 = createRasterTarget(64, 64, 1, { depthOnly: true });
  const t1 = createRasterTarget(64, 64, 1, { depthOnly: true });
  rasterDrawList(listOf(flat), t0, { M });
  rasterDrawList(listOf(flat), t1, { M, depthBias: { factor: 2, units: 4 } });
  const i = 32 * 64 + 32;
  const d = t1.zbuf[i] - t0.zbuf[i];
  ok('flat: bias = 2 * units * 2^-24', Math.abs(d - 8 * Math.pow(2, -24)) < 1e-15, `d=${d}`);
}

{
  // Sloped quad: bias = factor * max(|dz/dx|, |dz/dy|) + 2 * units * 2^-24 per window pixel.
  const t0 = createRasterTarget(64, 64, 1, { depthOnly: true });
  const t1 = createRasterTarget(64, 64, 1, { depthOnly: true });
  rasterDrawList(listOf(slope), t0, { M });
  rasterDrawList(listOf(slope), t1, { M, depthBias: { factor: 2, units: 4 } });
  // zn(y) = 0.1 * (2 + 10 * (y + 6) / 12) - 1; window Y = 32 * (y / 8) + 32 -> dzn/dpx = 0.1 * 10 / 12 / (4) per px
  const dzdPix = (0.1 * 10 / 12) / 4;
  const want = 2 * dzdPix + 8 * Math.pow(2, -24);
  const i = 32 * 64 + 32;
  const d = t1.zbuf[i] - t0.zbuf[i];
  ok('slope: bias = factor * |dz/dpx| + 2 * units * 2^-24', Math.abs(d - want) < 1e-9, `d=${d} want=${want}`);
  // The same formula applies to every item (no DRAW_FLAG_DEPTH_BIAS needed) and a missing depthBias leaves depth untouched.
  const t2 = createRasterTarget(64, 64, 1, { depthOnly: true });
  rasterDrawList(listOf(slope), t2, { M });
  ok('no depthBias: unchanged', t2.zbuf[i] === t0.zbuf[i]);
}

{
  // Depth test keeps the nearest: flat (zn -0.5) in front of a farther quad (z=10 -> zn 0).
  const far = quad('far', [-6, -6, 10, 6, -6, 10, 6, 6, 10, -6, 6, 10]);
  const t = createRasterTarget(64, 64, 1, { depthOnly: true });
  rasterDrawList(listOf(far, flat), t, { M });
  ok('nearest depth wins', Math.abs(t.zbuf[32 * 64 + 32] - -0.5) < 1e-12, `z=${t.zbuf[32 * 64 + 32]}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
