// ANIM-STATE-WIRE-01: sim state sequence -> clip states, cross-fade weights, zero allocation.
import { makeOk } from '../../../engine/test/assert.js';
import { createBeastAnim, BEAST_ANIM_DEF } from './beastAnim.js';
import { STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_FLINCH, STATE_DYING, STATE_CORPSE } from './sim/beastSim.js';
import { presentBeasts } from './beastView.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const DT = 1000 / 60;
const sim = { count: 1, state: [STATE_WANDER], timer: [10], hurtT: [9999], fx: [0], fy: [-1], cfgSteps: { die: 24, sink: 30, notice: 36 } };
const anim = createBeastAnim(2);
const run = (st, hurtT = 9999, timer = 10, n = 1) => { sim.state[0] = st; sim.hurtT[0] = hurtT; sim.timer[0] = timer; let c; for (let k = 0; k < n; k++) c = anim.update(sim, 0, DT); return c; };

ok('every def clip exists in the boar clips', ['idle', 'walk', 'windup', 'charge', 'hurt', 'die'].every((c) => Object.values(BEAST_ANIM_DEF.states).some((s) => s.clip === c)));
ok('wander pausing -> idle', run(STATE_WANDER) === 'idle');
ok('wander walking -> walk', run(STATE_WANDER, 9999, -1) === 'walk');
ok('notice -> idle', run(STATE_NOTICE) === 'idle' && anim.anims[0].name === 'idle');
ok('chase -> walk state, charge (gallop) clip', run(STATE_CHASE) === 'charge' && anim.anims[0].name === 'walk');
ok('windup -> windup clip', run(STATE_WINDUP) === 'windup' && anim.anims[0].name === 'windup');
ok('charge -> attack state, charge clip', run(STATE_CHARGE) === 'charge' && anim.anims[0].name === 'attack');
ok('recover releases attack -> idle', run(STATE_RECOVER) === 'idle' && anim.anims[0].name === 'idle');
ok('hurt flash overrides', run(STATE_WINDUP, 3) === 'hurt' && anim.anims[0].name === 'hurt');
ok('windup is not re-entered while hurt (priority)', run(STATE_WINDUP, 5) === 'hurt');
ok('flinch after the flash -> flinch clip', run(STATE_FLINCH, 20) === 'flinch');
ok('back to chase releases hurt', run(STATE_CHASE) === 'charge' && anim.anims[0].name === 'walk');
ok('dying -> die state, terminal', run(STATE_DYING) === 'die' && run(STATE_WANDER) === 'die' && anim.anims[0].dead);

// cross-fade: fresh slot, idle -> windup, weight ramps 0 -> 1 over 80 ms (monotone)
{
  const a2 = createBeastAnim(1); sim.state[0] = STATE_WANDER; sim.hurtT[0] = 9999; sim.timer[0] = 10;
  a2.update(sim, 0, 0); sim.state[0] = STATE_WINDUP; a2.update(sim, 0, 0);
  const w = [a2.weight(0)];
  for (let k = 0; k < 6; k++) { a2.update(sim, 0, DT); w.push(a2.weight(0)); }
  ok('blend starts at 0 with prevClip idle', w[0] === 0 && a2.prevClip[0] === 'idle');
  ok('blend monotone and reaches 1 after 80 ms', w.every((x, k) => k === 0 || x >= w[k - 1]) && w[w.length - 1] === 1, JSON.stringify(w));
}

// view wiring: presentBeasts with the adapter writes the clip + blend data on the voxel
{
  const voxel = { anim: 'idle', frame: 0, t: 0, playing: true, hidden: false };
  const s = { count: 1, state: [STATE_WINDUP], timer: [10], hurtT: [9999], fx: [0], fy: [-1], cfgSteps: { die: 24, sink: 30, notice: 36 },
    entities: [{ transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } }] };
  presentBeasts(s, {}, { bar() {} }, { beastNotice: 0 }, createBeastAnim(1));
  ok('presentBeasts + adapter: windup clip, blend fields set', voxel.anim === 'windup' && voxel.blendW > 0 && voxel.blendW < 1 && voxel.blendFrom === 'idle');
  s.state[0] = STATE_CORPSE; presentBeasts(s, {}, { bar() {} }, { beastNotice: 0 }, createBeastAnim(1));
  ok('dead states stay on the view timeline', voxel.anim === 'dead');
}

// zero allocation over 1e4 steps cycling states
{
  const seq = [STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_FLINCH];
  const a3 = createBeastAnim(1);
  for (let k = 0; k < 2000; k++) { sim.state[0] = seq[k % 7]; sim.hurtT[0] = k % 50; a3.update(sim, 0, DT); a3.weight(0); }
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 10000; k++) { sim.state[0] = seq[k % 7]; sim.hurtT[0] = k % 50; a3.update(sim, 0, DT); a3.weight(0); }
  if (global.gc) global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok('1e4 steps: no retained growth (gc) or < 100 B/step garbage', grew < (global.gc ? 65536 : 1e6), `grew ${grew} B`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
