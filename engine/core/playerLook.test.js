// game/js/engine/playerLook.test.js
//
// Headless test suite for US-005 PO REJECT #1 (mouse delta accumulated
// while unlocked snaps the view on resume). Plain Node ESM, no test
// framework, no build step - matches game/js/physics/physics.test.js. Run
// with:
//
//   node game/js/engine/playerLook.test.js
//
// Exits 0 and prints "ALL PASS" if every check passes, exits 1 and lists
// failures otherwise.
//
// Input/PlayerLook touch `window`/`document`/a canvas only for
// addEventListener/removeEventListener and a couple of pointer-lock
// properties, so a minimal EventTarget-based stand-in is enough - no jsdom
// needed.

import { Input } from './input.js';
import { PlayerLook } from './playerLook.js';
import { makeOk, approxEqual as approxEqualCore } from '../test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

// --- minimal DOM stand-ins -------------------------------------------------

class FakeCanvas extends EventTarget {
  requestPointerLock() {
    // Never actually resolves in this harness; tests drive `locked` and
    // `pointerlockchange` directly instead of relying on this.
    return Promise.resolve();
  }
}

function makeEnv() {
  const canvas = new FakeCanvas();
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; };
  const win = new EventTarget();
  global.window = win;
  global.document = doc;
  return { canvas, doc, win };
}

function dispatchMouseMove(target, dx, dy) {
  const e = new Event('mousemove');
  e.movementX = dx;
  e.movementY = dy;
  target.dispatchEvent(e);
}

function lock(env, canvas) {
  env.doc.pointerLockElement = canvas;
  env.doc.dispatchEvent(new Event('pointerlockchange'));
}

function unlock(env) {
  env.doc.pointerLockElement = null;
  env.doc.dispatchEvent(new Event('pointerlockchange'));
}

// --- Test 1: PO REJECT #1's exact repro -------------------------------------
// 500px of mousemove while unlocked, then lock, then one update(dt) - yaw
// and pitch must be unchanged. Then 100px while locked must move yaw by
// exactly 15 deg (100 * 0.15).
{
  const env = makeEnv();
  const input = new Input(env.canvas);
  const look = new PlayerLook(env.canvas, input, /* initialYaw */ 0, /* initialPitch */ 0);

  dispatchMouseMove(env.canvas, 500, 500);
  lock(env, env.canvas);
  look.update(1 / 60);

  ok('PO REJECT #1 repro: yaw unchanged after unlocked movement + lock',
    approxEqual(look.yawDeg, 0), `yawDeg=${look.yawDeg}`);
  ok('PO REJECT #1 repro: pitch unchanged after unlocked movement + lock',
    approxEqual(look.pitchDeg, 0), `pitchDeg=${look.pitchDeg}`);

  dispatchMouseMove(env.canvas, 100, 0);
  look.update(1 / 60);
  ok('normal locked mouse look: 100px -> exactly 15 deg yaw',
    approxEqual(look.yawDeg, 15), `yawDeg=${look.yawDeg}`);
}

// --- Test 2: movement while unlocked, discarded across several unlocked
// update() steps too (not just at the lock transition) -------------------
{
  const env = makeEnv();
  const input = new Input(env.canvas);
  const look = new PlayerLook(env.canvas, input, 10, 5);

  dispatchMouseMove(env.canvas, 200, -80);
  look.update(1 / 60); // still unlocked - must discard, not apply
  dispatchMouseMove(env.canvas, 50, 50);
  look.update(1 / 60); // still unlocked - must discard again

  ok('unlocked update() steps discard mouse delta (yaw)',
    approxEqual(look.yawDeg, 10), `yawDeg=${look.yawDeg}`);
  ok('unlocked update() steps discard mouse delta (pitch)',
    approxEqual(look.pitchDeg, 5), `pitchDeg=${look.pitchDeg}`);

  // Now lock with no pending movement and confirm look still responds
  // normally (the fix didn't break the locked path).
  lock(env, env.canvas);
  dispatchMouseMove(env.canvas, 0, -100); // mouse up -> pitch increases
  look.update(1 / 60);
  ok('locked mouse look still works after prior discards',
    approxEqual(look.pitchDeg, 5 + 15), `pitchDeg=${look.pitchDeg}`);
}

