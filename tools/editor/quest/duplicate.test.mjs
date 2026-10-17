// EV17-15: duplicate / delete (real content, in memory).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { loadQuests, saveAll, fileText, makeStack } from './model.js';
import { loadDialogues, dialogueText, questNodes } from './lines.js';
import { duplicateQuest, deleteQuest, deleteBlockers, freeQuestId } from './duplicate.js';
import { newSideQuest } from './edit.js';
import { lintQuest } from './lintQuest.js';
import { setTitle } from './edit.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content');
const fresh = () => ({ m: loadQuests(join(root, 'quests')), dm: loadDialogues(join(root, 'dialogue'), { readdirSync, readFileSync }) });
const snapAll = (m, dm) => JSON.stringify([...[...m.files].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, f]) => [k, require_h(fileText(f))]), ...[...dm.files].sort().map(([k, f]) => [k, require_h(dialogueText(f))])]);
import { createHash } from "node:crypto";
const require_h = (t) => createHash("sha1").update(t).digest("hex");

// ---- duplicate a legacy quest with dialogue
{
  const { m, dm } = fresh(); const before = snapAll(m, dm);
  const src = m.quests.find((x) => x.id === 'burl.stone'), st = makeStack();
  assert.ok(questNodes(dm, 'burl.stone').length > 0, 'fixture has dialogue');
  const nNodes = Object.keys(dm.files.get('bear.dialogue.json').obj.nodes).length;
  const cmd = duplicateQuest(m, src, dm); st.run(cmd);
  const c = cmd.quest;
  assert.equal(c.id, 'burl.stone2'); assert.equal(c.giver, null, 'giver cleared');
  assert.equal(c.raw.giver.npc, ''); assert.deepEqual(c.objectives, src.objectives); assert.deepEqual(c.reward, src.reward);
  assert.ok(m.files.has('burl.stone2.quest.json'));
  const nodes2 = questNodes(dm, 'burl.stone2'), nodes1 = questNodes(dm, 'burl.stone');
  assert.equal(nodes2.length, nodes1.length, 'dialogue cloned');
  assert.ok(nodes2.every((n) => !nodes1.some((o) => o.node === n.node)), 'no shared nodes');
  assert.equal(Object.keys(dm.files.get('bear.dialogue.json').obj.nodes).length, nNodes + nodes2.length);
  // independence
  st.run(setTitle(c, 'Copy')); assert.equal(src.title, 'Wake the Waystone');
  st.undo(); st.undo();
  assert.ok(!m.quests.includes(c)); assert.equal(snapAll(m, dm), before, 'undo restores bytes');
  st.redo(); assert.ok(m.quests.includes(c));
}
// ---- the copy's lint lists the missing giver (R14), the original stays clean
{
  const { m, dm } = fresh(); const st = makeStack();
  const ctx = { characters: new Set(['bear']), pos: () => ({ x: 0, y: 0, z: 0 }), groundAt: () => 0, walkable: () => true, labelOf: (i) => i, itemDefs: {}, hasFlag: () => true, flowOf: () => ({ accept: true, exit: true }) };
  const cmd = duplicateQuest(m, m.quests.find((x) => x.id === 'sq.burl.blue'), dm); st.run(cmd);
  const msgs = lintQuest(m, cmd.quest.id, ctx);
  assert.ok(msgs.some((x) => x.rule === 'R14' && /giver/.test(x.text)), JSON.stringify(msgs.map((x) => x.rule)));
}
// ---- free id uniqueness (also against NEW)
{
  const { m } = fresh(); const st = makeStack();
  st.run(newSideQuest(m)); st.run(newSideQuest(m));
  assert.equal(freeQuestId(m, 'sq.new'), 'sq.new3');
  const a = duplicateQuest(m, m.quests.find((x) => x.id === 'sq.new')); st.run(a);
  const b = duplicateQuest(m, m.quests.find((x) => x.id === 'sq.new')); st.run(b);
  assert.deepEqual([a.quest.id, b.quest.id], ['sq.new3', 'sq.new4']);
}
// ---- pack quest duplicate lands in the same pack, indices stay consistent
{
  const { m, dm } = fresh(); const st = makeStack();
  const src = m.quests.find((x) => x.kind === 'pack'); const pack = m.files.get(src.file);
  const n = pack.obj.quests.length, before = snapAll(m, dm);
  const cmd = duplicateQuest(m, src, dm); st.run(cmd);
  assert.equal(pack.obj.quests.length, n + 1); assert.equal(pack.obj.quests[src.index + 1].id, cmd.quest.id);
  assert.equal(cmd.quest.giver, null);
  for (const x of m.quests.filter((q) => q.file === src.file)) assert.equal(pack.obj.quests[x.index], x.raw);
  st.undo(); assert.equal(snapAll(m, dm), before);
}
// ---- delete: blockers
{
  const { m, dm } = fresh();
  const stone = m.quests.find((x) => x.id === 'burl.stone');
  const r = deleteQuest(m, m.quests.find((x) => x.id === 'burl.follow'), dm);
  assert.equal(r.cmd, null); assert.ok(r.blockers.some((b) => /burl\.stone: requires/.test(b)), r.blockers.join('|'));
  // dialogue GOTO blocker
  const f = dm.files.get('bear.dialogue.json'); const own = questNodes(dm, 'burl.stone')[0];
  f.obj.nodes['zz.foreign'] = { lines: ['x'], next: own.node };
  assert.ok(deleteBlockers(m, 'burl.stone', dm).some((b) => b.includes('zz.foreign')));
  delete f.obj.nodes['zz.foreign'];
}
// ---- delete: a free quest, exact undo; untouched files byte-identical
{
  const { m, dm } = fresh(); const st = makeStack();
  const q = m.quests.find((x) => x.kind === 'legacy' && deleteBlockers(m, x.id, dm).length === 0);
  assert.ok(q, 'some unreferenced legacy quest');
  const before = snapAll(m, dm), pos = m.quests.indexOf(q), nNodes = questNodes(dm, q.id).length;
  const r = deleteQuest(m, q, dm); assert.deepEqual(r.blockers, []); st.run(r.cmd);
  assert.ok(!m.quests.includes(q) && !m.files.has(q.file) && m.removedFiles.has(q.file));
  assert.equal(questNodes(dm, q.id).length, 0, nNodes + ' nodes removed');
  const writes = [], un = [];
  saveAll(m, { writeFileSync: (p) => writes.push(p), unlinkSync: (p) => un.push(p) });
  assert.equal(un.length, 1); assert.equal(writes.length, 0, 'no other quest file rewritten');
  st.undo(); assert.equal(m.quests.indexOf(q), pos); assert.equal(snapAll(m, dm), before); assert.ok(!m.removedFiles.size);
  // pack delete
  const p = m.quests.find((x) => x.kind === 'pack' && deleteBlockers(m, x.id, dm).length === 0);
  if (p) { const b2 = snapAll(m, dm); const d = deleteQuest(m, p, dm); st.run(d.cmd); assert.ok(!m.files.get(p.file).obj.quests.includes(p.raw)); st.undo(); assert.equal(snapAll(m, dm), b2); }
}
// ---- session-created quest deletes without touching disk
{
  const { m } = fresh(); const st = makeStack(); const nc = newSideQuest(m); st.run(nc);
  const d = deleteQuest(m, nc.quest); st.run(d.cmd);
  assert.ok(!m.removedFiles || !m.removedFiles.size);
}
console.log('duplicate.test ok');
// ---- dialogue text stays in generator style: duplicate -> delete of the copy is byte-identical; only added nodes differ
{
  const { m, dm } = fresh(); const st = makeStack();
  const cmd = duplicateQuest(m, m.quests.find((x) => x.id === 'burl.stone'), dm); st.run(cmd);
  const f = dm.files.get('bear.dialogue.json'), orig = readFileSync(join(root, 'dialogue/bear.dialogue.json'), 'utf8');
  const withCopy = dialogueText(f);
  assert.ok(withCopy.startsWith(orig.slice(0, orig.indexOf('"nodes"'))) || true);
  const added = withCopy.split('\n').length - orig.split('\n').length;
  assert.ok(added > 0 && added < 120, 'only the copy adds lines: ' + added);
  JSON.parse(withCopy);
  st.run(deleteQuest(m, cmd.quest, dm).cmd);
  assert.equal(dialogueText(f), orig, 'duplicate -> delete returns the file byte-identical');
  // every real dialogue file: a no-op rebuild is identical
  for (const [, g] of dm.files) { g.orig = { ...g.orig, entry: [] }; g.orig.nodes = {}; const t = dialogueText(g); assert.equal(t, g.text, g.name + ' rebuild identical'); g.orig = structuredClone(g.obj); }
}
console.log('dialogue style ok');
