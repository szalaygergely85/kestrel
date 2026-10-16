import assert from 'node:assert/strict';
import { lintQuestZones } from './quest-zone-lint.mjs';
const world = {
  water: [{ shape: 'river', path: [[1000, 0, 0, 20], [1000, 2000, 0, 20]] }],
  entities: [{ id: 'nearNpc', x: 1200, y: 500 }, { id: 'farNpc', x: 800, y: 500 }], triggers: [], structures: [],
};
const q = (id, to, band) => ({ id, band, objectives: [{ id: 'o', when: { type: 'deliver', id: 'x', to } }] });
const hits = lintQuestZones({ world, areas: {}, defs: [q('far.low', 'farNpc', [1, 5]), q('near.low', 'nearNpc', [1, 5]), q('far.high', 'farNpc', [5, 10])] });
assert.deepEqual(hits.map((h) => h.quest), ['far.low']);
console.log('quest-zone-lint.test ok');
