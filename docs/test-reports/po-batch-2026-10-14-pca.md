# PO batch review, PC-A, 2026-10-14 (95 items, claims-only)

Method: the `arch-batch-review` PO part. Each row's reported results (backlog / pc-b-queue row, `docs/lanes/pc-b1.md`, `pc-b2.md`, test reports) were checked against the ACs. Nothing was run. Decisions D-058..D-090 and the OB-155/156 audit (`docs/test-reports/quest-item-audit-2026-10-14.md`) were used for supersession and "see QFIX-Sx" notes.

Counts: PO OK -> testing 35, done (PO, no owner test) 55, PO REJECT 2, SUPERSEDED 2, NOT BUILT 1 (total 95).

Legend: T = `PO OK (PC-A batch 2026-10-14) -> testing`. D = `PO OK ... -> done (PO, no owner test needed)`.

## 1. Verdict per item

### Gameplay / sprint-6 era
- US-079b: T. Boar 4 HP, hurt, death, dust, `beast:died`, reset on reload covered by beastSim 135, sword 100, beastView 10, ARCH OK. Owner kill-a-boar step.
- SPELL-01b: T (parked). Fireball view, light cap, gpucompare rows PASS. Magic is off (D-065) until the level-5 fireball (D-069), so the owner look only happens with `?magic=1`.
- US-091b: SUPERSEDED by EQ-03 (one Items/Character menu, quick bar for potions, D-068/OB-011) - the 6x4 hands-strip screen is replaced.
- US-142a2: T. Waterfall content: preset, emitters, pool, rings, test cliff, preview; 29/29 + 10/10 checks, GPU p95 0.06-0.09 ms. Owner look on `design/preview/waterfall.html` (step 18; report says ramp tuning left to the owner).
- US-087: NOT BUILT. The input action map (rebindable actions, gamepad) does not exist; only the scoped pause/targeting gate was done (100 checks, accepted). Row stays todo.

### Character generator (CHARGEN), rigs, packages
- CHARGEN-02: D. validateKit/validateRecipe/composeCharacter, ARCH OK, tests.
- CHARGEN-03: D. meshCharacter, sampleClip, collapseRig, ARCH OK.
- CHARGEN-05: D. Height, age, build, randomRecipe(seed), ARCH OK.
- CHARGEN-06: D. PNG palette export and check-deps rules, ARCH OK.
- CHARGEN-07: D. Static GLB with palette texture, COLOR_0, extras; tests in gltfWrite.test.mjs.
- CHARGEN-08: D. Rigid skin with 22 joints, verified in the CHARGEN-07 writer.
- CHARGEN-09: D. Baked-animation writer works (idle + wave, FK-checked). The 6-clip content set belongs to CHARGEN-04a (designer, still todo), not to this writer story.
- CHARGEN-10: T. Binary FBX 7.4 static written with an own reader in the test; "Blender/Unity import not run" is an open AC, so an owner import check is required (step 20).
- CHARGEN-11: T. FBX skeleton, 22 limb nodes, skin clusters, bind pose; same Blender/Unity gap (step 20).
- CHARGEN-12: D. FBX anim stacks, OBJ/MTL, `.vox`; ARCH OK with tests.
- CHARGEN-13a: D. `createChargen` facade and CLI, test.
- CHARGEN-13: T. App UI and three.js viewer; the AC "preview = parsed export GLB, orbit, clips, Random/seed, export buttons" has no browser result in the row, so owner look (step 19).
- CHARGEN-13b: T. `.obj` + `.vox` exports wired in core, CLI, UI, zip; tests. Owner opens the zip (step 20).
- CHARGEN-14: T. Save/Open `.kestrel`, "All formats (.zip)", `platform.js` adapter; ARCH OK (PC-A batch). Owner step 22.
- CHARGEN-16: T. `player.look` in the save, `hand@look` retint; the row itself says owner walk picks option A/B (step 1).
- CHARGEN-21: T. Recipe JSON import/export, `kst1:` seed share string, PNG thumbnail; core is tested, UI needs a look (step 21).
- CHARGEN-22a: D. Kit regions/resLevels, downsample2, recipe.res, GAME_SAFE_RES; 38 checks, 1/1 bytes identical.
- CHARGEN-22b: D. CharGrid blocks, height remap, meshBlock, finest-grid output; 1/1 byte-identical.
- CHARGEN-22c: PO REJECT (PC-A 2026-10-14): the AC lists "build-kit stats per level" and the row says "build-kit per-level stats not done". Add the per-level quad stats to `tools/chargen-build-kit.mjs` (+ test), then re-submit. The rest (vox at the finest grid, glb `cellM`, game quad cap, Save clamp) is accepted.
- CHARGEN-22d: T. Body/Head detail rows, disabled by `kit.resLevels`, live quad count; Save clamp lives in 22c; the creation-screen part is dropped because CHARGEN-17 is parked (owner 2026-10-10). Owner step 19.
- CHARGEN-22e: D. Test warm-up only (default stays 1/1).
- RIG-01: D. `readRiggedGlb`, ARCH OK with tests.
- RIG-02a: D. readRiggedGlb fixes, fromGlb, collapseRig pivot/anchor; ARCH OK (PC-A batch).
- RIG-03: D. `model.rigged`/`model.static` asset types and `char.<id>` registration in main.js, ARCH OK.
- RIG-04: D. 0-alloc bench for 100 `char.` instances over 10k steps, alloc fixed by RIG-04b.
- KPKG-01: D. zip reader/writer, ARCH OK after fix beae3be5.
- KPKG-02: D. package validate/open/mount/deps/dupes, ARCH OK after fix.
- KPKG-03: D. `pack.mjs` / `unpack.mjs` and specs, ARCH OK.
- KPKG-04: D. `?pack=` boots from `dist/kestrel.base-1.0.0.kestrel`, first frame 3.6 s equal to loose, missing file gives a clear error; headless check recorded.