// --- Test 3: pitch clamp still holds at +/-35 -------------------------------
{
  const env = makeEnv();
  const input = new Input(env.canvas);
  const look = new PlayerLook(env.canvas, input, 0, 0);
  lock(env, env.canvas);

  dispatchMouseMove(env.canvas, 0, -100000); // huge upward look
  look.update(1 / 60);
  ok('pitch clamps at +35', approxEqual(look.pitchDeg, 35), `pitchDeg=${look.pitchDeg}`);

  dispatchMouseMove(env.canvas, 0, 100000); // huge downward look
  look.update(1 / 60);
  ok('pitch clamps at -35', approxEqual(look.pitchDeg, -35), `pitchDeg=${look.pitchDeg}`);
}

// --- Test 4: Esc (unlock) then movement before the next click is discarded,
// matching the "moving the cursor back to the canvas after Esc" case from
// the PO's repro description --------------------------------------------
{
  const env = makeEnv();
  const input = new Input(env.canvas);
  const look = new PlayerLook(env.canvas, input, 0, 0);

  lock(env, env.canvas);
  dispatchMouseMove(env.canvas, 40, 0);
  look.update(1 / 60); // yaw += 6
  ok('locked movement before Esc applied', approxEqual(look.yawDeg, 6), `yawDeg=${look.yawDeg}`);

  unlock(env);
  dispatchMouseMove(env.canvas, 900, 900); // moving the cursor back, unlocked
  look.update(1 / 60); // unlocked branch - must discard

  lock(env, env.canvas);
  look.update(1 / 60);
  ok('movement after Esc, before re-lock, is discarded',
    approxEqual(look.yawDeg, 6), `yawDeg=${look.yawDeg}`);
}

