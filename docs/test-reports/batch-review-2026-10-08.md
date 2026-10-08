# Batch review 2026-10-08 (lanes B + C)

Kept in its own file so no backlog conflicts arise before the merges; copy verdicts into the rows at merge time.
Sources: `origin/pc-b` (+pc-b2), `origin/pc-c`.

## Architect verdicts
| Item | Verdict |
|---|---|
| WG-2b, WG-2c, WG-3b, WG-3c | ARCH OK -> po-review (carry-overs landed in PC-A 92b2133) |
| WG-3d (sun shadow map) | ARCH OK -> po-review |
| WG-3e (water) | ARCH OK -> po-review |
| WG-3f (sprites + overlay) | ARCH OK -> po-review. Nit: `rendererString` still says "WG-3d". Owner to-do: check `drawEyelid` wake blink under WebGPU (CPU writes to `rt.cells` hidden when `frameComplete`). |
| WG device follow-ups (83723d5) | ARCH OK -> po-review |
| WG-4a part 1 | ARCH CHANGES (B2): (1) `WgCullPass.run()` allocates per frame via `argsCpu.subarray` - cache view, rebuild when `_nextSlot` changes; (2) `setStatic(group)` before `add()` keeps only one group in `_pendingStatic` - use a Set or throw. |
| GFX-01a | ARCH OK -> po-review (GFX-01w main.js wiring + settings whitelist go to B1) |
| US-096a | ARCH OK -> po-review |
| US-089a | ARCH OK -> po-review |
| US-112a | ARCH CHANGES (C): `tools/demo/build-demo.mjs` top-level `import ts from 'typescript'` fails without node_modules -> dynamic import like `tools/typecheck.mjs`; test prints SKIP + exit 0; CLI says "npm i first". |
| MAP-01b | ARCH CHANGES (C): `tools/bake-chart.test.mjs` 35.7 s -> keep fixture bake, determinism, input-hash `--check` in default suite; move full world_m1 rebake/freshness to `node tools/bake-chart.mjs --check --index` at merge time; document "edit world_m1/terrain -> rebake" in `tools/editor/README.md` + lane file. |
| ED-MESH-01 help/viewport | ARCH OK -> po-review |

## Merge order
pc-b first (gpucompare: WebGPU = WebGL2 140/6, no PASS->FAIL), then pc-c after US-112a + MAP-01b fixes (else run-tests red on PC-A). No shared files between the lanes.

## PO verdicts
PO sonnet, claims-only, nothing run. CAVEAT: this session had no git/Bash, so `origin/pc-b` / `origin/pc-c` rows and reports could not be read. ACs come from the local `docs/backlog.md` rows and `docs/lanes/*.md`; the lanes' reported results for these items were NOT seen. Verdicts rest on ARCH OK plus those ACs and are provisional until the main session confirms the reported results match.

| Item | PO verdict | Owner walk-test (2 lines) |
|---|---|---|
| WG-3d sun shadow | PO OK -> testing (provisional) | Open `?backend=webgpu` (or the WebGPU toggle) next to WebGL2 on `?pose=towerShadowGrass` and a forest pose: sun shadows of tower/trees must be present and match WebGL2.<br>Walk 20 s: no shadow flicker, no acne stripes on slopes. |
| WG-3e water | PO OK -> testing (provisional) | WebGPU, stand at the world_m1 pond and the river: water colour, shimmer, edge foam and the below-surface tint look like WebGL2.<br>Walk in and out of the water; no missing or inverted water plane. |
| WG-3f sprites + overlay | PO OK -> testing (provisional) | WebGPU: fire, particles, HUD hearts/mana, prompt text and F3 overlay all draw and are readable.<br>Check the wake-up eyelid blink (`drawEyelid`) under WebGPU (architect to-do). |
| GFX-01a presets data (resolver only) | PO OK for the data/resolver step only; settings UI + wiring + full gate still open (lane log: 'UI/wiring and full gate remain open') | No walk-test: Node test only. Row stays open until GFX-01w / settings UI land. |
| US-096a quest flags + objectives (sim) | PO OK -> testing (provisional) | No in-game view until US-096w: run the quest Node test and confirm the 600-step replay hash is stable.<br>Open `content/quests/m1.quest.json`: chain wake -> lantern -> breach -> sword -> 2 beasts -> waystone, placeholder texts (writer pass still owed). |
| US-089a save data (sim) | PO OK -> testing (provisional) | No in-game view until US-089w: run the save Node test, byte-stable round trip, `saveVersion: 1`, localStorage and in-memory adapters.<br>Confirm saved fields cover player, hearts, mana, inventory, hands, flags, chests, beasts. |
| ED-MESH-01 help/viewport | PO OK -> testing, with a LOOK RISK | Editor: select a placed rock, drag it; the real mesh stays visible and the release matches the preview (undo and Esc restore it).<br>Press H on the focused canvas: the help text MUST show on screen (the lane log says it did not appear in the real-GPU capture). |

