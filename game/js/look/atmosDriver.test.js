// ENV-03a: atmosConfig validator + atmosDriver AC. Run: node --expose-gc game/js/look/atmosDriver.test.js
import assert from 'node:assert/strict';
import { buildAtmosConfig, ATMOS_SLOT_OF } from './atmosConfig.js';
import { createAtmosDriver } from './atmosDriver.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
import '../../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
biomeLookMod;
const BL = globalThis.BIOME_LOOK, G = globalThis.ASSETS.levels.world_geo;
// same schedule as design/palette.js P.daySchedule
const SCHED = [{ h: 5, key: 'night' }, { h: 6.5, key: 'morning' }, { h: 12, key: 'noon' }, { h: 19, key: 'dusk' }, { h: 21, key: 'night' }];
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };
const clone = o => JSON.parse(JSON.stringify(o));

// ---- config
const cfg = buildAtmosConfig(BL, G.biomes);
ok('deterministic', JSON.stringify(buildAtmosConfig(BL, G.biomes)) === JSON.stringify(cfg));
ok('no hex strings', !/#[0-9a-fA-F]{6}/.test(JSON.stringify(cfg)));
ok('entries: 6 looks x 3 slots', cfg.n === 6 && cfg.recs.length === 18);
ok('mapping', cfg.biomeToEntry[3] === -1 && cfg.biomeToEntry[4] === -1 && cfg.biomeToEntry[1] === cfg.biomeToEntry[2] && cfg.biomeToEntry[7] === cfg.biomeToEntry[8] && cfg.biomeToEntry[0] >= 0);
ok('fog 0..255 floats', cfg.recs.every(r => r.fog.length === 3 && r.fog.every(v => v >= 0 && v <= 255) && r.haze.every(v => v >= 0 && v <= 255)));
const bad = (name, mut) => { const b = clone(BL); mut(b); assert.throws(() => buildAtmosConfig(b, G.biomes), /atmosConfig/, name); n++; };
bad('fogDensity high', b => { b.biomes.forest.atmos.A.fogDensity = 0.5; });
bad('fogDensity low', b => { b.biomes.forest.atmos.A.fogDensity = 0; });
bad('hazeAmount', b => { b.biomes.meadow.atmos.A.hazeAmount = 1.5; });
bad('bad hex', b => { b.biomes.meadow.atmos.A.fog.day = 'red'; });
bad('missing slot', b => { delete b.biomes.meadow.atmos.A.grade.dusk; });
bad('gamma 0', b => { b.biomes.meadow.atmos.A.grade.day.gamma = [1, 0, 1]; });
bad('sat', b => { b.biomes.meadow.atmos.A.grade.day.sat = 3; });
bad('lift', b => { b.biomes.meadow.atmos.A.grade.night.lift = [0.2, 0, 0]; });
bad('lift len', b => { b.biomes.meadow.atmos.A.grade.night.lift = [0, 0]; });
bad('bad pick', b => { b.biomes.meadow.pick.atmos = 'Z'; });
bad('unknown entry', b => { b.atmosMap[5] = 'nope'; });
bad('bad id', b => { b.atmosMap[99] = 'meadow'; });
assert.throws(() => buildAtmosConfig(BL, { 1: { blendM: 10 }, 2: {}, 5: {}, 6: {}, 7: {}, 8: {}, 9: {} }), /blendM/); n++;

// ---- driver on a synthetic strip: x<0 biome 0, 0..L biome 6 (border width 30 m), x>L biome 1 (3-biome path)
function strip(L) {
  const smooth = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return (x, y, o) => {
    const t1 = smooth((x + 15) / 30), t2 = smooth((x - L + 15) / 30);   // 0 -> 6 around x=0, 6 -> 1 around x=L
    if (t2 > 0) { o.a = t2 > 0.5 ? 1 : 6; o.b = t2 > 0.5 ? 6 : 1; o.w = t2 > 0.5 ? 1 - t2 : t2; }
    else { o.a = t1 > 0.5 ? 6 : 0; o.b = t1 > 0.5 ? 0 : 6; o.w = t1 > 0.5 ? 1 - t1 : t1; }
  };
}
const mk = (fn) => createAtmosDriver({ nEntries: cfg.n, biomeToEntry: cfg.biomeToEntry, biomeBlend: fn, schedule: SCHED, slotOf: ATMOS_SLOT_OF, fadeSec: 1.5 });
const DT = 1 / 60, MAXD = DT / 1.5 + 2e-6;
const sum = d => { let s = d.wNone; for (let i = 0; i < d.w.length; i++) s += d.w[i]; return s; };
const wOf = (d, biome) => d.w[cfg.biomeToEntry[biome]];

// walk 10 m/s across both borders: sum==1, per-step |dw| <= dt/1.5
{
  const d = mk(strip(120)); const prev = new Float64Array(cfg.n + 1); let x = -60;
  d.step(x, 0, 12, DT, true); ok('first step snaps to meadow', wOf(d, 0) > 0.99);
  for (let s = 0; s < 1800; s++) {
    for (let i = 0; i < cfg.n; i++) prev[i] = d.w[i];
    prev[cfg.n] = d.wNone;
    x += 10 * DT; d.step(x, 0, 12, DT, true);
    assert.ok(Math.abs(sum(d) - 1) < 1e-6, 'sum');
    for (let i = 0; i < cfg.n; i++) assert.ok(Math.abs(d.w[i] - prev[i]) <= MAXD, 'dw step ' + s);
    assert.ok(Math.abs(d.wNone - prev[cfg.n]) <= MAXD);
  }
  n++;
  ok('walked into forest (3rd biome)', wOf(d, 1) > 0.9);
}
// standing still 600 steps: 0 version bumps
{
  const d = mk(strip(120)); for (let i = 0; i < 200; i++) d.step(0, 0, 12, DT, true);
  const v = d.version; for (let i = 0; i < 600; i++) d.step(0, 0, 12, DT, true); ok('still: 0 bumps', d.version === v);
}
// +-1 m jitter on a border: 0 bumps after settling
{
  const d = mk(strip(120)); let s = 0;
  for (; s < 200; s++) d.step(s % 2 ? 1 : -1, 0, 12, DT, true);
  const v = d.version; for (; s < 800; s++) d.step(s % 2 ? 1 : -1, 0, 12, DT, true);
  ok('jitter: 0 bumps', d.version === v);
}
// snap, teleport, outdoor false
{
  const d = mk(strip(120)); d.step(-60, 0, 12, DT, true); d.step(-60, 0, 12, DT, true);
  d.step(200, 0, 12, DT, true); ok('teleport > 50 m snaps', wOf(d, 1) > 0.99);
  d.step(200, 0, 12, DT, false); ok('indoor starts fading', d.wNone > 0 && d.wNone < 0.05);
  let k = 1; while (!(d.wNone >= 0.999) && k < 200) { d.step(200, 0, 12, DT, false); k++; }
  ok('wNone 1 within 1.5 s (+1 step)', k <= 91); ok('off after wNone >= 0.999', d.on === false);
  d.snap(); d.step(200, 0, 12, DT, true); ok('snap back in 1 step', wOf(d, 1) > 0.99 && d.on === true);
  const d2 = mk(strip(120)); d2.step(-60, 0, 12, DT, true); d2.snap(); d2.step(100, 0, 12, DT, true);
  ok('snap(): 1 step to target', wOf(d2, 6) > 0.99 || wOf(d2, 6) + wOf(d2, 1) > 0.99);
}
// on/off hysteresis
{
  const d = mk(strip(120)); d.step(0, 0, 12, DT, true); ok('on', d.on);
  d.step(0, 0, 12, DT, false); ok('on stays during fade', d.on);
}
// tod: segment rule + frozen clock
{
  const d = mk(strip(120));
  d.step(0, 0, 12, DT, true); ok('noon = day', d.tod[0] === 1);
  d.step(0, 0, 19, DT, true); ok('19:00 = dusk', d.tod[1] === 1);
  d.step(0, 0, 20, DT, true); ok('20:00 half dusk/night', Math.abs(d.tod[1] - 0.5) < 1e-6 && Math.abs(d.tod[2] - 0.5) < 1e-6);
  d.step(0, 0, 2, DT, true); ok('02:00 night', d.tod[2] === 1);
  d.step(0, 0, 5.75, DT, true); ok('05:45 night -> day', d.tod[2] > 0 && d.tod[0] > 0 && Math.abs(d.tod[0] + d.tod[2] - 1) < 1e-6);
  d.step(0, 0, 'dusk', DT, true); ok('frozen key', d.tod[1] === 1);
  const v = d.version; d.step(0, 0, 'dusk', DT, true); ok('frozen: no bump', d.version === v);
}
// 0 alloc per step (constant args: the caller boxing a fresh double per call would be counted otherwise); retained heap after a walk
{
  const d = mk(strip(120)); let x = -60; for (let i = 0; i < 3000; i++) { x += 0.2; d.step(x, 0, 12, DT, true); }
  if (global.gc) {
    global.gc(); let h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) d.step(0, 0, 12, DT, true);
    const dh = process.memoryUsage().heapUsed - h0; ok('0 alloc standing (' + dh + ' B / 20000 steps)', dh < 20000);
    x = -60; global.gc(); h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) { x += 0.05; d.step(x, 0, 12, DT, true); }
    global.gc(); const dr = process.memoryUsage().heapUsed - h0; ok('nothing retained after a walk (' + dr + ' B)', dr < 20000);
  } else console.log('atmosDriver: (run with --expose-gc for the alloc probe)');
}
console.log('atmosDriver.test: ' + n + ' checks OK');
