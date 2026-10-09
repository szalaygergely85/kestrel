// engine/chargen/index.js (CHARGEN-02, docs/architecture.md 38.29 item 4): the character generator core.
export { validateKit, SLOTS, SHELL_ORDER, ATTACH_ORDER, STRETCH_BONES, MAX_MATERIALS } from './kit.js';
export { validateRecipe, HEIGHT_MIN, HEIGHT_MAX, AGES } from './recipe.js';
export { composeCharacter } from './compose.js';
