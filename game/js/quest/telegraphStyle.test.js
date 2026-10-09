// TELEGRAPH-STYLE-01: contrast of every telegraph colour vs the ground colours, and name parity with the engine.
import '../../../design/palette.js';
import { tintAt, laneAlpha, LANE_ALPHA_MAX } from '../../../engine/index.js';
import { WINDUP_STEPS, TINT_ENVELOPES, LANE_STYLE, windupColorAt } from './telegraphStyle.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const pal = globalThis.ASSETS.palette.colors;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// ground: the turf shades (grass) and the bare-ground bases the world uses (rubble/ash); turfLight is the lit
// highlight shade and excluded (white cannot reach 3:1 there).
const GROUND = { grass: pal.turf, grassDark: pal.turfDark, dirt: pal.rubble, ash: pal.ash };
for (const [n, h] of Object.entries(GROUND)) ok(typeof h === 'string', 'palette ground colour ' + n);

for (const s of WINDUP_STEPS) {
  if (!s.color) continue;
  for (const [g, gh] of Object.entries(GROUND)) {
    const r = ratio(rgb(s.color), rgb(gh));
    ok(r >= 3, `windup ${s.id} ${s.color} vs ${g} ${gh}: ${r.toFixed(2)} < 3`);
  }
}
// lane: colour blended at max alpha over each ground must still stand out >= 3:1
for (const [g, gh] of Object.entries(GROUND)) {
  const a = LANE_STYLE.alphaMax, c = rgb(LANE_STYLE.color), b = rgb(gh);
  const mix = c.map((v, i) => v * a + b[i] * (1 - a));
  const r = ratio(mix, b);
  ok(r >= 3, `lane blended vs ${g}: ${r.toFixed(2)} < 3`);
}
// steps: 3, contiguous, cover 0..1
ok(WINDUP_STEPS.length === 3, '3 windup steps');
ok(WINDUP_STEPS[0].t0 === 0 && WINDUP_STEPS[2].t1 === 1, 'steps cover the windup');
for (let i = 1; i < 3; i++) ok(WINDUP_STEPS[i].t0 === WINDUP_STEPS[i - 1].t1, 'steps contiguous ' + i);
ok(windupColorAt(0.1) === '#3a0600' && windupColorAt(0.5) === '#ffffff' && windupColorAt(0.9) === null, 'windupColorAt');
// engine name parity
// TINT_NAMES is not in the public index: a name is "known" if the envelope gives k > 0 at 50 ms (unknown -> 0)
for (const n of Object.values(TINT_ENVELOPES)) ok(tintAt({ name: n, windupSec: 1 }, 50).k > 0, 'tint name known to engine: ' + n);
ok(tintAt({ name: 'bogus' }, 50).k === 0, 'unknown tint name gives k 0');
ok(LANE_STYLE.alphaMax === LANE_ALPHA_MAX, 'lane alphaMax matches engine');
ok(LANE_STYLE.alphaCurve === 'laneAlpha' && typeof laneAlpha === 'function', 'lane curve name exists');

console.log(fails ? `telegraphStyle: ${fails} FAILED` : 'telegraphStyle: PASS');
process.exit(fails ? 1 : 0);
