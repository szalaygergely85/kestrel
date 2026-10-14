// ED-AI-04 (editor side: validator + model; the buildGroups side is game/js/quest/sim/spawnAreas.test.js). Run: node tools/editor/ai/spawnAreas.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpawnAreas, saveSpawnAreas, spawnAreasText, stringifySpawnAreas, addSpawnArea, removeSpawnArea, setSpawnAreaField, makeStack, validateSpawnAreasModel } from './model.js';
import { validateSpawnAreas } from './spawnAreas.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/beasts');
const KINDS = JSON.parse(readFileSync(join(dir, 'kinds.json'), 'utf8'));
const disc = { id: 'east-meadow', shape: 'disc', x: 500, y: 400, r: 40, kind: 'boar', count: 3, respawnSec: 90, when: 'both' };
const poly = { id: 'tri', shape: 'polygon', pts: [[0, 0], [60, 0], [0, 60]], kind: 'grey_wolf', count: 4, respawnSec: 120, when: 'night' };

// shipped file: empty, valid, byte-identical, nothing written
const m = loadSpawnAreas(dir);
assert.deepEqual(m.errors, []); assert.deepEqual(m.areas, []);
assert.equal(spawnAreasText(m), readFileSync(join(dir, 'spawnAreas.json'), 'utf8'));
assert.equal(saveSpawnAreas(m, { writeFileSync() { throw new Error('should not write'); } }).written.length, 0);
assert.deepEqual(validateSpawnAreasModel(m, KINDS), []);

// validator
assert.deepEqual(validateSpawnAreas({ areas: [disc, poly] }, KINDS), []);
const bad = (patch) => validateSpawnAreas({ areas: [{ ...disc, ...patch }] }, KINDS);
assert.match(bad({ kind: 'dragonX' })[0], /not a known beast kind/);
assert.match(bad({ count: 0 })[0], /count must be a whole number/);
assert.match(bad({ r: 2 })[0], /radius r must be between/);
assert.match(bad({ when: 'dusk' })[0], /when must be one of day, night, both/);
assert.match(bad({ respawnSec: 5 })[0], /respawnSec must be between/);
assert.match(bad({ shape: 'star' })[0], /shape must be disc or polygon/);
assert.match(bad({ id: 'Bad Id' })[0], /id must be lower-case/);
assert.match(validateSpawnAreas({ areas: [disc, disc] })[0], /used twice/);
assert.match(validateSpawnAreas({ areas: [{ ...poly, pts: [[0, 0], [1, 1]] }] })[0], /at least 3 corner points/);
assert.match(validateSpawnAreas({})[0], /must look like/);

// editor model: undoable commands, canonical text, round trip
const st = makeStack();
st.run(addSpawnArea(m, disc)); st.run(addSpawnArea(m, poly)); st.run(setSpawnAreaField(m, 'tri', 'count', 6));
assert.equal(m.areas.length, 2); assert.equal(m.areas[1].count, 6);
assert.deepEqual(validateSpawnAreasModel(m, KINDS), []);
const text = spawnAreasText(m);
assert.equal(text, stringifySpawnAreas(JSON.parse(text))); assert.equal(text.split('\n').length, 7);
const writes = []; assert.deepEqual(saveSpawnAreas(m, { writeFileSync: (p, t) => writes.push([p, t]) }).written, ['spawnAreas.json']);
assert.equal(writes[0][1], text);
const m2 = loadSpawnAreas('/x', { readFileSync: () => text }); assert.equal(spawnAreasText(m2), text);
st.run(removeSpawnArea(m, 'east-meadow')); assert.equal(m.areas.length, 1);
for (let i = 0; i < 4; i++) st.undo();
assert.equal(m.areas.length, 0); assert.equal(stringifySpawnAreas(m.file.obj), '{\n  "areas": []\n}\n');
assert.throws(() => addSpawnArea(m2, m2.areas[0]).apply(), /exists/);
console.log('spawnAreas (editor) OK');