### Wildlife
- WILD-01: D. Pose crossfade, `blendInstance`, ARCH OK.
- WILD-02: D. clipPlayer and gait, ARCH OK.
- WILD-03: D. Fauna def + spawner + check-deps rule 15, ARCH OK.
- WILD-04: D. Ground brain (the second row, "ARCH OK (batch 2026-10-13)"). The older duplicate row `todo` above it is stale: ignore it.
- WILD-06: T. FaunaEnv, rabbit and deer wired, replay-hash test; the row ends in an owner walk (step 6).
- WILD-06b: D. Fauna avoids placed meshes; headless `tools/verify-wild.mjs` PASS (also cited by CULL-CAP-01).
- WILD-07a: D. Flyer brain engine half with a fake env and a placeholder bird model; ARCH OK (PC-A batch). No visible content yet (WILD-D3 is the bird art).

### Engine and perf gates (no visible change)
- RESIZE-RECOVER-01: D. Resize retries 3x; test.
- FRAME-ALLOC-03: D. Zero-alloc gate back under 16 KB / 1000 steps.
- GPU-OFF-REASON-01: D. WG pipeline warns why the GPU path turned off.
- CULL-CAP-01: D. Cull batches 64 -> 128, supports() rejects overflow; gpucompare + route walk + verify-wild PASS.
- CH1-E1: D. `engine/nav/pathFollow.js`, ARCH OK.
- CH1-E2: D. Kinematic entity colliders, `setEntityCollider`, ARCH OK.
- WS1-01: D. Bounds union of 1..8 circle/capsule parts, 14 + 4 checks, bit-identical for one circle.
- WS1-02: D. Near-band rect, `bakeNearBand`, terrainBand tests, ARCH OK (fix a6c50587).
- WS1-03: D. Terrain raster/shade for the near band; the gpucompare `roadBend` row PASS recorded under WS1-08.
- WS2-01: D. Zone pick/hysteresis, sliced bake equals `bakeNearBand` bytes, idle 0 alloc.
- WS2-02: D. Stepped scatter/detail/colliders per pending near, swap-frame ms printed.
- WS2-03: D. Far exclusion moves at `_publishNear`, no uncovered cell.
- WS2-05: D. `streamBand` per frame, `ensureBandFor` on load/travel/respawn, fade-in waits; MAP-14 route walk shows swaps, no `band:late`.
- GS-01a: D. `terrainFloor` carve mask, byte-identical for unflagged levels; the visible seam check is GS-01d (owner look pending there, step 2).
- GS-01b: D. GPU carve equals JS mask, gpucompare tower-outside rows re-baselined.
- GS-01c: D. `scatterDetail` keep-out uses the carve mask.
- DN-01: D. `blendLook`, `liveLook`, moon switch, night floor; byte-identical when unset.
- DN-02: D. LUT re-bakes on version change only, shadow renders <= 1 per step, step hitch <= 4 ms.
- DN-04b: D. Four frozen dusk/night rows, 0 PASS->FAIL, baseline updated, skill updated.
- MAP-01a: D. Layer composer and GeoFields, east/west hashes pinned.
- MAP-01b: D. Far grid origin, data-sized types, 512^2 bake timing within the gate.
- MAP-01c: D. Biome hook with biome 0 = today's placements.
- MAP-06a: D. Skyline fog cap, sea skirt, twin tests; near pixels unchanged.
- MAP-13: D. `ensureBandFor` at any pose for load/travel/respawn; Node test with a fake world.
- MAP-14: D. Long-walk leg 10: 8 swaps, `band:late` 0, max swap 1.1 ms (<= 16), no fall, outwall probe + lake edge + back; `lakeEdge` perf pose JS p95 7.2 ms (<= 8). The owner long walk stays as MAP-29.
- QG-01: D. `questBook.js` pure sim + test, ARCH OK.
- QG-02: D. `migrateQuestSave` + save state, ARCH OK.
- MAP-00: D. World map doc, preview and `world_geo.js` exist; the owner approved the plan ("perfect, I like the map", D-067).

