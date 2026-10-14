# Arch batch review B (PC-A, 2026-10-15)

Scope: origin/pc-b as merged into pc-a at c4cd8ba5. Diff-only review. Probes run: the touched suites with timings (all green; beastSim.test.js took 36 s).

## Verdicts

**ENV-02d part 2 + part 3 + ENV-02d-LIVE (30f95781, ed15bac9, df052715, 65779019): ARCH CHANGES**
1. `passRaster._lookTextures`: `this.lookWorld = world` is set even when no near look was uploaded (near band not ready yet). A new world whose `near.version` later equals the old one then keeps the OLD world's NEARLOOK texture. MAP-12 hit the same issue with the type texture, and the fix is the same: use a separate `nearLookWorld` and set it only on a near-look upload (same for far: `farLookWorld`). Add a test that swaps the world with the same near.version.
2. `Terrain.setGroundLook(cfg)` on an already baked far grid refills `farLook` but does not bump `farVersion`, so the GPU keeps a stale FARLOOK after a runtime or editor toggle. Bump `farVersion`, or add a `lookVersion` that the host keys on. Add a test.
3. main.js: pass `groundLook` only on the WebGPU path (`wgActive`, which is known before `worldLoadOpts`), else `null`. The JS twin costs +12 ms at 480x180. That is fine for the oracle (gpucompare, Node) but not for the JS/WebGL2 fallback runtime (D-007, 8 ms JS).
4. Budget (D-085): run `bench-presets` with `--query look=0` vs on (RTX all presets, Intel high) and record the shade delta against the 38.63 budget (0.15 ms iGPU / 0.03 ms RTX) in the lane before close.
- Carpet look: see answer b.

**LOOK-TWIN-PERF (db0ba542, partial): ARCH OK -> close**
Bit-identical, 0 alloc. +12 ms is acceptable for a twin, because after item 3 the twin only runs as the oracle (gpucompare / Node bench). No stateful cross-cell corner-hash cache: it adds determinism risk for a path that does not ship.

**ENV-03b / ENV-03c / ENV-GATEFIX (aa08ee52, 90f48d23, 45e9a37f): ARCH OK -> po-review**
The engine parts match 38.65: identity is byte-identical, consumers re-read on `liveFogVersion`, UI cells skip the grade on the GPU (giMask early return), 0 alloc.

**ENV-03 main wiring (f2c682bf): ARCH CHANGES**
1. `gradeCells(rt, atmosState)` runs on WebGPU frames too (~0.5 ms of JS spent on `rt.cells` for nothing). It also runs BEFORE the CPU `applySceneFade`/dim, while the GPU grades AFTER fade/dim. The grade is non-linear, so the order is part of the twin. Change it to `if (!fb.gpu && atmosState.on) gradeCells(...)`, placed after the CPU fade/dim block.
2. No `atmosDrv.snap()` anywhere. Call it on world:loaded, respawn/restart/travel and any teleport > 50 m (38.65 section 1); today those fade over 1.5 s.
3. `outdoor` is hard-coded to `true`. Pass `false` when the active world is not the overworld terrain (interiors and dungeons would otherwise get meadow/forest fog and grade).
4. Budget: record the sprite-grade on vs off GPU delta (`--query atmos=0`) against 38.65 section 4 / D-085.

**ED-FOLIAGE-03 (19e74bc1): ARCH OK -> po-review**
Neutral byte, `paintAt`, the shared rule in both scatter sites, never serialized: all as 38.69. The editor must call `rebuildDecor` once per stroke end, not per dab, because it re-runs the whole near-band scatter.

**BEAST-ALLOC-01 / 02 / 02b (9f96fcb4, 8e978299, 25a48b77): ARCH CHANGES**
1. Test runtime: `beastSim.test.js` now takes 36 s (alloc probes: life07 24 s, beast8 7 s). That is far over the ~5 s rule and over half of the 60 s run-tests limit. Cut steps/worlds, or move the real-floor alloc probes to `beastAlloc.test.js` and keep each file <= 5 s.
2. `probeSupportIo` duplicates the `probeSupport` body ("keep in sync"). Add a direct parity test in `meshCollide.test.js`: >= 1000 random points, grounded, airborne and `airStepUp`. Drift must then fail a test instead of relying on the supportAt path.
- Otherwise OK. The inlined `gridHeight` bilinear is pinned bit-for-bit, band edges included. `engine/physics` stays stand-alone.

