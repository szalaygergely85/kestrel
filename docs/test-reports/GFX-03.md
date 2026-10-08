# GFX-03 engine knobs for the quality presets (lane B2, arch-review)

All defaults = today's behaviour (bit-identical output). Everything is a plain option on `createEngine` and exported from `engine/index.js`. Applied at world load / scatter (re)bind: a change needs a reload (GFX-01w: "grid live, the rest on reload").

| Option | Where | Default | Range / clamp | Effect |
|---|---|---|---|---|
| `shadows.sun: 'off'` | `createEngine({ shadows })` | `'map'` (mesh renderer) | needs renderer `mesh` | sun still lights (N.L), no shadows: no depth pass, no caster list, no DDA |
| `resolveShadowLevel(level)` | `engine/render/shadowSun.js` | - | `off` `low` `mid` `high`, else throws | plain shadow options to spread into `shadows`; `high` == `SUN_SHADOW_DEFAULTS` (tested equal) |
| `gfx.scatterDensity` | `createEngine({ gfx })`, `bindScatterInstances(..., gfx)`, `bindDetailInstances(..., gfx)` | 1 | 0..1 (NaN = 1) | keeps a placement iff `placementHash01(x, y, index) < density`: deterministic, lower density is a strict subset of higher; groups sized to the thinned count; trees (voxel + mesh species) and detail tufts |
| `gfx.lodScale` | same | 1 | 0.25..4 | LOD0 -> LOD1 switch DISTANCE multiplier: `group.lodCells = lodCells / lodScale` (trees, ground scatter, detail). CPU compact and WG-4a GPU cull both read `group.lodCells`, so both paths agree by construction |
| `gfx.tuftDrawScale` | same | 1 | 0.25..2 | multiplies detail draw distance (layer `drawM` bound and every placement's `r2`) |

`engine.gfx` is the frozen resolved copy. Helpers: `resolveGfxKnobs`, `GFX_DEFAULTS`, `GFX_RANGES`, `SHADOW_LEVELS`, `SUN_SHADOW_DEFAULTS`, `resolveSunShadowOptions`.

## How sun 'off' works (no shader change)
The light pass runs in sunMode 2 (shadow-map mode) with `SUN_OFF_MATRIX` (clip x always 4), so `sunShadowTaps` returns 4 ("receiver outside the box") in the WGSL, GLSL and JS twin alike: fully sunlit, N.L unchanged, terrain n = 4. No depth texture or pipeline is created (`WgShadowPass.off`, GL `_sunOff`), `run()` only sets `active`, the light pass binds its dummy 1x1 depth texture. Touched: `passShadow.js`, `passLight.js` (null texture falls back to the dummy), `WgCellPipeline.js` (run + `_syncActive` accept `off`), `GpuCellPipeline.js`, `compositor.js` (JS twin publishes the off state as `fb.sunMap`).

## PROPOSED shadow level numbers (NOT measured; GFX-04 on PC-A must replace them)
| level | sun | res | meshLod0M | instCastM (caster distance) | meshCastM | meshCastCap |
|---|---|---|---|---|---|---|
| off | `'off'` | - | - | - | - | - |
| low | map | 1024 (0.19 m texel) | 12 | 24 | 25 | 16 |
| mid | map | 1536 (0.125 m texel) | 18 | 36 | 40 | 32 |
| high | map | 2048 | 25 | 48 | 0 (off) | 64 |

No PCF tap knob: the 4-tap quantised PCF is fixed by the three twins (a tap-count knob would need a WGSL/GLSL change; ask first if wanted).

## Results
- `node engine/mesh/gfxKnobs.test.js`: 63 checks (defaults unchanged, clamps incl. NaN, density deterministic + monotone + ~fraction, lodScale thresholds, drawScale nesting, sun off: JS twin lightAt fully sunlit, WgShadowPass on the mock device creates no texture/pipeline and issues no pass, `high` == defaults).
- `node tools/run-tests.mjs`: 300 PASS, 0 FAIL, 0 WARN. check-deps OK, validate-content OK.
- `capture-browser --mode gpucompare` (port 9531): webgpu 140 PASS / 6 FAIL, webgl2 140 PASS / 6 FAIL = baseline (same 6 world_m1 poses), thresholds untouched. The gate runs the defaults; sun 'off' is covered by the Node tests only (no headless pose for it).

## Open / limits
- Placed kind-9 meshes have no LOD (meshGroups.js), so `lodScale` does not touch them; their shadow reach belongs to the shadow level (`meshLod0M`, `meshCastM`, `meshCastCap`).
- `lodScale`/`scatterDensity`/`tuftDrawScale` are read at bind time; `main.js` (B1, GFX-01w) passes `gfx` to `createEngine` and `shadows: resolveShadowLevel(level)`.
- Terrain far-LOD switch rings (`RING0_M`) are not scaled (not in scope of the listed instance types).
