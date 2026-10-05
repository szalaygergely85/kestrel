// engine/render/shadowSun.test.js (ME-15a, docs/architecture.md 27.9a ACs 1, 2, 4, 5).
// Zero-allocation gate is hard: when `global.gc` is missing this file re-runs itself with `--expose-gc`.
// Run: node engine/render/shadowSun.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SUN_SHADOW_DEFAULTS, resolveSunShadowOptions, createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowTaps,
} from './shadowSun.js';
import { dirFromAzEl } from '../core/transform.js';
import { classifyAABB, CULL_OUT } from '../mesh/culling.js';
import { DrawList, DRAW_STATIC } from '../mesh/DrawList.js';
import { createRasterTarget, clearRasterTarget, rasterDrawList } from '../mesh/rasterJS.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from '../mesh/MeshData.js';
import { KIND_FLOOR, FACE_U } from './GBuffer.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- options -----------------------------------------------------------
{
  ok('defaults frozen', Object.isFrozen(SUN_SHADOW_DEFAULTS) && Object.isFrozen(SUN_SHADOW_DEFAULTS.depthBias));
  ok('defaults match 27.9a', SUN_SHADOW_DEFAULTS.res === 2048 && SUN_SHADOW_DEFAULTS.boxM === 192 && SUN_SHADOW_DEFAULTS.aheadM === 64
    && SUN_SHADOW_DEFAULTS.depthBias[0] === 2 && SUN_SHADOW_DEFAULTS.depthBias[1] === 4
    && SUN_SHADOW_DEFAULTS.biasM === 0.04 && SUN_SHADOW_DEFAULTS.normalOffsetTexels === 1.5);
  ok("sun defaults: mesh -> 'map', dda -> 'dda'", resolveSunShadowOptions(null, 'mesh').sun === 'map' && resolveSunShadowOptions({}, 'dda').sun === 'dda');
  let threw = false;
  try { resolveSunShadowOptions({ sun: 'map' }, 'dda'); } catch (e) { threw = true; }
  ok("'map' on the dda renderer throws", threw);
  ok('ME-15f defaults meshLod0M 25 / instCastM 48; instCastM override', SUN_SHADOW_DEFAULTS.meshLod0M === 25 && SUN_SHADOW_DEFAULTS.instCastM === 48 && resolveSunShadowOptions({ instCastM: 32 }, 'mesh').instCastM === 32);
  { let t = false; try { resolveSunShadowOptions({ meshLod0M: 60 }, 'mesh'); } catch (e) { t = true; } ok('ME-15f: meshLod0M > instCastM throws', t); }
  ok('sun:false passes through', resolveSunShadowOptions({ sun: false }, 'mesh').sun === false);
  ok('user res overrides, rest default', resolveSunShadowOptions({ res: 512 }, 'mesh').res === 512 && resolveSunShadowOptions({ res: 512 }, 'mesh').boxM === 192);
}

// ---- centre rules ------------------------------------------------------
{
  const c = new Float64Array(3);
  sunShadowCentre({ x: 10, y: 20, z: 3, yawDeg: 0 }, SUN_SHADOW_DEFAULTS, c);
  ok('first person centre = eye + 64 m forward (yaw 0 = north = -y)', Math.abs(c[0] - 10) < 1e-9 && Math.abs(c[1] - (20 - 64)) < 1e-9 && c[2] === 3, `${c}`);
  sunShadowCentre({ x: 10, y: 20, z: 3, yawDeg: 90 }, SUN_SHADOW_DEFAULTS, c);
  ok('yaw 90 = east', Math.abs(c[0] - 74) < 1e-9 && Math.abs(c[1] - 20) < 1e-9, `${c}`);
  sunShadowCentre({ x: 0, y: 0, z: 50, yawDeg: 33, focusX: 5, focusY: 6, focusZ: 7 }, SUN_SHADOW_DEFAULTS, c);
  ok('pitched/RTS centre = focus', c[0] === 5 && c[1] === 6 && c[2] === 7);
}

// ---- matrix: snapping (AC 1), box extents, depth range (AC 2) ---------------
const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 64 };
const TEXEL = OPTS.boxM / OPTS.res; // 0.125 m
const WORLD_Z = { min: 0, max: 40 };
const sunDir = dirFromAzEl(135, 30, new Float64Array(3));
const H = OPTS.boxM / 2;

