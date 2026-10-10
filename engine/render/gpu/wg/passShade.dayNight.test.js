// Run: node engine/render/gpu/wg/passShade.dayNight.test.js - DN-02 AC1: sky LUT re-bakes only on a new liveLookVersion; frozen path unchanged.
import { WgShadePass } from './passShade.js';
import palette from '../../../../design/palette.js';
import { blendLook } from '../../look.js';
import { SKY_LUT_N } from '../wgsl/skyLut.js';

let fails = 0;
const ok = (n, c) => { if (!c) { fails++; console.log('FAIL', n); } else console.log('ok  ', n); };
const P = { ...palette, rgb: { ...palette.rgb }, hue: { ...palette.hue } };
let writes = 0;
const dev = {
  createPipeline: () => ({}), createTexture: (d) => ({ ...d }), writeTexture: () => { writes++; }, dispose() {},
};
const pass = new WgShadePass(dev);
pass.palette = P;
// frozen: bake once from timeOfDay[defaultTime], then never stale
ok('first bake needed', pass._skyStale()); pass._bakeSky();
const frozen = Float32Array.from(pass.skyData);
ok('frozen: not stale', !pass._skyStale());
const stops = P.timeOfDay[P.defaultTime].sky, c0 = P.rgb[stops[0].c];
ok('frozen: LUT[0] = first stop', Math.abs(frozen[0] - c0[0]) < 1e-5);
// live: first blend marks stale, bake once, 100 frames at the same version = 0 bakes
const out = {}; blendLook(P, 23, P.daySchedule, out);
ok('live: stale after blendLook', pass._skyStale()); pass._bakeSky();
const bakes0 = pass.stats.skyBakes;
for (let f = 0; f < 100; f++) if (pass._skyStale()) pass._bakeSky();
ok('live: no re-bake at same version', pass.stats.skyBakes === bakes0);
const night = Float32Array.from(pass.skyData);
let diff = 0; for (let i = 0; i < 4 * SKY_LUT_N; i++) diff += Math.abs(night[i] - frozen[i]);
ok('night LUT differs from morning', diff > 50);
const ns = P.liveLook.sky; ok('night LUT[0] = live first stop', Math.abs(night[0] - P.rgb[ns[0].c][0]) < 1e-5);
// 600 steps of the clock (hour 23 -> 23.2 in 1/480 h) = 96 version bumps = 96 bakes exactly
let steps = 0; for (let s = 1; s <= 96; s++) { blendLook(P, 23 + s / 480, P.daySchedule, out); steps++; for (let f = 0; f < 5; f++) if (pass._skyStale()) pass._bakeSky(); }
ok('one bake per version bump (96)', pass.stats.skyBakes - bakes0 === steps);
// liveLook dropped (e.g. frozen again): re-bake back to the static look
delete P.liveLook; ok('liveLook removed -> stale', pass._skyStale()); pass._bakeSky();
ok('back to the frozen LUT bytes', pass.skyData.every((v, i) => v === frozen[i]));
if (fails) { console.log(fails + ' failed'); process.exit(1); } console.log('passShade.dayNight: all ok');
