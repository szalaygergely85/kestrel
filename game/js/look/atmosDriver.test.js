// ENV-03a: atmosConfig validator + atmosDriver ACs. Run: node game/js/look/atmosDriver.test.js
import assert from 'node:assert/strict';
import { buildAtmosConfig } from './atmosConfig.js';
import { createAtmosDriver } from './atmosDriver.js';
import biomeLookMod from '../../../design/look/biomeLook.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef; biomeLookMod;
const BL = globalThis.BIOME_LOOK, recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };

// ---- config
const cfg = buildAtmosConfig(BL, G.biomes);
ok('deterministic', JSON.stringify(cfg) === JSON.stringify(buildAtmosConfig(BL, G.biomes)));
ok('no hex strings', !/#[0-9a-fA-F]{6}/.test(JSON.stringify(cfg)));
ok('6 entries x 3 slots', cfg.table.n === 6 && cfg.table.recs.length === 18 && cfg.table.recs.every(r => r && r.fog.length === 3));
ok('fog 0..255 floats', cfg.table.recs.every(r => [...r.fog, ...r.haze].every(v => v >= 0 && v <= 255)) && cfg.table.recs[0].fog[0] === 0xc8);
ok('map', cfg.biomeToEntry[0] === 0 && cfg.biomeToEntry[1] === 1 && cfg.biomeToEntry[2] === 1 && cfg.biomeToEntry[3] === -1 && cfg.biomeToEntry[4] === -1 &&
  cfg.biomeToEntry[5] === 2 && cfg.biomeToEntry[6] === 3 && cfg.biomeToEntry[9] === 4 && cfg.biomeToEntry[7] === 5 && cfg.biomeToEntry[8] === 5 && cfg.biomeToEntry[15] === -1);
const clone = () => JSON.parse(JSON.stringify(BL));
const bad = (label, mut, re, biomes) => { const d = clone(); mut(d); assert.throws(() => buildAtmosConfig(d, biomes || G.biomes), re, label); n++; };
const aA = d => d.biomes.meadow.atmos.A;
bad('density low', d => { aA(d).fogDensity = 0.0001; }, /fogDensity/);
bad('density high', d => { aA(d).fogDensity = 0.1; }, /fogDensity/);
bad('hazeAmount', d => { aA(d).hazeAmount = 1.5; }, /hazeAmount/);
bad('fog hex', d => { aA(d).fog.day = 'red'; }, /hex/);
bad('haze missing', d => { delete aA(d).haze.night; }, /hex/);
bad('grade slot missing', d => { delete aA(d).grade.dusk; }, /grade/);
bad('lift range', d => { aA(d).grade.day.lift = [0.2, 0, 0]; }, /lift/);
bad('lift len', d => { aA(d).grade.day.lift = [0, 0]; }, /lift/);
bad('gamma 0', d => { aA(d).grade.day.gamma = [1, 0, 1]; }, /gamma/);
bad('gain NaN', d => { aA(d).grade.day.gain = [1, NaN, 1]; }, /gain/);
bad('sat', d => { aA(d).grade.night.sat = 3; }, /sat/);
bad('pick', d => { d.biomes.meadow.pick.atmos = 'Z'; }, /pick/);
bad('unknown entry', d => { d.atmosMap[1] = 'nowhere'; }, /unknown entry/);
bad('bad id', d => { d.atmosMap[16] = 'forest'; }, /0\.\.15/);
bad('no atmosMap', d => { delete d.atmosMap; }, /atmosMap/);
bad('blendM < 20', () => {}, /blendM/, { ...G.biomes, 9: { ...G.biomes[9], blendM: 19 } });
bad('biome not in geo', () => {}, /not in geo/, { 1: G.biomes[1] });

// ---- driver
const sched = [{ h: 5, key: 'night' }, { h: 6.5, key: 'morning' }, { h: 12, key: 'noon' }, { h: 19, key: 'dusk' }, { h: 21, key: 'night' }];
const slotOf = { morning: 0, noon: 0, dusk: 1, night: 2 };
const DT = 1 / 60, N = 6;
// synthetic world along x: biome 0 | border 100 (blend 30 m) | biome 6 | border 300 | biome 1 | unmapped 3 from 500
function synth(x, _y, o) {
  const smooth = (c, h) => { const t = Math.min(1, Math.max(0, (x - (c - h)) / (2 * h))); return t * t * (3 - 2 * t); };
  let a, b, w;
  if (x < 100) { a = 0; b = 6; w = 0.5 * smooth(100, 15); if (x >= 85) { a = 0; b = 6; } }
  else if (x < 300) { a = 6; b = 1; w = 0.5 * smooth(300, 15); }
  else { a = 1; b = 3; w = 0.5 * smooth(500, 15); }
  if (x >= 100 && x < 115) { a = 6; b = 0; w = 0.5 - 0.5 * smooth(100, 15); }   // top-2 swap at the border (a hard jump in a/b)
  o.a = a; o.b = b; o.w = w; return o;
}
const mk = (blend = synth, extra = {}) => createAtmosDriver({ nEntries: N, biomeToEntry: cfg.biomeToEntry, biomeBlend: blend, schedule: sched, slotOf, fadeSec: 1.5, ...extra });
const sumOf = d => { let s = d.out.wNone; for (let e = 0; e < N; e++) s += d.out.w[e]; return s; };

// walk helper: per-step checks of sum==1 and |dw| <= dt/1.5
function walk(d, pts, speed, hour, label) {
  let maxDw = 0, bumps = 0, prev = new Float32Array(N + 1), v0 = d.out.version, steps = 0;
  const lim = DT / 1.5 + 1e-6;
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], len = Math.hypot(x1 - x0, y1 - y0), ns = Math.ceil(len / (speed * DT));
    for (let i = 0; i < ns; i++) {
      const t = i / ns;
      d.step(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, hour, DT, true);
      assert.ok(Math.abs(sumOf(d) - 1) < 1e-6, label + ' sum=' + sumOf(d));
      if (steps > 0) { for (let e = 0; e < N; e++) maxDw = Math.max(maxDw, Math.abs(d.out.w[e] - prev[e])); maxDw = Math.max(maxDw, Math.abs(d.out.wNone - prev[N])); }
      for (let e = 0; e < N; e++) prev[e] = d.out.w[e]; prev[N] = d.out.wNone;
      steps++;
    }
  }
  ok(label + ' max |dw| ' + maxDw.toFixed(5) + ' <= dt/1.5 ' + lim.toFixed(5) + ' (' + steps + ' steps)', maxDw <= lim);
  return d.out.version - v0;
}
let d = mk();
d.step(40, 0, 12, DT, true);
ok('first step snaps (meadow)', d.out.w[0] > 0.99 && d.active);
walk(d, [[40, 0], [200, 0]], 10, 12, 'border walk 10 m/s');
d = mk(); d.step(40, 0, 12, DT, true);
walk(d, [[40, 0], [650, 0], [40, 0]], 10, 12, '3-biome path');
// the fade really spreads a top-2 swap: forest weight rises smoothly to the target
d = mk(); d.step(450, 0, 12, DT, true);
ok('forest + none (3 unmapped) split at the end', d.out.w[1] > 0.9);

