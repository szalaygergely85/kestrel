# Janitor report: dead code, stale comments, flaky suites, WG-5a delete list (2026-10-08)

Scope: read-only. No engine/, game/, design/ or tools/ file was edited. Method: a Node scan of every `export` in `engine/`, `game/js/`, `tools/` (1,676 export names), then a word-boundary search of every other `.js`/`.mjs` file. "Dead" = no reference outside its own file. Grep-based, so names shared with other modules can hide dead exports (false negatives). Dynamic `import()` and namespace access were not traced.

## 1. Exports never imported

Counts: 1,676 exports scanned. 154 have zero references (dead). 232 are referenced only by `*.test.js` / `*.test.mjs` (test-only). 59 are re-exported through `engine/index.js` (public API, skipped). 12 `check-deps.test.mjs` hits are fixture text inside string literals and are excluded.

### 1a. Dead (zero references outside the defining file), 154

Caveat: `const` tables used only inside their own file (e.g. `ShadeTextures.js` `F_*` flags) are exported for no outside reader. Removing the `export` keyword is the cheap fix; deleting the code needs a check.

- `engine/content/maskFile.js:6` `MASK_MAX_RES`
- `engine/fx/particles.js:17` `MAX_PARTICLE_DEFS`
- `engine/mesh/colliderProxy.js:21` `PROXY_MAX_SIDES`
- `engine/mesh/colliderProxy.js:23` `SOFT_NAME_RE`
- `engine/mesh/instances.js:23` `INST_ROW0`
- `engine/mesh/instances.js:26` `INST_FLAG_ALIGNED`
- `engine/mesh/instances.js:27` `INST_TEAM_SHIFT`
- `engine/mesh/meshGroups.js:29` `MIN_GROUP_SIZE`
- `engine/mesh/meshGroups.js:42` `OPEN_EDGE_MAX_FRAC`
- `engine/mesh/rasterJS.js:32` `SUBPIX`
- `engine/mesh/rasterJS.js:34` `GUARD`
- `engine/mesh/rasterJS.js:36` `BIAS_FACTOR`
- `engine/mesh/rasterJS.js:37` `BIAS_UNITS`
- `engine/mesh/shadowList.js:28` `SHADOW_BUILD_CAPACITY`
- `engine/mesh/waterMesh.js:21` `WATER_RING_QUADS`
- `engine/mesh/waterMesh.js:25` `WATER_SKIRT_HALF`
- `engine/mesh/waterMesh.js:29` `WATER_VERT_STRIDE`
- `engine/physics/cloth.js:26` `COLLIDER_SPHERE`
- `engine/physics/cloth.js:27` `MAX_CLOTH_COLLIDERS`
- `engine/physics/meshCollide.js:38` `MESH_PROBE_DROP`
- `engine/physics/meshCollide.js:39` `MESH_PROBE_RISE`
- `engine/render/edgePass.js:15` `RULE_LIP`
- `engine/render/edgePass.js:17` `RULE_CONVEX`
- `engine/render/edgePass.js:18` `RULE_CONCAVE`
- `engine/render/edgePass.js:19` `RULE_SEAM_FLOOR`
- `engine/render/edgePass.js:20` `RULE_SEAM_CEIL`
- `engine/render/edgePass.js:21` `RULE_NOSING`
- `engine/render/glyphMetrics.js:13` `measureGlyphs`
- `engine/render/gpu/device/GpuDevice.js:215` `GPU_COMPUTE_METHODS`
- `engine/render/gpu/device/GpuDeviceWebGPU.js:23` `DEFAULT_RING_SLOTS`
- `engine/render/gpu/device/webgpuProbe.js:15` `REPORTED_LIMITS`
- `engine/render/gpu/glsl/debug.frag.js:12` `DEBUG_MODE_SHADED`
- `engine/render/gpu/glsl/terrain.frag.js:53` `FARH_BILINEAR_GLSL`
- `engine/render/gpu/glsl/terrain.frag.js:86` `NEARH_BILINEAR_GLSL`
- `engine/render/gpu/gridTargets.js:23` `GRID_TEXTURE_FIELDS`
- `engine/render/gpu/MeshBuffers.js:128` `buildMeshTriVertexData`
- `engine/render/gpu/MeshBuffers.js:191` `CLOTH_SHADOW_LAYOUT`
- `engine/render/gpu/MeshBuffers.js:198` `packClothVertices`
- `engine/render/gpu/ShadeTextures.js:19` `GAIN_WIDTH`
- `engine/render/gpu/ShadeTextures.js:23` `MAX_TINTS`
- `engine/render/gpu/ShadeTextures.js:24` `MAX_ALT`
- `engine/render/gpu/ShadeTextures.js:27` `F_HAS_GRID`
- `engine/render/gpu/ShadeTextures.js:28` `F_GRID_TINT`
- `engine/render/gpu/ShadeTextures.js:29` `F_GRID_BGK`
- `engine/render/gpu/ShadeTextures.js:30` `F_GRID_CROSS`
- `engine/render/gpu/ShadeTextures.js:31` `F_GRID_TIE`
- `engine/render/gpu/ShadeTextures.js:32` `F_GRID_LINES`
- `engine/render/gpu/ShadeTextures.js:33` `F_GRID_GAP`
- `engine/render/gpu/ShadeTextures.js:34` `F_HAS_BEVEL`
- `engine/render/gpu/ShadeTextures.js:35` `F_HAS_BAND`
- `engine/render/gpu/ShadeTextures.js:36` `F_BAND_IS_U`
- `engine/render/gpu/ShadeTextures.js:37` `F_BAND_TONE`
- `engine/render/gpu/ShadeTextures.js:38` `F_BAND_BGK`
- `engine/render/gpu/ShadeTextures.js:39` `F_HAS_OVERLAY`
- `engine/render/gpu/ShadeTextures.js:40` `F_OV_BAND`
- `engine/render/gpu/ShadeTextures.js:41` `F_HAS_SPECKLE`
- `engine/render/gpu/ShadeTextures.js:42` `F_HAS_LOD`
- `engine/render/gpu/spritesAtlas.js:22` `ATLAS_MAX_WIDTH`
- `engine/render/gpu/VoxelTextures.js:19` `VOXINST_HEIGHT`
- `engine/render/gpu/wg/passCell.js:16` `derivTerms`
- `engine/render/gpu/wg/passCull.js:22` `MAX_CULL_BATCHES`
- `engine/render/gpu/wg/passCull.js:32` `createCullPipeline`
- `engine/render/gpu/wg/passSprites.js:30` `ATLAS_FORMAT`
- `engine/render/gpu/wg/targets.js:6` `WG_TEXTURE_FIELDS`
- `engine/render/gpu/wgsl.test.js:14` `parseBindings`
- `engine/render/gpu/wgsl.test.js:24` `pairConflicts`
- `engine/render/gpu/wgsl/debug.wgsl.js:13` `DEBUG_MODE_NORMAL`
- `engine/render/gpu/wgsl/debug.wgsl.js:14` `DEBUG_MODE_DEPTH`
- `engine/render/gpu/wgsl/raster.wgsl.js:46` `rasterWgsl`
- `engine/render/gpu/wgsl/wgslProbe.js:18` `toJs`
- `engine/render/MaskAtlas.js:7` `MASK_ATLAS_MAX`
- `engine/render/MaterialTable.js:25` `GAIN_LUT_SIZE`
- `engine/render/stable.js:55` `CHANNEL_SNAP`
- `engine/render/stable.js:57` `DEFAULT_DETAIL`
- `engine/render/teamRemap.js:21` `emptyTeamRemap`
- `engine/render/water.js:24` `WATER_SLOTS`
- `engine/render/water.js:27` `WATER_AABB_GROW`
- `engine/render/waterLook.js:24` `WL_RAMP_MAX`
- `engine/ui/overlay.js:12` `OVL_MAX_TOUCHED`
- `engine/ui/overlay.js:13` `OVL_MAX_STYLES`
- `engine/ui/overlay.js:15` `OVL_MAX_GLYPHS`
- `engine/ui/overlay.js:19` `OVL_RING_SAMPLES`
- `engine/ui/uiLayer.js:29` `UI_GRID_MIN_COLS`
- `engine/ui/uiLayer.js:30` `UI_GRID_MAX_COLS`
- `engine/voxel/VoxelModel.js:16` `MAX_VOX_DIM`
- `engine/world/cloths.js:20` `MAX_CLOTH_STATIC`
- `engine/world/cloths.js:21` `CLOTH_WARMUP_STEPS`
- `engine/world/cloths.js:22` `CLOTH_REST_STEPS`
- `engine/world/cloths.js:23` `CLOTH_DRAWN_GRACE`
- `engine/world/cloths.js:24` `CLOTH_SLEEP_DIST`
- `engine/world/cloths.js:25` `CLOTH_MIN_BOX`
- `engine/world/entityEmitters.js:12` `MAX_ENTITY_EMITTERS`
- `engine/world/fireGrid.js:18` `FIRE_EMPTY`
- `engine/world/fireGrid.js:19` `FIRE_CHANGE_IGNITE`
- `engine/world/fireGrid.js:20` `FIRE_MAX_AREAS`
- `engine/world/fireGrid.js:21` `FIRE_MAX_AREA_CELLS`
- `engine/world/fireGrid.js:22` `FIRE_MAX_CELLS`
- `engine/world/water.js:12` `WAVES_SET`
- `engine/world/waterfalls.js:5` `WATERFALL_MAX`
- `engine/world/wind.js:20` `WIND_K_SIZE`
- `game/js/audio/sfx.js:90` `onSectorAnimated`
- `game/js/audio/sfx.js:99` `onSectorAnimDone`
- `game/js/audio/sfx.js:291` `__test_setFootWorld`
- `game/js/audio/sfx.js:292` `__test_floorMatAt`
- `game/js/audio/sfx.js:293` `__test_footstepDesignFor`
- `game/js/dev/unitsHarness.js:9` `UNIT_YAWS`
- `game/js/quest/end.js:39` `FADE_SEC`
- `game/js/quest/end.js:40` `GAP_SEC`
- `game/js/quest/end.js:41` `TYPE_CPS`
- `game/js/quest/pickupsView.js:27` `blinkVisible`
- `game/js/quest/pickupsView.js:36` `bobOffset`
- `game/js/quest/save/saveState.js:5` `SAVE_VERSION`
- `game/js/quest/save/saveState.js:6` `SAVE_SLOTS`
- `game/js/quest/save/saveState.js:30` `validateSave`
- `game/js/quest/sim/pickups.js:17` `PICKUP_AMOUNT`
- `game/js/quest/sim/pickups.js:19` `COLLECT_RADIUS`
- `game/js/quest/swordConfig.js:54` `ARC_BOUNDS`
- `game/js/rts/sim/tick.js:11` `UNIT_SPEED`
- `game/js/rts/sim/tick.js:14` `FLOW_MIN_GROUP`
- `game/js/ui/gfxPresets.js:4` `QUALITY_NAMES`
- `game/js/ui/gfxPresets.js:5` `QUALITY_CHOICES`
- `game/js/ui/gfxPresets.js:6` `SHADOW_CHOICES`
- `tools/bake-chart.mjs:12` `CHART_PATH`
- `tools/bake-chart.mjs:14` `CATEGORIES`
- `tools/bake-chart.mjs:97` `bakeRepository`
- `tools/capture-browser.mjs:59` `CAPTURES_DIR`
- `tools/capture-browser.mjs:117` `validatePcbPort`
- `tools/capture-browser.mjs:148` `PRESENTDIFF_POSES`
- `tools/capture-browser.mjs:486` `shortShaSync`
- `tools/capture-browser.mjs:531` `writeDiffPngs`
- `tools/capture-browser.mjs:539` `writeCapture`
- `tools/capture-browser.mjs:634` `evaluateAsync`
- `tools/dae-import.mjs:184` `loadMap`
- `tools/dae-import.mjs:191` `keyForMaterial`
- `tools/editor/commands.js:183` `getPath`
- `tools/editor/commands.js:183` `withPath`
- `tools/editor/doc.js:112` `yawItemToWorld`
- `tools/editor/iconFit.js:2` `ICON_VERSION`
- `tools/editor/meshPlace.js:13` `roundMeshPosition`
- `tools/editor/meshPlace.js:14` `meshYaw`
- `tools/editor/pick.js:33` `readSurface`
- `tools/editor/ray.js:36` `planeGeometry`
- `tools/editor/select.js:47` `computeHighlightRect`
- `tools/editor/terrainBrush.js:14` `RADIUS_RANGE`
- `tools/editor/terrainBrush.js:15` `SPACING_FRAC`
- `tools/editor/terrainBrush.js:16` `SPACING_MIN`
- `tools/gltf-import.mjs:227` `readMaskTextures`
- `tools/mesh-budgets.mjs:6` `MESH_BUDGETS`
- `tools/validate-content.mjs:90` `loadDesignAssets`
- `tools/validate-content.mjs:672` `validateMaskFiles`
- `tools/vox-export.mjs:171` `paletteEntries`
- `tools/voxelize-mesh.mjs:17` `DEFAULT_MODELS`
- `tools/voxelize-mesh.mjs:66` `toModelDef`
- `tools/voxelize-mesh.mjs:86` `makeKeyRgb`