// --- US-128a look lock (architecture 29.2) ---------------------------------
const STEP = 1 / 60;
function dispatchWheel(target, dy) {
  const e = new Event('wheel'); e.deltaY = dy; target.dispatchEvent(e);
}
function mk(yaw = 0, pitch = 0, opts = {}) {
  const env = makeEnv();
  const input = new Input(env.canvas);
  const look = new PlayerLook(env.canvas, input, yaw, pitch, opts);
  lock(env, env.canvas);
  return { env, input, look };
}
function run(look, n, e, t) { for (let i = 0; i < n; i++) { look.setLockPoint(...e, ...t); look.update(STEP); } }
{
  // target due east (+x): yaw 90. 10 steps = 60 deg, 15 = 90
  const { look } = mk(0, 0);
  run(look, 10, [0, 0, 0], [10, 0, 0]);
  ok('turn cap: 10 steps -> 60 deg', approxEqual(look.yawDeg, 60, 1e-9), `${look.yawDeg}`);
  run(look, 5, [0, 0, 0], [10, 0, 0]);
  ok('converges: 15 steps -> 90 deg', approxEqual(look.yawDeg, 90, 1e-9), `${look.yawDeg}`);
  run(look, 5, [0, 0, 0], [10, 0, 0]);
  ok('stays on target', approxEqual(look.yawDeg, 90, 1e-9));
}
{
  const t = [Math.sin(10 * Math.PI / 180), -Math.cos(10 * Math.PI / 180), 0];
  const { look } = mk(350, 0); // target at yaw 10: short way across 0
  run(look, 1, [0, 0, 0], t);
  ok('wrap: 350 -> 356 (short way)', approxEqual(look.yawDeg, 356, 1e-9), `${look.yawDeg}`);
  run(look, 5, [0, 0, 0], t);
  ok('wrap: converges to 10', approxEqual(look.yawDeg, 10, 1e-9), `${look.yawDeg}`);
}
{
  const { look } = mk(0, 0, { pitchClampDeg: 70 });
  run(look, 30, [0, 0, 0], [0, -1, 100]); // nearly straight up
  ok('pitch stops at 70 clamp', approxEqual(look.pitchDeg, 70), `${look.pitchDeg}`);
  const b = mk(0, 0);
  run(b.look, 30, [0, 0, 0], [0, -1, 100]);
  ok('pitch stops at 35 default clamp', approxEqual(b.look.pitchDeg, 35), `${b.look.pitchDeg}`);
  const c = mk(0, 0);
  run(c.look, 30, [0, 0, 0], [0, -10, 5]);
  ok('pitch converges to atan2(5,10)', approxEqual(c.look.pitchDeg, Math.atan2(5, 10) * 180 / Math.PI, 1e-9), `${c.look.pitchDeg}`);
}
{
  // mouse at 25 %, offset clamp, no decay
  const { env, look } = mk(0, 0);
  run(look, 1, [0, 0, 0], [0, -10, 0]);
  dispatchMouseMove(env.canvas, 100, 0); // 100px*0.15*0.25 = 3.75 deg
  run(look, 1, [0, 0, 0], [0, -10, 0]);
  ok('locked mouse = 25 % offset', approxEqual(look.yawDeg, 3.75, 1e-9), `${look.yawDeg}`);
  run(look, 30, [0, 0, 0], [0, -10, 0]);
  ok('offset has no decay', approxEqual(look.yawDeg, 3.75, 1e-9), `${look.yawDeg}`);
  dispatchMouseMove(env.canvas, 100000, -100000);
  run(look, 20, [0, 0, 0], [0, -10, 0]);
  ok('offset clamps +20 yaw', approxEqual(look.yawDeg, 20, 1e-9), `${look.yawDeg}`);
  ok('offset clamps +10 pitch', approxEqual(look.pitchDeg, 10, 1e-9), `${look.pitchDeg}`);
  dispatchMouseMove(env.canvas, -100000, 100000);
  run(look, 30, [0, 0, 0], [0, -10, 0]);
  ok('offset clamps -20 yaw (340)', approxEqual(look.yawDeg, 340, 1e-9), `${look.yawDeg}`);
  ok('offset clamps -10 pitch', approxEqual(look.pitchDeg, -10, 1e-9), `${look.pitchDeg}`);
}
{
  // clearLock: no jump, full mouse back; re-lock resets offsets
  const { env, look } = mk(0, 0);
  dispatchMouseMove(env.canvas, 100, 0);
  run(look, 3, [0, 0, 0], [0, -10, 0]);
  const y = look.yawDeg;
  look.clearLock();
  ok('lockActive false after clear', look.lockActive === false);
  look.update(STEP);
  ok('clearLock: no jump', approxEqual(look.yawDeg, y, 1e-12), `${look.yawDeg} vs ${y}`);
  dispatchMouseMove(env.canvas, 100, 0);
  look.update(STEP);
  ok('clearLock: full mouse (15 deg)', approxEqual(look.yawDeg, y + 15, 1e-9), `${look.yawDeg}`);
  look.setLockPoint(0, 0, 0, 0, -10, 0);
  ok('setLockPoint re-activates', look.lockActive === true);
  look.update(STEP);
  ok('re-lock resets offset (turns back toward 0)', look.yawDeg < y + 15, `${look.yawDeg}`);
}
{
  // yaw formula agrees with Player forward (sinY, -cosY) at 8 compass points
  let all = true;
  for (let k = 0; k < 8; k++) {
    const yaw = k * 45, r = yaw * Math.PI / 180;
    const tgt = [5 + 7 * Math.sin(r), 5 - 7 * Math.cos(r), 0];
    const { look } = mk(yaw, 0);
    look.setLockPoint(5, 5, 0, ...tgt);
    look.update(STEP);
    if (!approxEqual(look.yawDeg, yaw, 1e-9)) all = false;
    const o = mk((yaw + 180) % 360, 0);
    run(o.look, 60, [5, 5, 0], tgt);
    if (!approxEqual(o.look.yawDeg, yaw, 1e-9)) all = false;
  }
  ok('lock yaw matches Player forward at 8 compass points', all);
}
{
  const seq = () => {
    const { env, look } = mk(10, 0);
    const out = [];
    for (let i = 0; i < 100; i++) {
      if (i % 7 === 0) dispatchMouseMove(env.canvas, (i % 3) * 20 - 20, 10 - (i % 5) * 5);
      look.setLockPoint(0, 0, 1, 8 * Math.cos(i / 20), 8 * Math.sin(i / 20), 0);
      look.update(STEP);
      out.push(look.yawDeg, look.pitchDeg);
    }
    return out.join(',');
  };
  ok('determinism: same inputs -> same angles', seq() === seq());
}
{
  // wheel consumed once; Tab/KeyQ are game keys
  const env = makeEnv();
  const input = new Input(env.canvas);
  dispatchWheel(env.canvas, 120); dispatchWheel(env.canvas, 120); dispatchWheel(env.canvas, -53);
  ok('consumeWheel sums notches', input.consumeWheel() === 1);
  ok('consumeWheel consumed once', input.consumeWheel() === 0);
  dispatchWheel(env.canvas, -100);
  ok('consumeWheel negative', input.consumeWheel() === -1);
  let prevented = 0;
  for (const code of ['Tab', 'KeyQ']) {
    const e = new Event('keydown'); e.code = code; e.preventDefault = () => prevented++;
    env.canvas.dispatchEvent(e);
  }
  ok('Tab and KeyQ are game keys (preventDefault)', prevented === 2 && input.isDown('Tab') && input.isDown('KeyQ'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
