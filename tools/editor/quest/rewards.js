// tools/editor/quest/rewards.js - ED-QUI-06. Card [05] view model + edits: item tiles (plain names), heart piece, coin, next quest.
// Pure (imports model.js + format.js). Keeps the quest's shape: legacy `reward` {items, coin?, unlock?} or format `rewards` {items, coin?, heartPiece?}.
// Runtime check (2026-10-16): the reward grant (questBook.js) pays items only; `coin` is read by format/questLog but never granted -> coin tile disabled.
import { setQuestField } from './model.js';
import { formatView, isFormatDef, HEART_PIECE_ITEM } from './format.js';

export const COIN_NOTE = 'Currency: owner decision open';
const human = (s) => { const h = String(s ?? '').replace(/[._]/g, ' '); return h.charAt(0).toUpperCase() + h.slice(1); };

/**
 * rewardTiles(q, itemDefs, flags = { coinPaid: false }, model?) ->
 *  { items:[{id,name,n,rarity}], heart:{shown,n}, coin:{enabled,n,note}, next:{id,title,note}|null, empty, canRemoveLast:false, problems:[text] }
 */
export function rewardTiles(q, itemDefs = {}, flags = {}, model = null) {
  const v = formatView(q.raw), rw = v.rewards || {}, defs = itemDefs || {};
  const heartHere = Object.prototype.hasOwnProperty.call(defs, HEART_PIECE_ITEM);
  const all = (rw.items || []).map((i) => ({ id: i.id, n: i.n || 1 }));
  const heartN = (rw.heartPiece ? (rw.heartPiece === true ? 1 : rw.heartPiece) : 0) + all.filter((i) => i.id === HEART_PIECE_ITEM).reduce((s, i) => s + i.n, 0);
  const items = all.filter((i) => i.id !== HEART_PIECE_ITEM).map((i) => ({ ...i, name: (defs[i.id] && defs[i.id].name) || human(i.id), rarity: (defs[i.id] && defs[i.id].rarity) || '' }));
  const nx = v.next ? { id: v.next, title: ((model && model.quests.find((x) => x.id === v.next)) || {}).title || v.next, note: 'Offered at hand-in, never auto-started' } : null;
  const empty = !items.length && !heartN && !rw.coin;
  return {
    items, heart: { shown: heartHere, n: heartN }, coin: { enabled: !!flags.coinPaid, n: rw.coin || 0, note: flags.coinPaid ? '' : COIN_NOTE },
    next: nx, empty, canRemoveLast: false,
    problems: empty ? ['This quest rewards nothing (add an item, a heart piece or a coin)'] : [],
  };
}

/** Lint-style warning for a quest without reward. */
export function rewardLint(q, itemDefs, flags) {
  return rewardTiles(q, itemDefs, flags).empty ? [{ rule: 'RW', severity: 'warn', text: 'This quest has no reward', target: { kind: 'reward', id: 'reward' } }] : [];
}

/**
 * setRewardItems(q, { items:[{id,n}], heartPiece, coin }) -> { cmd } or { error } when the result would be empty (D-106).
 * Omitted keys keep the current value. Shape follows the quest: format `rewards` (heartPiece field) or legacy `reward` (heart as an item).
 */
export function setRewardItems(q, patch = {}) {
  const t = rewardTiles(q, { [HEART_PIECE_ITEM]: {} });
  const items = (patch.items || t.items).map((i) => ({ id: i.id, n: Math.max(1, i.n | 0) })).filter((i) => i.id);
  const heart = patch.heartPiece !== undefined ? Math.max(0, patch.heartPiece | 0) : t.heart.n, coin = patch.coin !== undefined ? Math.max(0, patch.coin | 0) : t.coin.n;
  if (!items.length && !heart && !coin) return { error: 'A quest always rewards something: the last reward cannot be removed.' };
  if (q.raw.rewards !== undefined || (isFormatDef(q.raw) && q.raw.reward === undefined)) {
    const r = {}; if (items.length) r.items = items; if (coin) r.coin = coin; if (heart) r.heartPiece = heart;
    return { cmd: setQuestField(q, 'rewards', r) };
  }
  const r = { ...(q.raw.reward || {}), items: heart ? [...items, { id: HEART_PIECE_ITEM, n: heart }] : items };
  if (coin) r.coin = coin; else delete r.coin;
  if (!r.items.length) delete r.items;
  return { cmd: setQuestField(q, 'reward', r) };
}
