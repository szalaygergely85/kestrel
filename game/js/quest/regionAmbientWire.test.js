// WMP-03 boot helper: null guards + a live step that scales a species cap and fades back. Run: node game/js/quest/regionAmbientWire.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bootRegionAmbient } from './regionAmbientWire.js';
const table = JSON.parse(fs.readFileSync(new URL('../../../content/life/regionAmbient.json', import.meta.url), 'utf8'));
const rid = Object.keys(table.regions)[0], ent = table.regions[rid];
const geo = { regions: [{ id: rid, r: [0, 0, 100, 100] }, { id: 'other', r: [100, 0, 200, 100] }] };
const mkSp = () => Object.keys(ent.fauna || {}).map((name) => ({ name, cap: 10 }));
assert.equal(bootRegionAmbient({ table, geo, wild: { species: mkSp() }, skip: true }), null, 'capture/bench skip');
assert.equal(bootRegionAmbient({ table: null, geo, wild: { species: mkSp() } }), null);
assert.equal(bootRegionAmbient({ table, geo: null, wild: { species: mkSp() } }), null);
assert.equal(bootRegionAmbient({ table, geo, wild: null }), null);
const species = mkSp(), cues = [];
const ra = bootRegionAmbient({ table, geo, wild: { species }, onCue: (id, v) => cues.push([id, v]) });
assert.ok(ra && typeof ra.step === 'function');
for (let i = 0; i < 240; i++) ra.step(1 / 60, 50, 50);
if (species.length) { const k = Object.keys(ent.fauna)[0]; assert.equal(species.find((s) => s.name === k).cap, Math.round(10 * ent.fauna[k]) || species.find((s) => s.name === k).cap); }
for (let i = 0; i < 240; i++) ra.step(1 / 60, 150, 50);
assert.deepEqual(species.map((s) => s.cap), species.map(() => 10), 'no-entry region restores the exact base caps');
assert.equal(cues.length, 0, 'unknown cues never reach onCue');
console.log('regionAmbientWire OK');
