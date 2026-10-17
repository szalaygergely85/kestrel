// ED-AI-02: game/js/quest/sim/archetypeRules.js (used by sim.patchArchetype) and tools/editor/ai/validate.js (editor) give identical messages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as g from '../game/js/quest/sim/archetypeRules.js';
import * as ed from './editor/ai/validate.js';
const T = JSON.parse(readFileSync(new URL('../content/beasts/archetypes.json', import.meta.url), 'utf8'));
assert.equal(g.LEASH_NEVER, ed.LEASH_NEVER);
assert.equal(g.WALK_RUN_MAX, ed.WALK_RUN_MAX);
assert.deepEqual(g.ARCH_ENUMS, ed.ARCH_ENUMS);
const cases = [{}, { noticeR: 0 }, { nearR: 99 }, { walk: 9, run: 2 }, { leashR: 2 }, { leashR: 1e9 }, { leashR: 600 }, { aggro: 'x' }, { keepMin: 9, keepMax: 1 }, { backOffR: 50, keepMin: 2 }, { loseR: 1 }, { coneCos: 2 }, { noticeSec: 'a' }];
let n = 0;
for (const name of Object.keys(T)) for (const c of cases) { const row = { ...T[name], ...c }; assert.deepEqual(g.validateArchetype(row, name), ed.validateArchetype(row, name)); n++; }
assert.deepEqual(g.validateArchetype(null, 'x'), ed.validateArchetype(null, 'x'));
console.log(`ed-ai-rules-parity OK (${n} rows)`);
