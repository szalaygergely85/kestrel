// engine/render/lightPriority.test.js - VISQA-32 LIGHT-PRIORITY: placed-light pool (more than MAX_LIGHTS placed lights).
//   node --expose-gc engine/render/lightPriority.test.js
import { LightSet, MAX_LIGHTS, POOL_SWAP_MARGIN_M } from './lighting.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const _p = { x: 0, y: 0, z: 0 };
const P = (x, y, z) => { _p.x = x; _p.y = y; _p.z = z; return _p; };
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// 60 lights along a 600 m line (one every 10 m, radius 6), the camera walks it.
const defs = [];
for (let i = 0; i < 60; i++) defs.push({ x: i * 10, y: (i % 3) * 2, z: 1, hue: [1, 0.7, 0.4], intensity: 1, radius: 6, key: 'L' + i, on: true });
const activeKeys = (ls) => { const o = []; for (let h = 0; h < ls.count; h++) if (ls.slotPool[h] >= 0) o.push(ls.key[h]); return o; };
const nearestKeys = (x, n) => defs.map((d) => [Math.hypot(d.x - x, d.y, d.z - 1) - d.radius, d.key]).sort((a, b) => a[0] - b[0]).slice(0, n);

// AC: <= MAX_LIGHTS -> no pool (old path); > MAX_LIGHTS -> pool fills every slot
{
  const ls = new LightSet();
  ok('no pool by default', ls.poolN === 0);
  ls.selectPlaced(P(5, 5, 5)); // no-op
  ok('selectPlaced without a pool is a no-op', ls.count === 0 && ls.poolStats.swaps === 0);
}
const ls = new LightSet();
ls.setPool(defs);
ok('pool: all slots used, no drop', ls.count === MAX_LIGHTS && ls.poolN === 60 && ls.poolStats.active === MAX_LIGHTS);

// AC: the nearest lights are active (within the hysteresis margin)
ls.selectPlaced(P(300, 0, 1));
{
  const want = nearestKeys(300, MAX_LIGHTS), act = new Set(activeKeys(ls));
  const worstE = want[want.length - 1][0];
  const strict = nearestKeys(300, 60).filter(([e]) => e < worstE - POOL_SWAP_MARGIN_M).map(([, k]) => k);
  ok('camera at 300 m: every light clearly in the nearest 24 is active', strict.every((k) => act.has(k)), [...act].join(','));
  ok('camera at 300 m: L30 (under the camera) active', act.has('L30'));
}

// AC: no flicker - walk 0 -> 590 m and back in 0.1 m steps; swaps bounded per metre, no A-B-A within the margin
{
  const s0 = ls.poolStats.swaps;
  let last = new Map(), flips = 0;
  for (let h = 0; h < MAX_LIGHTS; h++) last.set(h, ls.key[h]);
  const seen = new Map(); // slot -> [key, x when it entered]
  let pingPong = 0;
  for (let pass2 = 0; pass2 < 2; pass2++) {
    for (let k = 0; k <= 5900; k++) {
      const x = pass2 === 0 ? k * 0.1 : 590 - k * 0.1;
      ls.selectPlaced(P(x, 0, 1.6));
      for (let h = 0; h < MAX_LIGHTS; h++) {
        if (ls.key[h] !== last.get(h)) {
          flips++;
          const prev = seen.get(h);
          if (prev && prev[0] === ls.key[h] && Math.abs(prev[1] - x) < POOL_SWAP_MARGIN_M) pingPong++;
          seen.set(h, [last.get(h), x]);
          last.set(h, ls.key[h]);
        }
      }
    }
  }
  const swaps = ls.poolStats.swaps - s0, metres = 2 * 590;
  ok(`walk: swaps per metre bounded (${(swaps / metres).toFixed(3)}/m, <= 0.25)`, swaps / metres <= 0.25, String(swaps));
  ok('walk: no slot swaps back to its previous light within the margin (no flicker)', pingPong === 0, String(pingPong));
  ok('walk end (x=0): L0..L2 active', ['L0', 'L1', 'L2'].every((k) => activeKeys(ls).includes(k)));
  // standing still: zero swaps
  const s1 = ls.poolStats.swaps;
  for (let f = 0; f < 600; f++) ls.selectPlaced(P(0.01 * (f % 7), 0, 1.6));
  ok('standing still / jitter < 0.5 m: 0 swaps', ls.poolStats.swaps === s1);
}

// AC: parked light keeps its live state (setOn / intensity ramp) and comes back with it
{
  const t = new LightSet(); t.setPool(defs);
  t.selectPlaced(P(0, 0, 1));
  const h = t.key.indexOf('L1');
  t.setOn(h, false); t.baseIntensity[h] = 0.25;
  t.selectPlaced(P(500, 0, 1)); // L1 parked
  ok('far away: L1 parked', t.key.indexOf('L1') < 0);
  t.selectPlaced(P(0, 0, 1));
  const h2 = t.key.indexOf('L1');
  ok('back: L1 active again with on=0 and intensity 0.25', h2 >= 0 && t.on[h2] === 0 && Math.abs(t.baseIntensity[h2] - 0.25) < 1e-6);
}

// AC: a runtime light (entity / fireball) takes the farthest pool slot, never dropped; its handle stays put
{
  const t = new LightSet(); t.setPool(defs);
  t.selectPlaced(P(0, 0, 1));
  const warn = console.warn; let warns = 0; console.warn = () => warns++;
  const hr = t.add({ x: 0, y: 0, z: 1, hue: [1, 1, 1], intensity: 1, radius: 4, key: 'entity.player' });
  ok('runtime add on a full pooled set succeeds without a warning', hr >= 0 && t.key[hr] === 'entity.player' && warns === 0);
  ok('runtime light replaced the farthest pooled light', t.key.indexOf('L23') < 0 && t.slotPool[hr] === -1);
  for (let k = 0; k < 3000; k++) t.selectPlaced(P(k * 0.2, 0, 1));
  ok('runtime handle survives 600 m of re-ranking', t.key[hr] === 'entity.player' && t.poolStats.swaps > 0);
  // a set with no pool and no derived still warns, but only once
  const f = new LightSet();
  for (let i = 0; i < MAX_LIGHTS + 5; i++) f.add({ x: i, y: 0, z: 0, hue: [1, 1, 1], intensity: 1, radius: 4, key: 'f' + i });
  console.warn = warn;
  ok('full set without a pool warns once, not per light', warns === 1, String(warns));
}

// AC: 0 allocation per frame
if (global.gc) {
  const t = new LightSet(); t.setPool(defs);
  for (let k = 0; k < 200; k++) t.selectPlaced(P(k, 0, 1)); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let k = 0; k < 20000; k++) t.selectPlaced(P((k % 5900) * 0.1, 0, 1.6));
  global.gc();
  const after = process.memoryUsage().heapUsed;
  ok(`selectPlaced: 20000 frames do not grow the heap (${after - before} B)`, after - before < 100000);
} else console.log('SKIP zero-alloc check (run with --expose-gc)');

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
