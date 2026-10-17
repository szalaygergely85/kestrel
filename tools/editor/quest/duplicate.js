// tools/editor/quest/duplicate.js - EV17-15. Duplicate / Delete a quest as one undoable command each. Pure (no DOM, no fs).
// Duplicate: free id, giver + turn-in cleared (R10/R14 must be satisfied again), objectives / rewards copied,
//   dialogue nodes + entries cloned under new node ids and the new quest's flags (the copy shares no nodes).
// Delete: refused while another quest (next / requires) or a foreign dialogue node (next / choice GOTO) points at it.
import { refresh } from './model.js';
import { formatView } from './format.js';
import { questNodes } from './lines.js';

const clone = (o) => structuredClone(o);

/** First free id: <id>2, <id>3, ... */
export function freeQuestId(model, id) {
  let n = 2;
  while (model.quests.some((x) => x.id === id + n)) n++;
  return id + n;
}

/** Raw copy with the giver / turn-in removed (every shape: giver.npc, site, begin, end, turnIn, objectGiver). */
export function clearOrigin(raw) {
  const r = clone(raw);
  for (const k of ['site', 'begin', 'end', 'turnIn', 'objectGiver']) delete r[k];
  if (r.giver !== undefined) r.giver = { npc: '' };
  return r;
}

const prefixes = (qid) => ['s.' + qid + '.', 'q.' + qid + '.'];
const swapPre = (flag, from, to) => {
  if (typeof flag !== 'string') return flag;
  const a = prefixes(from), b = prefixes(to);
  for (let i = 0; i < a.length; i++) if (flag.startsWith(a[i])) return b[i] + flag.slice(a[i].length);
  return flag;
};

/** Dialogue clone plan for quest `qid`: per file { file, nodes:{newId:node}, entries:[{after, entry}] }. */
export function planDialogueCopy(dm, qid, newId) {
  const plan = [];
  if (!dm) return plan;
  const mine = questNodes(dm, qid);
  for (const f of dm.files.values()) {
    const ids = [...new Set(mine.filter((m) => m.file === f.name).map((m) => m.node))];
    if (!ids.length) continue;
    const nodes = {}, map = new Map(), taken = new Set(Object.keys(f.obj.nodes));
    for (const id of ids) { let k = 1; while (taken.has(`${id}.c${k}`)) k++; map.set(id, `${id}.c${k}`); taken.add(map.get(id)); }
    for (const id of ids) {
      const n = clone(f.obj.nodes[id]);
      if (n.next && map.has(n.next)) n.next = map.get(n.next);
      if (n.setFlag) n.setFlag = swapPre(n.setFlag, qid, newId);
      for (const c of n.choices || []) {
        if (c.next && map.has(c.next)) c.next = map.get(c.next);
        if (c.setFlag) c.setFlag = swapPre(c.setFlag, qid, newId);
        if (c.requires) c.requires = swapPre(c.requires, qid, newId);
      }
      nodes[map.get(id)] = n;
    }
    const entries = [];
    (f.obj.entry || []).forEach((e, i) => {
      if (e.requires && map.has(e.node) && swapPre(e.requires, qid, newId) !== e.requires) entries.push({ after: i, entry: { ...e, node: map.get(e.node), requires: swapPre(e.requires, qid, newId) } });
    });
    plan.push({ file: f.name, nodes, entries });
  }
  return plan;
}

function insertQuest(model, q, pos, file) {
  if (q.kind === 'pack') {
    model.files.get(q.file).obj.quests.splice(q.index, 0, q.raw);
    for (const x of model.quests) if (x !== q && x.file === q.file && x.index >= q.index) x.index++;
  } else model.files.set(q.file, file);
  model.quests.splice(pos, 0, q);
}
function removeQuest(model, q) {
  model.quests.splice(model.quests.indexOf(q), 1);
  if (q.kind === 'pack') {
    model.files.get(q.file).obj.quests.splice(q.index, 1);
    for (const x of model.quests) if (x.file === q.file && x.index > q.index) x.index--;
  } else model.files.delete(q.file);
}

