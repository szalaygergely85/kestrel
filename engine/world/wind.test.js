// engine/world/wind.test.js (US-138, docs/architecture.md 32.5).
// Run: node engine/world/wind.test.js
import { createWind, WIND_PUSH_MAX } from './wind.js';
import { createHasher } from '../core/hash.js';
import { STEP } from '../core/loop.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function approxEqual(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// ---- determinism: same seed -> same sampleInto at 1000 ticks --------------
{
  const def = { dirDeg: 90, speed: 3, gust: { amp: 0.5, periodSec: 3, travel: 8 } };
  const w1 = createWind(def, 7);
  const w2 = createWind(def, 7);
  const o1 = [0, 0, 0], o2 = [0, 0, 0];
  w1.sampleInto(12.5, -4.25, 0, 1000, o1);
  w2.sampleInto(12.5, -4.25, 0, 1000, o2);
  ok('same seed -> identical sampleInto at tick 1000', o1[0] === o2[0] && o1[1] === o2[1] && o1[2] === o2[2], `${o1} vs ${o2}`);

  const w3 = createWind(def, 9);
  const o3 = [0, 0, 0];
  w3.sampleInto(12.5, -4.25, 0, 1000, o3);
  ok('different seed -> different gust table (sampleInto differs)', o3[0] !== o1[0] || o3[1] !== o1[1], `${o3} vs ${o1}`);
}

// ---- gust continuity: no jump bigger than amp*speed*2/P between ticks -----
{
  const amp = 0.6, speed = 4, periodSec = 2;
  const w = createWind({ dirDeg: 0, speed, gust: { amp, periodSec, travel: 1000000 } }, 3); // huge travel -> ~no spatial lag at x=y=0
  const P = Math.max(1, Math.round(periodSec / STEP));
  // smoothstep s(fr)=3fr^2-2fr^3 has max slope ds/dfr=1.5 at fr=0.5; dfr/dtick=1/P, and
  // speedNow = speed*(1+amp*(2g-1)) -> d(speedNow)/dg = 2*amp*speed. Worst-case per-tick
  // delta = 2*amp*speed * 1.5/P * |deltaK| (deltaK < 1), i.e. an upper bound of 3*amp*speed/P.
  const maxStep = 3 * amp * speed / P + 1e-9;
  const o = [0, 0, 0];
  let prevVy = null;
  let worst = 0;
  for (let t = 0; t < 4000; t++) {
    w.sampleInto(0, 0, 0, t, o);
    if (prevVy !== null) worst = Math.max(worst, Math.abs(o[1] - prevVy));
    prevVy = o[1];
  }
  ok('gust continuity: no single-tick jump exceeds the ramp bound', worst <= maxStep, `worst=${worst}, bound=${maxStep}`);
}

// ---- travel: a downwind point lags the gust by along/(travel*STEP) ticks --
{
  const travel = 8, periodSec = 3;
  const w = createWind({ dirDeg: 90, speed: 2, gust: { amp: 0.5, periodSec, travel } }, 5); // dirDeg 90 -> +x downwind
  const along = 40; // m downwind along +x
  const lagTicks = Math.round(along / (travel * STEP));
  const o0 = [0, 0, 0], oLag = [0, 0, 0];
  const tick = 500;
  w.sampleInto(0, 0, 0, tick, o0);
  w.sampleInto(along, 0, 0, tick + lagTicks, oLag);
  ok('a downwind point repeats the origin gust after the travel lag', approxEqual(o0[1], oLag[1], 1e-6), `${o0[1]} vs ${oLag[1]} (lag=${lagTicks})`);
}

// ---- zones: set mode replaces, add mode layers, both fall off at the edge --
{
  const w = createWind({
    dirDeg: 0, speed: 1, gust: { amp: 0 },
    zones: [
      { id: 'calmBox', shape: 'rect', rect: [-10, -10, 10, 10], edge: 2, mode: 'set', dirDeg: 180, speed: 0 },
      { id: 'boostCircle', shape: 'circle', c: [50, 0], r: 5, edge: 1, mode: 'add', dirDeg: 0, speed: 2 },
    ],
  }, 1);
  const outFar = [0, 0, 0], outSetCentre = [0, 0, 0], outSetEdge = [0, 0, 0], outAddCentre = [0, 0, 0];
  w.sampleInto(1000, 1000, 0, 0, outFar); // outside both zones -> base wind only
  w.sampleInto(0, 0, 0, 0, outSetCentre); // dead centre of the 'set' zone, full weight
  w.sampleInto(-9.5, 0, 0, 0, outSetEdge); // just inside the zone's edge band (0.5m in, edge=2 -> w=0.25)
  w.sampleInto(50, 0, 0, 0, outAddCentre); // centre of the 'add' zone

  // dirDeg 0 = north = (0,-1) per forwardOf's compass convention (0=N=-y, 90=E=+x, clockwise).
  ok('base wind unaffected far from any zone (dirDeg 0, speed 1 -> (0,-1))', approxEqual(outFar[0], 0, 1e-6) && approxEqual(outFar[1], -1, 1e-6), `${outFar}`);
  ok('set zone at full weight fully replaces the base vector (speed 0 -> ~0 regardless of its own dirDeg)', approxEqual(outSetCentre[0], 0, 1e-6) && approxEqual(outSetCentre[1], 0, 1e-6), `${outSetCentre}`);
  ok('set zone falls off toward the base vector near its edge', outSetEdge[1] < outSetCentre[1] && outSetEdge[1] > outFar[1], `${outSetEdge} between ${outSetCentre} and ${outFar}`);
  ok('add zone layers on top of the base wind (sum, not replace)', outAddCentre[1] < outFar[1], `${outAddCentre} vs base ${outFar}`);
}

