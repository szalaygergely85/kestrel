// game/js/quest/sim/arrows.test.js (EQ-08, docs/architecture.md 38.41). Headless Node ESM.
// Run: node game/js/quest/sim/arrows.test.js  (re-runs itself with --expose-gc for the 0-alloc gate)
// Stub world = exact thin planes (a slab = two planes), like fireball.test.js; targets are plain entities.
import { createHasher } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOW_CFG } from '../bowConfig.js';
import { createTargetables } from './targetables.js';
import { createArrowSim, arrowDamage } from './arrows.js';
import { ensureInventory, countOf } from './inventory.js';

if (typeof global.gc !== 'function') { // the 0-alloc check needs gc: re-run self with --expose-gc
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Walls = list of x planes (first one hit along +x/-x wins). */
function stubWorld(entities, planes) {
  return {
    state: {},
    forEachEntity(fn) { entities.forEach(fn); },
    raySegment(ax, ay, az, bx, by, bz, out) {
      const dx = bx - ax;
      if (Math.abs(dx) < 1e-12) return false;
      let best = 2;
      for (const wx of planes) {
        const t = (wx - ax) / dx;
        if (t > 0 && t <= 1 && t < best) best = t;
      }
      if (best > 1) return false;
      out.t = best; out.x = ax + dx * best; out.y = ay + (by - ay) * best; out.z = az + (bz - az) * best;
      return true;
    },
  };
}
function makeEvents() {
  const log = { hits: [] };
  const events = { on() { return () => {}; }, emit(n, p) { if (n === 'combat:hit') log.hits.push({ ...p }); } };
  return { events, log };
}
const mkTarget = (id, x, y, z = 0, r = 0.4, h = 1.6) => ({ id, transform: { x, y, z }, components: { targetable: { radius: r, height: h }, health: { hp: 4, max: 4 } } });
function rig({ planes = [], targets = [] } = {}) {
  const world = stubWorld(targets, planes);
  const { events, log } = makeEvents();
  const tg = createTargetables(world, events);
  const sim = createArrowSim(world, events, BOW_CFG, tg);
  return { world, events, log, tg, sim };
}
const run = (r, n) => { for (let i = 0; i < n; i++) r.sim.step(); };
const dt = 1 / 60;

// ---- speed by draw -------------------------------------------------------------------------------------------------
{
  const r = rig();
  r.sim.fire(0, 0, 100, 1, 0, 0, 0, 1); r.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); r.sim.fire(0, 0, 100, 1, 0, 0, 0.5, 1);
  const f = r.sim.flying;
  ok('draw 0 = 20 m/s, draw 1 = 45 m/s, draw .5 = 32.5', f.vx[0] === 20 && f.vx[1] === 45 && f.vx[2] === 32.5, `${f.vx[0]} ${f.vx[1]} ${f.vx[2]}`);
}

// ---- trajectory: semi-implicit drop and range ----------------------------------------------------------------------
{
  const r = rig();
  r.sim.fire(0, 0, 50, 1, 0, 0, 0, 1);
  const n = 30; run(r, n);
  const expZ = 50 - 9.8 * dt * dt * n * (n + 1) / 2, expX = 20 * dt * n;
  ok('drop after 30 steps = semi-implicit closed form', Math.abs(r.sim.flying.z[0] - expZ) < 1e-9 && Math.abs(r.sim.flying.x[0] - expX) < 1e-9, `z=${r.sim.flying.z[0]} exp ${expZ}`);
  // range from 1.6 m eye height at full draw vs the analytic parabola (x = v * sqrt(2h/g)), within 2 %
  const q = rig();
  q.sim.fire(0, 0, 1.6, 1, 0, 0, 1, 1);
  let px = 0, pz = 1.6, rangeX = -1;
  for (let i = 0; i < 100 && rangeX < 0; i++) {
    q.sim.step();
    const nz = q.sim.flying.z[0];
    if (nz <= 0) { const f = pz / (pz - nz); rangeX = px + (q.sim.flying.x[0] - px) * f; }
    px = q.sim.flying.x[0]; pz = nz;
  }
  const analytic = 45 * Math.sqrt(2 * 1.6 / 9.8);
  ok('range within 2 % of the analytic parabola', rangeX > 0 && Math.abs(rangeX - analytic) / analytic < 0.02, `${rangeX} vs ${analytic}`);
  ok('arrow lost after maxFlightSteps (240)', (() => { const e = rig(); e.sim.fire(0, 0, 1e6, 1, 0, 0, 0, 1); run(e, 240); const a = e.sim.flyingCount; run(e, 1); return a === 1 && e.sim.flyingCount === 0; })());
}

