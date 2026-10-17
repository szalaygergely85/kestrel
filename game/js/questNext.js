// OB-183: "never stuck" rule. With no active main quest, name the nearest giver of an AVAILABLE main quest (else side quest).
// Pure (no world/DOM imports): the host passes ctx = { resolve(kind, id, out) -> bool, x, y } for "nearest"; without ctx the first giver wins.
import { AVAILABLE, ACTIVE, READY } from './quest/sim/questBook.js';

export const EXPLORE_TEXT = 'Explore - new work appears as you grow';
// Giver display names + where they stand (plain wording). Unknown ids fall back to a capitalised id and no place.
export const GIVER_INFO = Object.freeze({
  bear: { name: 'Burl', place: 'the tower camp' },
  rook: { name: 'Rook', place: 'the ford ruin' },
  hesk: { name: 'Hesk', place: null },
  dorrin: { name: 'Dorrin', place: null },
});
const tmp = { x: 0, y: 0 }, out = { kind: 'none', giver: null, name: '', place: '', text: EXPLORE_TEXT, main: false };
const cap = (id) => String(id).charAt(0).toUpperCase() + String(id).slice(1);

/** True while any main quest (m1 chain or mq.*) is active or waiting for its hand-in. */
export function hasActiveMain(book) {
  for (let i = 0; i < book.count; i++) if (!(i === 0 && book.def(0).internal) && book.isMain(i) && (book.status(i) === ACTIVE || book.status(i) === READY)) return true;
  return false;
}

/** Returns a shared { kind: 'main'|'side'|'none', giver, name, place, text, main } (copy it if kept). */
export function nextHint(book, ctx = null, info = GIVER_INFO) {
  out.kind = 'none'; out.giver = null; out.name = ''; out.place = ''; out.text = EXPLORE_TEXT; out.main = false;
  if (!book) return out;
  let best = null, bestMain = false, bestD = Infinity;
  for (let i = 1; i < book.count; i++) {
    if (book.status(i) !== AVAILABLE) continue;
    const g = book.giverOf(i), main = book.isMain(i);
    if (!g || book.def(i).objectGiver === true || (bestMain && !main)) continue;
    if (main && !bestMain) { best = null; bestD = Infinity; }
    let d = 0;
    if (ctx && ctx.resolve('giver', g, tmp)) d = (tmp.x - ctx.x) ** 2 + (tmp.y - ctx.y) ** 2;
    if (best === null || d < bestD) { best = g; bestD = d; bestMain = main; }
  }
  if (best === null) return out;
  const inf = info[best] || {};
  out.kind = bestMain ? 'main' : 'side'; out.main = bestMain; out.giver = best; out.name = inf.name || cap(best); out.place = inf.place || '';
  out.text = 'Next: talk to ' + out.name + (out.place ? ' (' + out.place + ')' : '');
  return out;
}

/** HUD / journal line: the Next: hint when the player has no active main quest, else null. */
export function nextLine(book, ctx = null, info = GIVER_INFO) {
  if (!book || typeof book.isMain !== 'function' || typeof book.giverOf !== 'function' || hasActiveMain(book)) return null; // stub books (tests) have no giver API
  return nextHint(book, ctx, info).text;
}
