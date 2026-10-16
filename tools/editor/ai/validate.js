// tools/editor/ai/validate.js - ED-AI-01. Plain-language validator for content/beasts/archetypes.json + kinds.json
// (architecture.md 38.64 (1), epic ep-bestiary.md tables 1-2). Pure: no fs, no game/ import (check-deps), never throws;
// every function returns an array of messages. Enum lists and the order of the 11 archetypes are mirrored here on purpose
// (model.test.mjs compares them with game/js/quest/sim/archetypes.js).
export const LEASH_NEVER = 1e9; // "No leash" sentinel
export const ARCH_ENUMS = Object.freeze({
  aggro: ['hostile', 'whenHit', 'never', 'near'],
  role: ['melee', 'ranged', 'caster', 'swarm', 'flyer', 'water', 'ambush', 'tank'],
  medium: ['land', 'water', 'air'],
  when: ['any', 'day', 'night'],
});
/** The shipped archetype order (the archIdx stored per slot): append only. */
export const ARCH_ORDER = Object.freeze(['grazer', 'skittish', 'packHunter', 'ambusher', 'waterAmbusher', 'swimmer', 'tank', 'ranged', 'flyer', 'swarm', 'caster']);
export const WINDUP_MIN_SEC = 0.4;     // COMBAT_TARGETS.windupMinSec
export const BIG_WINDUP_MIN_SEC = 0.8; // "big" attack = area attack or dmgF >= 2.4
export const MAX_ATTACKS = 3;
export const WALK_RUN_MAX = 12;
export const leashLabel = (v) => (v >= LEASH_NEVER ? 'No leash' : `${v} m`);

const LABEL = {
  noticeR: 'Notice distance', nearR: 'Near distance', coneCos: 'View cone', noticeSec: 'Notice time', loseR: 'Lose-target distance',
  loseSightSec: 'Lose-sight time', leashR: 'Leash distance', walk: 'Walk speed', run: 'Run speed', keepMin: 'Keep-away minimum',
  keepMax: 'Keep-away maximum', backOffR: 'Back-off distance', aggro: 'Aggression', role: 'Combat role', medium: 'Movement medium', when: 'Active time',
};
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Errors of one archetype object. `name` only prefixes the messages. */
export function validateArchetype(a, name = '') {
  const e = [];
  const who = `Archetype "${name}"`;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [`${who} is not an object.`];
  const range = (f, lo, hi, unit = '') => {
    if (!num(a[f])) { e.push(`${who}: ${LABEL[f]} (${f}) must be a number.`); return false; }
    if (a[f] < lo || a[f] > hi) { e.push(`${who}: ${LABEL[f]} (${f}) must be between ${lo} and ${hi}${unit}, but is ${a[f]}.`); return false; }
    return true;
  };
  const okNotice = range('noticeR', 1, 80, ' m');
  const okNear = range('nearR', 0, 80, ' m');
  if (okNotice && okNear && a.nearR > a.noticeR) e.push(`${who}: Near distance (nearR ${a.nearR}) must not be larger than Notice distance (noticeR ${a.noticeR}).`);
  range('coneCos', -1, 1);
  range('noticeSec', 0.1, 3, ' s');
  const okLose = range('loseR', 1, 200, ' m');
  if (okNotice && okLose && a.loseR < a.noticeR) e.push(`${who}: Lose-target distance (loseR ${a.loseR}) must be at least the Notice distance (noticeR ${a.noticeR}).`);
  range('loseSightSec', 0.5, 60, ' s');
  if (!num(a.leashR)) e.push(`${who}: Leash distance (leashR) must be a number.`);
  else if (a.leashR < 5) e.push(`${who}: Leash distance (leashR) must be at least 5 m, or ${LEASH_NEVER} for "No leash", but is ${a.leashR}.`);
  else if (a.leashR > 500 && a.leashR !== LEASH_NEVER) e.push(`${who}: Leash distance (leashR) must be at most 500 m, or exactly ${LEASH_NEVER} for "No leash", but is ${a.leashR}.`);
  const okWalk = range('walk', 0, WALK_RUN_MAX, ' m/s');
  const okRun = range('run', 0, WALK_RUN_MAX, ' m/s');
  if (okWalk && okRun && a.walk > a.run) e.push(`${who}: Walk speed (walk ${a.walk}) must not be faster than Run speed (run ${a.run}).`);
  const okMin = range('keepMin', 0, 100, ' m');
  const okMax = range('keepMax', 0, 100, ' m');
  if (okMin && okMax && a.keepMin > a.keepMax) e.push(`${who}: Keep-away minimum (keepMin ${a.keepMin}) must not be larger than the maximum (keepMax ${a.keepMax}).`);
  if (range('backOffR', 0, 100, ' m') && okMin && a.backOffR > 0 && a.backOffR > a.keepMin) e.push(`${who}: Back-off distance (backOffR ${a.backOffR}) must not be larger than Keep-away minimum (keepMin ${a.keepMin}).`);
  for (const f of Object.keys(ARCH_ENUMS)) if (!ARCH_ENUMS[f].includes(a[f])) e.push(`${who}: ${LABEL[f]} (${f}) must be one of ${ARCH_ENUMS[f].join(', ')}, but is ${JSON.stringify(a[f])}.`);
  return e;
}

