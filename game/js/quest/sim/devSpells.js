// SPELL-DEV-01: `?spells=1` dev override. Learns every spell except Updraft at tier 1 (never lowers a higher tier) and tops the
// pack up to 2 Spell Scrolls. Pure; the caller (main.js) runs it once per world load. Dev only: it touches world.state / the pack
// only in memory, so a real save is affected only if the player then saves (same rule as ?fireball=1).
import { SPELL_IDS } from '../spellDefs.js';
import { SCROLL_ID } from './spellScroll.js';
import { countOf, addItem } from './inventory.js';

export const DEV_SCROLLS = 2;
export const DEV_SKIP = Object.freeze(['updraft']);

/** @returns {{learned:string[], scrolls:number}} what was changed */
export function applyDevSpells(book, inv, itemDefs) {
  const learned = [];
  for (const id of SPELL_IDS) if (DEV_SKIP.indexOf(id) < 0 && book.learn(id)) learned.push(id);
  let added = 0;
  if (inv && itemDefs) { const have = countOf(inv, SCROLL_ID); if (have < DEV_SCROLLS) added = addItem(inv, itemDefs, SCROLL_ID, DEV_SCROLLS - have); }
  return { learned, scrolls: added };
}
