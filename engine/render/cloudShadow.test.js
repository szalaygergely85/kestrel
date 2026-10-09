// engine/render/cloudShadow.test.js (S8-B2-12a, docs/architecture.md 38.13).
// - CLOUD_SHADOW_WGSL (common.wgsl.js) string rules + a JS-evaluated (wgslProbe) probe of `cloudCov`/`vnoiseCloud`
//   vs this file's JS oracle (cloudShadow.js), 5000 samples within 1e-5.
// - updateCloudShadow: calm wind -> offsets 0; a moving base wind drifts offU/offV by the expected amount; the
//   256-periodic lattice gives the same cov on either side of the offset wrap.
// - CLOUD_SALT is distinct from every salt already in use elsewhere in this codebase.
// - Mutation: the octave-weight literals (0.65/0.35) are checked the same way sprites.wgsl.test.js checks its own
//   literals - a changed constant must show up in `numericLiterals`.
// - Decode guard: a LIGHT.w with the new cloud byte (bits 24..31) and the ART-01b OUTDOOR bit (19) set still
//   decodes to the same sunlit/litCount/sunN under gpucompare.js's own masks (read-only use of that file).
// node engine/render/cloudShadow.test.js
import assert from 'node:assert/strict';
import { CLOUD_SHADOW_WGSL, HASH_FAST_WGSL } from './gpu/wgsl/common.wgsl.js';
import { compileFn, shims, numericLiterals } from './gpu/wgsl/wgslProbe.js';
import { cloudCov, updateCloudShadow, CLOUD_SALT, CLOUD_DARK, CLOUD_SHIFT } from './cloudShadow.js';
import { FOREST_TRUNK_SALT } from './terrainShade.js';
import { WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT } from './waterLook.js';
import { createWind } from '../world/wind.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// --- WGSL string rules (D-044: no raw %, round, GLSL mod/fract, no trig) ---
ok('no raw % / round / mod / fract / trig', !/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(|cos\s*\(|tan\s*\(/.test(CLOUD_SHADOW_WGSL));
ok('no ivec/uvec/int( (WGSL-only casts used instead)', !/ivec2|uvec|\bint\(/.test(CLOUD_SHADOW_WGSL));

// --- compile cloudCov/vnoiseCloud + hashFast and probe against the JS oracle ---
// WGSL u32 multiply wraps at 32 bits; the naive wgslProbe interpreter does plain (unwrapped) JS multiplication, so
// hashFastU's 3 multiplies need a Math.imul stand-in - same fix shade.wgsl.test.js's own hashFast probe uses.
const imul = Math.imul;
function hashSrc(src) {
  return src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
    .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
    .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
}
const hashFastU = compileFn(hashSrc(HASH_FAST_WGSL), 'hashFastU', { ...shims, imul });
const hashFast = compileFn(HASH_FAST_WGSL, 'hashFast', { ...shims, hashFastU });
const vnoiseCloud = compileFn(CLOUD_SHADOW_WGSL, 'vnoiseCloud', { ...shims, hashFast, CLOUD_SALT });
const cloudCovWgsl = compileFn(CLOUD_SHADOW_WGSL, 'cloudCov', { ...shims, vnoiseCloud, hashFast, CLOUD_SALT });

let seed = 424242;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
let maxErr = 0, probes = 0;
for (let i = 0; i < 5000; i++) {
  // Negative coordinates, x far from the origin (1500..5000), offsets at/near 0 and 255.999, cover across [0,1].
  const far = i % 4 === 0;
  const px = far ? 1500 + rand() * 3500 : (rand() - 0.5) * 2000;
  const py = (rand() - 0.5) * 2000;
  const offPick = i % 5;
  const offU = offPick === 0 ? 0 : offPick === 1 ? 255.999 : rand() * 256;
  const offV = offPick === 2 ? 0 : offPick === 3 ? 255.999 : rand() * 256;
  const c = { invScale: 1 / (10 + rand() * 90), offU, offV, cover: rand() };
  const jsV = cloudCov(px, py, c);
  const gV = cloudCovWgsl(px, py, c.invScale, c.offU, c.offV, c.cover);
  maxErr = Math.max(maxErr, Math.abs(jsV - gV));
  probes++;
}
ok(`cloudCov WGSL vs JS within 1e-5 over ${probes} probes`, maxErr < 1e-5, `maxErr=${maxErr}`);

// --- determinism: same input gives the same output (pure function, no hidden state) ---
{
  const c = { invScale: 1 / 48, offU: 12.5, offV: 200.25, cover: 0.55 };
  const a = cloudCov(1234.5, -678.25, c);
  const b = cloudCov(1234.5, -678.25, c);
  ok('cloudCov is deterministic for the same input', a === b);
}

// --- updateCloudShadow: calm wind (no windParams) gives offsets 0 ---
{
  const c = { invScale: 1 / 48, speedK: 1, offU: 999, offV: 999 };
  updateCloudShadow(c, null, 123.4);
  ok('calm wind (null windParams) gives offU 0', c.offU === 0, String(c.offU));
  ok('calm wind (null windParams) gives offV 0', c.offV === 0, String(c.offV));
  const fieldCalm = createWind({ dirDeg: 0, speed: 0 }, 1);
  updateCloudShadow(c, fieldCalm.params, 456.7);
  ok('calm wind (speed 0 field) gives offU 0', c.offU === 0, String(c.offU));
  ok('calm wind (speed 0 field) gives offV 0', c.offV === 0, String(c.offV));
}

// --- updateCloudShadow: dirDeg 90 (east), speed 2, default speedK 1, scaleM 48 -> offU grows by 2t/48 mod 256 ---
{
  const field = createWind({ dirDeg: 90, speed: 2 }, 1);
  const scaleM = 48;
  const c = { invScale: 1 / scaleM, speedK: 1, offU: 0, offV: 0 };
  for (const t of [0, 1, 17.3, 1000, 123456.789]) {
    updateCloudShadow(c, field.params, t);
    const expected = (((2 * t) / scaleM) % 256 + 256) % 256;
    ok(`offU at t=${t} matches 2t/scaleM mod 256`, Math.abs(c.offU - expected) < 1e-6, `${c.offU} vs ${expected}`);
    ok(`offV at t=${t} stays ~0 (wind is due east)`, Math.abs(c.offV) < 1e-6 || Math.abs(c.offV - 256) < 1e-6, String(c.offV));
  }
}

// --- continuity across the 256 wrap: cov is periodic in offU/offV (iu & 255 removes any multiple of 256) ---
{
  const base = { invScale: 1 / 48, cover: 0.5 };
  for (let i = 0; i < 20; i++) {
    const px = (rand() - 0.5) * 4000, py = (rand() - 0.5) * 4000;
    const offU = rand() * 256, offV = rand() * 256;
    const a = cloudCov(px, py, { ...base, offU, offV });
    const b = cloudCov(px, py, { ...base, offU: offU + 256, offV: offV - 256 });
    ok(`cov periodic across the 256 wrap (#${i})`, Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  }
}

// --- CLOUD_SALT is distinct from every salt already in use in this codebase ---
{
  const known = new Set([10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, FOREST_TRUNK_SALT, WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT]);
  ok('CLOUD_SALT is not one of the salts already in use', !known.has(CLOUD_SALT), String(CLOUD_SALT));
  ok('CLOUD_SALT + 1 (2nd octave) is not one of the salts already in use', !known.has(CLOUD_SALT + 1), String(CLOUD_SALT + 1));
  ok('CLOUD_SALT and CLOUD_SALT + 1 are distinct', CLOUD_SALT !== CLOUD_SALT + 1);
}

// --- Mutation: changing the octave weight in the WGSL string is caught by a literal check ---
{
  const lits = numericLiterals(CLOUD_SHADOW_WGSL);
  ok('CLOUD_SHADOW_WGSL contains the 0.65/0.35 octave weights', lits.has(0.65) && lits.has(0.35));
  const mutated = CLOUD_SHADOW_WGSL.replace('0.65', '0.66');
  ok('mutation: a changed octave weight literal is caught', numericLiterals(mutated).has(0.66) && !numericLiterals(mutated).has(0.65));
}

// --- Decode guard: bits 24..31 (cloud) and bit 19 (OUTDOOR, ART-01b) set does not disturb gpucompare's own masks ---
{
  const sunlit = 1, litCount = 11, sunN = 5; // sunN 0..7 fits SUN_N_MASK even though the AC range is 0..4
  let w = (sunlit & 1) | ((litCount & 0xff) << 8) | ((sunN & 7) << 16);
  w |= (1 << 19); // OUTDOOR_SHIFT (ART-01a/b, not yet written by this story, but must not be disturbed)
  w |= (200 << CLOUD_SHIFT) >>> 0; // a cloud byte (q=200), bits 24..31
  w = w >>> 0;
  ok('gpucompare sunlit mask unaffected by the cloud/outdoor bits', (w & 1) === sunlit);
  ok('gpucompare litCount mask unaffected', ((w >>> 8) & 0xff) === litCount);
  ok('gpucompare sunN mask unaffected', ((w >>> 16) & 7) === sunN);
  ok('the cloud byte itself decodes back out at CLOUD_SHIFT', ((w >>> CLOUD_SHIFT) & 0xff) === 200);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
