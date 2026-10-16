// tools/editor/quest/objectiveCards.js - ED-QUI-04. Card [03]: one view model per objective step + kind / count edits.
// Pure (imports model.js, flow.js, targets.js, format.js). Legacy `objectives[].when` and pack `steps[].template` shapes both kept.
import { setQuestField } from './model.js';
import { objField, objText, objJournal } from './flow.js';
import { resolveTarget, stepWants } from './targets.js';
import { MAX_OBJECTIVES } from './format.js';

export const MAX_TEXT = 38;   // R19 objective title
export const MAX_NOTE = 'Max ' + MAX_OBJECTIVES + ' objectives (D-106)';
export const KIND_LABEL = { goto: 'Go to', flag: 'Flag', collect: 'Collect', deliver: 'Deliver', kill: 'Kill', talk: 'Talk', item: 'Item', escort: 'Escort' };
const COUNT_KINDS = new Set(['collect', 'kill']);   // item steps carry no count in the game (when.item has an id only)
const TPL = { explore: 'goto', collect: 'collect', deliver: 'deliver', fetch: 'item', kill: 'kill', talk: 'talk', escort: 'escort' };
const WHEN = { area: 'goto', flag: 'flag', collect: 'collect', item: 'item', deliver: 'deliver', beasts: 'kill' };

/** Kinds a quest of this shape can use (legacy has no talk / escort when-type). */
export const kindsFor = (q) => (objField(q) === 'steps' ? ['goto', 'collect', 'deliver', 'item', 'kill', 'talk', 'escort'] : ['goto', 'flag', 'collect', 'item', 'deliver', 'kill']);
export const kindOf = (step) => (step.template ? TPL[step.template] : WHEN[step.when && step.when.type]) || 'goto';
const p = (step) => (step.template ? (step.params || {}) : (step.when || {}));

/** A new blank step of `kind` in the quest's shape (title + journal kept; no field mixing). */
export function blankStep(q, kind, keep = {}) {
  const text = keep.text ?? 'New step', journal = keep.journal ?? '';
  if (objField(q) === 'steps') {
    const params = { goto: { areas: [] }, collect: { count: 1 }, deliver: { item: '', to: '' }, item: { item: '' }, kill: { kind: '', count: 1 }, talk: { to: '' }, escort: { npc: '', to: '' } }[kind];
    const template = { goto: 'explore', item: 'fetch' }[kind] || kind;
    return { template, params: structuredClone(params), objText: text, journal };
  }
  const when = { goto: { type: 'area', id: '' }, flag: { type: 'flag', id: '', equals: true }, collect: { type: 'collect', id: '', count: 1 }, item: { type: 'item', id: '' }, deliver: { type: 'deliver', id: '', count: 1, to: '' }, kill: { type: 'beasts', kind: '', count: 1 } }[kind];
  return { id: keep.id || 'step', text, journal, when };
}

/** Changing the kind = a new blank step of that kind (same position, text + journal kept). null when unchanged / not allowed. */
export function setStepKind(q, i, kind) {
  const field = objField(q), cur = q.raw[field][i];
  if (!cur || !kindsFor(q).includes(kind) || kindOf(cur) === kind) return null;
  const nx = blankStep(q, kind, { text: objText(cur), journal: cur.journal, id: cur.id });
  return setQuestField(q, field, q.raw[field].map((o, k) => (k === i ? nx : o)));
}

/** Count of a collect / kill step; refused (null) on every other kind or a non-positive integer. */
export function setStepCount(q, i, n) {
  const field = objField(q), cur = q.raw[field][i];
  if (!cur || !COUNT_KINDS.has(kindOf(cur)) || !Number.isInteger(n) || n < 1) return null;
  const nx = cur.template ? { ...cur, params: { ...cur.params, count: n } } : { ...cur, when: { ...cur.when, count: n } };
  return setQuestField(q, field, q.raw[field].map((o, k) => (k === i ? nx : o)));
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * -> { cards:[{n, kind, label, text, textLen, textBad, journal, count|null, canCount, target:{line, pos|null}, canPick, canUp, canDown}], canAdd, addNote, problems }.
 * ctx = { sites, names:{item,npc}, zones:[{id,x,y,r}] }.
 */
export function objectiveCards(q, world, ctx = {}) {
  const list = q.raw[objField(q)] || [], names = ctx.names || { item: (x) => x, npc: (x) => x };
  const zone = (id) => (ctx.zones || []).find((z) => z.id === id);
  const problems = [];
  if (list.length > MAX_OBJECTIVES) problems.push(list.length + ' objectives (max ' + MAX_OBJECTIVES + ', D-106)');
  const ent = (ref) => {
    const t = ref && ref !== '@turnIn' ? resolveTarget(world || { entities: [] }, ref, ctx) : null;
    if (t) return { line: names.npc(ref), pos: { x: r1(t.x), y: r1(t.y), z: r1(t.z) } };
    return { line: ref ? (ref === '@turnIn' ? 'the turn-in character' : 'Not found: ' + ref) : '(no target)', pos: null };
  };
  const cards = list.map((s, i) => {
    const kind = kindOf(s), v = p(s), text = objText(s);
    let target;
    if (kind === 'goto') { const a = s.template ? (v.areas || [])[0] : v.id, z = a && zone(a); target = { line: a ? 'Area ' + a + (z && z.r ? ' (radius ' + z.r + ' m)' : '') : '(no area)', pos: z ? { x: z.x, y: z.y, z: z.z ?? null } : null }; }
    else if (kind === 'flag') target = { line: v.id ? 'Flag ' + v.id : '(no flag)', pos: null };
    else if (kind === 'kill') target = { line: v.kind ? 'Any ' + v.kind : (v.ids ? v.ids.length + ' marked beasts' : '(no beast kind)'), pos: null };
    else if (kind === 'collect' || kind === 'item') { const id = s.template ? (v.ids ? v.ids[0] : v.item) : v.id; target = { line: id ? names.item(id) : '(no item)', pos: null }; }
    else if (kind === 'deliver') { const t = ent(v.to), it = v.item || v.id; target = { line: (it ? names.item(it) + ' to ' : '') + t.line, pos: t.pos }; }
    else if (kind === 'escort') { const t = ent(v.to); target = { line: (v.npc ? names.npc(v.npc) + ' to ' : '') + t.line, pos: t.pos }; }
    else target = ent(v.to);   // talk
    const canCount = COUNT_KINDS.has(kind);
    return {
      n: i + 1, kind, label: KIND_LABEL[kind], text, textLen: text.length, textBad: text.length > MAX_TEXT, journal: objJournal(s),
      count: canCount ? (Number.isInteger(v.count) ? v.count : 1) : null, canCount, target, canPick: !!stepWants(s), canUp: i > 0, canDown: i < list.length - 1,
    };
  });
  cards.forEach((c) => { if (c.textBad) problems.push('Step ' + c.n + ' title is ' + c.textLen + ' chars (max ' + MAX_TEXT + ')'); });
  return { cards, canAdd: list.length < MAX_OBJECTIVES, addNote: list.length < MAX_OBJECTIVES ? '' : MAX_NOTE, problems };
}
