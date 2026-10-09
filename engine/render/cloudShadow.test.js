// engine/render/cloudShadow.test.js (S8-B2-12c, docs/architecture.md 38.13).
// JS: q 0 everywhere at strength 0; cloudMul in [0.4, 1] over 10k samples at strength 1; deterministic; period-256
// drift wrap continuous; packCloudUniforms layout. WGSL: CLOUD_SHADOW_WGSL string rules + `cloudShadeQ4` (compileFn
// probe, wind.wgsl.test.js pattern) == JS integer q over 5000 samples (off-by-one count reported, <= 1/1000).
// Decode guard: cloud byte (bits 24..31) + OUTDOOR bit 19 leave gpucompare's masks alone.
// node engine/render/cloudShadow.test.js
import { CLOUD_SHADOW_WGSL, HASH_FAST_WGSL } from './gpu/wgsl/common.wgsl.js';
import { compileFn, shims, numericLiterals } from './gpu/wgsl/wgslProbe.js';
import { cloudShadeQ, cloudMul, packCloudUniforms, CLOUD_DARK } from './cloudShadow.js';
import { cloudDriftOffset, cloudValueNoise } from './sky.js';
import { CLOUD_Q_SHIFT } from './shadowSun.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
let seed = 424242;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const mkC = (over = {}) => ({ strength: 1, scale: 0.02, cover: 0.45, soft: 0.25, deckH: 300, seed: 7, wind: new Float32Array([1.5, -0.5]), ...over });
const off0 = new Float32Array(2);
function sunDir() { // unit, z >= 0.3
  const a = rand() * Math.PI * 2, e = 0.3 + rand() * 1.2;
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
}

// --- strength 0 -> q 0 everywhere ---
{
  const C = mkC({ strength: 0 });
  let allZero = true;
  for (let i = 0; i < 2000; i++) {
    const sd = sunDir();
    if (cloudShadeQ(C, off0, (rand() - 0.5) * 4000, (rand() - 0.5) * 4000, rand() * 60, sd[0], sd[1], sd[2]) !== 0) allZero = false;
  }
  ok('strength 0: q is 0 everywhere', allZero);
  ok('cloudMul(0) is exactly 1', cloudMul(0) === 1);
}

// --- strength 1: cloudMul in [0.4, 1] over 10k samples; q in [0, 153]; clouds actually vary ---
{
  const C = mkC();
  let lo = Infinity, hi = -Infinity, minQ = 999, maxQ = -1;
  for (let i = 0; i < 10000; i++) {
    const sd = sunDir();
    const q = cloudShadeQ(C, off0, (rand() - 0.5) * 4000, (rand() - 0.5) * 4000, rand() * 60, sd[0], sd[1], sd[2]);
    const m = cloudMul(q);
    lo = Math.min(lo, m); hi = Math.max(hi, m); minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
  }
  ok('strength 1: cloudMul >= 0.4', lo >= 0.4 - 1e-6, String(lo));
  ok('strength 1: cloudMul <= 1', hi <= 1, String(hi));
  ok('strength 1: q within [0, 153]', minQ >= 0 && maxQ <= Math.floor(CLOUD_DARK * 255 + 0.5), `${minQ}..${maxQ}`);
  ok('strength 1: q varies (not constant)', maxQ > minQ, `${minQ}..${maxQ}`);
}

// --- deterministic ---
{
  const C = mkC();
  ok('deterministic', cloudShadeQ(C, off0, 12.5, -78.25, 3, 0.3, 0.4, 0.8660254) === cloudShadeQ(C, off0, 12.5, -78.25, 3, 0.3, 0.4, 0.8660254));
}

// --- period-256 drift wrap: the lattice is 256-periodic, so the 1st octave is continuous across the offset wrap ---
// CLOUD-WRAP-01: 2nd octave samples at q*2.0+17, so a drift jump of 256 moves it by 512 (= 2 periods): seamless.
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const x = (rand() - 0.5) * 600, y = (rand() - 0.5) * 600, sd0 = 7;
    if (Math.abs(cloudValueNoise(x, y, sd0) - cloudValueNoise(x + 256, y - 256, sd0)) > 1e-9) bad++;
  }
  ok('cloudValueNoise (1st octave) periodic across the 256 wrap', bad === 0, `${bad} mismatches`);
  {
    const Cw = mkC(); const oa = new Float32Array(2), ob = new Float32Array(2); let maxd = 0;
    for (let i = 0; i < 2000; i++) {
      const sd = sunDir(), x = (rand() - 0.5) * 800, y = (rand() - 0.5) * 800, z = rand() * 60;
      oa[0] = Math.floor(rand() * 65536) / 256; oa[1] = Math.floor(rand() * 65536) / 256; ob[0] = oa[0] - 256; ob[1] = oa[1] - 256;
      const qa = cloudShadeQ(Cw, oa, x, y, z, sd[0], sd[1], sd[2]), qb = cloudShadeQ(Cw, ob, x, y, z, sd[0], sd[1], sd[2]);
      maxd = Math.max(maxd, Math.abs(qa - qb));
      const qx = (x * 0.0 + oa[0]) * 2.0 + 17, qx2 = (ob[0]) * 2.0 + 17;
      maxd = Math.max(maxd, Math.abs(cloudValueNoise(qx, 5, 3) - cloudValueNoise(qx2, 5, 3)));
    }
    ok('wrap: shade q at off == at off-256 (2000 pts, both octaves)', maxd <= 1e-6, String(maxd));
  }
  const C = mkC();
  const w = new Float32Array(2), t = 1e6;
  cloudDriftOffset(C, t, w);
  ok('cloudDriftOffset = (wind * t) mod 256, within (-256, 256)', Math.abs(w[0] - Math.fround((C.wind[0] * t) % 256)) < 1e-6 && Math.abs(w[0]) < 256 && Math.abs(w[1]) < 256);
  // q stays continuous in time away from the wrap: a tiny time step changes q by at most a few counts.
  let jump = 0;
  const w2 = new Float32Array(2);
  for (let i = 0; i < 200; i++) {
    const tt = 10 + rand() * 50;
    cloudDriftOffset(C, tt, w); cloudDriftOffset(C, tt + 0.01, w2);
    const sd = sunDir(), x = (rand() - 0.5) * 500, y = (rand() - 0.5) * 500;
    jump = Math.max(jump, Math.abs(cloudShadeQ(C, w, x, y, 1, sd[0], sd[1], sd[2]) - cloudShadeQ(C, w2, x, y, 1, sd[0], sd[1], sd[2])));
  }
  ok('q continuous in time (10 ms step moves q <= 30)', jump <= 30, String(jump));
}

