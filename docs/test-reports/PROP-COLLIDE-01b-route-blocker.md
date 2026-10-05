# PROP-COLLIDE-01b route blocker - 2026-10-05

Status: **NEEDS PC-A: route/collider placement decision**. This commit contains findings and the backlog question only. The implementation remains local/unpublished because architecture.md 37.10 requires green route legs.

The prepared implementation adds five awakeningCrates boxes and six awakeningKeeper boxes from each emitted voxel piece taller than 0.12 m. Bedroll, papers and low clutter stay excluded. Floor lanterns use a model-default prism matching the actual sprite record (r 0.12 m, h 0.40 m, centre z 0.20 m, rather than the spec's illustrative 0.42 m). The practice post prism follows the designer's r 0.22 m/h 1.60 m note. Gondola collision is a conservative box of occupied voxel corners after its fixed idle 8-degree tilt, including the chock. Four voxel geometry/material/pose hashes remain unchanged; no asset or placement redesign occurred.

Local files: design/models/m3_props.js, design/models/lantern.js (actual floorLantern registration), content/levels/tower.level.json, new tools/tower-prop-colliders.test.mjs, plus two minimal existing test fixture updates described below. Engine runtime is unchanged. The clean implementation patch is retained at .codex/next-pair/props-unpublished.patch for resumption; main working files also retain it.

## Evidence

- Focused content **1,121 checks PASS**: one 240-triangle props:static BVH, exact piece bounds, independent posed gondola oracle, model hashes, 48 real-placement/eight-side contacts, model-default lamp/explicit [] opt-out, save/load BVH byte parity. Low sacks retain normal step-up behavior.
- The authored eastern wake -> burner -> stair centre line passes **1,019 one-centimetre samples** at >=1.0 m new-prop clearance; a real mesh capsule reaches all seven waypoints in **187 steps**.
- Existing prop 240/detail 31, smoke 30/canonical 9/content validation 645 checks PASS. Full local implementation: **225/225 working and 224/224 isolated suites PASS**, zero FAIL/TIMEOUT/WARN, including typecheck. Explicit deps OK: 396 working files/1,305 advisory warnings, 395 isolated/1,303.
- Adding solid props exposed two stale fixture assumptions. colliders.test.js now expects props:static after level/mesh placements (preserving the local Ruins edits). Only worldWalk.perf.test.js's structural grid-vs-mesh fixture opts out via authored colliders: []; shipping mesh performance/determinism/allocation cases still exercise solid props. Its unchanged 1 cm threshold passes with reported max error 0.000000 m across 443 compared steps; 3,600-step mesh replay is bit-equal. These test edits remain unpublished with the content.
- **Both real browser runs fail leg 2**, after 900 frames, at tower-local (15.500000000004093, 9.2974999999999, 0). The old script exits wake west to (15.5,9.5), then seeks (15.5,5.5) directly through the gondola. Posed AABB: x [14.988091,15.984970], y [6.9575,8.9975], z [0,1.116541]. Stop y = 8.9975 + player capsule radius 0.30 m: collision is expected, not a precision issue.
- Leg 3 subsequently stops at (16.5,5.3,0), approaching the tall stair cheek from the wrong side after leg 2 failed; treat that as a likely cascade. Working run completes only 2/10 legs and has no end trigger. Isolated run has 8/10 completed flags and an end trigger, but legs 2/3 fail and later legs report falls. That is **not** a green route. The harness exits zero even when a leg fails, so its JSON flags, not process status alone, determine this finding.
- Ports 9630/9640 used the no-cache server; each harness stopped only its own server/browser. No DDA checks, renderer changes or threshold widening.

## PC-A decision needed

May PC-B update the old scripted route through the verified eastern wake -> burner -> stair corridor while retaining the mechanically derived solid gondola, or should PC-A supply a designer-approved alternate collider/placement? No route, placement or collider reduction has been guessed. Owner walk-test/PO review remain required after the route gate passes.

US-078d was separately committed/pushed as 7f1e378. Unrelated local Ruins/render/content work remains preserved.
