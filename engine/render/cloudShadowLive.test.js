// CLOUD-FLUFF-01d: live looks carry cloud-shadow blocks; blendLook blends them; syncLiveCloudShadow feeds lights.cloud; JS twin == WGSL formula is in cloudShadow.parity.test.js.
import { blendLook } from './look.js';
import { syncLiveCloudShadow, cloudShadeQ } from './cloudShadow.js';
import PALETTE from '../../design/palette.js';
let fails = 0; const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fails++; };
const P = PALETTE; const out = {};
const at = (h) => { blendLook(P, h, P.daySchedule, out); return out.cloudShadow ? out.cloudShadow.strength : 0; };
const S = P.timeOfDay;
for (const k of ['morning', 'noon', 'dusk', 'night', 'afternoon', 'evening']) ok('look ' + k + ' has clouds.shadow', !!(S[k].clouds && S[k].clouds.shadow));
ok('night strength 0', S.night.clouds.shadow.strength === 0);
const sched = P.daySchedule; let prev = at(0), maxStep = 0, mx = 0;
for (let h = 0.05; h <= 24; h += 0.05) { const v = at(h); maxStep = Math.max(maxStep, Math.abs(v - prev)); mx = Math.max(mx, v); prev = v; }
ok('blend continuous (max step ' + maxStep.toFixed(4) + ')', maxStep < 0.03);
ok('day strength moderate (max ' + mx.toFixed(2) + ')', mx > 0.25 && mx <= 0.4);
ok('midnight ~0', at(0) < 0.01 && at(23.9) < 0.05);
console.log('strengths by hour', [0, 6, 9, 12, 15, 18, 20, 22].map((h) => h + ':' + at(h).toFixed(2)).join(' '));
const lights = { cloud: { strength: 0.9, scale: 1, cover: 0, soft: 1, deckH: 1 }, cloudPal: P };
blendLook(P, 12, P.daySchedule, out); syncLiveCloudShadow(lights);
ok('sync copies live block', lights.cloud.strength === out.cloudShadow.strength && lights.cloud.deckH === out.cloudShadow.deckH);
// alignment: shadow scale = sky scale / deckH (a puff at dir d sits over ground metres d/dz * deckH)
const cs = S.noon.clouds.shadow; ok('scale matches visible puffs', Math.abs(cs.scale - S.noon.clouds.scale / cs.deckH) < 1e-5 && cs.cover === S.noon.clouds.cover);
const C = { ...cs, seed: S.noon.clouds.seed, strength: 1 }; const off = new Float32Array(2); let mn = 255, mxq = 0;
for (let x = 0; x < 600; x += 7) for (let y = 0; y < 600; y += 7) { const q = cloudShadeQ(C, off, x, y, 0, 0, 0, 1); mn = Math.min(mn, q); mxq = Math.max(mxq, q); }
ok('some ground in shadow and some in sun (' + mn + '..' + mxq + ')', mn === 0 && mxq > 50);
process.exit(fails ? 1 : 0);
