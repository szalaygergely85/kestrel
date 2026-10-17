// UNDER-03 / OB-191 (arch 38.75 items 3 + 5): the Ford trade post cellar. Pure logic, no engine edits.
//  - trapdoor / ladder: E near the surface anchor `cellarTrapdoor` goes down, E near the cellar anchor `cellarLadder` goes up;
//    a 0.3 s climb (no fade), then the player is moved to the other anchor of the SAME world (seamless site, no load).
//    Nav link kind 3 for beasts: none yet (no beasts in the cellar, AC3); NEEDS B1-main: wire `stepFordCellar` + prompt.
//  - save flags (world.state, already serialised): under.fordCellar.chest.<id>, under.fordCellar.noteRead.
export const FORD_CELLAR = Object.freeze({
  site: 'fordCellar', climbS: 0.3, reach: 1.4, dz: 2.5, // reach = horizontal metres to an anchor; dz = max vertical gap (never trigger from the other layer)
  chests: ['chestCellar1', 'chestCellar2', 'chestCellar3'], note: 'cellarNote',
});
const KEY = FORD_CELLAR.site;
export const chestKey = (id) => `under.${KEY}.chest.${id}`;
export const NOTE_KEY = `under.${KEY}.noteRead`;

function anchors(world) {
  const a = world.entity('cellarTrapdoor'), b = world.entity('cellarLadder');
  if (!a || !b) return null;
  return { top: a.transform, bottom: b.transform };
}

/** Which ladder end the feet at (x, y, z) are at: 'down' (surface trapdoor), 'up' (cellar ladder) or null. */
export function ladderEnd(world, x, y, z) {
  const an = anchors(world);
  if (!an) return null;
  const R = FORD_CELLAR.reach, near = (t) => Math.hypot(x - t.x, y - t.y) <= R && Math.abs(z - t.z) <= FORD_CELLAR.dz;
  if (near(an.top)) return 'down';
  if (near(an.bottom)) return 'up';
  return null;
}
export const ladderPrompt = (end) => (end === 'down' ? '[E] Climb down' : end === 'up' ? '[E] Climb up' : '');

/** Where a climb ends: 0.8 m in front of the other anchor, on its z. */
export function ladderArrival(world, end, out) {
  const an = anchors(world), t = end === 'down' ? an.bottom : an.top;
  out.x = t.x; out.y = end === 'down' ? t.y + 0.9 : t.y - 1.0; out.z = t.z;
  return out;
}

/**
 * Per-frame ladder state. `s` = { t: 0, end: null } (reused). Returns true while a climb is running (the caller blocks movement).
 * `move(x, y, z)` is called once at the end of the 0.3 s climb; `feet` = { x, y, z }.
 */
export function stepFordCellar(world, s, dt, interactPressed, feet, move, scratch = { x: 0, y: 0, z: 0 }) {
  if (s.end) {
    s.t += dt;
    if (s.t >= FORD_CELLAR.climbS) { ladderArrival(world, s.end, scratch); move(scratch.x, scratch.y, scratch.z); s.end = null; s.t = 0; return false; }
    return true;
  }
  if (!interactPressed) return false;
  const end = ladderEnd(world, feet.x, feet.y, feet.z);
  if (end) { s.end = end; s.t = 0; return true; }
  return false;
}

/** Event hooks -> save flags. `events.on('chest:opened', ...)`; returns an unsubscribe. */
export function bindFordCellarFlags(world, events) {
  return events.on('chest:opened', (p) => { if (p && FORD_CELLAR.chests.includes(p.id)) world.state[chestKey(p.id)] = true; });
}
export const markNoteRead = (world) => { world.state[NOTE_KEY] = true; };
/** After Continue: rebuild the flags from the restored opened-chest list (the chest sim's own save). */
export function syncFordCellarFlags(world, openedChests) {
  for (const id of FORD_CELLAR.chests) if ((openedChests || []).includes(id)) world.state[chestKey(id)] = true;
}
