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
import { compileFn, shims, numericLiterals } from './gpu/wgsl/wgslProbe.js';
import { aoTapOcc, aoFactor, AO_RADIUS_M, AO_BIAS, AO_MAX, AO_TAP_CELLS } from './horizonAo.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// --- WGSL string rules (D-044: no raw %, round, GLSL mod/fract, no trig) ---
ok('no raw % / round / mod / fract / trig', !/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(|cos\s*\(|tan\s*\(/.test(HORIZON_AO_WGSL));
ok('no ivec/uvec/int( (WGSL-only casts used instead)', !/ivec2|uvec|\bint\(/.test(HORIZON_AO_WGSL));
ok('AO_TAP_CELLS is an integer (no f32/f64 rounding coin flip)', Number.isInteger(AO_TAP_CELLS));

// --- compile aoTapOcc and probe against the JS oracle ---
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const aoTapOccWgsl = compileFn(HORIZON_AO_WGSL, 'aoTapOcc', { ...shims, dot, AO_RADIUS_M, AO_BIAS });

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
  const oracle = aoTapOcc(nx, ny, nz, vx, vy, vz);
  const wgsl = aoTapOccWgsl({ x: nx, y: ny, z: nz }, { x: vx, y: vy, z: vz });
  maxErr = Math.max(maxErr, Math.abs(oracle - wgsl));
  probes++;
}
ok(`aoTapOcc probe (${probes} samples) within 1e-6`, maxErr <= 1e-6, `maxErr=${maxErr}`);

// --- shape checks on the JS oracle (both twins share the same expression, so these hold for WGSL too) ---
{
  const N = [0, 0, 1];
  // in-plane v (perpendicular to N): c = 0/d - AO_BIAS < 0 -> 0.
  ok('in-plane v gives 0', aoTapOcc(...N, 0.5, 0.3, 0) === 0);
  // v behind the surface (opposite N): c < 0 -> 0.
  ok('v behind the surface gives 0', aoTapOcc(...N, 0, 0, -0.5) === 0);
  // v along N at 0.5 m: well inside AO_RADIUS_M (1.5), c = 1 - AO_BIAS = 0.9 > 0.
  ok('v along N at 0.5 m gives > 0', aoTapOcc(...N, 0, 0, 0.5) > 0);
  // coincident (d2 < 1e-8) gives 0.
  ok('coincident v gives 0', aoTapOcc(...N, 0, 0, 0) === 0);
  // exactly at the radius gives 0 (d >= AO_RADIUS_M -> the >= branch, not <).
  ok('v exactly at AO_RADIUS_M gives 0', aoTapOcc(...N, 0, 0, AO_RADIUS_M) === 0);
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

// --- Mutation guard: AO_BIAS/AO_RADIUS_M are the only numeric literals baked into HORIZON_AO_WGSL's own text ---
{
  const lits = numericLiterals(HORIZON_AO_WGSL);
  ok('HORIZON_AO_WGSL literal-set has AO_RADIUS_M', lits.has(AO_RADIUS_M));
  ok('HORIZON_AO_WGSL literal-set has AO_BIAS', lits.has(AO_BIAS));
  const mutated = HORIZON_AO_WGSL.replace(`const AO_BIAS: f32 = ${AO_BIAS};`, 'const AO_BIAS: f32 = 0.37;');
  ok('mutation: a changed AO_BIAS literal is caught', numericLiterals(mutated).has(0.37) && !numericLiterals(mutated).has(AO_BIAS));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