**ED-LOGIC-01a (54783a7b): ARCH CHANGES**
1. `save().e` stores intern argIds. Those are compile-order indices, and 38.70 says "never key saved state by index": they renumber when content changes. Save `[kindName, argName, value]` instead (keep the reverse table in the program) and map back with `program.argId` on load (0 = unused, wildcard only).
2. Pending rows `[blockId, actIdx, steps]` survive a `rev` change, so actIdx can point at a different action. Drop the pending rows of a block whose rev changed (store rev in the row or compare it on load). Add a test.
3. `resume` (head event partly handled after a maxPerStep deferral) is not saved. A save/load at that point refires the blocks already run for that event. Save it by block id or index-free (e.g. `r: blockId`). Add a test with 40 actions on one event.
4. `todo = count` is taken after phase 1, so events pushed by DELAYED actions are handled in the same step. That breaks the next-step rule. Take the snapshot before phase 1 and add a test.

**ED-LOGIC-01b (4783fdce): ARCH OK -> po-review**
The emit is synchronous, so reused payloads are safe. Area-only zones are included and used-key semantics are unchanged. The double source was fixed in 01c (`zone:*`).

## GC-FIX finding (7a0a5ef8)
- **Likely cause:** the mesh LOD hysteresis lives in two independent state machines. The JS twin uses `g.lodPrev` (instances.js `compactGroup`). The GPU cull keeps its own `lodPrev` storage buffer per cull batch (passCull.js `_create`; zeroed again when the idle sweep re-creates a batch). Neither is reset on a camera cut. After the 410 m jump lookMeadow -> lookForestEdge, instances inside the +-10 % band keep different previous LODs on the two sides. Their silhouettes then differ (LOD0 vs LOD1), which gives exactly "meshTies 124, kind 99.49 %" (boundary ties, not holes).
- **Not a play bug.** Play renders only the GPU path, whose hysteresis is self-consistent (at worst it keeps an in-band LOD after a teleport, which is what hysteresis is for).
- **Confirm cheaply:** zero every `g.lodPrev` and `passCull.removeBatch` all batches between gpucompare rows. The shared world should then pass lookForestEdge.
- **Proper fix (small, PC-A):** a `resetLodHistory()` on camera cuts in both twins, hooked to the existing HZB cut invalidator. After that the gpucompare rows can share a world again.

## Answers
a. **OB-155s voxel cap priority.** Since ME-19a the renderer is always mesh, so the live cap is `MAX_VOX_INSTANCES_MESH` = 48, not 16. Do not raise it. Add an engine-neutral `components.voxel.priority` (int 0..3, default 0). `VoxelPool.collect` selects by tier first, then distance (same sort, 0 alloc). The game sets 2 for quest markers and 1 for quest items and givers. Story VOX-PRIO-01 (PC-A engine, 0.5 d). Test: 60 voxel entities, a marker ranked 55th by distance still renders and the hidden flag still wins.

b. **ENV-02 carpet look (gx packing).** No second GA word and no 16-bit packing. The carpet pass already has the blade root (kRx, kRy) and the near band. It samples NEARLOOK at the root and resolves the blend per blade: hash(root) < w -> hi, else lo. It stores ONE 4-bit look id in the free gx bits. The JS `writeBlade` uses the same hash. Per-blade dithering reproduces the spatial blend at blade scale. Until this lands as ENV-02e (after the item-4 budget numbers), the carpet stays un-looked, which is acceptable.

c. **BEAST-06a resetSlot / gid.** Yes: export `sim.resetSlot(slot)` as a documented beastSim API (reset from home spawn, id kept). The director maps members once at bind: `slotOf(member.id)` -> Int16Array slot -> group index. gid = the stable string `<region>/<group>` from the generator data. `beast:died` -> `slotOf(id)` -> group, 0 alloc. Director state is saved under its own relay key (`spawnDirector.v1`: `{gid: {dead, respawnAt}}`), keyed by gid, never by slot (WM-12), and not inside `beast.v1`.

d. **ED-AI-05 live-apply vs reload.** Live-apply. The director gets `replaceAreas(areas)`, which diffs by area id: unchanged areas are untouched; changed or removed ones despawn their members (off-screen first, else at once); added ones spawn on the next director tick. Call it once per stroke end / Save through the ED-AI-04 receiver hook. "Reload to apply" is shown only when no game page is connected. Area state is keyed by area id and is never written to a real save.
