// ED-QUEST-DEPS-2: editor's local resolveGiver mirror == game templates.resolveGiver over all real pack quests.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGiver as game } from '../game/js/quest/sim/templates.js';
import { resolveGiver as ed } from './editor/quest/lintQuest.js';
import { loadQuests } from './editor/quest/model.js';
const m = loadQuests(join(fileURLToPath(new URL('.', import.meta.url)), '../content/quests'));
const sites = Object.assign({}, ...[...m.files.values()].filter((f) => f.kind === 'sites').map((f) => f.obj.sites));
const ctx = { sites };
const run = (f, q, t) => { try { return JSON.stringify(f(q, ctx, t)); } catch (e) { return 'ERR ' + e.message; } };
let n = 0;
for (const q of m.quests) {
  if (q.raw.site === undefined) continue; n++;
  const step = (q.raw.steps || []).find((st) => st.template === 'deliver') || (q.raw.template === 'deliver' ? q.raw : null);
  const to = step ? (step.params || step).to : undefined;
  assert.equal(run(ed, q.raw, to), run(game, q.raw, to), q.id);
}
assert.equal(run(ed, { id: 'x', site: 'nope' }), run(game, { id: 'x', site: 'nope' }).replace(/^ERR template x: /, 'ERR '));
assert.ok(n > 0);
console.log(`quest-editor-resolvegiver-parity OK (${n} quests)`);
