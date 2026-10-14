// tools/editor/quest/model.js - ED-QUEST-01. Editable model of every quest
// file under content/quests (legacy *.quest.json, <region>/pack.json rows,
// sites.json). Pure Node (no DOM, no engine import); fs is injectable so the
// editor can supply its own io later. Each quest remembers its source file +
// shape; saving rewrites that file in its original text style (legacy: top
// level one key per line, objective-like arrays one row per line, everything
// else inline; pack/sites: JSON.stringify 2-space). Unknown fields stay
// untouched (a quest's `raw` IS the source row / file object).
// Browser-safe (ED-QUEST-02): node:fs is optional (top-level await + catch), so the editor page can import
// this module and pass an in-memory fs to loadQuests/saveQuest.
const nodeFs = await import('node:fs').catch(() => ({}));
const { readFileSync, writeFileSync, readdirSync, existsSync, statSync } = nodeFs;
const join = (...p) => p.join('/').replace(/\/+/g, '/');

// Top-level arrays rendered one element per line in legacy files.
const LEGACY_ROW_ARRAYS = new Set(['objectives', 'sections', 'lines']);

function inline(v) {
  if (Array.isArray(v)) return v.length ? '[' + v.map(inline).join(', ') + ']' : '[]';
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    return ks.length ? '{ ' + ks.map((k) => JSON.stringify(k) + ': ' + inline(v[k])).join(', ') + ' }' : '{}';
  }
  return JSON.stringify(v);
}