## Owner to-dos (not verified headless or in a browser)
1. WebGPU vs WebGL2 visual side-by-side for WG-3d/3e/3f (shadows, water, sprites, overlay). Gate numbers are gpucompare only (WebGPU = WebGL2 140/6); no human look yet.
2. `drawEyelid` wake blink under WebGPU (CPU writes to `rt.cells` hidden when `frameComplete`).
3. Editor H help overlay visibility, and the placed-mesh drag look (gold corner marks were "thin" in captures).
4. GFX-01a: data only; settings Quality row and rendering effect come with GFX-01w.
5. US-096a/US-089a have no player-visible effect until the B1 hooks US-096w/US-089w; objective texts still need the writer.
6. Nit for B1: `rendererString` still says "WG-3d".
7. Main session check done 2026-10-08: WG-3d/3e/3f rows + test reports exist on origin/pc-b; GFX-01a, US-096a, US-089a, ED-MESH-01 have 'ready for review' entries in docs/lanes/pc-c.md (their backlog rows still say todo -> update at merge). PO verdicts confirmed; GFX-01a narrowed to data step.

## Architect verdicts 2 (WG-4a/4b)
Opus, diff-only (`git diff HEAD...origin/pc-b`: 3034386, 2cbb803). Probes: new/changed suites in a detached temp worktree all pass, each < 1 s (passRaster 0.4 s, passShadowCull 0.9 s, cullShadow.wgsl 0.5 s, passCull 0.4 s, meshInstances 0.7 s); check-deps OK.

| Item | Verdict |
|---|---|
| WG-4a compute cull wired (3034386, + d03b405 carry-over) | ARCH CHANGES (B1): (1) still open from the d03b405 verdict: `WgCullPass.run()` allocates `this.argsCpu.subarray(0, usedWords)` every frame, now 2x/frame (raster + shadow cull). Cache the view (`this._argsView`, rebuilt only when `_nextSlot` changes, i.e. in `_create`). (2) still open: `setStatic()` before `add()` keeps ONE `_pendingStatic`, so a second pending group drops the first; use a `Set` of pending groups (or create the batch eagerly). Not used by the wiring yet, but it is public API. Everything else OK: the hook skips CPU `compactGroup` exactly for supported groups, unsupported (multi-range voxel units, full slots) fall back with no state change; indirect args = whole mesh as one range = rasterJS `_oneRange` (ONE_PART parity); args zeroed by one write before dispatch, dispatch outside the pass; `on == off` byte-identical in the gate; test fails if the hook is reverted. Non-blocking: batches are never released when `InstanceGroups` removes a group (`groups.splice`) and slots are not reused; after 64 distinct groups everything silently falls back to CPU. Add a release path (e.g. `removeBatch` for groups not seen for N frames) when region streaming lands. |
| WG-4b shadow-caster cull (2cbb803) | ARCH OK -> po-review (engine-internal; skip the PO, as for pure engine work). The kernel is a faithful twin of `fillShadowBands` (band hysteresis order, eye-xy distance, sun-box `aabbOutside` shared with cull.wgsl.js, band 2 = no write), args = `ranges[0]` mirrors the CPU caster loop, the probe test covers persistent band state over 12 eyes and the pass test compares the drawn set per band with `buildShadowList` over 10 poses. No threshold touched (D-039), `?gpucull=0` = old path, warm frames 0 resources + flat heap. It shares fix (1) above (`run()` subarray). Follow-ups (not blocking): (a) PC-A bug: GL / JS twin / WebGPU shadow caster loops ignore `DRAW_FLAG_ONE_PART`, so multi-range meshGroups (trees) cast only `ranges[0]`. Fix in all three plus the shadow kernel args (`triCount*3`, first 0) in one PC-A story. (b) `casterList()` rebuilds from the CPU `g.shadowBand`, which in GPU mode only advances when the oracle runs, so instances within +-2 m of the 25/48 m cuts can differ from the kernel's band state after camera motion. Today's gate has no false FAIL. If a shadowDepth row flakes on a moving pose, that is the cause. (c) `_gpuHash` walks every GPU-owned row per frame (about the cost of the CPU band pass it replaces) and re-renders on every 1 m eye cell. Replace it with a per-group write version counter, and log renders/skips on vs off on the walk route before WG-4c. |

