// US-143a (docs/architecture.md 35.1/35.2): the wave height field + clock.
// Run: node engine/world/waves.test.js
import { WAVE_SPECTRUM, WAVE_STATES, ampsFor, fnv1a, compileRegion, buildWaveTables, createWaveClock, waveSampleInto, waveHeight } from './waves.js';
import { createWater, collectWaterDefs } from './water.js';
import { createHasher } from '../core/hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const rect = (id, extra = {}) => ({ id, shape: 'rect', rect: [0, 0, 10, 10], z: 0, ...extra });
const mkWater = (defsRaw, seaState) => createWater(collectWaterDefs({ water: defsRaw }, []), seaState);

// ---- frozen constants, verbatim from architecture.md 35.1 ----
{
  ok('WAVE_SPECTRUM has the 4 documented waves', WAVE_SPECTRUM.length === 4
    && WAVE_SPECTRUM[0].offDeg === 0 && WAVE_SPECTRUM[0].lambda === 24
    && WAVE_SPECTRUM[1].offDeg === 25 && WAVE_SPECTRUM[1].lambda === 13
    && WAVE_SPECTRUM[2].offDeg === -40 && WAVE_SPECTRUM[2].lambda === 6
    && WAVE_SPECTRUM[3].offDeg === 70 && WAVE_SPECTRUM[3].lambda === 3);
  ok('WAVE_STATES amplitudes match the doc (sums 0.03 / 0.12 / 0.45 m)',
    near(WAVE_STATES.calm.reduce((a, b) => a + b, 0), 0.03)
    && near(WAVE_STATES.breezy.reduce((a, b) => a + b, 0), 0.12)
    && near(WAVE_STATES.storm.reduce((a, b) => a + b, 0), 0.45));
  ok('frozen: WAVE_SPECTRUM/WAVE_STATES throw in strict mode on mutation attempt', Object.isFrozen(WAVE_SPECTRUM) && Object.isFrozen(WAVE_STATES));
  ok('ampsFor("none") is all zero', ampsFor('none').every((a) => a === 0));
  ok('ampsFor rejects an unknown state', (() => { try { ampsFor('typhoon'); return false; } catch (e) { return true; } })());
  ok('fnv1a is deterministic', fnv1a('abc') === fnv1a('abc') && fnv1a('abc') !== fnv1a('abd'));
}

// ---- compile: per-region wk/wa shape, period of the main wave (T = lambda/speed ~= 3.9 s) ----
{
  const c = compileRegion({ id: 'r1', waveDirDeg: 0, seed: 1, waves: 'calm' }, 'calm');
  ok('wk is 16 doubles (4 waves x [kx,ky,om,phi])', c.wk.length === 16);
  ok('wa is 4 doubles', c.wa.length === 4 && near(c.wa[0], WAVE_STATES.calm[0]));
  const om0 = c.wk[2]; // main wave (lambda 24), om = speed/lambda (cycles/s)
  const period = 1 / om0;
  ok('main wave period is 3-8 s (AC), ~3.9 s', period > 3 && period < 8, period);
  const c2 = compileRegion({ id: 'r1', waveDirDeg: 0, seed: 1, waves: 'calm' }, 'calm');
  ok('compile is deterministic for the same id/seed', Array.from(c.wk).every((v, i) => v === c2.wk[i]));
  const c3 = compileRegion({ id: 'r2', waveDirDeg: 0, seed: 1, waves: 'calm' }, 'calm');
  ok('a different id gets a different phase (fnv1a mixes the seed)', c.wk[3] !== c3.wk[3]);
  const cSea = compileRegion({ id: 'r1', waves: 'sea' }, 'storm');
  ok('waves:"sea" compiles with the WORLD seaState amplitude at load', near(cSea.wa[0], WAVE_STATES.storm[0]) && cSea.isSea === true);
}

// ---- waveSampleInto / waveHeight: amplitude bound, matches the normative formula, gradient sign ----
{
  const t = mkWater([rect('a', { waves: 'storm', waveDirDeg: 0, seed: 5 })]);
  const ampSum = WAVE_STATES.storm.reduce((a, b) => a + b, 0);
  const out = { h: 0, hx: 0, hy: 0 };
  let sawNonzero = false;
  for (let tick = 0; tick < 200; tick += 7) {
    for (let x = -5; x <= 5; x += 2.3) {
      for (let y = -5; y <= 5; y += 1.7) {
        waveSampleInto(t, 0, x, y, tick, out);
        ok(`|h| <= ampSum (tick ${tick}, x${x.toFixed(1)}, y${y.toFixed(1)})`, Math.abs(out.h) <= ampSum + 1e-9, out.h);
        ok(`waveHeight matches waveSampleInto.h (tick ${tick})`, near(waveHeight(t, 0, x, y, tick), out.h, 1e-9));
        if (out.h !== 0) sawNonzero = true;
      }
    }
  }
  ok('amplitude bound probe actually exercised nonzero heights', sawNonzero);

  // Hand-check the formula at a single point/tick against the normative pseudocode, independent of the engine code.
  const STEP = 1 / 60;
  const kx = t.wk[0], ky = t.wk[1], om = t.wk[2], phi = t.wk[3]; // wave 0 of region 0
  const x = 3.2, y = -1.4, tick = 17;
  const time = tick * STEP;
  let u = kx * x + ky * y - om * time + phi;
  u = u - Math.floor(u);
  const w = 2 * u - 1;
  const expectedS = 4 * w * (1 - Math.abs(w));
  const A = t.wa[0];
  // Isolate wave 0's contribution by zeroing the other 3 amplitudes (same region/table - id/seed must match
  // exactly what kx/ky/om/phi were read from above).
  const saved123 = [t.wa[1], t.wa[2], t.wa[3]];
  t.wa[1] = 0; t.wa[2] = 0; t.wa[3] = 0;
  const hSolo = waveHeight(t, 0, x, y, tick);
  ok('formula matches the normative pseudocode (wave 0 isolated)', near(hSolo, A * expectedS, 1e-9), `${hSolo} vs ${A * expectedS}`);
  t.wa[1] = saved123[0]; t.wa[2] = saved123[1]; t.wa[3] = saved123[2];
}