### Waystones (relays), tower, map, travel
- WS1-04: T. World data: bounds union, `terrainBand`, Bend Waystone base mesh, components (player text says "Waystone", D-080). Route-walk leg 8 and `roadBend` gpucompare PASS (under WS1-08). Owner steps 11-12.
- WS1-05: T. Roadside capsule meshes `roadW###`/`roadN###`; look check on the road (step 11).
- WS1-06a: T. Waystone sim + wire + touch module with tests; see QFIX-S3 (the `!`/`?` marker is buried inside the 2.6 m Waystone, OB-155h) and QFIX-S5c (errands given by Waystones).
- WS1-07a: T. Map chart marker, digits, travel line, digit keys; mapCard test (step 13).
- WS1-07b: T. `travel.js`, `clearSafe`, fade, hzb invalidate (step 13).
- WAYSTONE-NORMAL-01: T. The demo end trigger is removed (D-056), tests updated. Only Node was run; the browser route walk and a live touch are owner/main-session checks (step 7).
- CH1-D1b: T. Tower 12-14 m walls and `towerCrown` placed (data and design; the row said "NOT run"). Owner look from the meadow and from the top (step 2).
- PLANT-SCALE-01: T. Per-species plant scale, gpucompare + route walk PASS; owner look (step 5).
- PLANT-VOXEL-OFF-01: T. Voxel plant scatter removed, shelf fungus lifted off the ground; gpucompare + route walk PASS; owner look (step 5).

### Map, Outwall, wolves, tiers
- MAP-06b: T. GLSL/WGSL skyline twin, row `meadowSkyline` added, ARCH OK; the row asks for an owner look (step 8).
- MAP-08: T. Far Ferrum + Wall as one baked far mesh (geometry, no sprite, D-086 compatible); OB-059 remnant fixed. Owner look from the tower crown and road at dusk (step 8). The row said "uncommitted on branch map-08": the main session must confirm it landed.
- MAP-26: T. Outwall blockout: `gen-outwall.mjs`, 304 meshes, anchors, dead Waystone, validate-content 0, reach-check 0, route-walk `--leg outwall` PASS, `band:late` 0. AC3 (bench pose p95) and AC4 (stills) are the main session's browser checks: owner look (step 15).
- QL-21: T. Ch3 template quests; quest-sim 56/56, validate-content OK, ch3.test.js chain test; texts are `NEEDS WRITER` keys. See QFIX-S5b (mq.ow.path and mq.ow.fence have no giver; sq.hw.piers and sq.fc.sign are object-given, `pierStone` has no visible mesh).
- WOLF-D1: D. Wolf voxel model (1030 voxels vs boar 3032, limit 3638), clips mapped; the owner approved the wolf look in D-074.
- WOLF-01: T. wolfBrain tests (token never shared in 10k ticks, 0.5 s crouch, block, arrow cancel, flee); AC3 browser pass (`verify-wolf.mjs`) is open: owner step 16.
- US-129a: T. `bandAt`, tiers, loot tier by band; the Outwall 10k loot sim gives only fine gear, the meadow equals golden, main.js wired. Tier look is US-129b (open owner question).
- M4-C3: T. Chart region labels and chart-piece unfog (mapWorld.test) plus the MAP-14 leg PASS. Owner opens M (step 13).

