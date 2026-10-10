// AUD2-09 loader test. Run: node game/js/questBoot.test.js
import assert from 'node:assert/strict';
import { loadQuestFiles, showBootErrors, QUEST_FILES } from './questBoot.js';
const ok = async (u) => ({ url: u });
const logs = [];
let r = await loadQuestFiles(ok, { log: (m) => logs.push(m) });
assert.equal(r.errors.length, 0); assert.equal(r.giverDefs.length, 2); assert.equal(logs.length, 0);
// one missing file: named, logged, others still load
r = await loadQuestFiles(async (u) => { if (u === QUEST_FILES.burl) throw new Error('404'); return { url: u }; }, { log: (m) => logs.push(m) });
assert.deepEqual(r.errors.map((e) => e.file), [QUEST_FILES.burl]);
assert.ok(logs[0].includes('burl.boars.quest.json'));
assert.ok(r.questDef && r.charKit && r.giverDefs === null);
// quest def missing -> flagged
r = await loadQuestFiles(async (u) => { if (u === QUEST_FILES.quest) throw new Error('x'); return {}; }, { log: () => {} });
assert.equal(r.questDef, null); assert.equal(r.errors.length, 1);
// barks skipped when not wanted
r = await loadQuestFiles(async (u) => { if (u === QUEST_FILES.barks) throw new Error('x'); return {}; }, { wantBarks: false, log: () => {} });
assert.equal(r.errors.length, 0);
// notice: no Esc text, names the file
const body = { kids: [], appendChild(e) { this.kids.push(e); } };
const doc = { body, createElement: () => ({ style: {}, setAttribute() {} }) };
const el = showBootErrors(doc, [{ file: QUEST_FILES.quest, message: 'x' }]);
assert.ok(el.textContent.includes('m1.quest.json') && !/esc/i.test(el.textContent));
assert.equal(showBootErrors(doc, []), null);
console.log('questBoot: ok');
