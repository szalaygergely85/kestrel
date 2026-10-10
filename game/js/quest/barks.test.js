// barks.test.js (CH1-06): once per id, 1.6 s lines, cancel on dialogue, 0-alloc draw.
import assert from 'node:assert/strict';
import { createBarks, BARK_LINE_SEC } from './barks.js';

const data = { speakers: { burl: { label: 'BURL' }, you: { label: 'YOU', player: true } },
  barks: { 'bear.walk1': [{ who: 'burl', text: 'Hear those birds?' }, { who: 'you', text: 'What about them?' }, { who: 'burl', text: 'They sing when the woods are at peace.' }],
    'wick.relay': [{ who: 'you', text: 'Another one.' }] } };
function mk(extra) {
  const state = {}, flags = [];
  const dialogue = { open: false };
  const cells = [];
  const layer = { cols: 120, rows: 40, setCellRGB(x, y, g) { if (cells.length < 5000) cells.push(g); } };
  const b = createBarks(Object.assign({ world: { state }, data, dialogue, palette: { colors: {} },
    questFlag: (k) => { flags.push(k); state[k] = true; } }, extra));
  return { b, state, flags, dialogue, layer, cells };
}
const DT = 1 / 60;
const run = (b, sec) => { for (let i = 0; i < Math.round(sec * 60); i++) b.step(DT); };

// once per id + flag
{
  const { b, flags, state } = mk();
  assert.equal(b.play('nope'), false);
  assert.equal(b.play('wick.relay', 'wick'), true);
  assert.deepEqual(flags, ['bark.wick.relay']); assert.ok(state['bark.wick.relay']);
  assert.ok(b.active);
  run(b, BARK_LINE_SEC + 0.1); assert.equal(b.active, false);
  assert.equal(b.play('wick.relay'), false, 'second play refused');
}
// lines advance every 1.6 s, typed text grows
{
  const { b, layer, cells } = mk();
  b.play('bear.walk1');
  run(b, 0.5); b.draw(layer, 0); const typed = cells.length; assert.ok(typed > 0);
  run(b, 1.2); // t=1.7 -> line 2 (player)
  assert.ok(b.active);
  run(b, BARK_LINE_SEC * 2); assert.equal(b.active, false, 'all 3 lines done after ~4.8 s');
}
// cancel when a dialogue opens; no start over a dialogue (not consumed)
{
  const { b, dialogue, state } = mk();
  dialogue.open = true; assert.equal(b.play('wick.relay'), false); assert.ok(!state['bark.wick.relay']);
  dialogue.open = false; assert.equal(b.play('wick.relay'), true);
  dialogue.open = true; b.step(DT); assert.equal(b.active, false);
  dialogue.open = false; assert.equal(b.play('wick.relay'), false, 'flag stays set after cancel');
}
// queue: second bark waits for the first
{
  const { b } = mk();
  b.play('bear.walk1'); assert.equal(b.play('wick.relay'), true);
  run(b, BARK_LINE_SEC * 3 + 0.2); assert.ok(b.active, 'queued bark now on');
  run(b, BARK_LINE_SEC + 0.1); assert.equal(b.active, false);
}
// 0-alloc draw + step
{
  const { b, layer } = mk({ lineSec: 100 });
  b.play('bear.walk1'); run(b, 1);
  for (let i = 0; i < 2000; i++) { b.draw(layer, i * 0.016); b.step(DT); } // warm
  globalThis.gc && globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) { b.draw(layer, i * 0.016); b.step(DT); }
  const d = process.memoryUsage().heapUsed - h0;
  assert.ok(d < 1000000, 'heap growth ' + d);
}
console.log('barks.test.js ok');