### Questline Ch1-2
- QL-09: T. Gondola giver, fetch `boar.hide`, reward Brass Buckler; quest-sim 51/51. See QFIX-S5a (object giver, E accepts at once, marker 2.8 m off the wreck, `requireItem` keeps the hide).
- QL-10: T. Burl gives honeycomb, deliver to Rook, reward arrows + Hood; both ends are characters.
- QL-11: T. Four brass pickups, reward bow + arrows; Rook gives and takes.
- QL-12: SUPERSEDED by D-082/D-087 (object-given packet quest moves to a character, QFIX-S5a; also OB-155o/p).
- QL-16: T. Ford mirror quest, nest pickup, River Boots chest, 2 wary boars. See QFIX-S5a (mq.ford.mirror auto-accepts and auto hands in, no `?` return).
- QL-17: T. mq.smoke, ford-mark inspect, smoke, chapter card + journalCh2. See QFIX-S5a (mq.smoke has no giver).
- QL-19: PO REJECT (PC-A 2026-10-14): the cloak night bonus is wired and tested, but the "River Boots = no stumble on wet stepping stones" passive is a pure function that is NOT wired into player movement (no wet-stone flag in wading). Either wire it (stone flag + 0.4 s slow step without boots) or the owner cuts that clause; then re-submit.

### Water FX
- US-055a: T. Wade splash and ring ripples, ARCH OK; gpucompare `wadeSplash` row and `?pose=riverFord` still to confirm by the main session. Owner step 14.
- PART-VIS-01: T. `bgMix` per preset (mist tint); Node 83 PASS, ARCH OK; the row says gpucompare is for the main session to run, so the look is an owner item (step 14).

## 2. ONE owner walk-test list

Use a NEW GAME (QFIX-S6, save-vs-content, is not done: Continue/Load restores old positions and models, OB-155g). Known and tracked, do not re-report: markers buried in Waystones (QFIX-S3), object-given and giverless quests (QFIX-S5a/b/c), floating pines and invisible anchors `notePost`/`knot`/`pierStone` (QFIX-S1). Report anything else as OB rows.

### Menus and the player
1. Title -> New game. In the first minute, check what the hero looks like in hands and body, and pick the look option A or B you prefer (CHARGEN-16). Expect the look to survive a save and Continue. Press `I`/`C`: one Items/Character menu opens and pauses (US-091b superseded by EQ-03).

### Tower
2. Walk out of the tower, then look at it from the meadow (20-40 m). Expect a clearly tall tower, 12-14 m walls, a round crown with a snagged red/ochre envelope (CH1-D1b). At the wall foot expect grass reaching the stone without a seam (GS-01a..c; owner look pending in GS-01d).

### Meadow
3. Kill one boar with the sword. Expect a hit flash and flinch, 4 hits, tip-over, dust, the body removed; after reload the boar is back (US-079b).
4. Gondola by the tower (ground floor): press E. Expect it to accept at once and ask for a boar hide; hand in for the Brass Buckler (QL-09; known object-giver issue).
5. Look at plants. Expect bushes/grass/ferns clearly smaller than the boar, no voxel tufts or voxel flowers, no mushrooms stuck in the air (PLANT-SCALE-01, PLANT-VOXEL-OFF-01).
6. Watch rabbits and deer. Expect them to graze, look up, flee when you run at them, and not walk through trees or rocks (WILD-06, WILD-06b; engine WILD-01..04).
7. Touch the meadow Waystone after the boars. Expect the game to keep going (no end card, no restart), the quest shows complete (WAYSTONE-NORMAL-01).
8. Skyline: stand at the meadow edge (about 1460,1030) and turn west and north. Expect peaks and a thin sea line; at dusk from the tower crown or the road, a Ferrum/Wall silhouette (never a flat sprite) (MAP-06b, MAP-08, MAP-00).
9. Optional, only with `?magic=1`: hold to charge the fireball. Expect a glowing glove, a flame ball with a trail and light, a burst with a flash and a small camera kick (SPELL-01b).
10. Burl: take the honeycomb errand and carry it to Rook (QL-10); optionally pick up the 4 brass scraps near the Bend for the bow (QL-11).

