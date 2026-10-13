// engine/physics/swim.test.js (SWIM-03a, architecture.md 38.54). Node: node engine/physics/swim.test.js
// Stub "mesh" world: ground height from a function, so the basin/shelf shapes are exact.
import { integrate } from './integrate.js';
import { PHYSICS } from './config.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const near = (a, b, e, m) => ok(Math.abs(a - b) <= e, `${m}: ${a} vs ${b} (+-${e})`);
const DT = 1 / 60;
const WZ = -1; // water surface

function makeWorld(groundFn) {
  const sup = { floorH: 0, ceilH: 'sky', nz: 1, nx: 0, ny: 0, terrain: false };
  return {
    physicsMode: 'mesh',
    collideCircle(x, y, dx, dy, r, z, g, o, out) { out.x = x + dx; out.y = y + dy; out.blockedX = out.blockedY = false; out.nx = out.ny = 0; return out; },
    supportAt(x, y) { sup.floorH = groundFn(x, y); return sup; },
  };
}
function makeEnt(x, y, z) {
  return { id: 'p', transform: { x, y, z, yawDeg: 90, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6, grounded: true } } };
}
// Feed like the game: water everywhere with floor = ground (when below surface).
function feed(b, w, t, on) {
  if (!on) { b.waterZ = NaN; b.waterFloorZ = NaN; return; }
  const f = w.supportAt(t.x, t.y).floorH;
  if (f < WZ) { b.waterZ = WZ; b.waterFloorZ = f; } else { b.waterZ = NaN; b.waterFloorZ = NaN; }
}
function run(ent, w, n, ctl, water = true, cb) {
  const b = ent.components.body;
  for (let i = 0; i < n; i++) { feed(b, w, ent.transform, water); integrate(ent, DT, ctl, w, PHYSICS); if (cb) cb(i, b); }
}
const FWD = { forward: 1, yawDeg: 90 }; // yaw 90 -> +x

// (2) walk down a ramp into a 3 m deep basin (floor -4, surface -1)
{
  const ground = (x) => x < 0 ? 0 : x < 6 ? -x * 0.5 : -3; // slope then flat; floor -3 -> depth 2... make deeper
  const g2 = (x) => x < 0 ? 0 : x < 8 ? -x * 0.5 : -4;
  const w = makeWorld(g2), e = makeEnt(-1, 0, 0), b = e.components.body;
  let swimAt = -1;
  run(e, w, 60 * 12, FWD, true, (i) => { if (b.swimming && swimAt < 0) swimAt = i; });
  ok(swimAt > 0, 'swimming turned on');
  ok(b.swimming, 'still swimming');
  near(e.transform.z, WZ - 1.25, 0.02, 'feet at floatZ');
  // enter happens when imm > 1.15: feet z < -2.15 -> x > 4.3
  run(e, w, 1, { yawDeg: 90 });
  void ground;
  // settle within 1 s after entering: re-run a fresh body
  const e2 = makeEnt(-1, 0, 0), b2 = e2.components.body; let k = -1;
  run(e2, w, 60 * 12, FWD, true, (i) => { if (k < 0 && Math.abs(e2.transform.z - (WZ - 1.25)) <= 0.02 && b2.swimming) k = i; });
  ok(k > 0, 'settled at float depth'); 
  // 1 s after swimming on:
  const e3 = makeEnt(-1, 0, 0), b3 = e3.components.body; let on = -1, set = -1;
  run(e3, w, 60 * 12, FWD, true, (i) => { if (on < 0 && b3.swimming) on = i; if (set < 0 && b3.swimming && Math.abs(e3.transform.z - (WZ - 1.25)) <= 0.02) set = i; });
  ok(set - on <= 60, `settle within 1 s (${set - on} steps)`);
}

// (3) 10 m fall into water: no landed, fallDistance 0
{
  const w = makeWorld(() => -6), e = makeEnt(0, 0, 9), b = e.components.body;
  b.grounded = false; b.peakZ = 9;
  let landed = false, maxFd = 0;
  run(e, w, 240, null, true, (i, bb) => { if (bb.landed) landed = true; maxFd = Math.max(maxFd, bb.fallDistance || 0); });
  ok(!landed, 'no landed into water'); ok(maxFd === 0, 'fallDistance 0'); ok(b.swimming, 'swimming after fall');
  near(e.transform.z, WZ - 1.25, 0.02, 'settled after fall');
}

// (4) shelf: floor -6 for x<5, then a shelf at surface+0.8 / +1.2
for (const [h, climb] of [[0.8, true], [1.2, false]]) {
  const w = makeWorld((x) => x < 5 ? -6 : WZ + h), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false;
  let climbed = false;
  run(e, w, 60 * 8, FWD, true, (i, bb) => { if (bb.climbedOut) climbed = true; });
  if (climb) { ok(climbed && b.grounded && !b.swimming, 'climbs out +0.8'); near(e.transform.z, WZ + h, 1e-6, 'on ledge'); }
  else { ok(!climbed && b.swimming && e.transform.x < 5.0, `wall at +1.2 (x=${e.transform.x})`); }
}

// (5) current pushes at 0.7 x flow
{
  const w = makeWorld(() => -6), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false;
  run(e, w, 120, null);
  const x0 = e.transform.x;
  for (let i = 0; i < 60; i++) { feed(b, w, e.transform, true); b.pushX = 0.7 * 2; integrate(e, DT, null, w, PHYSICS); }
  near(e.transform.x - x0, 1.4, 0.01, 'current 0.7 * flow 2 m/s over 1 s');
}

