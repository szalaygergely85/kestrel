// CRAFT-VIEW-01: every player-facing string of the crafting list, in ONE place.
// WRITER: placeholder - all values below are stand-ins (docs/story.md has no crafting copy yet).
// Writer contract: each line <= 38 chars, printable ASCII. Item names come from the item defs (<= 14 chars).
export const CRAFT_TEXT = Object.freeze({
  title: 'Workbench',                          // WRITER: placeholder
  hint: 'W/S pick   Enter make',   // WRITER: placeholder
  empty: 'Nothing to make yet.',               // WRITER: placeholder
  made: 'Made {name}.',                        // WRITER: placeholder ({name} = item name)
  missing: 'Missing something.',               // WRITER: placeholder
  full: 'No room in the pack.',                // WRITER: placeholder
  unknown: 'Cannot make that.',                // WRITER: placeholder
  pickOne: 'Pick what to make.',               // WRITER: placeholder (result line before any craft)
});