### 1b. Test-only, 232

Only imported by tests. Keep if the test needs them; otherwise they are test scaffolding that should move into the test file. Notable clusters: `engine/render/gpu/wgsl/*.wgsl.js` `*_TARGETS` tables, `game/js/quest/sim/*`, `tools/capture-browser.mjs`, `tools/editor/*`, `tools/vox-split.mjs`.

- `engine/core/engine.js:37` `SCATTER_OBJECT_BASE`
- `engine/core/engine.js:41` `bindScatterInstances`
- `engine/mesh/culling.js:22` `CULL_IN`
- `engine/mesh/culling.js:24` `CULL_STRADDLE`
- `engine/mesh/fixtures/voxelFrame.js:10` `voxelFrame`
- `engine/mesh/gfxKnobs.js:26` `placementHash01`
- `engine/mesh/instances.js:92` `computeGroupParts`
- `engine/mesh/meshGroups.js:27` `MAX_GROUPED_INSTANCES`
- `engine/mesh/meshGroups.js:53` `meshIsSolid`
- `engine/mesh/shadowList.js:147` `trimShadowList`
- `engine/mesh/terrainMesh.js:30` `FAR_TILE_QUADS`
- `engine/mesh/terrainMesh.js:32` `FAR_LOD1_STEP`
- `engine/mesh/terrainMesh.js:34` `RING0_M`
- `engine/mesh/voxelMesh.js:332` `downsamplePart`
- `engine/mesh/voxelMesh.js:397` `buildVoxelMeshLod1`
- `engine/mesh/waterMesh.js:23` `WATER_RING_STEP`
- `engine/mesh/waterMesh.js:50` `buildClipmap`
- `engine/physics/bvh.js:23` `BVH_LEAF_MAX`
- `engine/physics/bvh.js:499` `raycastAny`
- `engine/physics/contacts.js:35` `CONTACT_MAX`
- `engine/physics/contacts.js:67` `createContactList`
- `engine/render/CellBuffer.js:25` `_resetBadColorWarning`
- `engine/render/edgePass.js:14` `RULE_CAP`
- `engine/render/edgePass.js:16` `RULE_SIDE`
- `engine/render/gpu/device/webgpuFormats.js:46` `padTo256`
- `engine/render/gpu/glsl/mesh.frag.js:46` `meshFragSrc`
- `engine/render/gpu/glsl/mesh.vert.js:47` `meshVertSrc`
- `engine/render/gpu/gpuCompare.js:162` `meshTiesCap`
- `engine/render/gpu/gpuCompare.js:694` `SHADOW_DEPTH_MAX`
- `engine/render/gpu/MeshBuffers.js:89` `buildVoxelVertexData`
- `engine/render/gpu/ShadeTextures.js:21` `MAX_TONES`
- `engine/render/gpu/ShadeTextures.js:246` `unpackSetEntry`
- `engine/render/gpu/ShadeTextures.js:256` `unpackMatF`
- `engine/render/gpu/ShadeTextures.js:261` `unpackMatI`
- `engine/render/gpu/shadowParity.js:13` `halfRangeDepthBitsToUnit`
- `engine/render/gpu/spritesAtlas.js:21` `NORMAL_CODES`
- `engine/render/gpu/wgsl/deriv.wgsl.js:19` `DERIV_TARGETS`
- `engine/render/gpu/wgsl/edge.wgsl.js:27` `EDGE_TARGETS`
- `engine/render/gpu/wgsl/light.wgsl.js:42` `LIGHT_TARGETS`
- `engine/render/gpu/wgsl/overlay.wgsl.js:11` `OVERLAY_TARGETS`
- `engine/render/gpu/wgsl/raster.wgsl.js:161` `RASTER_Z_LINE`
- `engine/render/gpu/wgsl/raster.wgsl.js:168` `toShadowVertexWgsl`
- `engine/render/gpu/wgsl/resolve.wgsl.js:20` `RESOLVE_TARGETS`
- `engine/render/gpu/wgsl/shade.wgsl.js:60` `SHADE_TARGETS`
- `engine/render/gpu/wgsl/shade.wgsl.js:63` `TERRAIN_SHADE_WGSL`
- `engine/render/gpu/wgsl/shadow.wgsl.js:24` `SHADOW_TEXTURES`
- `engine/render/gpu/wgsl/shadow.wgsl.js:25` `SHADOW_TARGETS`
- `engine/render/gpu/wgsl/shadow.wgsl.js:27` `SHADOW_DEPTH_COPY_TARGETS`
- `engine/render/gpu/wgsl/sprites.wgsl.js:26` `SPRITES_TARGETS`
- `engine/render/gpu/wgsl/uniformBlock.js:30` `alignUp`
- `engine/render/gpu/wgsl/water.wgsl.js:23` `WATER_TARGETS`
- `engine/render/gpu/wgsl/waterComposite.wgsl.js:32` `WATER_COMPOSITE_TARGETS`
- `engine/render/gpu/wgsl/wgslProbe.js:8` `fnBody`
- `engine/render/gpu/wgsl/wgslProbe.js:34` `shims`
- `engine/render/gpu/wgsl/wgslProbe.js:54` `compileFn`
- `engine/render/gpu/wgsl/wgslProbe.js:63` `makeTex`
- `engine/render/gpu/wgsl/wgslProbe.js:74` `numericLiterals`
- `engine/render/lighting.js:72` `CPU_LIGHT_CAP`
- `engine/render/lighting.js:97` `h01`
- `engine/render/lighting.js:500` `ATTACH_WALL_MARGIN`
- `engine/render/lighting.js:512` `clampLightToFree`
- `engine/render/sky.js:86` `cloudValueNoise`
- `engine/render/sky.js:107` `cloudDriftOffset`
- `engine/render/sky.js:129` `cloudAt`
- `engine/render/stable.js:53` `YAW_DISABLE_DEG`
- `engine/render/stable.js:188` `stabilizeCells`
- `engine/render/terrainShade.js:77` `perCellHashSize`
- `engine/render/water.js:25` `WATER_REGION_SLOTS`
- `engine/render/water.js:154` `ringRuns`
- `engine/render/waterComposite.js:34` `lastWaterSlotTable`
- `engine/render/waterLook.js:31` `FLOW_MIN`
- `engine/render/waterLook.js:36` `DEFAULT_WATER_LOOK`
- `engine/render/waterLook.js:54` `packWaterLook`
- `engine/test/assert.js:35` `makeOk`
- `engine/test/assert.js:51` `approxEqual`
- `engine/ui/overlay.js:14` `OVL_MAX_TEXTS`
- `engine/voxel/VoxelModel.js:23` `RESERVED_EVENTS`
- `engine/world/colliders.js:84` `dynBarrierQuads`
- `engine/world/water.js:10` `FLOW_MAX`
- `engine/world/waves.js:18` `WAVE_SPECTRUM`
- `engine/world/waves.js:26` `WAVE_STATES`
- `engine/world/waves.js:36` `ampsFor`
- `engine/world/waves.js:44` `fnv1a`
- `engine/world/waves.js:61` `compileRegion`
- `engine/world/wind.js:21` `WIND_MAX_ZONES`
- `engine/world/wind.js:22` `WIND_PUSH_MAX`
- `game/js/audio/ambient.js:60` `brazierGainFor`
- `game/js/audio/ambient.js:64` `windGainFor`
- `game/js/audio/ambient.js:247` `__test_build`
- `game/js/audio/ambient.js:248` `__test_teardown`
- `game/js/audio/ambient.js:253` `__test_resolvePositions`
- `game/js/audio/ambient.js:256` `__test_liveNodeCount`
- `game/js/audio/sfx.js:68` `MUTUALLY_EXCLUSIVE_GROUPS`
- `game/js/audio/sfx.js:74` `playLeverClunk`
- `game/js/quest/beastView.js:26` `DIE_DURATIONS`
- `game/js/quest/beastView.js:27` `SINK_DURATIONS`
- `game/js/quest/beastView.js:36` `frameTFromElapsed`
- `game/js/quest/hints.js:72` `markDone`
- `game/js/quest/hints.js:212` `currentHintId`
- `game/js/quest/noteRead.js:161` `getOpenNoteId`
- `game/js/quest/save/saveState.js:42` `collectSave`
- `game/js/quest/save/saveState.js:52` `applySave`
- `game/js/quest/save/saveState.js:60` `stringifyGameSave`
- `game/js/quest/save/saveState.js:61` `parseGameSave`
- `game/js/quest/sim/beastSim.js:19` `STATE_WANDER`
- `game/js/quest/sim/beastSim.js:21` `STATE_CHASE`
- `game/js/quest/sim/beastSim.js:22` `STATE_WINDUP`
- `game/js/quest/sim/beastSim.js:23` `STATE_CHARGE`
- `game/js/quest/sim/beastSim.js:24` `STATE_RECOVER`
- `game/js/quest/sim/beastSim.js:25` `STATE_RETURN`
- `game/js/quest/sim/beastSim.js:26` `STATE_STAGGER`
- `game/js/quest/sim/hands.js:111` `createStubItemSim`
- `game/js/quest/sim/pickups.js:18` `PICKUP_LIFE`
- `game/js/quest/sim/pickups.js:20` `MAX_DROPS`
- `game/js/quest/sim/pickups.js:107` `liveDropIds`
- `game/js/quest/sim/quest.js:6` `validateQuestDefinition`
- `game/js/quest/sim/quest.js:65` `applyQuestEvent`
- `game/js/quest/sim/quest.js:82` `questObjectives`
- `game/js/quest/sim/quest.js:95` `stringifyQuest`
- `game/js/quest/sim/quest.js:98` `questHash`
- `game/js/quest/vitalsView.js:24` `cellCounts`
- `game/js/quest/vitalsView.js:39` `lowPulseAmount`
- `game/js/quest/vitalsView.js:46` `chipStageAt`
- `game/js/quest/vitalsView.js:68` `resetVitalsView`
- `game/js/quest/vitalsView.js:85` `shortFlashOn`
- `game/js/quest/vitalsView.js:202` `raggedHash100`
- `game/js/quest/vitalsView.js:210` `hurtEdgeStage`
- `game/js/quest/vitalsView.js:295` `deathFadeAmount`
- `game/js/rts/ui/minimapView.js:33` `createMinimapView`
- `game/js/rts/ui/select.js:9` `clearSelection`
- `game/js/rts/unitModel.js:10` `UNIT_SLOT_MAT`
- `game/js/rts/unitModel.js:33` `teamSurfaceFraction`
- `game/js/settings/options.js:19` `ULTRA_GRID_VALUES`
- `game/js/settings/options.js:82` `isValidValue`
- `game/js/ui/gfxPresets.js:19` `loadPresets`
- `game/js/ui/gfxPresets.js:36` `knobsFor`
- `game/js/ui/gfxPresets.js:45` `resolveQuality`
- `game/js/ui/gfxPresets.js:70` `saveQuality`
- `game/js/ui/pause.js:102` `_resetAutoPauseForTest`
- `tools/bake-chart.mjs:17` `inputFingerprint`
- `tools/bake-chart.mjs:49` `bakeChart`
- `tools/bake-chart.mjs:87` `chartText`
- `tools/bake-chart.mjs:92` `checkChart`
- `tools/bb-import.mjs:110` `convertPivot`
- `tools/bb-import.mjs:121` `convertPos`
- `tools/bb-import.mjs:135` `convertRot`
- `tools/bb-import.mjs:147` `collectBones`
- `tools/bb-import.mjs:222` `buildClip`
- `tools/bb-import.mjs:302` `mergeBBModel`
- `tools/capture-browser.mjs:151` `buildQuery`
- `tools/capture-browser.mjs:188` `resultGlobalFor`
- `tools/capture-browser.mjs:201` `pagePathFor`
- `tools/capture-browser.mjs:223` `normalizeLiveResult`
- `tools/capture-browser.mjs:306` `detectImportMode`
- `tools/capture-browser.mjs:315` `parseImportText`
- `tools/capture-browser.mjs:412` `diffResults`
- `tools/capture-browser.mjs:450` `formatDiff`
- `tools/capture-browser.mjs:468` `formatSummary`
- `tools/capture-browser.mjs:481` `todayStr`
- `tools/capture-browser.mjs:494` `captureFilePath`
- `tools/capture-browser.mjs:507` `diffPngSlug`
- `tools/capture-browser.mjs:512` `diffPngRelPath`
- `tools/capture-browser.mjs:518` `stripDiffPngs`
- `tools/capture-browser.mjs:651` `isSoftwareRendererLine`
- `tools/capture-browser.mjs:688` `runLiveCapture`
- `tools/capture-browser.mjs:815` `captureExitCode`
- `tools/capture-cinematic.mjs:35` `hashCells`
- `tools/capture-cinematic.mjs:39` `ffmpegArgs`
- `tools/capture-cinematic.mjs:53` `captureCinematic`
- `tools/dae-import.mjs:23` `parseXml`
- `tools/dae-import.mjs:88` `readCollada`
- `tools/dae-import.mjs:207` `importDae`
- `tools/dae-import.mjs:268` `daeToJson`
- `tools/demo/build-demo.mjs:12` `parserAvailable`
- `tools/demo/build-demo.mjs:60` `planDemo`
- `tools/demo/build-demo.mjs:95` `zipFiles`
- `tools/demo/build-demo.mjs:113` `buildDemo`
- `tools/editor/commands.js:103` `findReferrersDetailed`
- `tools/editor/doc.js:26` `computeNextId`
- `tools/editor/frame.js:27` `idleSkip`
- `tools/editor/iconRender.js:7` `createIconWorld`
- `tools/editor/livepatch.js:118` `resolveLightPreset`
- `tools/editor/meshPlace.js:32` `validateMeshStructure`
- `tools/editor/multiSelect.js:6` `sameSelectionItem`
- `tools/editor/panel.js:24` `lightPresetNames`
- `tools/editor/panel.js:102` `snappedWorldPos`
- `tools/editor/panel.js:116` `worldGroundZ`
- `tools/editor/panel.js:319` `FALLBACK_FOLDER`
- `tools/editor/panel.js:325` `DEFAULT_FOLDER_NAMES`
- `tools/editor/panel.js:415` `isValidFolderName`
- `tools/editor/panel.js:574` `assetFolderFor`
- `tools/editor/ray.js:119` `rayCylinderHit`
- `tools/editor/scale.js:13` `SCALE_STEPS`
- `tools/editor/select.js:66` `computeMeshHighlightRect`
- `tools/editor/select.js:94` `drawHighlightRect`
- `tools/editor/terrainBrush.js:26` `dabSpacing`
- `tools/editor/terrainBrush.js:132` `terrainEditsPath`
- `tools/editor/thumbnails.js:22` `THUMB_MAX_W`
- `tools/editor/thumbnails.js:23` `THUMB_MAX_H`
- `tools/editor/thumbnails.js:43` `defaultClip`
- `tools/editor/thumbnails.js:70` `buildSpriteThumbnail`
- `tools/editor/thumbnails.js:112` `buildVoxelThumbnail`
- `tools/editor/thumbnails.js:163` `buildModelThumbnail`
- `tools/editor/visibility.js:17` `itemKey`
- `tools/export-content.mjs:70` `runClassicScripts`
- `tools/export-content.mjs:144` `buildContent`
- `tools/export-content.mjs:178` `writeContent`
- `tools/gltf-import.mjs:126` `countSmoothGroups`
- `tools/gltf-import.mjs:194` `importGltfBytes`
- `tools/testing/dynamic-tower.mjs:9` `dynamicTowerFixture`
- `tools/testing/dynamic-tower.mjs:19` `dynamicTowerAssets`
- `tools/testing/mesh-golden.mjs:6` `loadGolden`
- `tools/testing/mesh-golden.mjs:19` `goldenFrame`
- `tools/testing/mesh-golden.mjs:27` `goldenRelief`
- `tools/testing/mesh-golden.mjs:36` `loadGoldenMatKeys`
- `tools/validate-content.mjs:643` `validateMeshFiles`
- `tools/vox-export.mjs:144` `collectMaterials`
- `tools/vox-export.mjs:191` `chooseExportMode`
- `tools/vox-export.mjs:296` `exportVoxelModel`
- `tools/vox-export.mjs:313` `loadRealVoxelModels`
- `tools/vox-import.mjs:108` `formatModule`
- `tools/vox-split.mjs:71` `buildSingleModelVox`
- `tools/vox-split.mjs:83` `fingerprintModel`
- `tools/vox-split.mjs:93` `findDuplicates`
- `tools/vox-split.mjs:110` `mapSceneNodesToModels`
- `tools/vox-split.mjs:140` `tightBBox`
- `tools/vox-split.mjs:153` `dominantColors`
- `tools/vox-split.mjs:201` `fitsCurrentLimits`
- `tools/vox-split.mjs:211` `fitsMeshOnly`
- `tools/vox-split.mjs:225` `splitVoxFile`
- `tools/voxAutoMap.js:42` `nearestMaterialKey`
- `tools/voxelize-mesh.mjs:35` `voxelize`

