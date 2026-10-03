# 36.2b burner fire placement - 2026-10-03

Status: NEEDS PC-A: PO review / owner look.

Tower content adds the designer's burnerFire body at local (18.5, 6.5, 1.05), with no collision. The existing runtime animation selector is `variant: "burn"`; a literal `anim` property is not consumed by World.load. The resulting sprite component selects burn, loops, and resolves all eight frames. Brazier particles are embers at offset.up 1.0 and smoke at 1.5; its torch light remains unchanged.

Checks: particleHooks 25/25; full runner 200/200 suites PASS, no FAIL/TIMEOUT/WARN; check-deps OK (364 files, existing warnings only). Tests load the actual tower/world, verify resolved fire placement/model/animation and emitter offsets, and exercise emitter spawning.

Browser: headless real GPU (gl2, ANGLE RTX 4060 D3D11), game/index.html?renderer=mesh&grid=160x60&pose=brazier. Used tools/capture-browser.mjs CDP helpers with python tools/serve.py on own port 9580. Screenshot visually inspected: broad yellow/orange core and licking tongues appear above the burner, consistent with the designer's 0.7 x 1.0 m body; paused UI partly crosses its middle. Runtime entity is at world (1498.5, 1024.5, 1.05), model burnerFire, animation burn. This proves mesh sprite visibility; owner appearance approval remains for PC-A. Own browser/server stopped and temporary shot removed.

No main.js, engine, design or runtime library changes. AGENTS.md's existing per-task commit/push instruction is clarified per the owner's explicit request.
