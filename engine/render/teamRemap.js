// @ts-check
// engine/render/teamRemap.js - RE-06 (docs/architecture.md 28.6 decision 5).
// Team colour = material remap. A spec names up to TEAM_SLOTS "slot"
// materials (neutral placeholders the unit model is painted with, e.g.
// `team.a`) and, per team index, which palette material each slot becomes.
// Both twins (the instanced vertex shader, rasterJS.js) read the resulting
// flat typed arrays from `table.team`; nothing here runs per frame.

/** Remappable material slots per model. */
export const TEAM_SLOTS = 4;
/** Team indices 0..MAX_TEAMS-1 (0 = no remap). */
export const MAX_TEAMS = 8;

/**
 * @typedef {Object} TeamRemap
 * @property {Uint32Array} slotIds - TEAM_SLOTS material ids, 0 = slot unused
 * @property {Uint32Array} mat - MAX_TEAMS * TEAM_SLOTS: material id for (team, slot); identity for team 0 / unlisted slots
 */

/** @returns {TeamRemap} an all-zero (no-op) remap. */
export function emptyTeamRemap() {
  return { slotIds: new Uint32Array(TEAM_SLOTS), mat: new Uint32Array(MAX_TEAMS * TEAM_SLOTS) };
}

/**
 * @param {{idFor: (key: string) => number, hasKey?: (key: string) => boolean}} table - a bound MaterialTable
 * @param {{slots: string[], teams: Array<Object<string,string>|null>}|null} spec
 * @returns {TeamRemap}
 */
export function buildTeamRemap(table, spec) {
  const out = emptyTeamRemap();
  if (!spec) return out;
  const idOf = (key) => {
    // `idFor` would happily invent an id for a typo: check the key exists first.
    if (table.hasKey && !table.hasKey(key)) throw new Error(`buildTeamRemap: unknown material key "${key}"`);
    const id = table.idFor(key);
    if (!id) throw new Error(`buildTeamRemap: unknown material key "${key}"`);
    return id;
  };
  const slots = spec.slots || [];
  if (slots.length > TEAM_SLOTS) throw new Error(`buildTeamRemap: ${slots.length} slots > ${TEAM_SLOTS}`);
  const teams = spec.teams || [];
  if (teams.length > MAX_TEAMS) throw new Error(`buildTeamRemap: ${teams.length} teams > ${MAX_TEAMS}`);
  for (let s = 0; s < slots.length; s++) out.slotIds[s] = idOf(slots[s]);
  for (let t = 0; t < MAX_TEAMS; t++) {
    for (let s = 0; s < TEAM_SLOTS; s++) out.mat[t * TEAM_SLOTS + s] = out.slotIds[s]; // identity
    const map = t < teams.length ? teams[t] : null;
    if (t === 0 || !map) continue;
    for (const key of Object.keys(map)) {
      const s = slots.indexOf(key);
      if (s < 0) throw new Error(`buildTeamRemap: team ${t} maps "${key}", which is not a slot`);
      out.mat[t * TEAM_SLOTS + s] = idOf(map[key]);
    }
  }
  return out;
}

/**
 * Scalar twin of the vertex-shader loop (mesh.vert.js instanced variant).
 * @param {TeamRemap} team
 * @param {number} teamIdx
 * @param {number} mat
 */
export function remapTeamMat(team, teamIdx, mat) {
  if (teamIdx === 0 || mat === 0) return mat;
  for (let s = 0; s < TEAM_SLOTS; s++) {
    if (team.slotIds[s] === mat) return team.mat[teamIdx * TEAM_SLOTS + s];
  }
  return mat;
}
