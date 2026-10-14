// D-098: which character finishes a TALK step. Maps a flag set by a dialogue node (`setFlag`) to the NPC whose dialogue file sets it.
// Input: raw dialogue json by npc id ({ bear: {...nodes} }). Derivation only; explicit `mark.end` in quest data still wins.
export function dialogueFlagOwners(rawByNpc) {
  const out = {};
  const walk = (npc, v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.setFlag === 'string' && !(v.setFlag in out)) out[v.setFlag] = npc;
    for (const k of Object.keys(v)) walk(npc, v[k]);
  };
  for (const npc of Object.keys(rawByNpc || {})) walk(npc, rawByNpc[npc]);
  return out;
}

/** D-098 / QFIX-S4b: hand-ins happen in the quest window now (no setFlag in the dialogue); the flag `quest.<id>.done` belongs to the hand-in character. */
export function handInFlagOwners(defs) {
  const out = {};
  for (const d of defs || []) { const g = d && d.giver; if (g && d.id && (g.turnIn || g.npc)) out['quest.' + d.id + '.done'] = g.turnIn || g.npc; }
  return out;
}
