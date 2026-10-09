// engine/chargen/recipe.js (CHARGEN-02): validateRecipe against a kit (docs/architecture.md 38.29 item 4).
import { SLOTS, dyeGroupOf } from './kit.js';

export const HEIGHT_MIN = -4;
export const HEIGHT_MAX = 4;
export const AGES = ['young', 'adult', 'elder'];

/** Items of a slot the kit offers (shells or attachments). */
export function slotItems(kit, slot) {
  return [...(kit.shells || []), ...(kit.attachments || [])].filter((i) => i.slot === slot);
}

/** @returns {{errors:string[]}} */
export function validateRecipe(kit, recipe) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!recipe || typeof recipe !== 'object') return { errors: ['recipe: not an object'] };
  if (recipe.v !== 1) err(`v: must be 1, got ${recipe.v}`);
  if (recipe.kit !== kit.id) err(`kit: recipe is for "${recipe.kit}", this kit is "${kit.id}"`);
  if (!kit.bases || !kit.bases[recipe.base]) err(`base: unknown "${recipe.base}"`);
  if (!Number.isInteger(recipe.height) || recipe.height < HEIGHT_MIN || recipe.height > HEIGHT_MAX) err(`height: int ${HEIGHT_MIN}..${HEIGHT_MAX} expected, got ${recipe.height}`);
  if (!AGES.includes(recipe.age)) err(`age: one of ${AGES.join('/')} expected, got ${recipe.age}`);
  const ramps = kit.ramps || {};
  if (!ramps.skin || !ramps.skin[recipe.skin]) err(`skin: unknown ramp "${recipe.skin}"`);
  if (!ramps.eyes || !ramps.eyes[recipe.eyes]) err(`eyes: unknown ramp "${recipe.eyes}"`);
  for (const slot of SLOTS) {
    const p = recipe[slot];
    if (p == null) continue;
    if (typeof p !== 'object' || typeof p.id !== 'string' || typeof p.ramp !== 'string') { err(`${slot}: pick must be {id, ramp} or null`); continue; }
    if (!slotItems(kit, slot).some((i) => i.id === p.id)) err(`${slot}: unknown item "${p.id}"`);
    const g = dyeGroupOf(slot);
    if (!ramps[g] || !ramps[g][p.ramp]) err(`${slot}: unknown ${g} ramp "${p.ramp}"`);
  }
  return { errors };
}

export const ELDER_TEMPO = 1.15;
/** Height rows actually applied: elder is one row shorter (clamped to the range). */
export const effectiveHeight = (recipe) => (recipe.age === 'elder' ? Math.max(HEIGHT_MIN, recipe.height - 1) : recipe.height);
/** Clip speed factor: elder x1.15. */
export const ageTempo = (recipe) => (recipe.age === 'elder' ? ELDER_TEMPO : 1);