/** Errors of the whole archetype table (each entry + the append-only order). */
export function validateArchetypes(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return ['Archetype table is not an object.'];
  const names = Object.keys(table), e = [];
  ARCH_ORDER.forEach((n, i) => {
    if (!names.includes(n)) e.push(`Archetype "${n}" was removed. The list is append-only (slots store the position), so archetypes can only be added at the end.`);
    else if (names[i] !== n) e.push(`Archetype "${n}" moved to position ${names.indexOf(n) + 1}; it must stay at position ${i + 1}. The list is append-only: add new archetypes at the end.`);
  });
  for (const n of names) e.push(...validateArchetype(table[n], n));
  return e;
}

/** Errors of one attack (a kind's attacks[i]). */
export function validateAttack(at, who, opts = {}) {
  const e = [];
  const minWind = opts.windupMinSec ?? WINDUP_MIN_SEC;
  if (!at || typeof at !== 'object') return [`${who} is not an object.`];
  if (typeof at.id !== 'string' || !at.id) e.push(`${who}: id must be a non-empty text.`);
  if (typeof at.type !== 'string' || !at.type) e.push(`${who}: type must be a non-empty text.`);
  for (const f of ['range', 'windupSec', 'activeSec', 'recoverSec', 'cooldownSec', 'dmgF']) if (!num(at[f]) || at[f] < 0) e.push(`${who}: ${f} must be a number of 0 or more, but is ${JSON.stringify(at[f])}.`);
  if (num(at.windupSec) && at.windupSec < minWind) e.push(`${who}: wind-up (windupSec ${at.windupSec} s) must be at least ${minWind} s so the player can read it.`);
  const big = at.type === 'aoe' || (num(at.dmgF) && at.dmgF >= 2.4);
  if (big && num(at.windupSec) && at.windupSec >= minWind && at.windupSec < BIG_WINDUP_MIN_SEC) e.push(`${who}: a big attack (area attack or damage x2.4 or more) needs a wind-up of at least ${BIG_WINDUP_MIN_SEC} s, but windupSec is ${at.windupSec}.`);
  if (!num(at.weight) || !(at.weight > 0)) e.push(`${who}: weight must be more than 0, but is ${JSON.stringify(at.weight)}.`);
  return e;
}

/** Errors of the kinds table (names, attack lists, archetype references). */
export function validateKinds(kinds, archetypes, opts = {}) {
  if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) return ['Kind table is not an object.'];
  const e = [];
  for (const [k, kind] of Object.entries(kinds)) {
    const who = `Kind "${k}"`;
    if (!kind || typeof kind !== 'object') { e.push(`${who} is not an object.`); continue; }
    if (typeof kind.name !== 'string' || !kind.name) e.push(`${who}: name must be a non-empty text.`);
    if (archetypes && !Object.prototype.hasOwnProperty.call(archetypes, kind.arch)) e.push(`${who}: archetype "${kind.arch}" does not exist.`);
    if (!Array.isArray(kind.attacks)) { e.push(`${who}: attacks must be a list.`); continue; }
    if (kind.attacks.length > MAX_ATTACKS) e.push(`${who}: has ${kind.attacks.length} attacks, the most allowed is ${MAX_ATTACKS}.`);
    kind.attacks.forEach((at, i) => e.push(...validateAttack(at, `${who} attack ${i + 1} ("${at && at.id}")`, opts)));
  }
  return e;
}

export const validateBeasts = (archetypes, kinds, opts) => [...validateArchetypes(archetypes), ...validateKinds(kinds, archetypes, opts)];

// VISQA-25: every beast kind's `model` must be a registered voxel/mesh model (else the beast falls back to the placeholder).
// Kinds with a non-empty `todo` are declared placeholders (model still to be made) and are skipped.
// kinds = parsed kinds.json ({kinds:[..]} or array / object map), modelNames = Set of registered model names.
export function lintBeastModels(kinds, modelNames) {
  const list = Array.isArray(kinds) ? kinds : Array.isArray(kinds && kinds.kinds) ? kinds.kinds : Object.values((kinds && kinds.kinds) || kinds || {});
  const out = [];
  for (const k of list) if (k && k.model && !k.todo && !modelNames.has(k.model)) out.push(`kind "${k.name || k.id}": model "${k.model}" is not a registered model`);
  return out;
}
