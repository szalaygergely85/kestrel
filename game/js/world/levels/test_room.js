// Forwarding shim (US-024 Phase A): test_room moved to
// design/levels/test_room.js (a classic script + module.exports, like
// design/palette.js) as part of the engine/game split (D-006). This path is
// kept only so game/js/physics/*.test.js, physicsTestMain.js and
// worldTestMain.js (still un-moved until US-024 Phase C, which owns
// physics/entities) keep working unchanged. Do not add new imports of this
// path - import 'design/levels/test_room.js' directly instead.
//
// Two environments, two routes to the same object (design/levels/test_room.js
// itself has no ESM export - it is a classic script, like palette.js):
//  - Browser (world-test.html, physics-test.html): those pages load
//    design/levels/test_room.js as a classic <script> before their module
//    script, exactly like game/index.html does for palette.js, so it is
//    already sitting on window.ASSETS.levels.test_room by the time this
//    module runs.
//  - Node (physics.test.js, jump.test.js, eyeFeel.test.js, physicsTestMain.js
//    is browser-only): no `window`, so dynamic-`import()` the file directly -
//    Node's CJS interop (no package.json "type": "module") returns its
//    `module.exports` as the default export, same trick tools/bench-cast.mjs
//    uses for palette.js.
let testRoom;
if (typeof window !== 'undefined' && window.ASSETS && window.ASSETS.levels && window.ASSETS.levels.test_room) {
  testRoom = window.ASSETS.levels.test_room;
} else {
  const mod = await import('../../../../design/levels/test_room.js');
  testRoom = mod.default;
}
export default testRoom;
