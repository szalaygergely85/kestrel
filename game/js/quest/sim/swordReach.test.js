// OB-116: sword must hit a low target (boar 0.7 m tall) at 2 m, on flat / lower / higher / sloped ground.
// Stub world with a planar terrain (ground z = slope * y) so raySegment behaves like the mesh-mode terrain gate.
import { createSwordSim, ST_LIGHT } from './sword.js';
import { SWORD_CFG } from '../swordConfig.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL ' + n + (d ? ' ' + d : '')); } };
const FWD = [0, 1];

function run(dist, dz, slope, cfgOver, hard) {
  const ground = (x, y) => slope * y;
  const p = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { body: { grounded: true, speedScale: 1, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  const boar = { id: 'boar', transform: { x: 0, y: dist, z: ground(0, dist) + dz }, components: { targetable: { radius: 0.45, height: 0.7 } } };
  const ents = [p, boar];
  const hits = [];
  const events = { on() { return () => {}; }, emit(n, e) { if (n === 'combat:hit') hits.push(e); } };
  const world = {
    state: { 'tower.sword.taken': true }, entities: ents,
    terrain: { groundAt: ground },
    forEachEntity(fn) { for (const e of ents) fn(e); },
    get(id) { const e = ents.find((x) => x.id === id); return e ? { data: e, id, play() {} } : null; },
    raySegment(ax, ay, az, bx, by, bz, o) { // march, blocked where z < ground
      const n = 64;
      for (let i = 1; i <= n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        if (z < ground(x, y)) { o.t = t; o.x = x; o.y = y; o.z = z; return true; }
      }
      return false;
    },
  };
  const sim = createSwordSim(world, events, { ...SWORD_CFG, ...(cfgOver || {}) }, null);
  if (hard) { sim.step(p, ...FWD, true); for (let i = 0; i < 24; i++) sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); }
  else { sim.step(p, ...FWD, true); sim.step(p, ...FWD, false); }
  for (let i = 0; i < 40; i++) sim.step(p, ...FWD, false);
  return hits.length > 0;
}

const rows = [];
for (const [name, dz, slope] of [['flat', 0, 0], ['0.3 lower', -0.3, 0], ['0.3 higher', 0.3, 0], ['uphill 20%', 0, 0.2], ['downhill 20%', 0, -0.2], ['downhill 40%', 0, -0.4]]) {
  const r = [name];
  for (const d of [1.0, 1.5, 2.0, 2.5]) r.push(run(d, dz, slope) ? 'HIT' : '--');
  rows.push(r.join('\t'));
}
console.log('light, boar at 1.0 / 1.5 / 2.0 / 2.5 m (centre)\n' + rows.join('\n'));

// Required after OB-116 (light): centre at 1.0-2.0 m hits on flat, 0.3 lower/higher, +-20% slopes.
for (const [name, dz, slope] of [['flat', 0, 0], ['0.3 lower', -0.3, 0], ['0.3 higher', 0.3, 0], ['uphill 20%', 0, 0.2], ['downhill 20%', 0, -0.2]]) {
  for (const d of [1.0, 1.5, 2.0]) ok(`OB-116 boar ${name} at ${d} m`, run(d, dz, slope), '');
}
ok('OB-116 hard swing hits boar at 2.5 m centre', run(2.5, 0, 0, null, true));
ok('OB-116 boar beyond reach (3.2 m) is not hit', !run(3.2, 0, 0));
console.log(`${pass} passed, ${fail} failed.`);
if (fail) process.exitCode = 1; else console.log('ALL PASS');
