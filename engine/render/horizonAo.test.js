// engine/render/horizonAo.test.js (S8-B2-20, docs/architecture.md 38.17).
// - HORIZON_AO_WGSL (common.wgsl.js) string rules + a JS-evaluated (wgslProbe) probe of `aoTapOcc` vs this file's
//   JS oracle (horizonAo.js), 5000 samples (unit N, |v| in 0..2 m including exactly R and in-plane v) within 1e-6.
// - In-plane v gives 0, v behind the surface gives 0, v along N at 0.5 m gives > 0.
// - aoFactor stays in [0.4, 1] for strength/occSum in [0,1].
// - Mutation: changing AO_BIAS or the `0.25` divisor in the WGSL string only makes the probe fail; dropping the
//   `c > 0` test makes the "behind gives 0" check fail.
// node engine/render/horizonAo.test.js
import assert from 'node:assert/strict';
import { HORIZON_AO_WGSL } from './gpu/wgsl/common.wgsl.js';
import { LIGHT_WGSL } from './gpu/wgsl/light.wgsl.js';
import { compileFn, shims, numericLiterals } from './gpu/wgsl/wgslProbe.js';
import { aoTapOcc, aoFactor, aoTapCells, AO_DEFAULTS, AO_MAX } from './horizonAo.js';
const AO_RADIUS_M = 0.8, AO_BIAS = 0.15; // test params (now args, no longer module consts)

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// --- WGSL string rules (D-044: no raw %, round, GLSL mod/fract, no trig) ---
ok('no raw % / round / mod / fract / trig', !/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(|cos\s*\(|tan\s*\(/.test(HORIZON_AO_WGSL));
ok('no ivec/uvec/int( (WGSL-only casts used instead)', !/ivec2|uvec|\bint\(/.test(HORIZON_AO_WGSL));
ok('aoTapCells integer, clamped to [1, maxCells]', (() => {
  for (let i = 0; i < 2000; i++) {
    const rc = aoTapCells(0.8, 50 + i * 0.1, 0.1 + i * 0.01, 4);
    if (!Number.isInteger(rc) || rc < 1 || rc > 4) return false;
  }
  return aoTapCells(0.8, 100, 1000, 4) === 1 && aoTapCells(0.8, 100, 0.01, 4) === 4 && aoTapCells(0.8, 10, 4, 4) === 2;
})());
ok('AO_DEFAULTS (0, 0.8, 0.15, 4)', AO_DEFAULTS.strength === 0 && AO_DEFAULTS.radiusM === 0.8 && AO_DEFAULTS.bias === 0.15 && AO_DEFAULTS.maxCells === 4);

// --- compile aoTapOcc and probe against the JS oracle ---
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const aoTapOccWgsl = compileFn(HORIZON_AO_WGSL, 'aoTapOcc', { ...shims, dot });

let seed = 99173;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
function randUnit() {
  let x, y, z, s;
  do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; s = x * x + y * y + z * z; } while (s < 1e-9 || s > 1);
  const inv = 1 / Math.sqrt(s);
  return [x * inv, y * inv, z * inv];
}

let maxErr = 0, probes = 0;
for (let i = 0; i < 5000; i++) {
  const [nx, ny, nz] = randUnit();
  let vx, vy, vz;
  if (i % 7 === 0) {
    // exactly at the radius (d == R): the >= branch must fire, so this probe also exercises the boundary.
    const [ux, uy, uz] = randUnit();
    vx = ux * AO_RADIUS_M; vy = uy * AO_RADIUS_M; vz = uz * AO_RADIUS_M;
  } else if (i % 7 === 1) {
    // in-plane v (perpendicular to N, nonzero length): c = -AO_BIAS, must give 0.
    let tx = -ny, ty = nx, tz = 0;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-6) { tx = 0; ty = -nz; tz = ny; tl = Math.hypot(tx, ty, tz); }
    const len = rand() * 2;
    vx = (tx / tl) * len; vy = (ty / tl) * len; vz = (tz / tl) * len;
  } else {
    const len = rand() * 2;
    [vx, vy, vz] = randUnit();
    vx *= len; vy *= len; vz *= len;
  }
  const oracle = aoTapOcc(nx, ny, nz, vx, vy, vz, AO_RADIUS_M, AO_BIAS);
  const wgsl = aoTapOccWgsl({ x: nx, y: ny, z: nz }, { x: vx, y: vy, z: vz }, AO_RADIUS_M, AO_BIAS);
  maxErr = Math.max(maxErr, Math.abs(oracle - wgsl));
  probes++;
}
ok(`aoTapOcc probe (${probes} samples) within 1e-6`, maxErr <= 1e-6, `maxErr=${maxErr}`);

// --- shape checks on the JS oracle (both twins share the same expression, so these hold for WGSL too) ---
{
  const N = [0, 0, 1];
  // in-plane v (perpendicular to N): c = 0/d - AO_BIAS < 0 -> 0.
  ok('in-plane v gives 0', aoTapOcc(...N, 0.5, 0.3, 0, AO_RADIUS_M, AO_BIAS) === 0);
  // v behind the surface (opposite N): c < 0 -> 0.
  ok('v behind the surface gives 0', aoTapOcc(...N, 0, 0, -0.5, AO_RADIUS_M, AO_BIAS) === 0);
  // v along N at 0.5 m: well inside AO_RADIUS_M (1.5), c = 1 - AO_BIAS = 0.9 > 0.
  ok('v along N at 0.5 m gives > 0', aoTapOcc(...N, 0, 0, 0.5, AO_RADIUS_M, AO_BIAS) > 0);
  // coincident (d2 < 1e-8) gives 0.
  ok('coincident v gives 0', aoTapOcc(...N, 0, 0, 0, AO_RADIUS_M, AO_BIAS) === 0);
  // exactly at the radius gives 0 (d >= AO_RADIUS_M -> the >= branch, not <).
  ok('v exactly at AO_RADIUS_M gives 0', aoTapOcc(...N, 0, 0, AO_RADIUS_M, AO_RADIUS_M, AO_BIAS) === 0);
}

// --- aoFactor stays in [0.4, 1] (AO_MAX = 0.6) for strength/occSum in [0,1] ---
{
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 500; i++) {
    const strength = rand(), occSum = rand();
    const f = aoFactor(occSum, strength);
    lo = Math.min(lo, f); hi = Math.max(hi, f);
  }
  ok('aoFactor >= 1 - AO_MAX (0.4)', lo >= 1 - AO_MAX - 1e-12, String(lo));
  ok('aoFactor <= 1', hi <= 1 + 1e-12, String(hi));
  ok('AO_MAX is 0.6', AO_MAX === 0.6);
}

// --- whole tap loop incl. rc (S8-B2-20b): WGSL aoRc + 4x aoTapOcc vs JS aoTapCells + aoTapOcc, 2000 random cells ---
{
  const aoRcW = compileFn(HORIZON_AO_WGSL, 'aoRc', { ...shims });
  const f = Math.fround;
  let rcBad = 0, maxE = 0;
  for (let i = 0; i < 2000; i++) {
    const R = f(0.2 + rand() * 2), bias = f(rand() * 0.5), maxCells = 1 + Math.floor(rand() * 6);
    const pd = f(40 + rand() * 120), dist = f(0.3 + rand() * 60);
    const rcW = aoRcW(R, pd, dist, maxCells), rcJ = aoTapCells(R, pd, dist, maxCells);
    // f32 rounding of the product could flip floor at exact .5 boundaries; the JS twin is f64: allow only such ties
    if (rcW !== rcJ && Math.abs(R * pd / dist + 0.5 - Math.round(R * pd / dist + 0.5)) > 1e-4) rcBad++;
    const [nx, ny, nz] = randUnit();
    let sumW = 0, sumJ = 0;
    for (let t = 0; t < 4; t++) {
      const [ux, uy, uz] = randUnit(), len = rand() * R * 1.3;
      sumW += aoTapOccWgsl({ x: nx, y: ny, z: nz }, { x: ux * len, y: uy * len, z: uz * len }, R, bias);
      sumJ += aoTapOcc(nx, ny, nz, ux * len, uy * len, uz * len, R, bias);
    }
    maxE = Math.max(maxE, Math.abs(sumW - sumJ));
  }
  ok('WGSL aoRc == JS aoTapCells over 2000 cells (ties aside)', rcBad === 0, 'bad=' + rcBad);
  ok('4-tap occ sum within 1e-5 over 2000 cells', maxE <= 1e-5, 'maxE=' + maxE);
}
// --- strength 0: WGSL AO branch skipped (uniform guard), JS factor is exactly 1 ---
ok('aoStrength 0 -> factor 1', aoFactor(0.9, 0) === 1);
ok('light pass guards AO on aoStrength > 0', /u.aoStrength > 0.0/.test(LIGHT_WGSL));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
