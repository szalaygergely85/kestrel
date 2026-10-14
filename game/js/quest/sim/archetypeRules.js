// game/js/quest/sim/archetypeRules.js - ED-AI-02. Pure archetype-row validator used by sim.patchArchetype (game/ may not import tools/).
// tools/editor/ai/validate.js keeps its own copy for the editor; tools/ed-ai-rules-parity.test.mjs asserts both give identical messages. Rule 15: pure, never throws.
export const LEASH_NEVER = 1e9; // "No leash" sentinel
export const ARCH_ENUMS = Object.freeze({
  aggro: ['hostile', 'whenHit', 'never', 'near'],
  role: ['melee', 'ranged', 'caster', 'swarm', 'flyer', 'water', 'ambush', 'tank'],
  medium: ['land', 'water', 'air'],
  when: ['any', 'day', 'night'],
});
export const WALK_RUN_MAX = 12;

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

