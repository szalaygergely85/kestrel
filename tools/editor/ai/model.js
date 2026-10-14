// tools/editor/ai/model.js - ED-AI-01. Editable model of content/beasts/archetypes.json + kinds.json (architecture.md 38.64).
// Pure Node, reads the JSON files only (no game/ import); fs is injectable. Load -> save with no edit is byte-identical:
// the source text is kept and reused until a command changes the data (then the canonical layout is written). Unknown
// fields stay (the objects ARE the parsed file). Commands are { label, apply, undo } for makeStack (same shape as the
// quest editor commands); undo restores the exact data and therefore the exact bytes.
import { validateBeasts } from './validate.js';
export { makeStack } from '../quest/model.js';
const nodeFs = await import('node:fs').catch(() => ({}));
const REAL_FS = nodeFs;
const J = JSON.stringify;
const join = (...p) => p.join('/').replace(/\/+/g, '/');

function inline(v) {
  if (Array.isArray(v)) return v.length ? '[' + v.map(inline).join(', ') + ']' : '[]';
  if (v && typeof v === 'object') { const ks = Object.keys(v); return ks.length ? '{' + ks.map((k) => J(k) + ': ' + inline(v[k])).join(', ') + '}' : '{}'; }
  return J(v);
}
const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

/** Canonical text: 2-space indent, key order kept, one entry per line; a field holding a list of objects (attacks) is
 * expanded one row per line; trailing newline. */
export function stringifyBeasts(table) {
  const entries = Object.keys(table).map((k) => {
    const e = table[k];
    if (!e || typeof e !== 'object' || !Object.keys(e).some((f) => isRows(e[f]))) return `  ${J(k)}: ${inline(e)}`;
    const fields = Object.keys(e).map((f) => isRows(e[f])
      ? `    ${J(f)}: [\n${e[f].map((r) => '      ' + inline(r)).join(',\n')}\n    ]`
      : `    ${J(f)}: ${inline(e[f])}`);
    return `  ${J(k)}: {\n${fields.join(',\n')}\n  }`;
  });
  return entries.length ? `{\n${entries.join(',\n')}\n}\n` : '{}\n';
}

const FILES = { arch: 'archetypes.json', kinds: 'kinds.json' };

/** Loads the two files of `dir` (content/beasts). Returns the model { dir, files, errors, arch, kinds }. */
export function loadArchetypes(dir, fs = REAL_FS) {
  const files = {}, errors = [];
  for (const [key, name] of Object.entries(FILES)) {
    const text = fs.readFileSync(join(dir, name), 'utf8');
    let obj = {};
    try { obj = JSON.parse(text); } catch (e) { errors.push(`${name}: not valid JSON (${e.message})`); }
    files[key] = { name, text, obj, snap: J(obj) };
  }
  return { dir, files, errors, get arch() { return files.arch.obj; }, get kinds() { return files.kinds.obj; } };
}

/** Current text of one file: the original while untouched, else the canonical layout. */
export function fileText(f) { return J(f.obj) === f.snap ? f.text : stringifyBeasts(f.obj); }
export const validateModel = (m) => validateBeasts(m.arch, m.kinds);

/** Writes the files that changed. Returns { written: [names] }. */
export function saveArchetypes(m, fs = REAL_FS) {
  const written = [];
  for (const f of Object.values(m.files)) {
    const t = fileText(f);
    if (t === f.text) continue;
    fs.writeFileSync(join(m.dir, f.name), t);
    f.text = t; f.snap = J(f.obj); written.push(f.name);
  }
  return { written };
}

