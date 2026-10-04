# US-122a sun hours verification — 2026-10-04

Status: arch-review (PC-B Q15 item 1, programmer agent + main-session wiring). Equinox sun direction is driven by static ?time=HH or all-key cinematic hour values; no clock or colour curves. A level without a fixed sun uses the palette sun path, matching buildLightSet's fallback.

Files: engine/core/sunPath.js + test; engine/index.js; engine/render/lighting.js + test; engine/render/terrainCaster.js; game/js/dev/modes/cinematic.js + test; game/js/dev/modes/gpucompare.js; game/js/main.js. The GPU pose override swaps/restores world.sun and sunSource references without writing level definitions; it forces a temporary copy even for an existing time-owned sun. F6/F7 update both sun sources after the static hour is applied. Cinematic hour writes also run at render so captured frame zero has the first key's hour.

## Node checks

Pure sun path: 190 assertions PASS; lighting: 164 PASS; cinematic evaluator: 44 PASS. Six focused suites PASS. Working tree: 219/219 suites PASS before the final palette fallback addition. Final isolated prospective checkout (only US-122a, no blocked Ruins/sword edits): 217/217 suites PASS, typecheck PASS, check-deps OK (383 files, warnings only). The later PC-A sync changed only BUG-FIRE-001 documentation.

## Browser checks

RTX 4060 / ANGLE D3D11, mesh. Full 160x60 gpucompare: 68 rows; the same four baseline FAILs (voxel half occlusion, rtsHill60, cloth, pitched sword rest), zero new FAIL. Mesh route walk on port 9940 completed every leg and reached the end trigger.

Static hour captures: renderer=mesh, physics=mesh, shadows=map, grid=400x150. The existing sbTree model was spawned transiently beside the signal tower for verification; no content/level definition was edited. Tree and wall scenes were captured at both hours. Terrain's direction, rounded to Float32, equals the mesh LightSet direction component-for-component. The source tower.level.json sun remains unchanged.

| Hour | Elevation | Azimuth | Sun direction x | Added tree-shadow receivers | Tree-shadow average x offset |
|---|---|---|---|---|---|
| 8 | 29.224014643735007 | 97.1000349435858 | +0.8660253882408142 | 85 | -6.58235294117647 m (west) |
| 16 | 29.224014643735007 | 262.8999650564142 | -0.8660253882408142 | 81 | +6.580246913580247 m (east) |

Shadow evidence is from the real GPU depth map: compare identical ground receivers with and without the transient tree, using the engine's four-tap shadow sampler; only receivers newly shadowed by the tree contribute. Static hour 16 survives serialize/deserialize + setWorld and the resulting light rebuild (azimuth 262.8999650564142, sunSource=time).

A temporary 30-fps cinematic with hour 7 -> 17 played all 61 frames. Frame 0: elevation 14.63876968449746 / azimuth 93.30842660450168; frame 30 (hour 12): 77.5410898083092 / 180; frame 60: 14.63876968449746 / 266.6915733954984. No browser exceptions. The temporary path was removed. Runtime functions/test fixtures cover midnight 20 -> 26, eased hour interpolation, mixed-key rejection, no-hour output preservation and the path-level timeOfDay rejection message.

## Scope / handoff

Deviation: architecture 37.3 mentions main.js's old voxelbench light-build site near line 1373. That branch explicitly selects the frozen dda renderer; it was left unchanged under AGENTS.md / D-037's instruction never to add dda support to new features. Real game world/reload and cinematic sites are wired. No frozen dda browser checks ran. No shaders, palette.timeOfDay, running clock or level definitions changed.

Browser servers used tools/serve.py on owned ports 9920-9990, 9505-9525 and 9940; only owned server/browser processes were stopped. Standard gpucompare capture JSON/PNGs were removed. Local hour PNGs, probe logs and JSON stay untracked under .codex/US-122a. Next Q15 item: showcase per-key hours + first clips; US-122a awaits PC-A architecture review. Blocked Ruins/sword implementation remains local and unpublished.