// ---- hits a beast ----------------------------------------------------------------------------------------------------
{
  const beast = mkTarget('boar1', 10, 0);
  const r = rig({ targets: [beast] });
  r.sim.fire(0, 0, 0.8, 1, 0, 0, 1, 3);
  run(r, 20);
  ok('beast hit: one combat:hit, damage 3, cause arrow, source player', r.log.hits.length === 1 && r.log.hits[0].target === 'boar1' && r.log.hits[0].damage === 3 && r.log.hits[0].cause === 'arrow' && r.log.hits[0].source === 'player', JSON.stringify(r.log.hits));
  ok('hit direction +x, arrow consumed (none stuck)', r.log.hits[0].dirX === 1 && r.sim.flyingCount === 0 && r.sim.stuckCount === 0);
  ok('damage by draw 1..3x sword (2): 2 / 4 / 6', arrowDamage(2, 0) === 2 && arrowDamage(2, 0.5) === 4 && arrowDamage(2, 1) === 6 && arrowDamage(0, 0) === 1);
  const dead = mkTarget('boar2', 10, 0); dead.components.health.hp = 0;
  const d = rig({ targets: [dead] }); d.sim.fire(0, 0, 0.8, 1, 0, 0, 1, 3); run(d, 20);
  ok('a dead beast is not hit', d.log.hits.length === 0);
  const hi = rig({ targets: [mkTarget('b', 10, 0)] }); hi.sim.fire(0, 0, 3, 1, 0, 0, 1, 3); run(hi, 20);
  ok('an arrow flying over the beast misses', hi.log.hits.length === 0);
}

// ---- sticks into a wall; no tunnelling of a 0.3 m wall at 45 m/s ---------------------------------------------------------
{
  const r = rig({ planes: [10, 10.3] });
  for (let i = 0; i < 4; i++) { r.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); } // all 4 reach the wall at different offsets? same: only one slot each
  run(r, 40);
  const st = r.sim.stuck;
  let k = 0; while (k < st.n && !st.alive[k]) k++;
  ok('4 arrows stuck before the 0.3 m wall (x < 10)', r.sim.stuckCount === 4 && st.x[k] < 10 && st.x[k] > 9.9 && r.sim.flyingCount === 0, `n=${r.sim.stuckCount} x=${st.x[k]}`);
  ok('stuck direction is the unit flight direction', Math.abs(st.dx[k] - 1) < 0.01 && Math.abs(Math.hypot(st.dx[k], st.dy[k], st.dz[k]) - 1) < 1e-9);
  // arbitrary start offsets so the step lands everywhere relative to the wall
  let tunnelled = 0;
  for (let o = 0; o < 50; o++) {
    const q = rig({ planes: [10, 10.3] });
    q.sim.fire(0.015 * o - 0.4, 0, 100, 1, 0, 0, 1, 1); run(q, 40);
    let kk = 0; while (kk < q.sim.stuck.n && !q.sim.stuck.alive[kk]) kk++;
    if (!(q.sim.stuckCount === 1 && q.sim.stuck.x[kk] < 10)) tunnelled++;
  }
  ok('no tunnelling over 50 start offsets', tunnelled === 0, `${tunnelled}`);
}

// ---- pick-up returns to quiver/pack, caps ------------------------------------------------------------------------------
{
  const defs = {
    arrow: { id: 'arrow', name: 'Arrow', kind: 'ammo', stackMax: 30, equip: { slot: 'quiver', tier: 'worn', def: 0 } },
    'arrow.big': { id: 'arrow.big', name: 'Big', kind: 'ammo', stackMax: 50, equip: { slot: 'quiver', tier: 'fine', def: 0 } },
  };
  const r = rig({ planes: [5] });
  const player = { components: {} };
  const inv = ensureInventory(player, { pack: [], left: null, right: null });
  const eq = { quiver: { id: 'arrow', n: 3 } };
  // finite arrows: shoot decrements only on success, refuses at 0
  ok('shoot takes one arrow', r.sim.shoot(eq, 0, 0, 100, 1, 0, 0, 1, 1) === true && eq.quiver.n === 2);
  eq.quiver.n = 0;
  ok('cannot shoot at 0 arrows (nothing flies)', r.sim.shoot(eq, 0, 0, 100, 1, 0, 0, 1, 1) === false && eq.quiver.n === 0 && r.sim.flyingCount === 1);
  ok('cannot shoot with no quiver', r.sim.shoot({ quiver: null }, 0, 0, 100, 1, 0, 0, 1, 1) === false);
  run(r, 10);
  ok('arrow stuck at the wall', r.sim.stuckCount === 1);
  // find a pickable serial by firing more
  const stick = (n) => { for (let i = 0; i < n; i++) { r.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(r, 8); } };
  stick(9);
  const pickable = () => { let c = 0; for (let k = 0; k < r.sim.stuck.n; k++) if (r.sim.stuck.alive[k] && r.sim.stuck.pickable[k]) c++; return c; };
  const total = pickable();
  ok('pick-up out of reach takes nothing', r.sim.pickup(-50, 0, 100, 2, { inv, eq, defs }) === 0);
  const got = r.sim.pickup(5, 0, 100, 3, { inv, eq, defs });
  ok('pick-up refills the quiver (pickable ones only)', got === total && got > 0 && eq.quiver.n === got && r.sim.stuckCount === 10 - got, `got=${got} total=${total} q=${eq.quiver.n}`);
  // quiver at cap -> pack
  const r2 = rig({ planes: [5] });
  for (let i = 0; i < 8; i++) { r2.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(r2, 8); }
  const eq2 = { quiver: { id: 'arrow', n: 30 } };
  const g2 = r2.sim.pickup(5, 0, 100, 3, { inv, eq: eq2, defs });
  ok('full quiver (30) -> the arrows go to the pack', g2 > 0 && eq2.quiver.n === 30 && countOf(inv, 'arrow') === g2, `g2=${g2}`);
  const eq3 = { quiver: { id: 'arrow.big', n: 30 } };
  const r3 = rig({ planes: [5] });
  for (let i = 0; i < 8; i++) { r3.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(r3, 8); }
  const g3 = r3.sim.pickup(5, 0, 100, 3, { inv, eq: eq3, defs });
  ok('big quiver cap 50: 30 + picked up', eq3.quiver.n === 30 + g3 && g3 > 0);
  // E key path
  const r4 = rig({ planes: [5] });
  for (let i = 0; i < 6; i++) { r4.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(r4, 8); }
  const near = r4.sim.nearestPickable(4, 0, 100, 2);
  ok('nearestPickable + take frees the slot once', near >= 0 && r4.sim.take(near) === true && r4.sim.take(near) === false);
  ok('nearestPickable out of reach = -1', r4.sim.nearestPickable(-50, 0, 100, 2) === -1);
}

