// game/js/quest/beastView.test.js (US-079b ARCH fix). Headless Node ESM, no framework.
// Covers the manually-driven death/sink clip pose conversion (frameTFromElapsed)
// and the "reset the pose on clip change" contract via presentBeasts.
import { makeOk } from '../../../engine/test/assert.js';
import { frameTFromElapsed, DIE_DURATIONS, SINK_DURATIONS, presentBeasts } from './beastView.js';
import { STATE_DYING, STATE_SINK, STATE_NOTICE, STATE_WANDER, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER } from './sim/beastSim.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_goblin.js'; // GOB-07a: ASSETS.goblinFx.clipFor

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

// ---- US-079c notice: `!` pop style for the first 6 steps, then the alert style ----
{
  const bars = [];
  const overlay = { bar(x, y, z, w, h, style, empty) { bars.push({ style, z }); } };
  const voxel = { anim: 'idle', frame: 0, t: 0, loop: true, playing: true, hidden: false };
  const sim = {
    count: 1,
    cfgSteps: { die: 24, sink: 30, notice: 36 },
    state: [STATE_NOTICE],
    timer: [36],
    hurtT: [9999],
    fx: [0], fy: [-1],
    entities: [{ transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } }],
  };
  const styleIds = { beastNotice: 1, beastNoticePop: 2 };
  sim.timer[0] = 36; presentBeasts(sim, {}, overlay, styleIds); // elapsed 0 -> pop
  sim.timer[0] = 31; presentBeasts(sim, {}, overlay, styleIds); // elapsed 5 -> pop
  sim.timer[0] = 30; presentBeasts(sim, {}, overlay, styleIds); // elapsed 6 -> alert
  ok('notice: pop style for the first 6 steps then the alert style',
    bars.length === 3 && bars[0].style === 2 && bars[1].style === 2 && bars[2].style === 1, JSON.stringify(bars));
  ok('notice bar sits 1.1 m up (boarFx.notice.noticeUpM)', bars[0].z === 1.1, `z=${bars[0].z}`);

  // fallback: without a resolved beastNoticePop, the pop steps reuse beastNotice.
  bars.length = 0;
  sim.timer[0] = 36; presentBeasts(sim, {}, overlay, { beastNotice: 7 });
  ok('falls back to beastNotice when beastNoticePop is not provided', bars[0].style === 7, `style=${bars[0].style}`);
}

// ---- GOB-07a: goblin clip map via ASSETS.goblinFx.clipFor, throw held 400 ms into RECOVER, torch clips ----
{
  const mk = (model, ranged) => {
    const voxel = { anim: 'idle', frame: 0, t: 0, playing: true, hidden: false, model };
    return { voxel, sim: { count: 1, cfgSteps: { die: 24, sink: 30, notice: 42 }, state: [STATE_WANDER], timer: [0], hurtT: [9999], fx: [0], fy: [-1], ranged: [ranged], fleeing: [0],
      entities: [{ transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } }] } };
  };
  const clipAt = (g, st, fleeing) => { g.sim.state[0] = st; g.sim.fleeing[0] = fleeing ? 1 : 0; presentBeasts(g.sim, {}, { bar() {} }, { beastNotice: 0 }); return g.voxel.anim; };
  const g = mk('goblin', 0);
  ok('goblin: wander walk, chase run, windup attack, charge attack, recover run',
    clipAt(g, STATE_WANDER) === 'walk' && clipAt(g, STATE_CHASE) === 'run' && clipAt(g, STATE_WINDUP) === 'attack' && clipAt(g, STATE_CHARGE) === 'attack' && clipAt(g, STATE_RECOVER) === 'run');
  ok('goblin: return walk, fleeing run, stagger flinch', clipAt(g, STATE_RETURN) === 'walk' && clipAt(g, STATE_RETURN, true) === 'run' && clipAt(g, STATE_STAGGER) === 'flinch');
  const th = mk('goblin', 1);
  ok('thrower: windup -> throw', clipAt(th, STATE_WINDUP) === 'throw');
  let held = 0; while (clipAt(th, STATE_RECOVER) === 'throw' && held < 100) held++;
  ok('thrower: throw keeps playing 400 ms (24 steps) into RECOVER, then run', held === 24 && th.voxel.anim === 'run', `held=${held} anim=${th.voxel.anim}`);
  const tr = mk('goblinTorch', 0);
  ok('torch goblin: wander/chase/recover/return/flee -> carryTorch, windup -> attack',
    clipAt(tr, STATE_WANDER) === 'carryTorch' && clipAt(tr, STATE_CHASE) === 'carryTorch' && clipAt(tr, STATE_RECOVER) === 'carryTorch' && clipAt(tr, STATE_RETURN, true) === 'carryTorch' && clipAt(tr, STATE_WINDUP) === 'attack');
  clipAt(tr, STATE_CHASE);
  ok('torch goblin chases at 1.6x clip rate, walks at 1x', tr.voxel.speed === 1.6 && (clipAt(tr, STATE_WANDER), tr.voxel.speed === 1));
  const gd = mk('goblin', 0); gd.sim.hurtT[0] = 3;
  ok('goblin: hurt flash wins over the state clip', clipAt(gd, STATE_CHASE) === 'hurt');
  const dying = mk('goblin', 0); dying.sim.timer[0] = 12;
  ok('goblin: death timeline unchanged', clipAt(dying, STATE_DYING) === 'die');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
