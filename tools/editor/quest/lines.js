// tools/editor/quest/lines.js - ED-QUEST-06. Dialogue line editing for the quest panel (pure: no DOM, fs injectable).
// Two write targets, both through undoable commands:
//   pack/legacy quest `lines` {offer, active, ready, done: [text]}  -> model.js setQuestField (saved with the quest file)
//   content/dialogue/*.dialogue.json node `lines: [text]`          -> loadDialogues()/dialogueText()/saveDialogues()
// Dialogue files keep their ORIGINAL text until a node's lines are edited; then only that node's `lines` array is re-rendered
// in place (same trick as model.js packs), so an untouched file round-trips byte-identically.
import { setQuestField } from './model.js';

export const LINE_MAX = 56;                       // = engine DIALOGUE_LINE_MAX (owner D-102)
export const STAGE_LABEL = { offer: 'Offer', accept: 'Accept', active: 'Progress', ready: 'Hand-in', done: 'After', exit: 'Exit' };
const STATE_KEY = { available: 'offer', active: 'active', ready: 'ready', done: 'done' };   // dialogue entry state -> stage
const PACK_KEYS = ['offer', 'active', 'ready', 'done'];
const nChars = (s) => [...String(s)].length;      // characters, not UTF-16 units
export const lineLength = nChars;
const join = (...p) => p.join('/').replace(/\/+/g, '/');
const human = (s) => { const h = String(s ?? '').toLowerCase(); return h.charAt(0).toUpperCase() + h.slice(1); };

// ---------- dialogue files ----------
/** Loads every *.dialogue.json under dir -> { dir, files: Map(name -> {name, obj, text, orig}) }. */
export function loadDialogues(dir, fs) {
  const files = new Map();
  for (const n of fs.readdirSync(dir).sort()) {
    if (!n.endsWith('.dialogue.json')) continue;
    const text = fs.readFileSync(join(dir, n), 'utf8'), obj = JSON.parse(text);
    files.set(n, { name: n, obj, text, orig: structuredClone(obj) });
  }
  return { dir, files };
}

const nodeLines = (obj, id) => (obj.nodes && obj.nodes[id] && Array.isArray(obj.nodes[id].lines) ? obj.nodes[id].lines : null);
const renderLines = (a) => (a.length ? '[\n' + a.map((l) => '      ' + JSON.stringify(l)).join(',\n') + '\n    ]' : '[]');

/** Replaces the array `key` ("lines" / "choices") of node `id` inside the raw text with `rendered`; null when it can't be located. */
function replaceNodeArray(text, id, key, rendered) {
  const m = new RegExp('"' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*\\{').exec(text);
  if (!m) return null;
  const k = text.indexOf('"' + key + '"', m.index);
  if (k < 0) return null;
  const open = text.indexOf('[', k);
  let i = open, depth = 0, inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']' && --depth === 0) { i++; break; }
  }
  return text.slice(0, open) + rendered + text.slice(i);
}
/** Choices render on one line like the generator wrote them: [{"next": "a", "text": "b"}, ...] (ED-QUI-10). */
const renderChoices = (a) => '[' + a.map((c) => '{' + Object.entries(c).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + '}').join(', ') + ']';
const nodeChoices = (obj, id) => (obj.nodes && obj.nodes[id] && Array.isArray(obj.nodes[id].choices) ? obj.nodes[id].choices : null);

/** Text a dialogue file would be saved as (original text if no node's lines / choices changed). */
export function dialogueText(f) {
  let text = f.text;
  for (const id of Object.keys(f.obj.nodes || {})) {
    for (const [key, get, render] of [['lines', nodeLines, renderLines], ['choices', nodeChoices, renderChoices]]) {
      const now = get(f.obj, id), was = get(f.orig, id);
      if (!now || JSON.stringify(now) === JSON.stringify(was)) continue;
      const next = replaceNodeArray(text, id, key, render(now));
      if (next === null) throw new Error(`${f.name}: cannot locate node ${id}`);
      text = next;
    }
  }
  return text;
}