// ---- pools: full flying refuses, stuck recycles the oldest, expiry, 70 % ------------------------------------------------------
{
  const r = rig();
  let all = true;
  for (let i = 0; i < 8; i++) all = all && r.sim.fire(0, 0, 100, 1, 0, 0, 0, 1);
  ok('8 flying fit, the 9th is refused (false)', all && r.sim.fire(0, 0, 100, 1, 0, 0, 0, 1) === false && r.sim.flyingCount === 8);

  const w = rig({ planes: [5] });
  for (let i = 0; i < 16; i++) { w.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(w, 8); }
  ok('16 stuck fill the pool', w.sim.stuckCount === 16);
  const oldest = (() => { let k = 0; for (let i = 1; i < 16; i++) if (w.sim.stuck.age[i] > w.sim.stuck.age[k]) k = i; return k; })();
  const oldSerial = w.sim.stuck.serial[oldest];
  w.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(w, 8);
  ok('the 17th recycles the oldest slot (pool stays 16)', w.sim.stuckCount === 16 && w.sim.stuck.serial[oldest] === 17 && oldSerial === 1, `serial=${w.sim.stuck.serial[oldest]}`);

  const e = rig({ planes: [5] });
  e.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(e, 10);
  const age0 = e.sim.stuck.age[0];
  run(e, 1800 - age0 - 1);
  const still = e.sim.stuckCount; run(e, 1);
  ok('stuck arrow expires at 1800 steps', still === 1 && e.sim.stuckCount === 0, `${still} ${e.sim.stuckCount}`);

  // 70 % pickable over 1000 serials (+-3)
  const p = rig({ planes: [5] });
  let pk = 0;
  for (let i = 0; i < 1000; i++) {
    p.sim.fire(0, 0, 100, 1, 0, 0, 1, 1); run(p, 8);
    let k = 0; for (let j = 0; j < 16; j++) if (p.sim.stuck.serial[j] === i + 1) k = j;
    if (p.sim.stuck.pickable[k]) pk++;
  }
  ok('70 % pickable over 1000 serials (+-3 %)', Math.abs(pk - 700) <= 30, `${pk}`);
}

// ---- determinism + zero alloc -------------------------------------------------------------------------------------------------
{
  const trace = () => {
    const r = rig({ planes: [10, 10.3], targets: [mkTarget('b', 6, 0.2)] });
    const h = createHasher();
    for (let i = 0; i < 400; i++) {
      if (i % 7 === 0) r.sim.fire(0, 0, 0.8 + (i % 5) * 0.1, 1, 0, 0, (i % 11) / 10, 2);
      r.sim.step(); r.sim.hashInto(h);
    }
    return h.value();
  };
  const a = trace(), b = trace();
  ok('equal hash across two runs', a !== undefined && a === b, `${a} ${b}`);
  const r = rig({ planes: [10, 10.3], targets: [mkTarget('b', 6, 0.2)] });
  r.events.emit = () => {}; // the log copy would allocate (the sim holds the same `events` object)
  const N = 10000;
  const cycle = () => {
    for (let i = 0; i < N; i++) {
      if (i % 5 === 0) r.sim.fire(0, 0, 0.8 + (i % 7) * 0.1, 1, 0, 0, 0.8, 2);
      r.sim.step();
      if (i % 50 === 0) r.sim.pickup(10, 0, 1, 20);
    }
  };
  cycle(); global.gc(); global.gc();
  const h0 = process.memoryUsage().heapUsed;
  cycle(); global.gc(); global.gc();
  const grow = process.memoryUsage().heapUsed - h0;
  ok('0 alloc over 10000 steps (fire/hit/stick/pickup)', grow < 64000, `${grow} bytes`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failures) console.log('FAIL: ' + f); process.exit(1); }
console.log('ALL PASS');
