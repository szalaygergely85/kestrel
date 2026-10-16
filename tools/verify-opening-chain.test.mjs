// Cross-check: the browser verifier's step list equals the opening-chain hand-in ids that game/js/quest/allQuests.e2e.test.js derives (m1 objectives
// whose `when` is the flag quest.<id>.done). Node only, no browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadQuestFiles } from '../game/js/questBoot.js';
import { STEPS, STEP_IDS } from './verify-opening-chain.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const qb = await loadQuestFiles((u) => Promise.resolve(rd(u.replace(/^(\.\.\/)+/, ''))), { wantBarks: false, log: () => {}, items: [] });
const chain = [];
for (const o of qb.questDef.objectives) { const m = o.when && o.when.type === 'flag' && /^quest\.(.+)\.done$/.exec(o.when.id); if (m) chain.push(m[1]); }
assert.deepEqual(STEP_IDS, chain, 'verify-opening-chain STEPS must list the m1 chain hand-in quests in order');
const e2e = readFileSync(ROOT + 'game/js/quest/allQuests.e2e.test.js', 'utf8');
assert.ok(e2e.includes('quest\\.(.+)\\.done'), 'e2e test no longer derives the chain hand-ins from quest.<id>.done flags: update this cross-check');
for (const s of STEPS) { assert.ok(qb.giverDefs.find((g) => g.id === s.quest), s.quest + ' is a loaded giver quest'); assert.ok(s.giver && s.handIn, s.quest + ' has giver + handIn'); }
console.log('verify-opening-chain.test ok (' + STEP_IDS.join(', ') + ')');
