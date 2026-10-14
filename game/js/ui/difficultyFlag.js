// BEAST-WIRE-01: the Settings "Difficulty" switch (D-083/D-087). Live module state like combatHudFlags.js: main.js sets the saved
// name at boot and registers the applier (beastDirectorWire) once a world is up; changing is refused while a fight is on.
const NAMES = ['easy', 'normal', 'hard'];
export const DIFFICULTY_REFUSED = "Can't change during a fight";
let name = 'normal', applier = null;
export function difficultyName() { return name; }
/** Boot / world load: set the remembered name without applying (the wire applies `difficultyName()` at creation). */
export function setDifficultyName(v) { name = NAMES.includes(v) ? v : 'normal'; }
/** The wire registers `(name) => bool` (applyDifficulty); null on world dispose. */
export function setDifficultyApplier(fn) { applier = fn; }
/** Settings row: apply now. False = refused (fight on), name unchanged. No applier yet (title screen) = just remember. */
export function requestDifficulty(v) {
  if (!NAMES.includes(v)) return false;
  if (applier && !applier(v)) return false;
  name = v; return true;
}
