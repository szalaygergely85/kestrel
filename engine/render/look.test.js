// ART-01a Node tests for `resolveLook`/`validateLook` (docs/architecture.md
// 37.18 item 2). Inline fixture palette - the designer data slice is a separate
// PC-A step, so the engine step tests with a hand-built palette.
import { resolveLook, validateLook } from './look.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ---- fixture palette (same shape as design/palette.js) ---------------------
const COLORS = {
  sun: [255, 242, 208], ambient: [42, 53, 80], cloud: [255, 248, 234], fog: [38, 47, 69],
  skyHorizon: [196, 220, 239], skyMid: [111, 163, 220], skyTop: [47, 111, 200],
  hemiSky: [138, 184, 230], hemiGround: [134, 168, 82], shadowPurple: [74, 48, 72],
  hazeNear: [239, 230, 198],
  cloudLit: [255, 248, 234], cloudShade: [182, 205, 226],
};
function makePalette() {
  const rgb = {}, hue = {};
  for (const k of Object.keys(COLORS)) {
    rgb[k] = COLORS[k].slice();
    const mx = Math.max(COLORS[k][0], COLORS[k][1], COLORS[k][2]) || 1;
    hue[k] = [COLORS[k][0] / mx, COLORS[k][1] / mx, COLORS[k][2] / mx];
  }
  return { rgb, hue, ramps: { sky: " .'-~=+*", bad: 'a\u0007b' }, defaultTime: 'morning', timeOfDay: {
    morning: { ambient: 'ambient', ambientI: 0.12, sun: 'sun', sunI: 1.0, sunElev: 60,
      sky: [{ t: 0, c: 'skyHorizon' }, { t: 0.35, c: 'skyMid' }, { t: 1, c: 'skyTop' }], cloud: 'cloud', fog: 'fog' },
    afternoon: { ambient: 'hemiSky', ambientI: 0.40, sun: 'sun', sunI: 1.15, sunElev: 42,
      sky: [{ t: 0, c: 'skyHorizon' }, { t: 0.45, c: 'skyMid' }, { t: 1, c: 'skyTop' }], cloud: 'cloud', fog: 'fog',
      hemi: { sky: 'hemiSky', skyI: 0.40, ground: 'hemiGround', groundI: 0.12, shadowTint: 'shadowPurple', shadowK: 0.35, sunFromLook: true, terrainTintK: 0.6 },
      haze: { near: 'hazeNear', far: 'skyHorizon', start: 15, full: 700, curve: 0.65, max: 0.78, bgK: 0.9, blank: 1.01, thin0: 0.45, thinK: 1.0, edgeMax: 0.5 },
      clouds: { lit: 'cloudLit', shade: 'cloudShade', ramp: 'sky', scale: 1.6, bias: 0.12, cover: 0.5, puffK: 3.0, wispCover: 0.58, wispK: 3.0, wind: [0.006, 0.0015], litK: 2.2, litDy: 0.06, bodyK: 0.9, seed: 3 } },
  } };
}

const P = makePalette();

