# MESH-SHADOW-02 - shadow caster budget for placed kind-9 meshes (2026-10-07, lane B2)

Rule (main-session PC-B decision, PC-A may overrule): only placed kind-9 mesh props (`addMeshStructures`, shadow feed) are budgeted. Distance from the EYE (`src.eye`) <= `meshLod0M` (25 m); at most `MESH_SHADOW_CAP = 4` nearest, nearest first, ties by lower structure index (= object id `0xA000|i`). Voxel structures (tower), terrain, cloth, voxel props and instanced groups are untouched. No `src.eye` = old behaviour. One caster list feeds the GL pass and the JS twin. JS only, no GLSL/WGSL.
Code: `engine/mesh/shadowList.js` (`MESH_SHADOW_CAP`, mutable `meshShadowBudget {cap, cutM}` for probes), `engine/mesh/DrawList.js` (`addMeshStructures(..., budget)`, deterministic tie eviction). Tests: `engine/mesh/shadowList.test.js` (cut, cap, order, ties, cap 0, no eye, determinism, voxel structures never budgeted).

## Sweep at `?pose=roadSouth` (static, shadow map re-rendered every frame via `dirtySkip=false`, 240 frames, real Intel Arc / ANGLE D3D11, grid 240x90; shadow tris counted at GL draw calls in the 2048^2 viewport)
| cap (cut 25 m) | shadow tris / frame | vs before | shadow items | shadow draws |
|---|---|---|---|---|
| before (no budget) | 352.7k | - | 118 | 142 |
| 0 (no placed props) | 140.9k | -60.1 % | 54 | 85 |
| 1 | 141.1k | -60.0 % | 55 | 86 |
| 2 | 145.8k | -58.7 % | 56 | 86 |
| 3 | 153.1k | -56.6 % | 57 | 88 |
| **4 (chosen)** | 157.7k | **-55.3 %** | 58 | 88 |
| 6 | 168.9k | -52.1 % | 60 | 90 |
| 8 | 174.9k | -50.4 % | 62 | 92 |
| 12 | 186.2k | -47.2 % | 66 | 96 |
| 64 (cut only) | 234.6k | -33.5 % | 80 | 109 |
The floor (140k) is terrain + instanced vegetation + tower, which the rule must not touch. Cap 4 is the largest-margin choice inside 50-70 % that still keeps the 4 nearest props' shadows (cap 8 sits on the 50 % edge and other poses could drop below it). Main-pass tris unchanged (~345k/f, camera list untouched).

## GPU shadow ms (timer query p50, `passMsP50[shadow]`)
Noisy on this machine (GPU clock ramp; the first alternating pairs after load were unreliable). Warmed pairs, before -> cap 4: 1.71 -> 1.58 ms, 1.86 -> 1.56 ms (about -8..-16 %); earlier cold pairs 1.55 -> 2.98 / 1.58 -> 2.52 are noise (total GPU sum also swung 7.3 -> 3.9 ms between runs). Tris (-55 %) and draws (142 -> 88) are the reliable numbers; the ms gain is smaller than the tri gain because the remaining instanced-vegetation casters dominate the shadow cost (MESH-PERF-01).

## Gates
- `node tools/run-tests.mjs`: 276 PASS, 0 FAIL (one earlier run showed 1 FAIL under load while a browser capture ran; not reproduced, suite not identified).
- `node tools/check-deps.mjs`: OK.
- gpucompare (webgl2, same machine, baseline captured before the change): 144 rows compared, no PASS->FAIL, no threshold change; the 6 known FAILs unchanged. Shadow-depth parity rows only improve (e.g. `shadowDepth.items` 116 -> 56, `maxUlp` 832958 -> 127317, hist.big 108 -> 13), as expected with fewer casters.
- Not done: no owner-eye screenshot of the dropped far-prop shadows (props 25 m+ away, and all but the 4 nearest within 25 m, no longer cast sun shadows). PC-A/owner look at `?pose=roadSouth` recommended.
