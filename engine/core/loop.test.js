// engine/core/loop.test.js
//
// Headless test suite for US-018 (docs/architecture.md section 16) step 1:
// `Loop.stats` (simMs/renderMs/jsMs/intervalMs/worstIntervalMs/over25/
// frames) and `resetStats()`. Plain Node ESM, no test framework, no build
// step - matches engine/physics/physics.test.js. Run with:
//
//   node engine/core/loop.test.js
//
// Fakes `performance.now`/`requestAnimationFrame`/`cancelAnimationFrame`/
// `document.hidden` (Loop's only globals) so the whole tick can be driven
// by hand, one fake "frame" at a time, with a controlled interval and a
// controlled amount of CPU work spent inside update()/render().

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

// ---- fake clock + rAF -----------------------------------------------------
let fakeNow = 0;
let pendingCb = null;
let hidden = false;

globalThis.performance = { now: () => fakeNow };
globalThis.requestAnimationFrame = (cb) => { pendingCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { pendingCb = null; };
globalThis.document = { get hidden() { return hidden; } };

// Advances the fake clock by `intervalMs`, spends `workMs` of fake CPU time
// inside update()+render() (split evenly-ish), and fires the pending rAF
// callback (i.e. runs exactly one Loop._tick).
function stepFrame(intervalMs, workMs = 0) {
  fakeNow += intervalMs;
  const cb = pendingCb;
  pendingCb = null;
  if (!cb) throw new Error('no pending rAF callback - Loop not running?');
  // update()/render() below advance fakeNow themselves by their share of
  // workMs, so performance.now() deltas around them are non-zero.
  cb(fakeNow);
}

const { Loop } = await import('./loop.js');

// ---- basic tick + jsMs split ----------------------------------------------
{
  let updates = 0, renders = 0;
  const loop = new Loop(
    (dt) => { updates++; fakeNow += 1; }, // 1 ms of "work" per fixed step
    (alpha) => { renders++; fakeNow += 2; } // 2 ms of "work" per render
  );
  loop.start();
  // 1/60 s = ~16.67 ms - one fixed step should fire.
  stepFrame(16.9);
  ok('one fixed update ran', updates === 1, `updates=${updates}`);
  ok('render ran once', renders === 1, `renders=${renders}`);
  ok('simMs ~ 1 ms', Math.abs(loop.stats.simMs - 1) < 0.5, `simMs=${loop.stats.simMs}`);
  ok('renderMs ~ 2 ms', Math.abs(loop.stats.renderMs - 2) < 0.5, `renderMs=${loop.stats.renderMs}`);
  ok('jsMs = simMs + renderMs', Math.abs(loop.stats.jsMs - (loop.stats.simMs + loop.stats.renderMs)) < 1e-9);
  loop.stop();
}

// ---- intervalMs / worstIntervalMs / over25 / frames, with the initial skip ----
{
  const loop = new Loop(() => {}, () => {});
  loop.start();
  // First SKIP_INTERVAL_FRAMES (2) intervals after start() must not count,
  // even if huge - they are load/setup jank, not real pacing.
  stepFrame(500); // skipped (1st)
  stepFrame(40);  // skipped (2nd)
  ok('worstIntervalMs still 0 during the skip window', loop.stats.worstIntervalMs === 0, `worst=${loop.stats.worstIntervalMs}`);
  ok('over25 still 0 during the skip window', loop.stats.over25 === 0);
  ok('frames still 0 during the skip window', loop.stats.frames === 0);

  stepFrame(16); // first counted interval
  ok('intervalMs recorded', Math.abs(loop.stats.intervalMs - 16) < 1e-6, `intervalMs=${loop.stats.intervalMs}`);
  ok('frames = 1 after first counted interval', loop.stats.frames === 1);
  ok('worstIntervalMs = 16 after first counted interval', loop.stats.worstIntervalMs === 16);

  stepFrame(30); // over 25 ms - counts as a stutter frame
  ok('over25 = 1 after a >25ms interval', loop.stats.over25 === 1, `over25=${loop.stats.over25}`);
  ok('worstIntervalMs tracks the max (30)', loop.stats.worstIntervalMs === 30);

  stepFrame(10); // back under 25 - worst/over25 must not regress
  ok('worstIntervalMs stays at the max after a smaller interval', loop.stats.worstIntervalMs === 30);
  ok('over25 stays at 1 after a smaller interval', loop.stats.over25 === 1);
  ok('frames = 3 after three counted intervals', loop.stats.frames === 3, `frames=${loop.stats.frames}`);
  loop.stop();
}

// ---- hidden tab: intervals while document.hidden must not count -----------
{
  const loop = new Loop(() => {}, () => {});
  loop.start();
  stepFrame(500); stepFrame(40); // consume the initial skip window
  hidden = true;
  stepFrame(1200); // huge gap from a backgrounded tab - must be ignored
  ok('a hidden-tab interval does not bump over25', loop.stats.over25 === 0, `over25=${loop.stats.over25}`);
  ok('a hidden-tab interval does not bump frames', loop.stats.frames === 0, `frames=${loop.stats.frames}`);
  hidden = false;
  stepFrame(16);
  ok('frames resumes counting once visible again', loop.stats.frames === 1, `frames=${loop.stats.frames}`);
  loop.stop();
}

// ---- resetStats(): re-arms the skip window, zeroes the accumulators -------
{
  const loop = new Loop(() => {}, () => {});
  loop.start();
  stepFrame(500); stepFrame(40); // consume the initial skip window
  stepFrame(30); // over25 -> 1, worst -> 30, frames -> 1
  ok('setup: over25 = 1 before reset', loop.stats.over25 === 1);

  loop.resetStats();
  ok('resetStats zeroes worstIntervalMs', loop.stats.worstIntervalMs === 0);
  ok('resetStats zeroes over25', loop.stats.over25 === 0);
  ok('resetStats zeroes frames', loop.stats.frames === 0);

  stepFrame(500); // must be skipped again right after resetStats()
  ok('resetStats re-arms the skip window (1st post-reset interval skipped)', loop.stats.frames === 0, `frames=${loop.stats.frames}`);
  stepFrame(40); // 2nd skipped interval
  stepFrame(16); // first counted interval post-reset
  ok('frames counts again after the re-armed skip window', loop.stats.frames === 1, `frames=${loop.stats.frames}`);
  loop.stop();
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
