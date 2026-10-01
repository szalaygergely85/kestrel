// engine/render/lighting.sunmap.test.js (ME-15c, docs/architecture.md 27.9a items 6, 10). `lightAt` with a sun shadow map:
// sun term = sunCol * N.sun * n / 4, sunlit = n >= 2, no sun DDA; terrain only reports n (4 when the sun is off).
// The map is a real depth-only rasterJS target holding one box, so n = 0 under it, 4 in the open, 1..3 on the edge band.
// Run: node engine/render/lighting.sunmap.test.js
import { LightSet, lightAt, lightFlags } from './lighting.js';
import { createSunShadowMatrix, shadowSunMatrix, SUN_SHADOW_DEFAULTS, sunShadowInfo } from './shadowSun.js';
import { createRasterTarget, rasterDrawList } from '../mesh/rasterJS.js';
import { DrawList, DRAW_STATIC } from '../mesh/DrawList.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from '../mesh/MeshData.js';
import { KIND_FLOOR, FACE_U } from './GBuffer.js';
import { dirFromAzEl } from '../core/transform.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 64 };
const ls = new LightSet();
ls.ambient[0] = ls.ambient[1] = ls.ambient[2] = 0.1;
ls.setSun({ elevation: 50, azimuth: 135, on: true });
ls.sun.col[0] = ls.sun.col[1] = ls.sun.col[2] = 1;
ls.update(0, null);
const sd = ls.sun.dir;

// A 4 x 4 m plate at z = 4 (one static quad = the shadow pass' input), centred over the origin.
function plate() {
  const b = new StaticMeshBuilder('plate');
  const mat = b.matIndex('floor');
  b.addQuad([-2, -2, 4, 2, -2, 4, 2, 2, 4, -2, 2, 4], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(KIND_FLOOR, FACE_U, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  return b.build();
}

const sm = createSunShadowMatrix();
shadowSunMatrix(sd, [0, 0, 2], OPTS, { min: 0, max: 4 }, sm);
const map = createRasterTarget(OPTS.res, OPTS.res, 1, { depthOnly: true });
{
  const list = new DrawList(4);
  list.begin();
  const m = plate();
  list.push(m, DRAW_STATIC).rangeCount = m.triCount;
  rasterDrawList(list, map, { M: sm.M, depthBias: { factor: 2, units: 4 }, structFoot: null, structCount: 0 });
}
const sunMap = { map, M: sm.M, opts: OPTS };
const out = [0, 0, 0];

// Shadow of the box on the ground (z = 0) lies away from the sun: toward -sunDir.xy.
const hx = Math.hypot(sd[0], sd[1]);
const dirX = -sd[0] / hx, dirY = -sd[1] / hx;
const inShadow = [dirX * 3.4, dirY * 3.4, 0]; // plate shadow centre: 4 m / tan(50 deg) = 3.36 m away from the sun
const lit = [-dirX * 12, -dirY * 12, 0];      // 12 m on the sun side
const far = [dirY * 20, -dirX * 20, 0];       // 20 m sideways

lightAt(ls, null, lit[0], lit[1], lit[2], 0, 0, 1, out, null, 0, false, sunMap);
const ndotsun = sd[2];
ok('open ground: n = 4, sunlit, full sun term', lightFlags.sunN === 4 && lightFlags.sunlit === 1 && Math.abs(out[0] - (0.1 + ndotsun)) < 1e-6, `n=${lightFlags.sunN} out=${out[0]}`);
lightAt(ls, null, inShadow[0], inShadow[1], inShadow[2], 0, 0, 1, out, null, 0, false, sunMap);
ok('ground behind the box: n = 0, not sunlit, ambient only', lightFlags.sunN === 0 && lightFlags.sunlit === 0 && Math.abs(out[0] - 0.1) < 1e-6, `n=${lightFlags.sunN} out=${out[0]}`);
lightAt(ls, null, far[0], far[1], far[2], 0, 0, 1, out, null, 0, false, sunMap);
ok('ground to the side: n = 4', lightFlags.sunN === 4);

// Edge band: walk across the shadow edge, expect to see partial n at least once and the boundary flag there.
{
  let partial = 0, mono = true, prev = 0;
  for (let t = 0; t <= 40; t += 0.01) {
    const px = dirX * t, py = dirY * t;
    lightAt(ls, null, px, py, 0, 0, 0, 1, out, null, 0, false, sunMap);
    if (lightFlags.sunN >= 1 && lightFlags.sunN <= 3) { partial++; }
    const expect = Math.abs(out[0] - (0.1 + ndotsun * lightFlags.sunN * 0.25)) < 1e-6;
    if (!expect) mono = false;
    prev = lightFlags.sunN;
  }
  void prev;
  ok('sun term is exactly ndotsun * n / 4 along a walk across the shadow', mono);
  ok('partial n (1..3) occurs on the edge band', partial > 0, `partial samples ${partial}`);
}

// Terrain (skipSun): only n, no sun contribution; sun off -> n = 4.
lightAt(ls, null, inShadow[0], inShadow[1], inShadow[2], 0, 0, 1, out, null, 0, true, sunMap);
ok('terrain behind the box: n = 0 reported, sun term NOT added here', lightFlags.sunN === 0 && Math.abs(out[0] - 0.1) < 1e-6);
lightAt(ls, null, lit[0], lit[1], lit[2], 0, 0, 1, out, null, 0, true, sunMap);
ok('terrain in the open: n = 4 reported, still no sun term from lightAt', lightFlags.sunN === 4 && Math.abs(out[0] - 0.1) < 1e-6);
ls.setSun({ elevation: 50, azimuth: 135, on: false });
lightAt(ls, null, inShadow[0], inShadow[1], inShadow[2], 0, 0, 1, out, null, 0, true, sunMap);
ok('sun off: terrain n = 4 (no occlusion info = lit)', lightFlags.sunN === 4 && lightFlags.sunlit === 0);
lightAt(ls, null, inShadow[0], inShadow[1], inShadow[2], 0, 0, 1, out, null, 0, false, sunMap);
ok('sun off: non-terrain n = 0, ambient only', lightFlags.sunN === 0 && Math.abs(out[0] - 0.1) < 1e-6);
ls.setSun({ elevation: 50, azimuth: 135, on: true });

// A surface facing away from the sun never computes taps (n = 0), like the GLSL twin.
lightAt(ls, null, lit[0], lit[1], lit[2], 0, 0, -1, out, null, 0, false, sunMap);
ok('N.sun <= 0 (non-terrain): n = 0, no sun', lightFlags.sunN === 0 && lightFlags.sunlit === 0);

// No map -> the old DDA path leaves sunN = 0 (null world: sunVisible lit).
lightAt(ls, null, lit[0], lit[1], lit[2], 0, 0, 1, out, null, 0, false, null);
ok('no sunMap: legacy path, sunN stays 0', lightFlags.sunN === 0 && lightFlags.sunlit === 1);
void sunShadowInfo;

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
