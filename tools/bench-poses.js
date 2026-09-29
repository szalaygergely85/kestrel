// US-048 (docs/backlog.md, PC-B QUEUE 4 item 2): the pose data itself moved
// to content/dev-poses.js (a plain data module outside engine/game/tools, so
// neither side crosses a `game -> tools`/`tools -> game` boundary importing
// it). This file re-exports it so every existing importer of
// tools/bench-poses.js (tools/bench-cast.mjs, game/js/dev/spritesPage.js)
// keeps working unchanged - only game/js/main.js's own import moved, to
// game/js/dev/modes/* importing content/dev-poses.js directly.
export { POSES, GATE_POSES, EYE_H } from '../content/dev-poses.js';
