/*
 * ASCII Quest - world terrain recipe (US-016 far view, US-016b near LOD + handover), design data v2
 * Owner: Designer. Companion: design/levels/overworld_far.md. Preview: design/preview/overworld.html
 * Plain script: sets ASSETS.levels.overworld_far. Promoted to the WORLD TERRAIN RECIPE by D-007/D-008.
 *
 * UNITS / FRAME: metres. x grows EAST, y grows SOUTH, z up = metres relative to the tower ground floor.
 * One world frame (D-007): the Hollow Watchtower level is placed with its (0,0) at world (1480, 1018).
 *
 * THE CONTRACT (US-016b a): util.heightAt(x, y) and util.typeAt(x, y) are analytic functions of any
 * real (x, y). They do not depend on a grid or sample spacing, so the 2 m near LOD, the 8 m far grid
 * and physics all read the same surface. heightAt is continuous everywhere (C0; smooth except the
 * linear structure handover). typeAt is a pure function of the position (slope uses a fixed 2 m
 * central difference of heightAt, independent of the caller's spacing).
 * util.generate() bakes the 8 m far grid from those functions (reference; the engine may port it).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.levels = A.levels || {};

  // TREES-DEFAULT-01 (owner 2026-10-09): the Quaternius mesh trees (CommonTree_1-5 + Pine_1-5; weights/trunkR/trunkH from the
  // ALPHA-01e prepared list: trunkR = bark radius at z 0.4..1.4, trunkH = lowest leaf card) are the DEFAULT forest species.
  // The six voxel species stay as data in `trees.speciesVoxel`; game/js/main.js swaps them in for `?trees=voxel` (dev fallback).
  // This file reads no URL flag (pure data). TREE-LODCELLS-01: lodCells 150 per mesh species; voxel species keep cfg.lodCells.
  var TREE_SPECIES_VOXEL = [
    // FOLIAGE-SWAY-01: all six are real trees (foliage) - sway: true. No rocks/stones in this list.
    { model: 'forestOakSmall',   weight: 22, trunkR: 0.53, trunkH: 2.55, sway: true },   // 7.20 m (raw import, owner 2026-10-04)
    { model: 'forestOakLarge',   weight: 18, trunkR: 0.63, trunkH: 3.06, sway: true },   // 8.64 m (raw import, owner 2026-10-04)
    { model: 'forestBirchSmall', weight: 15, trunkR: 0.39, trunkH: 2.70, sway: true },   // 6.00 m (raw import, owner 2026-10-04)
    { model: 'forestBirchLarge', weight: 10, trunkR: 0.47, trunkH: 3.24, sway: true },   // 7.20 m (raw import, owner 2026-10-04)
    { model: 'forestPineSmall',  weight: 20, trunkR: 0.34, trunkH: 1.50, sway: true },   // 6.00 m (raw import, owner 2026-10-04)
    { model: 'forestPineLarge',  weight: 15, trunkR: 0.41, trunkH: 1.80, sway: true }    // 7.20 m (raw import, owner 2026-10-04)
  ];
  // OB-089 (owner 2026-10-13, 'LOD for dark trees should be closer'): was 150 = LOD1 from ~9 m (rows 100, R 7.7 m: d = R*1.73*rows/lodCells). 50 holds the lit LOD0 to ~27 m.
  var TREE_LODCELLS = 50;
  // PERF-R2 (D-075 step 3): per-species lodCells so LOD1 engages at ~15-20 m (was ~27 m for all). d = R*1.73*rows/lodCells, so heavier
  // meshes switch earlier: LOD0 tris >= 5000 -> 90, 3500..5000 -> 80, < 3500 -> 70, Pine_5 (1.6k tris) 60.
  // mesh-tri-budget sweep (lodCells 50 -> 80): forestWalk 184k -> 174k tris, roadSouth 20.0k -> 17.8k tris (all-LOD0 63.6k).
  // TwistedTree (~300) has no content mesh yet; add it to this table when it lands.
  var TREE_LODCELLS_BY_MESH = { CommonTree_1: 90, CommonTree_2: 90, CommonTree_3: 70, CommonTree_4: 80, CommonTree_5: 70,
                                Pine_1: 80, Pine_2: 80, Pine_3: 90, Pine_4: 80, Pine_5: 60 };
  var TREE_SPECIES_MESH = (function () {
  var out = [];
  [[14, 0.5, 2.3], [14, 0.5, 2.8], [12, 0.5, 2.5], [10, 0.5, 5.0], [10, 0.45, 2.3]].forEach(function (t, i) {
    out.push({ mesh: 'quaternius/CommonTree_' + (i + 1), weight: t[0], trunkR: t[1], trunkH: t[2], sway: true, lodCells: TREE_LODCELLS_BY_MESH['CommonTree_' + (i + 1)], impostor: i < 3 }); // R6d: impostor = card-impostor opt-in (3 most common species by weight)
  });
  [[10, 0.45, 2.1], [10, 0.45, 1.1], [8, 0.45, 3.0], [6, 0.45, 2.4], [6, 0.35, 1.4]].forEach(function (t, i) {
    out.push({ mesh: 'quaternius/Pine_' + (i + 1), weight: t[0], trunkR: t[1], trunkH: t[2], sway: true, lodCells: TREE_LODCELLS_BY_MESH['Pine_' + (i + 1)] });
  });
  return out;
  })();


  var DEF = {
    name: 'overworld_far',
    version: 2,
    map: { x0: 0, y0: 0, w: 256, h: 256, cell: 8 },                 // FAR grid: 2048 m x 2048 m, baked once
    chunk: { size: 128, nearCell: 2, note: 'D-007: 64x64 near cells of 2 m = 128 m chunks; 3x3 resident' },
    seed: 7331,

    tower:  { x: 1496.5, y: 1024.5, note: 'our Hollow Watchtower centre (level 16.5, 6.5)' },
    breach: { x: 1486.5, y: 1025.0, z: 7.6, yaw: 270, note: 'eye at the breach: level (6.5, 7.0), walkway 6.0 + eye 1.6, looking W' },

    // ---- terrain recipe (heights in m). All terms are smooth functions of (x, y). ----
    recipe: {
      home:    { top: 2.4, drop: 70, radius: 300, note: 'our hilltop, falls ~70 m into the land' },
      hill2:   { height: 58, radius: 170, note: 'hill crown under the far tower' },
      rolling: { scale: 520, octaves: 5, gain: 0.5, lacunarity: 2, amp: 34, flatNearHome: 150, flatNearTower2: 120 },
      river:   { base: 1120, a1: 110, p1: 260, a2: 45, p2: 95, ph2: 1.3, halfWidth: 9.5, bankRock: { ring: 5, slope: 0.9 }, carve: 2.0, carveEdge: [14, 8],
                 note: 'x_r(y) = base + a1 sin(y/p1) + a2 sin(y/p2 + ph2). Bed carved smoothly: carve * smoothstep(|x-x_r| 14 -> 8 m); water where |x-x_r| < halfWidth',
                 // RIVER-04 (arch 38.45 resolution): the recipe valley RISES ~3 m downstream of the ford inside the keep (where the MAP-04 layer is
                 // branched out), so a falling river could not lie on it. bedLine = a monotone channel: h = min(h, bed(y) + lift + bank * max(0, |x-x_r| - flatW)),
                 // bed linear in y between pts, lift 0 inside and `lift` m at both ends over `ramp` m (continuous, carve-only). Starts south of the ford
                 // stone lane (y 1069.6): ford, stones and every authored structure (all at y <= 1088, |dr| >= 13.8 m there) keep their ground.
                 bedLine: { pts: [[1060, -90.15], [1072, -90.2], [1088, -90.54], [1100, -90.6], [1350, -91.0], [1376, -91.1], [1420, -91.3]], flatW: 8, bank: 0.45, ramp: 8, lift: 50, reach: 40 } },
      valley:  { depth: 22, width: 160 },
      ridge:   { height: 30, x0: 700, x1: 150, scale: 300 },
      path:    { halfWidth: 3.0, points: [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]] },
      forest:  { scale: 280, octaves: 3, threshold: 0.55, maxSlope: 0.5, riverClear: 30, pathClear: 12, homeClear: 110, canopy: 10,
                 // ME-06c (architecture.md 37.2 item 7): real trees in the near band (realTrees: renderer=mesh + physics=mesh).
                 // Models = design/models/forest_trees.js (load after sb_objects.js). trunkR / trunkH are MEASURED there
                 // (ASSETS.forestTrees.variants; preview/forest.html checks these literals against it). trunkR = inscribed
                 // radius of the 8-gon prism (circumradius = trunkR / cos 22.5). Gap rule (item 4):
                 // cellM - 2 * jitter = 3.5 >= 2 * (0.95 / 0.9239) + 1.2 = 3.26 (largest = forestOakLarge).
                 // cellM 6.5 (not 6): the large oak's chunky voxel trunk needs trunkR 0.95.
                 trees: {
                   seed: 7349, cellM: 6.5, jitter: 1.5, fill: 0.72, maxTrees: 1500, lodCells: 6,
                   maxDistM: 140, // OB-089: beyond this the far-terrain forest tint (bands.near 150) stands for trees; no navy silhouettes in front of it
                   species: TREE_SPECIES_MESH, speciesVoxel: TREE_SPECIES_VOXEL
                 } },
      rock:    { slope: 0.42, scale: 90, threshold: 0.78, minHomeDist: 60 },
      // ENV-01 (architecture.md 37.4 item 2): ground detail scatter in the near band (detail: renderer=mesh + physics=mesh,
      // ?detail=0 off). Models = design/models/ground_detail.js (ENV-01d). Collider literals are MEASURED there
      // (ASSETS.groundDetail.variants; preview/ground-detail.html checks these literals against it). prism r = inscribed
      // radius of the 8-gon (circumradius r / cos 22.5), h = standing top above z = ground - sinkM; box = half sizes.
      // Gap rule for collider species (rocks layer only): cellM - 2 * jitter = 11 - 6 = 5.0 >= 2 * 1.47 + 1.2 = 4.14
      // (largest = logLong, box half-diagonal hypot(1.43, 0.33) = 1.47; rockLargeB circumradius 1.10 / 0.9239 = 1.19).
      // Water / path have no species (the walk-out path is type path, halfWidth 3, + clearM). Flag + doors are inside the
      // tower bbox (structClearM covers them). Expected near-band counts (384 m band, ~all land): tufts ~13k,
      // shrubs ~2.9k, rocks ~0.6k = ~16.5k <= maxPlacements; fed per frame (full drawM discs) ~240 + ~130 + ~65 <= maxDraw.
      detail: {
        tileM: 16, maxDraw: 768, refeedM: 4, maxPlacements: 40000, structClearM: 2, entityClearM: 1.5,
        exclude: [
          { shape: 'capsule', ax: 1479, ay: 1025, bx: 1420, by: 1032, r: 4.5 },   // walk-out: tower west foot -> path bend (path halfWidth 3 + 1.5 m verge)
          { shape: 'capsule', ax: 1420, ay: 1032, bx: 1428, by: 1040, r: 3.5 },   // path bend -> waystone
          { shape: 'disc', x: 1428, y: 1040, r: 4.5 },                            // waystone + end trigger (r 2.5) + walkTo (1429.86, 1038.33)
          { shape: 'capsule', ax: 1461, ay: 1031, bx: 1444, by: 1035, r: 4 },     // boar route (boar1 -> boar2 homes)
          { shape: 'disc', x: 1478, y: 1025, r: 5 },                              // breach landing at the tower's west foot
          { shape: 'disc', x: 1500, y: 1010, r: 5.5 },                            // quietPond (world water region r 4: not a terrain water type)
          { shape: 'disc', x: 1262, y: 1033, r: 8 },                              // WS1-04 Bend Relay (relay + plinth + travel anchor + wake approach)
          { shape: 'disc', x: 992, y: 1079, r: 8 },                               // WS2-07 Ford Relay (relay + plinth + wake approach)
          { shape: 'disc', x: 1028, y: 1068, r: 15 },                             // WS2-07 stepping stones + banks
          // WS2-07 roadside dressing roadF (south verge) / roadG (north verge), ford stretch x 1190..1000 (tools/gen-roadside-meshes.mjs)
          { shape: 'capsule', ax: 1188, ay: 1074, bx: 1183, by: 1075, r: 8.5 },
          { shape: 'capsule', ax: 1183, ay: 1075, bx: 1091, by: 1083, r: 8.5 },
          { shape: 'capsule', ax: 1091, ay: 1083, bx: 1008, by: 1079, r: 8.5 },
          { shape: 'capsule', ax: 1182, ay: 1045, bx: 1177, by: 1046, r: 9.5 },
          { shape: 'capsule', ax: 1177, ay: 1046, bx: 1089, by: 1054, r: 9.5 },
          { shape: 'capsule', ax: 1089, ay: 1054, bx: 1010, by: 1050, r: 9.5 },
          { shape: 'capsule', ax: 1487, ay: 1000, bx: 1493, by: 1000, r: 6 },    // floodedCellar water rect [1485, 995, 1495, 1005]
          // OWNER 2026-10-06 "clean the left side of the road": the south (left, walking west) verge of the walk-out path is bare
          // grass, 1..11 m off the centre line (capsule centres = path points + 6 m south, r 5), so the placed Quaternius meshes
          // (world_m1 structures rs_*) stand clean. Tower west foot -> path end.
          { shape: 'capsule', ax: 1470, ay: 1037, bx: 1420, by: 1038, r: 5 },
          { shape: 'capsule', ax: 1420, ay: 1038, bx: 1350, by: 1056, r: 5 },
          { shape: 'capsule', ax: 1350, ay: 1056, bx: 1260, by: 1051, r: 5 },
          { shape: 'capsule', ax: 1260, ay: 1051, bx: 1180, by: 1068, r: 5 },
          { shape: 'capsule', ax: 1180, ay: 1068, bx: 1090, by: 1076, r: 5 },
          { shape: 'capsule', ax: 1090, ay: 1076, bx: 1000, by: 1072, r: 5 },
          // OWNER 2026-10-07 road-left Quaternius scatter (tools/gen-roadside-meshes.mjs, world_m1 structures roadL###): the wider verge,
          // 4.5..23.5 m south of the centre line (capsule centres = path + 14 m south, r 9.5), stays free of ground detail. Regenerate with the tool.
          { shape: 'capsule', ax: 1474, ay: 1040, bx: 1422, by: 1046, r: 9.5 },
          { shape: 'capsule', ax: 1422, ay: 1046, bx: 1353, by: 1064, r: 9.5 },
          { shape: 'capsule', ax: 1353, ay: 1064, bx: 1259, by: 1059, r: 9.5 },
          { shape: 'capsule', ax: 1259, ay: 1059, bx: 1230, by: 1066, r: 9.5 },
          // WS1-05 (D-060) road west dressing, printed by `gen-roadside-meshes.mjs --prefix roadW|roadN`: south verge u 250..300 (roadW###) and north verge u 110..300 (roadN###).
          { shape: 'capsule', ax: 1242, ay: 1063, bx: 1183, by: 1076, r: 9.5 },
          { shape: 'capsule', ax: 1374, ay: 1026, bx: 1346, by: 1034, r: 10.5 },
          { shape: 'capsule', ax: 1346, ay: 1034, bx: 1261, by: 1028, r: 10.5 },
          { shape: 'capsule', ax: 1261, ay: 1028, bx: 1176, by: 1045, r: 10.5 }
        ],
        layers: [
          // PLANT-VOXEL-OFF-01 / STONES-VOXEL-OFF-01 (owner 2026-10-10): the voxel plant scatter and the small voxel stones/pebbles layer are gone;
          // placed Quaternius meshes (world_m1 mdw/roadL rows) are the plants and stones now.
          // ROCKS-VOXEL-OFF-01 (owner 2026-10-10): voxel rockMed*/rockLarge* and the `rock` ground list removed; layer keeps wooden logs/stumps only.
          // PERF-P4: per-species maxDistM (small props 25-60 m, bushes 60, rocks 120, logs/stumps 50-70); layer drawM stays the upper bound.
          { name: 'rocks', seed: 38307, cellM: 11, jitter: 3.0, fill: 0.5, maxSlope: 0.35, clearM: 1.6, drawM: 70, lodCells: 4,
            ground: {
              grass:  [ { model: 'logShort',   weight: 10, sinkM: 0.08, shadow: true, maxDistM: 50, collider: { box: { hx: 0.96, hy: 0.24, h: 0.52 } } },
                        { model: 'stumpCut',   weight: 12, sinkM: 0.04, shadow: true, maxDistM: 50, collider: { prism: { r: 0.33, h: 0.55 } } } ],
              forest: [ { model: 'logShort',   weight: 20, sinkM: 0.08, shadow: true, maxDistM: 50, collider: { box: { hx: 0.96, hy: 0.24, h: 0.52 } } },
                        { model: 'logLong',    weight: 16, sinkM: 0.10, shadow: true, maxDistM: 70, collider: { box: { hx: 1.43, hy: 0.33, h: 0.72 } } },
                        { model: 'stumpCut',   weight: 22, sinkM: 0.04, shadow: true, maxDistM: 50, collider: { prism: { r: 0.33, h: 0.55 } } } ]
            } },
          // WM-07 (arch 38.59 item 5, owner D-077): region dressing by RULES from existing Quaternius meshes. All four layers are `biomeOnly`:
          // they place nowhere (biome 0 / the keep / heartland stay byte-identical) except in biomes whose geo.biomes[id].detail names the layer;
          // there `detail[layer]` is the per-cell probability (fill 1 * mult). No hand placement. Densities live in world_geo.js G.biomes.
          // Gap rule (collide species): cellM - 2 * jitter >= 2 * circumradius + 1.2: boulders prism r 1.0 (circ 1.08) -> 3.4 <= 20 - 12 = 8;
          // ruin walls half-diagonal 1.02 -> 3.3 <= 8. Rock_Medium_3 is left out: its mesh is 1.7 m off its origin (prism would not cover it).
          { name: 'boulders', seed: 38411, cellM: 20, jitter: 6.0, fill: 1, biomeOnly: true, maxSlope: 0.75, clearM: 2, drawM: 130, lodCells: 4,
            ground: (function () {
              var list = [ { mesh: 'quaternius/Rock_Medium_1', weight: 5, sinkM: 0.4, shadow: true, maxDistM: 130, collider: { prism: { r: 1.0, h: 1.6 } } },
                           { mesh: 'quaternius/Rock_Medium_2', weight: 5, sinkM: 0.3, shadow: true, maxDistM: 130, collider: { prism: { r: 1.0, h: 1.5 } } } ];
              return { grass: list, forest: list, flowers: list, alpine: list, rock: list };
            })() },
          // ruin stubs: a low foundation strip (walk-over step) and, rarely, one standing wall fragment (Wall_UnevenBrick_Straight 2 x 0.4 x 3.1 m)
          { name: 'ruins', seed: 38413, cellM: 20, jitter: 6.0, fill: 1, biomeOnly: true, maxSlope: 0.25, clearM: 2.5, drawM: 130, lodCells: 4,
            ground: (function () {
              var list = [ { mesh: 'quaternius/Wall_BottomCover', weight: 8, sinkM: 0.04, shadow: true, maxDistM: 100, collider: { box: { hx: 1.0, hy: 0.2, h: 0.24 } } },
                           { mesh: 'quaternius/Wall_UnevenBrick_Straight', weight: 3, sinkM: 0.05, shadow: true, maxDistM: 130, collider: { box: { hx: 1.0, hy: 0.25, h: 3.1 } } } ];
              return { grass: list, flowers: list, alpine: list };
            })() },
          // reeds in wet ground (fen / reed type), tall common grass stands in for reeds (no reed mesh exists)
          { name: 'reeds', gpu: true, seed: 38417, cellM: 3.5, jitter: 1.4, fill: 1, biomeOnly: true, maxSlope: 0.3, clearM: 0.8, drawM: 60, lodCells: 4,
            ground: { fen: [ { mesh: 'quaternius/Grass_Common_Tall', weight: 3, sinkM: 0.05, shadow: false, sway: true, grassLike: true, maxDistM: 45 },
                             { mesh: 'quaternius/Grass_Wispy_Tall', weight: 1, sinkM: 0.05, shadow: false, sway: true, grassLike: true, maxDistM: 45 } ],
                      reeds: [ { mesh: 'quaternius/Grass_Common_Tall', weight: 3, sinkM: 0.05, shadow: false, sway: true, grassLike: true, maxDistM: 45 },
                               { mesh: 'quaternius/Grass_Wispy_Tall', weight: 1, sinkM: 0.05, shadow: false, sway: true, grassLike: true, maxDistM: 45 } ] } },
          // wild flower clumps + low plants on meadow ground, sparse pebbles on sand / alpine ground
          { name: 'wildflowers', gpu: true, seed: 38419, cellM: 6, jitter: 2.2, fill: 1, biomeOnly: true, maxSlope: 0.3, clearM: 0.8, drawM: 50, lodCells: 4,
            ground: (function () {
              var list = [ { mesh: 'quaternius/Flower_3_Single', weight: 4, sinkM: 0.03, shadow: false, sway: true, maxDistM: 40 },
                           { mesh: 'quaternius/Plant_7_Big', weight: 3, sinkM: 0.03, shadow: false, sway: true, maxDistM: 40 },
                           { mesh: 'quaternius/Fern_1', weight: 1, sinkM: 0.03, shadow: false, sway: true, maxDistM: 40 } ];
              return { flowers: list, grass: list, alpine: list };
            })() },
          { name: 'pebbles', gpu: true, seed: 38423, cellM: 5, jitter: 2.0, fill: 1, biomeOnly: true, maxSlope: 0.3, clearM: 0.6, drawM: 40, lodCells: 4,
            ground: (function () {
              var list = [ { mesh: 'quaternius/Pebble_Round_1', weight: 1, sinkM: 0.03, shadow: false, maxDistM: 35 },
                           { mesh: 'quaternius/Pebble_Round_3', weight: 1, sinkM: 0.03, shadow: false, maxDistM: 35 },
                           { mesh: 'quaternius/Pebble_Square_1', weight: 1, sinkM: 0.03, shadow: false, maxDistM: 35 } ];
              return { sand: list, alpine: list };
            })() }
        ]
      },
      // OB-073-D2f (arch 38.52 item 6): near-field grass carpet, world opt `carpet` (main.js resolves ramp keys -> RGB; ?carpet=0 off).
      // OB-096 (owner: "don't put it everywhere, draw the areas by hand... different size"): NO catch-all - every variant lists
      // hand-placed `areas` (disc / capsule / rect, like detail.exclude); outside them the ground stays bare (detail pass only).
      // Rules used: off the road/tracks (route-walk legs, world_geo roads hw + >= 3 m), >= 3 m from walls/fences/ruins, never in
      // the water, the tower and its crown clear; sizes mixed (clumps 2-4 m, patches 6-10 m, a few 15-25 m fields). Map: design/preview/carpet-areas.html.
      // Areas do not overlap, so order only matters for the test's name list. Ramps are base -> tip,
      // existing muted keys for now; NEEDS MAIN palette keys (lane entry) then swap: meadow bladeMeadowBase/bladeMeadow/bladeMeadowTip,
      // straw bladeStrawBase/bladeStraw/bladeStrawTip, riverbank bladeBankBase/bladeBank/bladeBankTip, outwall bladeWallBase/bladeWall/bladeWallTip.
      // Technique reference: SMM Stylized Grass (MIT, SirMishMash), see docs/licences.md. Default glyphs: base ',' mid '|' tip "'" leanL '\' leanR '/'.
      carpet: {
        cutGround: ['path', 'water', 'rock'], // MASK-e2 (38.52 OB-096): no grass on road / track / river bed / bare rock (mask stamp)
        seed: 40731, radiusM: 20, patchM: 6, classCellM: 2, classJitterM: 0.8, gustM: 5, travelM: 1.5, bladeW: 0.06,
        variants: [
          // dark lush river bank: ragged strips ~14 m off the river centre x_r(y) (water = centre +- 10), broken by gaps; the road +
          // ford lane (y ~1054-1080), the jetty (1043,1058) and the Outwall track (y ~1031-1035 west bank) stay clear.
          { name: 'riverbank', ground: ['grass', 'flowers', 'reeds', 'fen'], density: 0.9, heightM: [0.25, 0.6], groundTint: 0.35, bladeW: 0.07, swayGain: 0.8,
            ramp: ['bladeBankBase', 'bladeBank', 'bladeBankTip'], glyphs: { base: ',', mid: '|', tip: '!', leanL: '\\', leanR: '/' },
            areas: [ { shape: 'capsule', ax: 1032.5, ay: 985, bx: 1034, by: 1019, r: 3.5 },   // east bank north, 41 m strip
                     { shape: 'capsule', ax: 1035, ay: 1028, bx: 1038.5, by: 1050, r: 4.5 },   // east bank below northLook
                     { shape: 'capsule', ax: 1046, ay: 1082, bx: 1053, by: 1110, r: 5 },       // east bank south of the ford (secretBank 1054.5,1091 just outside)
                     { shape: 'disc', x: 1058, y: 1125, r: 3 },                                // small clump further down
                     { shape: 'capsule', ax: 1004.4, ay: 988, bx: 1005.5, by: 1022, r: 3.5 },  // west bank north (ends 9 m before the track)
                     { shape: 'capsule', ax: 1018, ay: 1084, bx: 1024, by: 1108, r: 3.5 } ] }, // west bank south of the ford
          // tall dry-gold straw: the Outwall barley field north of its fence row (y 900, x 963..986; gate + pickups 975..979,900..904 clear)
          { name: 'straw', ground: ['grass', 'flowers'], density: 0.75, heightM: [0.4, 0.9], groundTint: 0.3, bladeW: 0.05, swayGain: 1.2,
            ramp: ['bladeStrawBase', 'bladeStraw', 'bladeStrawTip'], glyphs: { base: '|', mid: '|', tip: '"', leanL: '\\', leanR: '/' },
            areas: [ { shape: 'capsule', ax: 966, ay: 887, bx: 986, by: 885, r: 10 },          // main field ~40 x 20 m (south edge 3 m off the fence)
                     { shape: 'capsule', ax: 972, ay: 873, bx: 983, by: 875, r: 7 } ] },        // ragged north lobe
          // sparse grey-green, a broken ring OUTSIDE the palisade (square x 882..942, y 922..982), >= 3 m off the stakes and the
          // ring path (952,915)-(890,912)-(865,925)-(852,955)-(855,978)-(874,990) and the inward track (956,962)-(950,927)
          { name: 'outwall', ground: ['grass', 'flowers', 'alpine'], density: 0.35, heightM: [0.12, 0.35], groundTint: 0.4, swayGain: 0.9,
            ramp: ['bladeWallBase', 'bladeWall', 'bladeWallTip'],
            areas: [ { shape: 'capsule', ax: 872, ay: 933, bx: 870, by: 961, r: 4.5 },         // west, between the stakes and the ring path
                     { shape: 'capsule', ax: 900, ay: 988, bx: 930, by: 991, r: 3 },           // north, along the back fence
                     { shape: 'disc', x: 946, y: 993, r: 2.5 },                                 // NE clump
                     { shape: 'disc', x: 966, y: 950, r: 4 },                                   // east of the inward track
                     { shape: 'capsule', ax: 900, ay: 904, bx: 918, by: 903, r: 3 } ] },        // south, beyond the ring path
          // short green meadow: patches on the open slopes of the tower hill and along the road meadows - NOT the hill path, the
          // tower (bbox 1480..1504 x 1018..1032) + 3 m, the groves (forest), the pond / flooded cellar, the bee farm or the standing stones
          { name: 'meadow', ground: ['grass', 'flowers'], density: 0.75, heightM: [0.15, 0.4], groundTint: 0.35, ramp: ['bladeMeadowBase', 'bladeMeadow', 'bladeMeadowTip'],
            // OB-101 (owner 2026-10-12 'make a huge area around'): four big fields ring the tower/spawn (tower bbox 1480..1504 x 1018..1032
            // + 3 m + 1.5 m feather stays bare); road/paths/pond/rock cut by cutGround, groves by the ground filter
            areas: [ { shape: 'capsule', ax: 1450, ay: 1070, bx: 1535, by: 1070, r: 32 },       // OB-101 huge field, y 1038..1102
                     { shape: 'capsule', ax: 1450, ay: 980, bx: 1535, by: 980, r: 32 },         // OB-101 huge field, y 948..1012
                     { shape: 'capsule', ax: 1440, ay: 1000, bx: 1440, by: 1050, r: 34 },       // OB-101 huge field, x 1406..1474
                     { shape: 'capsule', ax: 1545, ay: 1000, bx: 1545, by: 1050, r: 35 },       // OB-101 huge field, x 1510..1580
                     { shape: 'disc', x: 1440, y: 1004, r: 9 },                                 // LARGE north meadow (boarN, berries), 16 m off the road
                     { shape: 'capsule', ax: 1404, ay: 1070, bx: 1416, by: 1063, r: 6 },        // LARGE SW slope field (boarS), 25 m off the road
                     { shape: 'disc', x: 1474, y: 1056, r: 4.5 },                               // medium, south flank below the path (groveSouth 11 m away)
                     { shape: 'disc', x: 1458, y: 1050, r: 1.5 },                               // small clump
                     { shape: 'disc', x: 1426, y: 1018, r: 2 },                                 // small clump above the road
                     { shape: 'disc', x: 1470, y: 995, r: 3.5 },                                // medium, north of the woodpile (cellar 11 m away)
                     { shape: 'disc', x: 1532, y: 1005, r: 4 },                                 // medium, east slope behind groveEast
                     { shape: 'disc', x: 1360, y: 1086, r: 8 },                                 // LARGE field south of Road West (boarR)
                     { shape: 'disc', x: 1295, y: 1022, r: 2 },                                 // small clump north of the Bend
                     { shape: 'capsule', ax: 1244, ay: 1080, bx: 1256, by: 1075, r: 3 },        // medium strip south of the Bend lamps
                     { shape: 'disc', x: 1110, y: 1095, r: 4 } ] }                              // medium, road meadow east of the ford
        ]
      },
      slopeEps: 2.0                                  // m: typeAt slope = central difference of heightAt at +-2 m
    },

    // ---- US-016b d: authored overrides, per 128 m chunk, plain JSON (future editor writes these) ----
    // key "cx,cy" = floor(x/128), floor(y/128) of the stamp/paint centre. Applied after the recipe, in order.
    overrides: {
      '11,8': {
        stamps: [
          { id: 'towerCrown', shape: 'disc', x: 1492, y: 1025, r: 20, falloff: 60, mode: 'flatten', h: 2.4,
            note: 'US-016b c: flat 2.4 m crown under the whole tower footprint (24x14 incl. bastion + outcrop), smoothstep skirt 60 m' }
        ],
        paints: [
          { id: 'crownGrass', shape: 'disc', x: 1492, y: 1025, r: 26, type: 'grass', mode: 'set', note: 'bare grass on the crown + handover band' },
          // OWNER 2026-10-04 "add some trees around the tower" (v1.33): three small forest groves painted INSIDE the
          // world bounds (r 96; the recipe forest starts at homeClear 110 m, i.e. outside them). Listed AFTER crownGrass so
          // they win where they overlap it (typeAt walks the paints last-first). scatterTrees plants real trees on these
          // forest cells (cellM 6.5 / fill 0.72: ~3-6 trees per grove; trunks need all 4 corners of a 2 m cell forest, so
          // they stand >= ~1.5 m inside the disc). Clearances (disc EDGE): tower bbox (1480..1504 x 1018..1032) >= 7 m,
          // walk-out path centre line >= 10 m, boar homes >= 14 m, breach landing >= 15 m, quietPond / floodedCellar >= 16 m.
          // Ground under them = forest floor (ferns / logs / mushrooms from recipe.detail). Trees render after ME-06c3.
          { id: 'groveEast', shape: 'disc', x: 1521, y: 1028, r: 10, type: 'forest', mode: 'set',
            note: 'behind the east wall, a little south of due ESE so it never shades the sun crack (sun elev 60: the shaft clears 17 m at 8 m out)' },
          { id: 'groveSouth', shape: 'disc', x: 1494, y: 1048, r: 9, type: 'forest', mode: 'set',
            note: 'south of the tower (edge 7 m from the south wall); seen on the left of the walk-out' }
        ]
      },
      // Must stay AFTER '11,8' (stamps apply in key insertion order): the crown flatten would erase the bowl.
      '11,7': {
        stamps: [
          { id: 'quietPondBowl', shape: 'disc', x: 1500, y: 1010, r: 1, falloff: 3, mode: 'add', h: -0.75,
            note: 'Q14 / 36.1c pond bowl under world_m1 water quietPond (c 1500,1010, r 4, z 2.5) on the 2.4 m crown. ' +
                  'Flat deep floor r <= 1 m at 1.65 m (column 0.85 m >= pond tintDepth 0.8 -> full deep colour), smoothstep ' +
                  'rise to 0 at r = 4 m (rim column 0.10 m, unchanged). Column < pond foamDepth 0.25 from r ~3.1 m -> shallow foam shelf. ' +
                  'Slope <= ~0.4 (about 20 deg), walkable. Move/resize together with the quietPond water region.' }
        ],
        paints: [
          // groveNorthWest lives in chunk 11,7 (its centre); this chunk comes after 11,8 so it still wins over crownGrass.
          { id: 'groveNorthWest', shape: 'disc', x: 1460, y: 1008, r: 9, type: 'forest', mode: 'set',
            note: 'north of the walk-out, ~33 deg right of the breach view centre (yaw 270): the first trees you see from the breach' }
        ]
      }
    },

    // ---- structures placed in the world (D-007). ----
    // Handover rule (US-016b c): within `blend` m OUTSIDE a structure's footprint the terrain height blends
    // LINEARLY to the height of the nearest outer-ring cell: h = ring + (terrain - ring) * (d / blend).
    // At the footprint edge (d = 0) terrain == ring cell floorH exactly (mismatch 0 where the player crosses).
    // Authoring rule: keep a structure's outer ring flat, or varying <= 0.3 m between neighbours (step-up safe).
    // CO-2/CO-8/CO-9 (docs/coordinates.md 8): `World.load` injects the REAL `bbox`/`ringHAt` here by id, from
    // the actual placed structure (world_m1.world.json's origin) - the ONLY source, for real gameplay AND for
    // `structureBlend` below. There is no literal x/y/w/h/ringH fallback any more (removed by CO-9): a recipe
    // driven directly with no World.load (`new Terrain(recipe)` in terrain.test.js/terrainMesh.test.js/
    // MeshBuffers.test.js/TerrainTextures.features.test.js) must inject a stub `bbox`/`ringHAt` onto this entry
    // itself before constructing Terrain, or `structureBlend` throws reading `undefined.bbox` - intentional,
    // so a caller that forgot the injection fails loudly instead of silently blending against stale numbers.
    structures: [
      { id: 'tower', level: 'tower', blend: 6,
        note: 'every outer-ring cell of tower.js is 2.4 m (legend , and ;), equal to the crown' }
    ],

    // ---- look per terrain type (colors = palette keys dark/mid/light; glyph sets by distance band) ----
    bands: { near: 150, mid: 600 },                   // FAR view bands (8 m grid), metres
    terrain: {
      // v1.33 (owner 2026-10-04 "ground looks like tree colour"): calm turf* greens + quiet glyphs (no " tufts);
      // the ENV-01 ground detail scatter brings the variety. Was colors grassDark/grass/grassLight, close '"\',;`', near '"\',;', face ';:'.
      grass:  { id: 0, colors: ['turfDark', 'turf', 'turfLight'], glyphs: { close: ".,'`", near: ".,'", mid: ",'.", far: '.,' }, face: ',:', albedo: 0.85 },
      forest: { id: 1, colors: ['forestDark', 'forest', 'grassDark'], glyphs: { close: '&%@&', near: '&%@', mid: '%&', far: '%:' }, face: '&%', albedo: 0.70 },
      // OB-045 (2026-10-11, owner "water still looks not good"): type 2 is the river BED / wet bank, not the water. The river ribbon,
      // ford, lake and sea draw the water on top (WebGPU). Was river/riverLight '~' + glint = a second, blue "water" level above the
      // real surface at every bank and on the ford bar. Now wet gravel: dark, pebbly, no glint; under water the composite tints it.
      water:  { id: 2, colors: ['woodDark', 'ropeDark', 'turfDark'], glyphs: { close: 'o.,:', near: '.,o', mid: ',.', far: '.,' }, face: ':.', albedo: 0.75 },
      rock:   { id: 3, colors: ['stoneDark', 'rock', 'stoneLight'], glyphs: { close: '#%&', near: '#%', mid: '%#', far: '%' }, face: '#%', albedo: 0.80 },
      path:   { id: 4, colors: ['strawDark', 'strawDark', 'straw'], glyphs: { close: '.:,', near: '.:', mid: '.', far: '.' }, face: ':', albedo: 0.70 },
      // MAP-01b (arch 38.42): appended ids 5-10, EXISTING palette colours only. 'mud' (designer doc) = fen (id 8).
      sand:    { id: 5,  colors: ['strawDark', 'strawLight', 'white'], glyphs: { close: '.:`', near: '.:', mid: '.', far: '.' }, face: ':.', albedo: 0.90 },
      snow:    { id: 6,  colors: ['stoneLight', 'white', 'white'], glyphs: { close: '.*`', near: '.*', mid: '.', far: '.' }, face: '*.', albedo: 1.00 },
      reeds:   { id: 7,  colors: ['grassDark', 'grass', 'strawLight'], glyphs: { close: '|!;', near: '|!', mid: '!;', far: ';' }, face: '|!', albedo: 0.75 },
      fen:     { id: 8,  colors: ['forestDark', 'strawDark', 'grassDark'], glyphs: { close: '~,;', near: ',;', mid: ',', far: ',' }, face: ';,', albedo: 0.60 },
      flowers: { id: 9,  colors: ['turfDark', 'turf', 'gold'], glyphs: { close: '*",', near: '*"', mid: '"', far: '.' }, face: ',:', albedo: 0.85 },
      alpine:  { id: 10, colors: ['stoneDark', 'turfDark', 'stoneLight'], glyphs: { close: '.,"', near: '.,', mid: ',', far: '.' }, face: '#,', albedo: 0.75 }
    },

    // ---- US-016b b: NEAR LOD look (2 m cells within 300 m) ----
    nearLOD: {
      cell: 2, range: 300, handover: [280, 320],
      bands: { close: 40, near: 150, mid: 300 },
      rules: [
        'Glyph and color variation are picked by a hash of the 2 m WORLD cell (never of the screen cell), so nothing shimmers as the camera moves.',
        'close (< 40 m): glyphs.close set + features; near (< 150 m): glyphs.near; 150-300 m: glyphs.mid (the same set the far grid uses there, so the 300 m handover shows no band).',
        'Handover 280-320 m: pick near (2 m) or far (8 m) sampling per column-sample with probability ramping across the band, keyed by the world-cell hash (stable dither, no seam line).',
        'Surface vs face: in the column fill, the topmost row a sample paints is its SURFACE (glyph set by band); the rows below it are the FACE of the slope/canopy (type.face glyphs, 0.8x brightness).',
        'Forest near LOD: the canopy is +10 m. Face rows whose height above the ground is < 3 m are TRUNKS: "|" in woodDark on a forestDark bg for 1 cell in 3 (hash), otherwise dark foliage "%". Above 3 m: foliage "&%@".',
        'Micro shading: brightness jitter +-0.08 per 2 m cell (hash). Shading only; heightAt stays smooth for physics.',
        'Lighting: ambient + sun N.L (normals from heightAt central differences at 2 m) + point lights within their radius (D-007: no terrain shadow rays in M1/M2).',
        'Step LOD: sample step = max(0.5 m, distance * 0.012), so there is always at least one sample per column at 160 columns.'
      ],
      features: [
        { id: 'wildflower', on: 'grass', bands: ['close'], chance: 0.025, glyphs: '*,', colors: ['gold', 'strawLight', 'white'], note: 'warm specks = the land is alive (never danger red)' },
        { id: 'pebble', on: 'grass', bands: ['close', 'near'], chance: 0.012, glyphs: 'o.', colors: ['rock', 'stoneLight'] },
        { id: 'tallGrass', on: 'grass', bands: ['close'], chance: 0.02, glyphs: '"', colors: ['grassLight'], note: 'drawn one row ABOVE the surface row (0.5 m tuft). v1.33: 0.06 -> 0.02 (calm turf; the scatter tufts carry it)' },
        { id: 'reed', on: 'grass', bands: ['close', 'near'], nearWater: 14, chance: 0.2, glyphs: '|!', colors: ['grass', 'strawDark'] },
        { id: 'foam', on: 'water', bands: ['close'], nearBank: 3, chance: 0.2, glyphs: 'o.', colors: ['stoneMid', 'rubbleHi'], note: 'OB-045: wet pebbles at the bank (was white foam dashes)' }
      ]
    },

    lighting: {
      rule: 'b = ambientI + sunI * max(0, N.L), N from heightAt central differences; color index = b < 0.45 ? 0 : b < 0.8 ? 1 : 2 (+-1 by a cell hash); ' +
            'fg = rgb * (fgMin + (1-fgMin)*min(b,1)^fgGamma); bg = fg * 0.3'
    },
    fog: {
      preset: 'far',
      rule: 'f = util.fogFactor(dist, "far"); fogColor = lerp(fogFarNear, fogFar, f); fg = lerp(fg, fogColor, f); bg = lerp(bg, fogColor, min(1, f*1.1)); glyph " " when f > 0.85.',
      horizonIs: 'fogFar = skyHorizon'
    },

    farTower: {
      x: 713.8, y: 1232.1, azimuthFromBreach: 255, distance: 800,
      baseZ: -8, height: 42, width: 14,
      color: 'farTower', lit: false, emissive: false, fogMax: 0.40,
      signalLight: 'D-011 addendum: the signal tower. lit/emissive = false describe the BODY; the crown-notch light cells ' +
                   '(models/far_tower.js keys L/G) are emissive aether teal, key fogMax 0.20, static in M1',
      note: 'Dark notch against the pale horizon; fog capped at 0.40; never smaller than 3x4 cells. US-022 does not change it. ' +
            'The silhouette lives in design/models/far_tower.js (ASSETS.models.farTower: detail 5x8 + lods.min 3x4); the engine draws it ' +
            'as the `farTower` billboard entity of design/levels/world_m1.js through the sprite pass (architecture.md 14.4 item 7), not in terrain code.',
      model: 'farTower', minCells: { w: 3, h: 4 }, detailRows: 12
    },

    render: {
      nearStart: 8, maxDist: 2000, step0: 0.5, stepGrow: 0.015,
      note: 'Far LOD: per column march z += 0.5 + 0.015 z (~260 samples to 2 km) over the baked 8 m grid (bilinear) + canopy; ' +
            'row = horizonRow - (h - eyeZ)/z_perp * focalRows with the SAME horizonRow/focalRows as the sector caster; y-buffer fill upward; ' +
            'writes DepthBuffer; only fills spans the sector pass left open (D-007/D-008). Near LOD per nearLOD above.'
    }
  };

  // MAP-01a: world rect (128 m aligned) + protected keep rect (zones east+west + 64 m) for the geography layers.
  DEF.geo = { world: { x0: 0, y0: 0, x1: 4096, y1: 4096 }, keep: { x0: 704, y0: 832, x1: 1728, y1: 1344 } };
  var GEO = DEF.geo;

  // ---------------- noise ----------------
  function hash(ix, iy, s) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct, gain, lac) {
    var sum = 0, amp = 1, norm = 0;
    for (var i = 0; i < oct; i++) { sum += amp * vnoise(x, y, s + i * 101); norm += amp; amp *= gain; x *= lac; y *= lac; }
    return sum / norm;
  }
  function smooth(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function riverX(y) { var R = DEF.recipe.river; return R.base + R.a1 * Math.sin(y / R.p1) + R.a2 * Math.sin(y / R.p2 + R.ph2); }
  function pathDist(px, py) {
    var pts = DEF.recipe.path.points, best = 1e9;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][0], ay = pts[i - 1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay;
      var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); t = t < 0 ? 0 : t > 1 ? 1 : t;
      var qx = ax + dx * t - px, qy = ay + dy * t - py, d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------------- analytic height ----------------
  function recipeHeight(x, y) {
    var R = DEF.recipe, s = DEF.seed, T = DEF.tower, T2 = DEF.farTower;
    var d0 = Math.hypot(x - T.x, y - T.y), dt = Math.hypot(x - T2.x, y - T2.y);
    var home = R.home.top - R.home.drop * (1 - Math.exp(-Math.pow(d0 / R.home.radius, 2)));
    var hill2 = R.hill2.height * Math.exp(-Math.pow(dt / R.hill2.radius, 2));
    var roll = (fbm(x / R.rolling.scale, y / R.rolling.scale, s, R.rolling.octaves, R.rolling.gain, R.rolling.lacunarity) - 0.5) * R.rolling.amp *
               (1 - Math.exp(-Math.pow(dt / R.rolling.flatNearTower2, 2))) * (1 - Math.exp(-Math.pow(d0 / R.rolling.flatNearHome, 2)));
    var dr = Math.abs(x - riverX(y));
    var valley = -R.valley.depth * Math.exp(-Math.pow(dr / R.valley.width, 2));
    var ridge = R.ridge.height * smooth(R.ridge.x0, R.ridge.x1, x) * (0.6 + 0.4 * fbm(x / R.ridge.scale, y / R.ridge.scale, s + 7, 3, 0.5, 2));
    var carve = R.river.carve * smooth(R.river.carveEdge[0], R.river.carveEdge[1], dr);
    var hh = home + hill2 + roll + valley + ridge - carve;
    var BL = R.river.bedLine;
    if (BL !== undefined && dr < BL.reach) {
      var bp = BL.pts, by0 = bp[0][0], by1 = bp[bp.length - 1][0];
      if (y > by0 && y < by1) {
        var bi = 1; while (bp[bi][0] < y) bi++;
        var bz = bp[bi - 1][1] + (y - bp[bi - 1][0]) / (bp[bi][0] - bp[bi - 1][0]) * (bp[bi][1] - bp[bi - 1][1]);
        var hb = bz + BL.lift * (1 - smooth(by0, by0 + BL.ramp, y) + smooth(by1 - BL.ramp, by1, y)) + BL.bank * Math.max(0, dr - BL.flatW);
        if (hb < hh) hh = hb;
      }
    }
    if (GEO_N !== 0) hh = geoHeight(hh, x, y);
    return hh;
  }
  // ---------------- MAP-01a (arch 38.42): ordered pure geography layers + keep mask + GeoFields ----------------
  // Layers `{id, rect:[x0,y0,x1,y1], core?:[..], heightFn?(h,x,y,F), typeFn?(t,x,y,h,slope,F)}` run in list order AFTER the recipe sum.
  // Inside geo.keep (stage 0-2 area) every layer is skipped BY BRANCH (no float op) -> near bands/scatter stay bit-identical.
  // An empty list = today's bytes. Data (sea/ridges/river/lake/biomes) arrives with MAP-01b/c and the designer's map.
  var GEO_N = 0, GEO_LAYERS = [], GEO_F = null;   // GEO = DEF.geo is set above
  function inKeep(x, y) { var k = GEO.keep; return x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1; }
  function geoHeight(h, x, y) {
    if (inKeep(x, y)) return h;
    for (var i = 0; i < GEO_N; i++) {
      var L = GEO_LAYERS[i], r = L.rect;
      if (L.heightFn === undefined || x < r[0] || x >= r[2] || y < r[1] || y >= r[3]) continue;
      h = L.heightFn(h, x, y, GEO_F);
    }
    return h;
  }
  function geoType(t, x, y, h, slope) {
    for (var i = 0; i < GEO_N; i++) {
      var L = GEO_LAYERS[i], r = L.rect;
      if (L.typeFn === undefined || x < r[0] || x >= r[2] || y < r[1] || y >= r[3]) continue;
      t = L.typeFn(t, x, y, h, slope, GEO_F);
    }
    return t;
  }
  // Signed-distance helpers for GeoFields builders (run once per grid node at build time, never per height sample).
  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t; var qx = ax + dx * t - px, qy = ay + dy * t - py; return Math.sqrt(qx * qx + qy * qy);
  }
  function polylineSdf(pts) {                     // <= 64 verts; unsigned distance to the line
    if (pts.length > 64) throw new Error('geo: polyline > 64 verts');
    return function (x, y) { var b = 1e18; for (var i = 1; i < pts.length; i++) { var d = distSeg(x, y, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]); if (d < b) b = d; } return b; };
  }
  function polygonSdf(pts) {                      // <= 32 verts; negative inside
    if (pts.length > 32) throw new Error('geo: polygon > 32 verts');
    return function (x, y) {
      var b = 1e18, inside = false, n = pts.length, i, j;
      for (i = 0, j = n - 1; i < n; j = i++) {
        var d = distSeg(x, y, pts[j][0], pts[j][1], pts[i][0], pts[i][1]); if (d < b) b = d;
        if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
      }
      return inside ? -b : b;
    };
  }
  function GeoFields(world, fns) {                // one Float32 grid (16 m) per region, built once from {id: (x,y)->signed dist}
    var ids = Object.keys(fns); if (ids.length > 16) throw new Error('geo: > 16 fields');
    this.x0 = world.x0; this.y0 = world.y0; this.cell = 16;
    this.w = Math.ceil((world.x1 - world.x0) / 16) + 1; this.h = Math.ceil((world.y1 - world.y0) / 16) + 1;
    this.grids = {}; this.ids = ids; this.fns = fns;      // MAP-04: grids are built lazily on first sdf(id) (or warm()), not at load
  }
  GeoFields.prototype.build = function (id) {
    var g = new Float32Array(this.w * this.h), fn = this.fns[id];
    for (var j = 0; j < this.h; j++) for (var i = 0; i < this.w; i++) g[i + j * this.w] = fn(this.x0 + i * 16, this.y0 + j * 16);
    return (this.grids[id] = g);
  };
  GeoFields.prototype.warm = function () { for (var k = 0; k < this.ids.length; k++) if (!this.grids[this.ids[k]]) this.build(this.ids[k]); };
  GeoFields.prototype.sdf = function (id, x, y) {   // bilinear, clamped at the grid edge; 0 alloc
    var g = this.grids[id] || this.build(id), fx = (x - this.x0) / 16, fy = (y - this.y0) / 16, W = this.w;
    fx = fx < 0 ? 0 : fx > W - 1.001 ? W - 1.001 : fx; fy = fy < 0 ? 0 : fy > this.h - 1.001 ? this.h - 1.001 : fy;
    var i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, q = i + j * W;
    var a = g[q], b = g[q + 1], c = g[q + W], d = g[q + W + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // layers: array (may be empty = today's bytes); regions: {id: sdfFn} for GeoFields (built here, once, before any bake).
  function setGeoLayers(layers, regions) {
    layers = layers || [];
    var k = GEO.keep, ids = {}, i;
    for (i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L.id || ids[L.id]) throw new Error('geo: layer needs a unique id (' + L.id + ')');
      ids[L.id] = 1;
      if (!L.rect || L.rect.length !== 4) throw new Error('geo: layer ' + L.id + ' needs rect [x0,y0,x1,y1]');
      var c = L.core;                                  // hard core (full effect) must stay out of the keep rect
      if (c && c[0] < k.x1 && c[2] > k.x0 && c[1] < k.y1 && c[3] > k.y0) throw new Error('geo: layer ' + L.id + ' core overlaps keep');
    }
    GEO_F = (regions && Object.keys(regions).length) ? new GeoFields(GEO.world, regions) : null;
    GEO_LAYERS = layers.slice(); GEO_N = GEO_LAYERS.length;
    return GEO_F;
  }
  // ---------------- MAP-01c (arch 38.42): biome map = scatter driver ----------------
  // biomeAt(x, y) -> u8: argmax of w_i = smooth(+b/2, -b/2, sdf_i) + 1.0 * (hash01_i(floor(x/2), floor(y/2)) - 0.5) (b = blendM_i; w = 0.5 on
  // the area edge, so two touching biomes mix over ~b/2 either side; each biome has its own 2 m hash), biome 0 (meadow) when no weight beats BIO_BASE. Inside the keep rect it returns 0 by branch. Table `geo.biomes[id]` is read by engine/world/scatter.js.
  var BIO_F = null, BIO_KEYS = [], BIO_IDS = [], BIO_BLEND = [], BIO_BASE = 0.35, BIO_NOISE = 1.0;   // noise amp 1.0 (not 0.25): 0.25 gave a ~5 m mixed edge, 1.0 gives ~blendM
  function biomeAt(x, y, clean) {   // clean = true: skip the 2 m hash term (ENV-02a test reference; biomeBlend is the same without it)
    if (BIO_F === null || inKeep(x, y)) return 0;
    var ix = Math.floor(x / 2), iy = Math.floor(y / 2), best = 0, bw = BIO_BASE;
    for (var i = 0; i < BIO_IDS.length; i++) {
      var b = BIO_BLEND[i] * 0.5, d = BIO_F.sdf(BIO_KEYS[i], x, y);
      if (d >= b) continue;
      var w = smooth(b, -b, d) + (clean ? 0 : BIO_NOISE * (hash(ix, iy, 8191 + BIO_IDS[i]) - 0.5));
      if (w >= bw) { bw = w; best = BIO_IDS[i]; }   // ties: the higher id (more specific area) wins
    }
    return best;
  }
  // ENV-02a (arch 38.63): biomeBlend(x, y, out) -> out {a, b, w}: top-2 biome ids + w = share of the 2nd (0..0.5, smooth, NO hash term).
  // Scores = the biomeAt weights without noise (biome 0 = BIO_BASE constant), so a == biomeAt(x, y, true) wherever w < 0.4.
  // w = 0.5 * q^2, q = s2/s1 (0 far from a border, 0.5 on a tie; deep inside a biome q = 0.35 -> 6% trimmed to ~3%). Inside the keep rect: a = b = 0, w = 0. 0 alloc.
  function biomeBlend(x, y, out) {
    var s1 = BIO_BASE, i1 = 0, s2 = -1, i2 = 0;
    if (BIO_F !== null && !inKeep(x, y)) {
      for (var i = 0; i < BIO_IDS.length; i++) {
        var b = BIO_BLEND[i] * 0.5, d = BIO_F.sdf(BIO_KEYS[i], x, y);
        if (d >= b) continue;
        var s = smooth(b, -b, d);
        if (s >= s1) { s2 = s1; i2 = i1; s1 = s; i1 = BIO_IDS[i]; } else if (s > s2) { s2 = s; i2 = BIO_IDS[i]; }
      }
    }
    var w = 0;
    if (s2 > 0 && i2 !== i1) { var q = s2 / s1; w = 0.5 * q * q - 0.03; w = w > 0 ? w * (0.5 / 0.47) : 0; }
    out.a = i1; out.b = w > 0 ? i2 : i1; out.w = w;
    return out;
  }
  // table: {id: {name, blendM?, forest?: {fill, species: {meshId: weight}}, detail?: {layer: densityMult}, scale?: [min,max], hueJitter?}}
  // areas: {id: signed-distance fn (negative inside)} (<= 16). Passing no table clears the biomes (today's bytes).
  function setGeoBiomes(table, areas) {
    BIO_F = null; BIO_KEYS = []; BIO_IDS = []; BIO_BLEND = []; GEO.biomes = null;
    if (!table || !Object.keys(table).length) return null;
    var ids = Object.keys(table);
    for (var i = 0; i < ids.length; i++) {
      var id = +ids[i];
      if (!(id >= 1 && id <= 255 && id === Math.floor(id))) throw new Error('geo.biomes: id ' + ids[i] + ' must be an integer 1..255 (0 = default meadow)');
    }
    areas = areas || {};
    var keys = Object.keys(areas);
    for (i = 0; i < keys.length; i++) if (!table[keys[i]]) throw new Error('geo.biomes: area for unknown biome ' + keys[i]);
    if (keys.length) {
      BIO_F = new GeoFields(GEO.world, areas);
      for (i = 0; i < keys.length; i++) { BIO_KEYS.push(keys[i]); BIO_IDS.push(+keys[i]); BIO_BLEND.push(table[keys[i]].blendM || 24); }
    }
    GEO.biomes = table;
    return BIO_F;
  }
  // overrides: all stamps/paints flattened into one list at load (a stamp can reach into neighbouring chunks)
  var STAMPS = [], PAINTS = [];
  function indexOverrides() {
    STAMPS = []; PAINTS = [];
    Object.keys(DEF.overrides).forEach(function (k) {
      var o = DEF.overrides[k]; (o.stamps || []).forEach(function (s) { STAMPS.push(s); }); (o.paints || []).forEach(function (p) { PAINTS.push(p); });
    });
  }
  indexOverrides();
  function shapeDist(o, x, y) {         // 0 inside the shape, distance outside it
    if (o.shape === 'rect') { var dx = Math.max(o.x - x, 0, x - (o.x + o.w)), dy = Math.max(o.y - y, 0, y - (o.y + o.h)); return Math.hypot(dx, dy); }
    return Math.max(0, Math.hypot(x - o.x, y - o.y) - o.r);
  }
  function applyStamps(h, x, y) {
    for (var i = 0; i < STAMPS.length; i++) {
      var s = STAMPS[i], d = shapeDist(s, x, y), w = 1 - smooth(0, s.falloff || 1e-6, d);   // 1 inside, smooth to 0
      if (w <= 0) continue;
      if (s.mode === 'flatten' || s.mode === 'set') h = h + (s.h - h) * w;
      else if (s.mode === 'add') h = h + s.h * w;
    }
    return h;
  }
  function structureBlend(h, x, y) {
    var S = DEF.structures;
    for (var i = 0; i < S.length; i++) {
      var st = S[i];
      // CO-9: `st.bbox`/`st.ringHAt` are the ONLY source now (World.load's injection,
      // the real placement) - no literal x/y/w/h/ringH fallback exists any more. A
      // caller with no placement (standalone `new Terrain(recipe)`) must inject a stub
      // itself; if it forgot, this throws on `undefined.x0` instead of blending wrong.
      var x0 = st.bbox.x0, y0 = st.bbox.y0;
      var x1 = st.bbox.x1, y1 = st.bbox.y1;
      var dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), d = Math.hypot(dx, dy);
      if (d >= st.blend) continue;
      var ring = st.ringHAt(x, y);                              // engine: floorH of the nearest outer-ring cell
      h = ring + (h - ring) * (d / st.blend);
    }
    return h;
  }
  // Defined for every finite (x, y), including far outside the 2048 m far grid (the recipe just keeps going).
  // Wrong call shapes (e.g. the v1 grid signature heightAt(G, x, y)) throw instead of silently returning NaN.
  function checkXY(fn, x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y))
      throw new TypeError('overworld_far.' + fn + '(x, y) needs two finite numbers (got ' + typeof x + ', ' + typeof y + '). ' +
                          'v2 is analytic: for a baked grid use util.gridHeight(G, x, y).');
  }
  // ED-TERRAIN-1a (arch 37.12): optional sparse edit layer (duck-typed: only heightDelta/typePaint are called),
  // module-global like the structure injection; Terrain's constructor always sets it (null = none).
  var EDITS = null;
  function setEditLayer(layer) { EDITS = layer || null; }
  function getEditLayer() { return EDITS; }
  // The delta is added BEFORE structureBlend, so a structure's ring handover stays exact.
  // baseHeightAt = stamps + delta WITHOUT the structure blend: what flatten/smooth must read (inside a footprint
  // structureBlend ignores the delta, so reading heightAt there makes the brush run away).
  function baseHeightAt(x, y) {
    checkXY('baseHeightAt', x, y);
    var h = applyStamps(recipeHeight(x, y), x, y);
    if (EDITS !== null) h += EDITS.heightDelta(x, y);
    return h;
  }
  function heightAt(x, y) {
    checkXY('heightAt', x, y);
    var h = applyStamps(recipeHeight(x, y), x, y);
    if (EDITS !== null) h += EDITS.heightDelta(x, y);
    return structureBlend(h, x, y);
  }

  // ---------------- analytic type ----------------
  var TYPE_IDS = { grass: 0, forest: 1, water: 2, rock: 3, path: 4 };
  // ED-TERRAIN-1b: optional hxp/hxm/hyp/hym = heightAt(x+e,y)/(x-e,y)/(x,y+e)/(x,y-e), e = slopeEps, handed in by a
  // baker that already holds those heights (bit-identical to computing them here; saves 4 heightAt per sample).
  function typeAt(x, y, hxp, hxm, hyp, hym, hc) {   // WM-01: hc = heightAt(x, y) when the baker already holds it (geoType would recompute it)
    checkXY('typeAt', x, y);
    var R = DEF.recipe, s = DEF.seed, T = DEF.tower, i;
    var dr = Math.abs(x - riverX(y));
    if (dr < R.river.halfWidth) return 2;
    if (EDITS !== null) { var ep = EDITS.typePaint(x, y); if (ep >= 0) return ep; }   // edit paint: over path/old paints, never over the river
    if (pathDist(x, y) < R.path.halfWidth) return 4;
    for (i = PAINTS.length - 1; i >= 0; i--) { var p = PAINTS[i]; if (shapeDist(p, x, y) <= 0) { if (p.mode === 'set') return TYPE_IDS[p.type]; break; } }
    var e = R.slopeEps, hx, hy;
    if (hxp === undefined) { hx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e); hy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e); }
    else { hx = (hxp - hxm) / (2 * e); hy = (hyp - hym) / (2 * e); }
    var slope = Math.sqrt(hx * hx + hy * hy), dh = Math.hypot(x - T.x, y - T.y), F = R.forest, K = R.rock;
    var rockHit = slope > K.slope || (dh > K.minHomeDist && fbm(x / K.scale, y / K.scale, s + 29, 2, 0.5, 2) > K.threshold);
    // OB-062b: the gentle carved bank beside the water (ring m past the band) is wet earth, not grey rock; only a real cliff stays rock
    if (rockHit && R.river.bankRock && dr < R.river.halfWidth + R.river.bankRock.ring && slope <= R.river.bankRock.slope) rockHit = false;
    var geoOn = GEO_N !== 0 && !inKeep(x, y);
    if (rockHit && !geoOn) return 3;
    if (rockHit) return geoType(3, x, y, hc === undefined ? heightAt(x, y) : hc, slope);   // MAP-02/03: sea/snow layers may override rock noise
    var base = 0;
    if (fbm(x / F.scale + 17, y / F.scale - 9, s + 13, F.octaves, 0.5, 2) > F.threshold && slope < F.maxSlope &&
        dr > F.riverClear && pathDist(x, y) > F.pathClear && dh > F.homeClear) base = 1;
    if (geoOn) return geoType(base, x, y, hc === undefined ? heightAt(x, y) : hc, slope);
    return base;
  }

  // ---------------- baking helpers ----------------
  function bake(x0, y0, cell, w, h) {           // any grid: far (8 m, whole map) or a near chunk (2 m, 64x64)
    var height = new Float32Array(w * h), type = new Uint8Array(w * h), i, j, x, y;
    if (cell === DEF.recipe.slopeEps) {
      // AUD-30: slopeEps == cell, so typeAt's +-eps heights ARE the neighbour sample centres: one heightAt per sample
      // (padded 1-ring, double precision), handed to typeAt (bit-identical to the 5-heightAt path).
      var pw = w + 2, H = new Float64Array(pw * (h + 2));
      for (j = 0; j < h + 2; j++) { y = y0 + (j - 1 + 0.5) * cell; for (i = 0; i < pw; i++) H[i + j * pw] = heightAt(x0 + (i - 1 + 0.5) * cell, y); }
      for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
        var q = (i + 1) + (j + 1) * pw;
        height[i + j * w] = H[q];
        type[i + j * w] = typeAt(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, H[q + 1], H[q - 1], H[q + pw], H[q - pw], H[q]);
      }
    } else for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      x = x0 + (i + 0.5) * cell; y = y0 + (j + 0.5) * cell;
      height[i + j * w] = heightAt(x, y); type[i + j * w] = typeAt(x, y);
    }
    return { x0: x0, y0: y0, w: w, h: h, cell: cell, height: height, type: type, TYPES: Object.keys(DEF.terrain).sort(function (a, b) { return DEF.terrain[a].id - DEF.terrain[b].id; }) };
  }
  function generate() { return bake(DEF.map.x0 || 0, DEF.map.y0 || 0, DEF.map.cell, DEF.map.w, DEF.map.h); }
  function bakeChunk(cx, cy) { var n = DEF.chunk.size / DEF.chunk.nearCell; return bake(cx * DEF.chunk.size, cy * DEF.chunk.size, DEF.chunk.nearCell, n, n); }
  function gridHeight(G, x, y) {                // bilinear on a baked grid; out of grid -> null
    var fx = (x - (G.x0 || 0)) / G.cell - 0.5, fy = (y - (G.y0 || 0)) / G.cell - 0.5, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= G.w - 1 || j >= G.h - 1) return null;
    var u = fx - i, v = fy - j, W = G.w, H0 = G.height;
    var a = H0[i + j * W], b = H0[i + 1 + j * W], c = H0[i + (j + 1) * W], d = H0[i + 1 + (j + 1) * W];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function chunkKey(x, y) { return Math.floor(x / DEF.chunk.size) + ',' + Math.floor(y / DEF.chunk.size); }

  DEF.util = {
    heightAt: heightAt, typeAt: typeAt, recipeHeight: recipeHeight, setEditLayer: setEditLayer, getEditLayer: getEditLayer, baseHeightAt: baseHeightAt,
    generate: generate, bake: bake, bakeChunk: bakeChunk, gridHeight: gridHeight, chunkKey: chunkKey,
    setGeoLayers: setGeoLayers, setGeoBiomes: setGeoBiomes, biomeAt: biomeAt, biomeBlend: biomeBlend, GeoFields: GeoFields, polylineSdf: polylineSdf, polygonSdf: polygonSdf,
    reindexOverrides: indexOverrides, hash: hash, fbm: fbm, riverX: riverX, pathDist: pathDist
  };
  A.levels.overworld_far = DEF;
})(typeof window !== 'undefined' ? window : globalThis);
