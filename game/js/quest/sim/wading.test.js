// RIVER-01b (OB-019, architecture.md 38.45 (3)): body push field, wading slowdown, deep wall, stones dry, arrow drift, 0 alloc.
// Run: node game/js/quest/sim/wading.test.js  (0-alloc probes: wading.alloc.test.js)
// Stub mesh world over the real river water query: bed(x, y) below.
import { createWater, collectWaterDefs, World, integrate, PHYSICS } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { BOW_CFG } from '../bowConfig.js';
import { createTargetables } from './targetables.js';
import { createArrowSim } from './arrows.js';
import { createWading } from './wading.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const dt = 1 / 60;

// River along +x at z 10 (flat), halfW 30, v 1.0 (mid-channel). Default bed 9.6 (0.4 m); ramps down 0.2 m/m between y 8 and 12 to 8.8 (1.2 m); imm > 1.0 from y 11;
// stone at x 40..42, |y| <= 1 (top 10.3, above the surface).
const WALL = 120;
function mkWorld(bedFn) {
  const bed = bedFn || ((x, y) => (x >= 40 && x <= 42 && Math.abs(y) <= 1 ? 10.3 : y <= 8 ? 9.6 : y >= 12 ? 8.8 : 9.6 - 0.2 * (y - 8)));
  const w = new World();
  w.water = createWater(collectWaterDefs({ water: [{ id: 'r', shape: 'river', path: [[0, 0, 10, 30, 1], [60, 0, 10, 30, 1], [120, 0, 10, 30, 1], [180, 0, 10, 30, 1], [240, 0, 10, 30, 1]] }] }, []));
  w.physicsMode = 'mesh';
  const sup = { floorH: 0, ceilH: 'sky', terrain: false, slope: false, nx: 0, ny: 0, nz: 1 };
  w.supportAt = (x, y) => { sup.floorH = bed(x, y); return sup; };
  w.floorAt = (x, y) => bed(x, y);
  w.collideCircle = (x, y, dx, dy, r, z, g, o, out) => {
    out.x = x + dx; out.y = y + dy; out.blockedX = false; out.blockedY = false; out.nx = 0; out.ny = 0;
    if (out.x > WALL) { out.x = WALL; out.blockedX = true; }
    return out;
  };
  w.bedFn = bed;
  return w;
}
const mkEnt = (w, x, y) => ({ id: 'e', transform: { x, y, z: w.bedFn(x, y), yawDeg: 90, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } });
const idle = { forward: 0, strafe: 0 }, walkE = { forward: 1, strafe: 0, yawDeg: 90 }, south = { forward: -1, strafe: 0, yawDeg: 0 };
function step(wd, w, e, c) { wd.before(e); integrate(e, dt, c, w, PHYSICS); wd.after(e); }
const flatBed = (z) => () => z;

