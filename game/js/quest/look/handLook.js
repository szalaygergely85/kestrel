// CHARGEN-16: player look -> first-person hand. Pure: retintHand(handDef, recipe, kit, models) builds `<model>@look`
// copies of every hand variant model with the skin keys of the chosen tone (kit.handTint) and the sleeve linen of the top dye.
// Fire keys / leather / rope are untouched. Inputs are never mutated; layers are shared (read-only).
export const LOOK_SUFFIX = '@look';
export const SKIN_KEYS = ['skin', 'skin_light', 'skin_shade', 'skin_deep', 'skin_flush', 'skin_nail', 'skin_vein', 'skin_glow'];
const LINEN = { linen: 'base', linen_dark: 'dark', linen_light: 'light' };

/** Material-key remap {oldKey: newKey} for a recipe (only keys that change). */
export function lookRemap(recipe, kit) {
  const map = {};
  const tone = kit.handTint && kit.handTint[recipe.skin];
  if (!tone) throw new Error(`handLook: no handTint for skin "${recipe.skin}"`);
  for (const k of SKIN_KEYS) { if (tone[k] === undefined) throw new Error(`handLook: handTint.${recipe.skin} lacks ${k}`); if (tone[k] !== k) map[k] = tone[k]; }
  const top = recipe.top && kit.ramps && kit.ramps.top && kit.ramps.top[recipe.top.ramp];
  if (recipe.top && !top) throw new Error(`handLook: unknown top ramp "${recipe.top.ramp}"`);
  if (top) for (const [from, shade] of Object.entries(LINEN)) if (top[shade] !== from) map[from] = top[shade];
  return map;
}

/**
 * @param handDef  ASSETS.viewModels.hand (variants: variantKey -> model name; model: static fallback model name)
 * @param models   ASSETS.voxelModels (name -> record with voxel.mats)
 * @returns {{def:object, models:Object<string,object>}} def' (variants renamed `<name>@look`) + the new records by name
 */
export function retintHand(handDef, recipe, kit, models) {
  const map = lookRemap(recipe, kit);
  const out = {}, names = {};
  const retint = (name) => {
    if (names[name]) return names[name];
    const rec = models[name];
    if (!rec || !rec.voxel || !rec.voxel.mats) throw new Error(`handLook: model ${name} missing`);
    const mats = {};
    for (const ch of Object.keys(rec.voxel.mats)) { const k = rec.voxel.mats[ch]; mats[ch] = map[k] !== undefined ? map[k] : k; }
    const nn = name + LOOK_SUFFIX;
    out[nn] = { ...rec, name: nn, voxel: { ...rec.voxel, mats } };
    return (names[name] = nn);
  };
  const variants = {};
  for (const k of Object.keys(handDef.variants)) variants[k] = retint(handDef.variants[k]);
  const def = { ...handDef, variants, model: retint(handDef.model) };
  return { def, models: out };
}

/** Recipe to use: the saved look, else the kit default. */
export const lookOrDefault = (kit, look) => look || kit.defaults;