### Road west and Bend
11. Walk the road west. Expect roadside dressing (trees, rocks, logs) and no floating beams (WS1-05). At the Bend touch the dead Waystone (WS1-04, WS1-06a): the light wakes, the text says "Waystone", never "relay"; the marker will be buried (QFIX-S3).
12. At the Rook ruin: talk to Rook (the crow), take the mirror from the nest, open the River Boots chest, wake the ford Waystone, then go to the northern look-out for the smoke and chapter card "The River and the Forgotten" (QL-16, QL-17). Expect 2 wary boars near the nest.

### Travel
13. Press `M`. Expect region labels under the fog (M4-C3) and woken Waystones listed with digits. Press a digit: the screen fades, you arrive at that Waystone without falling, the fade waits until the ground is drawn (WS1-07a, WS1-07b, WS2-05).

### Ford
14. Walk from the Bend to the ford and wade in. Expect droplets on entry, a ring every 0.4 s at your feet, mist tinting the cell behind it, an arrow in water gives 4 droplets, and no hitch when the terrain swaps (US-055a, PART-VIS-01, WS2-01..03, MAP-14).

### Outwall
15. Walk to Outwall (905,940), gate gap on the south-east. Expect a palisade, 7 house shells, a forge, a board, a dead Waystone, a goose pen, barley gate and smoke from chimneys; the frame rate holds (MAP-26). The path post at 985,1040 starts the Ch3 quests (QL-21); `pierStone` will be invisible (QFIX-S1).
16. Near the goose pen fight the wolves. Expect 2-3 wolves circling at 4-6 m, one crouches for 0.5 s then leaps, block takes 0 damage, an arrow cancels the crouch, a wounded lone wolf flees, and they hit harder and have more HP than the meadow boars (WOLF-01, WOLF-D1, US-129a).
17. Long walk: Outwall -> crossroads -> lake edge -> back. Expect no stall at zone changes, no fall (MAP-14, MAP-13).

### Design previews
18. Open `design/preview/waterfall.html`. Expect the fall, spray, mist, plunge pool rings front and back (US-142a2).

### Character generator app (`tools/chargen/index.html`)
19. Open the app. Expect an orbit viewer of the parsed GLB, clip selector, Random + seed field (CHARGEN-13). Switch "Head detail" and "Body detail": quad count updates, unavailable levels are greyed (CHARGEN-22d).
20. Export "All formats (.zip)". Expect `.glb .fbx .obj .vox` inside (CHARGEN-13b, CHARGEN-07, CHARGEN-10/11 gap): import the `.fbx` and `.glb` into Blender (or Unity as Humanoid) and confirm skeleton, skin and pose; this import has never been run.
21. Export and re-import a recipe JSON and a `kst1:` seed string; export a PNG thumbnail (CHARGEN-21).
22. Save a `.kestrel`, close, Open it again (CHARGEN-14). Expect the same character.

### Not owner steps (listed for the main session)
- Run `?gpucompare=1` for `wadeSplash` and any waterfall/mist row (PART-VIS-01, US-055a); browser route walk after WAYSTONE-NORMAL-01; `node tools/verify-wolf.mjs` (WOLF-01); bench pose `outwall` and the stills `?pose=outwall` (MAP-26); confirm branch `map-08` landed (MAP-08); `?pack=` boot (KPKG-04).
- Rejects to fix: QL-19 (wire or cut the wet-stone boots passive), CHARGEN-22c (build-kit per-level stats).
