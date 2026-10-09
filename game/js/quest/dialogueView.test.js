// dialogueView.test.js (DIALOGUE-01b1): draws against a fake UI grid + fake runner.
import assert from 'node:assert/strict';
import { createDialogueView } from './dialogueView.js';

function grid(cols, rows) {
  const code = new Uint8Array(cols * rows), bg = new Uint8Array(cols * rows * 3), fg = new Uint8Array(cols * rows * 3);
  return {
    cols, rows, code, bg, fg,
    setCellRGB(x, y, gi, r, g, b, r2, g2, b2) {
      assert.ok(x >= 0 && x < cols && y >= 0 && y < rows, `out of grid ${x},${y}`);
      const i = y * cols + x; code[i] = gi + 32; fg[i * 3] = r; fg[i * 3 + 1] = g; fg[i * 3 + 2] = b;
      bg[i * 3] = r2; bg[i * 3 + 1] = g2; bg[i * 3 + 2] = b2;
    },
    at(x, y) { return String.fromCharCode(this.code[y * cols + x] || 32); },
    row(y) { let s = ''; for (let x = 0; x < cols; x++) s += this.at(x, y); return s; },
    bgAt(x, y) { const i = (y * cols + x) * 3; return [bg[i], bg[i + 1], bg[i + 2]]; },
  };
}
const choices = ['Who are you?', 'Boys do fly.', 'Leave.'];
const LINE = "Boys don't fly. They fall, and then they get up again and again.";
const run = (o) => Object.assign({ state: 'typing', speakerLabel: 'BEAR', isPlayer: false,
  line: LINE, visibleChars: 10, choiceCount: 0, choiceText: (i) => choices[i], selected: 0 }, o);

const view = createDialogueView();
function boxTop(g) { for (let y = 0; y < g.rows; y++) if (g.row(y).includes('+=')) return y; return -1; }

// frame corners + name tag + typed prefix
{
  const g = grid(160, 60); view.draw(g, run(), 0);
  const top = boxTop(g), bottom = top + view.boxHeight - 1;
  const l = g.row(top).indexOf('+'), rr = g.row(top).lastIndexOf('+');
  assert.equal(rr - l + 1, 60);
  assert.equal(g.at(l, bottom), '+'); assert.equal(g.at(rr, bottom), '+');
  assert.ok(g.row(top).includes('[ BEAR ]'));
  assert.ok(g.row(bottom).includes('[Esc] close'));
  assert.ok(g.row(top + 1).includes("Boys don't"));
  assert.ok(!g.row(top + 1).includes('f'), 'only the typed prefix');
  assert.ok(!g.row(top + 4).includes('>'));
}
// wrap inside 56 cols; marker blinks at 0.5 s
{
  const g = grid(160, 60); view.draw(g, run({ visibleChars: 999, state: 'waiting' }), 0);
  const top = boxTop(g), l = g.row(top).indexOf('+');
  for (let k = 1; k <= 3; k++) assert.equal(g.at(l + 59, top + k), '|');
  const joined = (g.row(top + 1) + g.row(top + 2)).replace(/[|]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(joined.includes('again and again.'));
  const hasV = (t) => { const gg = grid(160, 60); view.draw(gg, run({ visibleChars: 999, state: 'waiting' }), t); return gg.row(top + 3).includes('v'); };
  assert.equal(hasV(0.1), true); assert.equal(hasV(0.6), false); assert.equal(hasV(1.1), true);
}
// choices + cursor + highlight
{
  const g = grid(160, 60); view.draw(g, run({ state: 'choosing', visibleChars: 999, choiceCount: 3, selected: 1 }), 0);
  const top = boxTop(g), l = g.row(top).indexOf('+');
  for (let i = 0; i < 3; i++) assert.ok(g.row(top + 4 + i).includes(choices[i]));
  assert.ok(g.row(top + 5).includes('> Boys do fly.'));
  assert.ok(!g.row(top + 4).includes('>') && !g.row(top + 6).includes('>'));
  assert.deepEqual(g.bgAt(l + 5, top + 5), [52, 42, 16]);
  assert.deepEqual(g.bgAt(l + 5, top + 4), [10, 11, 16]);
}
// idle/ended draw nothing
{
  const g = grid(160, 60); view.draw(g, run({ state: 'idle' }), 0); view.draw(g, run({ state: 'ended' }), 0);
  assert.equal(boxTop(g), -1);
}
// narrowest to widest grids stay in bounds
for (const [c, r] of [[160, 60], [240, 90], [400, 150], [480, 180], [40, 15]]) {
  const g = grid(c, r); view.draw(g, run({ state: 'choosing', visibleChars: 999, choiceCount: 3, selected: 2 }), 0);
  const top = boxTop(g); assert.ok(top >= 0 && top + view.boxHeight <= r, `${c}x${r}`);
}
// style override
{
  const v2 = createDialogueView({ style: { plate: [1, 2, 3] } }); const g = grid(160, 60); v2.draw(g, run(), 0);
  const top = boxTop(g), l = g.row(top).indexOf('+');
  assert.deepEqual(g.bgAt(l + 3, top + 1), [1, 2, 3]);
}
// 1e4 draws: zero allocation
{
  const g = grid(160, 60), r = run({ state: 'choosing', visibleChars: 999, choiceCount: 3, selected: 1 });
  for (let i = 0; i < 2000; i++) view.draw(g, r, i * 0.016);
  if (globalThis.gc) globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) view.draw(g, r, i * 0.016);
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 400000, `heap grew ${grown}`);
}
console.log('dialogueView: ok');
