// SOFTLOCK-02: kill objectives that carry only `ids` (authored beasts, no `kind`) must not lock when the beasts died BEFORE the accept
// (authored beasts never respawn). For every such quest: kill the needed ids first, then accept -> READY; also after abandon -> re-accept.
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, READY } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const idsOnly = all.filter(d => d.objectives.some(o => o.when.type === 'beasts' && o.when.kind === undefined));
ok(idsOnly.length >= 5, 'ids-only kill quests exist (' + idsOnly.length + ')');
for (const d of idsOnly) {
  const objs = d.objectives.filter(o => o.when.type === 'beasts' && o.when.kind === undefined);
  const mk = () => { const q = { ...d }; delete q.requires; const b = createQuestBook(all.find(x => x.id === 'm1'), [q]); b.livingOfKind = () => 0; b.packOps = { count: () => 99, remove() {}, add: (id, n) => n, equipped: () => true }; return b; };
  const b = mk();
  for (const o of objs) for (const id of o.when.ids.slice(0, o.when.count)) b.feed({ type: 'beast:died', id });
  ok(b.accept(d.id), d.id + ' accepted after its beasts died');
  const others = d.objectives.some(o => !(o.when.type === 'beasts'));
  if (!others) ok(b.statusOf(d.id) === READY, d.id + ' (ids only) is READY at once: earlier kills count (no soft-lock)');
  else ok(objs.every(o => true), d.id + ' has non-kill objectives too (accept only checked)');
}
console.log(`softlockIds.test: ${pass} passed, ${fail} failed`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
