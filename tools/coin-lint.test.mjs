// CUR-05: coin-lint fixtures (pass, warn, error) + real content has no errors.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coinLint, bandOf, loadQuestDefs } from './coin-lint.mjs';
const r = (defs) => coinLint(defs);
assert.deepEqual(r([{ id: 'sq.a', rewards: { coin: 20 } }, { id: 'mq.a', reward: { coin: 30 } }, { id: 'sq.e', rewardBand: 'errand', rewards: { coin: 8 } }, { id: 'sq.x', rewardBand: 'elite', rewards: { coin: 100 } }]), [], 'in band: clean');
assert.equal(bandOf({ id: 'mq.x' }), 'main'); assert.equal(bandOf({ id: 'sq.x' }), 'side'); assert.equal(bandOf({ id: 'mq.x', rewardBand: 'elite' }), 'elite');
let h = r([{ id: 'sq.a', rewards: { items: [] } }]); assert.equal(h.length, 1); assert.equal(h[0].severity, 'warn', 'missing coin warns');
h = r([{ id: 'sq.a', rewards: { coin: 5 } }]); assert.equal(h[0].severity, 'warn', 'under band warns');
h = r([{ id: 'mq.a', rewards: { coin: 60 } }]); assert.equal(h[0].severity, 'warn', 'over band warns');
for (const bad of [-1, 201, 12.5, '10']) { h = r([{ id: 'sq.a', rewards: { coin: bad } }]); assert.equal(h[0].severity, 'error', 'error for ' + bad); }
const defs = loadQuestDefs(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'quests'));
assert.ok(defs.length > 0); assert.equal(r(defs).filter((x) => x.severity === 'error').length, 0, 'real content: no coin errors');
console.log('coin-lint.test OK');