// ---- commands. The first apply() edits and records before/after; later apply()/undo() swap the recorded copies, so the
// file object is replaced (m.arch / m.kinds are getters and always read the live one). ----
function cmd(label, f, edit) {
  let before = null, after = null;
  return {
    label,
    apply() { if (before === null) { before = J(f.obj); edit(f.obj); after = J(f.obj); } else f.obj = JSON.parse(after); },
    undo() { f.obj = JSON.parse(before); },
  };
}
export function setArchField(m, name, field, value) {
  return cmd(`set ${name}.${field}`, m.files.arch, (o) => { if (!o[name]) throw new Error(`no archetype "${name}"`); if (value === undefined) delete o[name][field]; else o[name][field] = value; });
}
const attacksOf = (o, kind) => { if (!o[kind]) throw new Error(`no kind "${kind}"`); return o[kind].attacks; };
export function setAttackField(m, kind, idx, field, value) {
  return cmd(`set ${kind}.attacks[${idx}].${field}`, m.files.kinds, (o) => { const a = attacksOf(o, kind)[idx]; if (!a) throw new Error('no attack ' + idx); if (value === undefined) delete a[field]; else a[field] = value; });
}
const NEW_ATTACK = { id: 'attack', type: 'melee', range: 2, windupSec: 0.5, activeSec: 0.3, recoverSec: 1, cooldownSec: 2, dmgF: 1, weight: 1 };
export function addAttack(m, kind, attack = NEW_ATTACK) {
  return cmd(`add ${kind} attack`, m.files.kinds, (o) => { attacksOf(o, kind).push({ ...attack }); });
}
export function removeAttack(m, kind, idx) {
  return cmd(`remove ${kind} attack ${idx}`, m.files.kinds, (o) => { attacksOf(o, kind).splice(idx, 1); });
}

// ---- ED-AI-04: content/beasts/spawnAreas.json (painted spawn areas). Same byte-identical load/save + undoable commands. ----
import { validateSpawnAreas } from './spawnAreas.js';

/** Canonical text: { "areas": [ one area per line ] } + trailing newline; empty list -> "areas": []. */
export function stringifySpawnAreas(file) {
  const areas = file.areas || [], rest = Object.keys(file).filter((k) => k !== 'areas').map((k) => `  ${J(k)}: ${inline(file[k])}`);
  const body = areas.length ? `[\n${areas.map((a) => '    ' + inline(a)).join(',\n')}\n  ]` : '[]';
  return `{\n  "areas": ${body}${rest.length ? ',\n' + rest.join(',\n') : ''}\n}\n`;
}

/** Loads <dir>/spawnAreas.json (a missing file = empty list). Returns { dir, file:{name,text,obj,snap}, errors, get areas }. */
export function loadSpawnAreas(dir, fs = REAL_FS) {
  const errors = [];
  let text = '';
  try { text = fs.readFileSync(join(dir, 'spawnAreas.json'), 'utf8'); } catch (e) { text = ''; }
  let obj = { areas: [] };
  if (text) { try { obj = JSON.parse(text); } catch (e) { errors.push(`spawnAreas.json: not valid JSON (${e.message})`); } }
  const file = { name: 'spawnAreas.json', text, obj, snap: J(obj) };
  return { dir, file, errors, get areas() { return file.obj.areas; } };
}
export const spawnAreasText = (m) => (J(m.file.obj) === m.file.snap && m.file.text ? m.file.text : stringifySpawnAreas(m.file.obj));
export const validateSpawnAreasModel = (m, kinds) => validateSpawnAreas(m.file.obj, kinds);
export function saveSpawnAreas(m, fs = REAL_FS) {
  const t = spawnAreasText(m);
  if (t === m.file.text) return { written: [] };
  fs.writeFileSync(join(m.dir, m.file.name), t);
  m.file.text = t; m.file.snap = J(m.file.obj);
  return { written: [m.file.name] };
}
const areaOf = (o, id) => { const a = o.areas.find((x) => x.id === id); if (!a) throw new Error(`no spawn area "${id}"`); return a; };
export function addSpawnArea(m, area) {
  return cmd(`add spawn area ${area.id}`, m.file, (o) => { if (o.areas.some((x) => x.id === area.id)) throw new Error(`spawn area "${area.id}" exists`); o.areas.push(JSON.parse(J(area))); });
}
export function removeSpawnArea(m, id) {
  return cmd(`remove spawn area ${id}`, m.file, (o) => { areaOf(o, id); o.areas = o.areas.filter((x) => x.id !== id); });
}
export function setSpawnAreaField(m, id, field, value) {
  return cmd(`set spawn area ${id}.${field}`, m.file, (o) => { const a = areaOf(o, id); if (value === undefined) delete a[field]; else a[field] = value; });
}