// ---- resolve: absent blocks are null, present blocks are resolved -----------
{
  const m = resolveLook(P); // default 'morning'
  check('default key = P.defaultTime', m && m.key === 'morning');
  check('morning: hemi/haze/clouds are null (block absent)', m && m.hemi === null && m.haze === null && m.clouds === null);
  check('morning: sun = hue(sun) * sunI', m && near(m.sun[0], P.hue.sun[0] * 1.0) && near(m.sun[1], P.hue.sun[1] * 1.0));
}
{
  const a = resolveLook(P, 'afternoon');
  check('afternoon: hemi present', a && a.hemi !== null && a.haze !== null && a.clouds !== null);
  // hue x I products -> Float32Array energy
  check('hemi.sky = hue(sky) * skyI', a && near(a.hemi.sky[0], P.hue.hemiSky[0] * 0.40) && near(a.hemi.sky[1], P.hue.hemiSky[1] * 0.40) && near(a.hemi.sky[2], P.hue.hemiSky[2] * 0.40));
  check('hemi.ground = hue(ground) * groundI', a && near(a.hemi.ground[0], P.hue.hemiGround[0] * 0.12) && near(a.hemi.ground[2], P.hue.hemiGround[2] * 0.12));
  check('hemi.tint = rgb(shadowTint)/max = hue[shadowPurple]', a && near(a.hemi.tint[1], P.hue.shadowPurple[1]) && near(a.hemi.tint[2], P.hue.shadowPurple[2]));
  check('hemi.tintK = shadowK', a && a.hemi.tintK === 0.35);
  check('hemi.sunFromLook + terrainTintK copied', a && a.hemi.sunFromLook === true && a.hemi.terrainTintK === 0.6);
  check('sun = hue(sun) * sunI (1.15)', a && near(a.sun[0], P.hue.sun[0] * 1.15) && near(a.sun[2], P.hue.sun[2] * 1.15));
  // haze colours stay 0..255 bytes; scalars copied
  check('haze.near/far are 0..255 bytes', a && a.haze.near[0] === COLORS.hazeNear[0] && a.haze.far[2] === COLORS.skyHorizon[2]);
  check('haze scalars copied', a && a.haze.max === 0.78 && a.haze.edgeMax === 0.5 && a.haze.blank === 1.01);
  // clouds: lit/shade 0..255, ramp string resolved, wind as Float32Array
  check('clouds.lit/shade are 0..255 bytes', a && a.clouds.lit[0] === COLORS.cloudLit[0] && a.clouds.shade[1] === COLORS.cloudShade[1]);
  check('clouds.ramp resolved to the glyph string', a && a.clouds.ramp === P.ramps.sky);
  check('clouds.wind is [x, y]', a && a.clouds.wind instanceof Float32Array && near(a.clouds.wind[0], 0.006) && near(a.clouds.wind[1], 0.0015));
}
// ---- cache identity per (P, key) -------------------------------------------
{
  const a = resolveLook(P, 'afternoon'), b = resolveLook(P, 'afternoon'), c = resolveLook(P, 'morning');
  check('cache: same (P, key) returns the SAME object', a === b);
  check('cache: different key returns a different object', a !== c);
  check('cache: resolved sub-objects stable too', a.hemi === b.hemi);
}
// ---- shadowTint null -> tint identity, no error ----------------------------
{
  const P2 = makePalette();
  P2.timeOfDay.afternoon = { ...P2.timeOfDay.afternoon, hemi: { ...P2.timeOfDay.afternoon.hemi, shadowTint: null, shadowK: 0 } };
  const a = resolveLook(P2, 'afternoon');
  check('shadowTint null -> tint [1,1,1]', a.hemi.tint[0] === 1 && a.hemi.tint[1] === 1 && a.hemi.tint[2] === 1);
  check('shadowTint null is not an error', validateLook(P2, 'afternoon').length === 0);
}

// ---- validation: every rule ------------------------------------------------
// helper: build a palette whose single record is `afternoon`, then mutate one field.
function withLook(mutate) {
  const P2 = makePalette();
  const rec = JSON.parse(JSON.stringify(P2.timeOfDay.afternoon));
  mutate(rec);
  P2.timeOfDay = { afternoon: rec };
  return P2;
}
function errs(mutate) { return validateLook(withLook(mutate), 'afternoon', () => {}); }

