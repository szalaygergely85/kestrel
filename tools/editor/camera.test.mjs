// tools/editor/camera.test.mjs - US-031 (docs/architecture.md 24.13 S3).
// Plain Node ESM, no test framework, no build step - matches
// engine/core/playerLook.test.js / engine/core/loop.test.js. Run with:
//
//   node tools/editor/camera.test.mjs

import { createCameraPose, updateCamera, startPoseForStructure, adjustSpeed, clonePose } from './camera.js';

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

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// A fake Input: only `isDown(code)` is used by updateCamera (24.5's own
// signature note - it accepts anything with that shape).
function fakeInput(downCodes = []) {
  const set = new Set(downCodes);
  return { isDown: (c) => set.has(c) };
}

// ---- createCameraPose / clonePose -----------------------------------------
{
  const p = createCameraPose();
  ok('default pose is at the origin, yaw/pitch 0', p.x === 0 && p.y === 0 && p.z === 0 && p.yawDeg === 0 && p.pitchDeg === 0);
  ok('default pose has a fov field (explicit, serializable data)', typeof p.fov === 'number');
  const c = clonePose(p);
  c.x = 99;
  ok('clonePose returns an independent copy', p.x === 0 && c.x === 99);
}

// ---- WASD/RF vectors at yaw 0/90/180/270 -----------------------------------
{
  // yaw 0 (compass N, -y): W -> -y, D -> +x
  let pose = createCameraPose();
  let changed = updateCamera(pose, fakeInput(['KeyW']), 1, { speed: 1 });
  ok('yaw 0: W moves -y', approxEqual(pose.y, -1) && approxEqual(pose.x, 0), `x=${pose.x} y=${pose.y}`);
  ok('yaw 0: W reports changed', changed === true);

  pose = createCameraPose();
  updateCamera(pose, fakeInput(['KeyD']), 1, { speed: 1 });
  ok('yaw 0: D (strafe right) moves +x', approxEqual(pose.x, 1) && approxEqual(pose.y, 0), `x=${pose.x} y=${pose.y}`);

  // yaw 90 (compass E, +x): W -> +x
  pose = createCameraPose({ yawDeg: 90 });
  updateCamera(pose, fakeInput(['KeyW']), 1, { speed: 1 });
  ok('yaw 90: W moves +x', approxEqual(pose.x, 1, 1e-6) && approxEqual(pose.y, 0, 1e-6), `x=${pose.x} y=${pose.y}`);

  // yaw 180 (compass S, +y): W -> +y
  pose = createCameraPose({ yawDeg: 180 });
  updateCamera(pose, fakeInput(['KeyW']), 1, { speed: 1 });
  ok('yaw 180: W moves +y', approxEqual(pose.x, 0, 1e-6) && approxEqual(pose.y, 1, 1e-6), `x=${pose.x} y=${pose.y}`);

  // yaw 270 (compass W, -x): W -> -x
  pose = createCameraPose({ yawDeg: 270 });
  updateCamera(pose, fakeInput(['KeyW']), 1, { speed: 1 });
  ok('yaw 270: W moves -x', approxEqual(pose.x, -1, 1e-6) && approxEqual(pose.y, 0, 1e-6), `x=${pose.x} y=${pose.y}`);

  // R/F = world z up/down, independent of yaw.
  pose = createCameraPose({ yawDeg: 47 });
  updateCamera(pose, fakeInput(['KeyR']), 1, { speed: 1 });
  ok('R moves +z regardless of yaw', approxEqual(pose.z, 1));
  pose = createCameraPose({ yawDeg: 47 });
  updateCamera(pose, fakeInput(['KeyF']), 1, { speed: 1 });
  ok('F moves -z regardless of yaw', approxEqual(pose.z, -1));

  // Opposite keys held together cancel (S+W, A+D).
  pose = createCameraPose();
  const c2 = updateCamera(pose, fakeInput(['KeyW', 'KeyS']), 1, { speed: 1 });
  ok('W+S cancel (no movement)', approxEqual(pose.x, 0) && approxEqual(pose.y, 0));
  ok('W+S still reports changed:false (net zero delta, no field actually differs)', c2 === false);
}

// ---- Shift/Ctrl speed factors ----------------------------------------------
{
  let pose = createCameraPose();
  updateCamera(pose, fakeInput(['KeyW', 'ShiftLeft']), 1, { speed: 2 });
  ok('Shift = x4 speed', approxEqual(pose.y, -8), `y=${pose.y}`);

  pose = createCameraPose();
  updateCamera(pose, fakeInput(['KeyW', 'ControlLeft']), 1, { speed: 2 });
  ok('Ctrl = x0.25 speed', approxEqual(pose.y, -0.5), `y=${pose.y}`);
}

// ---- pitch clamp at +/-35 --------------------------------------------------
{
  const pose = createCameraPose();
  updateCamera(pose, fakeInput([]), 1, { speed: 1, lookDx: 0, lookDy: -100000 });
  ok('pitch clamps at +35', approxEqual(pose.pitchDeg, 35), `pitchDeg=${pose.pitchDeg}`);

  const pose2 = createCameraPose();
  updateCamera(pose2, fakeInput([]), 1, { speed: 1, lookDx: 0, lookDy: 100000 });
  ok('pitch clamps at -35', approxEqual(pose2.pitchDeg, -35), `pitchDeg=${pose2.pitchDeg}`);
}

// ---- changed is false when nothing is pressed ------------------------------
{
  const pose = createCameraPose({ x: 5, y: 6, z: 7, yawDeg: 12, pitchDeg: 3 });
  const before = clonePose(pose);
  const changed = updateCamera(pose, fakeInput([]), 1 / 60, { speed: 6 });
  ok('no input -> changed:false', changed === false);
  ok('no input -> pose unchanged', pose.x === before.x && pose.y === before.y && pose.z === before.z
    && pose.yawDeg === before.yawDeg && pose.pitchDeg === before.pitchDeg);
}

// ---- startPoseForStructure (24.5 "Start pose") -----------------------------
{
  const origin = { x: 1480, y: 1018, z: 0 };
  const level = { width: 24, height: 14 };
  const p = startPoseForStructure(origin, level);
  ok('start pose x = origin.x + width/2', approxEqual(p.x, 1480 + 12));
  ok('start pose y = origin.y + height + 10', approxEqual(p.y, 1018 + 14 + 10));
  ok('start pose z = origin.z + 8', approxEqual(p.z, 8));
  ok('start pose looks north (yaw 0)', p.yawDeg === 0);
  ok('start pose pitched down -15', p.pitchDeg === -15);
}

// ---- adjustSpeed (mouse wheel, 24.5: x1.25/notch, clamped 0.5..200) --------
{
  ok('wheel up (deltaY<0) speeds up x1.25', approxEqual(adjustSpeed(6, -1), 7.5));
  ok('wheel down (deltaY>0) slows x1/1.25', approxEqual(adjustSpeed(6, 1), 6 / 1.25));
  ok('speed clamps at 200 max', adjustSpeed(200, -1) === 200);
  ok('speed clamps at 0.5 min', adjustSpeed(0.5, 1) === 0.5);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
