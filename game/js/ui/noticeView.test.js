// CH1-04a noticeView tests. Run: node --expose-gc game/js/ui/noticeView.test.js
import assert from 'node:assert/strict';
import { createNoticeView, FADE_IN, HOLD, FADE_OUT } from './noticeView.js';
import { NOTICE_TEXT } from './noticeText.js';

const mkUi = () => { const cells = new Map(); return { cols: 100, rows: 40, cells, n: 0, setCellRGB(x, y, g, r, gg, b) { this.n++; cells.set(y * 100 + x, [g, r, gg, b]); } }; };
const adv = (v, sec) => { for (let i = 0; i < Math.round(sec * 100); i++) v.update(0.01); };

// text table: lengths per spec, and the key push resolves
for (const k of Object.keys(NOTICE_TEXT)) { const e = NOTICE_TEXT[k]; assert.ok(e.title.length <= 30 && e.lines.length <= 3 && e.lines.every(l => l.length <= 38), k); }
{ const v = createNoticeView(); assert.ok(v.push('relay')); assert.equal(v.title, 'BEND RELAY AWAKENED'); assert.equal(v.push('nope'), false); }

// timings
{ const v = createNoticeView(); v.push('A', ['x']);
  assert.equal(v.alpha, 0); adv(v, FADE_IN / 2); assert.ok(Math.abs(v.alpha - 0.5) < 0.05);
  adv(v, FADE_IN / 2 + HOLD / 2); assert.equal(v.alpha, 1);
  adv(v, HOLD / 2 + FADE_OUT / 2); assert.ok(Math.abs(v.alpha - 0.5) < 0.05);
  adv(v, FADE_OUT / 2 + 0.05); assert.equal(v.active, false); assert.equal(v.alpha, 0); }

// queue: order, cap 2 pending, oldest pending dropped, showing never dropped
{ const v = createNoticeView(); for (const n of ['A', 'B', 'C', 'D']) v.push(n, []);
  assert.equal(v.title, 'A'); assert.equal(v.pendingCount, 2);
  adv(v, 4.4); assert.equal(v.title, 'C'); adv(v, 4.4); assert.equal(v.title, 'D'); adv(v, 4.4); assert.equal(v.active, false); }

// clamp lengths, body max 3
{ const v = createNoticeView(); v.push('T'.repeat(50), ['l1', 'l2', 'l3', 'l4']); assert.equal(v.title.length, 30); const ui = mkUi(); adv(v, 1); v.draw(ui, false); assert.ok(ui.n > 0); }

// hidden: no draw and timer paused
{ const v = createNoticeView(); v.push('A', ['x']); adv(v, 1); const ui = mkUi(); v.draw(ui, true); assert.equal(ui.n, 0);
  for (let i = 0; i < 1000; i++) v.update(0.01, true); assert.equal(v.alpha, 1); assert.equal(v.active, true); }

// draw paints text glyphs; 0-alloc
{ const v = createNoticeView(); v.push('waystone'); adv(v, 1); const ui = mkUi(); v.draw(ui, false);
  const glyphs = [...ui.cells.values()].filter(c => c[0] > 0).map(c => String.fromCharCode(c[0] + 32)).join(''); assert.ok(glyphs.includes('WAYSTONE AWAKENED'.slice(0, 3)));
  const sink = { cols: 100, rows: 40, setCellRGB() {} }; for (let i = 0; i < 2000; i++) { v.draw(sink, false); v.update(0.0001); }
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 200000; i++) { v.draw(sink, false); v.update(0.00001); }
    global.gc(); const d = process.memoryUsage().heapUsed - h0; assert.ok(d < 200000, 'draw heap growth ' + d); } }

console.log('noticeView: ALL PASS');
