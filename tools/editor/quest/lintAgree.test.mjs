// ED-QUEST-05b: lintQuest over ALL real quests (legacy giver + pack `site` givers) agrees with content-lint R10/R14 per quest.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { lintQuest } from './lintQuest.js';
import { buildContext, r10Quest, r14Quest } from '../../content-lint.mjs';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir), c = await buildContext();
const sites = Object.assign({}, ...[...m.files.values()].filter((f) => f.kind === 'sites').map((f) => f.obj.sites));
const byId = new Map(c.quests.map((q) => [q.id, q]));
const ctx = { characters: c.characters, pos: c.pos, sites, levelIds: c.levelIds, flowOf: (q) => { const l = byId.get(q.id); return { accept: l ? l.accept : true, auto: l ? l.auto : false }; } };
const key = (a) => a.sort().join('|');
let n = 0, withGiver = 0;
for (const q of m.quests) {
  const l = byId.get(q.id); if (!l || l.umbrella) continue; n++;
  if (l.giver?.npc) withGiver++;
  const want = key([...r10Quest(c, l).map((f) => 'R10:' + f.msg.split(' ')[0]), ...r14Quest(c, l, { skipChar: true }).map((f) => 'R14:' + (/does not resolve/.test(f.msg) ? f.msg.split(' ')[0] + ' resolve' : f.msg.split(' ')[0]))]);
  const got = key(lintQuest(m, q.id, ctx).filter((x) => x.severity === 'error' || x.rule === 'R10').filter((x) => x.rule === 'R10' || x.rule === 'R14')
    .map((x) => x.rule + ':' + (x.rule === 'R10' ? (/^The quest giver/.test(x.text) ? 'giver' : 'turn-in') : /no giver/.test(x.text) ? 'quest' : /not placed/.test(x.text) ? (x.target.kind === 'giver' ? 'giver' : 'return') + ' resolve' : /Accept/.test(x.text) ? 'no' : /handed in/.test(x.text) ? 'auto' : '?')));
  const norm = (s) => s.replace(/R14:return resolve/g, 'R14:return resolve');
  assert.equal(norm(got), norm(want), q.id + ': lintQuest ' + got + ' vs content-lint ' + want);
}
assert.ok(n > 60 && withGiver > 40, `covered ${n} quests, ${withGiver} with giver`);
console.log(`lintAgree.test OK (${n} quests, ${withGiver} with giver)`);