function basis(M) { // light-space r/u from the matrix rows
  return { r: [M[0] * H, M[4] * H, M[8] * H], u: [M[1] * H, M[5] * H, M[9] * H] };
}
const tmp = createSunShadowMatrix();
shadowSunMatrix(sunDir, [11, 18, 0], OPTS, WORLD_Z, tmp);
const { r: R, u: U } = basis(tmp.M);
// Nudge the centre so its snapped fractions sit at 0.2 texel (a +0.3 texel move never crosses a boundary).
function frac(x) { return x - Math.floor(x); }
const c00 = [11, 18, 0];
const fr = frac((c00[0] * R[0] + c00[1] * R[1] + c00[2] * R[2]) / TEXEL);
const fu = frac((c00[0] * U[0] + c00[1] * U[1] + c00[2] * U[2]) / TEXEL);
const a = ((0.2 - fr + 1) % 1) * TEXEL, b = ((0.2 - fu + 1) % 1) * TEXEL;
const c0 = [0, 1, 2].map((i) => c00[i] + a * R[i] + b * U[i]);
function mat(c) { const o = createSunShadowMatrix(); shadowSunMatrix(sunDir, c, OPTS, WORLD_Z, o); return o; }
function bitEq(A, B) { for (let i = 0; i < 16; i++) if (!Object.is(A[i], B[i])) return false; return true; }
{
  const m0 = mat(c0);
  ok('texelM = boxM / res', m0.texelM === TEXEL);
  const mr = mat([0, 1, 2].map((i) => c0[i] + 0.3 * TEXEL * R[i]));
  const mu = mat([0, 1, 2].map((i) => c0[i] + 0.3 * TEXEL * U[i]));
  ok('0.3 texel eye move along r: M bit-identical', bitEq(m0.M, mr.M));
  ok('0.3 texel eye move along u: M bit-identical', bitEq(m0.M, mu.M));
  ok('0.3 texel move: planes bit-identical', m0.planes.every((v, i) => Object.is(v, mr.planes[i])));
  // 1 texel move along r shifts a test point's uv by exactly 1/res (and nothing else).
  const P = [10.7, 19.3, 1.5];
  function uvz(m) {
    const M = m.M;
    return [(M[0] * P[0] + M[4] * P[1] + M[8] * P[2] + M[12] + 1) / 2, (M[1] * P[0] + M[5] * P[1] + M[9] * P[2] + M[13] + 1) / 2,
      M[2] * P[0] + M[6] * P[1] + M[10] * P[2] + M[14]];
  }
  const p0 = uvz(m0);
  const m1r = mat([0, 1, 2].map((i) => c0[i] + TEXEL * R[i]));
  const p1 = uvz(m1r);
  ok('1 texel move along r: u shifts by exactly 1/res', Math.abs(Math.abs(p1[0] - p0[0]) - 1 / OPTS.res) < 1e-12, `du=${p1[0] - p0[0]}`);
  ok('1 texel move along r: v and depth unchanged', Math.abs(p1[1] - p0[1]) < 1e-12 && p1[2] === p0[2], `dv=${p1[1] - p0[1]}`);
  const m1u = mat([0, 1, 2].map((i) => c0[i] + TEXEL * U[i]));
  const p2 = uvz(m1u);
  ok('1 texel move along u: v shifts by exactly 1/res', Math.abs(Math.abs(p2[1] - p0[1]) - 1 / OPTS.res) < 1e-12 && Math.abs(p2[0] - p0[0]) < 1e-12);
  // Box extents: points at +-(boxM/2 - eps) along r/u (through the snapped centre) are inside, +eps beyond are outside.
  const cs = [0, 1, 2].map((i) => 0); // snapped centre in world = cr*r + cu*u + (anything along f); use M's own origin
  const ndc = (p) => [m0.M[0] * p[0] + m0.M[4] * p[1] + m0.M[8] * p[2] + m0.M[12], m0.M[1] * p[0] + m0.M[5] * p[1] + m0.M[9] * p[2] + m0.M[13]];
  const at = (s, t) => [0, 1, 2].map((i) => c0[i] + s * R[i] + t * U[i]);
  const e0 = ndc(c0);
  ok('centre maps within one texel of clip origin', Math.abs(e0[0]) <= 2 / OPTS.res && Math.abs(e0[1]) <= 2 / OPTS.res, `${e0}`);
  const inB = ndc(at(H - 0.5, -(H - 0.5))), outB = ndc(at(H + 0.5, 0));
  ok('box edge: inside at half-0.5 m, outside at half+0.5 m', Math.abs(inB[0]) < 1 && Math.abs(inB[1]) < 1 && Math.abs(outB[0]) > 1, `${inB} ${outB}`);
  // Depth range: every world-box corner has clip z in [-1, 1].
  let zlo = Infinity, zhi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = [c0[0] + ((i & 1) ? H : -H), c0[1] + ((i & 2) ? H : -H), (i & 4) ? WORLD_Z.max : WORLD_Z.min];
    const z = m0.M[2] * p[0] + m0.M[6] * p[1] + m0.M[10] * p[2] + m0.M[14];
    zlo = Math.min(zlo, z); zhi = Math.max(zhi, z);
  }
  ok('world box corners inside the depth range', zlo >= -1 - 1e-9 && zhi <= 1 + 1e-9, `z ${zlo}..${zhi}`);
  // AC 2: 40 m tower 30 m upstream (toward the sun) of the xy box edge, outside the world xy box, is inside the frustum.
  const sx = sunDir[0] / Math.hypot(sunDir[0], sunDir[1]), sy = sunDir[1] / Math.hypot(sunDir[0], sunDir[1]);
  const D = H * Math.SQRT2 + 30; // beyond even the box corner along the sun direction
  const tx = c0[0] + sx * D, ty = c0[1] + sy * D;
  const outsideXY = Math.abs(tx - c0[0]) > H || Math.abs(ty - c0[1]) > H;
  ok('tower really is outside the xy box', outsideXY, `dx=${tx - c0[0]} dy=${ty - c0[1]}`);
  const cls = classifyAABB(m0.planes, tx - 2, ty - 2, 0, tx + 2, ty + 2, 40);
  ok('tower 30 m upstream: classifyAABB != OUT', cls !== CULL_OUT, `cls=${cls}`);
  const tzTop = m0.M[2] * tx + m0.M[6] * ty + m0.M[10] * 40 + m0.M[14];
  ok('tower top clip z >= -1', tzTop >= -1, `z=${tzTop}`);
  const clsTop = classifyAABB(m0.planes, tx - 2, ty - 2, 20, tx + 2, ty + 2, 40);
  ok('tower top slab (z 20..40): classifyAABB != OUT', clsTop !== CULL_OUT, `cls=${clsTop}`);
  // and a box well off to the side (lateral > half) is OUT
  const side = classifyAABB(m0.planes, c0[0] + R[0] * (H + 20) - 1, c0[1] + R[1] * (H + 20) - 1, 0, c0[0] + R[0] * (H + 20) + 1, c0[1] + R[1] * (H + 20) + 1, 2);
  ok('lateral caster beyond the box is OUT', side === CULL_OUT, `cls=${side}`);
  // pole sun: up vector switches, matrix finite
  const pole = createSunShadowMatrix();
  shadowSunMatrix([0, 0, 1], [0, 0, 0], OPTS, WORLD_Z, pole);
  ok('sun straight up: finite matrix', pole.M.every(Number.isFinite));
}

