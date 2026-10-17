// NIGHT-SKY-01: JS twin of the night sky (stars + moon) - day untouched, stable hash pattern, moon disc, bounded twinkle, WGSL consts.
import assert from 'node:assert/strict';
import { SKY_NIGHT, applySkyNight, SKY_NIGHT_WGSL, nightWeight } from './skyNight.js';
import { dirFromAzEl } from '../core/transform.js';
import { compileVecFn } from './gpu/wgsl/wgslVec.js';
import { SKY_GLOW_WGSL } from './skyGlow.js';

const d = [0, 0, 0], moonAz = 140, moonEl = 35, sm = dirFromAzEl(moonAz, moonEl, [0, 0, 0]);
function cell(az, el, sunI, t, bgIn = [12, 16, 40]) {
  const bg = [...bgIn], fg = [...bgIn]; dirFromAzEl(az, el, d);
  const g = applySkyNight(bg, fg, d[0], d[1], d[2], el, sm[0], sm[1], sm[2], sunI, t);
  return { g, bg, fg };
}
// day: byte-identical (sun above horizon + 1 h: sunI >= 0.8, bright sky), also at the moon direction
for (const [az, el] of [[10, 20], [140, 35], [200, 60]]) {
  const r = cell(az, el, 0.8, 3, [90, 140, 200]);
  assert.equal(r.g, 0); assert.deepEqual(r.bg, [90, 140, 200]); assert.deepEqual(r.fg, [90, 140, 200]);
}
assert.equal(nightWeight(0.25, 10), 1); assert.equal(nightWeight(0.8, 10), 0);
// night: scan the sky at 0.2 deg steps; count stars at two times and two "camera turns" (the pattern depends on direction only)
function scan(t) { const m = new Map(); for (let az = 0; az < 360; az += 0.2) for (let el = 1; el < 85; el += 0.2) { const r = cell(az, el, 0.25, t); if (r.g) m.set(az + ',' + el, r.g); } return m; }
const a = scan(0), b = scan(0), c = scan(7.3);
assert.deepEqual([...a], [...b], 'deterministic');
assert.ok(a.size > 1500 && a.size < 40000, 'modest star count ' + a.size);
assert.ok(c.size > 700 && c.size < 40000, 'twinkle keeps the count bounded ' + c.size);
let changed = 0; for (const k of a.keys()) if (!c.has(k)) changed++;
assert.ok(changed > 0 && changed < a.size, 'twinkle changes membership over time (' + changed + '/' + a.size + ')');
const glyphs = new Set(a.values()); assert.ok(glyphs.has(14) && glyphs.has(11) && glyphs.has(10) && glyphs.size === 3, 'glyphs . + *');
// zenith is denser than the low sky; nothing below the horizon
let lo = 0, hi = 0; for (const k of a.keys()) { const el = +k.split(',')[1]; if (el < 20) lo++; else if (el > 60) hi++; }
assert.ok(hi / (25 * 5) > lo / (19 * 5) * 0.8, 'zenith not sparser');
assert.equal(cell(30, -5, 0.25, 0).g, 0);
// no swimming: the same direction gives the same star regardless of which "screen cell" it lands in (pure function of the direction)
const probe = [...a.keys()][0].split(',').map(Number); assert.equal(cell(probe[0], probe[1], 0.25, 0).g, a.get([...a.keys()][0]));
// moon disc: bright inside ~3.2 deg of the moon direction, none at 6 deg
const inM = cell(moonAz, moonEl, 0.25, 0), outM = cell(moonAz + 6, moonEl, 0.25, 0);
assert.deepEqual(inM.bg.map(Math.round), SKY_NIGHT.color); assert.equal(inM.g, 0);
assert.deepEqual(outM.bg, [12, 16, 40]);
// dusk fade: bright sky luma kills stars
let dusk = 0; for (let az = 0; az < 360; az += 0.2) for (let el = 1; el < 85; el += 0.5) if (cell(az, el, 0.25, 0, [200, 160, 120]).g) dusk++;
assert.equal(dusk, 0);

// WGSL skyNight (compileVecFn probe) vs applySkyNight: >= 3000 dirs x sunI {0.25, 0.5, 0.8} x 2 times; glyph exact, colours within 1e-6
// (both f64 here; f32/GPU parity is gpucompare's job). Covers nightHash == h01 (the star lattice) and the moon-mirror branch (sun z < 0).
{
  const skyGlowSm = compileVecFn(SKY_GLOW_WGSL, 'skyGlowSm');
  const nightHash = compileVecFn(SKY_NIGHT_WGSL, 'nightHash');
  const skyNightW = compileVecFn(SKY_NIGHT_WGSL, 'skyNight', { skyGlowSm, nightHash });
  let seed = 99; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sunDirs = [sm, dirFromAzEl(30, -20, [0, 0, 0]).slice(), dirFromAzEl(250, 55, [0, 0, 0]).slice()];
  let n = 0, stars = 0, moons = 0, worst = 0;
  for (let i = 0; i < 3500; i++) {
    const az = rnd() * 360, el = i % 7 === 0 ? -10 + rnd() * 10 : rnd() * 88;
    const dir = dirFromAzEl(az, el, [0, 0, 0]);
    const sdv = i % 11 === 0 ? sunDirs[1] : i % 13 === 0 ? sunDirs[2] : sunDirs[0];
    const near = i % 5 === 0; // aim some samples at the moon disc
    const dd = near ? dirFromAzEl(moonAz + (rnd() - 0.5) * 8, moonEl + (rnd() - 0.5) * 8, [0, 0, 0]) : dir;
    const bgIn = [8 + rnd() * 30, 10 + rnd() * 30, 30 + rnd() * 40];
    for (const sunI of [0.25, 0.5, 0.8]) for (const t of [0, 7.3]) {
      const bg = [...bgIn], fg = [...bgIn];
      const g = applySkyNight(bg, fg, dd[0], dd[1], dd[2], near ? moonEl : el, sdv[0], sdv[1], sdv[2], sunI, t);
      const o = skyNightW({ x: bgIn[0], y: bgIn[1], z: bgIn[2] }, { x: dd[0], y: dd[1], z: dd[2] }, near ? moonEl : el, { x: sdv[0], y: sdv[1], z: sdv[2] }, sunI, t);
      assert.equal(o.g, g, 'glyph ' + [az, el, sunI, t]);
      for (const [k, i2] of [['x', 0], ['y', 1], ['z', 2]]) {
        const d = Math.max(Math.abs(o.bg[k] - bg[i2]), Math.abs(o.fg[k] - fg[i2])); worst = Math.max(worst, d);
        assert.ok(d < 1e-6, 'colour ' + [az, el, sunI, t, d]);
      }
      n++; if (g) stars++; if (bg[2] !== bgIn[2] && !g) moons++;
    }
  }
  assert.ok(stars > 200 && moons > 20, 'probe covers stars ' + stars + ' and moon ' + moons);
  console.log('skyNight WGSL probe OK', n, 'samples, stars', stars, 'moon', moons, 'worst', worst);
}
// WGSL consts
for (const lit of ['0.3', '0.7', '2.2', '0.03', '3.2', '0.0004', '0x27d4eb2du', 'vec3f(159.0, 180.0, 224.0)']) assert.ok(SKY_NIGHT_WGSL.includes(lit), 'WGSL ' + lit);
console.log('skyNight OK, stars', a.size, 'twinkled', changed);
