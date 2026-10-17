// QD-03/QD-05 (OB-225): generic "chest opened" -> quest flag `chest.<id>`, so a quest objective {type:'flag', id:'chest.chestCart'} works.
// Pure helpers; main.js binds them (NEEDS B1-main: bindChestFlags(events, questFlag) + seedChestFlags(openedChestIds, questFlag) on boot/load).
export const chestFlagKey = (id) => 'chest.' + id;

/** events.on('chest:opened', {id}) -> questFlag('chest.<id>'). Returns the unsubscribe. */
export function bindChestFlags(events, questFlag) {
  return events.on('chest:opened', (p) => { if (p && typeof p.id === 'string') questFlag(chestFlagKey(p.id)); });
}

/** A chest opened before the quest was accepted (or in an older save) must still complete its step: re-raise the flag for every opened id. */
export function seedChestFlags(openedIds, questFlag) {
  for (const id of openedIds || []) if (typeof id === 'string') questFlag(chestFlagKey(id));
}
