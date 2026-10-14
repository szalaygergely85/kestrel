// game/js/quest/sim/archetypes.js (BEAST-03a, architecture.md 38.64 (1), epic ep-bestiary.md table 2). Frozen data, read once
// at createBeastSim. No behaviour yet: BEAST-03b makes the per-archetype layers read these. Metres, m/s, SECONDS (never
// steps; toSteps() converts at create). Rule 15: no Math.random, no trig, no clock.
// aggro: 'hostile' = notices and attacks on sight; 'whenHit' = only after being hit; 'near' = only inside nearR; 'never'.
// role: the combat posture the layer uses. medium: where the body moves. when: 'any' | 'day' | 'night'.

const A = (o) => Object.freeze(o);

export const ARCHETYPES = Object.freeze({
  grazer: A({ noticeR: 10, nearR: 3, coneCos: 0.5, noticeSec: 0.6, aggro: 'whenHit', loseR: 25, loseSightSec: 4, leashR: 25, walk: 1.5, run: 4.5, role: 'melee', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'land', when: 'any' }),
  skittish: A({ noticeR: 18, nearR: 6, coneCos: 0.5, noticeSec: 0.3, aggro: 'never', loseR: 40, loseSightSec: 4, leashR: 1e9, walk: 1.6, run: 7, role: 'melee', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'land', when: 'any' }),
  packHunter: A({ noticeR: 20, nearR: 5, coneCos: 0.5, noticeSec: 0.6, aggro: 'hostile', loseR: 60, loseSightSec: 8, leashR: 60, walk: 1.95, run: 5.85, role: 'melee', keepMin: 4, keepMax: 6, backOffR: 0, medium: 'land', when: 'any' }),
  ambusher: A({ noticeR: 8, nearR: 3, coneCos: -1, noticeSec: 0.3, aggro: 'near', loseR: 30, loseSightSec: 5, leashR: 30, walk: 1.5, run: 6, role: 'ambush', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'land', when: 'any' }),
  waterAmbusher: A({ noticeR: 12, nearR: 4, coneCos: 0.5, noticeSec: 0.4, aggro: 'hostile', loseR: 20, loseSightSec: 6, leashR: 40, walk: 1.2, run: 4, role: 'water', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'water', when: 'any' }),
  swimmer: A({ noticeR: 12, nearR: 4, coneCos: 0.5, noticeSec: 0.5, aggro: 'hostile', loseR: 20, loseSightSec: 6, leashR: 40, walk: 1.0, run: 3, role: 'water', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'water', when: 'any' }),
  tank: A({ noticeR: 14, nearR: 4, coneCos: 0.5, noticeSec: 0.8, aggro: 'hostile', loseR: 40, loseSightSec: 6, leashR: 40, walk: 1.0, run: 4, role: 'tank', keepMin: 0, keepMax: 0, backOffR: 0, medium: 'land', when: 'any' }),
  ranged: A({ noticeR: 22, nearR: 5, coneCos: 0.5, noticeSec: 0.6, aggro: 'hostile', loseR: 50, loseSightSec: 8, leashR: 50, walk: 1.6, run: 4.5, role: 'ranged', keepMin: 10, keepMax: 14, backOffR: 6, medium: 'land', when: 'any' }),
  flyer: A({ noticeR: 25, nearR: 6, coneCos: 0.0, noticeSec: 0.5, aggro: 'hostile', loseR: 70, loseSightSec: 10, leashR: 70, walk: 3, run: 8, role: 'flyer', keepMin: 8, keepMax: 15, backOffR: 0, medium: 'air', when: 'any' }),
  swarm: A({ noticeR: 10, nearR: 4, coneCos: 0.0, noticeSec: 0.4, aggro: 'hostile', loseR: 30, loseSightSec: 5, leashR: 30, walk: 2, run: 6, role: 'swarm', keepMin: 1, keepMax: 3, backOffR: 0, medium: 'land', when: 'any' }),
  caster: A({ noticeR: 18, nearR: 5, coneCos: 0.5, noticeSec: 0.6, aggro: 'hostile', loseR: 45, loseSightSec: 8, leashR: 45, walk: 1.6, run: 4, role: 'caster', keepMin: 12, keepMax: 18, backOffR: 8, medium: 'land', when: 'any' }),
});

/** Stable order = the archIdx stored per slot (Uint8). Append only; never reorder. */
export const ARCH_NAMES = Object.freeze(Object.keys(ARCHETYPES));
export const archIndex = (name) => ARCH_NAMES.indexOf(name);

export const ARCH_AGGRO = Object.freeze(['hostile', 'whenHit', 'never', 'near']);
export const ARCH_ROLES = Object.freeze(['melee', 'ranged', 'caster', 'swarm', 'flyer', 'water', 'ambush', 'tank']);
export const ARCH_MEDIA = Object.freeze(['land', 'water', 'air']);
export const ARCH_WHEN = Object.freeze(['any', 'day', 'night']);
