# MESH-PHYS-02 - physics cost pass for the whole fixed step

Tool: `node tools/bench-physics.mjs [--steps N] [--hash]` (Node, real world_m1, `physics: 'mesh'`, 1500 steps/scenario after a
warm-up pass; parts timed exclusively; bracket overhead 0.1 us). Scenarios: tower wake (idle), tower stairs (walking),
road `roadSouth` pose (1466,1035) walking WSW, same pose idle. Entities in the world: 36 (35 playing anims, 0 rollers), 3 colliders.

## Result (us per fixed step, p50 / p95 / mean, whole step incl. beasts, particles, cloths, rollers, animations, triggers)

| scenario | before | after |
|---|---|---|
| tower wake (idle) | 19.0 / 36.9 / 24.1 | 15.2 / 21.2 / 16.7 |
| tower stairs (walking) | 20.3 / 34.6 / 23.3 | 16.8 / 20.5 / 17.5 |
| road walking | 21.7 / 87.8 / 36.3 | 17.3 / 41.0 / 22.9 |
| road idle | 17.6 / 110.2 / 36.2 | 14.2 / 46.6 / 20.7 |

The whole step is 15-20 us p50 = ~0.1% of a 16.7 ms frame. Physics is not a bottleneck; the p95 on the road was a line-of-sight spike (below).

## Top 5 costs (road walking, mean us) and what was done

| # | part | before | after | note |
|---|---|---|---|---|
| 1 | beast step (incl. its LOS + supportAt) | 6.2 (p95 17.9) | 5.0 (p95 12.5) | LOS every 6th step per beast, already gated by loseR 20 m; cheaper LOS samples below |
| 2 | `terrain.groundAt/Normal` (incl. LOS samples) | 11.7 (p95 45.7) | 3.1 (p95 6.3) | CUT: LOS sample `pointBlocked` used `outsideSector` (groundAt + 4 groundAt for the normal + type + material) but only needs the floor -> new `World.outsideFloorH` |
| 3 | `stepAnimations` | 4.4 | 4.3 | 35 playing anims x `clipFor` (2 registry lookups). Not cut (see below) |
| 4 | `particles.step` (zero live particles) | 3.5 | 0.3 | CUT: scanned all 2048 slots every step; now stops after the slots that were live at entry (same slots, same order) |
| 5 | `supportAt` (probeSupport + terrain) | 2.3 | 2.2 | CUT (small): ground normal computed only when terrain wins (`terrainZ >= floorZ`), dead otherwise |

`moveCircleMesh` is 0.1-1.2 us mean (per collider 0.04-0.3 us: tower 1288 t, meshes:static 280 t, props:static 304 t);
`bench-mesh-collide` still 0.51 us/call (<= 1.5).

## Changes (all bit-identical)
- `engine/world/interaction.js` `pointBlocked`: outside structures asks `world.outsideFloorH` first (undefined -> old path).
- `engine/world/World.js`: `outsideFloorH(x, y)` (groundAt, null without terrain = solid, undefined if `outsideSector` is overridden on the instance, e.g. test fixtures); `supportAt` skips `groundNormalAt` when the mesh floor wins.
- `engine/fx/particles.js` `step`: early exit once all entry-live slots are visited.
- `tools/bench-physics.mjs` (new).

## Not cut, and why
- Skip/sleep beasts beyond N m: changes beast state/hash (beasts stop walking home / patrolling) -> behaviour change. The cheap part (LOS only within loseR, every 6th step) already exists.
- Cache ground height per cell / idle supportAt cache: needs a collider-mutation version (sector anims refit dyn colliders) to be provably equal; tower idle supportAt is 2.3 us. Not worth the risk.
- Fewer substeps when idle: the loop is one fixed step per tick already (no substeps).
- Entity iteration (3 passes over 36 entities, Map `for..of` vs `forEach`: 0.3 us per pass) and roller/contact passes (1.2 us each, no rollers): a cached roller list needs every component-mutation path hooked (a test sets `components.roller` directly) -> not provably equivalent; gain ~2 us.
- `stepAnimations` clip memo: stale if a model is hot-replaced in the registry (editor) -> not provably equivalent; gain ~3 us.
- Projectiles: none exist in the engine sim step; particles measured with no emitters (the route has none running in Node).

## Proof of no behaviour change
- `node tools/route-walk.mjs`: grid + mesh leg table, info lines, jump lines identical to the pre-change output (diff empty; only the `sim ms` timing line excluded).
- `bench-physics --hash`: bit-exact player trace (x, y, z, vx per step) per scenario identical before/after (65bb6d85, ab1209bf, e0a81dcd, d4556925).
- `node tools/run-tests.mjs`: 240 PASS, 0 FAIL, 0 WARN. `check-deps` OK. `bench-mesh-collide` 0.51 us.
