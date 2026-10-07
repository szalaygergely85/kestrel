# MESH-PERF-01 - frame-time breakdown at `?pose=roadSouth` (2026-10-07)

Tree: branch pc-a (simplified meshes, uncommitted WG-1a/voxelize files present, not touched). No engine/game change.
Scratch tool (not committed): a CDP script modelled on `tools/capture-browser.mjs` (same server/browser launch, `buildLaunchFlags`, own port 9100) that loads `game/index.html?pose=roadSouth&f3=1&<variant>`, hooks `WebGL2RenderingContext.prototype` draw calls (counts draws/triangles per bound framebuffer) and samples `engine.loop.stats` + `gpuPipeline.stats` for 400 frames after 120 warm-up frames.

## Hardware: REAL GPU
`ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11)` = Intel Arc iGPU (Meteor Lake), D3D11 backend, `EXT_disjoint_timer_query_webgl2` present, no software-renderer warning, `rt.backend = gl2`, grid 240x90. Headless Chrome, vsync on (frame interval locked to 16.7 ms = 60 fps in every run: p50 16.7 / p95 16.8, so p50/p95 frame ms is NOT informative here; GPU ms per pass is the usable headroom number).

## Method notes
- Static pose (camera never moves): the sun shadow pass is skipped by its dirty-skip (`shadowDraws 0`), so static numbers hide the shadow cost. Main numbers are therefore from a **walk**: player teleported 0.07 m/frame along its yaw (about 4 m/s, ~28 m in 400 frames), shadow map re-rendered every frame. This matches what the owner sees while walking.
- Per-pass GPU ms = `passMsP50` from the pipeline timer queries (p50 of per-frame p50s; p95 in table = p95 over the frames).
- `trees=0` / `scatter=0` are the only existing flags to hide meshes (no flag hides placed road meshes or structures); `trees=0&scatter=0` is the "no instanced vegetation" baseline, what remains = terrain + 29 placed meshes + structures/voxel props.

## Results (walk, 240x90, 400 frames)

| Variant | GPU sum p50/p95 ms | cast (main raster) p50 | shadow pass p50 | main draws | shadow draws | tris main / shadow / total | JS ms p50/p95 | shadowCpu p50/p95 |
|---|---|---|---|---|---|---|---|---|
| shadows=map (default) | 7.1 / 8.4 | 4.96 | 1.76 | ~79-86 | ~77-99 | 300k / 121k / 431k (p95 602k) | 1.7 / 2.5 | 0.3 / 0.5 |
| shadows=dda (no shadow map) | 4.8 / 5.6 | 4.36 | - | ~78 | 0 | 293k / 0 / 293k | 1.4 / 2.2 | - |
| map, trees=0 | 2.1 / 3.5 | 0.96 | 1.11 | ~74 | ~74 | 81k / 81k / 180k | 2.1 / 2.9 | 0.4 / 0.6 |
| map, scatter=0 | 4.9 / 6.2 | 3.07 | 1.55 | ~68 | ~70 | 301k / 116k / 412k | 2.1 / 3.0 | 0.3 / 0.6 |
| map, trees=0 + scatter=0 (baseline) | 1.9 / 2.0 | 0.47 | 1.08 | ~63 | ~67 | 77k / 77k / 175k | 1.5 / 2.4 | 0.3 / 0.5 |

Static pose (default, shadow skipped): GPU 5.5 ms (cast 5.0, resolve 0.24, light 0.05, shade 0.12, edge 0.03), 93 draws, 186k tris, JS 1.4 / 2.3 ms.
Fixed passes every frame: resolve 0.24 + light 0.04 + shade 0.1 + edge 0.03 = ~0.4 ms (resolution-bound, tiny at 240x90).
JS side: render JS ~1.5-2.1 ms p50 (budget 8 ms), shadow CPU (matrix + list + key) 0.3 ms p50 / 0.5-0.7 ms p95, upload 0-0.1 ms, repack 0. Not the bottleneck.
Instances: 26 static (47 p50 / 105 max walking) instanced trees/scatter, `instancedDraws` 15-21 (one per part per instanced mesh).