## 2. Stale and transitional comments

Result: there is no `TODO`, `FIXME`, `XXX` or `HACK` marker in `engine/`, `game/`, `tools/` code. The one `XXX` hit, `tools/vox-import.test.mjs:142`, is a data string in a test. The list below is the closest equivalent: comments that describe a past workaround, a "for now" limit, or a legacy path. Items marked **stale** no longer match the code. The rest are live but will go when WG-5 lands.

| # | file:line | Why |
|---|---|---|
| 1 | `engine/world/Terrain.js:15` | **stale**: "castTerrain itself is still a no-op stub (US-016)". `castTerrain` is real now (`engine/render/terrainCaster.js`, cited in `engine/mesh/terrainMesh.js:20` and `engine/render/gpu/glsl/terrain.frag.js:3`). Also says "for now". |
| 2 | `tools/editor/frame.js:1-4` | "US-046 workaround: `createWorldRenderer` doesn't exist yet". Name still has no definition in engine/ game/ tools/. Still accurate only if US-046 is still open. Check backlog. |
| 3 | `engine/index.js:64-67` | **stale history**: "`tools/editor/ray.js` used to hard-code KIND_* as a workaround; it now imports the real constants". Describes a past change, not current behaviour. |
| 4 | `engine/core/assets.js:135-137` | **stale history**: "Replaces the editor's old in-place-replace workaround (`tools/editor/io.js`'s `loadFile`)". |
| 5 | `engine/core/behaviours.js:26` | **stale history**: "Replaces the editor's old workaround (`tools/editor/panel.js`'s ...)". |
| 6 | `tools/editor/io.js:244` | **stale history**: "the editor's old in-place-object-mutation workaround". |
| 7 | `tools/editor/panel.js:40-42` | **stale history**: "US-069 swapped the old pure-content-scan workaround". |
| 8 | `game/js/platform/web.js:124` | "settingsVersion is informational only for now (single version exists)". Live limit, not stale; leave unless a v2 is planned. |
| 9 | `engine/render/gpu/GpuCellPipeline.js:131` | "ME-19a: the legacy opts.renderer value is ignored". Transitional. ME-19 is open (dda passes out). |
| 10 | `engine/render/gpu/GpuCellPipeline.js:382` | "`?gpucompare=shade`'s legacy 'upload' source". WG-5a delete candidate. |
| 11 | `engine/render/gpu/GpuCellPipeline.js:427-441` | legacy `_repackAndUpload` / "US-030b mirror buffers for the legacy 'upload' test source". WG-5a delete candidate. |
| 12 | `engine/render/gpu/GpuCellPipeline.js:1084` | "Test-only (14.2 item 7): forces the legacy 14.1 upload path". WG-5a delete candidate. |
| 13 | `engine/render/gpu/GpuCellPipeline.js:2635` | "Legacy 14.1/US-029 path: test-only now". WG-5a delete candidate. |
| 14 | `engine/render/gpu/GpuCellPipeline.js:2725-2733` | legacy 'upload'/CPU-fed source passthrough. WG-5a delete candidate. |
| 15 | `engine/render/gpu/glsl/shade.frag.js:70` | "rays per axis ... 1 on the legacy 'upload' test source". Frozen GLSL, WG-5a. |
| 16 | `engine/render/gpu/glsl/shade.frag.js:77` | "0 = legacy passthrough". Frozen GLSL, WG-5a. |
| 17 | `engine/render/projection.js:498` | `@deprecated (28.11c) superseded by per-cell mode ... kept for its tests`. Deprecated and test-only (see 1b). Delete with its tests or drop the tag. |
| 18 | `engine/render/shadowSun.js:14` | documents `sun: 'dda'` as "legacy sector/voxel ray march". Still a valid option until ME-19c; the `dda` value goes with WG-5a. |
| 19 | `game/js/main.js:1440` | "back to the legacy `_repackAndUpload` path, harmlessly, in 'demo'/...". Remove when WG-5a deletes the path. |
| 20 | `game/js/main.js:1327` | cites `engine/render/gpu/glsl/sprites.frag.js` as the source of a rule. Breaks when glsl/ is deleted (see section 4). |
| 21 | `game/js/dev/modes/gpucompare.js:40` | "force the legacy CPU-fed G-buffer path for this test" (`setSource('upload')`). Test harness; goes with WG-5a. |
| 22 | `game/js/quest/mapCard.js:56` | "restored/legacy state". Save-compat handling. Keep, check if save versions still need it. |
| 23 | `engine/render/detailShade.js:736` | "the legacy ambient-only shape". Live compat path, keep. |
| 24 | `tools/validate-content.mjs:567, 576` | "`sun` on a level file is deprecated (CO-8)". Live validation rule. Keep. |