// real biomeBlend: a long walk over the real world, 10 m/s, checks sum + dw on whatever biomes it meets
G.util.installBiomes(util);
d = mk((x, y, o) => util.biomeBlend(x, y, o), {});
const seen = new Set(); const rb = { a: 0, b: 0, w: 0 };
d.step(1400, 1000, 12, DT, true);
const lim = DT / 1.5 + 1e-6; let worst = 0, st = 0;
const route = [[1400, 1000], [900, 1000], [900, 400], [1700, 400], [1700, 1500], [300, 1500]];
const prevW = new Float32Array(N + 1);
for (let k = 0; k < route.length - 1; k++) {
  const [x0, y0] = route[k], [x1, y1] = route[k + 1], ns = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (10 * DT));
  for (let i = 0; i < ns; i++) {
    const t = i / ns, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    util.biomeBlend(x, y, rb); seen.add(rb.a);
    d.step(x, y, 12, DT, true);
    assert.ok(Math.abs(sumOf(d) - 1) < 1e-6);
    if (st++ > 0) { for (let e = 0; e < N; e++) worst = Math.max(worst, Math.abs(d.out.w[e] - prevW[e])); }
    for (let e = 0; e < N; e++) prevW[e] = d.out.w[e]; prevW[N] = d.out.wNone;
  }
}
ok('real route: ' + seen.size + ' biome ids, max |dw| ' + worst.toFixed(5), worst <= lim && seen.size >= 3);