/** Writes changed dialogue files; returns the names written. A file's baseline moves to the saved state. */
export function saveDialogues(dm, fs) {
  const written = [];
  for (const [name, f] of dm.files) {
    const text = dialogueText(f);
    if (text === f.text) continue;
    fs.writeFileSync(join(dm.dir, name), text);
    f.text = text; f.orig = structuredClone(f.obj); written.push(name);
  }
  return written;
}

// ---------- which dialogue nodes belong to a quest ----------
/** [{ file, node, stage }] for quest id: entries gated on `s.<id>.<state>` plus their `next` chain and the accept choice. */
export function questNodes(dm, qid) {
  const out = [], pre = 's.' + qid + '.', preQ = 'q.' + qid + '.'; // hand-written routes use s.<id>.<state> (legacy) or q.<id>.<state> (quest book)
  for (const f of dm.files.values()) {
    const seen = new Set();
    const walk = (id, stage) => {
      const n = f.obj.nodes && f.obj.nodes[id];
      if (!n || seen.has(id)) return;
      seen.add(id);
      if (Array.isArray(n.lines)) out.push({ file: f.name, node: id, stage });
      if (n.next) walk(n.next, stage);
      for (const c of n.choices || []) if ((c.setFlag === pre + 'accept' || c.setFlag === preQ + 'accept') && c.next) walk(c.next, 'accept');
    };
    for (const e of f.obj.entry || []) {
      const m = e.requires && (e.requires.startsWith(pre) || e.requires.startsWith(preQ)) ? STATE_KEY[e.requires.slice(pre.length)] : null;
      if (m) walk(e.node, m);
    }
  }
  return out;
}

// ---------- rows for the panel ----------
const dkey = (file, node) => file + '#' + node;
const speakerName = (obj, node) => {
  const s = obj.nodes[node].speaker, sp = obj.speakers && obj.speakers[s];
  return human((sp && sp.label) || s || '');
};

/** Editable rows: [{ key, source:'pack'|'dialogue', stage, speaker, index, text, count, over }] in reading order. */
export function lineRows(q, dm, names = { npc: human }) {
  const rows = [], add = (key, source, stage, speaker, arr) => arr.forEach((text, index) =>
    rows.push({ key, source, stage, speaker, index, text, count: nChars(text), over: nChars(text) > LINE_MAX }));
  const giver = q.giver ? names.npc(q.giver) : '';
  for (const k of PACK_KEYS) if (q.raw.lines && Array.isArray(q.raw.lines[k])) add(k, 'pack', STAGE_LABEL[k], giver, q.raw.lines[k]);
  if (dm) for (const r of questNodes(dm, q.id)) {
    const f = dm.files.get(r.file);
    add(dkey(r.file, r.node), 'dialogue', STAGE_LABEL[r.stage], speakerName(f.obj, r.node), f.obj.nodes[r.node].lines);
  }
  return rows;
}

// ---------- pure edits ----------
function arrayOf(q, key, dm) {
  if (key.includes('#')) {
    const [file, node] = key.split('#'), f = dm && dm.files.get(file), a = f && nodeLines(f.obj, node);
    return a ? { dlg: true, f, node, arr: a } : null;
  }
  if (q.raw.lines && Array.isArray(q.raw.lines[key])) return { arr: q.raw.lines[key] };
  return PACK_KEYS.includes(key) ? { arr: [] } : null;
}

/** Undoable command that replaces the array of `key` with mutate(copy); or { error }. */
function lineCmd(label, q, key, dm, mutate) {
  const t = arrayOf(q, key, dm);
  if (!t) return { error: 'Unknown line group.' };
  const next = mutate([...t.arr]);
  if (next.error) return next;
  if (!t.dlg) return { cmd: setQuestField(q, 'lines', { ...(q.raw.lines || {}), [key]: next }) };
  const before = [...t.arr];
  const put = (a) => { t.f.obj.nodes[t.node].lines = [...a]; };
  return { cmd: { label, questId: q.id, apply: () => put(next), undo: () => put(before) } };
}