Not counted: `tools/typecheck.mjs:48` (npm package named `tsc` is deprecated, a third-party fact) and `tools/capture-cinematic.mjs:138` (`temporary browser profile`, a real message).

## 3. Suites that failed transiently under load

Each suite was also run once now, on an otherwise idle tree:

| Suite | Now | Note |
|---|---|---|
| `engine/render/gpu/wg/passRaster.test.js` | **FAIL 1 of 5 runs** (`heap growth over 20000 frames: 4113720`, threshold 4e6) | Reproduces. Not a load-only flake: the metric is near its threshold. |
| `engine/world/terrainStroke.test.js` | PASS (stroke end 94.3 ms, limit 150) | Cold run is the one asserted; see 3b. |
| `engine/mesh/scatterFeed.test.js` | PASS (retained delta -17,104 bytes, limit 65,536) | Spawns a child with `--expose-gc` (see 3c). |

Summary of causes, most likely first.

### 3a. `engine/render/gpu/wg/passRaster.test.js`: heap-growth check without a forced GC (most likely)

- L153-158: `for 2000` warm-up, then `h0 = process.memoryUsage().heapUsed` at **L154 with no `global.gc()`**, 20,000 `on.run(pp)` calls, `grew` at L156, `assert.ok(grew < 4e6)` at L158.
- The file never sets `--expose-gc` and never calls `gc()`. Garbage left from the warm-up and from JIT tier-up is counted as growth. `scatterFeed.test.js` L198-201 does this right (`global.gc()` before and after).
- Run with `node --expose-gc` the same file passed. Plain runs: 1 fail, 5 pass (6 runs in total).
- The growth is about 4.1 MB over 20,000 frames, roughly 200 bytes per frame. That may be a real small per-frame allocation in `WgRasterPass.run` (the test title says "zero allocation per warm frame"). Check that before raising the threshold.
- Fix options: (1) `global.gc()` at L154 and L156, with the file re-spawning under `--expose-gc` like `scatterFeed.test.js` L25-27; (2) find the per-frame allocation and fix it. No threshold widening (D-039 spirit).
- Same pattern, untested under load: `engine/core/commands.test.js:131-152`, `engine/core/replay.test.js:195-198`, `engine/core/rtsCamera.test.js:131-135`, `engine/core/transform.test.js:252-263`. These are the next candidates for the same flake.

