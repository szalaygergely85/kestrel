// QL-MAIN-04: one fixture per rule must fail with the exact rule id; a clean control passes; the real content passes.
import assert from 'node:assert/strict';
import { lintQuestGraph, lintRealContent } from './quest-graph-lint.mjs';

const q = (id, o = {}) => ({ path: 'fx:' + id, def: { id, giver: { npc: 'n1' }, reward: { items: [{ id: 'potion.hp' }] }, ...o } });
const base = { itemIds: new Set(['potion.hp']), dialogueIds: new Set(['d1']), entDlg: { n1: 'd1' } };
const rules = (quests, extra = {}) => [...new Set(lintQuestGraph({ ...base, ...extra, quests }).map((h) => h.rule))];

assert.deepEqual(rules([q('a'), q('b', { next: 'a' }), q('c', { requires: [{ quest: 'a' }] })]), [], 'clean control');
assert.deepEqual(rules([q('a', { giver: undefined, requires: [{ flag: 'x' }] })]), ['QG-A-UNREACHABLE'], 'a: nothing offers it');
assert.deepEqual(rules([q('a', { requires: [{ quest: 'b' }] }), q('b', { requires: [{ quest: 'a' }] })]).includes('QG-B-CYCLE'), true, 'b: requires cycle');
assert.deepEqual(rules([q('a', { next: 'b' }), q('b', { giver: undefined, next: 'a' })]).includes('QG-B-CYCLE'), true, 'b: next cycle');
assert.deepEqual(rules([q('a', { next: 'ghost' })]), ['QG-C-MISSING-QUEST'], 'c: next missing');
assert.deepEqual(rules([q('a', { requires: [{ quest: 'ghost' }] })]), ['QG-C-MISSING-QUEST'], 'c: requires missing');
assert.deepEqual(rules([q('a', { reward: { items: [{ id: 'nope' }] } })]), ['QG-D-REWARD-ITEM'], 'd: reward item');
assert.deepEqual(rules([q('a')], { dialogueIds: new Set() }), ['QG-E-DIALOGUE-MISSING'], 'e: dialogue file missing');

// real content (same loaders validate-content.mjs uses)
const v = await import('./validate-content.mjs');
const A = await v.loadDesignAssets();
const dir = new URL('../content/quests', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const qf = v.loadQuestFiles(dir); qf.quests.push(...(await v.loadPackQuests(dir, A?.items?.defs)).quests);
const hits = await lintRealContent({ quests: qf.quests, itemDefs: A?.items?.defs || {} });
assert.deepEqual(hits, [], 'real content: ' + JSON.stringify(hits));
console.log('quest-graph-lint.test: OK');
