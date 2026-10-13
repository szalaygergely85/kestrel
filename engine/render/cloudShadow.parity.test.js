// Parity: cloudShadow.js scratch noise path == sky.js cloudValueNoise (bit-exact), cloudShadeQ == plain reference.
import { cloudValueNoise } from './sky.js';
import { cloudShadeQ, cloudNoiseScratch, CLOUD_DARK } from './cloudShadow.js';

let s = 12345;
const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = () => { const m = rnd(); return (rnd() - 0.5) * (m < 0.3 ? 20 : m < 0.6 ? 1000 : m < 0.8 ? 1e5 : 600); };
let bad = 0;
for (let i = 0; i < 5000; i++) {
  const x = pick(), y = pick(), seed = (rnd() * 1000) | 0;
  if (!Object.is(cloudNoiseScratch(x, y, seed), cloudValueNoise(x, y, seed))) bad++;
  // mod-256 wrap: off vs off-256 shifts the lattice by exactly 256 cells
  if (!Object.is(cloudNoiseScratch(x, y, seed), cloudNoiseScratch(x - 256, y - 256, seed)) &&
      !Object.is(cloudValueNoise(x, y, seed), cloudValueNoise(x - 256, y - 256, seed))) bad++;
}
const smooth = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const C = { deckH: 60, scale: 0.05, cover: 0.5, soft: 0.2, strength: 0.6, seed: 7 };
const off = new Float32Array(2);
for (let i = 0; i < 5000; i++) {
  off[0] = rnd() * 256; off[1] = rnd() * 256;
  const x = pick(), y = pick(), z = rnd() * 40;
  let dx = rnd() - 0.5, dy = rnd() - 0.5, dz = 0.2 + rnd(); const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const t = (C.deckH - z) / Math.max(dz, 0.2);
  const qx = (x + dx * t) * C.scale + off[0], qy = (y + dy * t) * C.scale + off[1];
  const n = cloudValueNoise(qx, qy, C.seed) * 0.65 + cloudValueNoise(qx * 2.0 + 17.0, qy * 2.0 + 17.0, C.seed) * 0.35;
  const ref = Math.floor(C.strength * CLOUD_DARK * smooth(C.cover, C.cover + C.soft, n) * 255 + 0.5);
  if (cloudShadeQ(C, off, x, y, z, dx, dy, dz) !== ref) bad++;
}
console.log(`${bad ? 'FAIL' : 'PASS'}: cloudShadow parity (noise scratch bit-exact, wrap, cloudShadeQ vs reference): ${bad} mismatches`);
process.exit(bad ? 1 : 0);
