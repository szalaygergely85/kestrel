// game/js/quest/beastView.test.js (US-079b ARCH fix). Headless Node ESM, no framework.
// Covers the manually-driven death/sink clip pose conversion (frameTFromElapsed)
// and the "reset the pose on clip change" contract via presentBeasts.
import { makeOk } from '../../../engine/test/assert.js';
import { frameTFromElapsed, DIE_DURATIONS, SINK_DURATIONS, presentBeasts } from './beastView.js';
import { STATE_DYING, STATE_SINK } from './sim/beastSim.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- frameTFromElapsed over the die clip ([90,110,120,80,100]) --------------
{
  const out = { frame: -1, t: -1 };
  ok('die at 250 ms -> frame 2, t 50 (ARCH test)', frameTFromElapsed(250, DIE_DURATIONS, out) === out && out.frame === 2 && out.t === 50);
  ok('die at 0 ms -> frame 0, t 0', frameTFromElapsed(0, DIE_DURATIONS, out) === out && out.frame === 0 && out.t === 0);
  ok('die at 400 ms (end of DYING) -> frame 4 (held settle), t 0', frameTFromElapsed(400, DIE_DURATIONS, out) === out && out.frame === 4 && out.t === 0);
  ok('negative elapsed clamps to frame 0', frameTFromElapsed(-5, DIE_DURATIONS, out) === out && out.frame === 0 && out.t === 0);
  ok('elapsed past all keys lands on the last key', frameTFromElapsed(9999, DIE_DURATIONS, out) === out && out.frame === 4);
}

// ---- frameTFromElapsed over the sink clip ([500,100]) -----------------------
{
  const out = { frame: -1, t: -1 };
  ok('sink at 250 ms -> frame 0, t 250', frameTFromElapsed(250, SINK_DURATIONS, out) === out && out.frame === 0 && out.t === 250);
  ok('sink at 500 ms -> frame 1, t 0', frameTFromElapsed(500, SINK_DURATIONS, out) === out && out.frame === 1 && out.t === 0);
}

// ---- presentBeasts drives die/sink from elapsed and clears stale pose state ----
// A fake voxel component stuck at frame 5 (stale) must not corrupt the manual
// die clip; the manual clips derive (frame, t) from elapsed and set playing=false.
{
  const voxel = { anim: 'idle', frame: 5, t: 999, loop: true, playing: true, hidden: false };
  const sim = {
    count: 1,
    cfgSteps: { die: 24, sink: 30 },
    state: [STATE_DYING],
    timer: [12], // 12 steps in -> elapsed = (24-12)*1000/60 = 200 ms
    hurtT: [9999],
    fx: [0], fy: [-1],
    entities: [{ transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } }],
  };
  presentBeasts(sim, {}, { bar() {} }, { beastNotice: 0 });
  ok('die clip switched and driven from elapsed (200 ms -> frame 2, t 0)', voxel.anim === 'die' && voxel.frame === 2 && voxel.t === 0);
  ok('die is manually driven (playing false)', voxel.playing === false);
  ok('loop cleared on clip change', voxel.loop === undefined);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