// (6) swim 1.8 / fast 2.6
for (const [run_, v] of [[false, 1.8], [true, 2.6]]) {
  const w = makeWorld(() => -6), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false;
  run(e, w, 240, { forward: 1, yawDeg: 90, run: run_ });
  const x0 = e.transform.x; run(e, w, 60, { forward: 1, yawDeg: 90, run: run_ });
  near((e.transform.x - x0), v, v * 0.02, `swim speed ${v}`);
}

// no jump while swimming
{
  const w = makeWorld(() => -6), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false; run(e, w, 120, null);
  run(e, w, 30, { jump: true });
  ok(!b.jumped && b.swimming, 'no jump in water');
}

// (1) NaN water == never fed (bit-identical) on a walk/jump/fall scripted run
{
  const g = (x) => x > 6 ? 1.0 : 0;
  const sig = (feedNaN) => {
    const w = makeWorld(g), e = makeEnt(0, 0, 0), b = e.components.body; let h = 0;
    for (let i = 0; i < 600; i++) {
      if (feedNaN) { b.waterZ = NaN; b.waterFloorZ = NaN; }
      integrate(e, DT, { forward: 1, yawDeg: 90 + (i % 90), run: i % 200 < 100, jump: i % 70 === 0 }, w, PHYSICS);
      h = (h * 31 + Math.round(e.transform.x * 1e9) + Math.round(e.transform.z * 1e9) * 7 + Math.round(b.vx * 1e9)) | 0;
    }
    return h;
  };
  ok(sig(true) === sig(false), 'NaN water identical to unfed');
  ok(sig(false) === sig(false), 'deterministic');
}

// (8) SWIM-04a diving: 10 m basin, dive to bottom, onBottom, rise, hysteresis, ceiling
{
  const FL = -11; // surface -1, depth 10
  const w = makeWorld(() => FL), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false;
  run(e, w, 60, {});
  ok(b.swimming && !b.diving, 'surface: swimming, not diving');
  run(e, w, 30, { swimUp: 0 });
  ok(!b.diving && !b.onBottom, 'no input stays at surface');
  let diveAt = -1, t0 = 0;
  run(e, w, 60 * 12, { swimUp: -1 }, true, (i, bb) => { if (bb.diving && diveAt < 0) diveAt = i; if (bb.onBottom && !t0) t0 = i; });
  ok(diveAt >= 0 && diveAt < 40, `diving turns on early (${diveAt})`);
  ok(b.onBottom && b.diving && b.swimming, 'on bottom, still swimming/diving');
  near(e.transform.z, FL, 1e-6, 'rests on the bottom');
  ok(t0 > 60 * 4 && t0 < 60 * 9, `bottom reached in a plausible time (${t0} steps)`);
  // release: slow float up at buoyRise, onBottom off, then surface lock
  run(e, w, 30, {});
  ok(!b.onBottom && e.transform.z > FL, 'released: rises');
  near(b.vz, PHYSICS.swim.buoyRise, 0.05, 'rises at buoyRise');
  run(e, w, 60 * 40, {});
  near(e.transform.z, WZ - 1.25, 1e-6, 'back at the surface lock');
  ok(!b.diving && b.swimming, 'diving off at the surface');
  // swimUp +1 under water rises faster than buoyRise, never above floatZ
  run(e, w, 90, { swimUp: -1 });
  ok(b.diving, 'dives again');
  run(e, w, 60, { swimUp: 1 });
  ok(b.vz > 0.5, `swimUp rises (${b.vz})`);
  run(e, w, 60 * 10, { swimUp: 1 });
  ok(e.transform.z <= WZ - 1.25 + 1e-9, 'never above floatZ');
  // hysteresis: eye within +-0.05 of the surface keeps the previous flag
  b.diving = true; e.transform.z = WZ - 1.6 + 0.0; // eye == surface
  b.vz = 0; run(e, w, 1, { swimUp: 1 });
  ok(b.diving, 'inside the band the flag holds (on)');
  // ceiling clamp: bridge 1 m under the surface line must stop the rise
  const wc = makeWorld(() => FL); const sup = wc.supportAt; wc.supportAt = (x, y) => { const s = sup(x, y); s.ceilH = -4; return s; };
  const ec = makeEnt(0, 0, -8), bc = ec.components.body; bc.grounded = false;
  run(ec, wc, 60, {}); bc.diving = true;
  run(ec, wc, 60 * 6, { swimUp: 1 });
  ok(ec.transform.z <= -4 - 1.7 + 1e-9, `ceiling clamp (z ${ec.transform.z})`);
  // swimUp without water or on land is ignored
  const ed = makeEnt(0, 0, 0), wd = makeWorld(() => 0);
  run(ed, wd, 30, { swimUp: -1 }, false);
  ok(!ed.components.body.diving && ed.components.body.grounded, 'no water: swimUp ignored');
}

// (7) 0 alloc over 10k steps (heap delta, with gc if available)
{
  const w = makeWorld((x) => x < 5 ? -6 : WZ + 0.8), e = makeEnt(0, 0, -2.25), b = e.components.body;
  b.grounded = false;
  const step = (i) => { feed(b, w, e.transform, true); integrate(e, DT, { forward: Math.sin(i * 0.01), swimUp: Math.sin(i * 0.003), strafe: Math.cos(i * 0.02), yawDeg: i % 360 }, w, PHYSICS); };
  for (let i = 0; i < 2000; i++) step(i);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) step(i);
  if (global.gc) global.gc();
  const d = process.memoryUsage().heapUsed - h0;
  ok(d < (global.gc ? 200000 : 1500000), `0 alloc (heap delta ${d} B)`);
}

console.log(fail ? `FAIL ${fail}` : `ALL PASS (${pass})`);
process.exit(fail ? 1 : 0);
