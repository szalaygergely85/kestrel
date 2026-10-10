// DN-01 (docs/architecture.md 38.39) Node tests: blendLook endpoints, dusk monotonic, night floor, moon switch, no-liveLook identity.
import palette from '../../design/palette.js';
import { blendLook } from './look.js';
import { fastShadeSky } from './fastShade.js';
import { skyLutFromPalette } from './waterReflect.js';
import { sunFromWorld, applySunHours } from './lighting.js';
import { sunPathFrom } from '../core/sunPath.js';

let fail = 0;
function check(n, c) { if (!c) { fail++; console.error('FAIL:', n); } }
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const clone = () => { const P = { ...palette, rgb: { ...palette.rgb }, hue: { ...palette.hue } }; return P; };
const P = clone(), S = P.daySchedule, out = {};

// identity: no liveLook -> reads unchanged
const base = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] }, live0 = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] };
fastShadeSky(P, 0, 30, P.defaultTime, base);
const sunBase = { ...sunFromWorld({ sun: { azimuth: 100, elevation: 30 }, structures: [] }, P, {}) };
check('no liveLook: ambientI is morning', sunBase.ambientI === P.timeOfDay.morning.ambientI && sunBase.sunI === P.timeOfDay.morning.sunI);

// endpoints == key records (night key is lifted to the floor only when below it; 0.06 == floor)
for (const e of S) {
  blendLook(P, e.h, S, out);
  const T = P.timeOfDay[e.key];
  check('endpoint ' + e.key + ' ambientI', near(out.ambientI, Math.max(T.ambientI, P.nightFloor.ambientI)));
  check('endpoint ' + e.key + ' sunI', near(out.sunI, T.sunI));
  check('endpoint ' + e.key + ' sunElev', near(out.sunElev, T.sunElev));
  const ok = [0, 1, 2].every((i) => near(P.rgb[out.ambient][i], P.rgb[T.ambient][i]) && near(P.rgb[out.sun][i], P.rgb[T.sun][i]) && near(P.rgb[out.fog][i], P.rgb[T.fog][i]));
  check('endpoint ' + e.key + ' colours', ok);
  check('endpoint ' + e.key + ' sky', T.sky.every((s, k) => near(out.sky[k].t, s.t) && [0, 1, 2].every((i) => near(P.rgb[out.sky[k].c][i], P.rgb[s.c][i]))));
}
// midpoint = lerp
blendLook(P, 15.5, S, out);
check('midpoint sunI', near(out.sunI, (P.timeOfDay.noon.sunI + P.timeOfDay.dusk.sunI) / 2));
check('midpoint ambient r', near(P.rgb[out.ambient][0], (P.rgb[P.timeOfDay.noon.ambient][0] + P.rgb[P.timeOfDay.dusk.ambient][0]) / 2));
// wrap segment 21 -> 5 night, and 0h
blendLook(P, 0, S, out); check('midnight = night', near(out.sunI, P.timeOfDay.night.sunI));
blendLook(P, 24 + 12, S, out); check('hour wraps', near(out.sunI, P.timeOfDay.noon.sunI));
// monotonic dusk: sunI never rises 19 -> 21 (and 12 -> 19)
let prev = Infinity, mono = true;
for (let h = 12; h <= 21; h += 0.05) { blendLook(P, h, S, out); if (out.sunI > prev + 1e-12) mono = false; prev = out.sunI; }
check('sunI monotonic 12..21', mono);
// night floor over the whole day
let minAmb = 9;
for (let h = 0; h < 24; h += 0.05) { blendLook(P, h, S, out); minAmb = Math.min(minAmb, out.ambientI); }
check('ambient >= nightFloor', minAmb >= P.nightFloor.ambientI - 1e-12 && out.floorLum === P.nightFloor.lum);
// floor lifts a dark key
const P2 = clone(); P2.timeOfDay = { ...P.timeOfDay, night: { ...P.timeOfDay.night, ambientI: 0.01 } };
blendLook(P2, 23, S, {}); check('floor lifts 0.01', near(P2.liveLook.ambientI, 0.06));

// readers follow liveLook; version bumps
blendLook(P, 23, S, out);
const v = P.liveLookVersion; blendLook(P, 23.1, S, out); check('version bumps', P.liveLookVersion === v + 1 && P.liveLook === out);
const nightSky = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] }; fastShadeSky(P, 0, 30, P.defaultTime, nightSky);
const viaKey = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] }; const Pn = clone(); Pn.defaultTime = 'night'; fastShadeSky(Pn, 0, 30, 'night', viaKey);
check('fastShadeSky live ~ night key at 23h', near(nightSky.bg[0], viaKey.bg[0], 1.5) && near(nightSky.bg[2], viaKey.bg[2], 1.5));
const lutA = new Float32Array(32 * 4), lutB = new Float32Array(32 * 4);
skyLutFromPalette(P, lutA); const Pm = clone(); Pm.defaultTime = 'night'; skyLutFromPalette(Pm, lutB);
check('sky LUT live ~ night at 23h', near(lutA[0], lutB[0], 1.5));
check('sunFromWorld reads liveLook', sunFromWorld({ sun: { azimuth: 100, elevation: 30 }, structures: [] }, P, {}).sunI === P.liveLook.sunI);
// without liveLook byte-identical
const Pc = clone(); const o2 = { glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0] }; fastShadeSky(Pc, 0, 30, Pc.defaultTime, o2);
check('no-liveLook sky identical', o2.bg.join() === base.bg.join() && o2.fg.join() === base.fg.join() && o2.glyphIdx === base.glyphIdx);

// moon switch below -6 deg
const path = sunPathFrom({ elevation: 60, azimuth: 112.5 });
const w = { sun: { elevation: 0, azimuth: 0 }, structures: [] }; const ls = { setSun() {} };
applySunHours(w, ls, 0, path, true, false); const sunEl = w.sun.elevation;
applySunHours(w, ls, 0, path, true, true);
check('midnight sun below -6; moon switch lifts it', sunEl < -6 && w.sun.elevation > 6 && near(w.sun.elevation, -sunEl, 1e-6));
applySunHours(w, ls, 12, path, true, true); check('noon unchanged by moon flag', w.sun.elevation > 60);

// zero alloc after warm-up
blendLook(P, 7, S, out);
const m0 = process.memoryUsage().heapUsed; let acc = 0;
for (let i = 0; i < 20000; i++) { blendLook(P, (i * 0.37) % 24, S, out); acc += out.sunI; }
const grown = process.memoryUsage().heapUsed - m0;
check('blendLook ~0 alloc (' + grown + ' B)', grown < 200000 && acc > 0);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('blendLook.test.js ok');
