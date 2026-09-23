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

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