### 3b. `engine/world/terrainStroke.test.js`: wall-clock threshold (likely, load-sensitive)

- L55: `const info = w.refreshTerrainScatter();` is the **first, cold (un-JITted) call**. L56 `info2` is the warm repeat, logged only.
- L59: `ok('stroke end <= 150 ms', info.ms <= 150, ...)` asserts the cold run against a fixed 150 ms wall clock. Under CPU load (other suites, agents, the browser) the cold path can take 2x.
- Fix options: assert on `info2.ms` (warm) or on a relative bound, or move the wall-clock check to a bench (`tools/bench-*`) and keep only the count assertions here.

### 3c. `engine/mesh/scatterFeed.test.js`: child process and GC-based heap check (possible)

- L25-27: if `!global.gc`, the file `spawnSync`s **itself** with `--expose-gc` (`stdio: 'inherit'`). That doubles startup and asset loading (`loadTestAssets`, L175) inside a 60 s runner timeout.
- `tools/run-tests.mjs:124-138`: on timeout the runner `SIGKILL`s only its direct child. The `spawnSync` grandchild (L26) is not killed, so a timed-out run can leave an orphan node process behind, which then adds load to the next suite. Fix in the runner (kill the process tree) or avoid the self-spawn (run with `node --expose-gc` in `run-tests`).
- L198-201: heap delta of 1,000 frames after only 20 warm-up frames (L196). Tier-up of `feedDetail` during the measured window adds code-space and feedback allocation. The threshold (64 KB) is tight for that. Raise the warm-up to ~200 frames before measuring.
- The `Math.random` / time checks: none in this file. Its loops are deterministic.

