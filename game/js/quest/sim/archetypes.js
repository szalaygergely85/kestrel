// game/js/quest/sim/archetypes.js (BEAST-03a, architecture.md 38.64 (1), epic ep-bestiary.md table 2). Frozen data, read once
// at createBeastSim. No behaviour yet: BEAST-03b makes the per-archetype layers read these. Metres, m/s, SECONDS (never
// steps; toSteps() converts at create). Rule 15: no Math.random, no trig, no clock.
// aggro: 'hostile' = notices and attacks on sight; 'whenHit' = only after being hit; 'near' = only inside nearR; 'never'.
// role: the combat posture the layer uses. medium: where the body moves. when: 'any' | 'day' | 'night'.

// ED-AI-01: the numbers live in content/beasts/archetypes.json (edited by tools/editor/ai/model.js); same table as before.
import archetypeData from '../../../../content/beasts/archetypes.json' with { type: 'json' };

const A = (o) => Object.freeze({ ...o });

export const ARCHETYPES = Object.freeze(Object.fromEntries(Object.keys(archetypeData).map((k) => [k, A(archetypeData[k])])));

/** Stable order = the archIdx stored per slot (Uint8). Append only; never reorder. */
export const ARCH_NAMES = Object.freeze(Object.keys(ARCHETYPES));
export const archIndex = (name) => ARCH_NAMES.indexOf(name);

export const ARCH_AGGRO = Object.freeze(['hostile', 'whenHit', 'never', 'near']);
export const ARCH_ROLES = Object.freeze(['melee', 'ranged', 'caster', 'swarm', 'flyer', 'water', 'ambush', 'tank']);
export const ARCH_MEDIA = Object.freeze(['land', 'water', 'air']);
export const ARCH_WHEN = Object.freeze(['any', 'day', 'night']);
