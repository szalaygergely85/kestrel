import assert from 'node:assert/strict';
import { createUiSfx, UI_CUES, QUEST_EVENT_CUE } from './uiSfx.js';

function make(over = {}) {
  const calls = [], pending = []; let t = 1000, muted = false;
  const s = createUiSfx({ tone: (o) => calls.push(o), isMuted: () => muted, now: () => t, later: (fn, ms) => pending.push({ fn, ms }), ...over });
  return { s, calls, pending, adv: (ms) => { t += ms; }, mute: (m) => { muted = m; }, flush: () => { while (pending.length) pending.shift().fn(); } };
}
// mapping: each quest event -> exactly one cue; unknown names ignored
{
  const m = make();
  for (const n of Object.keys(QUEST_EVENT_CUE)) { assert.equal(m.s.quest(n), true, n); m.adv(1000); }
  assert.equal(m.s.quest('quest:abandoned'), false);
  assert.equal(m.s.counts.questAccepted, 1); assert.equal(m.s.counts.questReady, 1); assert.equal(m.s.counts.questDone, 1);
}
// replaying the chain: accepted + done once each per quest (rate limit swallows a same-frame duplicate)
{
  const m = make();
  m.s.quest('quest:accepted'); m.s.quest('quest:accepted'); m.adv(2000); m.s.quest('quest:ready'); m.adv(2000); m.s.quest('quest:done'); m.s.quest('quest:done');
  assert.equal(m.s.counts.questAccepted, 1); assert.equal(m.s.counts.questDone, 1);
}
// multi-step: first step immediate, later steps via `later`, chord steps share delay 0
{
  const m = make();
  m.s.quest('quest:done'); assert.equal(m.calls.length, 3); assert.equal(m.pending.length, 1); m.flush(); assert.equal(m.calls.length, 4);
  const a = make(); a.s.quest('quest:accepted'); assert.equal(a.calls.length, 1); assert.ok(a.calls[0].freq < UI_CUES.questAccepted.steps[1].tone.freq, 'rising');
}
// rate limit + gap recovery
{
  const m = make();
  assert.equal(m.s.menuMove(), true); assert.equal(m.s.menuMove(), false); m.adv(UI_CUES.menuMove.minGapMs); assert.equal(m.s.menuMove(), true);
  assert.equal(m.s.itemGet(), true); assert.equal(m.s.itemGet(), false);
}
// muted = nothing scheduled, even deferred steps
{
  const m = make(); m.mute(true);
  assert.equal(m.s.quest('quest:done'), false); assert.equal(m.s.itemGet(), false); assert.equal(m.s.menuConfirm(), false);
  assert.equal(m.calls.length, 0); assert.equal(m.pending.length, 0);
  const d = make(); d.s.quest('quest:accepted'); d.mute(true); d.flush(); assert.equal(d.calls.length, 1, 'deferred step dropped when muted meanwhile');
}
// quiet + short
for (const [k, c] of Object.entries(UI_CUES)) for (const st of c.steps) assert.ok(st.tone.peak <= 0.16 && st.tone.duration + st.tone.release <= 0.8, k);
assert.ok(UI_CUES.menuMove.steps[0].tone.peak <= 0.04, 'menu tick very soft');
console.log('uiSfx tests OK');
