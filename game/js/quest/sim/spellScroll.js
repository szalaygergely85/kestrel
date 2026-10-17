// EP-SPELLS (SPELL-02): Spell Scroll. The PLAYER chooses which learned spell rises; nothing here is random.
import { countOf, removeItem } from './inventory.js';
import { SPELL_DEFS, SPELL_IDS } from '../spellDefs.js';

export const SCROLL_ID = 'scroll.spell';
/** Learned spells below max, tree order: [{ id, name, level, max }]. Empty -> page text NO_RAISE_TEXT. */
export function raisable(book) {
  const out = [];
  for (const id of SPELL_IDS) if (book.canRaise(id)) out.push({ id, name: SPELL_DEFS[id].name, level: book.tier(id), max: SPELL_DEFS[id].maxTier });
  return out;
}
export const NO_RAISE_TEXT = 'No spell can learn from this yet.';
/** Spends exactly 1 scroll to raise `id` by 1. Returns { ok, level } or { ok:false, reason: 'none'|'max'|'notLearned' } (scroll kept). */
export function useScroll(inv, book, id) {
  if (!inv || !book || countOf(inv, SCROLL_ID) < 1) return { ok: false, reason: 'none' };
  const t = book.tier(id);
  if (t < 1) return { ok: false, reason: 'notLearned' };
  if (!book.canRaise(id)) return { ok: false, reason: 'max' };
  const level = book.raise(id);
  removeItem(inv, SCROLL_ID, 1);
  return { ok: true, level };
}
