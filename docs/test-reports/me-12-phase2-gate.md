# ME-12 phase-2 gate report (DRAFT, headless part)

Date 2026-10-01, branch pc-a, HEAD ae57a2f + working tree (other agents' uncommitted `engine/render/*` edits were present during the browser runs). Headless Chrome, `--use-angle=d3d11` (owner GPU), via `tools/capture-browser.mjs` / `tools/route-walk-browser.mjs`. Port 9230 (own server + own browser, both killed by the tool).

Tools written for this gate (kept minimal, reusable):
- `tools/route-walk.mjs` (Node twin, no browser): the M1 route on the real `world_m1`, `physics: grid` vs `mesh`, per-leg result, jump probe, mid-route save round trip, sim ms per step. Physics is renderer-independent JS, so the result holds for `?renderer=dda|mesh`.
- `tools/route-walk-browser.mjs` (headless Chrome): loads `game/index.html?voxelbench=0&grid=WxH&renderer=R&physics=P` (a truthy `voxelbench`/`bench` param = `isCaptureOrBench` = no pause overlay, so no pointer lock is needed; `=0` does not start the voxel bench), presses F3 (GPU pass timing), and walks the whole route by writing the game's own `Input` (W/Shift/Space/E) and `look.yawDeg`. Samples `loop.stats` (sim/js/interval) and `gpuPipeline.stats` per frame. Real wake timeline, real `E` on the lever.
- Run: `node tools/route-walk.mjs`; `node tools/route-walk-browser.mjs --port 9230 --grid 400x150 --renderer mesh --physics mesh --out x.json`.

## Gate table

| # | Criterion | Target | grid physics | mesh physics | Result | Note |
|---|---|---|---|---|---|---|
| 1a | Leg 1 wake -> out of the pallet | no stuck/fall | ok, ends (15.85, 9.50, 0) | identical | PASS | Node + browser (real wake timeline 4-8 s) |
| 1b | Leg 2 stairs base + boulder push | no stuck/fall | ok | identical | PASS | |
| 1c | Leg 3 stairs to step 9 | no stuck/fall | ok, end (20.50, 7.17, 2.70) | identical (0.000 trace diff) | PASS | step-up on every stair edge, no snag |
| 1d | Leg 4 gap jump to the mid ledge | no stuck/fall | ok, lands (19.57, 9.89, 3.00) | identical | PASS | |
| 1e | Leg 5 lever / grate (open) -> upper steps | passes the open grate | ok, end (12.85, 7.54, 5.70) | ok, same end | PASS | lever pulled by real `E` (browser) / real `lever.pull` (Node); grate clearance 0 -> 2.4 |
| 1f | Leg 5 grate **closed** | blocks | blocks at x = 19.30 | blocks at x = 19.30, 608 steps, grid == mesh (maxDiff 0.000) | **PASS (BUG-ME12-1 fixed)** | architecture.md 27.18b barrier quads in `engine/world/colliders.js` (`dynBarrierQuads`); `levelMesh.js` untouched; `tower:grate` = 10 + 2 x 3 barrier edges = 16 tris at every anim point |
| 1g | Leg 6 doorway + summit walkway | no stuck/fall | ok (7.54, 7.85, 6.00) | identical | PASS | no snag at the doorway (11,7) |
| 1h | Leg 7a breach + outcrop | no stuck/fall | ok (5.84, 7.51, 6.00) | identical | PASS | |
| 1i | Leg 7b hillside -> waystone | reaches `end` trigger | ok, trigger fires (browser: `quest.endT >= 0`) | identical | PASS | terrain slope walk + 2 detours (US-026a slide) same on both; end at (-51.7, 21.9) local |
| 2 | Parity (step-up, doorway, jump arc, landing, slopes) | within 0.05 cells | reference | max trace diff 0.000 on every leg where both start equal; jump peak 1.0028 and landing z 0.000 both (stand + run); 600-step tower parity (worldWalk.perf) maxErr 0.000000 m | PASS | lintel-blocks-head: the tower has no walk-under lintel except the grate (see 1f); no other lintel content to test |
| 3a | Boulder rolls / stops same cell +-0.25 | same cell | rests (1494.32, 1022.40, -0.30) sleeping | identical (z only float32 noise 3e-8) | PASS | |
| 3b | Grate blocks closed / opens on lever / pass open | all three | blocks / opens / passes | blocks (19.30 east, 17.70 west, +-0.05 of grid), opens, passes; mid-anim t=0..1 equals `isSectorPassable` at footZ = floorH | **PASS** | = 1f; `colliders.test.js` 32/32 (incl. 1000 refits 0 heap growth, no sentinel warn); run-tests 154 PASS + 1 pre-existing typecheck WARN; silhouette 490/0; gpucompare dda 34/34 and renderer=mesh 44/44 (`2026-10-01-a1edee0-gpucompare-*.json`) |
| 4 | Save round trip mid-route (grate open, boulder moved) | probes bit-equal, walk continues | n/a | `serialize`/`deserialize` on `world_m1` after the grate leg: boulder bit-equal, grate clearance equal, collider ids equal, 200 seeded `collideCircle` + `supportAt` probes 0 mismatches; the rest of the route from the reloaded world gives bit-equal end positions to the uninterrupted run | PASS | `engine/world/colliders.test.js` section 5 already covers this mid-animation (t = 0.37); route-walk adds the mid-route variant |
| 5 | Replay determinism | bit-equal | n/a | `worldWalk.perf.test.js` (ME-11c): mesh 3600-step walk twice `firstDivergeAt = -1`; grid vs mesh 600-step maxErr 0.000000 m; test green in run-tests | PASS | the 600-step replay in `engine/core/replay.test.js` is the command-queue replay and has no mesh variant (not needed: the physics walk test is the ME-11c determinism check) |
| 6a | Sim p95 <= 1 ms, walk, 400x150 | <= 1 ms | 0.4 ms (mesh renderer), 0.4 (dda) | 0.5 ms (p50 0.2, timer resolution 0.1) | PASS | browser `loop.stats.simMs`, full route ~2050 frames |
| 6b | Sim p95 at 240x90 | <= 1 ms | 0.4 / 0.4 | 0.5 | PASS | |
| 6c | No per-frame allocation in collide path | none | - | `node --expose-gc engine/physics/worldWalk.perf.test.js`: 13 passed (5000-step heap growth gate in mesh mode green); Node sim per step p95 0.048 ms (grid 0.034) | PASS | single-step spikes up to 9.6 ms (mesh) vs 6.3-6.6 (grid/dda) in the browser: one-off JIT/GC in all three configs, not mesh-specific |
| 7a | GPU p95, 400x150 | <= 2.62 ms | 2.66 / 2.66 / 2.71 (mesh renderer, grid physics, 3 runs) | **2.656** median (2.66, 2.65, 2.66) | **PASS (re-based)** | **Architect 2026-10-01: bar re-based.** The 2.62 bar came from the phase-1 bench walk, a different route; on this route walk mesh 400x150 GPU p95 = 2.656 (3-run median) beats dda 3.44 by 23 %, and physics mode does not move it. New AC 7a bar for the route walk (ME-13+ regressions): mesh p95 <= 2.75 ms (2.656 + 0.1 noise) and <= dda on the same walk. Fix round 2026-10-01, clean tree (no render WIP). Physics mode does not affect GPU time (mesh vs grid physics identical within 0.05). Phase-1 bench walk vs this longer route differ; recommend the architect accept 2.66 as the bar for the route walk or re-base the bar |
| 7b | GPU p95, 240x90 | <= 1.44 | 1.23 / 1.55 (dda) | 1.30 (1.30, 1.29, 1.32; 3 runs) | PASS | |
| 7c | JS p95 <= 8 ms | <= 8 | 4.7 / 2.7 | 6.4 (400x150), 3.0 (240x90) | PASS | jsMax 17.3 ms at 400x150 mesh (14.7 on mesh+grid): one frame |
| 7d | over25 == 0 on the walk | 0 | 0 / 0 (mesh renderer); dda: 1 (one 617 ms stall at the start of the route, every dda run, not in mesh runs) | 0 / 0, worst interval 17.6 / 19.7 ms | PASS | dda stall is outside this gate |
| 8a | `node tools/run-tests.mjs` | green | - | 155 suites: 154 PASS, 0 FAIL, 1 WARN (typecheck, 4 TS errors in `engine/mesh/instances.js` / `voxelMesh.js` = RE-15a/b, ME-22 work in progress, not ME-12) | PASS (WARN) | |
| 8b | `node tools/check-deps.mjs` | OK | - | OK (293 files, 1034 warnings, all coordinate-math WARN) | PASS | |
| 8c | `?gpucompare=1` dda renderer | all PASS | 34/34 | - | PASS | `docs/test-reports/captures/2026-10-01-ae57a2f-gpucompare-grid.json` (incl. forestEdge) |
| 8d | `?gpucompare=1&renderer=mesh` (160x60) | all PASS | - | 44/44 | PASS | `2026-10-01-ae57a2f-gpucompare-160x60.json` (the mesh list has 44 rows) |
| 9 | Fixes in this story | | | none made (see BUG candidates) | - | |
| 10 | Architect verdict | | | ready for owner walk-test | **PASS (architect 2026-10-01)** | see "Architect verdict (2026-10-01)" below |
| 11 | Owner walk-test + GO/NO-GO | | | open | OPEN | needs the owner: closed grate, doorway, stairs by hand |

Raw perf (walk = full route, headless, per config):

| grid | renderer/physics | frames | sim p50/p95/max | js p95/max | gpu p50/p95 | over25 / worst interval |
|---|---|---|---|---|---|---|
| 400x150 | mesh/mesh | 2052 | 0.2 / 0.5 / 9.6 | 6.4 / 17.3 | 2.21 / 2.77 | 0 / 17.6 |
| 400x150 | mesh/grid | 2360 | 0.2 / 0.4 / 6.3 | 4.7 / 14.7 | 2.34 / 2.66 | 0 / 17.2 |
| 400x150 | dda/grid | 2205 | 0.2 / 0.4 / 6.6 | 3.4 / 11.5 | 3.07 / 3.44 | 1 / 616.6 |
| 240x90 | mesh/mesh | 2157 | 0.2 / 0.5 / 8.0 | 3.0 / 12.2 | 0.97 / 1.27 | 0 / 19.7 |
| 240x90 | mesh/grid | 2291 | 0.2 / 0.4 / 4.6 | 2.7 / 9.9 | 1.19 / 1.23 | 0 / 19.1 |
| 240x90 | dda/grid | 2207 | 0.2 / 0.4 / 7.1 | 2.5 / 11.8 | 1.41 / 1.55 | 1 / 616.6 |

## Fix round 2026-10-01 (BUG-1, content route a): NOT landed, blocked, ASK ARCHITECT

Tried `content/levels/tower.level.json`: grate neighbours get numeric `ceilH 6.6` (= grate `topH`; A at (17,10) edited in place, new legend `Q` for the ledge cell (19,10), `ceilMat stone` because the loader rejects `ceilMat sky` with a numeric ceilH). Result in Node: `route-walk` leg 5a mesh blocks at x = 19.30 identical to grid, 5b open passes, all legs maxDiff 0.000. Reverted because of two side effects (attempt saved in the session scratchpad `tower.grate-fix-attempt.json`):
1. `engine/render/sectorCaster.silhouette.test.js`: 94 FAIL (was 0; Q only: 30, A only: 64; ceilH 8.6 / 12: worse). The two numeric-ceil cells add a roof slab over the inside of the tower that the GPU-twin silhouette sees from outside. So the content rule is not visually free on this level.
2. `colliders.js` sentinel sanity check: base mesh differs (rule 3 face flips side and moves between base/dyn), so `tower:grate` falls back to a full mesh rebuild on every refit (allocates, warns once). Any numeric-ceil neighbour will trigger this with the current sentinel scheme, i.e. the 27.18 content rule cannot be satisfied zero-alloc.
Options: (c) physics-only closed-state barrier quads in `colliders.js` (no render change, no fallback; recommended), or accept the roof cells + update the silhouette test and the fallback.
**Architect 2026-10-01: option (c) accepted**, spec = architecture.md 27.18b (barrier quads on dyn-cell edges facing out-of-grid or non-solid `'sky'`-ceil neighbours, `ceilH..topH`, tracked by the existing sentinel/`trackCeil` refit). One step (~0.5 programmer-day, PC-A or PC-B cross-track, ends in arch-review); content stays reverted.

## Fixes made

None in engine/game. (One prototype of a `levelMesh.js` rule-3 change was tried and reverted byte-for-byte, see BUG-1.)

## BUG candidates

**BUG-1 (blocks AC 3 / gate, needs a decision): closed grate is walk-through under `physics=mesh`.** Repro: `node tools/route-walk.mjs` leg "5a" (mesh walks from (19.57, 9.89, z3) to (17.85, 10.47, z3.3) through the closed grate in 27 steps; grid stops at x = 19.30). Browser: same, `tools/route-walk-browser.mjs --renderer mesh --physics mesh`, leg 5a "completed:false". Cause (confirmed by dumping the `tower:grate` collider, 10 triangles): the grate cell is `ceilH 3 = floorH` with `topH 6.6`, but its east/west/north neighbours have `ceilH 'sky'`, so `levelMesh.js` rule 3 (`typeof ceilH === 'number'` on both sides) emits no lintel face; only the south side (solid wall, 3 -> 7.5) exists. This is the parked "known difference 2" of 27.18 (ME-10c review), which assumed it was tolerable; ME-12 AC 3 requires the grate to block. Options for the architect:
 (a) content: make the grate neighbours numeric `ceilH` (e.g. 6.6) in `content/levels/tower.level.json` (PB, no engine change; renders unchanged except the lintel becomes a real face; check `?gpucompare=1`);
 (b) `levelMesh.js` rule 3: treat `'sky'` as +Infinity when the other cell has numeric `ceilH` and `topH` (z1 = topH). I tried the 6-line change: it did NOT fix the walk, because `colliders.js` builds the dyn collider with the sentinel `ceilH = floorH + 1000.5`, which makes z0 (1003.5) > z1 (topH 6.6) and the face is skipped (and the tracked-vertex trick then has nothing to move). It also changes the render mesh for every numeric-ceil cell next to sky. Needs the sentinel logic reworked, so not a local fix;
 (c) physics-only: `colliders.js` adds four closed-state barrier quads around a dyn cell whose `ceilH <= floorH + height`, tracked like the ceiling vertices (no render change).
Recommendation: (a) for M1 (data fix, zero engine risk), (c) if the architect wants it engine-side.

**BUG-2 (minor, driver or game, not mesh-specific): on `renderer=dda` the scripted `E` never targets the lever** (`world.interaction.targetKey` null at the same pose where it is found on `renderer=mesh`; poses within 0.1 m). Physics is the same grid code in both, and the lever pull works with the fallback `fireInteraction`. Possibly an effect of the scripted view pitch; not reproduced by a human. Low priority, left as a note.

**Observation: dda renderer shows one ~617 ms stall (over25 = 1) at the start of every scripted route**, mesh runs show none.

## Not covered / open

- AC 1 "once by hand" and AC 11 owner walk-test: open (owner).
- Lintel-blocks-head-height cannot be tested on world_m1 (no walk-under lintel besides the grate).
- GPU numbers 7a: re-measure with the plain `?bench=1` walk on a clean tree (other agents' render WIP present).
- AC 10 architect verdict: open.

## Architect verdict (2026-10-01)

**Architect verdict (2026-10-01): AC 10 PASS - the phase-2 gate is ready for the owner walk-test (AC 11).** BUG-ME12-1 (`2a4dac4`) is ARCH OK against 27.18b: edge rule, emitWall corner order/winding (all 4 faces checked), `z0 = sentinel` so the existing `trackCeil` refit moves the barriers (refit path unchanged, zero alloc), fallback appends the same barriers at the current `ceilH`, physics-only (no engine/render, engine/mesh, levelMesh.js or index.js change), engine/physics untouched.
Per-row notes:
- 1a-1i, 2, 3a, 3b, 4, 5, 6a-6c, 7b-7d, 8a-8d: PASS as measured; no further architect action.
- 7a: PASS against the re-based route-walk bar (mesh p95 <= 2.75 ms and <= dda). The "re-measure 7a on a clean tree" item under "Not covered" is closed by the fix round (clean tree, 3-run median 2.656).
- 8a WARN (typecheck, RE-15a/b / ME-22 files) is not ME-12 scope; does not block.
- Lintel-blocks-head: not testable on world_m1 (only the grate); accepted for phase 2, add a probe when content gets a walk-under lintel.
- BUG-2 (scripted `E` on dda) and the dda start stall: not gate-blocking, outside mesh-physics scope.
- Still open (owner): AC 1 "once by hand" and AC 11 walk-test + GO/NO-GO (closed grate from both sides, lever/open grate, stairs, doorway on `?renderer=mesh&physics=mesh`).
- Non-blocking follow-up for ME-13+: a dyn sector with 0 dyn tris and 0 barrier edges now reaches `buildBvh` with an empty array instead of returning null (previous guard removed); restore an `allPos.length === 0 -> return null` guard next time colliders.js is touched.
