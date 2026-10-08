# GFX-01w quality preset wiring (lane B1, po-review)

Files: `game/js/gfxBoot.js` (pure `resolveBootOptions` + `describeQuality`), `game/js/gfxBoot.test.js`, `game/js/main.js` (boot section: `loadPresets` + `resolveQuality` before `createRenderer`; `gfx` passed to `createEngine`; F3 line), `game/js/platform/web.js` (settings blob accepts/saves `quality` and `shadowQuality`, only written once chosen).

## Default boot, before -> after (owner decision D-047)
| | before | after (no URL params, nothing saved) |
|---|---|---|
| grid | 240x90 | 400x150 (preset high) |
| rays | 2 | 2 |
| shadows | map, instCastM 32 | high = map 2048, instCastM kept at 32 (the old main.js value; engine SUN default is 48) so the look is unchanged |
| scatter / lodScale | 1 / 1 | 1 / 1 |
So the default look differs only by the grid (400x150). A non-default grid saved by the old Settings Grid row is still honoured until a quality is chosen/saved. Capture/bench/compare pages (`?bench`, `?voxelbench`, `?gpucompare`, `?cinematic`) keep today's options (240x90, rays 2, no preset) unless `?quality=` is given, so they stay comparable.

## Precedence
URL knob (?grid ?rays ?shadows ?shadowinst/res/cast ?scatter ?lodScale ?shadowQuality) > ?quality= > saved > auto (null until GFX-02) > high. `?grid=` / `?rays=` keep today's free values (160x60, rays 3 still legal). Presets fail to load -> one warning, boots as before.

## Per preset (headless F3 line, `?quality=X&f3=1`)
- low: grid 240x90 rays 1 shadows low scatter 0.5 lodScale 0.6
- medium: 240x90 rays 2 mid 0.75 0.8
- high: 400x150 rays 2 high 1 1
- ultra: 480x180 rays 4 high 1 1.25 (cells line matches)

## Gates
- `node tools/run-tests.mjs`: 302 PASS, 0 FAIL, 0 WARN; check-deps OK; validate-content OK; new `gfxBoot.test.js` (precedence, per-knob URL override, invalid fallbacks, capture pages, presets-missing = today's options).
- gpucompare: webgpu 140 PASS / 6 FAIL, webgl2 140 PASS / 6 FAIL (baseline unchanged, same 6 world_m1 poses).
- Route walk browser (400x150): all 10 legs completed, endTrigger true.

## Open
- NEEDS C: Settings Quality row (none exists yet; so no live grid / "restart to apply" hook was wired). Saving works via `saveSettings({quality, shadowQuality})`.
- Shadow `mid` instCastM is 36 while high is kept at 32 (legacy), so mid reaches farther than high; GFX-04 numbers should fix the table.
- `?scatter=0` keeps its old meaning (no detail tufts) and now also means density 0.

## ARCH CHANGES 2026-10-08 (batch 5) - done
1. Sun 'off' GPU check, one capture per backend (in-app browser, RTX 4060, tree 0bc20ba + this fix, `?shadows=off&pose=roadSouth&autoquality=0&f3=1`, default preset high):
   - webgpu: F3 `backend: webgpu (nvidia/lovelace)`, `path: gpu grid 400x150 rays 2`, `shadows high/off`; console: WgCellPipeline passes `debug,raster,resolve,deriv,light,shade,edge,water` (no shadow pass), frame owned by the GPU (grid 160x60 -> 400x150 = frameComplete, rt.gpuActive), scene sunlit (N.L), no cast shadows.
   - webgl2: F3 `path: gpu grid 400x150 rays 2`, pass list `shadow n/a`, scene sunlit, no cast shadows.
   - Both: no GL/WebGPU validation errors; the only console errors are 404s for the optional local pack `design/local/voxel_pack.js` (not in git, unrelated).
2. JSDoc on `resolveShadowLevel` (engine/render/shadowSun.js): "Mesh renderer only: 'map'/'off' throw on renderer 'dda'."
