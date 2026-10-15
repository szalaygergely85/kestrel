// SPELL-09: gameHooks handler. Every 10 ticks: (1) any `book.spell.<id>` in the pack is read (learned once, book removed, a toast line);
// (2) waystone wakes that teach a spell (spellBooks.wakeGrants) learn it once. State lives in world.state (spell.<id>) so it saves with the world.
import { removeItem, countOf } from './quest/sim/inventory.js';
import { SPELL_IDS } from './quest/spellDefs.js';
import { bookId, wakeGrants, learnLine, knownLine } from './quest/sim/spellBooks.js';

export const POLL_STEPS = 10;
/** One pass (also used by tests): returns the toast lines produced. `book` = createSpellBook-like { learn(id) }. */
export function readBooks(inv, book, state, out = []) {
  if (inv) for (let i = 0; i < SPELL_IDS.length; i++) {
    const id = SPELL_IDS[i], b = bookId(id), n = countOf(inv, b);
    if (n < 1) continue;
    removeItem(inv, b, n);
    out.push(book.learn(id) ? learnLine(id) : knownLine(id));
  }
  if (state) { const g = wakeGrants(state); for (let i = 0; i < g.length; i++) if (book.learn(g[i])) out.push(learnLine(g[i])); }
  return out;
}
/** @param {{getBook: () => any, notify?: (t: string) => void}} o */
export function createSpellBookHook({ getBook, notify = null } = {}) {
  let ctx = null, tick = 0;
  return {
    onBoot(c) { ctx = c; tick = 0; },
    onTick() {
      if (!ctx || ++tick % POLL_STEPS !== 0 || !ctx.world) return;
      const book = getBook(); if (!book) return;
      const lines = readBooks(ctx.inventory, book, ctx.world.state);
      for (let i = 0; i < lines.length; i++) { if (notify) notify(lines[i]); if (ctx.events) ctx.events.emit('spell:learned', { line: lines[i] }); }
    },
  };
}