### 3d. Shared cause

`tools/run-tests.mjs:176-178` runs suites one after another, each under a 60 s timeout (env `KESTREL_TEST_TIMEOUT_MS`). Wall-clock limits (3b) and GC-timing limits (3a, 3c) are the only time-sensitive assertions in these three files. The batch review (`docs/test-reports/batch-review-2026-10-08.md:121`) already noted the same transient failures during agent load. Other suites in the same families have the same heap-delta pattern (3a list) and are the next place to look.

## 4. Frozen GLSL / dda files and GL-only classes (WG-5a delete list)

Source: D-044 (`docs/decisions.md:977-979`): the GLSL shaders, `GpuDeviceWebGL2` and the WebGL2 gate go at WG-5. The backlog row WG-5a (`docs/backlog.md:261`) lists `GpuCellPipeline`, `GpuDeviceGL2`, `glsl/`, `gridTargets`, `glUtil`, the GL parts of `GpuTimer`, `RenderTargetGL` and dda. Sizes are byte counts from `wc -c`.

### 4a. `engine/render/gpu/glsl/`: 20 files, 177,560 bytes total

Delete as a folder. Sorted by size:

| Bytes | File | Note |
|---:|---|---|
| 311 | `glsl/ddaConstants.js` | dda only (imported by `dda.frag.js` and `terrain.frag.js`) |
| 632 | `glsl/cell.vert.js` | imported by `GpuCellPipeline`, `overlayPass`, `spritesPass` |
| 1,560 | `glsl/water.vert.js` | imported by `water.test.js`, `water.wgsl.test.js` |
| 1,733 | `glsl/shadow.frag.js` | `GpuCellPipeline` |
| 1,896 | `glsl/water.frag.js` | `water.test.js`, `water.wgsl.test.js` |
| 2,433 | `glsl/debug.frag.js` | `GpuCellPipeline` |
| 3,214 | `glsl/deriv.frag.js` | `GpuCellPipeline` |
| 5,037 | `glsl/resolve.frag.js` | **blocker**: `wgsl/resolve.wgsl.js:10` and `resolve.wgsl.test.js:7` import `MAX_SUB` |
| 7,532 | `glsl/terrain.vert.js` | **blocker**: `wgsl/terrainRaster.wgsl.test.js:5` |
| 7,536 | `glsl/edge.frag.js` | `GpuCellPipeline`, `TerrainTextures.features.test.js`, `waterComposite.test.js` |
| 7,651 | `glsl/mesh.frag.js` | **blocker**: `wgsl/raster.wgsl.test.js:4` imports `meshFragSrc` |
| 8,011 | `glsl/mesh.vert.js` | `GpuCellPipeline`, `glsl.test.js` |
| 8,402 | `glsl/waterComposite.frag.js` | `waterComposite.test.js`, `waterFlow.test.js` import `WATER_COMPOSITE_FRAG_SRC`; `wgsl/waterComposite.wgsl.js` names glsl/ in a comment only |
| 8,933 | `glsl/sprites.frag.js` | **blocker**: `wgsl/sprites.wgsl.test.js:8`, `sprites.test.js`, `spriteNear.test.js`, `spritesPass.js` |
| 10,650 | `glsl/common.js` | **blocker**: `wg/passShade.js:13` and `wgsl/shade.wgsl.js:24` import `SKY_LUT_N`; `overlayPass.js` imports `GLSL_VERSION`, `PRECISION`; `pitched.pipeline.test.js:12` imports `CELL_RAY_PITCHED` |
| 13,839 | `glsl/voxel.frag.js` | `GpuCellPipeline` |
| 15,449 | `glsl/light.frag.js` | `GpuCellPipeline`, `sunShadowLookup.glsl.test.js` |
| 20,624 | `glsl/dda.frag.js` | dda (ME-19c). `GpuCellPipeline` and `glsl.test.js` |
| 24,706 | `glsl/terrain.frag.js` | dda and terrain; `GpuCellPipeline` |
| 27,411 | `glsl/shade.frag.js` | **blocker**: `wgsl/shade.wgsl.js:23` imports `MAX_SUB`; `sunShadowLookup.glsl.test.js` |