{
  check('valid afternoon -> no errors', validateLook(P, 'afternoon').length === 0);
  check('missing record -> error', validateLook(makePalette(), 'nope').length > 0);
  check('base sun colour missing -> error', errs((r) => { r.sun = 'nope'; }).length > 0);
  check('sky stop colour missing -> error', errs((r) => { r.sky[1].c = 'nope'; }).length > 0);
  check('hemi.sky colour missing -> error', errs((r) => { r.hemi.sky = 'nope'; }).length > 0);
  check('hemi.ground colour missing -> error', errs((r) => { r.hemi.ground = 'nope'; }).length > 0);
  check('hemi.shadowTint colour missing -> error', errs((r) => { r.hemi.shadowTint = 'nope'; }).length > 0);
  check('hemi.skyI > 2 -> error', errs((r) => { r.hemi.skyI = 2.1; }).length > 0);
  check('hemi.skyI < 0 -> error', errs((r) => { r.hemi.skyI = -0.1; }).length > 0);
  check('hemi.groundI out of [0,2] -> error', errs((r) => { r.hemi.groundI = 3; }).length > 0);
  check('hemi.shadowK out of [0,1] -> error', errs((r) => { r.hemi.shadowK = 1.5; }).length > 0);
  check('haze.near colour missing -> error', errs((r) => { r.haze.near = 'nope'; }).length > 0);
  check('haze.far colour missing -> error', errs((r) => { r.haze.far = 'nope'; }).length > 0);
  check('haze start >= full -> error', errs((r) => { r.haze.start = 700; r.haze.full = 700; }).length > 0);
  check('haze start < 0 -> error', errs((r) => { r.haze.start = -1; }).length > 0);
  check('haze curve <= 0 -> error', errs((r) => { r.haze.curve = 0; }).length > 0);
  check('haze max >= 1 -> error', errs((r) => { r.haze.max = 1; }).length > 0);
  check('haze max <= 0 -> error', errs((r) => { r.haze.max = 0; }).length > 0);
  check('haze bgK out of [0,1] -> error', errs((r) => { r.haze.bgK = 1.2; }).length > 0);
  check('haze blank out of (0,2] -> error', errs((r) => { r.haze.blank = 3; }).length > 0);
  check('haze blank = 0 -> error', errs((r) => { r.haze.blank = 0; }).length > 0);
  check('haze thin0 out of [0,1] -> error', errs((r) => { r.haze.thin0 = 1.5; }).length > 0);
  check('haze thinK < 0 -> error', errs((r) => { r.haze.thinK = -0.1; }).length > 0);
  check('haze edgeMax out of (0,1] -> error', errs((r) => { r.haze.edgeMax = 0; }).length > 0);
  check('haze edgeMax > 1 -> error', errs((r) => { r.haze.edgeMax = 1.5; }).length > 0);
  check('clouds.lit colour missing -> error', errs((r) => { r.clouds.lit = 'nope'; }).length > 0);
  check('clouds.shade colour missing -> error', errs((r) => { r.clouds.shade = 'nope'; }).length > 0);
  // S8-B2-12c (38.13): clouds.shadow {strength, scale, cover, soft, deckH} validation
  const SH = { strength: 0.5, scale: 0.02, cover: 0.4, soft: 0.2, deckH: 300 };
  check('clouds.shadow valid -> no error', errs((r) => { r.clouds.shadow = { ...SH }; }).length === 0);
  check('clouds.shadow.strength > 1 -> error', errs((r) => { r.clouds.shadow = { ...SH, strength: 1.5 }; }).length > 0);
  check('clouds.shadow.scale <= 0 -> error', errs((r) => { r.clouds.shadow = { ...SH, scale: 0 }; }).length > 0);
  check('clouds.shadow.cover out of [0,1] -> error', errs((r) => { r.clouds.shadow = { ...SH, cover: 2 }; }).length > 0);
  check('clouds.shadow.soft <= 0 -> error', errs((r) => { r.clouds.shadow = { ...SH, soft: 0 }; }).length > 0);
  check('clouds.shadow.deckH <= 0 -> error', errs((r) => { r.clouds.shadow = { ...SH, deckH: 0 }; }).length > 0);
  check('clouds.scale <= 0 -> error', errs((r) => { r.clouds.scale = 0; }).length > 0);
  check('clouds.bias <= 0 -> error', errs((r) => { r.clouds.bias = -1; }).length > 0);
  check('clouds.cover out of [0,1] -> error', errs((r) => { r.clouds.cover = 1.5; }).length > 0);
  check('clouds.wind non-finite -> error', errs((r) => { r.clouds.wind = [0, Infinity]; }).length > 0);
  check('clouds.wind wrong arity -> error', errs((r) => { r.clouds.wind = [0.1]; }).length > 0);
  check('clouds.ramp unknown key -> error', errs((r) => { r.clouds.ramp = 'nope'; }).length > 0);
  check('clouds.ramp non-printable-ASCII -> error', errs((r) => { r.clouds.ramp = 'bad'; }).length > 0);
}
// ---- warning: haze.far !== sky[0].c ----------------------------------------
{
  const warnings = [];
  const P2 = withLook((r) => { r.haze.far = 'hazeNear'; }); // != skyHorizon
  const e = validateLook(P2, 'afternoon', (m) => warnings.push(m));
  check('haze.far !== sky[0].c is a WARNING, not an error', e.length === 0 && warnings.length === 1);
  check('matching haze.far produces no warning', (() => { const w = []; validateLook(P, 'afternoon', (m) => w.push(m)); return w.length === 0; })());
}

// ---- S8-B2-20b (38.16): look.ao resolve + validate ---------------------------
{
  check('no look.ao -> rec.ao null', resolveLook(P, 'morning').ao === null);
  const P3 = makePalette();
  P3.timeOfDay.afternoon = { ...P3.timeOfDay.afternoon, ao: { strength: 0.5 } };
  const a = resolveLook(P3, 'afternoon').ao;
  check('look.ao defaults (radiusM 0.8, bias 0.15, maxCells 4)', a && a.strength === 0.5 && a.radiusM === 0.8 && a.bias === 0.15 && a.maxCells === 4);
  check('valid look.ao has no errors', validateLook(P3, 'afternoon').length === 0);
  for (const [bad, what] of [[{ strength: 1.5 }, 'strength'], [{ radiusM: 0 }, 'radiusM'], [{ radiusM: 9 }, 'radiusM'], [{ bias: 1 }, 'bias'], [{ bias: -1 }, 'bias'], [5, 'ao']]) {
    const P4 = makePalette();
    P4.timeOfDay.afternoon = { ...P4.timeOfDay.afternoon, ao: bad };
    check(`look.ao ${JSON.stringify(bad)} -> error on ${what}`, validateLook(P4, 'afternoon').some((m) => m.includes('.ao')));
  }
}

console.log(`look.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