// ---- push follows the flow, scales with depth ----
{
  const w = mkWorld(), wd = createWading(w), e = mkEnt(w, 5, 0);
  for (let i = 0; i < 60; i++) step(wd, w, e, idle);
  // imm 0.4 -> k 0.444, push = 1.0 * 0.7 * 0.444 = 0.311 m/s
  ok('push moves a still body downstream (+x) ~0.31 m/s', e.transform.x > 5.25 && e.transform.x < 5.4 && near(e.transform.y, 0, 1e-9));
  ok('push direction = flow tangent (pushY 0 on a +x river)', near(e.components.body.pushY, 0, 1e-9) && e.components.body.pushX > 0);
  const w3 = mkWorld(flatBed(9.2)), e3 = mkEnt(w3, 5, 0); createWading(w3).before(e3);
  const eA = mkEnt(w, 5, 0); createWading(w).before(eA);
  ok('push scales with depth (imm 0.8 > imm 0.4)', e3.components.body.pushX > eA.components.body.pushX * 1.5);
  const w4 = mkWorld(flatBed(9.2)); { const ra = w4.riverAt.bind(w4); w4.riverAt = (x, y, o) => { const r = ra(x, y, o); o.fx = 40; o.fy = 0; return r; }; }
  const e4 = mkEnt(w4, 5, 0); createWading(w4).before(e4);
  ok('push capped at 3 m/s', near(e4.components.body.pushX, 3));
  const w5 = mkWorld(), wd5 = createWading(w5), e5 = mkEnt(w5, 5, 0); e5.transform.y = 20; e5.transform.z = 9.6; // mid vs bank flow: faster mid-channel
  const eMid = mkEnt(w5, 5, 0), eBank = mkEnt(w5, 5, 0); eBank.transform.y = 8;
  wd5.before(eMid); wd5.before(eBank);
  ok('current faster mid-channel than at the bank', eMid.components.body.pushX > eBank.components.body.pushX);
}
// ---- integrate: push 1 m/s on flat = 1 m/s; a wall stops it ----
{
  const w = mkWorld(), e = mkEnt(w, 100, 0);
  for (let i = 0; i < 60; i++) { e.components.body.pushX = 1; integrate(e, dt, idle, w, PHYSICS); }
  ok('integrate: pushX 1 m/s moves 1 m in 1 s', near(e.transform.x, 101, 1e-6));
  const e2 = mkEnt(w, 119, 0);
  for (let i = 0; i < 120; i++) { e2.components.body.pushX = 1; integrate(e2, dt, idle, w, PHYSICS); }
  ok('integrate: wall stops the push', near(e2.transform.x, WALL, 1e-9));
  const e3 = mkEnt(w, 5, 0); for (let i = 0; i < 30; i++) integrate(e3, dt, idle, w, PHYSICS);
  ok('integrate: no push -> no move (default 0)', near(e3.transform.x, 5, 1e-12) && e3.components.body.pushX === 0);
}
// ---- wading speed by depth ----
{
  const w = mkWorld(), wd = createWading(w);
  const e = mkEnt(w, 5, 0); wd.before(e);
  ok('imm 0.4 -> speedScale 1 - 0.5*0.444', near(e.components.body.speedScale, 1 - 0.5 * (0.4 / 0.9), 1e-9));
  const w2 = mkWorld(flatBed(9.1)), e2 = mkEnt(w2, 5, 0); createWading(w2).before(e2);
  ok('imm 0.9 -> speedScale 0.5', near(e2.components.body.speedScale, 0.5, 1e-9));
  const e3 = mkEnt(w, 5, 0); wd.before(e3, 0.3);
  ok('lower other speedScale (0.3) wins', near(e3.components.body.speedScale, 0.3, 1e-9));
  const wet = mkEnt(w, 5, 0);
  for (let i = 0; i < 120; i++) step(wd, w, wet, walkE);
  const dw = mkWorld(); dw.water = createWater([]);
  const d = mkEnt(dw, 5, 0); for (let i = 0; i < 120; i++) integrate(d, dt, walkE, dw, PHYSICS);
  const sw = wet.transform.x - 5, sd = d.transform.x - 5;
  ok(`wading 2 s: slower than dry land, current adds some (${sw.toFixed(2)} vs ${sd.toFixed(2)} m)`, sw < sd && sw > 0.5 * sd);
  const e4 = mkEnt(w, 5, 0); e4.transform.y = 50; wd.before(e4);
  ok('outside water: speedScale = other, push 0', e4.components.body.speedScale === 1 && e4.components.body.pushX === 0);
}
// ---- deep wall is gone (SWIM-03b): a walker crosses y > 10 into deep water and swims ----
{
  const w = mkWorld(), wd = createWading(w), e = mkEnt(w, 5, 5);
  let maxY = 0;
  for (let i = 0; i < 240; i++) { wd.before(e); e.components.body.waterZ = 10; e.components.body.waterFloorZ = w.bedFn(e.transform.x, e.transform.y); integrate(e, dt, south, w, PHYSICS); wd.after(e); maxY = Math.max(maxY, e.transform.y); }
  ok('no deep wall: walks past y 11 (imm > 1.0)', maxY > 12, maxY);
  ok('no deep wall: swimming (feet on the 1.2 m bed)', e.components.body.swimming === true, e.transform.z);
  const sw = mkEnt(w, 5, 20); sw.components.body.swimming = true; sw.components.body.pushX = 9;
  wd.before(sw);
  ok('wading.before backs off while swimming (speedScale = other, no push)', sw.components.body.speedScale === 1 && sw.components.body.pushX === 0 && sw.components.body.wadeImm === 0);
  const dp = mkEnt(createWading(mkWorld(flatBed(8.8))) && w, 5, 20); wd.before(dp);
  ok('deep spawn: no bank push, no rescue flag', dp.components.body.wadeRescue === undefined && dp.components.body.pushX >= 0 && Math.abs(dp.components.body.pushY) < 1e-9);
}
// ---- stones dry ----
{
  const w = mkWorld(), wd = createWading(w), e = mkEnt(w, 41, 0); // stone top 10.3 > surface 10
  wd.before(e);
  ok('stone above the surface: speedScale 1, push 0', e.components.body.speedScale === 1 && e.components.body.pushX === 0 && e.components.body.pushY === 0);
}
// ---- arrows ----
{
  const w = mkWorld(flatBed(9.6)); // flat bed: the sloped stub bed boxes its own doubles (harness noise)
  w.raySegment = (ax, ay, az, bx, by, bz, out) => { // the river bed as terrain (z = 9.6)
    if (bz > 9.6) return false;
    const t = (az - 9.6) / (az - bz);
    out.t = t; out.x = ax + (bx - ax) * t; out.y = ay + (by - ay) * t; out.z = 9.6; return true;
  };
  w.state = {}; w.forEachEntity = () => {};
  const events = { on() { return () => {}; }, emit() {} };
  const tg = createTargetables(w, events), sim = createArrowSim(w, events, BOW_CFG, tg);
  sim.fire(5, 0, 12, 0, 0, -1, 0, 1);
  for (let i = 0; i < 20 && sim.floatCount === 0; i++) sim.step();
  ok('arrow landing in river water floats (not stuck)', sim.floatCount === 1 && sim.stuckCount === 0 && sim.flyingCount === 0);
  const k = sim.floaters.alive.indexOf(1);
  ok('floater sits just under the surface', near(sim.floaters.z[k], 10 - BOW_CFG.floatDraft, 1e-9));
  const x0 = sim.floaters.x[k];
  for (let i = 0; i < 60; i++) sim.step();
  ok('floater drifts with the current (~1 m/s)', sim.floaters.x[k] - x0 > 0.9 && sim.floaters.x[k] - x0 < 1.1 && near(sim.floaters.y[k], 0, 1e-9));
  for (let i = 0; i < 480; i++) sim.step();
  ok('floater gone after 8 s', sim.floatCount === 0);
  sim.fire(5, 50, 12, 0, 0, -1, 0, 1); // dry land: sticks as before
  for (let i = 0; i < 20; i++) sim.step();
  ok('arrow outside the river still sticks', sim.floatCount === 0 && sim.stuckCount === 1);
  for (let r = 0; r < 4; r++) { sim.fire(5, 0, 12, 0, 0, -1, 0, 1); for (let i = 0; i < 500; i++) sim.step(); } // tier-up the float path first
  // 0-alloc probes of the floater + wading+integrate live in wading.alloc.test.js (own isolate: this file's mixed body shapes inflate them)
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
