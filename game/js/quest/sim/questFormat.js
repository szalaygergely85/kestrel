// QUEST-FORMAT (D-106): the one quest file format {id,title,begin,end,requires,objectives,rewards,next}. Pure, no imports.
// normalizeQuestDef(): new-format def -> the legacy shape the sim reads (giver/objectGiver/requires[]/reward), so old and new files both work.
// formatView(): any def (legacy or new) -> the canonical format fields (journal, lint, editor). Mirror for tools/editor: tools/editor/quest/format.js.
export const MAX_OBJECTIVES = 3;
export const HEART_PIECE_ITEM = 'heart.piece'; // item id of a heart piece (game/js/heartHook.js)

const has = (o, k) => o && o[k] !== undefined;
/** True for a def written in the new format (any of begin/end/rewards/next, or `requires` as an object). */
export const isFormatDef = (d) => !!d && (has(d, 'begin') || has(d, 'end') || has(d, 'rewards') || has(d, 'next') || (d.requires !== undefined && !Array.isArray(d.requires)));

/** New-format def -> legacy-shaped copy (legacy defs are returned as they are). NO xp: it is not mapped (D-020). */
export function normalizeQuestDef(def) {
  if (!isFormatDef(def)) return def;
  const d = { ...def, format: true };
  const g = { ...(def.giver || {}) };
  if (def.begin) { g.npc = def.begin.npc !== undefined ? def.begin.npc : def.begin.object; if (def.begin.object !== undefined) d.objectGiver = true; }
  if (def.end && def.end.npc !== undefined && def.end.npc !== g.npc) g.turnIn = def.end.npc;
  if (def.begin || def.giver) d.giver = g;
  delete d.begin; delete d.end;
  if (def.requires !== undefined && !Array.isArray(def.requires)) {
    d.requires = ((def.requires && def.requires.quests) || []).map((q) => ({ quest: q, done: true })); // whole quests only (no min level: D-020)
  }
  if (def.rewards !== undefined) {
    const r = def.rewards || {}, items = (r.items || []).map((i) => ({ ...i }));
    if (r.heartPiece) items.push({ id: HEART_PIECE_ITEM, n: r.heartPiece === true ? 1 : r.heartPiece });
    d.reward = { items }; if (r.coin) d.reward.coin = r.coin;
    delete d.rewards;
  }
  return d;
}

/** Canonical format view of any def: {id,title,begin,end,requires:{quests},objectives,rewards,next,nextHint}. Missing parts are null / empty. */
export function formatView(def) {
  const g = def.giver, begin = def.begin || (g && g.npc ? (def.objectGiver === true ? { object: g.npc } : { npc: g.npc }) : null);
  const end = def.end || (g && g.npc ? { npc: g.turnIn || g.npc } : null);
  const quests = Array.isArray(def.requires) ? def.requires.filter((r) => r && r.quest).map((r) => r.quest) : ((def.requires && def.requires.quests) || []);
  const rw = def.rewards || (def.reward ? { items: def.reward.items || [], ...(def.reward.coin ? { coin: def.reward.coin } : {}) } : null);
  return { id: def.id, title: def.title, begin, end, requires: { quests }, objectives: def.objectives || [], rewards: rw, next: def.next || null, nextHint: def.nextHint || null };
}

const rewardEmpty = (r) => !r || !((r.items && r.items.length) || r.coin || r.heartPiece);
const hasXp = (d) => [d, d.reward, d.rewards].some((o) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, 'xp')) || (d.objectives || []).some((o) => o && Object.prototype.hasOwnProperty.call(o, 'xp'));

/** Format problems of one def (strings). `ids` = Set of every known quest id. */
export function formatProblems(def, ids) {
  const v = formatView(def), out = [];
  if (!v.begin) out.push('no begin (every quest has a giver: an npc or an object)');
  if (!v.end) out.push('no end (the hand-in npc)');
  if (rewardEmpty(v.rewards)) out.push('empty rewards (a quest always rewards something)');
  if (v.objectives.length < 1) out.push('no objectives');
  if (v.objectives.length > MAX_OBJECTIVES) out.push(`${v.objectives.length} objectives (max ${MAX_OBJECTIVES})`);
  if (v.next && !ids.has(v.next)) out.push(`next "${v.next}" is not a known quest`);
  for (const q of v.requires.quests) if (!ids.has(q)) out.push(`requires unknown quest "${q}"`);
  if (hasXp(def)) out.push('xp field (no XP in this game, D-020)');
  return out;
}