## Architect verdicts 3 (re-review)

Re-review of `8d2cd01..origin/pc-b` (773d964, b966edb; merge 9a6d108 had no conflicts in these files). Touched suites green in a detached worktree: passCull 0.9 s, shadowList 1.2 s, meshGroups 1.0 s, rasterMask 1.3 s, gltf-import 3.6 s (all < 5 s); check-deps OK. No gpucompare threshold touched (D-039).

| Item | Verdict |
|---|---|
| WG-4a ARCH CHANGES fixes (773d964) | ARCH OK -> done (engine-internal, skip the PO). `_argsView` is built in the constructor and rebuilt only in `_create` after `_nextSlot += 2`; `run()` writes the cached view (0 allocs). `_pendingStatic` is a `Set`; `_create` uses `delete(g)` as the static flag. The new test fails without either fix: one pending slot gives 1 re-upload instead of 0, and without the cache the view-identity asserts fail. Non-blocking batch release (verdicts 2) still stands. |
| MESH-SHADOW-02 rework (b966edb, 38.8a 25a + 2026-10-07 hotfix) | ARCH OK -> po-review. Nearest-4 cap gone. The module global `meshShadowBudget` is gone. `meshCastM`/`meshCastCap` are in `SUN_SHADOW_DEFAULTS` and clamped in `resolveSunShadowOptions`; the default 0 means off, which keeps the hotfix reach. All 3 feeds pass them on (compositor JS twin, GpuCellPipeline, WgShadowPass), so the GL, WebGPU and JS twin read one list. Tests: all 30 inside the cut are kept, none beyond, the cap bites only on overflow, default off, clamp. Report: cut-only 187.7k tris (-41 %) plus the roadSouth before/after captures. No new hot-path allocs. Nits, not blocking: the JSDoc says the cap is `1..MAX_MESH_DRAWS` but the clamp allows 0; the literal 64 in shadowSun.js has no test tying it to `MAX_MESH_DRAWS`. Open: the boar shadow distance headless check (PO/owner). |
| ALPHA-01b ARCH CHANGES fixes (b966edb) | ARCH OK -> po-review. (1) gltf-import masks are now opt-in (`--masks <dir>`; without it, alpha is ignored as before), the mesh-import skill has a note, and a new test checks that a default import has no masked range and no mask files. (2) `MeshDrawCache.get` without an atlas no longer throws: it draws opaque (no `maskRanges`) and warns once per mesh. The cached `noAtlas` entry is rebuilt as soon as an atlas is passed. The test covers no throw, opaque, and a single warning across 2 gets. |

## PO verdicts 2
PO sonnet, claims-only, nothing run. Based on the architect verdicts 3 above, `docs/test-reports/MESH-SHADOW-02b.md` and `docs/test-reports/ALPHA-01b.md`.

| Item | PO verdict | Owner walk-test (2 lines) |
|---|---|---|
| MESH-SHADOW-02 rework (b966edb) | PO OK -> testing. Report claims met: nearest-4 cap gone, budget in shadow options (default 0 = off = unchanged look), all props inside the cut kept, roadSouth 319k -> 188k tris (-41 %) at `meshCastM=25`, gpucompare 140/6 on both backends, 299 suites PASS. Boar shadow distance check not done (open, see to-do). | `?pose=roadSouth&shadowcast=25` vs default: props near you keep their shadows, far ones fade out at ~25 m; no popping of near shadows while walking.<br>Same on `?backend=webgpu`; shadows must match WebGL2. |
| ALPHA-01b fixes (b966edb; JS side only, D-044) | PO OK -> testing for the JS side. Masks opt-in via `--masks`, default import unchanged, `MeshDrawCache.get` without atlas draws opaque with one warning. GPU twin (mask upload, discard in shaders) is NOT done, so no visible alpha cut-outs in the GPU renderer yet; row stays open for the GPU part. | No visible change expected in the normal game: check one default scene (e.g. `?pose=roadSouth`) looks the same and the console shows no mask warning spam.<br>Cut-out leaves/fences only appear after the GPU part (WG-2b/WG-3 follow-up). |

Owner to-do added: boar shadow distance check. Walk to a boar and back away at 10, 25, 40 m (voxel feed has no cut, not reproducible in Node): its shadow must not pop or vanish earlier than the prop shadows with `?shadowcast=25`.
Follow-up filed: BUG-SHADOW-ONEPART-01 in `docs/backlog.md` (P2, PC-A, architect notes first).