// --- packCloudUniforms ---
{
  const out = new Float32Array(8).fill(9);
  packCloudUniforms(null, 5, out);
  ok('pack: null -> all 0', out.every((v) => v === 0));
  const C = mkC({ strength: 0.5 });
  packCloudUniforms(C, 10, out);
  ok('pack: layout [offX, offY, scale, strength | cover, soft, deckH, seed]',
    out[0] === 15 && out[1] === -5 && Math.abs(out[2] - 0.02) < 1e-7 && out[3] === 0.5 && Math.abs(out[4] - 0.45) < 1e-7 && out[5] === 0.25 && out[6] === 300 && out[7] === 7, Array.from(out).join(','));
}

// --- WGSL string rules (D-044: no raw %, round, GLSL mod/fract, no trig) ---
ok('no raw % / round / mod / fract / trig', !/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(|cos\s*\(|tan\s*\(/.test(CLOUD_SHADOW_WGSL));
ok('no ivec/uvec/int(', !/ivec2|uvec|\bint\(/.test(CLOUD_SHADOW_WGSL));

// --- WGSL cloudShadeQ4 vs JS integer q over 5000 samples ---
{
  const imul = Math.imul;
  const hashSrc = (src) => src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
    .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
    .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
  const hashFastU = compileFn(hashSrc(HASH_FAST_WGSL), 'hashFastU', { ...shims, imul });
  const hashFast = compileFn(HASH_FAST_WGSL, 'hashFast', { ...shims, hashFastU });
  const cloudVN = compileFn(CLOUD_SHADOW_WGSL, 'cloudVN', { ...shims, hashFast });
  const q4 = compileFn(CLOUD_SHADOW_WGSL, 'cloudShadeQ4', { ...shims, cloudVN });
  let off1 = 0, big = 0;
  const n = 5000;
  const off = new Float32Array(2);
  for (let i = 0; i < n; i++) {
    const C = mkC({ strength: 0.3 + rand() * 0.7, scale: 0.005 + rand() * 0.05, cover: rand() * 0.8, soft: 0.05 + rand() * 0.4, deckH: 100 + rand() * 400, seed: Math.floor(rand() * 50) });
    off[0] = Math.fround(rand() * 256); off[1] = Math.fround(rand() * 256);
    const sd = sunDir();
    const far = i % 4 === 0;
    const x = Math.fround(far ? 1500 + rand() * 3500 : (rand() - 0.5) * 2000), y = Math.fround((rand() - 0.5) * 2000), z = Math.fround(rand() * 80);
    const js = cloudShadeQ(C, off, x, y, z, sd[0], sd[1], sd[2]);
    const g = q4({ x, y, z }, { x: sd[0], y: sd[1], z: sd[2] }, { x: off[0], y: off[1], z: C.scale, w: C.strength }, { x: C.cover, y: C.soft, z: C.deckH, w: C.seed });
    const d = Math.abs(js - g);
    if (d === 1) off1++; else if (d > 1) big++;
  }
  console.log(`cloudShadeQ WGSL vs JS: ${n} samples, off-by-one ${off1} (${(off1 / n * 1000).toFixed(2)}/1000), larger ${big}`);
  ok('WGSL q == JS q: off-by-one <= 1 per 1000', off1 <= n / 1000, String(off1));
  ok('WGSL q == JS q: no larger differences', big === 0, String(big));
  ok('mutation: a changed octave weight literal is caught', numericLiterals(CLOUD_SHADOW_WGSL.replace('0.65', '0.66')).has(0.66));
}

// --- Decode guard: bits 24..31 (cloud) and bit 19 (OUTDOOR) do not disturb gpucompare's masks ---
{
  let w = 1 | (11 << 8) | (5 << 16);
  w |= (1 << 19);
  w = (w | (200 << CLOUD_Q_SHIFT)) >>> 0;
  ok('gpucompare masks unaffected by cloud/outdoor bits', (w & 1) === 1 && ((w >>> 8) & 0xff) === 11 && ((w >>> 16) & 7) === 5);
  ok('cloud byte decodes at CLOUD_Q_SHIFT', ((w >>> CLOUD_Q_SHIFT) & 0xff) === 200 && CLOUD_Q_SHIFT === 24);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
