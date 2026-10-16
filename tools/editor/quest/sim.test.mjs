// ED-QUI-07b2: the editor bundle (fetch + open documents, fake fetch over the repo files) equals the Node loader's bundle and gives the same steps; simSteps view model.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadQuestFiles } from '../../../game/js/questBoot.js';
import { runQuestE2e } from '../../../game/js/quest/questE2eRun.js';
import { loadQuestE2eBundle } from '../../quest-e2e-content.mjs';
import { loadQuests } from './model.js';
import { loadDialogues } from './lines.js';
import { fetchQuestFiles, fetchDialogueFiles, memFs } from '../questPanel.js';
import { buildEditorBundle, simSteps, stepCard, normPath } from './sim.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fetchText = async (p) => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : null);
globalThis.fetch = async (u) => { const t = await fetchText(String(u).replace(/^(\.\.\/)+/, '')); return { ok: t != null, status: t != null ? 200 : 404, text: async () => t || '' }; };

assert.equal(normPath('../content/quests/../items/sources.json'), 'content/items/sources.json');
const node = await loadQuestE2eBundle();
const model = loadQuests('q', memFs(await fetchQuestFiles()));
const dm = loadDialogues('d', memFs(await fetchDialogueFiles()));
const ed = await buildEditorBundle({ model, dm, itemDefs: node.itemDefs, fetchText });

assert.deepEqual(Object.keys(ed.raws).sort(), Object.keys(node.raws).sort(), 'dialogue ids');
assert.deepEqual(ed.raws, node.raws, 'dialogue raws');
assert.deepEqual(ed.snip, node.snip);
assert.deepEqual([...ed.areaIds].sort(), [...node.areaIds].sort());
assert.deepEqual(ed.entDlg, node.entDlg, 'entity dialogues');
// the same files reach the quest loader
const a = await loadQuestFiles(async (u) => ed.fetchJson(u), { wantBarks: false, log: () => {} });
const b = await loadQuestFiles(async (u) => node.fetchJson(u), { wantBarks: false, log: () => {} });
assert.deepEqual(a.errors, b.errors);
assert.equal(JSON.stringify(a.giverDefs), JSON.stringify(b.giverDefs), 'giver defs');

for (const id of ['burl.road', 'sq.burl.blue', 'burl.boars']) {
  const r1 = await runQuestE2e(node, id), r2 = await runQuestE2e(ed, id);
  assert.deepEqual(r2.steps, r1.steps, id + ' steps');
  assert.equal(r2.ok, r1.ok);
  assert.ok(r2.ok, id + ' should pass: ' + JSON.stringify(r2.firstFail));
}

// unsaved edits count: an in-memory change to the open quest (not on disk) changes the editor run only
const q = model.quests.find((x) => x.id === 'burl.road');
const f = model.files.get(q.file);
const obj = f.obj; const rec = Array.isArray(obj) ? obj[q.index] : obj;
rec.objectives = [];
const ed2 = await buildEditorBundle({ model, dm, itemDefs: node.itemDefs, fetchText });
const r3 = await runQuestE2e(ed2, 'burl.road');
assert.notDeepEqual(r3.steps, (await runQuestE2e(node, 'burl.road')).steps, 'unsaved quest edit changes the sim');

// view model
const rows = simSteps({ ok: false, steps: [{ name: '4 accept', ok: true, detail: '' }, { name: '5 objectives', ok: false, detail: 'x' }], firstFail: { name: '5 objectives', ok: false, detail: 'x' } });
assert.deepEqual(rows.map((r) => [r.status, r.first, r.card, r.label]), [['PASS', false, 'conversation', 'accept'], ['FAIL', true, 'objectives', 'objectives']]);
assert.equal(stepCard('0 loaded'), 'validate');
// guard: neither the runner nor sim.js imports node: / tools/
const src = readFileSync(ROOT + 'game/js/quest/questE2eRun.js', 'utf8') + readFileSync(ROOT + 'tools/editor/quest/sim.js', 'utf8');
assert.ok(!/from '(node:|(\.\.\/)+tools\/)/.test(src), 'no node:/tools imports');
console.log('sim ok');
