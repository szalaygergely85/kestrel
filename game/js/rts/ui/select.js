// game/js/rts/ui/select.js - RTS-01a pure selection rules (28.8), on plain arrays, no engine/DOM imports.
// Only team `ownTeam` is selectable. Ids are unit indices; `ids` from a box come ascending (selectInRect).

/** @param {number} max */
export function createSelection(max) {
  return { max, flags: new Uint8Array(max), count: 0 };
}

export function clearSelection(s) {
  if (s.count) s.flags.fill(0);
  s.count = 0;
}

function add(s, id) {
  if (!s.flags[id]) { s.flags[id] = 1; s.count++; }
}

/**
 * Click: `hitId` = the picked unit or -1 (empty ground). Empty ground clears (shift keeps). An enemy unit is
 * never selected and leaves the selection alone. An own unit replaces the selection (shift adds).
 * @param {{flags:Uint8Array,count:number}} s
 * @param {ArrayLike<number>} team unit team per id
 */
export function selectClick(s, team, hitId, shift, ownTeam) {
  if (hitId < 0) { if (!shift) clearSelection(s); return; }
  if (team[hitId] !== ownTeam) return;
  if (!shift) clearSelection(s);
  add(s, hitId);
}

/**
 * Box: `ids[0..n)` = units inside the rect. Own-team ids only; without shift the old selection is replaced
 * (an empty box clears it).
 */
export function selectBox(s, team, ids, n, shift, ownTeam) {
  if (!shift) clearSelection(s);
  for (let k = 0; k < n; k++) { const id = ids[k]; if (team[id] === ownTeam) add(s, id); }
}

/** Writes the selected ids ascending into `out`; returns how many. */
export function selectedIds(s, count, out) {
  let n = 0;
  for (let i = 0; i < count; i++) if (s.flags[i]) out[n++] = i;
  return n;
}
