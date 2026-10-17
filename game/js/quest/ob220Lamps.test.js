// OB-220: "Lamps on the Verge" (sq.rb.lamps, giver Joss) could be finished without moving - the `lamps` zone circle contained Joss (21.7 m < r 22).
// Rule: a giver NPC must stand outside the area zone of an explore step of the quest it gives. Run: node game/js/quest/ob220Lamps.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const world = rd('content/worlds/world_m1.world.json');
const zones = [], ents = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id && o.shape === 'circle' && o.r) zones.push(o); if (o.id && o.type === 'npc') ents.push(o); Object.values(o).forEach(walk); } })(world);
const zone = zones.find((z) => z.id === 'lamps'), joss = ents.find((e) => e.id === 'joss');
assert.ok(zone && joss, 'lamps zone + joss exist');
const d = Math.hypot(zone.x - joss.x, zone.y - joss.y);
assert.ok(d > zone.r + 3, 'Joss (' + d.toFixed(1) + ' m from the lamps centre) must stand outside the lamps zone r=' + zone.r + ' so accepting does not finish the walk');
console.log('ob220Lamps OK', d.toFixed(1), zone.r);
