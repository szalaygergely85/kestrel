// SPELL-06: Ward sim + vitals absorb hook + HUD ring. Run: node game/js/quest/sim/ward.test.js
import assert from 'node:assert/strict';
import { createWardSim } from './ward.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { drawWardRing } from '../vitalsView.js';
import { SPELL_DEFS } from '../spellDefs.js';

const mk = (tier, mp = 100) => { const m = { mp }; return { m, w: createWardSim({ spendMana: (n) => (m.mp < n ? false : (m.mp -= n, true)), tier: () => tier }) }; };
for (const t of [1, 2, 3]) { // AC1: tier numbers, overflow, cooldown, timeout
  const r = SPELL_DEFS.ward.tiers[t - 1], { m, w } = mk(t);
  assert.equal(w.cast(), 'cast'); assert.equal(m.mp, 100 - r.mana); assert.equal(w.absorbLeft, r.absorb);
  assert.equal(w.absorb(r.absorb - 1), 0); assert.equal(w.absorb(5), 4); assert.equal(w.active, false, 'used up ends it');
  assert.equal(w.absorb(7), 7, 'ended ward passes everything');
  assert.equal(w.cast(), 'busy'); assert.equal(m.mp, 100 - r.mana, 'AC3: refused recast spends no mana');
  const w2 = mk(t).w; w2.cast();
  for (let i = 0; i < Math.round(r.dur * 60) - 1; i++) w2.step();
  assert.equal(w2.active, true); w2.step(); assert.equal(w2.active, false, 'timeout');
  for (let i = 0; i < Math.round(r.cd * 60); i++) w2.step();
  assert.equal(w2.cooldown, 0); assert.equal(w2.cast(), 'cast', 'cd ends');
}
{ const { w } = mk(1, 3); assert.equal(w.cast(), 'nomana'); assert.equal(w.cooldown, 0, 'no cd without mana'); }

// vitals: absorb before armour, overflow passes, drowning / kill untouched
{
  const handlers = {}, events = { on(n, f) { handlers[n] = f; return () => {}; }, emit(n, p) { if (handlers[n]) handlers[n](p); } };
  const world = { state: {}, get: () => null };
  const { w } = mk(1); let defCalls = 0;
  const v = createVitals(world, events, VITALS_DEFAULTS, { absorb: (n) => w.absorb(n), defence: () => (defCalls++, 0) });
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0 }, components: {} };
  v.step(player, 1 / 60);
  const hp0 = v.hp; w.cast(); // absorbs 10
  events.emit('combat:hit', { target: 'player', damage: 4, source: 'player', cause: 'arrow' });
  assert.equal(v.hp, hp0, 'fully absorbed: no hp lost'); assert.equal(defCalls, 0, 'absorbed before armour'); assert.equal(w.absorbLeft, 6);
  assert.equal(v.invuln, 0, 'no invuln when nothing got through');
  events.emit('combat:hit', { target: 'player', damage: 9, source: 'player', cause: 'fire' });
  assert.ok(v.hp < hp0, 'overflow passes to hp'); assert.equal(w.absorbLeft, 0);
  const hp1 = v.hp; w.reset(); w.cast(); v.hurt(2, 'drown'); assert.ok(v.hp < hp1, 'drowning ignores the ward'); assert.equal(w.absorbLeft, 10);
}

// AC4: ring view cells on / off, 0 alloc
{
  const cells = new Map(), ui = { cols: 40, rows: 20, setCellRGB(x, y, code, r, g, b) { cells.set(x + ',' + y, [code, r, g, b]); } };
  const { w } = mk(2);
  assert.equal(drawWardRing(ui, w), 0); assert.equal(cells.size, 0, 'off: nothing');
  w.cast(); const n = drawWardRing(ui, w); assert.ok(n > 40 && n === cells.size, 'on: ragged edge ring');
  for (const [k, c] of cells) { const [x, y] = k.split(',').map(Number); assert.ok(x === 0 || y === 0 || x === 39 || y === 19); assert.equal(c[0], 'o'.charCodeAt(0) - 32); assert.ok(c[3] > c[1], 'teal'); }
  assert.equal(n, drawWardRing(ui, w), 'deterministic');
  const noop = { cols: 40, rows: 20, setCellRGB() {} }; for (let i = 0; i < 20000; i++) drawWardRing(noop, w); if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 20000; i++) drawWardRing(noop, w); if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0; assert.ok(dh < 100000, '0 alloc ring ' + dh);
}
console.log('ward.test.js OK');
