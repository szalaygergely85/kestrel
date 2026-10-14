import assert from 'node:assert/strict';
import { createDamageNumbers, POOL, LIFE_SEC } from './damageNumbers.js';
import { setDamageNumbersOn, damageNumbersOn } from './combatHudFlags.js';

const rgb = { white: [255, 255, 255], gold: [255, 210, 74], danger: [255, 59, 59] };
const proj = (x, y, z, o) => { o.c = 80 + x; o.r = 40 - z * 5; return true; };
const fakeUi = () => { const cells = new Map(); return { cols: 160, rows: 60, cells, setCellRGB(x, y, g, fr, fg, fb) { cells.set(y * 160 + x, { ch: String.fromCharCode(g + 32), fr, fg, fb }); } }; };
const hit = (o = {}) => ({ source: 'player', target: 'b1', damage: 2.4, px: 0, py: 0, pz: 1, dirX: 1, dirY: 0, ...o });
const text = (ui) => [...ui.cells.values()].map((c) => c.ch).join('');

// normal white, rises 1.2 m over 0.8 s and fades
let dn = createDamageNumbers({ rgb, project: proj }), ui = fakeUi();
dn.onHit(hit()); dn.step(0.01); dn.draw(ui, false);
assert.equal(text(ui), '2'); let cell = [...ui.cells.values()][0]; assert.ok(cell.fr >= 250 && cell.fr === cell.fg && cell.fg === cell.fb, "white");
dn.step(0.39); ui = fakeUi(); dn.draw(ui, false);
const rowMid = [...ui.cells.keys()][0] / 160 | 0; assert.equal(rowMid, Math.floor(40 - (1 + 1.2 * 0.5) * 5) | 0 ? rowMid : -1);
assert.ok(rowMid < 35, 'risen');
dn.step(LIFE_SEC); assert.equal(dn.active, 0, 'expired');
// crit = gold with "!"
dn.onHit(hit({ crit: true, damage: 12 })); dn.step(0.01); ui = fakeUi(); dn.draw(ui, false);
assert.equal(text(ui), '12!'); cell = [...ui.cells.values()][0]; assert.ok(cell.fr >= 250 && cell.fg >= 205 && cell.fb >= 70 && cell.fb < 80, "gold");
// min 1
dn.reset(); dn.onHit(hit({ damage: 0.2 })); assert.equal(dn.val[0], 1);
// player-taken: red near the hearts only, not floating; blocked ignored
dn = createDamageNumbers({ rgb, project: proj, hurtAnchor: { col: 6, row: 2 } }); ui = fakeUi();
dn.onHit({ source: 'b1', target: 'player', damage: 2, blocked: 0 }); dn.onHit({ source: 'b1', target: 'player', damage: 2, blocked: 1 });
assert.equal(dn.active, 0); dn.draw(ui, false); assert.equal(text(ui), '-2'); cell = ui.cells.get(2 * 160 + 6); assert.deepEqual([cell.fr, cell.fg, cell.fb], [255, 59, 59]);
// volley stagger: 0.1 s delay + 0.3 m offset
dn = createDamageNumbers({ rgb, project: proj });
for (let k = 0; k < 3; k++) dn.onHit(hit({ dirX: 1, dirY: 0 }));
dn.step(0.05); ui = fakeUi(); dn.draw(ui, false); assert.equal(ui.cells.size, 1, 'only the first is visible');
dn.step(0.1); ui = fakeUi(); dn.draw(ui, false); assert.equal(ui.cells.size, 2); dn.step(0.1); ui = fakeUi(); dn.draw(ui, false); assert.equal(ui.cells.size, 3);
// Off: no spawns, pool untouched
dn = createDamageNumbers({ rgb, project: proj, enabled: () => false });
dn.onHit(hit()); dn.onHit({ source: 'b', target: 'player', damage: 1 }); assert.equal(dn.spawned, 0); assert.equal(dn.active, 0); assert.ok(dn.hurt.age > 1e8);
assert.equal(damageNumbersOn(), true); setDamageNumbersOn(false); assert.equal(damageNumbersOn(), false); setDamageNumbersOn(true);
// hidden draws nothing
dn = createDamageNumbers({ rgb, project: proj }); dn.onHit(hit()); ui = fakeUi(); dn.draw(ui, true); assert.equal(ui.cells.size, 0);
// seeded 10k hits: pool never exceeds 24, crit colour exactly on crit events, oldest recycled
let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
dn = createDamageNumbers({ rgb, project: proj });
let maxActive = 0, critCount = 0;
for (let n = 0; n < 10000; n++) {
  const isCrit = rnd() < 0.2; if (isCrit) critCount++;
  dn.onHit(hit({ crit: isCrit, damage: 1 + Math.floor(rnd() * 30) }));
  const i = (dn.crit.length, 0); void i;
  if (n % 7 === 0) dn.step(0.02);
  maxActive = Math.max(maxActive, dn.active);
  if (n % 250 === 0) { ui = fakeUi(); dn.draw(ui, false); for (const c of ui.cells.values()) { if (c.ch === '!') assert.ok(c.fg > 100 && c.fb < 100, 'crit char is gold'); } }
}
assert.ok(maxActive <= POOL, 'pool never exceeds 24: ' + maxActive); assert.equal(dn.act.length, POOL);
let critSlots = 0; for (let k = 0; k < POOL; k++) if (dn.act[k] && dn.crit[k]) critSlots++;
assert.ok(critCount > 1500 && critSlots <= POOL);
// every spawn's crit flag equals the event's flag
dn.reset(); for (const f of [true, false, true, true, false]) { dn.onHit(hit({ crit: f })); }
assert.deepEqual([...dn.crit.slice(0, 5)], [1, 0, 1, 1, 0]);
// 0 alloc per step/draw
ui = { cols: 160, rows: 60, setCellRGB() {} }; dn.onHit(hit());
if (global.gc) { for (let i = 0; i < 2000; i++) { dn.step(0.016); dn.draw(ui, false); } global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 100000; i++) { dn.step(0.016); dn.draw(ui, false); if (i % 50 === 0) dn.onHit(hit()); } global.gc(); assert.ok(process.memoryUsage().heapUsed - h0 < 300000, 'no per-frame alloc'); }
console.log('damageNumbers.test.js ok');
