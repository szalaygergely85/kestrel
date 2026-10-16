// INTRO-PLAYER-01: sequence state machine + slide decode + player input.
import assert from 'node:assert/strict';
import { createTitleMenuHost } from '../titleMenuHost.js';
import { createMemoryAdapter } from '../quest/save/saveState.js';
import { holdSeconds, createIntroSequence, createIntroPlayer, decodeSlide, loadIntroSlides, INTRO_SLIDES, drawIntroFrame } from './introPlayer.js';

// timing: 3 slides of 4 s
{
  const seen = []; let done = 0;
  const s = createIntroSequence({ count: 3, slideSec: 4, fadeSec: 0.5, onSlide: (i) => seen.push(i), onDone: () => done++ });
  assert.deepEqual(seen, [0]); assert.equal(s.alpha, 0);
  s.update(0.25); assert.ok(Math.abs(s.alpha - 0.5) < 1e-9);
  s.update(1.75); assert.equal(s.alpha, 1);
  s.update(1.75); assert.ok(Math.abs(s.alpha - 0.5) < 1e-9); // 3.75 s: fading out
  s.update(0.25); assert.equal(s.index, 1); assert.deepEqual(seen, [0, 1]);
  s.next(); assert.equal(s.index, 1); assert.equal(s.t, 0.5); // mid-fade-in: first input finishes the fade
  s.next(); assert.equal(s.index, 2); assert.equal(s.done, false);
  s.update(10); assert.equal(s.done, true); assert.equal(done, 1);
  s.skip(); s.update(1); assert.equal(done, 1); assert.equal(s.alpha, 0); assert.deepEqual(seen, [0, 1, 2]);
}
// skip
{
  let done = 0; const s = createIntroSequence({ count: 9, onDone: () => done++ });
  s.skip(); s.skip(); assert.equal(s.done, true); assert.equal(done, 1);
}
// empty + throwing hooks
{
  let done = 0; createIntroSequence({ count: 0, onDone: () => done++ }); assert.equal(done, 1);
  const s = createIntroSequence({ count: 2, onSlide: () => { throw new Error('x'); } }); s.next(); s.next(); s.next(); s.next(); assert.equal(s.done, true);
}
// decode + loader + player + draw
const b64 = (a) => Buffer.from(a).toString('base64');
const mk = () => ({ version: 1, cols: 4, rows: 2, ramp: ' .#', palette: ['#102030', '#ffffff'], glyphs: ' .#. #.#', fg: b64([1, 1, 1, 1, 1, 1, 1, 1]), bg: b64([0, 0, 0, 0, 0, 0, 0, 0]) });
{
  const d = decodeSlide(mk()); assert.equal(d.glyph[2], '#'.charCodeAt(0) - 32); assert.deepEqual([...d.rgb.slice(0, 3)], [16, 32, 48]);
  assert.equal(decodeSlide({ ...mk(), glyphs: 'x' }), null); assert.equal(decodeSlide(null), null);
}
{
  const got = await loadIntroSlides(async (u) => { if (u.includes('02-lamp') || u.includes('05-alive')) throw new Error('404'); return mk(); }, 'x/');
  assert.equal(got.length, INTRO_SLIDES.length - 2); assert.ok(got.every((e) => e.lines.length === 2 && e.lines.every((l) => l.length <= 60)));
  assert.equal((await loadIntroSlides(async () => { throw new Error('404'); })).length, 0);
  assert.equal(createIntroPlayer({ entries: [], onDone() {} }), null);
}
{
  let done = 0; const e = [{ slide: decodeSlide(mk()), lines: ['hi'] }, { slide: decodeSlide(mk()), lines: ['yo'] }];
  const p = createIntroPlayer({ entries: e, onDone: () => done++ });
  const key = (k) => (c) => c === k;
  p.step(key('Space')); assert.equal(p.seq.index, 0); assert.equal(p.seq.alpha, 1); // first input: finish fade-in
  p.step(key('Space')); assert.equal(p.seq.index, 1);
  p.click(); p.click(); assert.equal(p.done, true); assert.equal(done, 1);
  const q = createIntroPlayer({ entries: e, onDone: () => done++ }); q.step(key('Escape')); assert.equal(q.done, true); assert.equal(done, 2);
  const cells = []; const ui = { cols: 8, rows: 6, clear() {}, setCellRGB: (...a) => cells.push(a) };
  drawIntroFrame(ui, e[0].slide, e[0].lines, 1); assert.ok(cells.length > 0);
}
// OB-216: reading time from caption length; fades go through black; menu not drawn while the intro runs
{
  assert.equal(holdSeconds(['short']), 7);
  assert.ok(Math.abs(holdSeconds(['x'.repeat(100), 'y'.repeat(100)]) - (2.5 + 0.07 * 200)) < 1e-9);
  const long = 'z'.repeat(60), e = [{ slide: decodeSlide(mk()), lines: [long, long] }, { slide: decodeSlide(mk()), lines: ['a'] }];
  const p = createIntroPlayer({ entries: e, onDone() {} });
  const total = holdSeconds(e[0].lines) + 1.6; // 10.9 s
  p.step(() => false, total - 0.01); assert.equal(p.seq.index, 0);
  p.step(() => false, 0.02); assert.equal(p.seq.index, 1);
  // any key (pressed.any) advances, Escape skips
  const any = () => false; any.any = () => true;
  p.step(any); assert.equal(p.seq.t >= 0.8, true);
  const pe = createIntroPlayer({ entries: e, onDone() {} }); pe.step((c) => c === 'Escape'); assert.equal(pe.done, true);
  // black frame at alpha 0: every cell opaque black (no menu/world showing through), no caption
  const cells = new Map(); const ui = { cols: 6, rows: 5, clear() {}, setCellRGB: (x, y, g, ...r) => cells.set(x + ',' + y, [g, ...r]) };
  drawIntroFrame(ui, e[0].slide, e[0].lines, 0);
  assert.equal(cells.size, 30); assert.ok([...cells.values()].every((c) => c.every((v) => v === 0)));
}
{
  let drawn = 0, news = 0, step = 0;
  const entries = [{ slide: decodeSlide(mk()), lines: ['hi'] }, { slide: decodeSlide(mk()), lines: ['yo'] }];
  const host = createTitleMenuHost({ adapter: createMemoryAdapter(), onNewGame: () => news++, onContinue() {}, onSettings() {}, createIntro: (done) => createIntroPlayer({ entries, onDone: done }) });
  const menuDraw = host.menu.draw; host.menu.draw = (u) => { drawn++; return menuDraw.call(host.menu, u); };
  const ui = { cols: 20, rows: 10, clear() {}, setCellRGB() {}, setCell() {}, text() {}, drawText() {}, fill() {} };
  host.step((c) => c === 'Enter'); host.step((c) => c === 'Enter'); // New game -> slot list -> first slot
  assert.equal(host.introOpen, true);
  const none = () => false;
  for (let i = 0; i < 1500; i++) { host.draw(ui); host.step(none, 1 / 60); step++; if (!host.active) break; }
  assert.equal(drawn, 0, 'menu must not draw while the intro plays'); assert.equal(news, 1); assert.equal(host.active, false);
}
console.log('introPlayer.test.js ok');
