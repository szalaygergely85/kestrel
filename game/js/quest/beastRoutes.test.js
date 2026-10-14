// BEAST-07: seeded walkable routes, cohesion while roaming, night set 20:00 / dawn never in view.
import assert from 'node:assert/strict';
import { buildGroups, createSpawnDirector } from './sim/spawnDirector.js';
import { routeFor, assignRoutes, createRouteFollower, isNightHour } from './beastRoutes.js';

// walkable: a "lake" disc at (560,500) r 30 and a wall of water at x>700
const walkable = (x, y) => !(Math.hypot(x - 560, y - 500) < 30) && x < 700;
const mem = (id, sp, reg, grp, x, y, extra) => ({ id, species: sp, region: reg, group: grp, x, y, ...extra });
const members = [
  mem('boar.downs.1', 'boar', 'downs', 0, 500, 500), mem('boar.downs.2', 'boar', 'downs', 0, 505, 503), mem('boar.downs.3', 'boar', 'downs', 0, 495, 506),
  mem('wolf.nw.1', 'wolf', 'nw', 0, 300, 300), mem('wolf.nw.2', 'wolf', 'nw', 0, 304, 296),
  mem('wolf.night.1', 'wolf', 'nw', 1, 300, 600, { when: 'night' }), mem('wolf.night.2', 'wolf', 'nw', 1, 303, 602, { when: 'night' }),
].map((m, i) => ({ ...m, kind: m.species, key: m.region, slot: i }));
const mkGroups = (seed) => { const g = buildGroups(members, seed, null); for (const gr of g) if (gr.members[0].when) gr.when = 'night'; return assignRoutes(g, seed, walkable); };

// 1. determinism + walkable + 3..6 waypoints
const a = mkGroups(12), b = mkGroups(12), c = mkGroups(13);
assert.deepEqual(a.map((g) => g.route), b.map((g) => g.route), 'same seed -> same routes');
assert.notDeepEqual(a.map((g) => g.route), c.map((g) => g.route), 'other seed differs');
for (const g of a) {
  assert.ok(g.route.length >= 3 && g.route.length <= 6, g.gid + ' route length ' + g.route.length);
  for (const [x, y] of g.route) assert.ok(walkable(x, y), g.gid + ' waypoint on ground ' + x + ',' + y);
}
assert.deepEqual(a.map((g) => g.gid), b.map((g) => g.gid), 'deterministic ids');
// a group stranded in water falls back to its (walkable) home, still 3 entries
assert.equal(routeFor({ gid: 'x.y.1', cls: 'common', home: [10, 10] }, 12, () => false).length, 3);

// 2. stub sim: slots walk to their goal at their own speed (0.8-1.4 m/s), 60 Hz
const mkSim = () => {
  const n = members.length, sim = {
    count: n, state: new Uint8Array(n), isEngaged(s) { return [1, 2, 3, 4, 5, 16, 18, 21, 23].includes(sim.state[s]); }, steer: { x: new Float64Array(n), y: new Float64Array(n) }, goalOn: new Uint8Array(n), goalTX: new Float64Array(n), goalTY: new Float64Array(n),
    downs: new Set(), speed: [1.4, 1.1, 0.8, 1.3, 0.9, 1.4, 1.0],
    setGoal(s, x, y) { sim.goalOn[s] = 1; sim.goalTX[s] = x; sim.goalTY[s] = y; }, hasGoal: (s) => sim.goalOn[s] === 1,
    atGoal: (s) => sim.goalOn[s] === 1 && Math.hypot(sim.goalTX[s] - sim.steer.x[s], sim.goalTY[s] - sim.steer.y[s]) <= 1.5,
    parkSlot(s) { sim.downs.add(s); }, unparkSlot(s) { return sim.downs.delete(s); }, setDown(s, on) { if (on) sim.downs.add(s); else sim.downs.delete(s); }, isDown: (s) => sim.downs.has(s), isDormant: () => false,
    tick(dt) { for (let s = 0; s < n; s++) { if (sim.downs.has(s) || !sim.goalOn[s]) continue; const dx = sim.goalTX[s] - sim.steer.x[s], dy = sim.goalTY[s] - sim.steer.y[s], d = Math.hypot(dx, dy); if (d < 0.05) continue; const v = Math.min(d, sim.speed[s] * dt); sim.steer.x[s] += dx / d * v; sim.steer.y[s] += dy / d * v; } },
  };
  members.forEach((m, i) => { sim.steer.x[i] = m.x; sim.steer.y[i] = m.y; });
  return sim;
};
const setup = (hourFn) => {
  const sim = mkSim(), groups = mkGroups(12), dir = createSpawnDirector({ groups, dayLenSec: 600, viewCos: 0.7, los: () => false });
  const f = createRouteFollower({ sim, groups, dir, hour: hourFn }); f.init();
  return { sim, groups, dir, f };
};

