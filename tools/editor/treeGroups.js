// tools/editor/treeGroups.js - OB-028: pure grouping model for the scene tree
// (no DOM). Items from doc.js `listOutlinerItems` -> category groups
// (Entities / Structures / Lights / Triggers / Water / Levels) plus user
// groups, fold state, and the `editorGroups` world-file field round trip.

export const CATEGORIES = ['Entities', 'Structures', 'Lights', 'Triggers', 'Water', 'Levels'];
const WATER_RE = /water|river|lake|pond|waterfall/i;

/** Stable identity of an outliner row, used in `editorGroups[].ids`. */
export function itemKey(o) { return `${o.fileId}|${o.collection}|${o.id}`; }

export function categoryOf(o) {
  if (o.collection === 'levels') return 'Levels';
  const text = `${o.id} ${o.item?.mesh || ''} ${o.item?.model || ''} ${o.item?.type || ''} ${o.item?.kind || ''}`;
  if (WATER_RE.test(text)) return 'Water';
  if (o.collection === 'lights') return 'Lights';
  if (o.collection === 'triggers') return 'Triggers';
  if (o.collection === 'structures') return 'Structures';
  return 'Entities'; // props, interactables, world entities (NPCs, pickups, chests, relays...)
}

/** Sub-group of a Structures row: mesh pack + name prefix (`poi123` -> `poi###`, `DeadTree_1` -> `DeadTree`). */
export function subKeyOf(o) {
  if (categoryOf(o) !== 'Structures') return null;
  const mesh = String(o.item?.mesh || o.id);
  const slash = mesh.lastIndexOf('/');
  const pack = slash >= 0 ? mesh.slice(0, slash) : '';
  let base = mesh.slice(slash + 1);
  base = /^poi\d+/i.test(base) ? 'poi###' : base.replace(/[_-]?\d+$/, '') || base;
  return pack ? `${pack}/${base}` : base;
}

// ---- fold state (a Set of CLOSED group keys; default = everything open) ----
export function parseFold(text) {
  try {
    const raw = JSON.parse(text);
    return new Set(Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []);
  } catch (_) { return new Set(); }
}
export function serializeFold(closed) { return JSON.stringify([...closed].sort()); }
export function toggleFold(closed, key) {
  const next = new Set(closed);
  if (!next.delete(key)) next.add(key);
  return next;
}

// ---- user groups (`editorGroups: [{name, ids:[itemKey...]}]`) --------------
export function normalizeUserGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), out = [];
  for (const g of raw) {
    if (!g || typeof g.name !== 'string' || !g.name.trim() || !Array.isArray(g.ids) || seen.has(g.name)) continue;
    seen.add(g.name);
    out.push({ name: g.name, ids: g.ids.filter((k) => typeof k === 'string') });
  }
  return out;
}
/** Adds (or extends) group `name`; a key can live in one group only (moved from others). */
export function addUserGroup(groups, name, keys) {
  name = String(name || '').trim();
  if (!name) throw new Error('group name required');
  const moved = new Set(keys);
  const next = groups.map((g) => ({ name: g.name, ids: g.ids.filter((k) => !moved.has(k)) }));
  const existing = next.find((g) => g.name === name);
  if (existing) existing.ids.push(...keys); else next.push({ name, ids: [...keys] });
  return next.filter((g) => g.ids.length);
}
/** Ungroup: removes the keys from whichever group holds them (empty groups vanish). */
export function removeFromUserGroups(groups, keys) {
  const gone = new Set(keys);
  return groups.map((g) => ({ name: g.name, ids: g.ids.filter((k) => !gone.has(k)) })).filter((g) => g.ids.length);
}
/** Drops ids that no longer exist (deleted items). */
export function pruneUserGroups(groups, existingKeys) {
  const have = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  return groups.map((g) => ({ name: g.name, ids: g.ids.filter((k) => have.has(k)) })).filter((g) => g.ids.length);
}
/** World-file write: an empty list REMOVES the field so unused files stay byte-identical. */
export function writeUserGroups(worldDef, groups) {
  if (groups.length) worldDef.editorGroups = groups.map((g) => ({ name: g.name, ids: [...g.ids] }));
  else delete worldDef.editorGroups;
}
export function readUserGroups(worldDef) { return normalizeUserGroups(worldDef && worldDef.editorGroups); }
/** Schema check for validate-content: returns error strings. */
export function validateEditorGroups(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return ['editorGroups must be an array'];
  const errs = [];
  v.forEach((g, i) => {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) errs.push(`editorGroups[${i}].name must be a non-empty string`);
    if (!g || !Array.isArray(g.ids) || g.ids.some((k) => typeof k !== 'string')) errs.push(`editorGroups[${i}].ids must be a string array`);
  });
  return errs;
}

/**
 * items -> ordered groups `{key, title, user, count, open, subs:[{key,title,count,open,items}]}`.
 * `filter` is a collection name or 'all'; `query` an id substring; while a
 * query is active every group with a match is shown open. `forceOpen` is a
 * Set of group/sub keys to open regardless (selection reveal).
 */
export function buildTreeGroups(items, { userGroups = [], query = '', filter = 'all', closed = new Set(), forceOpen = new Set() } = {}) {
  const q = query.trim().toLowerCase();
  const keep = items.filter((o) => (filter === 'all' || o.collection === filter) && (!q || o.id.toLowerCase().includes(q)));
  const owner = new Map();
  for (const g of userGroups) for (const k of g.ids) owner.set(k, g.name);
  const buckets = new Map(), order = [];
  const bucket = (key, title, user) => {
    if (!buckets.has(key)) { buckets.set(key, { key, title, user, subs: new Map() }); order.push(key); }
    return buckets.get(key);
  };
  for (const g of userGroups) bucket(`user:${g.name}`, g.name, true);
  for (const c of CATEGORIES) bucket(`cat:${c}`, c, false);
  for (const o of keep) {
    const u = owner.get(itemKey(o));
    const b = u !== undefined ? bucket(`user:${u}`, u, true) : bucket(`cat:${categoryOf(o)}`, categoryOf(o), false);
    const sub = u !== undefined ? null : subKeyOf(o);
    const sk = sub === null ? '' : `${b.key}/${sub}`;
    if (!b.subs.has(sk)) b.subs.set(sk, { key: sk, title: sub, items: [] });
    b.subs.get(sk).items.push(o);
  }
  const isOpen = (key) => forceOpen.has(key) || (q ? true : !closed.has(key));
  const out = [];
  for (const key of order) {
    const b = buckets.get(key);
    const subs = [...b.subs.values()].sort((a, c) => (a.title || '').localeCompare(c.title || ''));
    const count = subs.reduce((n, s) => n + s.items.length, 0);
    if (!count && (!b.user || q || filter !== 'all')) continue;
    // a lone sub-group adds nothing: flatten it
    const flat = subs.length === 1 ? [{ ...subs[0], title: null, key: '' }] : subs;
    const open = isOpen(key);
    out.push({
      key, title: b.title, user: b.user, count, open,
      subs: flat.map((s) => ({ key: s.key, title: s.title, count: s.items.length, open: !s.key || isOpen(s.key), items: s.items })),
    });
  }
  return out;
}

/** Keys (group + sub) that must open to show item `o`. */
export function revealKeys(items, o, userGroups = []) {
  const u = userGroups.find((g) => g.ids.includes(itemKey(o)));
  const key = u ? `user:${u.name}` : `cat:${categoryOf(o)}`;
  const sub = u ? null : subKeyOf(o);
  return new Set(sub === null ? [key] : [key, `${key}/${sub}`]);
}