/** Duplicate command. cmd.quest is the copy (valid after apply()). */
export function duplicateQuest(model, src, dm = null) {
  const id = freeQuestId(model, src.id);
  const raw = clearOrigin(src.raw);
  raw.id = id;
  const q = { id, kind: src.kind, file: src.kind === 'pack' ? src.file : id + '.quest.json', index: null, raw };
  const plan = planDialogueCopy(dm, src.id, id);
  return {
    label: 'duplicate quest', questId: id, quest: q,
    apply() {
      refresh(q);
      if (src.kind === 'pack') q.index = src.index + 1;
      insertQuest(model, q, model.quests.indexOf(src) + 1, { kind: 'legacy', obj: raw, text: '' });
      for (const p of plan) {
        const f = dm.files.get(p.file);
        Object.assign(f.obj.nodes, clone(p.nodes));
        for (const e of [...p.entries].reverse()) f.obj.entry.splice(e.after + 1, 0, clone(e.entry));
      }
    },
    undo() {
      removeQuest(model, q);
      for (const p of plan) {
        const f = dm.files.get(p.file);
        for (const k of Object.keys(p.nodes)) delete f.obj.nodes[k];
        const dead = new Set(p.entries.map((e) => e.entry.node));
        f.obj.entry = f.obj.entry.filter((e) => !dead.has(e.node));
      }
    },
  };
}

/** What stops quest `id` from being deleted -> string[] (empty = free to delete). */
export function deleteBlockers(model, id, dm = null) {
  const out = [];
  for (const x of model.quests) {
    if (x.id === id) continue;
    const v = formatView(x.raw);
    if (v.next === id) out.push(`quest ${x.id}: next points to it`);
    if (v.requires.quests.includes(id)) out.push(`quest ${x.id}: requires it`);
  }
  if (dm) {
    const own = new Set(questNodes(dm, id).map((m) => m.file + '#' + m.node));
    for (const f of dm.files.values()) {
      const hit = (to) => own.has(f.name + '#' + to);
      for (const [nid, n] of Object.entries(f.obj.nodes || {})) {
        if (own.has(f.name + '#' + nid)) continue;
        if (n.next && hit(n.next)) out.push(`dialogue ${f.name}#${nid}: GOTO ${n.next}`);
        for (const c of n.choices || []) if (c.next && hit(c.next)) out.push(`dialogue ${f.name}#${nid}: choice GOTO ${c.next}`);
      }
      for (const e of f.obj.entry || []) if (hit(e.node) && !(e.requires && prefixes(id).some((p) => e.requires.startsWith(p)))) out.push(`dialogue ${f.name}: entry ${e.node}`);
    }
  }
  return out;
}

/** -> { blockers, cmd }: cmd is null when refused. Removes the quest, its dialogue nodes and entries; exact undo.
 *  A legacy file that exists on disk is queued in model.removedFiles; saveAll(model, {unlinkSync}) deletes it. */
export function deleteQuest(model, q, dm = null) {
  const blockers = deleteBlockers(model, q.id, dm);
  if (blockers.length) return { blockers, cmd: null };
  const mine = dm ? questNodes(dm, q.id) : [];
  const files = [...new Set(mine.map((m) => m.file))];
  let saved = null, pos = 0, fileEntry = null;
  return {
    blockers: [],
    cmd: {
      label: 'delete quest', questId: q.id,
      apply() {
        pos = model.quests.indexOf(q);
        fileEntry = model.files.get(q.file);
        saved = new Map(files.map((n) => [n, { nodes: clone(dm.files.get(n).obj.nodes), entry: clone(dm.files.get(n).obj.entry || []) }]));
        removeQuest(model, q);
        if (q.kind === 'legacy' && fileEntry.text !== '') (model.removedFiles ||= new Set()).add(q.file);
        for (const m of mine) delete dm.files.get(m.file).obj.nodes[m.node];
        for (const n of files) { const ids = new Set(mine.filter((m) => m.file === n).map((m) => m.node)); const f = dm.files.get(n); f.obj.entry = f.obj.entry.filter((e) => !ids.has(e.node)); }
      },
      undo() {
        for (const [n, s] of saved) { const f = dm.files.get(n); f.obj.nodes = clone(s.nodes); f.obj.entry = clone(s.entry); }
        insertQuest(model, q, pos, fileEntry);
        if (model.removedFiles) model.removedFiles.delete(q.file);
      },
    },
  };
}
