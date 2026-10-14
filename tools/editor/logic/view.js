// tools/editor/logic/view.js - ED-LOGIC-02b. Pure helpers for the Logic tab (no DOM, no game/ imports):
// plain labels from the vocab schema, arg type parsing, default items, 3D-pick -> ref value, live lint (schema + R15).
import { validateAll } from './model.js';

const SEC_KEY = { when: 'events', if: 'conds', do: 'acts' };
const humanize = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Entries of one section: [{name, label, args}] in schema order. sec = 'when' | 'if' | 'do'. */
export function entries(schema, sec) {
  const part = schema[SEC_KEY[sec]] || {};
  return Object.keys(part).map((name) => ({ name, label: part[name].label || humanize(name), args: part[name].args || {} }));
}
export const entryOf = (schema, sec, name) => entries(schema, sec).find((e) => e.name === name) || null;
export const argLabel = (schema, arg) => (schema.argLabels && schema.argLabels[arg]) || humanize(arg);

/** 'ref:area?' -> {kind:'ref', ref:'area', optional:true}; 'a|b' -> {kind:'enum', options}; int|bool|text. */
export function parseType(spec) {
  const optional = spec.endsWith('?'), t = optional ? spec.slice(0, -1) : spec;
  if (t.startsWith('ref:')) return { kind: 'ref', ref: t.slice(4), optional };
  if (t.includes('|')) return { kind: 'enum', options: t.split('|'), optional };
  return { kind: t, optional };
}

/** The key that names the entry inside a record: when.on / if.is / do.act. */
export const KEY = { when: 'on', if: 'is', do: 'act' };

/** Fresh item for an entry with sensible defaults (int 1, bool true, enum first, text/ref empty = flagged by lint). */
export function defaultItem(schema, sec, name) {
  const e = entryOf(schema, sec, name), o = { [KEY[sec]]: name };
  for (const a of Object.keys(e ? e.args : {})) {
    const t = parseType(e.args[a]);
    if (t.optional) continue;
    o[a] = t.kind === 'int' ? 1 : t.kind === 'bool' ? true : t.kind === 'enum' ? t.options[0] : '';
  }
  return o;
}

/** One-line readable sentence of an item: "Player enters an area: Rook yard". Refs go through names(refKind, id). */
export function itemText(schema, sec, item, names = {}) {
  if (item && item.is === 'not') return 'Not (' + itemText(schema, 'if', item.cond || {}, names) + ')';
  const e = entryOf(schema, sec, item[KEY[sec]]);
  if (!e) return 'Unknown: ' + item[KEY[sec]];
  const parts = Object.keys(e.args).filter((a) => item[a] !== undefined && item[a] !== '').map((a) => {
    const t = parseType(e.args[a]), v = item[a];
    const shown = t.kind === 'ref' ? ((names[t.ref] && names[t.ref](v)) || v) : t.kind === 'bool' ? (v ? 'yes' : 'no') : String(v);
    return argLabel(schema, a) + ' ' + shown;
  });
  const delay = sec === 'do' && item.after ? ` (after ${item.after} steps)` : '';
  return e.label + (parts.length ? ': ' + parts.join(', ') : '') + delay;
}

/** What a viewport click means for a ref slot. world = world json, areas = areas.json 'areas' map. -> {value} | {error}. */
export function refFromPick(refKind, hit, world, areas = {}, radius = 4) {
  const ents = (world && world.entities) || [], ent = hit && hit.entityId ? ents.find((e) => e.id === hit.entityId) : null;
  if (refKind === 'prop') return ent ? { value: ent.id } : { error: 'Click an object in the 3D view' };
  if (refKind === 'group') {
    const g = ent && (ent.group || (ent.components && ent.components.group));
    return g ? { value: g } : { error: ent ? 'That creature is not in a group' : 'Click a creature in the 3D view' };
  }
  if (refKind === 'area') {
    const p = hit && hit.point;
    if (!p) return { error: 'Click the ground inside an area' };
    let best = null, bd = Infinity;
    for (const id of Object.keys(areas)) {
      const a = areas[id], dx = (a.x ?? 0) - p.x, dy = (a.y ?? 0) - p.y, d = Math.hypot(dx, dy);
      if (d <= (a.r ?? a.radius ?? radius) && d < bd) { best = id; bd = d; }
    }
    return best ? { value: best } : { error: 'No area there' };
  }
  return { error: 'This value cannot be picked in the 3D view' };
}
export const PICKABLE = new Set(['prop', 'group', 'area']);

/** Ref sets for validateLogic: only kinds we really know (areas, props, groups, quests, items). */
export function buildRefs({ world, areas, quests, itemDefs }) {
  const ents = (world && world.entities) || [], refs = {};
  if (areas) refs.area = new Set(Object.keys(areas));
  refs.prop = new Set(ents.map((e) => e.id));
  refs.group = new Set(ents.map((e) => e.group || (e.components && e.components.group)).filter(Boolean));
  if (quests) refs.quest = new Set(quests);
  if (itemDefs) refs.item = new Set(Object.keys(itemDefs));
  return refs;
}

/** Live lint -> [{rule, severity, text, target:{file, id, sec, idx}}]. R0 = schema (validateLogic); R15 = content rules. */
export function lintLogic(model, schema, refs) {
  const out = [];
  for (const m of validateAll(model, schema, refs)) {
    const file = m.slice(0, m.indexOf(': ')), text = m.slice(m.indexOf(': ') + 2);
    const bm = /Block "([^"]+)"/.exec(text), im = /(condition|action) (\d+)/.exec(text);
    out.push({ rule: 'R15', severity: 'error', text, target: { file, id: bm ? bm[1] : null, sec: im ? (im[1] === 'condition' ? 'if' : 'do') : null, idx: im ? Number(im[2]) - 1 : -1 } });
  }
  // a group spawned by two blocks that are not once/max-limited could double-spawn
  const spawns = new Map();
  for (const f of model.files.values()) for (const b of f.blocks) for (const a of b.do || []) {
    if (a.act !== 'beasts.spawn' || !a.group) continue;
    const l = spawns.get(a.group) || []; l.push({ f: f.name, b }); spawns.set(a.group, l);
  }
  for (const [g, l] of spawns) if (l.length > 1 && l.some((x) => !x.b.once && !x.b.max)) {
    const x = l.find((y) => !y.b.once && !y.b.max);
    out.push({ rule: 'R15', severity: 'warn', text: `Block "${x.b.id}": creature group "${g}" is spawned by ${l.length} blocks and this one can fire more than once.`, target: { file: x.f, id: x.b.id, sec: 'do', idx: -1 } });
  }
  // flag loop: a block that sets the flag it listens to, with no once/max
  for (const f of model.files.values()) for (const b of f.blocks) {
    if (b.when && b.when.on === 'flag.set' && !b.once && !b.max && (b.do || []).some((a) => a.act === 'flag.set' && a.flag === b.when.flag))
      out.push({ rule: 'R15', severity: 'error', text: `Block "${b.id}": sets the flag it waits for and can loop forever. Mark it "once".`, target: { file: f.name, id: b.id, sec: 'when', idx: -1 } });
  }
  return out;
}
