# MESH-PHYS-DEFAULT programmer verification — 2026-10-05

Queue 16 item 3a, based on `a325023` (PC-A sync includes this commit). `game/js/main.js` now resolves physics once: explicit `physics=grid` wins, otherwise explicit mesh or the mesh renderer selects mesh. Both boot and the existing R restart reuse these options. Tree and ground-detail loading use the resolved physics mode, with the existing `trees=0` / `detail=0` opt-outs.

The browser route tool omits the physics query unless `--physics` is provided, so its default run tests the application's default. It records initial geometry and rejects a mesh physics default/override mismatch.

## Checks

- Full working-tree runner: **226/226 suites PASS**, zero FAIL/TIMEOUT/WARN, including typecheck and content checks. `check-deps OK` (391 files; existing warnings).
- Isolated browser check on the proposed code, ports 9514/9515: five boot + real R-restart cases PASS (`index.html` without a query, `?renderer=mesh`, `?physics=mesh`, `?physics=grid`, `?trees=0&detail=0`), no browser exceptions or fatal card. Restart replaces the world and old instance groups while preserving selected physics and geometry.
- Plain URL: mesh physics; 485 trees, 17,014 ground-detail placements, 25 instance groups; colliders `tower`, `scatter:trunks`, `scatter:detail`. Three mesh boot cases stop a player-radius capsule at a real trunk using `World.collideCircle`, the solver called by mesh player integration (final distance 0.708902 m, minimum 0.69 m).
- Grid override: grid physics, no tree/detail placements, colliders or instance groups, retained after restart. Both geometry opt-outs: mesh physics and tower collider, zero tree/detail placements or instance groups, retained after restart.
- `node tools/route-walk-browser.mjs --port 9510`: gl2 mesh at 400×150, **no physics query parameter**. All ten legs complete, no falls; upper stair open, lever absent, end trigger reached. 1819 sampled frames. Initial tree/detail counts and both scatter colliders agree with plain URL boot.

Files changed: `game/js/main.js`, `tools/route-walk-browser.mjs`, the story row/handoff and this report. Engine runtime, render twins and content are unchanged. The existing Node route explicitly compares grid and mesh physics and keeps those intentional modes. No spec deviations.

Status: **NEEDS PC-A: PO review / owner plain-URL walk-test**. Next: queue 3b **PROP-COLLIDE-01a + 01b**, architecture 37.10. Existing unrelated Ruins/sword/render edits are preserved and excluded from the commit.
