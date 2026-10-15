// EP-SPELLS (SPELL-09): where each spell is learned. Pure data + small pure helpers (no DOM, no engine).
// A Spell Book is the pack item `book.spell.<spellId>`; picking one up learns the spell once (spellBookHook.js).
// Waystone wakes teach directly (no item). Burl's Fireball is not here (D-069). Freeze and Teleport are placed in SPELL-R6 (hint only until then).
import { SPELL_DEFS, SPELL_IDS } from '../spellDefs.js';

export const BOOK_PREFIX = 'book.spell.';
export const bookId = (spellId) => BOOK_PREFIX + spellId;
export const spellOfBook = (itemId) => (typeof itemId === 'string' && itemId.startsWith(BOOK_PREFIX) && SPELL_DEFS[itemId.slice(BOOK_PREFIX.length)] ? itemId.slice(BOOK_PREFIX.length) : null);

/** The single planned learn source per spell. kind: 'chest' (CHEST_TABLES id) | 'quest' (quest id, reward item) | 'wake' (see WAKE) | 'burl' | 'unplaced'. */
export const PLACEMENTS = Object.freeze({
  fireball: { kind: 'burl' },
  freeze: { kind: 'unplaced', hint: 'Look into the dry well.' }, // SPELL-R6: the dry well north of the post
  telekinesis: { kind: 'wake', rule: 'thirdNear' }, // the 3rd near-side Waystone
  teleport: { kind: 'unplaced', hint: 'Help Rook at the ford.' }, // SPELL-R6: mq.ford.mirror hand-in
});
/** Spells that must have exactly one source (everything except Burl's Fireball and the not yet placed Freeze/Teleport). */
export const PLACED_IDS = Object.freeze(SPELL_IDS.filter((id) => PLACEMENTS[id].kind !== 'burl' && PLACEMENTS[id].kind !== 'unplaced'));
/** Extra Spell Books in chests that are not the spell's own placement (none today; the bear den gets a Spell Scroll, not a book). */

// Waystone wake rules (ids of content/worlds/world_m1.world.json waystone components; side = which bank of the river, riverBand.test.js).
export const NEAR_SIDE = Object.freeze(['waystone', 'ws_roadBend', 'ws_northwood', 'ws_ashMile', 'ws_downs', 'ws_reedmire', 'ws_strand']);
export const FAR_REGION = Object.freeze(['ws_glasswater', 'ws_highPastures', 'ws_signalHill', 'ws_heath', 'ws_whitecombs']); // the open far-side regions (ford + outwall are story relays)
const woken = (st, id) => st['waystone.' + id + '.woken'] === true;
export function wakeGrants(st) {
  let near = 0; for (let i = 0; i < NEAR_SIDE.length; i++) if (woken(st, NEAR_SIDE[i])) near++;
  let far = false; for (let i = 0; i < FAR_REGION.length; i++) if (woken(st, FAR_REGION[i])) { far = true; break; }
  const out = [];
  for (const id of PLACED_IDS) { const p = PLACEMENTS[id]; if (p.kind === 'wake' && ((p.rule === 'thirdNear' && near >= 3) || (p.rule === 'firstFar' && far))) out.push(id); }
  return out;
}
/** One plain hint line for an unlearned spell, derived from PLACEMENTS (no per-id text). null = no source yet (hide the card). */
export function learnHint(spellId) {
  const p = PLACEMENTS[spellId];
  if (!p) return null;
  if (p.kind === 'unplaced') return p.hint || null;
  if (p.kind === 'burl') return 'Ask Burl.';
  if (p.kind === 'chest') return 'Find its Spell Book.';
  if (p.kind === 'quest') return 'Help Rook at the ford.';
  if (p.kind === 'wake') return p.rule === 'firstFar' ? 'Wake a waystone across the river.' : 'Wake more waystones.';
  return 'Find its Spell Book.';
}
export const learnLine = (spellId) => 'You learn ' + SPELL_DEFS[spellId].name + '.';
export const knownLine = (spellId) => 'You already know ' + SPELL_DEFS[spellId].name + '.';

/**
 * Content lint (SPELL-09 AC1). chestTables = CHEST_TABLES, questRewardItems = Map questId -> [itemId], itemDefs = ASSETS.items.defs.
 * Returns error strings: every placed spell has exactly ONE source (a chest table item, a quest reward item, or a wake rule), every
 * `book.spell.*` id matches a spellDefs id and is found nowhere else, and no book sits at an unknown place.
 */
export function lintSpellPlacements(chestTables, questRewardItems, itemDefs) {
  const errs = [], found = {};
  const add = (sp, where) => { (found[sp] = found[sp] || []).push(where); };
  for (const [cid, t] of Object.entries(chestTables || {})) for (const it of (t.fixed || []).concat(t.weighted || [])) {
    const id = it && (it.item || it.id); if (typeof id !== 'string' || !id.startsWith(BOOK_PREFIX)) continue;
    const sp = spellOfBook(id); if (!sp) errs.push(`SPELL-09: chest ${cid} holds "${id}" which matches no spellDefs id`); else add(sp, 'chest:' + cid);
  }
  for (const [qid, items] of questRewardItems || []) for (const id of items) {
    if (!id.startsWith(BOOK_PREFIX)) continue;
    const sp = spellOfBook(id); if (!sp) errs.push(`SPELL-09: quest ${qid} rewards "${id}" which matches no spellDefs id`); else add(sp, 'quest:' + qid);
  }
  for (const id of Object.keys(itemDefs || {})) if (id.startsWith(BOOK_PREFIX) && !spellOfBook(id)) errs.push(`SPELL-09: item ${id} matches no spellDefs id`);
  const wake = wakeGrants({ ...Object.fromEntries([...NEAR_SIDE, ...FAR_REGION].map((w) => ['waystone.' + w + '.woken', true])) });
  for (const sp of wake) add(sp, 'wake');
  for (const sp of SPELL_IDS) {
    const p = PLACEMENTS[sp], f = found[sp] || [];
    if (p.kind === 'burl' || p.kind === 'unplaced') { if (f.length) errs.push(`SPELL-09: ${sp} is ${p.kind} but found at ${f.join(', ')}`); continue; }
    const want = p.kind === 'wake' ? 'wake' : p.kind + ':' + p.id;
    if (f.length !== 1 || f[0] !== want) errs.push(`SPELL-09: ${sp} must be learned from exactly "${want}", found [${f.join(', ')}]`);
    if (p.kind === 'chest' && !(chestTables && chestTables[p.id])) errs.push(`SPELL-09: ${sp} planned in chest ${p.id} which has no table`);
    if (itemDefs && p.kind !== 'wake' && !itemDefs[bookId(sp)]) errs.push(`SPELL-09: no item def ${bookId(sp)}`);
  }
  return errs;
}