// standing still 600 steps -> 0 bumps (incl. frozen clock)
d = mk(); d.step(100, 0, 12, DT, true);
for (let i = 0; i < 400; i++) d.step(100, 0, 12, DT, true);   // settle (border: fade to the target)
let v = d.out.version; for (let i = 0; i < 600; i++) d.step(100, 0, 12, DT, true);
ok('600 still steps -> 0 bumps', d.out.version === v);
d = mk(); d.step(100, 0, NaN, DT, true); v = d.out.version; for (let i = 0; i < 600; i++) d.step(100, 0, NaN, DT, true);
ok('frozen clock: 0 bumps, tod = day', d.out.version === v && d.out.tod[0] === 1);

// +-1 m border jitter (axis and diagonal) -> 0 bumps after settling
let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const diag of [false, true]) {
  d = mk(); d.step(100, 0, 12, DT, true);
  for (let i = 0; i < 400; i++) d.step(100, 0, 12, DT, true);
  v = d.out.version;
  for (let i = 0; i < 600; i++) d.step(100 + (rnd() * 2 - 1), diag ? (rnd() * 2 - 1) : 0, 12, DT, true);
  ok('+-1 m jitter ' + (diag ? 'x+y' : 'x') + ' -> 0 bumps (got ' + (d.out.version - v) + ')', d.out.version === v);
}

// snap(): target in one step; teleport > 50 m snaps too
d = mk(); d.step(40, 0, 12, DT, true);
d.step(41, 0, 12, DT, true);
d.snap(250, 0, 12, true);
let tgtOk = d.out.w[3] > 0.99 && Math.abs(sumOf(d) - 1) < 1e-6;
ok('snap(x) jumps to target in 1 step', tgtOk);
d = mk(); d.step(40, 0, 12, DT, true); d.step(450, 0, 12, DT, true);
ok('teleport > 50 m snaps', d.out.w[1] > 0.9);
d = mk(); d.step(40, 0, 12, DT, true); d.snap(); ok('snap() no args', d.out.w[0] > 0.99);

// outdoor false -> none within 1.5 s (+ active off), back outdoors fades in
d = mk(); d.step(40, 0, 12, DT, true);
let t = 0; while (d.active && t < 200) { d.step(40, 0, 12, DT, false); t++; }
ok('outdoor false: none within 1.5 s (' + t + ' steps), active off', !d.active && t <= 91 && d.out.wNone >= 0.999);
for (let i = 0; i < 100; i++) d.step(40, 0, 12, DT, true);
ok('outdoor true again: back on', d.active && d.out.w[0] > 0.99);

// tod: segment rule
d = mk(); d.step(40, 0, 12, DT, true); ok('noon = day', d.out.tod[0] === 1);
d.step(40, 0, 19, DT, true); ok('19:00 = dusk', d.out.tod[1] === 1);
d.step(40, 0, 15.5, DT, true); ok('15:30 = day/dusk mix', Math.abs(d.out.tod[0] - 0.5) < 1e-6 && Math.abs(d.out.tod[1] - 0.5) < 1e-6);
d.step(40, 0, 2, DT, true); ok('02:00 = night', d.out.tod[2] === 1);
d.step(40, 0, 5.75, DT, true); ok('05:45 night -> morning(day) mix', Math.abs(d.out.tod[2] - 0.5) < 1e-6 && Math.abs(d.out.tod[0] - 0.5) < 1e-6);

// 0 alloc per step
// (synthetic blend: the driver alone; the real biomeBlend shows ~10-300 KB of its own scratch noise per 20000 calls, not the driver)
const flat = (x, _y, o) => { o.a = (x / 50) & 7; o.b = 1; o.w = (x % 50) / 100; return o; };
d = mk(flat); d.step(1400, 1000, 12, DT, true);
const run = () => { for (let i = 0; i < 200000; i++) d.step((i * 0.1) % 600, 0, 12 + i * 1e-3, DT, true); };
for (let w = 0; w < 8; w++) run();   // warm (JIT: unoptimised callers box double args)
let growth = Infinity;
for (let r = 0; r < 3; r++) { if (global.gc) global.gc(); const h0 = process.memoryUsage().heapUsed; run(); growth = Math.min(growth, process.memoryUsage().heapUsed - h0); }
ok('0 alloc: min heap growth ' + growth + ' B over 200000 steps (< 7.5 B/step; an object per step would be >= 3 MB)', growth < 1500000);
console.log('atmosConfig/atmosDriver tests: ' + n + ' ok');