Uncapped run (`--disable-frame-rate-limit --disable-gpu-vsync`, default variant): 111 fps avg, interval p50 9.0 / p95 14.3 ms, GPU sum 3.7 ms but JS ms 8.3 / draw submit 7.7 ms - CPU time blocks inside GL submit (ANGLE D3D11 queueing), so JS ms and the pass timers are not comparable to the vsync runs. Treat only as "more than 60 fps is possible right now".

## Ranked conclusion (what costs frame time now)
1. **Instanced vegetation (trees + scatter) in the main raster pass: 4.0 ms of the 4.96 ms cast pass** (cast 0.47 ms without them), and ~220-250k of the 300k main-pass triangles. About 18 us per 1k triangles vs ~6 us per 1k for the rest, i.e. these meshes are the expensive ones per triangle. Trees ~4.0 ms, scatter ~1.9 ms (overlapping, not additive).
2. **Sun shadow map pass: 1.1 ms baseline, 1.76 ms with vegetation** (about 25% of GPU time while walking), ~100 draw calls and 77-121k triangles every moved frame; free when static (dirty skip). The shadow casters are mostly the same instanced vegetation plus props: shadow draw count (~100) is about equal to the main pass draw count.
3. Everything else is small: terrain + 29 placed Quaternius meshes + structures cost 0.47 ms main cast (77k tris, ~63 draws) + ~1.1 ms shadow; fixed full-screen passes 0.4 ms.
4. **CPU is not the bottleneck** at this scale: render JS 1.5-2.1 ms, shadow CPU 0.3 ms, upload ~0. Only visible effect: uncapped, draw submission (~186 GL draws/frame) starts to block the CPU (7.7 ms in submit) - a hint that draw-call count, not triangles, drives the CPU side on ANGLE/D3D11.

Total GPU 7.1 ms p50 / 8.4 ms p95 at 60 fps vsync = about 8 ms of headroom (16.7 ms budget) with the CURRENT simplified meshes. No lag reproduced at this pose.

## What it implies for the next fix
- The 29 placed meshes are NOT the current cost (0.47 ms for everything besides vegetation). The risk for WG-4c is scaling: full-detail meshes multiply triangle count while the measured per-triangle cost of the instanced path is ~3x the plain path. If full-detail placements cost like the vegetation (18 us/ktri), 1M extra tris = ~18 ms main + a similar shadow pass.
- Priority order for the fix: (a) **shadow caster cap/distance + LOD for shadow casters** (cheap, directly attacks the 1.1-1.8 ms and the 100 shadow draws; ME-15e already has `shadowinst` = 32 m, lower it or add a triangle-budget per caster), (b) **LOD / simplified shadow-caster mesh** for heavy meshes, (c) **cut per-draw overhead** (instancing is already per part; merge parts / indirect draws is the WebGPU WG-4 argument) - draw count (~186 walking) is what makes CPU submit block when uncapped, (d) CPU work is not a priority.
- Verify next: why the instanced path costs ~3x per triangle (unindexed unrolled vertices? no frustum cull per instance? overdraw/alpha-tested foliage?) - not measured here; a probe with trees/scatter drawn without shading would tell.

## Open caveats
- Walk is synthetic (teleport along the yaw, no mouse look); real play with turning may rebuild the shadow map more often but the same cost per rebuild.
- Per-pass timer values are p50 of the pipeline's own query ring (one-frame-late); vsync-locked, so no "free-running" fps number from these runs.
- No flag exists to hide only placed road meshes or structures; "placed meshes" cost is inferred from the baseline row.

## Instanced 3x probe (2026-10-07)
Question: why do instanced trees/scatter cost ~18 us per 1k tris vs ~6 for the plain mesh path. Same pose (`roadSouth`, static, `shadows=dda` so only the main raster pass is measured), same real Arc GPU (ANGLE D3D11), 120 warm-up + 400 frames, `passMsP50[cast]` median. **No repo file was edited**: all hacks were injected from a scratch CDP script (`Page.addScriptToEvaluateOnNewDocument`: wrappers on `gl.shaderSource`, `drawElementsInstanced`, `vertexAttribDivisor`); `git diff --stat` identical before and after. Run-to-run noise is about +-0.5 ms on `cast` (base measured 3.1 / 3.2 / 3.9 / 4.2 / 4.4 in different runs), so only large effects count.