// ---- determinism: same hash on 2 runs ----
{
  const build = () => {
    const t = mkWater([rect('a', { waves: 'storm', seed: 3 }), rect('b', { waves: 'sea', seed: 9 }, )], 'calm');
    return t;
  };
  const t1 = build(), t2 = build();
  t1.setSeaState('storm', 1.5);
  t2.setSeaState('storm', 1.5);
  for (let i = 0; i < 25; i++) { t1.step(); t2.step(); }
  const h1 = createHasher(); t1.hashInto(h1);
  const h2 = createHasher(); t2.hashInto(h2);
  ok('two independently built + stepped clocks hash identically', h1.value() === h2.value(), `${h1.value()} vs ${h2.value()}`);

  const h3 = createHasher(); t1.step(); t1.hashInto(h3);
  ok('one more step changes the hash', h3.value() !== h1.value());
}

// ---- blend continuity: no jump at a setSeaState boundary, and it actually reaches the target ----
{
  const t = mkWater([rect('ocean', { waves: 'sea', seed: 11 })], 'calm');
  const x = 4, y = 4, tick0 = 50;
  const before = waveHeight(t, 0, x, y, tick0);
  t.setSeaState('storm', 2); // 2 s = 120 steps
  const justAfter = waveHeight(t, 0, x, y, tick0); // same tick, before any step() - amplitude must not have jumped
  ok('setSeaState does not change the height before the next step() (ss=0 at the boundary)', near(before, justAfter, 1e-9), `${before} vs ${justAfter}`);

  // Step through the whole blend; the amplitude trajectory must be continuous (no single-step jump bigger than
  // what a full blend step can produce) and must end at the storm amplitude.
  let prevAmpSum = t.wa.slice(0, 4).reduce((a, b) => a + b, 0);
  let maxJump = 0;
  for (let i = 0; i < 120; i++) {
    t.step();
    const ampSum = t.wa.slice(0, 4).reduce((a, b) => a + b, 0);
    maxJump = Math.max(maxJump, Math.abs(ampSum - prevAmpSum));
    prevAmpSum = ampSum;
  }
  const stormSum = WAVE_STATES.storm.reduce((a, b) => a + b, 0);
  const calmSum = WAVE_STATES.calm.reduce((a, b) => a + b, 0);
  ok('blend reaches the storm amplitude after blendSec worth of steps', near(prevAmpSum, stormSum, 1e-9), prevAmpSum);
  ok('blend is smooth: no single step jumps anywhere near the full calm->storm gap', maxJump < (stormSum - calmSum) * 0.1, maxJump);

  // One more step past the end must not move it further (steps clamped at seaSteps).
  const afterEnd = t.wa.slice(0, 4).reduce((a, b) => a + b, 0);
  t.step();
  const stillEnd = t.wa.slice(0, 4).reduce((a, b) => a + b, 0);
  ok('amplitude stays at the target once the blend has finished', near(afterEnd, stillEnd, 1e-9));
}

// ---- save round trip: waterState (tick/from/to/step/steps) + the new region keys through collectWaterDefs ----
{
  const t = mkWater([rect('ocean', { waves: 'sea', waveDirDeg: 30, seed: 11 })], 'breezy');
  t.setSeaState('storm', 1);
  for (let i = 0; i < 17; i++) t.step();
  const saved = t.saveState();
  ok('saveState shape', typeof saved.tick === 'number' && saved.from.length === 4 && saved.to.length === 4 && typeof saved.step === 'number' && typeof saved.steps === 'number');

  const t2 = mkWater([rect('ocean', { waves: 'sea', waveDirDeg: 30, seed: 11 })], 'breezy');
  t2.loadState(saved);
  ok('loadState restores tick', t2.tick === t.tick);
  ok('loadState restores the sea blend progress (same live amplitude, continuous bob)', near(t2.wa[0], t.wa[0]) && near(t2.wa[1], t.wa[1]) && near(t2.wa[2], t.wa[2]) && near(t2.wa[3], t.wa[3]));
  ok('loadState restores height exactly (bob continuous across a load)', near(waveHeight(t2, 0, 7, 7, t2.tick), waveHeight(t, 0, 7, 7, t.tick)));

  const h1 = createHasher(); t.hashInto(h1);
  const h2 = createHasher(); t2.hashInto(h2);
  ok('loaded clock hashes identically to the original', h1.value() === h2.value());

  // Region keys (waves/waveDirDeg/seed) round-trip through collectWaterDefs, same convention as flow/flowRadial.
  const defs = collectWaterDefs({ water: [rect('ocean', { waves: 'sea', waveDirDeg: 30, seed: 11 })] }, []);
  ok('region keys round trip', defs[0].waves === 'sea' && defs[0].waveDirDeg === 30 && defs[0].seed === 11);
}

console.log(`waves.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
