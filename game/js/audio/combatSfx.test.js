import assert from 'node:assert/strict';
import { createCombatSfx, COMBAT_CUES } from './combatSfx.js';

function mk(extra = {}) {
  const s = { tones: [], noises: [], t: 1000, muted: false };
  const api = createCombatSfx({ tone: (o) => s.tones.push(o), noise: (o) => s.noises.push(o), isMuted: () => s.muted, now: () => s.t, ...extra });
  return { s, api };
}
{ // table sanity: peaks bounded, frozen
  for (const [k, c] of Object.entries(COMBAT_CUES)) {
    for (const d of [c.tone, c.noise]) if (d) { assert.ok(d.peak > 0 && d.peak <= 0.3, k); assert.ok(Object.isFrozen(d)); }
    assert.ok(Object.isFrozen(c));
  }
}
{ // event -> cue mapping
  const { s, api } = mk();
  assert.ok(api.swing()); assert.equal(api.counts.swing, 1);
  s.t += 500;
  api.hit({ source: 'player', target: 'boar1', heavy: false }); assert.equal(api.counts.hitLight, 1);
  s.t += 500;
  api.hit({ source: 'player', target: 'boar1', heavy: true }); assert.equal(api.counts.hitHeavy, 1);
  api.hit({ source: 'beast', target: 'player', heavy: 0 }); assert.equal(api.counts.hurt, 1);
  assert.equal(api.hit({ source: 'beast', target: 'x' }), false); assert.equal(api.hit(null), false);
  api.beastDied(); assert.equal(api.counts.beastDeath, 1);
  assert.ok(s.tones.length >= 4 && s.noises.length >= 4);
}
{ // rate limit: same cue within 60 ms dropped, other cues unaffected
  const { s, api } = mk();
  assert.ok(api.hit({ source: 'player', target: 'a' }));
  s.t += 30; assert.equal(api.hit({ source: 'player', target: 'a' }), false);
  assert.ok(api.hit({ source: 'player', target: 'a', heavy: 1 })); // different cue
  s.t += 40; assert.ok(api.hit({ source: 'player', target: 'a' }));
  assert.equal(api.counts.hitLight, 2);
}
{ // mute respected
  const { s, api } = mk(); s.muted = true;
  assert.equal(api.swing(), false); api.step(2000, true);
  assert.equal(s.tones.length + s.noises.length, 0);
}
{ // heartbeat: lub-dub while low, stops when not low, silent when muted
  const { s, api } = mk();
  for (let i = 0; i < 120; i++) { s.t += 1000 / 60; api.step(1000 / 60, true); }  // 2 s
  const n = api.counts.heartbeat; assert.ok(n >= 4 && n <= 6, 'beats ' + n);
  for (let i = 0; i < 120; i++) { s.t += 1000 / 60; api.step(1000 / 60, false); }
  assert.equal(api.counts.heartbeat, n);
  s.muted = true; for (let i = 0; i < 120; i++) { s.t += 1000 / 60; api.step(1000 / 60, true); }
  assert.equal(api.counts.heartbeat, n);
}
console.log('combatSfx tests ok');