/** Canonical text of a legacy quest file object (key order preserved). */
export function stringifyLegacy(obj) {
  const lines = Object.keys(obj).map((k) => {
    const v = obj[k];
    if (LEGACY_ROW_ARRAYS.has(k) && Array.isArray(v) && v.length) {
      return `  ${JSON.stringify(k)}: [\n${v.map((e) => '    ' + inline(e)).join(',\n')}\n  ]`;
    }
    return `  ${JSON.stringify(k)}: ${inline(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** Canonical text of a sites file object. */
export function stringifyPack(obj) { return JSON.stringify(obj, null, 2) + '\n'; }

/**
 * Pack files mix styles (some rows hand-compacted), so the ORIGINAL text of
 * every row is kept and reused while the row is unchanged; only edited / new
 * rows are re-rendered (2-space JSON at the row's indent).
 * Returns { head, tail, rows:[{text, snap}] } or null without a quests array.
 */
export function splitPack(text) {
  const key = text.indexOf('"quests"');
  if (key < 0) return null;
  const open = text.indexOf('[', key);
  let i = open + 1;
  const rows = [];
  let head = null, lastEnd = open + 1;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] === ']') break;
    if (head === null) head = text.slice(0, i);
    const start = i;
    let depth = 0, inStr = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    const t = text.slice(start, i);
    lastEnd = i;
    rows.push({ text: t, snap: JSON.stringify(JSON.parse(t)) });
  }
  if (head === null) head = text.slice(0, open + 1) + '\n    ';
  return { head, tail: text.slice(lastEnd), rows };
}

function packText(f) {
  const sp = f.split;
  if (!sp) return stringifyPack(f.obj);
  const parts = f.obj.quests.map((row) => {
    const snap = JSON.stringify(row);
    const hit = sp.rows.find((r) => r.snap === snap);
    return hit ? hit.text : JSON.stringify(row, null, 2).split('\n').join('\n    ');
  });
  return sp.head + parts.join(',\n    ') + sp.tail;
}

/**
 * Quest = { id, title, kind:'legacy'|'pack', file, index, giver, returnText,
 *   objectives, reward, requires, lines, raw }. `raw` is the source object
 * (legacy file object / pack row); edits mutate it, then `refresh` re-derives.
 */
function normalize(raw, kind, file, index) {
  const giver = raw.giver ? raw.giver.npc || null : (raw.site || null);
  return {
    id: raw.id, title: raw.title, kind, file, index, giver,
    returnText: raw.returnText ?? null,
    objectives: raw.objectives || raw.steps || [],
    reward: raw.reward || null, requires: raw.requires || [], lines: raw.lines ?? null, raw,
  };
}

const REAL_FS = { readFileSync, readdirSync, existsSync, statSync };

/** Loads the whole quest dir -> { dir, quests, files, errors }. */
export function loadQuests(dir, fs = REAL_FS) {
  const files = new Map(), quests = [];
  const rd = (rel) => fs.readFileSync(join(dir, rel), 'utf8');
  for (const n of fs.readdirSync(dir).sort()) {
    if (n.endsWith('.quest.json')) {
      const text = rd(n), obj = JSON.parse(text);
      files.set(n, { kind: 'legacy', obj, text });
      quests.push(normalize(obj, 'legacy', n, null));
    } else if (n === 'sites.json') {
      const text = rd(n); files.set(n, { kind: 'sites', obj: JSON.parse(text), text });
    } else if (fs.statSync(join(dir, n)).isDirectory() && fs.existsSync(join(dir, n, 'pack.json'))) {
      const rel = n + '/pack.json', text = rd(rel), obj = JSON.parse(text);
      files.set(rel, { kind: 'pack', obj, text, split: splitPack(text) });
      (obj.quests || []).forEach((row, i) => quests.push(normalize(row, 'pack', rel, i)));
    }
  }
  return { dir, quests, files, errors: validate(quests) };
}

/** Error list: missing id/title, duplicate ids. */
export function validate(quests) {
  const errs = [], seen = new Map();
  for (const q of quests) {
    if (!q.id || typeof q.id !== 'string') errs.push(`${q.file}${q.index != null ? '#' + q.index : ''}: missing id`);
    if (!q.title || typeof q.title !== 'string') errs.push(`${q.id || q.file}: missing title`);
    if (q.id) {
      if (seen.has(q.id)) errs.push(`duplicate id ${q.id} (${seen.get(q.id)} and ${q.file})`);
      else seen.set(q.id, q.file);
    }
  }
  return errs;
}

/** Text a file would be saved as. */
export function fileText(f) {
  return f.kind === 'legacy' ? stringifyLegacy(f.obj) : f.kind === 'pack' ? packText(f) : stringifyPack(f.obj);
}

/** Writes the quest's ORIGINAL file only. Nothing is written on validation errors. */
export function saveQuest(model, q, fs = { writeFileSync }) {
  const errors = validate(model.quests);
  if (errors.length) return { ok: false, errors };
  const f = model.files.get(q.file);
  const text = fileText(f);
  if (text !== f.text) { fs.writeFileSync(join(model.dir, q.file), text); f.text = text; }
  return { ok: true, errors: [], file: q.file };
}

/** Saves every file whose text changed. */
export function saveAll(model, fs = { writeFileSync }) {
  const errors = validate(model.quests);
  if (errors.length) return { ok: false, errors, written: [] };
  const written = [];
  for (const [rel, f] of model.files) {
    const text = fileText(f);
    if (text !== f.text) { fs.writeFileSync(join(model.dir, rel), text); f.text = text; written.push(rel); }
  }
  return { ok: true, errors: [], written };
}

/** Re-derives the normalized view of a quest from its raw object. */
export function refresh(q) { Object.assign(q, normalize(q.raw, q.kind, q.file, q.index)); }

// ---- undoable commands: {label, questId, apply(), undo()}. Undo restores the
// whole raw object from a snapshot (key order included) -> exact bytes. ----

const objList = (q) => (q.raw.objectives ? q.raw.objectives : q.raw.steps || (q.raw.objectives = []));

function makeCmd(label, q, mutate) {
  let before = null, after = null;
  const put = (src) => {
    for (const k of Object.keys(q.raw)) delete q.raw[k];
    Object.assign(q.raw, structuredClone(src));
    refresh(q);
  };
  return {
    label, questId: q.id,
    apply() {
      if (!before) { before = structuredClone(q.raw); mutate(q.raw); after = structuredClone(q.raw); refresh(q); }
      else put(after);
    },
    undo() { put(before); },
  };
}

/** Sets (or deletes when value === undefined) a top-level field of the quest. */
export function setQuestField(q, field, value) {
  return makeCmd(`set ${field}`, q, (raw) => { if (value === undefined) delete raw[field]; else raw[field] = value; });
}
export function addObjective(q, obj, at = null) {
  return makeCmd('add objective', q, () => { const l = objList(q); l.splice(at == null ? l.length : at, 0, obj); });
}
export function moveObjective(q, from, to) {
  return makeCmd('move objective', q, () => { const l = objList(q); const [o] = l.splice(from, 1); l.splice(to, 0, o); });
}
export function removeObjective(q, at) {
  return makeCmd('remove objective', q, () => { objList(q).splice(at, 1); });
}

/** Minimal undo/redo stack for model commands. */
export function makeStack() {
  const undo = [], redo = [];
  return {
    run(c) { c.apply(); undo.push(c); redo.length = 0; },
    undo() { const c = undo.pop(); if (c) { c.undo(); redo.push(c); } return !!c; },
    redo() { const c = redo.pop(); if (c) { c.apply(); undo.push(c); } return !!c; },
  };
}
