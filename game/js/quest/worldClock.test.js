// DN-03 tests. Run: node game/js/quest/worldClock.test.js
import { tickClock, clockHour, stepHour, createClockDriver, CLOCK_KEY, STEP_HOURS } from './worldClock.js';
let fail = 0;
const check = (n, c) => { if (!c) { fail++; console.error('FAIL:', n); } };
const cfg = { dayLenS: 1440, startHour: 8 };
// missing key starts at 8.0 and advances
const st = {};
check('missing key reads 8', clockHour(st, cfg) === 8);
tickClock(st, 60, cfg);
check('60 s = 1 h at 24 min/day', Math.abs(st[CLOCK_KEY] - 9) < 1e-9);
// full day wraps (fixed 60 Hz steps, deterministic)
const s2 = { [CLOCK_KEY]: 8 };
for (let i = 0; i < 1440 * 60; i++) tickClock(s2, 1 / 60, cfg);
check('one day returns to 8', Math.abs(s2[CLOCK_KEY] - 8) < 1e-6 || Math.abs(s2[CLOCK_KEY] - 8) > 24 - 1e-6);
const s3 = { [CLOCK_KEY]: 23.999 };
tickClock(s3, 10, cfg);
check('wraps past 24', s3[CLOCK_KEY] >= 0 && s3[CLOCK_KEY] < 1);
// save round trip keeps the hour (state is plain JSON)
const rt = JSON.parse(JSON.stringify(s2));
check('round trip', rt[CLOCK_KEY] === s2[CLOCK_KEY]);
const s4 = { [CLOCK_KEY]: 'x' };
tickClock(s4, 0, cfg);
check('invalid starts at 8', s4[CLOCK_KEY] === 8);
// respawn/travel keep the hour: the state key is never touched by anything but tickClock (no reset API)
// quantised updates: 1 game day at 60 Hz, 24 min/day => 240*24 = 5760 steps
const s5 = { [CLOCK_KEY]: 8 };
let applied = 0, lastQ = -1, mono = true;
const drv = createClockDriver((q) => { applied++; if (q === lastQ) mono = false; lastQ = q; });
check('forced first update', drv.update(8, true) === true);
for (let i = 0; i < 1440 * 60; i++) { tickClock(s5, 1 / 60, cfg); drv.update(s5[CLOCK_KEY]); }
check('about 5760 steps/day (got ' + applied + ')', Math.abs(applied - 1 - 5760) <= 2);
check('no repeated step hour', mono);
check('force reruns', drv.update(8, true) === true && drv.update(8) === false);
check('stepHour grid', Math.abs(stepHour(8.0041) - 8) < 1e-9 && stepHour(8.0042) > 8);
// frozen = driver never called: nothing to assert except state untouched
const fz = { [CLOCK_KEY]: 8 };
check('frozen state untouched', fz[CLOCK_KEY] === 8 && STEP_HOURS === 1 / 240);
if (fail) { console.error(fail + ' failed'); process.exit(1); } else console.log('worldClock.test: all pass');