**Before deleting glsl/**: move the live constants (`MAX_SUB`, `SKY_LUT_N`, `CELL_RAY_PITCHED`, `GLSL_VERSION`, `PRECISION`, `meshFragSrc`, `spritesFragSrc`) into `wgsl/` or a shared constants module. The WGSL ports and the render tests import them today. The tests that read GLSL source text (`water.test.js`, `waterComposite.test.js`, `waterFlow.test.js`, `spriteNear.test.js`, `pitched.pipeline.test.js`) need the same move or deletion.

Also edit: `tools/check-deps.mjs:309` lists `engine/render/gpu/glsl/` as a path (remove the line). `game/js/main.js:1327` comments on a glsl file.

### 4b. GL-only classes and modules

| Bytes | File | Status and importers |
|---:|---|---|
| 161,226 | `engine/render/gpu/GpuCellPipeline.js` | GL-only (about 300 GL-name hits by grep). Imports 20+ glsl files, `glUtil`, `gridTargets`, `GpuTimer`, `device/GpuDeviceGL2`. Public: `engine/index.js:120` (`GpuCellPipeline`, `PASS_NAMES`). API change. |
| 22,765 | `engine/render/RenderTargetGL.js` | GL-only. Imported by `engine/render/RenderTarget.js:26` (edit RenderTarget.js too). |
| 16,954 | `engine/render/gpu/device/GpuDeviceGL2.js` | GL-only. Imported by `device/createGpuDevice.js:8` and `GpuCellPipeline.js:62`. |
| 12,373 | `engine/render/gpu/gridTargets.js` | GL-only. Imported by `GpuCellPipeline.js:29` and `RenderTargetGL.js:20`. `wg/targets.js` is a separate WebGPU module (keep). |
| 5,760 | `engine/render/gpu/glUtil.js` | GL helpers. **Not free to delete**: `isSoftwareRenderer` is public (`engine/index.js:121`) and used by `engine/render/RenderTarget.js:28`. Move `isSoftwareRenderer` out first. |
| 8,408 | `engine/render/gpu/overlayPass.js` | GL overlay (RE-07b). Public: `engine/index.js:223` (`GpuOverlayPass`). WebGPU twin exists: `wg/passOverlay.js`. Check the public API before removing. |
| 18,637 | `engine/render/gpu/spritesPass.js` | GL sprites. Public: `engine/index.js:56` (`GpuSpritePass`). WebGPU twin exists: `wg/passSprites.js`. Check the public API before removing. |
| 9,266 | `engine/render/gpu/GpuTimer.js` | **Mixed**: GL `GpuPassTimer` / `GpuTimer` go; the WebGPU timer is `device/WebGpuTimer.js` (keep). Imported by `GpuCellPipeline`, `overlayPass`, `spritesPass`, `GpuDeviceGL2`. |
| 11,918 | `engine/render/gpu/device/GpuDeviceGL2.test.js` | test for the GL device. Delete with it. |
| 7,148 | `engine/render/gpu/gridTargets.test.js` | test for gridTargets. Delete with it. |
| 5,401 | `engine/render/gpu/GpuTimer.test.js` | **mixed** test; keep the WebGPU cases. |
| 23,195 | `engine/render/gpu/glsl.test.js` | GLSL source tests. Delete with glsl/ (after the constants move). |
| 2,440 | `engine/render/gpu/sunShadowLookup.glsl.test.js` | GLSL-source test. Delete with glsl/. |
| 32,911 | `engine/render/gpu/sprites.test.js` | **mixed**: imports `spritesFragSrc` and `spritesPass`. Split. |
| 3,601 | `engine/render/gpu/TerrainTextures.features.test.js` | imports `EDGE_FRAG_SRC` from glsl/. Re-point or delete. |
| 3,795 | `game/js/ui/webgl2Gate.js` | the "WebGL2 required" screen. Replaced by "WebGPU required" (D-044). Edit in WG-5b, not a plain delete. |

Not GL-only (few or no GL-name hits by grep): `VoxelTextures.js` (0), `MeshBuffers.js` (0), `flicker.js` (0), `waterLayer.js` (0), `shadowParity.js` (0), `spritesAtlas.js` (0), `ShadeTextures.js` (1), `WorldTextures.js` (1), `TerrainTextures.js` (2), `device/GpuDevice.js`, `RenderTargetCanvas2D.js`. `createGpuDevice.js` and `RenderTarget.js` are edit-only (they import GL modules).

Summary for WG-5a: delete the 20 files in glsl/ (177,560 bytes), `GpuCellPipeline.js` (161,226), `RenderTargetGL.js` (22,765), `GpuDeviceGL2.js` (16,954), `gridTargets.js` (12,373), `glUtil.js` (5,760 after moving `isSoftwareRenderer`), plus the GL halves of `GpuTimer.js` (9,266), `spritesPass.js` (18,637) and `overlayPass.js` (8,408) after the public-API decision, and their tests. About 430 KB of source in total. Before the delete: move the shared constants out of glsl/, decide the `engine/index.js` public exports (lines 56, 120, 121, 223), and update `tools/check-deps.mjs:309`.
