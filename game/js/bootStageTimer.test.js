// node game/js/bootStageTimer.test.js
import assert from 'node:assert';
import { BOOT_STAGES, createBootStageTimer } from './bootStageTimer.js';

// Fake clock: advances only when read, so each stage's ms is exactly the gap we ask for.
function fakeClock(start = 0) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; };
  return clock;
}

// --- stages advance in order, ms sums correctly ---
{
  const clock = fakeClock(1000);
  const timer = createBootStageTimer(clock);
  clock.advance(100); timer.enter('adapter');     // content: 100 ms
  clock.advance(50);  timer.enter('pipelines');   // adapter: 50 ms
  clock.advance(200); timer.enter('world');       // pipelines: 200 ms
  clock.advance(30);  timer.enter('meshes');      // world: 30 ms
  clock.advance(10);  timer.finish();             // meshes: 10 ms

  assert.strictEqual(timer.durations.content, 100);
  assert.strictEqual(timer.durations.adapter, 50);
  assert.strictEqual(timer.durations.pipelines, 200);
  assert.strictEqual(timer.durations.world, 30);
  assert.strictEqual(timer.durations.meshes, 10);
  assert.strictEqual(timer.total(), 390, 'total sums every closed stage');
  assert.strictEqual(timer.progress(), 1, 'all 5 stages closed -> progress 1');
  assert.ok(timer.isDone());
}

// --- progress is monotonic 0..1 as stages close ---
{
  const clock = fakeClock();
  const timer = createBootStageTimer(clock);
  const seen = [timer.progress()];
  for (const id of ['adapter', 'pipelines', 'world', 'meshes']) { clock.advance(5); timer.enter(id); seen.push(timer.progress()); }
  clock.advance(5); timer.finish(); seen.push(timer.progress());
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `monotonic at ${i}: ${seen[i - 1]} -> ${seen[i]}`);
  for (const v of seen) assert.ok(v >= 0 && v <= 1, `in range: ${v}`);
  assert.strictEqual(seen[0], 0, 'nothing closed yet at the start');
  assert.strictEqual(seen[seen.length - 1], 1);
}

// --- unknown stage ids are ignored (no-op, no throw, no time stolen) ---
{
  const clock = fakeClock();
  const timer = createBootStageTimer(clock);
  clock.advance(10); timer.enter('adapter');
  clock.advance(5);  timer.enter('nope');          // unknown: ignored
  clock.advance(15); timer.enter('pipelines');     // adapter should still be 5 + 15 = 20, not 5
  assert.strictEqual(timer.durations.content, 10);
  assert.strictEqual(timer.durations.adapter, 20, 'time during the unknown call stays attributed to the live stage');
  assert.strictEqual(timer.durations.nope, undefined);
}

// --- out-of-order / repeat moves are ignored (never rewinds a stage already passed) ---
{
  const clock = fakeClock();
  const timer = createBootStageTimer(clock);
  clock.advance(10); timer.enter('world');          // content: 10 ms, now in 'world'
  clock.advance(5);  timer.enter('adapter');        // backward: ignored
  clock.advance(5);  timer.enter('content');        // backward: ignored
  clock.advance(20); timer.enter('world');          // same stage again: ignored (no-op, no split)
  clock.advance(7);  timer.enter('meshes');         // forward: closes 'world' at 5+5+20+7 = 37
  assert.strictEqual(timer.durations.content, 10);
  assert.strictEqual(timer.durations.adapter, undefined);
  assert.strictEqual(timer.durations.world, 37);
}

// --- finish() is idempotent and freezes the timer ---
{
  const clock = fakeClock();
  const timer = createBootStageTimer(clock);
  clock.advance(10); timer.finish();
  const totalAfterFirstFinish = timer.total();
  clock.advance(100); timer.enter('world'); timer.finish();
  assert.strictEqual(timer.total(), totalAfterFirstFinish, 'finish() then any later call is a no-op');
}

// --- card text: one line per finished stage, in BOOT_STAGES display order, with ms ---
{
  const clock = fakeClock();
  const timer = createBootStageTimer(clock);
  assert.strictEqual(timer.cardText(), '', 'nothing finished yet');
  clock.advance(123); timer.enter('adapter');
  assert.strictEqual(timer.cardText(), 'content 123 ms');
  clock.advance(45); timer.enter('world');
  assert.strictEqual(timer.cardText(), 'content 123 ms\nadapter 45 ms', 'adapter line appears once closed, in display order');
  assert.strictEqual(BOOT_STAGES.map((s) => s.id).join(','), 'content,adapter,pipelines,world,meshes');
}

console.log('bootStageTimer.test.js: all checks passed.');
