// game/js/quest/gearLook.js (EQ-05, docs/architecture.md 38.40 item 6): pure. gearRecipe(look, equipment, itemDefs) -> chargen recipe.
// Each equipped item's `equip.shell` id overrides the look's pick for its kit slot ({id: shell, ramp: paint});
// an empty slot keeps the look's own pick (the underclothes), so no equipment returns the look unchanged.
// equipment: {itemSlot: itemId|null}; itemDefs: {itemId: {equip:{slot, shell?, paint?}}}.

/** Item equip slot -> recipe (kit) slot. Slots missing here (weapons, quiver, rings...) never change the body look. */
export const GEAR_KIT_SLOT = Object.freeze({ head: 'hat', body: 'top', cloak: 'cloak', hands: 'hands', belt: 'belt', legs: 'legs', feet: 'feet' });

export function gearRecipe(look, equipment, itemDefs) {
  const out = { ...look };
  if (!equipment) return out;
  for (const itemSlot of Object.keys(GEAR_KIT_SLOT)) {
    const id = equipment[itemSlot];
    const eq = id && itemDefs && itemDefs[id] && itemDefs[id].equip;
    if (!eq || !eq.shell) continue;
    const kitSlot = GEAR_KIT_SLOT[itemSlot];
    const prev = look[kitSlot];
    out[kitSlot] = { id: eq.shell, ramp: eq.paint || (prev && prev.ramp) || 'undyed' };
  }
  return out;
}
