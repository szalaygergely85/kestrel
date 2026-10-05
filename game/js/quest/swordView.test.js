// game/js/quest/swordView.test.js - TORCH-01a: presentation only touches its own item handle.
import { presentSword } from './swordView.js';
import { ST_IDLE, ST_HOLD, ST_CHARGE, ST_LIGHT, ST_HARD, ST_REST } from './sim/sword.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const calls = [];
const vm = {
  hide(h) { calls.push(['hide', h]); },
  capture(h) { calls.push(['capture', h]); },
  show(h, clip, tMs, blend) { calls.push(['show', h, clip, tMs, blend]); },
  setBob(phase, amount, h) { calls.push(['bob', phase, amount, h]); },
  mountEye(h, clip, tMs, mount, out) { calls.push(['mount', h, clip, tMs, mount]); out[0] = tMs * 0.001; out[1] = -0.5; out[2] = 0; return out; },
  eyeToWorld(cam, p, out) { out.set(p); return out; },
};
let segments = 0;
const overlay = { segment() { segments++; }, bar() {} };
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const vmh = {
  vm, h: 2, clip: { idle: 10, charge: 11, swingLR: 12, swingHard: 13 }, mount: { tip: 0, mid: 1 },
  trail: { light: { samples: 3, stepMs: 10 }, hard: { samples: 3, stepMs: 10 } },
  windows: { light: { windup: 5, active: 3 }, hard: { windup: 5, active: 3 } },
};
const ids = { trail0: 1, trail1: 2, trail2: 3, trailHead: 4, ghost: 5 };
const sim = { state: ST_IDLE, stateStep: 0, holdSteps: 0, justEntered: false, blend: false, sparks: { size: 0 } };
function present(moving = false) { presentSword(sim, vmh, overlay, cam, ids, 1.25, 0.6, moving); }

presentSword(null, vmh, overlay, cam, ids, 0, 0, false);
ok('missing sim hides only the sword handle', calls.length === 1 && calls[0][0] === 'hide' && calls[0][1] === vmh.h);
calls.length = 0;
presentSword({}, vmh, overlay, cam, ids, 0, 0, false);
ok('sim without state hides only the sword handle', calls.length === 1 && calls[0][1] === vmh.h);
calls.length = 0;
presentSword(sim, null, overlay, cam, ids, 0, 0, false);
ok('unbound presentation does nothing', calls.length === 0);

for (const [state, clip, bob, tMs] of [
  [ST_IDLE, 10, 0, 1250], [ST_REST, 10, 0, 1250],
  [ST_HOLD, 11, 0.2, 400], [ST_CHARGE, 11, 0.2, 400],
  [ST_LIGHT, 12, 0.4, 100], [ST_HARD, 13, 0.2, 100],
]) {
  sim.state = state; sim.stateStep = 6; sim.holdSteps = 30;
  calls.length = 0; present();
  const shown = calls.find((c) => c[0] === 'show'), b = calls.find((c) => c[0] === 'bob');
  ok(`state ${state}: clip and timing unchanged`, shown[1] === vmh.h && shown[2] === clip && Math.abs(shown[3] - tMs) < 1e-9 && !shown[4]);
  ok(`state ${state}: bob scoped to sword handle`, b[1] === 0.6 && b[2] === bob && b[3] === vmh.h);
}
sim.state = ST_IDLE; calls.length = 0; present(true);
ok('moving idle enables sword bob only', calls.find((c) => c[0] === 'bob')[2] === 1 && calls.find((c) => c[0] === 'bob')[3] === vmh.h);
sim.state = ST_LIGHT; sim.justEntered = true; sim.blend = true; calls.length = 0; segments = 0; present();
ok('chain capture is scoped and precedes show', calls[0][0] === 'capture' && calls[0][1] === vmh.h && calls[1][0] === 'show' && calls[1][4]);
ok('trail samples only sword mounts and still draws trail plus ghost', calls.filter((c) => c[0] === 'mount').every((c) => c[1] === vmh.h && c[2] === vmh.clip.swingLR) && segments === 3);
sim.justEntered = false; calls.length = 0; present();
ok('ongoing blend does not recapture the pose', !calls.some((c) => c[0] === 'capture') && calls.find((c) => c[0] === 'show')[4]);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
