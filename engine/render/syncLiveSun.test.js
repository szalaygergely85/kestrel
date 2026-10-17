// SUN-COL-LIVE Node tests: syncLiveSun makes LightSet.sun.col follow the day/night look (day byte-identical, night = moon hue * live sunI).
import palette from '../../design/palette.js';
import { blendLook } from './look.js';
import { LightSet, syncLiveSun, liveSunScale } from './lighting.js';

let fail = 0;
function check(n, c) { if (!c) { fail++; console.error('FAIL:', n); } else console.log('ok', n); }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const P = { ...palette, rgb: { ...palette.rgb }, hue: { ...palette.hue } }, S = P.daySchedule;
const ls = new LightSet();
const base = palette.hue[palette.lights.sun.color].map((h) => h * palette.lights.sun.intensity);
ls.sun.col.set(base); ls.sun.baseCol = Float32Array.from(ls.sun.col);
const B = Array.from(ls.sun.baseCol);
const same = () => ls.sun.col[0] === B[0] && ls.sun.col[1] === B[1] && ls.sun.col[2] === B[2];

syncLiveSun(ls, P); check('no live look -> base (bit-identical)', same());
for (const h of [8, 10, 12, 13]) { blendLook(P, h, S); syncLiveSun(ls, P); check(`day ${h}h (sunI >= ref) -> base bit-identical`, same()); }
blendLook(P, 16, S); syncLiveSun(ls, P); check('16h (noon->dusk, sunI < ref) dims a little', ls.sun.col[0] < B[0] && ls.sun.col[0] > 0.85 * B[0]);
blendLook(P, 23, S); syncLiveSun(ls, P);
const moon = P.hue[P.liveLook.sun], k = liveSunScale(P), mx = Math.max(...B);
check('night k = 0.25', near(k, 0.25));
check('night col = (base*k + moonHue*max*(1-k)) * k', [0, 1, 2].every((i) => near(ls.sun.col[i], (B[i] * k + moon[i] * mx * (1 - k)) * k)));
check('night is bluish (b > r) and dim (max <= 0.25)', ls.sun.col[2] > ls.sun.col[0] && Math.max(...ls.sun.col) <= 0.25 + 1e-6);
blendLook(P, 20, S); syncLiveSun(ls, P); const dusk = Math.max(...ls.sun.col);
check('dusk between night and day', dusk > 0.25 && dusk < mx);
delete P.liveLook; syncLiveSun(ls, P); check('live look removed -> base restored', same());
// lazily captures the base on a hand-built set
const ls2 = new LightSet(); ls2.sun.col.set([1, 1, 1]); blendLook(P, 23, S); syncLiveSun(ls2, P);
check('lazy base capture', ls2.sun.baseCol && ls2.sun.baseCol[0] === 1 && ls2.sun.col[0] < 0.3);
syncLiveSun(null, P); check('null lights is a no-op', true);

console.log(`\n[syncLiveSun.test.js] ${fail ? fail + ' failed' : 'all passed'}`);
if (fail) process.exit(1);
