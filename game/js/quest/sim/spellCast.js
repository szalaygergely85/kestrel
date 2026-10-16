// SPELL-04: quickbar cast dispatcher. Table `spell.<id>` -> cast fn(player) returning a short result string. Adding a spell = one
// register(spellId, fn) call. Unregistered / unknown ids return 'notImplemented' (nothing happens, no error); tier-0 spells 'locked'.
// Pure sim: 0 allocation per cast.
export function createSpellDispatcher(tierOf) {
  const table = Object.create(null);
  return {
    register(spellId, fn) { table['spell.' + spellId] = { id: spellId, fn }; },
    /** itemId e.g. 'spell.fireball'. -> 'locked' | 'notImplemented' | the cast fn's result ('cast' | 'busy' | ...). */
    cast(itemId, player) {
      const e = table[itemId];
      if (!e) return 'notImplemented';
      if (!(tierOf(e.id) > 0)) return 'locked';
      return e.fn(player);
    },
  };
}
