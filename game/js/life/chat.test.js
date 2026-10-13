// chat.test.js (LIFE-05): pairing rules, stop/face, clip alternation, duration, cooldown, 8 m gate, 6 s gap, interrupt, determinism, 0 alloc.
import assert from 'node:assert/strict';
import { createChat, PAIR_R, TURN_STEPS, COOLDOWN_STEPS, BARK_GAP_STEPS, DUR_MIN, DUR_SPAN } from './chat.js';

const act = (kind) => ({ kind, at: [0, 0], from: 0, to: 24, dwell: 10, pose: 'idle' });
function mk(opt = {}) {
  const n = 3;
  const npcs = []; for (let i = 0; i < n; i++) npcs.push({ id: 'n' + i, home: [0, 0], activities: [act('chat'), act('work')] });
  const s = { life: { npcs }, n, act: new Int16Array(n), social: new Float32Array(n).fill(0.9) };
  const x = new Float32Array(n), y = new Float32Array(n);
  x[1] = 1.5; x[2] = 40;
  const player = { x: 2, y: 0 }, plays = [], busy = new Set();
  const has = opt.has || ((k) => /^life\.chat\.any\.[1-3]$/.test(k));
  const barks = { speaker: null, has, cancelled: 0, cancel() { this.cancelled++; },
    play(k, sp, rep) { assert.equal(rep, true); plays.push({ k, sp }); this.speaker = sp; return true; } };
  const chat = createChat({ schedule: s, x, y, player, barks, data: { barks: opt.bk || {} }, talkingToPlayer: (i) => busy.has(i), seed: 7 });
  return { chat, s, x, y, player, plays, busy, barks };
}
const run = (c, steps) => { for (let i = 0; i < steps; i++) c.chat.step(); };

// pairing: within range, social, kind chat
{
  const c = mk(); run(c, 60);
  assert.equal(c.chat.partner(0), 1); assert.equal(c.chat.partner(1), 0); assert.equal(c.chat.partner(2), -1);
  assert.ok(c.chat.stopped(0) && c.chat.stopped(1) && !c.chat.stopped(2));
  const d = mk(); d.s.social[1] = 0.4; run(d, 120); assert.equal(d.chat.partner(0), -1, 'social gate');
  const e = mk(); e.s.act[1] = 1; run(e, 120); assert.equal(e.chat.partner(0), -1, 'schedule must pick chat');
  const f = mk(); f.x[1] = PAIR_R + 0.5; run(f, 120); assert.equal(f.chat.partner(0), -1, 'range');
  const g = mk(); g.busy.add(1); run(g, 120); assert.equal(g.chat.partner(0), -1, 'talking to player');
}
// clips alternate, first line at pairing (player within 8 m), 6 s gap
{
  const c = mk(); run(c, 60);
  assert.equal(c.plays.length, 1); assert.match(c.plays[0].k, /^life\.chat\.any\.\d$/);
  assert.equal(c.chat.talker(0), true); assert.equal(c.chat.talker(1), false);
  run(c, TURN_STEPS); assert.equal(c.chat.talker(0), false); assert.equal(c.chat.talker(1), true);
  assert.equal(c.plays.length, 1, '2.5 s turn < 6 s gap: no second line');
  run(c, BARK_GAP_STEPS); assert.ok(c.plays.length >= 2, 'line after the 6 s gap');
}
// 8 m gate: player far -> silent, still paired
{
  const c = mk(); c.player.x = 30; run(c, 600);
  assert.equal(c.plays.length, 0); assert.equal(c.chat.partner(0), 1);
}
// length 8-14 s, then cooldown 90 s, social drops, then pairs again
{
  const c = mk(); run(c, 60);
  let t = 0; while (c.chat.partner(0) >= 0 && t < 2000) { c.chat.step(); t++; }
  assert.ok(t >= DUR_MIN - 2 && t <= DUR_MIN + DUR_SPAN, 'duration ' + t);
  assert.ok(Math.abs(c.s.social[0] - 0.5) < 1e-6);
  c.s.social[0] = c.s.social[1] = 0.9; run(c, COOLDOWN_STEPS - 120);
  assert.equal(c.chat.partner(0), -1, 'cooldown');
  run(c, 300); assert.equal(c.chat.partner(0), 1, 'pairs again after cooldown');
}
// player interrupt (host call and talkingToPlayer flag) ends the pair and cancels the bark
{
  const c = mk(); run(c, 100); c.chat.interrupt(1);
  assert.equal(c.chat.partner(0), -1); assert.equal(c.chat.stopped(1), false); assert.ok(c.barks.cancelled >= 1);
  const d = mk(); run(d, 100); d.busy.add(0); d.chat.step();
  assert.equal(d.chat.partner(1), -1);
}
// pair-specific key beats the fallback
{
  const bk = { 'life.chat.n0.n1.1': [{}], 'life.chat.n0.n1.2': [{}] };
  const c = mk({ bk, has: (k) => /^life\.chat\.any\.[1-3]$/.test(k) || k in bk });
  run(c, 60);
  assert.match(c.plays[0].k, /^life\.chat\.n0\.n1\.[12]$/);
}
// determinism + 0 alloc
{
  const sig = () => { const c = mk(); const out = []; for (let i = 0; i < 6000; i++) { c.chat.step(); if (i % 50 === 0) out.push(c.chat.partner(0), c.plays.length, c.plays.length ? c.plays[c.plays.length - 1].k : ''); } return out.join(','); };
  assert.equal(sig(), sig());
  const c = mk(); c.barks.play = () => true;
  run(c, 20000); globalThis.gc && globalThis.gc();
  const h0 = process.memoryUsage().heapUsed; run(c, 300000);
  const d = process.memoryUsage().heapUsed - h0; assert.ok(d < 1000000, 'heap growth ' + d);
}
console.log('chat.test.js ok');
