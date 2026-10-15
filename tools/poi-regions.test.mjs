// OB-141 follow-up: every region keeps >= 4 authored POIs per km2 (measured floor after the fill; before it was 1.6), the 5 filled regions
// have their new look-at POIs (>= 80 m apart, each with a text), and no new chest/beast was added.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { poiReport } from './poi-regions.probe.mjs';
const rep = poiReport();
for (const r of rep) assert.ok(r.perKm2 >= 4, `${r.id}: ${r.perKm2.toFixed(1)} POI/km2 < 4`);
const w = JSON.parse(fs.readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const txt = JSON.parse(fs.readFileSync(new URL('../content/dialogue/inspect.json', import.meta.url), 'utf8')).texts;
const mine = w.entities.filter((e) => /^ob141r/.test(e.id));
assert.ok(mine.length >= 11, 'new POIs: ' + mine.length);
for (const reg of ['whitecombs', 'westFells', 'heartlandE', 'downs', 'northwood']) assert.ok(mine.filter((e) => e.id.startsWith('ob141r' + reg)).length >= 2, reg);
for (const e of mine) { assert.ok(txt[e.components.inspect.text], 'text ' + e.components.inspect.text); assert.equal(e.type, 'prop'); }
for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) assert.ok(Math.hypot(mine[i].x - mine[j].x, mine[i].y - mine[j].y) >= 80, mine[i].id + '/' + mine[j].id + ' < 80 m');
assert.ok(!w.entities.some((e) => /^ob141r/.test(e.id) && (e.type === 'beast' || /chest/i.test(e.id))));
console.log('poi-regions.test OK: min ' + Math.min(...rep.map((r) => r.perKm2)).toFixed(1) + ' POI/km2, ' + mine.length + ' new');