Facts first: the instanced path draws only **~108k tris / 15 draws per frame** (counted at `drawElementsInstanced`: 26 instances kept, 644 culled by the per-instance frustum cull, so (e) is already done). The earlier "220-250k veg tris" was too high; with 108k tris and ~2.8 ms it is ~26 us per 1k tris, 4x the plain path. Almost all of it is **10 near trees at LOD0 (~10.7k tris each, `lodCells` 6, none at LOD1)**: trees-only 3.3 ms, scatter-only 0.61 ms (1.8k tris), no vegetation 0.52-0.63 ms.

| Probe (cast p50 ms) | Result | Reading |
|---|---|---|
| base | 3.1-3.9 | reference |
| (a) fragment shader trivial (3 MRT writes kept) | 3.6 / 3.8 | fragment work is NOT the cost |
| colour writes masked off + trivial fragment | 3.4 | ROP / G-buffer bandwidth is NOT the cost |
| all instanced primitives clipped off-screen (full VS kept) | 3.5 / 4.4 | rasteriser, overdraw (c) NOT the cost |
| VS reduced to position only, all 20 varyings constant | 3.4 / 3.1 | VS ALU / normal decode / team loop NOT the cost |
| VS position only + NO varyings, trivial FS (+ clipped variant) | 3.0 / 2.8 (clipped 3.0 / 3.1) | varying count / attribute decode NOT the cost |
| (b) instance count halved (draw n/2) | 2.4 | cost linear in instanced triangles |
| (b) trees only / scatter only / none | 3.3 / 0.61 / 0.52-0.63 | trees = all of it |
| instance attributes read instance 0 for every instance (divisor 1,000,000) | 3.9 | same as base: not cache-missing instance data |
| instance attributes divisor 0 (degenerate transforms, confounded) | 0.56 / 0.71 | cost vanishes when the instanced vertex stage does no distinct per-instance work |

Ranked cause: (1) **vertex-invocation count on the instanced indexed path**: ~108k tris x 3 = ~324k vertex invocations (instances cannot share post-transform results, an 11k-tri tree has little index reuse) at ~9 ns each; everything downstream of the vertex fetch (VS maths, varyings, clip, raster, FS, ROP) can be removed without changing the time, and the time halves when instances halve. (2) Not found / ruled out: fragment, overdraw, per-instance cull (works), VS ALU, colour bandwidth. (d) vertex layout: the instanced path is already indexed (32 B vertex + u16/u32 index, not the unrolled 64 B layout of the plain path), so "unindexed" is the wrong guess. Why ~9 ns per vertex invocation is slow for this GPU is not explained: the D3D11/ANGLE instanced-draw input path (instance data in a per-frame orphaned DYNAMIC_DRAW VBO with two attribute formats, float rows + uint meta) is the leading suspect; the divisor-1,000,000 test shows it is not instance-data cache misses. Stopped here (over the ~40 call stop rule).

Cheapest fix with expected gain (cost is linear in drawn instance triangles, ~26 us per 1k tris, main pass; the shadow pass pays the same VS path for casters within `instCastM` 32 m, ~0.65 ms of its 1.76):
1. **Cut tree LOD0 triangles / use LOD1 sooner**: raise `lodCells` for the `forest*` groups (`design/levels/overworld_far.js` line 49, currently 6) and/or simplify the tree LOD0 mesh to ~4-5k tris. Halving tree tris is measured at -1.0 to -1.5 ms main (3.4-3.9 -> 2.4) plus ~-0.3 ms shadow. Needs a look-check by the owner (no silent asset changes rule).
2. Not worth doing: shader/varying trimming, fragment cost, extra cull (all measured zero effect).
3. For WG-4c: budget by **instanced triangles drawn**, ~26 us per 1k tris on this GPU/ANGLE; the WebGPU backend may not share the input-stage penalty, so re-measure this probe there before sizing meshes. Scratch script: `scratchpad/probe.mjs` (not committed; reuse `tools/capture-browser.mjs` exports).
