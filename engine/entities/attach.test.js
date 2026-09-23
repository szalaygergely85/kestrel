// engine/entities/attach.test.js (US-012). Headless Node ESM, no framework.
// Run: node engine/entities/attach.test.js
//
// `attachedLightPos` is pure (architect tech note 6): offset at yaw
// 0/90/180, sway bounded by `amp`.
import { attachedLightPos } from './attach.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

function entityAt(x, y, z, yawDeg, light) {
  return {
    transform: { x, y, z, yawDeg, pitchDeg: 0 },
    components: { body: { eyeH: 1.6 }, light },
  };
}
const LIGHT = { preset: 'lantern', on: true, attach: 'eye', offset: { right: 0.3, down: 0.3, fwd: 0.4 }, sway: { amp: 0 } };

// ---------------------------------------------------------------------------
// Offset at yaw 0 (facing north = -y): forward = (0,-1), right = (1,0).
// ---------------------------------------------------------------------------
{
  const out = [0, 0, 0];
  attachedLightPos(entityAt(10, 20, 0, 0, LIGHT), null, out);
  ok('yaw 0: x = eyeX + right*0.3', near(out[0], 10 + 0.3), out[0]);
  ok('yaw 0: y = eyeY - fwd*0.4', near(out[1], 20 - 0.4), out[1]);
  ok('yaw 0: z = eye z - down*0.3', near(out[2], 0 + 1.6 - 0.3), out[2]);
}

// ---------------------------------------------------------------------------
// Offset at yaw 90 (facing east): forward = (1,0), right = (0,1).
// ---------------------------------------------------------------------------
{
  const out = [0, 0, 0];
  attachedLightPos(entityAt(10, 20, 0, 90, LIGHT), null, out);
  ok('yaw 90: x = eyeX + fwd*0.4', near(out[0], 10 + 0.4), out[0]);
  ok('yaw 90: y = eyeY + right*0.3', near(out[1], 20 + 0.3), out[1]);
}

// ---------------------------------------------------------------------------
// Offset at yaw 180 (facing south): forward = (0,1), right = (-1,0).
// ---------------------------------------------------------------------------
{
  const out = [0, 0, 0];
  attachedLightPos(entityAt(10, 20, 0, 180, LIGHT), null, out);
  ok('yaw 180: x = eyeX - right*0.3', near(out[0], 10 - 0.3), out[0]);
  ok('yaw 180: y = eyeY + fwd*0.4', near(out[1], 20 + 0.4), out[1]);
}

// ---------------------------------------------------------------------------
// No `light` component / no `eyeFeel`: still returns the bare eye position.
// ---------------------------------------------------------------------------
{
  const out = [0, 0, 0];
  attachedLightPos(entityAt(5, 5, 0, 0, undefined), null, out);
  ok('no light component: falls back to the bare eye position', near(out[0], 5) && near(out[1], 5) && near(out[2], 1.6));
}

// ---------------------------------------------------------------------------
// Sway is bounded by `amp` (right component) and [0, 0.5*amp] (down component).
// ---------------------------------------------------------------------------
{
  const amp = 0.02;
  const swayLight = { ...LIGHT, sway: { amp } };
  let maxRightSway = 0, maxDownSway = 0, minDownSway = Infinity;
  const out = [0, 0, 0];
  for (let i = 0; i <= 360; i++) {
    const phase = (i / 360) * Math.PI * 2;
    attachedLightPos(entityAt(0, 0, 0, 0, swayLight), { bobPhase: phase }, out);
    const rightSway = out[0] - (0 + 0.3); // baseline right offset removed
    const downSway = (0 + 1.6 - 0.3) - out[2]; // baseline down offset removed
    if (Math.abs(rightSway) > maxRightSway) maxRightSway = Math.abs(rightSway);
    if (downSway > maxDownSway) maxDownSway = downSway;
    if (downSway < minDownSway) minDownSway = downSway;
  }
  ok('sway right component stays within +-amp', maxRightSway <= amp + 1e-9, maxRightSway);
  ok('sway down component stays within [0, 0.5*amp]', maxDownSway <= 0.5 * amp + 1e-9 && minDownSway >= -1e-9, `${minDownSway}..${maxDownSway}`);
}

console.log(`attach.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