const tooLong = (text) => `That line is ${nChars(text)} characters; the limit is ${LINE_MAX}.`;

/** Sets line i of group `key` to text. Returns { cmd } or { error } (plain text; > 56 characters is refused). */
export function setLine(q, key, i, text, dm) {
  if (nChars(text) > LINE_MAX) return { error: tooLong(text) };
  return lineCmd('edit line', q, key, dm, (a) => (i >= 0 && i < a.length ? (a[i] = text, a) : { error: 'No such line.' }));
}
export function addLine(q, key, text = '', dm) {
  if (nChars(text) > LINE_MAX) return { error: tooLong(text) };
  return lineCmd('add line', q, key, dm, (a) => (a.push(text), a));
}
export function deleteLine(q, key, i, dm) {
  return lineCmd('delete line', q, key, dm, (a) => (i >= 0 && i < a.length ? (a.splice(i, 1), a) : { error: 'No such line.' }));
}
export function moveLine(q, key, from, to, dm) {
  return lineCmd('move line', q, key, dm, (a) => {
    if (from < 0 || from >= a.length || to < 0 || to >= a.length) return { error: 'No such line.' };
    const [x] = a.splice(from, 1); a.splice(to, 0, x); return a;
  });
}

// ---------- changed text for the writer ----------
/** Baseline of every quest's `lines` (call right after loading; dialogue baselines live in file.orig). */
export function captureBaseline(model) {
  return new Map(model.quests.map((q) => [q.id, structuredClone(q.raw.lines ?? null)]));
}

/** Changed / added / removed lines vs the baselines: [{ quest, stage, speaker, index, kind, before, after }]. */
export function changedLines(model, dm, base, names = { npc: human }) {
  const out = [];
  const diff = (quest, stage, speaker, was, now) => {
    for (let i = 0; i < Math.max(was.length, now.length); i++) {
      if (was[i] === now[i]) continue;
      out.push({ quest, stage, speaker, index: i, kind: i >= was.length ? 'added' : i >= now.length ? 'removed' : 'changed', before: was[i] ?? '', after: now[i] ?? '' });
    }
  };
  for (const q of model.quests) {
    const was = base.get(q.id) || {}, now = q.raw.lines || {};
    for (const k of PACK_KEYS) diff(q.title, STAGE_LABEL[k], q.giver ? names.npc(q.giver) : '', was[k] || [], now[k] || []);
  }
  const owner = new Map();
  if (dm) for (const q of model.quests) for (const r of questNodes(dm, q.id)) if (!owner.has(dkey(r.file, r.node))) owner.set(dkey(r.file, r.node), { q, stage: r.stage });
  if (dm) for (const f of dm.files.values()) for (const id of Object.keys(f.obj.nodes || {})) {
    const now = nodeLines(f.obj, id), was = nodeLines(f.orig, id);
    if (!now || !was || JSON.stringify(now) === JSON.stringify(was)) continue;
    const o = owner.get(dkey(f.name, id));
    diff(o ? o.q.title : f.name, o ? STAGE_LABEL[o.stage] : id, speakerName(f.obj, id), was, now);
  }
  return out;
}

/** Plain text list for the writer to review. */
export function exportChangedText(rows) {
  if (!rows.length) return 'No changed lines.\n';
  const out = [`Changed text (${rows.length})`, ''];
  let last = '';
  for (const r of rows) {
    const head = `${r.quest} - ${r.stage} (${r.speaker || 'no speaker'})`;
    if (head !== last) { if (last) out.push(''); out.push(head); last = head; }
    out.push(`  line ${r.index + 1} ${r.kind}:`);
    if (r.kind !== 'added') out.push(`    was: ${r.before}`);
    if (r.kind !== 'removed') out.push(`    now: ${r.after}`);
  }
  return out.join('\n') + '\n';
}