// ---- JS depth-only raster of a fixture -> sunShadowTaps (AC 4) -------------
function quadMesh(id, p12) {
  const b = new StaticMeshBuilder(id);
  const mat = b.matIndex('floor');
  b.addQuad(p12, [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(KIND_FLOOR, FACE_U, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  return b.build();
}
{
  const ground = quadMesh('ground', [-50, -50, 0, 50, -50, 0, 50, 50, 0, -50, 50, 0]);
  const top = quadMesh('boxTop', [-2, -2, 4, 2, -2, 4, 2, 2, 4, -2, 2, 4]);
  const list = new DrawList(4);
  list.begin();
  for (const m of [ground, top]) list.push(m, DRAW_STATIC).rangeCount = m.triCount;
  const fixSun = dirFromAzEl(0, 60, new Float64Array(3)); // sun to the north: shadow falls +y
  const sm = createSunShadowMatrix();
  shadowSunMatrix(fixSun, [0, 0, 0], OPTS, { min: 0, max: 4 }, sm);
  const map = createRasterTarget(OPTS.res, OPTS.res, 1, { depthOnly: true });
  ok('depth-only target: only zbuf allocated', map.depthOnly && map.zbuf.length === 512 * 512 && map.kind.length === 0 && map.nrm.length === 0);
  rasterDrawList(list, map, { M: sm.M, depthBias: { factor: OPTS.depthBias[0], units: OPTS.depthBias[1] } });
  let covered = 0;
  for (let i = 0; i < map.zbuf.length; i++) if (map.zbuf[i] < 1) covered++;
  ok('fixture rasterised some texels', covered > 1000, `covered=${covered}`);
  const N = [0, 0, 1];
  const nUnder = sunShadowTaps(map, sm.M, [0, 2, 0], N, OPTS);
  ok('under the box (in its shadow): n = 0', nUnder === 0, `n=${nUnder}`);
  let openBad = 0, openCount = 0;
  for (const p of [[30, 30], [-30, -30], [0, -10], [25, -25], [-20, 20], [10, -3]]) {
    openCount++;
    const n = sunShadowTaps(map, sm.M, [p[0], p[1], 0], N, OPTS);
    if (n !== 4) openBad++;
  }
  ok('open ground: n = 4 (no self-shadow acne)', openBad === 0, `${openBad}/${openCount} not 4`);
  // top of the box lit
  ok('box top: n = 4', sunShadowTaps(map, sm.M, [0, 0, 4], N, OPTS) === 4);
  // scan across the shadow edge along x = 0: shadow spans y in [4 - 2... ] derived numerically from the 0/4 transitions
  let first0 = null, last0 = null;
  const ns = [];
  for (let y = -3; y <= 8; y += 0.01) {
    const n = sunShadowTaps(map, sm.M, [0, y, 0], N, OPTS);
    ns.push(n);
    if (n === 0) { if (first0 === null) first0 = y; last0 = y; }
  }
  ok('a fully shadowed run exists', first0 !== null && last0 - first0 > 2, `first0=${first0} last0=${last0}`);
  let band = 0, stray = 0;
  for (let i = 0; i < ns.length; i++) {
    const y = -3 + i * 0.01;
    if (ns[i] >= 1 && ns[i] <= 3) {
      band++;
      if (Math.min(Math.abs(y - first0), Math.abs(y - last0)) > 0.5) stray++;
    }
  }
  ok('1..3 only on the edge band (within 0.5 m of the 0/4 transition)', stray === 0, `band=${band} stray=${stray}`);
  ok('values outside the run are 4', ns[0] === 4 && ns[ns.length - 1] === 4);
  // outside the box region: sunlit
  ok('receiver outside the box: n = 4', sunShadowTaps(map, sm.M, [500, 500, 0], N, OPTS) === 4);
  clearRasterTarget(map);
  ok('cleared map: all sunlit', sunShadowTaps(map, sm.M, [0, 2, 0], N, OPTS) === 4);
}

// ---- zero allocation (AC 5) ----------------------------------------------------
{
  const sm = createSunShadowMatrix();
  const centre = new Float64Array(3);
  const map = createRasterTarget(OPTS.res, OPTS.res, 1, { depthOnly: true });
  const cam = { x: 0, y: 0, z: 2, yawDeg: 0 };
  const P = [3, 4, 0], N = [0, 0, 1];
  let sink = 0;
  const run = (k) => {
    for (let i = 0; i < k; i++) {
      cam.x = i * 0.01;
      sunShadowCentre(cam, OPTS, centre);
      shadowSunMatrix(sunDir, centre, OPTS, WORLD_Z, sm);
      P[0] = i * 0.001;
      sink += sunShadowTaps(map, sm.M, P, N, OPTS);
    }
  };
  run(2000);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  run(100000);
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('shadowSunMatrix + sunShadowTaps: no heap growth over 100k frames', grew < 64 * 1024, `grew ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
