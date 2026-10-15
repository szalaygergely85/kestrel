// SPELL-03: Spells tab golden cells. Run: node game/js/quest/spellPageView.test.js
// Stand-in spell data (SPELL-01 spellDefs.js / spellBook.js merge later; the view only needs this shape).
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';
import itemsMod from '../../../design/items.js';
import invStyleMod from '../../../design/models/inventory_ui.js';
import { createInventoryScreen } from './inventoryScreen.js';
import { ensureInventory } from './sim/inventory.js';
import { tierText } from './spellPageView.js';

paletteMod; itemsMod; invStyleMod;
const A = globalThis.ASSETS, style = A.uiStyle.inventory, P = style.panel;
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const T = (m, c, d, k, extra = {}) => ({ mana: m, cd: c, dmg: d, ...extra });
const defs = [
  { id: 'fireball', name: 'Fireball', branch: 'fire', root: true, glyph: '*', colour: 'ember', tiers: [T(5, 0.5, 3, { r: 2 }), T(5, 0.5, 4, { r: 3.5 }), T(9, 0.5, 5, { r: 4 })] },
  { id: 'firering', name: 'Fire Ring', branch: 'fire', glyph: 'O', colour: 'ember', tiers: [T(8, 4, 4), T(8, 3.5, 6), T(7, 3, 8)] },
  { id: 'spark', name: 'Spark', branch: 'light', root: true, glyph: '+', colour: 'aether', tiers: [T(4, 1.5, 1, { stun: 0.8 }), T(4, 1.2, 2), T(3, 1, 3)] },
  { id: 'lightorb', name: 'Light Orb', branch: 'light', glyph: 'o', tiers: [T(6, 0, 0), T(6, 0, 0), T(5, 0, 0)] },
  { id: 'ward', name: 'Ward', branch: 'light', glyph: 'o', tiers: [T(8, 12), T(8, 10), T(7, 8)] },
  { id: 'gust', name: 'Gust', branch: 'wind', root: true, glyph: '~', tiers: [T(5, 2), T(5, 1.8), T(4, 1.5)] },
  { id: 'updraft', name: 'Updraft', branch: 'wind', glyph: '^', tiers: [T(6, 5), T(5, 4), T(4, 3)] },
];
const st = { fireball: 1, firering: 0, spark: 3, lightorb: 0, ward: 0, gust: 0, updraft: 0 }; let scrolls = 1; const used = [];
const book = { tier: (id) => st[id] | 0, canRaise: (id) => st[id] > 0 && st[id] < 3 };
const spellPage = { defs, book, scrolls: () => scrolls, useScroll: (id) => { if (scrolls < 1 || !book.canRaise(id)) return 0; scrolls--; used.push(id); return ++st[id]; } };
const player = { components: {} }; const inv = ensureInventory(player, { pack: [], left: null, right: null });
const toasts = [];
const view = createInventoryScreen({ style, items: A.items, rgb: A.palette.rgb, inventoryOf: () => inv, spellPage, toast: { say: (m) => toasts.push(m) } });
const cols = 160, rows = 60, ch = new Int32Array(cols * rows);
const ui = { cols, rows, setCellRGB(x, y, code) { ch[y * cols + x] = code + 32; } };
const edge = new Set(); const input = { pressed: (k) => edge.has(k), isDown: () => false, consumePressed() { edge.clear(); } };
const step = (...k) => { k.forEach((x) => edge.add(x)); view.step(1 / 60, input, true); };
const row = (y) => { let s = ''; for (let x = 0; x < P.w; x++) s += String.fromCharCode(ch[(P.y + y) * cols + P.x + x] || 32); return s; };
const draw = () => { ch.fill(32); view.draw(ui); let all = ''; for (let y = 0; y < P.h; y++) all += row(y) + '\n'; return all; };

view.open(); step('KeyT');
let s = draw();
ok(/FIRE.*LIGHT.*WIND/.test(row(3)), 'AC1 column titles Fire / Light / Wind');
ok(row(5).includes('Fireball') && row(6).includes('[#--]  mp 5  cd 0.5 s'), 'AC1 Fireball card: name + pips + mp/cd');
ok(row(5).includes('Spark') && row(6).includes('[###]  mp 3  cd 1 s'), 'AC1 Spark card at level 3');
ok(row(11).includes('Fire Ring') && row(12).includes('Not learned'), 'AC1 unlearned card says Not learned');
ok(row(11).includes('Ward') === false && row(15).includes('Ward') && row(16).includes('Not learned'), 'AC1 Ward is third in Light');
ok(row(19).includes('Fireball  level 1') && row(20) .includes('Now: 5 mp, dmg 3, radius 2, cooldown 0.5 s') && row(21).includes('Next level: 5 mp, dmg 4, radius 3.5, cooldown 0.5 s'), 'AC2 Fireball 1 -> 2 golden lines');
ok(row(24).includes('Spell Scrolls: 1') && row(25).includes('[E] Use Spell Scroll'), 'AC3 footer');
ok(!/esc/i.test(s), 'AC4 no Esc text');
for (let y = 0; y < P.h; y++) ok(row(y).length <= 160, 'AC4 row fits');
step('KeyD'); s = draw();
ok(row(19).includes('Spark  level 3') && row(21).includes('Max level') && !row(25).includes('[E]'), 'AC2 level 3 shows Max level, no scroll action');
step('KeyA', 'KeyS'); s = draw();
ok(row(19).includes('Fire Ring  not learned') && !row(25).includes('[E]'), 'unlearned card cannot take a scroll');
step('KeyW'); step('KeyE'); s = draw();
ok(row(25).includes('Raise Fireball to level 2?  [E] Yes  [Q] No'), 'AC3 confirm line');
step('KeyQ'); s = draw();
ok(st.fireball === 1 && scrolls === 1 && !row(25).includes('Raise'), 'AC3 Q cancels, no change');
step('KeyE'); step('KeyE'); s = draw();
ok(st.fireball === 2 && scrolls === 0 && used[0] === 'fireball' && toasts[0] === 'Fireball is now level 2', 'AC3 Yes calls useScroll');
ok(row(24).includes('Spell Scrolls: 0') && !row(25).includes('[E]'), 'footer after use');
// no pack change, tab toggles back, close works
step('KeyT'); s = draw(); ok(s.includes(' PACK '), 'T returns to the pack');
step('KeyT'); step('KeyI'); ok(!view.isOpen, 'I closes from the page');
// 0 alloc per draw (heap delta over many draws)
view.open(); step('KeyT'); draw();
if (globalThis.gc) { globalThis.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 2000; i++) view.draw(ui); const d = process.memoryUsage().heapUsed - h0; ok(d < 2e6, 'AC4 draw ~0 alloc (' + d + ' B)'); }
ok(tierText({ mana: 4, cd: 1, stun: 0.8 }) === '4 mp, stun 0.8 s, cooldown 1 s', 'tierText');
console.log(`spellPageView: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
