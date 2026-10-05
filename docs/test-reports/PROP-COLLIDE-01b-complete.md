# PROP-COLLIDE-01b completion - 2026-10-05

Status: **NEEDS PC-A: PO review / owner walk-test**. PC-A approved the eastern route in 124b0e3; the gondola remains solid.

Tower dressing now has per-piece colliders: five awakeningCrates boxes and six awakeningKeeper boxes, a posed occupied-voxel gondola box, and the designer's r 0.22 m / h 1.60 m practice-post prism. Low clutter <=0.12 m, papers and bedroll remain excluded. All four existing voxel geometry/material/pose SHA-256 values are unchanged. PC-A's newer wall lamps and four note props, their lights and placements remain intact; no old floor lamps were restored. The unused spare floorLantern model still has its default r 0.12 m / h 0.40 m prism matching its actual sprite dimensions, with synthetic-placement tests.

The Node and browser route tools use the approved eastern wake -> burner -> stair corridor, retaining the boulder until the separate TOWER-BOULDER-01 item. The exact collider-order fixture gains props:static. Only the old grid-vs-mesh structural parity fixture explicitly opts out through colliders: []; shipping mesh performance, determinism and allocation cases keep real solid props and retain their thresholds.

Files: content/levels/tower.level.json; design/models/m3_props.js and lantern.js; engine/physics/worldWalk.perf.test.js; engine/world/colliders.test.js; tools/tower-prop-colliders.test.mjs, route-walk.mjs and route-walk-browser.mjs.

## Checks

- Full **224/224 suites PASS**, zero FAIL/TIMEOUT/WARN, including typecheck and content validation. Explicit check-deps OK: 396 files, 1,304 advisory warnings.
- Focused content **1,112 PASS**; prop 240, detail 31, collider 32, GC world-walk 14, smoke 30, canonical 7, content validation 671 PASS. Production props:static has 176 triangles; 40 eight-direction contact cases include the synthetic spare lamp. Save/load BVH bytes and explicit [] opt-out verified.
- **1,019 clearance samples** at >=1 m new-prop clearance; real mesh capsule reaches all seven corridor waypoints in **187 steps**.
- Pure Node route: 9/9 legs complete, no falls/stuck waypoints. Real-GPU browser on port 9520 at 400x150: **10/10 legs complete, no falls/stuck waypoints, end trigger reached**, 1,922 sampled frames. Former boulder/stair failures are resolved.
- Owner-visible screenshot: **visible: yes** — from the normal wake-standing position at 400x150, the crate stack, brass water butt and adjoining dressing have distinct lit faces against dark stone. Source art, size and placements are unchanged; collision needs the owner's walk-test. Screenshot inspected at .codex/finish-uncommitted/props-look.png. Only owned probe processes stopped; owner's port 8000 untouched.

The floorLantern 0.40 m dimensions follow the actual sprite rather than the spec's illustrative 0.42 m. Updated production tests reflect PC-A's replacement of floor lamps with wall lanterns. These are documented content/spec adaptations; no thresholds, runtime libraries or renderer expressions changed. The prior route-blocker report is retained as history and superseded by this successful check. Old Ruins work is isolated for its own GPU gate.
