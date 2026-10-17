// OB-220 (b) general guard: no quest may be finished by merely standing at its giver / hand-in character.
// Every `area` objective's trigger zone (content/quests/areas.json -> world trigger) must not contain the giver NPC (accept spot).
// Run: node game/js/quest/ob220ZoneAccept.test.js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const areas = rd('content/quests/areas.json').areas;
const zones = new Map(), npcs = new Map();
for (const f of readdirSync(new URL('content/worlds/', ROOT)).filter((n) => n.endsWith('.world.json'))) {
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') {
    if (o.id && o.shape && (o.r || o.w || o.size) && typeof o.x === 'number') zones.set(o.id, o);
    if (o.id && o.type === 'npc' && typeof o.x === 'number') npcs.set(o.id, o);
    if (o.id && o.transform && typeof o.transform.x === 'number') npcs.set(o.id, { x: o.transform.x, y: o.transform.y });
    Object.values(o).forEach(walk); } })(rd('content/worlds/' + f));
}
const quests = [];
(function walk(d) { for (const e of readdirSync(new URL(d, ROOT), { withFileTypes: true })) { if (e.isDirectory()) walk(d + e.name + '/'); else if (e.name.endsWith('.json')) { const j = rd(d + e.name); const list = j.quests || [j]; for (const q of list) if (q && q.objectives) quests.push(q); } } })('content/quests/');
let checked = 0; const bad = [];
const inside = (z, p) => z.shape === 'circle' || z.r ? Math.hypot(p.x - z.x, p.y - z.y) <= z.r : Math.abs(p.x - z.x) <= (z.w || z.size) / 2 && Math.abs(p.y - z.y) <= (z.h || z.size) / 2;
for (const q of quests) {
  if (!q.giver) continue;
  for (const o of q.objectives) {
    if (!o.when || o.when.type !== 'area') continue;
    const a = areas[o.when.id]; const z = zones.get((a && a.trigger) || o.when.id);
    if (!z) continue;
    for (const who of [q.giver.npc, q.giver.turnIn].filter(Boolean)) { const n = npcs.get(who); if (!n) continue; checked++; if (inside(z, n)) bad.push(q.id + ': ' + who + ' stands inside zone ' + z.id); }
  }
}
assert.equal(bad.length, 0, bad.join('\n'));
console.log('ob220ZoneAccept OK', quests.length, 'quests,', checked, 'giver/zone pairs');
