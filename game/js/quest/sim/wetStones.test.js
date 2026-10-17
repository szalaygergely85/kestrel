// QL-19: wet stone tagging + slow step + main.js wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectWetStones, createWetStones } from './wetStones.js';
import { ensureEquipment } from './equipment.js';
const world = JSON.parse(fs.readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const c = collectWetStones(world.structures);
assert.ok(c.n >= 5, 'ford stones found in world_m1: ' + c.n);
const defs = { riverBoots: { equip: { slot: 'feet', passive: { wetStone: true } } } };
const player = { components: {} }; const eq = ensureEquipment(player);
const ws = createWetStones([{ id: 'fordS1', origin: { x: 10, y: 10 } }, { id: 'tree', origin: { x: 0, y: 0 } }]);
assert.equal(ws.count, 1);
const dt = 1 / 60;
assert.equal(ws.step(eq, defs, true, 5, 10, dt), 1, 'off stone');
assert.equal(ws.step(eq, defs, true, 10, 10, dt), 0.4, 'sprint onto wet stone: slow');
assert.ok(ws.state.fresh, 'fresh flag on trigger step');
let n = 0; while (ws.step(eq, defs, true, 10, 10, dt) < 1) n++;
assert.ok(n >= 22 && n <= 24, 'about 0.4 s: ' + n);
ws.reset(); ws.step(eq, defs, true, 5, 10, dt);
assert.equal(ws.step(eq, defs, false, 10, 10, dt), 1, 'walking: no slow');
ws.reset(); ws.step(eq, defs, true, 5, 10, dt);
eq.feet = 'riverBoots';
assert.equal(ws.step(eq, defs, true, 10, 10, dt), 1, 'River Boots: no slow');
// AC1 table: boots (off/on) x walk/sprint x wet/dry; 0.4 s; no re-trigger on the same stone within 1 s
for (const boots of [false, true]) for (const sprint of [false, true]) for (const wet of [false, true]) {
  eq.feet = boots ? 'riverBoots' : null; ws.reset(); ws.step(eq, defs, sprint, 5, 10, dt);
  const m = ws.step(eq, defs, sprint, wet ? 10 : 5, wet ? 10 : 10.5, dt);
  assert.equal(m, (!boots && sprint && wet) ? 0.4 : 1, `boots=${boots} sprint=${sprint} wet=${wet}`);
}
eq.feet = null; ws.reset(); ws.step(eq, defs, true, 5, 10, dt);
ws.step(eq, defs, true, 10, 10, dt); for (let k = 0; k < 30; k++) ws.step(eq, defs, true, 10, 10, dt);
ws.step(eq, defs, true, 5, 10, dt); // leave after ~0.5 s, step back on within 1 s
assert.equal(ws.step(eq, defs, true, 10, 10, dt), 1, 'same stone within 1 s: no re-trigger');
for (let k = 0; k < 60; k++) ws.step(eq, defs, true, 5, 10, dt);
assert.equal(ws.step(eq, defs, true, 10, 10, dt), 0.4, 'after 1 s: slows again');
{ // 0 alloc: heap flat over 20k steps
  global.gc && global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 20000; k++) ws.step(eq, defs, true, (k & 1) ? 10 : 5, 10, dt);
  assert.ok(process.memoryUsage().heapUsed - h0 < 2e6, 'no per-step allocation');
}
const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
assert.ok(/createWetStones\(worldDef\.structures\)/.test(main) && /wetStones\.step\(/.test(main), 'main.js wired');
assert.ok(/defenceBonus:[^\n]*nightBonus/.test(main), 'night cloak wired in vitals');
console.log('wetStones: ok');
