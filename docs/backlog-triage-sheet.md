# Backlog triage sheet

Generated 2026-10-07 from docs/backlog.md (main session). 287 open story rows (status not done/closed/dropped). Fill the Decision column: keep / drop / archive. Rows protected by decisions D-044/D-045 (WG-*, QUAT-*, PREC-04b*) are active work: keep.

## Duplicate IDs (same ID on several rows): MESH-INST-01 (lines [138, 453]), ED-MESH-01 (lines [140, 469])

## US (128)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| US-026 | Walk out onto the terrain: near LOD, slope physics, chunk regeneration | P0 (M2 | todo | PC-A | 531 | |
| US-027 | JSON content packs and world files | P1 (M2 | split | PC-A | 532 | |
| US-031 | Editor shell + fly-cam + idle re-render skip | P0 (M1 | testing | PC-B | 364 | |
| US-032 | Pick/select/move/delete | P0 (M1 | testing | PC-B | 365 | |
| US-033 | Place props/lights/triggers + property panel + undo | P0 (M1 | testing | PC-B | 366 | |
| US-034 | World JSON save/load + play-test | P0 (M1 | testing | PC-B | 367 | |
| US-035 | Model frame editor | P0 (M5 | todo |  | 598 | |
| US-036 | Animations + events + preview | P0 (M5 | todo |  | 599 | |
| US-037 | ModelDef JSON save/load | P0 (M5 | todo |  | 600 | |
| US-038 | Settings menu (grid 240/320/400/480 per D-025, fullscreen, mouse, mute; remember | P1 (M2 | todo | PC-A | 533 | |
| US-041b | Creature clips (idle/walk) + bear voxel model + design/preview/voxel.html + walk | P0 (be | todo |  | 539 | |
| US-042 | Talking animals + dialogue system (first animal M2, exile dialogue M3) | P1 (M2 | todo |  | 534 | |
| US-043 | Steam release: Electron wrapper + Steamworks + store assets | P0 (M6 | todo |  | 593 | |
| US-046 | Engine-owned frame renderer (createWorldRenderer) | P1 (M1 | todo | PC-A | 363 | |
| US-049 | D-017 pruning of fallback-only render code | P1 | todo |  | 358 | |
| US-051 | Dynamic rigid props: drop, fall, tumble, settle (box/cylinder bodies) (engine st | P0 | todo |  | 547 | |
| US-052 | Pick up, carry, put down, throw (e.g. a branch) (engine + game story) | P0 | todo |  | 548 | |
| US-053 | Particle system: smoke, dust, sparks, splash drops (engine story) | P1 | todo |  | 549 | |
| US-053a | Particle sim core (engine): pooled emitters + particles on the fixed step (rate, | P1 | other | PC-A | 558 | |
| US-053c | Particle presets as data + first placements: burner flame + smoke on the Kestrel | P1 | other |  | 559 | |
| US-053d | Particle presets part 2: splash drops (for US-055b) + motes (US-019 sun-shaft du | P2 | todo | PC-B | 560 | |
| US-054 | Cuttable tree -> trunk log + branches as physics pieces (engine + content story) | P0 | todo |  | 550 | |
| US-055 | Water surface + splash + floating props (engine story) | P1 | todo |  | 551 | |
| US-055a | Water surface render (engine): water regions as world data (sector or terrain re | P1 | todo? | PC-A | 561 | |
| US-055a2c | Water wiring + first visible water: (a) engine/index.js exports resolveWaterLook | P1 | other |  | 562 | |
| US-055b | Wade, swim, splash: player wades (< 0.6 m) / swims (>= 0.6 m), splash particles | P1 | todo | PC-B | 563 | |
| US-063 | Editor v0.1 polish: model picker on prop placement, real per-cell "inside a stru | P1 | testing | PC-B | 371 | |
| US-064 | Editor edit speed: live-patch prop/light move/rotate/on-off instead of World.loa | P1 | testing | PC-B | 372 | |
| US-066 | Editor UI reskin to the Stitch "Retro-Terminal ASCII Studio" layout (ribbon, sce | P1 (M1 | testing | PC-B | 368 | |
| US-067 | Editor asset library (model browser with ASCII thumbnails, click to place) + tre | P2 (M1 | po-review | PC-B | 369 | |
| US-068 | Editor axis gizmo + TOP/FRONT/ISO ortho views | P2 (M5 | todo | PC-A | 370 | |
| US-070a | Ray-traced hard shadows, sun + top-2 point lights (lamp/burner/relay), through s | P1 (M2 | frozen | PC-A | 378 | |
| US-070b | Terrain (kind-7 cells) shows sun shadows cast by placed structures and voxel pro | P1 (M2 | todo | PC-A | 379 | |
| US-070c/d | Terrain self-shadow (hills) + soft shadows (disc-sampled penumbra) - deferred by | P2 (rt | deferred |  | 380 | |
| US-071 | Ray-traced ambient occlusion: a few short rays per cell for soft corner/contact | P2 (M2 | todo | PC-A | 381 | |
| US-072 | One-bounce coloured light: lit walls tint their neighbours (burner orange on sto | P2 (M3 | todo | PC-A | 382 | |
| US-073 | Temporal glyph stability: reuse previous-frame cell results to stop glyph crawl/ | P2 (M2 | other | PC-A | 383 | |
| US-075 | MCP server for the engine (tools/mcp/server.mjs): tools to look (list assets/lev | P1 (af | todo | PC-B | 384 | |
| US-076 | AI chat panel in the editor: chat drives the open editor live through the same c | P2 (af | todo | PC-B | 385 | |
| US-077 | Text-authored mesh shapes: a JSON primitive/kit format (boxes, cylinders, wedges | P1 (me | todo | PC-A | 386 | |
| US-078 | Sword swing + hit detection: as a player I swing a sword with the mouse and it h | P0 | other |  | 608 | |
| US-078b | Engine queries: World.raySegment, raycastColliders, meleeArc.arcHits, overlay se | P0 | other | PC-A | 609 | |
| US-078c | Sword pickup: tower.level.json patch, sword.take, flag tower.sword.taken, carrie | P0 | other | PC-B | 610 | |
| US-078d | Swing sim (light tap + hard hold-release, one motion, D-034; no L/R chain) + hit | P0 | other |  | 611 | |
| US-079 | First enemy with simple AI (Hush-touched beast): as a player I meet a beast that | P0 | todo | PC-A | 612 | |
| US-079a | First beast, brain + nav chase (no damage): a placeholder boar wanders, notices, | P0 | arch-review? | PC-B | 654 | |
| US-079b | Boar HP + hurt + death lifecycle (4 HP, flash/flinch, tip over -> dust -> remove | P0 | arch-review | PC-B | 86 | |
| US-079b0 | Engine seams: components.voxel.hidden skipped by VoxelPool (both collect branche | P0 | arch-review | PC-B | 87 | |
| US-080 | Hearts, damage, death + respawn: as a player I see my hearts, lose them when hit | P0 | todo | PC-B | 613 | |
| US-080a1 | Vitals sim: health, combat:hit listener, falls, invuln, death timeline, respawn | P0 | other | PC-B | 614 | |
| US-080a2 | Vitals view: HP bar (UI layer), hurt edge + kick, death fade + card | P0 | other |  | 615 | |
| US-080b | Mana + HP/MP pickups (= PO 080b) | P0 | other | PC-B | 616 | |
| US-081 | Lock-on / target focus: as a player I hold a key to keep the nearest enemy centr | P1 | todo | PC-A | 617 | |
| US-082 | Combat feel: hit-stop (50-80 ms), knockback, camera kick, enemy flash, hit spark | P1 | todo | PC-B | 618 | |
| US-083 | Character animation state machine (engine): named clip states (idle/walk/run/win | P0 | todo | PC-A | 619 | |
| US-084 | NPC navigation (engine): walkable nav grid over terrain + meshes, A paths, steer | P1 | todo | PC-A | 620 | |
| US-085 | AI behaviour component (engine): data-driven state machine with perception (sigh | P1 | todo | PC-A | 621 | |
| US-086 | Guard / block with a shield (and optional parry window) | P2 | todo | PC-B | 622 | |
| US-087 | Input action map (engine): actions (move/look/attack/interact/lock/use-tool/menu | P1 | todo | PC-A | 623 | |
| US-089 | Save/load runtime: resting at a woken relay saves, autosave on area change, vers | P0 | todo | PC-B | 624 | |
| US-090 | Title/start menu: New game, Continue, 3 save slots (label "Wick - place - play t | P0 | todo | PC-B | 625 | |
| US-091 | Inventory + item data: items as content JSON, equip slots (sword, 2 tool slots), | P0 | todo | PC-B | 626 | |
| US-091a | Loot + inventory data: item defs, player inventory component, boar drop table, w | P0 | todo | PC-B | 88 | |
| US-091a2 | Loot roll at death + corpse [E] Loot boar interactable + toast ("+1 Boar Meat", | P0 | other | PC-B | 89 | |
| US-091b | Inventory screen: I pauses, hands strip + 6x4 ASCII-icon grid + details, assign | P0 | po-review | PC-B | 96 | |
| US-092 | Chests + pickups: small/big chests, open animation, item-get card, hidden chest | P1 | todo | PC-B | 627 | |
| US-093 | First tool item that opens an area = the torch (PO 2026-10-01, D-030 amendment 1 | P0 | todo | PC-A | 628 | |
| US-094 | First small dungeon: 3-5 rooms, one puzzle chain (plate + boulder/lever + light) | P0 | todo | PC-A | 629 | |
| US-095 | Vessels + gear levels (PO 2026-10-01, D-030 amendment 1 Q7): a vessel (4 pieces | P1 | todo | PC-B | 630 | |
| US-096 | Quest system (engine flags/objectives/events, save-safe) + journal page on the c | P1 | todo | PC-A | 631 | |
| US-097 | Chart with live position, woken relays and discovered places (fast travel betwee | P2 | todo | PC-B | 632 | |
| US-098 | Day/night cycle: sun path + sky/ambient colours over a 24 min day, relay and lam | P2 | todo | PC-A | 633 | |
| US-099 | Exile village "Outwall": 3-5 NPCs with idle routines, talk via US-042, first to | P1 | todo | PC-B | 634 | |
| US-100 | Chapter-two region: open area along the pencil line with 3 dead relays, landmark | P0 | todo | PC-A | 635 | |
| US-101 | Artificer's gauntlet + Spark: first spell (light verb: lights braziers/relays, s | P0 | todo | PC-B | 636 | |
| US-102 | Second enemy: stray Crown clockwork sentinel (patrol, ranged, weak spot) | P1 | todo | PC-B | 637 | |
| US-103 | Ranged tool: bow or crossbow with arrows as physics bodies | P1 | todo | PC-A | 638 | |
| US-104 | Secrets + collectibles pass: hidden chests, heart pieces, chart pieces in chapte | P2 | todo | PC-B | 639 | |
| US-105 | The Signal Source dungeon + boss (reason for the SOS, D-013 deferred reveal) | P1 | todo | PC-A | 640 | |
| US-106 | Crash intro: the Kestrel escape and crash as a short in-engine sequence before t | P2 | todo | PC-B | 641 | |
| US-107 | Gamepad support: Steam Deck layout, look curve, UI navigation with the stick, bu | P0 | todo | PC-A | 642 | |
| US-108 | Key remapping row in Settings (keyboard + gamepad), conflicts shown, remembered | P1 | todo | PC-B | 643 | |
| US-109 | Music: procedural/adaptive score (exploration, combat, relay wake stinger, night | P1 | todo | PC-B | 644 | |
| US-110 | Accessibility: cell-size / font scale, colourblind palette variants, toggle vs h | P1 | todo | PC-B | 645 | |
| US-111 | Performance + Steam Deck pass: 60 fps at 240x90 on the Deck, load times, memory | P0 | todo | PC-A | 646 | |
| US-112 | itch.io browser demo build (M1 + walk-out + combat slice), static bundle, page t | P1 | todo | PC-B | 647 | |
| US-113 | Engine API reference generated from JSDoc (ME-00 types) + concept guide + conten | P1 | todo | PC-B | 648 | |
| US-114 | Engine examples: 3 runnable samples in examples/ (lit room, terrain walk, props | P1 | todo | PC-B | 649 | |
| US-115 | Public API freeze: @public/@internal tags, semver 0.x, CHANGELOG, deprecation ru | P1 | todo | PC-A | 650 | |
| US-116 | Licences: engine licence, LICENSE + THIRDPARTYNOTICES (TypeScript devDep, Electr | P1 | todo |  | 651 | |
| US-117 | Standalone engine package (ESM zip/npm, no build step) + engine name | P2 | todo | PC-B | 652 | |
| US-118 | Localisation-ready strings: all UI/hint/dialogue text through one string table, | P2 | todo | PC-B | 653 | |
| US-119 | Trailer tool: camera-path files (design/cinematics/.json: keyframes pos/yaw/pitc | P2 (af | other |  | 387 | |
| US-121 | Look / shader preset library (friend feedback 2026-09-28: "pre-built library of | P2 (me | todo | PC-A | 390 | |
| US-122 | Day/night cycle (friend question 2026-09-28 "can you add directional light, make | P1 (M3 | todo | PC-A | 391 | |
| US-123 | Spot lights (owner 2026-09-28): cone light { dir or yaw/pitch, innerDeg, outerDe | P1 (me | todo | PC-A | 392 | |
| US-124 | Area / strip lights (owner 2026-09-28): rectangle and line lights (windows, glow | P2 (po | todo | PC-A | 393 | |
| US-125 | Emissive materials that light their surroundings (owner 2026-09-28): today emiss | P2 (M3 | todo | PC-A | 394 | |
| US-126 | Light probes / baked indirect light (owner 2026-09-28): offline bake of soft bou | P2 (af | todo | PC-A | 395 | |
| US-127 | Volumetric light shafts / light in fog (owner 2026-09-28): god rays through the | P2 (me | todo | PC-A | 396 | |
| US-128 | Z-targeting: lock on to the nearest visible target, with a ring under it + a bar | P1 | testing? |  | 655 | |
| US-129 | Enemy colour tiers: one beast model in 3 tiers (green / blue / red) via the team | P2 | todo | PC-B | 657 | |
| US-130 | Map exploration: the chart card shows only the areas the player has seen (RE-11 | P1 | todo | PC-B | 658 | |
| US-131 | Overworld minimap (RE-13), optional corner widget with fog from US-130 and a pla | P2 | todo | PC-B | 659 | |
| US-132 | Burning status effect: as a player I can catch fire (and so can enemies and flam | P1 | todo | PC-A | 581 | |
| US-133 | Fire spread (engine sim): flammable materials/props as data (fuel, ignite chance | P1 | other | PC-A | 582 | |
| US-134 | Fire view: burning cells render flame glyphs + emissive + smoke particles, a cap | P1 | todo | PC-A | 583 | |
| US-135 | Fire in the game: a fire test room - torch/burner ignites dry brush, fire spread | P1 | todo | PC-B | 584 | |
| US-137 | Explosion view + content: burst preset (flash, debris, smoke), short-lived flash | P2 | todo | PC-B | 586 | |
| US-139 | Height fog + fog banks (stretch): fog density that varies with height and with d | P2 (st | todo | PC-A | 587 | |
| US-140 | Weather states (stretch): clear / rain / storm / snow as a world state with tran | P3 (st | todo | PC-B | 588 | |
| US-141a | Flow data + scrolling surface (PO 2026-10-02, owner "water, waterfalls, waves"): | P1 | other |  | 564 | |
| US-141b | Currents act: flow pushes the wading/swimming player (same pushX/pushY path as U | P1 | other | PC-A | 565 | |
| US-141b1 | Particle flow (engine fx): def.flow + sampleFlow so water particles drift with t | P1 | todo | PC-A | 566 | |
| US-141b2 | Currents in play (game): flow push via pushX/pushY, water emitters with flow, ri | P1 | todo | PC-B | 567 | |
| US-142a | Waterfall view: a vertical falling sheet (animated glyph columns \/ : ', emissiv | P1 | other | PC-A | 568 | |
| US-142a1 | Waterfall sheet (engine): waterfalls block, sheet mesh in the water layer, sheet | P1 | other |  | 569 | |
| US-142a2 | Waterfall content: preset, lip + foot emitters, plunge pool (flowRadial), ripple | P1 | other |  | 570 | |
| US-142b | Waterfall sound + cave: loud looping roar with distance falloff + pan (cf. US-02 | P2 | todo | PC-B | 571 | |
| US-143a | Wave height field (engine, Node only): waveHeight(x,y,t,preset) = sum of <= 4 se | P1 | other |  | 572 | |
| US-143b | Wave render + shoreline foam: surface visibly rises and falls (shade-pass normal | P1 | other | PC-A | 573 | |
| US-143b1 | Wave displacement (engine): vertex waves on the water mesh, fade, stitch, fragme | P1 | todo | PC-A | 574 | |
| US-143b2 | Wave shading + foam (engine + designer ramps): sun on N, glint, bands, shore + c | P1 | todo | PC-A | 575 | |
| US-143c | Waves in play: floating objects (player swim bob, props after US-051, boat later | P2 | other | PC-B | 576 | |
| US-144a | Underwater view: eye below surface gives blue-green tint + short fog, glyph swap | P1 | other | PC-A | 577 | |
| US-144a1 | Underwater view (engine + designer): under state + hysteresis, fog, tint, glyph | P1 | todo | PC-A | 578 | |
| US-144a2 | Under-fog for sprites + particles (engine): underFogK in the sprite pass and the | P1 | todo | PC-A | 579 | |
| US-144b | Underwater play + sound: muffled low-pass audio, bubble particles on exhale, bre | P2 | todo | PC-B | 580 | |

## ME (26)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ME-06c | Real big trees in walkable forest (owner 2026-09-29: "I want real big trees, as | P1 (me | other |  | 397 | |
| ME-12b | Mesh phase 2: mesh as default - renderer: 'mesh' + physics: 'mesh' default in ga | P1 (sp | todo | PC-A | 398 | |
| ME-13b | Mesh phase 3: .obj (+ .mtl) static-mesh importer - tools/obj-import.mjs -> the s | P2 (ph | todo | PC-B | 399 | |
| ME-14 | Mesh phase 3: content structures[].mesh (Frame + yawDeg), manifest kind mesh, lo | P1 (ph | todo | PC-B | 400 | |
| ME-14c | Mesh render: a DrawItem per placement, resolveMats, KINDMESH moves into GBuffer. | P1 | other |  | 401 | |
| ME-15 | Mesh phase 3: sun shadow map pass + light-pass lookup (replaces the sun DDA), ra | P1 (ph | todo | PC-A | 402 | |
| ME-15b | Sun shadow GPU pass: GpuDevice depthBias + depth-only target, shadow.frag.js, pi | P1 (ph | other | PC-A | 403 | |
| ME-15c | Sun shadow lookup: light pass GLSL + lighting.js twin, LIGHT.w bits 16..18, terr | P1 (ph | other | PC-A | 404 | |
| ME-15d | Sun shadow perf: iGPU p95 bench, per-pass GPU timer, dirty-skip re-render key (2 | P1 (ph | other |  | 405 | |
| ME-15f | Shadow pass: instanced tree groups cast sun shadows by distance - LOD0 within 25 | P0 | todo | PC-B | 127 | |
| ME-15h | Shadow CPU cost: shadowCpuMs p95 0.6-0.7 ms vs the 0.15 ms bar, paid every frame | P2 | todo | PC-A | 128 | |
| ME-16 | Mesh phase 3: point-light cube shadow maps for the top-2 lights, carried-lamp re | P1 (ph | todo | PC-A | 408 | |
| ME-17 | Mesh phase 3: culling + terrain LOD rings + front-to-back + ?bench=1 at 240x90/3 | P1 (ph | todo | PC-A | 409 | |
| ME-18 | Mesh phase 3: editor on meshes (pick via GI.w objectId readback, mesh structure | P2 (ph | todo | PC-B | 410 | |
| ME-19 | Mesh phase 3: delete the old renderers (sectorCaster/terrainCaster/voxelMarch re | P1 (ph | other |  | 411 | |
| ME-19c | [D-044: stays, shrinks the WGSL port surface; ME-19c..f before WG-2a ideally] GP | P1 | todo | PC-A | 412 | |
| ME-19d | Shear camera out (projection.js, cellRayP/uProjMode, shear branches; keep the de | P1 | todo | PC-A | 413 | |
| ME-19e | LVIS out - 37.13.2 | P2 | todo | PC-A | 414 | |
| ME-19f | check-deps rule 9 FAIL-on-increase vs baseline, docs historical, AGENTS/README/C | P1 | todo | PC-B | 415 | |
| ME-20 | Mesh phase 3: US-071 re-scoped - horizon AO over the G-buffer (light pass + JS t | P2 (ph | todo | PC-B | 416 | |
| ME-21 | Mesh phase 3: proof content - 2-storey glTF building on the hillside with door + | P1 (ph | todo | PC-A | 417 | |
| ME-22 | Large voxel models (mesh-only) (owner 2026-09-30: "can I import bigger vox files | P1 | other | PC-B | 418 | |
| ME-30 | [CLOSED D-044 -> WG-1a/1b1/1b2] Phase 4 WebGPU: GpuDeviceWebGPU.js + self-test ( | P2 (ph | todo | PC-A | 419 | |
| ME-31 | [CLOSED D-044 -> WG-2a..WG-3f] Phase 4 WebGPU: WGSL ports of raster + cell passe | P2 (ph | todo | PC-A | 420 | |
| ME-32 | [CLOSED D-044 -> WG-1c2] Phase 4 WebGPU: runtime backend pick (backend: 'auto'\/ | P2 (ph | todo | PC-B | 421 | |
| ME-33 | [CLOSED D-044 -> WG-3a..3f parity gates] Phase 4 WebGPU: cross-backend parity ?g | P2 (ph | todo | PC-A | 422 | |

## WG (21)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| WG-1a | WebGPU probe + capture flags (first WebGPU story, needs no render knowledge) | P0 | arch-review? | PC-B | 428 | |
| WG-1b1 | Device shape | P0 | po-review? | PC-B | 429 | |
| WG-1b2 | GpuDeviceWebGPU | P0 | arch-review | PC-B | 430 | |
| WG-1b3 | GPU timer: timestamp-query in GpuDeviceWebGPU | P0 | todo | PC-B | 456 | |
| WG-1c1 | WebGPU present | P0 | po-review? | PC-B | 431 | |
| WG-1c2 | Backend switch | P0 | arch-review | PC-A | 432 | |
| WG-2a | Pipeline skeleton | P0 | arch-review? | PC-B | 433 | |
| WG-2a-b | The 4 small ARCH CHANGES of WG-2a (architecture.md 38.8a item 20) | P0 | todo | PC-B | 465 | |
| WG-2b | Mesh raster | P0 | handed | PC-B | 434 | |
| WG-2c | Terrain + voxel-part raster | P0 | handed | PC-B | 435 | |
| WG-3a | Resolve + deriv | P0 | todo | PC-B | 436 | |
| WG-3b | Light | P0 | todo | PC-B | 437 | |
| WG-3c | Shade + edge | P0 | todo | PC-B | 438 | |
| WG-3d | Sun shadow map | P0 | todo | PC-B | 439 | |
| WG-3e | Water | P1 | todo | PC-B | 440 | |
| WG-3f | Sprites + overlay | P0 | todo | PC-B | 441 | |
| WG-4a | Compute cull | P0 | todo | PC-B | 442 | |
| WG-4b | Shadow-caster cull + LOD dither | P0 | todo | PC-B | 443 | |
| WG-4c | Gate: full-detail walk | P0 | todo | PC-A | 444 | |
| WG-5a | Delete WebGL2 | P1 | todo | PC-B | 445 | |
| WG-5b | "WebGPU required" gate | P1 | todo | PC-B | 446 | |

## MESH (16)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| MESH-BIN-01 | Binary mesh format / packing per architecture.md 37.19 | P2 | todo | PC-B | 474 | |
| MESH-FULL-01 | Finish full-detail Quaternius import (owner 2026-10-07: ORIGINAL detail, no simp | P0 | needs | PC-B | 447 | |
| MESH-GPU-01 | Draw mesh structures (imported glTF, kind 9) in the GPU path [2026-10-07 PC-A ma | P1 | todo |  | 129 | |
| MESH-GPUCMP-01 | [D-044: STAYS, PC-B implements architecture.md 37.1 A6 (GLSL kind-9 smooth-norma | P1 | arch-review? | PC-B | 134 | |
| MESH-INST-01 | Instanced draws for repeated meshes (owner: "we will have a lot"). The same mesh | P1 | todo |  | 138 | |
| MESH-INST-01 | CPU-side instance batching only (no new GLSL, D-044 freeze) | P1 | todo | PC-B | 453 | |
| MESH-LOAD-01 | Lighter mesh files and lazy loading (the 12 placed meshes were 16 MB of canonica | P2 | todo |  | 139 | |
| MESH-LOD-01 | Mesh LODs + distance cut (how Unity/Unreal do it). The importer writes lods: [{t | P1 | todo |  | 137 | |
| MESH-PERF-01 | Arc "before" numbers: full-detail mesh perf baseline (F3 p95, draw count, render | P1 | todo | PC-A | 473 | |
| MESH-PHYS-01 | Cheap physics for placed meshes (owner 2026-10-07: physics must get better, cut | P0 | testing? |  | 130 | |
| MESH-PHYS-02 | Physics cost pass for the whole step (owner 2026-10-07). Profile one fixed step | P1 | testing? |  | 135 | |
| MESH-PHYS-DEFAULT | Mesh physics is the default whenever the mesh renderer runs (architect 2026-10-0 | P0 | needs |  | 120 | |
| MESH-SHADOW-01 | Per-mesh shadow flag + budget: castShadow: false on small pieces (pebbles, stepp | P1 | testing? |  | 133 | |
| MESH-SHADOW-02 | Shadow caster budget: distance cut-off + cap, ~50-70 % fewer shadow tris (37.19 | P1 | todo | PC-B | 452 | |
| MESH-SIMP-01 | Tests + docs for the mesh simplifier, then simplify the rest (owner 2026-10-07: | P1 | owner | PC-B | 131 | |
| MESH-UVMAP-01 | Per-triangle palette materials from the glTF colour texture (owner 2026-10-07: " | P2 | owner |  | 132 | |

## PX (9)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| PX-01 | Output-mode switch createEngine({ output: 'ascii' \/ 'pixel' }), ?output= overri | P2 | todo | PC-A | 518 | |
| PX-02 | Full-resolution targets decoupled from the cell grid - G-buffer at canvas px x r | P2 | todo | PC-A | 519 | |
| PX-03 | Pixel shading pass - material base colour from MaterialTable/palette ramps, sun | P2 | todo | PC-A | 520 | |
| PX-04 | Pixel-mode oracle - pixelShadeJS computes colour at a fixed sample lattice (ever | P2 | todo | PC-B | 521 | |
| PX-05a | Voxel AO bake - voxelMesh.js per-vertex corner AO (3-neighbour rule) stored in t | P2 | todo | PC-B | 522 | |
| PX-05b | Voxel look - per-voxel flat shading, world-anchored per-voxel colour jitter (has | P2 | todo | PC-A | 523 | |
| PX-06 | Post - distance fog (same curve as ASCII), tonemap + exposure uniform, optional | P2 | todo | PC-A | 524 | |
| PX-07 | UI and overlays in both modes - HUD/text layer (CellBuffer at its own cols/rows) | P2 | todo | PC-A | 525 | |
| PX-08 | Pixel-mode budget + owner look page - bench poses at 1920x1080, renderScale 1.0/ | P2 (ep | todo | PC-A | 526 | |

## ENV (8)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ENV-01a | Ground detail scatter: engine + data (rocks, grass tufts, bushes, flowers, falle | P0 | todo | PC-B | 104 | |
| ENV-01a2 | Ground detail: draw feed (engine/mesh/scatterFeed.js, instance cap 4096, group c | P0 | other |  | 105 | |
| ENV-01b | Ground detail: content, tuning + owner look | P0 | todo | PC-A | 108 | |
| ENV-01c | Ground detail Arc bench vs 37.4 perf bars | P1 | todo | PC-A | 107 | |
| ENV-01d | Ground detail models (rocks 3x2, tall tufts, flowers 3 colours, fern, mushrooms, | P0 | design |  | 106 | |
| ENV-02 | Tower "Awakening" dressing pass | P0 | design |  | 109 | |
| ENV-03 | Forest in the game (= ME-06c3, reference only) | P0 | other | PC-B | 110 | |
| ENV-04 | First clip "The Awakening": readiness checklist | P1 | waits | PC-A | 111 | |

## BUG (8)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| BUG-BENCH-01 | node tools/capture-browser.mjs --mode bench --variant world never produces windo | P1 | todo | PC-B | 124 | |
| BUG-COORD-001 | Coordinates: light occlusion ignores the structure frame - (a) computeVisGrid/ce | P2 (la | other |  | 373 | |
| BUG-GONDOLA-FALL | Fell into the gondola, then out of the world (owner walk-test 2026-10-06, F3: wo | P0 | other |  | 144 | |
| BUG-GONDOLA-FALL-b | Fix ARCH CHANGES: test must run <= 5 s with the --full flag; fix wording | P1 | todo | PC-B | 454 | |
| BUG-LAMP-COLLIDE-02 | The pick-up wall lamp (lantern, interactable) is still walk-through (PC-A 2026-1 | P2 | testing? |  | 136 | |
| BUG-PERF-001 | JS spikes left after US-018 (owner real GPU 320x120, 2026-09-25): (a) ground flo | todo ( | other |  | 324 | |
| BUG-RTS-002 | game/rts-test.html throws in World.load ("references unknown model") before rend | P1 | other | PC-B | 406 | |
| BUG-WAYSTONE-CAM | voxel-props.html check (found 2026-10-06 once the page stopped crashing): the en | P3 | todo | PC-A | 150 | |

## ART (7)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ART-01 | Hemisphere ambient + evening shadow tint (ART-REF-01 top 1, owner liked the art | P1 | arch-review? |  | 145 | |
| ART-02 | Saturated outdoor palette + material remap (ART-REF-01 top 2): add the proposed | P1 | todo | PC-A | 146 | |
| ART-03 | Warm distance haze with a cap (ART-REF-01 top 3): haze colour near hazeWarm #efe | P1 | todo |  | 147 | |
| ART-04 | Day + evening sky gradients and a cloud layer (ART-REF-01 top 4): day #1c95e0 to | P2 | arch-review? |  | 148 | |
| ART-05 | New glyph sets + house depth (ART-REF-01 top 5): crownClump, bladeFace (swaying | P2 | todo | PC-A | 149 | |
| ART-MESH-MATS | Material review for imported meshes (PC-A designer, opus): rocksoft (new, design | P2 | todo | PC-A | 141 | |
| ART-REF-01 | ASCII mockups of the owner's two reference images (stylized autumn meadow; warm | P2 | todo | PC-A | 125 | |

## ALPHA (7)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ALPHA-01a | Import + formats: tools/png.mjs, gltf.js alpha (MASK ranges opaque-first, uvMask | P1 | arch-review | PC-B | 1549 | |
| ALPHA-01b | MaskAtlas (R8UI, exact texel rule), registry kind mask, MeshDrawCache maskRanges | P1 | todo | PC-B | 1550 | |
| ALPHA-01b-note | ALPHA-01b JS side is queued (row ALPHA-01b: rasterJS discard + two-sided flip + | - | other |  | 466 | |
| ALPHA-01c | [FROZEN D-044: ported in WG-2b; keep 01a/01b JS side] GPU twin: aUVMask loc 10, | P1 | todo | PC-A | 1551 | |
| ALPHA-01d | [FROZEN D-044: ported in WG-3c; no GLSL] Soft foliage edges: material edge: 'sof | P1 | todo | PC-B | 1552 | |
| ALPHA-01e | Content + LOD1: Quaternius trees / bushes / rocks / pebbles / paths / mushrooms | P1 | todo | PC-B | 1553 | |
| ALPHA-01f | Arc bench forestWalk trees on/off x shadows, lodCells sweep; absorbs TREES-LP-e | P1 | todo | PC-A | 1554 | |

## PREC (6)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| PREC-01 | [D-044: fold into the WGSL port (WG-2b/3c); no GLSL fix] Forest instance precisi | P2 | todo |  | 117 | |
| PREC-02 | [D-044: fold into the WGSL port] Ruins kind-9 parapetSky equal-key shade cells ( | P2 | todo |  | 118 | |
| PREC-03 | [D-044: fold into the WGSL port] Scene AO mismatches: sword pitched pose kind-1 | P2 | todo |  | 119 | |
| PREC-04 | gpucompare harness tie rule (architecture.md 37.1 A8, D-045) | P0 | arch-review | PC-A | 448 | |
| PREC-04b | gpucompare: 9 rows need an architect decision after PREC-04 | P0 | arch-review | PC-A | 462 | |
| PREC-04b2 | A9 items 4+5 (architecture.md 37.1 A9): texel/tone-key tie rule, capped at max(1 | P0 | todo | PC-B | 464 | |

## OWN (6)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| OWN-REQ-002 | Terrain needs more resolution and detail (owner, 2026-09-24, after US-016): the | P1 | todo |  | 320 | |
| OWN-REQ-004 | Content data files strategy (owner, 2026-09-25): decide how levels, entity/prop | P1 | other | PC-A | 321 | |
| OWN-REQ-005 | MagicaVoxel .vox importer (owner, 2026-09-25): typing voxel layers as text is fi | P1 | testing |  | 322 | |
| OWN-REQ-007 | Grid range: drop 160x60 for players, allow bigger than 320x120 (owner, 2026-09-2 | P1 | other | PC-A | 323 | |
| OWN-REQ-008 | Voxel by default for everything solid (owner, 2026-09-25): 'fireplace should be | P1 | todo | PC-A | 325 | |
| OWN-REQ-009 | Model storage format (proposal, extends D-023) (owner OK to propose, 2026-09-25) | P2 | todo | PC-A | 326 | |

## HANDS (5)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| HANDS-01 | Two hand slots: LMB left / RMB right (tap/hold), sword in either hand (mirrored) | P0 | todo | PC-B | 90 | |
| HANDS-01a | View-model mirror (setHand/handOf, authored hand, det<0 winding flip in both twi | P0 | po-review? | PC-B | 91 | |
| HANDS-01b | Mouse2 + context-menu block, hands router, sword in either hand, inventory shape | P0 | arch-review? | PC-B | 92 | |
| HANDS-01c | Spell-hand idle view + gpucompare pose handsSwapped | P0 | owner | PC-B | 93 | |
| HANDS-01c-b | Add dLSample dump in gpuCompare compareLight; then record handsSwapped as a D-03 | P2 | todo | PC-B | 455 | |

## ED (5)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ED-GROUP-1 | Editor: group items (owner 2026-10-04: "how can I group items") - multi-select ( | P2 | todo |  | 152 | |
| ED-MESH-01 | Editor: place imported meshes (owner 2026-10-07: "i havent find the new models i | P1 | todo |  | 140 | |
| ED-MESH-01 | Editor mesh structures | P1 | todo | PC-B | 469 | |
| ED-PLACE-BUG | Editor: placing an Assets-tab model does not work for the owner (owner 2026-10-0 | P1 | other |  | 151 | |
| ED-TERRAIN-1 | Editor: terrain editing (owner 2026-10-04: "how can I edit the terrain?") - toda | P2 | todo |  | 153 | |

## TREES (5)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| TREES-LP-a | Low-poly tree generator: buildMeshFromTris extracted from gltf.js, tools/treeGen | P1 | arch-review | PC-B | 1539 | |
| TREES-LP-b | Instanced kind-9 mesh groups (InstanceGroups.meshGroup, meshDraw arg, shadow bra | P1 | todo | PC-B | 1540 | |
| TREES-LP-c | Forest species mesh: key (validator, world.scatterMeshes, bindScatterInstances), | P1 | todo | PC-B | 1541 | |
| TREES-LP-d | Designer: low-poly oak/birch/pine x 2 sizes params + meshes + design/preview/tre | P1 | todo | PC-A | 1542 | |
| TREES-LP-e | Arc bench forestWalk trees on/off x shadows (tree half of ENV-01c) (37.15 item 8 | P1 | todo | PC-A | 1543 | |

## CO (3)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| CO-4 | Coordinates: rotateLevel + yawSteps 1..3 | P2 | deferred | PC-A | 374 | |
| CO-6 | Coordinates: terrain chunk/cell helpers | P1 | todo | PC-A | 376 | |
| CO-8 | Coordinates: content/game/tools cleanup (sun into worldm1, recipe placement dupl | P1 (sp | other |  | 377 | |

## QUAT (3)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| QUAT-GROUND-01 | Ground scatter: GrassCommon/Wispy Short/Tall, Flower3/4 (group+single), BushComm | P1 | todo | PC-B | 451 | |
| QUAT-LOD-01 | LOD1 for CommonTree1-5 / Pine1-5 / TwistedTree1-5 | P1 | todo | PC-B | 470 | |
| QUAT-TREES-01 | Place CommonTree1-5 / Pine1-5 / TwistedTree1-5 at full detail as forest trees; h | P1 | todo | PC-B | 450 | |

## SPELL (2)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| SPELL-01a | Fireball sim: cast (tap 5 MP / hold 10 MP), swept projectile, US-136 explosion d | P0 | testing? | PC-B | 94 | |
| SPELL-01b | Fireball view: flame sprite + trail + moving light, spell-hand clips, burst + fl | P0 | owner | PC-B | 95 | |

## TORCH (2)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| TORCH-01a | View-model: up to 4 held items with own handles/poses (hide/capture/setBob(h)), | P1 | arch-review | PC-B | 114 | |
| TORCH-01b | Torch to pick up, held in the RIGHT hand (owner 2026-10-04: replaces the pick-up | P1 | todo | PC-B | 115 | |

## TOWER (2)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| TOWER-BOULDER-01 | Remove the tower boulder (owner 2026-10-05: "what is that ball skiing around the | P2 | other |  | 123 | |
| TOWER-LEVER-01 | Remove the lever and the grate it opens (owner 2026-10-04: "we don't need them") | P0 | testing |  | 116 | |

## UI (2)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| UI-PLATE-01 | White plate behind UI text: audit undefined/invalid bg | P1 | todo | PC-B | 468 | |
| UI-XHAIR-01 | Crosshair: bigger, transparent background (owner 2026-10-05: "crosshair looks ba | P1 | other |  | 122 | |

## OWNER (2)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| OWNER-LOOK-ROADSOUTH | Owner look at ?pose=roadSouth, full detail (kind-9 edge noise) | P1 | todo | PC-A | 463 | |
| OWNER-WALK-FIXES | Triage checklist of owner walk-test findings | P1 | todo | PC-B | 471 | |

## VOX (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| VOX-CAP-01 | Mesh path draws up to 48 voxel entities (MAXVOXINSTANCESMESH), dda stays 16 with | P0 | other |  | 112 | |

## DECAL (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| DECAL-01 | Wall scrawl/decals drawn (architecture.md 37.6): derived load data, lit depth-te | P0 | arch-review | PC-B | 113 | |

## PROP (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| PROP-COLLIDE-01 | Props have no collision (owner walk-test 2026-10-04: "I can go through items in | {type: | arch-review? | PC-B | 121 | |

## READ (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| READ-01 | Readable notes (owner 2026-10-05, replaces wall writing: "it should be a documen | P0 | other |  | 126 | |

## ROAD (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| ROAD-DECOR-01 | Dress both sides of the walk-out road with meshes (owner look-dev): after ED-MES | P2 | todo | PC-B | 142 | |

## CLOTH (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| CLOTH-DRAPE-01 | Stairwell balloon drape as a real cloth (owner 2026-10-06: the billboard drape " | P1 | owner | PC-B | 143 | |

## RE (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| RE-15d | RE-15 binding bench: rts-test.html?bench=1 raster delta <= 0.44 ms on the iGPU, | P1 | todo | PC-A | 407 | |

## TEST (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| TEST-GAPS-WG | Test gaps from WG-1c1/1c2 | P2 | todo | PC-B | 457 | |

## DIAG (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| DIAG-SWIFTSHADER | Why the full game page crashes under --swiftshader --backend webgpu | P2 | todo | PC-B | 458 | |

## EDITOR (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| EDITOR-LOAD-01 | Editor index.html stayed on "(loading...)" ~10 s, no console output, until the m | P2 | todo | PC-B | 459 | |

## EP (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| EP-DESKTOP-SPIKE | Electron wrapper spike (report only, no engine change) | P2 | todo | PC-B | 460 | |

## BACKLOG (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| BACKLOG-TRIAGE | Triage ~316 open-looking rows (413 KB; janitor archived only 12 with a strict "d | P2 | todo | PC-B | 461 | |

## LICENCE (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| LICENCE-AUDIT-01 | Audit every third-party asset in the repo | P1 | todo | PC-B | 467 | |

## QUEUE (1)

| ID | Title | Pri | Status | Tag | Line | Decision |
|---|---|---|---|---|---|---|
| QUEUE NOTE | WG-1c2 onward: PC-B must NOT start any WG row now - PC-A is implementing WG step | - | other |  | 472 | |