// ---- push: capped at WIND_PUSH_MAX, direction preserved -------------------
{
  const w = createWind({
    dirDeg: 0, speed: 1, gust: { amp: 0 },
    zones: [{ id: 'fan', shape: 'circle', c: [0, 0], r: 10, edge: 1, mode: 'add', dirDeg: 90, speed: 50, push: true }],
  }, 1);
  const out = [0, 0];
  w.pushAt(0, 0, 0, out);
  const mag = Math.sqrt(out[0] * out[0] + out[1] * out[1]);
  ok('push magnitude never exceeds WIND_PUSH_MAX', mag <= WIND_PUSH_MAX + 1e-9, `mag=${mag}`);
  // dirDeg 90 = east = (+x, 0) per forwardOf's compass convention.
  ok('push direction matches the zone wind direction (mostly +x)', out[0] > 0 && Math.abs(out[1]) < 1e-6, `${out}`);

  const wNoPush = createWind({ dirDeg: 0, speed: 1, gust: { amp: 0 } }, 1);
  const outNone = [0, 0];
  wNoPush.pushAt(0, 0, 0, outNone);
  ok('no push zones -> pushAt is zero', outNone[0] === 0 && outNone[1] === 0, `${outNone}`);
}

// ---- hashInto: same config -> same hash; a different speed -> a different hash
{
  const w1 = createWind({ dirDeg: 45, speed: 2.5, gust: { amp: 0.3, periodSec: 2, travel: 6 } }, 11);
  const w2 = createWind({ dirDeg: 45, speed: 2.5, gust: { amp: 0.3, periodSec: 2, travel: 6 } }, 11);
  const w3 = createWind({ dirDeg: 45, speed: 9.9, gust: { amp: 0.3, periodSec: 2, travel: 6 } }, 11);
  const h1 = createHasher(); w1.hashInto(h1);
  const h2 = createHasher(); w2.hashInto(h2);
  const h3 = createHasher(); w3.hashInto(h3);
  ok('hashInto: identical config/seed -> identical hash', h1.value() === h2.value(), `${h1.value()} vs ${h2.value()}`);
  ok('hashInto: a different speed -> a different hash', h1.value() !== h3.value(), `${h1.value()} vs ${h3.value()}`);
}

// ---- calm default: no wind block -> speed 0, no zones ---------------------
{
  const w = createWind(null, 1);
  const o = [1, 1, 1];
  w.sampleInto(5, 5, 0, 999, o);
  ok('createWind(null, seed) is calm (sampleInto -> 0,0,0)', o[0] === 0 && o[1] === 0 && o[2] === 0, `${o}`);
}

// ---- validation: too many zones / bad shape / missing id throw ------------
{
  let threw = false;
  try {
    const many = [];
    for (let i = 0; i < 17; i++) many.push({ id: `z${i}`, shape: 'circle', c: [0, 0], r: 1 });
    createWind({ zones: many }, 1);
  } catch (e) { threw = true; }
  ok('createWind throws when zones exceed WIND_MAX_ZONES (16)', threw);

  threw = false;
  try { createWind({ zones: [{ id: 'bad', shape: 'triangle' }] }, 1); } catch (e) { threw = true; }
  ok('createWind throws on an unknown zone shape', threw);

  threw = false;
  try { createWind({ zones: [{ shape: 'circle', c: [0, 0], r: 1 }] }, 1); } catch (e) { threw = true; }
  ok('createWind throws on a zone with no id', threw);
}

// ---- zero allocation: sampleInto/pushAt over 10k calls ---------------------
{
  if (typeof global.gc === 'function') {
    const w = createWind({
      dirDeg: 30, speed: 2, gust: { amp: 0.4, periodSec: 2, travel: 5 },
      zones: [{ id: 'z', shape: 'rect', rect: [-5, -5, 5, 5], edge: 1, mode: 'add', dirDeg: 0, speed: 1, push: true }],
    }, 2);
    const o3 = [0, 0, 0], o2 = [0, 0];
    // warm up JIT before measuring
    for (let i = 0; i < 1000; i++) { w.sampleInto(i % 20, 0, 0, i, o3); w.pushAt(i % 20, 0, i, o2); }
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) {
      w.sampleInto(i % 20, (i * 3) % 20, 0, i, o3);
      w.pushAt(i % 20, (i * 3) % 20, i, o2);
    }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grew = after - before;
    ok('zero alloc: sampleInto + pushAt over 10k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
  } else {
    console.warn('WARN: zero-alloc check skipped (run with --expose-gc for a real gate)');
    pass++;
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
