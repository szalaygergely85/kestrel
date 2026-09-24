// game/js/quest/wake.test.js (US-015). Headless Node ESM, no framework.
// Run: node game/js/quest/wake.test.js
import { wakeFrame } from './wake.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const cfg = { blackSec: 1.0, riseSec: 1.2, blinkCurve: [[0, 0], [0.6, 0.6], [0.9, 0.25], [1.5, 1.0]], titleIn: 1, titleHold: 3, titleOut: 1, startEyeH: 0.3, bodyEyeH: 1.6 };
const out = {};

// ---- black phase ----
wakeFrame(0, cfg, out);
ok('t=0: fully black, eyelid closed, input locked', out.blackA === 1 && out.blinkOpen === 0 && out.inputLocked === true);
ok('t=0: eye at the lying start height', near(out.eyeH, 0.3));

wakeFrame(0.5, cfg, out);
ok('t=0.5 (still black): blackA=1', out.blackA === 1 && out.blinkOpen === 0);

// ---- blink reveal + rise, both start at blackSec ----
wakeFrame(1.0, cfg, out);
ok('t=1.0 (blackSec): blackA=0, blink/rise start', out.blackA === 0 && out.blinkOpen === 0 && near(out.eyeH, 0.3));

wakeFrame(1.0 + 0.6, cfg, out);
ok('t=1.6 (blink local 0.6): blinkOpen=0.6 (curve point)', near(out.blinkOpen, 0.6));

wakeFrame(1.0 + 1.2, cfg, out); // rise ends here (riseSec=1.2)
ok('t=2.2 (riseSec elapsed): eyeH at the standing height', near(out.eyeH, 1.6));

wakeFrame(1.0 + 1.5, cfg, out); // blink curve's last point
ok('t=2.5 (blink curve done): blinkOpen=1.0', near(out.blinkOpen, 1.0));
ok('wakeDoneAtSec = blackSec + max(riseSec, blinkSec) = 1.0 + 1.5', near(out.wakeDoneAtSec, 2.5));
ok('input unlocks exactly at wakeDoneAtSec', out.inputLocked === false);

wakeFrame(2.49, cfg, out);
ok('just before wakeDoneAtSec: still locked', out.inputLocked === true);

// ---- title timeline, starting at wakeDoneAtSec ----
wakeFrame(2.5, cfg, out);
ok('title starts at wakeDoneAtSec: state=in, a=0', out.titleState === 'in' && near(out.titleA, 0));
wakeFrame(2.5 + 0.5, cfg, out);
ok('halfway through titleIn (1s): a=0.5', out.titleState === 'in' && near(out.titleA, 0.5));
wakeFrame(2.5 + 1.0, cfg, out);
ok('titleIn done: state=hold, a=1', out.titleState === 'hold' && out.titleA === 1);
wakeFrame(2.5 + 1.0 + 3.0, cfg, out);
ok('hold (3s) done: state=out, a=1', out.titleState === 'out' && near(out.titleA, 1));
wakeFrame(2.5 + 1.0 + 3.0 + 0.5, cfg, out);
ok('halfway through titleOut (1s): a=0.5', out.titleState === 'out' && near(out.titleA, 0.5));
wakeFrame(2.5 + 1.0 + 3.0 + 1.0, cfg, out);
ok('titleOut done: state=done, a=0', out.titleState === 'done' && out.titleA === 0);
ok('titleDoneAtSec = wakeDoneAtSec + 1+3+1', near(out.titleDoneAtSec, 2.5 + 5.0));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
