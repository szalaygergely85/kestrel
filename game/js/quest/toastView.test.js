// game/js/quest/toastView.test.js (US-091a2, architecture.md 37.16.3). Headless Node ESM, no framework.
// Run: node game/js/quest/toastView.test.js
//
// The loot toast against the REAL designer style (design/items.js `ASSETS.items.toast`) and item defs, drawn into a
// recording fake UI layer: max 3 lines, newest at the bottom, same item restarts its line with the total, "Pack full",
// 1.5 s life, top-centre placement, name pop + fade colours.
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';
import itemsMod from '../../../design/items.js';
import { createToastView, lineWidth } from './toastView.js';

paletteMod; itemsMod;
const A = globalThis.ASSETS;
const style = A.items.toast, defs = A.items.defs;
const rgb = A.palette.rgb || (() => {
  const o = {};
  for (const k of Object.keys(A.palette.colors)) { const h = A.palette.colors[k]; o[k] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  return o;
})();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeEvents() {
  const ls = new Map();
  return {
    on(n, fn) { if (!ls.has(n)) ls.set(n, new Set()); ls.get(n).add(fn); return () => ls.get(n).delete(fn); },
    emit(n, p) { const s = ls.get(n); if (s) for (const fn of s) fn(p); },
  };
}

function makeUi(cols = 160, rows = 60) {
  const ch = new Int32Array(cols * rows).fill(-1);
  const fg = new Array(cols * rows).fill(null);
  return {
    cols, rows, ch, fg,
    setCellRGB(x, y, code, r, g, b) { ch[y * cols + x] = code + 32; fg[y * cols + x] = [r, g, b]; },
    row(y) { let s = ''; for (let x = 0; x < cols; x++) { const c = ch[y * cols + x]; s += c < 0 ? '' : String.fromCharCode(c); } return s; },
    clear() { ch.fill(-1); fg.fill(null); },
  };
}

const added = (events, id, n = 1) => events.emit('inventory:added', { id, n });
const R0 = style.anchor.row;

{
  const events = makeEvents();
  const view = createToastView(events, style, defs, rgb);
  const ui = makeUi();
  added(events, 'boar.meat');
  view.draw(ui, 10);
  ok('item line text "% +1 Boar Meat" (plate pad included)', ui.row(R0).trim() === '% +1 Boar Meat', JSON.stringify(ui.row(R0)));
  const L = view.lines[0];
  const x0 = (ui.cols - lineWidth(L)) >> 1;
  ok('line is centred', ui.ch[R0 * ui.cols + x0] === '%'.charCodeAt(0));
  ok('glyph in the item colour', ui.fg[R0 * ui.cols + x0].join() === rgb[defs['boar.meat'].glyph.c].join());
  ok('"+1" in gold', ui.fg[R0 * ui.cols + x0 + 2].join() === style.colors.plus.join());
  ok('name pops white on the first steps', ui.fg[R0 * ui.cols + x0 + 5].join() === style.pop.name.join());

  ui.clear(); view.draw(ui, 10 + 10 / 60);
  ok('name settles to uiText after the pop', ui.fg[R0 * ui.cols + x0 + 5].join() === style.colors.name.join());

  added(events, 'boar.hide'); added(events, 'boar.tusk');
  ui.clear(); view.draw(ui, 10.2);
  ok('3 lines, oldest at the top, newest at the bottom',
    ui.row(R0).includes('Boar Meat') && ui.row(R0 + 1).includes('Boar Hide') && ui.row(R0 + 2).includes('Boar Tusk'));

  events.emit('inventory:full', { id: 'b' });
  ui.clear(); view.draw(ui, 10.3);
  ok('a 4th line pushes the oldest out (max 3)', view.used === 3 && ui.row(R0).includes('Boar Hide') && ui.row(R0 + 2).trim() === 'Pack full', [0, 1, 2].map((i) => ui.row(R0 + i).trim()).join(' / '));
  ok('"Pack full" in its message colour', ui.fg[(R0 + 2) * ui.cols + ((ui.cols - 9) >> 1)].join() === style.messages.packFull.fg.join());

  added(events, 'boar.hide', 2);
  ui.clear(); view.draw(ui, 10.4);
  ok('same item while visible: total "+3" on its line, no new line', view.used === 3 && ui.row(R0).includes('+3 Boar Hide'), [0, 1, 2].map((i) => ui.row(R0 + i).trim()).join(' / '));

  ui.clear(); view.draw(ui, 10.3 + 1.49);
  ok('restarted hide line still shown just under 1.5 s after its restart; tusk expired', view.used === 2 && ui.row(R0).includes('Boar Hide'), view.used);
  ui.clear(); view.draw(ui, 10.4 + 1.51);
  ok('everything expires after 1.5 s', view.used === 0 && ui.row(R0) === '');

  added(events, 'boar.meat');
  view.draw(ui, 20);
  ui.clear(); view.draw(ui, 20 + (style.lifeSteps - 2) / 60);
  const L2 = view.lines[0], xx = (ui.cols - lineWidth(L2)) >> 1;
  const nm = ui.fg[R0 * ui.cols + xx + 5];
  ok('fade: name lerps towards uiDim in the last steps', nm.join() !== style.colors.name.join() && nm[0] < style.colors.name[0], nm.join());

  view.reset();
  ok('reset clears every line', view.used === 0);
  view.dispose();
  added(events, 'boar.meat');
  ok('dispose drops the listeners', view.used === 0);
}

// No allocation while drawing (strings built on the event only).
{
  const events = makeEvents();
  const view = createToastView(events, style, defs, rgb);
  const ui = { cols: 160, rows: 60, setCellRGB() {} };
  added(events, 'boar.meat'); added(events, 'boar.hide'); events.emit('inventory:full', {});
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) view.draw(ui, 1 + i * 1e-6);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    ok('draw allocates nothing (--expose-gc heap check)', after <= before + 2e5, `before=${before} after=${after}`);
  } else {
    console.log('(skip) zero-allocation heap check needs --expose-gc');
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