// 3. cohesion <= 8 m over 3000 steps (day), and the leader really moves along its route
{
  const { sim, groups, f } = setup(() => 12);
  let worst = 0, moved = 0; const x0 = sim.steer.x[0], y0 = sim.steer.y[0];
  for (let i = 0; i < 3000; i++) {
    f.step(-500, -500, 1, 0); sim.tick(1 / 60);
    if (i > 300) for (const g of [0, 1]) { const sl = groups[g].slots; for (const s of sl) worst = Math.max(worst, Math.hypot(sim.steer.x[s] - sim.steer.x[sl[0]], sim.steer.y[s] - sim.steer.y[sl[0]])); }
  }
  moved = Math.hypot(sim.steer.x[0] - x0, sim.steer.y[0] - y0);
  assert.ok(worst <= 8, 'cohesion worst ' + worst.toFixed(2));
  assert.ok(moved > 5 || f.wp[0] > 0, 'group roams (moved ' + moved.toFixed(1) + ', wp ' + f.wp[0] + ')');
  assert.ok(!sim.downs.has(0) && !sim.downs.has(1), 'day set stays active');
}

// 4. night set: parked by day, appears after 20:00 (out of view), fades at dawn only out of view
{
  let hour = 12; const { sim, groups, f } = setup(() => hour);
  assert.deepEqual([...sim.downs].sort(), [5, 6], 'night group parked at noon');
  const nightG = groups.findIndex((g) => g.when === 'night');
  for (let i = 0; i < 600; i++) f.step(-500, -500, 1, 0);
  assert.equal(f.active[nightG], 0, 'still parked in daylight');
  hour = 19.9; for (let i = 0; i < 300; i++) f.step(-500, -500, 1, 0); assert.equal(sim.downs.size, 2, 'not before 20:00');
  hour = 20.1;
  // player stands 70 m from the night home looking at it -> must not pop in
  for (let i = 0; i < 300; i++) f.step(300 - 70, 600, 1, 0);
  assert.equal(f.active[nightG], 0, 'in view: no pop-in'); assert.equal(sim.downs.size, 2);
  for (let i = 0; i < 300; i++) f.step(300 - 70, 600, -1, 0);
  assert.equal(f.active[nightG], 1, 'looks away -> appears'); assert.equal(sim.downs.size, 0);
  // dawn while the player watches (night group still at home 70 m in front): stays
  hour = 5.5;
  for (let i = 0; i < 300; i++) f.step(300 - 70, 600, 1, 0);
  assert.equal(f.active[nightG], 1, 'dawn but in view: no pop-out'); assert.equal(sim.downs.size, 0);
  for (let i = 0; i < 300; i++) f.step(300 - 70, 600, -1, 0);
  assert.equal(f.active[nightG], 0, 'dawn, unseen -> fades'); assert.equal(sim.downs.size, 2);
}
// BEAST-07 arch: init parks night groups at ANY hour (a night load must not leave them standing live untracked)
{
  const { sim, groups, f } = setup(() => 22);
  const nightG = groups.findIndex((g) => g.when === 'night');
  assert.ok(nightG >= 0 && f.active[nightG] === 0, 'night group inactive after a night-time load');
  for (const s of groups[nightG].slots) assert.ok(sim.downs.has(s), 'night slot ' + s + ' parked after a night-time load');
}
assert.ok(isNightHour(20) && isNightHour(3) && !isNightHour(5) && !isNightHour(19.99));
console.log('beastRoutes OK');
