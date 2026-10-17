// SIGNAL-ALIVE-01: the shared signal source decodes to ALIVE; title frames / chart star / menu text / relay blink read it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../../../design/models/title.js'; // classic scripts set globalThis.ASSETS
import '../../../design/models/menu_ui.js';
const A = globalThis.ASSETS, S = A.signal;
assert.equal(S.decode(S.steps), 'ALIVE');
assert.equal(S.text, '.- .-.. .. ...- .');
assert.deepEqual(S.timing, { dot: 0.25, dash: 0.75, gap: 0.25, letterGap: 0.75, pause: 2.5 });
assert.equal(S.marks.length, 13);
// title.show frames: durations equal the shared steps (ms), lit frames count = marks
const sh = A.models.title.animations.show;
assert.deepEqual(sh.durations, S.steps.map((x) => Math.round(x[1] * 1000)));
assert.equal(sh.frames.length, S.steps.length);
assert.equal(A.models.title.signal.marks.length, 13);
const mc = A.models.mapCard.animations && Object.values(A.models.mapCard.animations)[0];
if (mc) assert.deepEqual(mc.durations, sh.durations);
assert.equal(A.uiStyle.menu ? A.uiStyle.menu.signal.text : S.text, S.text);
for (const f of ['models/title.js', 'models/menu_ui.js', 'models/far_tower.js', '../game/js/quest/relayWake.js']) {
  const t = fs.readFileSync(new URL(f.startsWith('..') ? '../../../' + f.slice(3) : '../../../design/' + f, import.meta.url), 'utf8');
  assert.ok(!/\bSOS\b/i.test(t), 'no SOS left in ' + f);
}
console.log('signal: PASS');
