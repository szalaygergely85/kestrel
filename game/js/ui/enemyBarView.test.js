import assert from 'node:assert/strict';
import { createEnemyBarView, barLabel, MAX_WIDTH } from './enemyBarView.js';
import { setEnemyBarsOn, enemyBarsOn } from './combatHudFlags.js';

const rgb = { uiText: [200, 200, 200], uiDim: [100, 100, 100], danger: [255, 0, 0], gold: [255, 200, 0] };
const band = { bandAt: () => 6 };
const fakeUi = (cols = 160, rows = 60) => { const cells = new Map(); return { cols, rows, cells, setCellRGB(x, y, g, fr, fg, fb) { cells.set(y * cols + x, { ch: String.fromCharCode(g + 32), fr, fg, fb }); } }; };
const rowText = (ui, y) => { let s = ''; for (let x = 0; x < ui.cols; x++) { const c = ui.cells.get(y * ui.cols + x); s += c ? c.ch : ' '; } return s.trimEnd(); };
const project = (x, y, z, out) => { out.c = 80; out.r = 20; return true; };
const mk = (o = {}) => ({ id: 'b1', name: 'Boar', x: 1, y: 2, z: 3, spawnX: 10, spawnY: 10, hp: 5, maxHp: 10, dead: false, dist: 8, visible: true, engaged: true, targeted: false, hitAt: -Infinity, level: 0, bossName: '', ...o });
const run = (view, beasts, t = 0, dt = 1) => { view.update(beasts.length, (i, rec) => Object.assign(rec, beasts[i]), t, dt, 6); };

// labels: frac 0 / 0.5 / 1, level 1 / 10, width cap
assert.equal(barLabel(0, 6, 'Boar', false), '[----------] Lv 6 Boar');
assert.equal(barLabel(0.5, 6, 'Boar', false), '[#####-----] Lv 6 Boar');
assert.equal(barLabel(1, 6, 'Boar', false), '[##########] Lv 6 Boar');
assert.equal(barLabel(0.01, 1, 'Boar', false), '[#---------] Lv 1 Boar', 'any hp shows a cell');
assert.equal(barLabel(1, 10, 'Boar', false), '[##########] Lv 10 Boa', 'level 10: two digits, name cut to the 22-cell cap');
assert.equal(barLabel(1, 10, 'Boar', false).length, MAX_WIDTH);
assert.ok(barLabel(1, 10, 'Goblin Spear Thrower', false).length <= MAX_WIDTH);
assert.equal(barLabel(1, 0, 'Warden', true), '[##########] Boss Ward');

// golden cells: drawn centred on the projected column, row r-1
let view = createEnemyBarView({ rgb, project, band }), ui = fakeUi();
run(view, [mk()]); view.draw(ui, false);
assert.equal(rowText(ui, 19).trim(), '[#####-----] Lv 6 Boar');
const x0 = 80 - 11;
const hash = ui.cells.get(19 * 160 + x0 + 1), dash = ui.cells.get(19 * 160 + x0 + 8);
assert.deepEqual([hash.fr, hash.fg, hash.fb], [255, 200, 0], 'Lv 6 vs player 6 = gold');
assert.deepEqual([dash.fr, dash.fg, dash.fb], [100, 100, 100]);
// frac ~0 and 1
for (const [hp, text] of [[0.0001, '[#---------]'], [10, '[##########]']]) {
  const v = createEnemyBarView({ rgb, project, band }), u = fakeUi(); run(v, [mk({ hp })]); v.draw(u, false);
  assert.ok(rowText(u, 19).trim().startsWith(text), String(hp));
}
// a hit lowers frac next frame
run(view, [mk({ hp: 2 })], 0.1, 0.016); ui = fakeUi(); view.draw(ui, false);
assert.ok(rowText(ui, 19).includes('[##--------]'));
// edge clamp
const edge = createEnemyBarView({ rgb, project: (x, y, z, o) => { o.c = 2; o.r = 0; return true; }, band }); ui = fakeUi();
run(edge, [mk()]); edge.draw(ui, false);
assert.ok(rowText(ui, 0).startsWith('[#####-----]'), 'clamped to the left/top edge');
const redge = createEnemyBarView({ rgb, project: (x, y, z, o) => { o.c = 159; o.r = 59; return true; }, band }); ui = fakeUi();
run(redge, [mk()]); redge.draw(ui, false);
assert.ok(rowText(ui, 58).endsWith('Boar') && ui.cells.has(58 * 160 + 159), 'clamped to the right/bottom edge');
// fade out over 0.3 s
view = createEnemyBarView({ rgb, project, band }); run(view, [mk()], 0, 1);
run(view, [], 1, 0.15); ui = fakeUi(); view.draw(ui, false);
const half = ui.cells.get(19 * 160 + x0 + 1); assert.ok(half && half.fr > 0 && half.fr < 255, 'half faded');
run(view, [], 1.2, 0.2); ui = fakeUi(); view.draw(ui, false); assert.equal(ui.cells.size, 0, 'gone after 0.3 s');
// hidden (pause/inventory/map)
view = createEnemyBarView({ rgb, project, band }); run(view, [mk()]); ui = fakeUi(); view.draw(ui, true); assert.equal(ui.cells.size, 0);
// Off: model not called, nothing drawn
let calls = 0, on = true;
view = createEnemyBarView({ rgb, project, band, enabled: () => on, select: () => { calls++; return 0; } });
run(view, [mk()]); assert.equal(calls, 1); on = false; run(view, [mk()]); run(view, [mk()]);
ui = fakeUi(); view.draw(ui, false); assert.equal(calls, 1, 'Off: model not called'); assert.equal(ui.cells.size, 0);
// default flag is On
assert.equal(enemyBarsOn(), true); setEnemyBarsOn(false); assert.equal(enemyBarsOn(), false); setEnemyBarsOn(true);
// behind the camera: not drawn
view = createEnemyBarView({ rgb, project: () => false, band }); run(view, [mk()]); ui = fakeUi(); view.draw(ui, false); assert.equal(ui.cells.size, 0);
console.log('enemyBarView.test.js ok');
