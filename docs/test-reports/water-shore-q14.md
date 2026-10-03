# 36.1c - column depth tint and shoreline foam (2026-10-03)

Status: arch-review; NEEDS PC-A: designer pond bowl / owner water appearance review.

Implemented in engine/render/waterLook.js, waterComposite.js, gpu/glsl/waterComposite.frag.js and waterComposite.test.js. The slot table packs selected rect bounds or circle centre/radius. Both twins unproject the raw scene depth, derive the vertical water column and use it for shallow/deep colour interpolation. Path alpha controls transparency. Shore foam uses the lesser of normalized column depth and edge distance, with the foamFar cutoff and rim-to-water foreground blend. The foam leaves the background unchanged. Sky cells retain their deep path colour and surface ramp. Shared scratch storage keeps the hot path allocation-free. No main.js, terrain or projection/tolerance changes.

Focused checks: 48/48 PASS, including the 300-frame heap gate under --expose-gc. New checks cover rect edge foam / centre ramp, unchanged foam backgrounds, shallow-versus-deep colour, equal colours for equal columns at different view slopes, sky handling, far cutoff and exact circle boundary distances. Existing anchored surface, drift/glint and allocation checks pass.

Full runner: 202/202 suites PASS, no FAIL/TIMEOUT/WARN. check-deps OK (367 files, 1280 existing warnings). This supersedes the earlier atlas/test blockers, resolved in separately pushed verification fixes.

Full real-GPU mesh comparison, own no-cache server port 9576, 160x60: 66 poses; all seven water poses PASS. Same four earlier non-water FAIL rows (voxel half occluded stair edge, rtsHill60, cloth, held sword PITCHED pitch20), no new FAIL rows. Captures removed and only the servers/browsers started for these checks stopped.

GPU timing, own no-cache port 9578 / CDP 9579: game ?renderer=mesh&physics=mesh&voxelbench=0&f3=1&grid=400x150, player (1500,1016,2.4), yaw 0, pitch -15 facing quietPond. F3 pass timing enabled; reset loop stats, sampled 600 frames after settling. Two authored water regions present. wcomp p50 0.056320 ms / p95 0.058368 ms, below 0.1 ms. ANGLE / NVIDIA RTX 4060 / D3D11; directional hardware evidence, not an owner Arc measurement. This validates the added scene-depth unprojection.

## quietPond terrain measurement

Loaded the actual world_m1 through World.load and the Node content loader, with the runtime terrain recipe and structure injection. Water surface z = 2.5m. Measurements use the centre plus eight points exactly at the 4m rim; groundAt is the runtime terrain query.

| Point | x | y | Ground z | Column m |
|---|---:|---:|---:|---:|
| Centre | 1500 | 1010 | 2.40000010 | 0.09999990 |
| Rim E | 1504 | 1010 | 2.39999318 | 0.10000682 |
| Rim SE | 1502.82843 | 1012.82843 | 2.40000010 | 0.09999990 |
| Rim S | 1500 | 1014 | 2.40000010 | 0.09999990 |
| Rim SW | 1497.17157 | 1012.82843 | 2.40000010 | 0.09999990 |
| Rim W | 1496 | 1010 | 2.40000010 | 0.09999990 |
| Rim NW | 1497.17157 | 1007.17157 | 2.40000010 | 0.09999990 |
| Rim N | 1500 | 1006 | 2.39988124 | 0.10011876 |
| Rim NE | 1502.82843 | 1007.17157 | 2.39991890 | 0.10008110 |

**NEEDS PC-A: designer pond bowl.** Every measured column is below 0.3m. At the current uniform ~0.1m depth the column foam term also affects the pond interior; the engine cannot produce a meaningful deeper-centre gradient without a bowl. Terrain was not edited, as required by 36.1c.

Terrain readings re-measured against the synced real content and runtime terrain; unchanged. No deviation from architecture 36.1c. PC-A forest assets/review notes through 218839b were merged before publication; full suites and full GPU comparison repeated after that sync. The timing measurement precedes this design-only sync; water shaders and layouts did not change in the sync.
