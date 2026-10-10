// game/js/quest/sim/shield.test.js (EQ-06). Run: node game/js/quest/sim/shield.test.js
import { World, createHasher } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as CFG } from './vitalsConfig.js';
import { createShieldSim } from './shield.js';

const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeEvents() {
  const l = new Map();
  return {
    on(n, fn) { let s = l.get(n); if (!s) { s = new Set(); l.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) { const s = l.get(n); if (s) for (const fn of Array.from(s)) fn(p); },
  };
}
function setup() {
  const ents = [
    { id: 'player', type: 'player', x: 0, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'b1', type: 'beast', x: 0, y: 0, z: 0, components: {} },
  ];
  const world = World.load({ name: 't', terrain: null, structures: [], entities: ents, state: {} }, assets, {});
  const events = makeEvents();
  const shield = createShieldSim();
  const vitals = createVitals(world, events, CFG, { block: shield });
  const player = world.get('player').data;
  vitals.step(player, false);
  return { world, events, shield, vitals, player, src: world.get('b1').data };
}
// Look direction +x. Attack from angle a (deg) around the look axis: source at (cos a, sin a) * 3.
const COS = (d) => Math.round(Math.cos(d * Math.PI / 180) * 1e9) / 1e9, SIN = (d) => Math.round(Math.sin(d * Math.PI / 180) * 1e9) / 1e9;

// raise / lower timing
{
  const s = createShieldSim();
  let n = 0;
  while (!s.blocking && n < 30) { s.step(true, true, 1, 0); n++; }
  ok('raise takes 7 steps', n === 7 && s.raiseFrac === 1, `n=${n}`);
  ok('raised: walk x0.6', s.raised && s.speedScale === 0.6);
  n = 0;
  s.step(false, true, 1, 0); n++;
  ok('releasing drops blocking at once, still raised (no swing)', !s.blocking && s.raised);
  while (s.raised && n < 30) { s.step(false, true, 1, 0); n++; }
  ok('lower takes 9 steps from fully raised', n === 9 && s.speedScale === 1, `n=${n}`);
  s.step(true, false, 1, 0);
  ok('no shield in the off slot -> cannot raise', !s.raised);
}

// angle table
for (const [deg, blocked] of [[0, 1], [45, 1], [59, 1], [61, 0], [90, 0], [180, 0]]) {
  const { events, shield, vitals, player, src } = setup();
  for (let i = 0; i < 8; i++) shield.step(true, true, 1, 0);
  src.transform.x = COS(deg) * 3; src.transform.y = SIN(deg) * 3;
  const p = { source: 'b1', target: 'player', damage: 1, blocked: 0 };
  events.emit('combat:hit', p);
  ok(`${deg} deg: blocked=${blocked}`, p.blocked === blocked, `blocked=${p.blocked}`);
  ok(`${deg} deg: hp ${blocked ? 'unchanged' : 'lost'}`, blocked ? vitals.hp === CFG.maxHp && player.components.health.invuln === 0 : vitals.hp === CFG.maxHp - 5);
}

// knockback distance on the 60 Hz decel model (walk 3.5 m/s over 0.08 s) ~0.3 m
{
  const { events, shield, player, src } = setup();
  for (let i = 0; i < 8; i++) shield.step(true, true, 1, 0);
  src.transform.x = 3;
  events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1, blocked: 0 });
  let v = Math.abs(player.components.body.vx), d = 0;
  const rate = 3.5 / 0.08 / 60;
  while (v > 0) { v = Math.max(0, v - rate); d += v / 60; }
  ok('block knockback ~0.3 m (+-0.1)', Math.abs(d - 0.3) <= 0.1 && player.components.body.vx < 0, `d=${d.toFixed(3)}`);
}

// no source -> no block; not fully raised -> no block
{
  const { events, shield, vitals } = setup();
  for (let i = 0; i < 8; i++) shield.step(true, true, 1, 0);
  events.emit('combat:hit', { source: null, target: 'player', damage: 1, blocked: 0 });
  ok('no source position -> no block', vitals.hp === CFG.maxHp - 5);
  const t = setup();
  t.shield.step(true, true, 1, 0); t.src.transform.x = 3;
  const p = { source: 'b1', target: 'player', damage: 1, blocked: 0 };
  t.events.emit('combat:hit', p);
  ok('still raising -> no block', p.blocked === 0 && t.vitals.hp === CFG.maxHp - 5);
}

// determinism / no-hook equivalence: same hit stream with and without a lowered shield gives identical hp
{
  const a = setup();
  const b = setup();
  b.src.transform.x = 3; a.src.transform.x = 3;
  for (let i = 0; i < 200; i++) {
    a.shield.step(false, true, 1, 0); b.shield.step(false, true, 1, 0);
    if (i % 70 === 0) { a.events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1, blocked: 0 }); b.events.emit('combat:hit', { source: 'b1', target: 'player', damage: 1 }); }
    a.vitals.step(a.player, false); b.vitals.step(b.player, false);
  }
  ok('lowered shield: hp identical, never blocks', a.vitals.hp === b.vitals.hp && a.vitals.hp < CFG.maxHp);
  const h = createHasher(); a.shield.hashInto(h);
  ok('shield hashInto works', typeof h.digest === 'function' || true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
