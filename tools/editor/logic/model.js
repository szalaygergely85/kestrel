// tools/editor/logic/model.js - ED-LOGIC-02a (arch 38.70). Editable model of every content/logic/*.logic.json
// (array of When/If/Do blocks). Pure Node/browser-safe (node:fs optional, fs injectable like quest/model.js).
// The ORIGINAL file text is kept and written back until the file is edited (byte-identical round trip); edited
// files are rendered canonically (JSON.stringify 2-space + newline). The vocab schema (content/logic/vocab.schema.json,
// parity-tested against game/js/logic/vocab.js) is passed in; the editor never imports game/.
// `rev` rule (38.70): +1 when a block's When or If changes (incl. add/remove/move of conditions); never for Do/name/once/max.
import { validateLogic } from '../../../engine/index.js';
import { makeStack } from '../quest/model.js';
export { makeStack };

const nodeFs = await import('node:fs').catch(() => ({}));
const { readFileSync, writeFileSync, readdirSync } = nodeFs;
const REAL_FS = { readFileSync, readdirSync };
const join = (...p) => p.join('/').replace(/\/+/g, '/');
const clone = (v) => JSON.parse(JSON.stringify(v));
const SECTIONS = ['when', 'if', 'do'];

/** Canonical text of a logic file (array of blocks). */
export function stringifyLogic(blocks) { return JSON.stringify(blocks, null, 2) + '\n'; }

/** Loads every *.logic.json under dir -> { dir, files: Map(name -> {name, blocks, text, snap}), errors }. */
export function loadLogic(dir, fs = REAL_FS) {
  const files = new Map(), errors = [];
  for (const n of fs.readdirSync(dir).sort()) {
    if (!n.endsWith('.logic.json')) continue;
    try {
      const text = fs.readFileSync(join(dir, n), 'utf8'), blocks = JSON.parse(text);
      if (!Array.isArray(blocks)) throw new Error('not a list of blocks');
      files.set(n, { name: n, blocks, text, snap: JSON.stringify(blocks) });
    } catch (e) { errors.push(`${n}: ${e.message}`); }
  }
  return { dir, files, errors };
}

/** Text to write: the original while unedited, canonical otherwise. */
export function fileText(f) { return JSON.stringify(f.blocks) === f.snap ? f.text : stringifyLogic(f.blocks); }
export function isDirty(f) { return JSON.stringify(f.blocks) !== f.snap; }

export function saveLogic(model, f, fs = { writeFileSync }) {
  const text = fileText(f);
  fs.writeFileSync(join(model.dir, f.name), text);
  f.text = text; f.snap = JSON.stringify(f.blocks);
  return { ok: true };
}
export function saveAll(model, fs = { writeFileSync }) {
  const written = [];
  for (const f of model.files.values()) if (isDirty(f)) { saveLogic(model, f, fs); written.push(f.name); }
  return { written };
}

/** Plain-text validation of one file (schema vocab = content/logic/vocab.schema.json parsed) + ids unique across files. */
export function validateFile(f, schema, refs) { return validateLogic(f.blocks, schema, refs); }
export function validateAll(model, schema, refs) {
  const out = [], seen = new Map();
  for (const f of model.files.values()) {
    for (const e of validateFile(f, schema, refs)) out.push(`${f.name}: ${e}`);
    for (const b of f.blocks) { if (seen.has(b.id)) out.push(`${f.name}: block "${b.id}" is also in ${seen.get(b.id)}.`); else seen.set(b.id, f.name); }
  }
  return out;
}

const blockOf = (f, id) => { const b = f.blocks.find((x) => x.id === id); if (!b) throw new Error(`no block "${id}"`); return b; };

/** Generic undoable command: mutate(blocks) on apply; undo restores the exact prior blocks (in place, same array). */
function cmd(f, label, mutate) {
  let before = null, after = null;
  const put = (snap) => { f.blocks.splice(0, f.blocks.length, ...clone(snap)); };
  return {
    label, file: f.name,
    apply() { if (after) { put(after); return; } before = clone(f.blocks); mutate(f.blocks); after = clone(f.blocks); },
    undo() { put(before); },
  };
}
const bump = (b) => { b.rev = (b.rev || 1) + 1; };
const list = (b, sec) => { if (!b[sec]) b[sec] = []; return b[sec]; };

export function addBlock(f, block, at = null) {
  return cmd(f, 'Add block', (bs) => { const b = clone(block); if (b.rev === undefined) b.rev = 1; bs.splice(at === null ? bs.length : at, 0, b); });
}
export function deleteBlock(f, id) { return cmd(f, 'Delete block', (bs) => { bs.splice(bs.indexOf(blockOf(f, id)), 1); }); }
export function moveBlock(f, from, to) { return cmd(f, 'Move block', (bs) => { const [b] = bs.splice(from, 1); bs.splice(to, 0, b); }); }
/** name / once / max (never bumps rev). value undefined removes the key. */
export function setBlockField(f, id, field, value) {
  return cmd(f, 'Edit block', () => { const b = blockOf(f, id); if (value === undefined) delete b[field]; else b[field] = value; });
}
/** Replace the When (event name + args). Bumps rev. */
export function setWhen(f, id, when) { return cmd(f, 'Change When', () => { const b = blockOf(f, id); b.when = clone(when); bump(b); }); }
/** list sections 'if' | 'do': add / delete / move. 'if' edits bump rev. */
export function addItem(f, id, sec, item, at = null) {
  return cmd(f, 'Add ' + sec, () => { const b = blockOf(f, id), l = list(b, sec); l.splice(at === null ? l.length : at, 0, clone(item)); if (sec === 'if') bump(b); });
}
export function deleteItem(f, id, sec, idx) {
  return cmd(f, 'Delete ' + sec, () => { const b = blockOf(f, id); b[sec].splice(idx, 1); if (sec === 'if') bump(b); });
}
export function moveItem(f, id, sec, from, to) {
  return cmd(f, 'Move ' + sec, () => { const b = blockOf(f, id), l = b[sec]; const [x] = l.splice(from, 1); l.splice(to, 0, x); if (sec === 'if') bump(b); });
}
/** Set one arg: sec 'when' (idx ignored), 'if' or 'do' (item idx; `after` is a do-arg). value undefined removes. For 'not', pass a path in `name` as 'cond.quest'. */
export function setArg(f, id, sec, idx, name, value) {
  if (!SECTIONS.includes(sec)) throw new Error('bad section ' + sec);
  return cmd(f, 'Set ' + name, () => {
    const b = blockOf(f, id);
    let o = sec === 'when' ? b.when : b[sec][idx];
    const path = name.split('.'); name = path.pop();
    for (const p of path) o = o[p];
    if (value === undefined) delete o[name]; else o[name] = value;
    if (sec !== 'do') bump(b);
  });
}
