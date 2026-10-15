// OB-141: the ground west of the ford (970,1062) must have >= 3 points of interest within 250 m, spaced >= 80 m apart,
// built from existing systems only (camp, chest, inspect anchor, wary boars). Pure JSON test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const w = JSON.parse(fs.readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const camps = JSON.parse(fs.readFileSync(new URL('../content/life/goblinCamps.json', import.meta.url), 'utf8')).camps;
const ent = (id) => w.entities.find((e) => e.id === id);
const C = [970, 1062];
const pois = [
  { id: 'campSouthWest', at: (camps.find((c) => c.id === 'campSouthWest' && c.enabled !== false) || {}).at },
  { id: 'ruinWest', at: ent('ruinWestNote') && [ent('ruinWestNote').x, ent('ruinWestNote').y] },
  { id: 'stonesWest', at: ent('stonesWest') && [ent('stonesWest').x, ent('stonesWest').y] },
  { id: 'boarsWest', at: ent('ob141Boar1') && [ent('ob141Boar1').x, ent('ob141Boar1').y] },
];
for (const p of pois) { assert.ok(p.at, p.id + ' missing/disabled'); assert.ok(Math.hypot(p.at[0] - C[0], p.at[1] - C[1]) <= 250, p.id + ' too far'); }
for (let i = 0; i < pois.length; i++) for (let j = i + 1; j < pois.length; j++) assert.ok(Math.hypot(pois[i].at[0] - pois[j].at[0], pois[i].at[1] - pois[j].at[1]) >= 80, `${pois[i].id}/${pois[j].id} < 80 m`);
assert.equal(w.entities.filter((e) => e.id === 'chestWest').length, 1);
assert.ok(Math.hypot(ent('chestWest').x - 880, ent('chestWest').y - 1012) < 25, 'the one new chest is inside campSouthWest (guarded)');
assert.ok(ent('ruinWestNote') && ent('stonesWest') && ent('ob141Boar3'));
console.log('poi-west.test OK: ' + pois.length + ' POIs');
