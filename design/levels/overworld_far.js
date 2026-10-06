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

  var DEF = {
    name: 'overworld_far',
    version: 2,
    map: { w: 256, h: 256, cell: 8 },                 // FAR grid: 2048 m x 2048 m, baked once
    chunk: { size: 128, nearCell: 2, note: 'D-007: 64x64 near cells of 2 m = 128 m chunks; 3x3 resident' },
    seed: 7331,

    tower:  { x: 1496.5, y: 1024.5, note: 'our Hollow Watchtower centre (level 16.5, 6.5)' },
    breach: { x: 1486.5, y: 1025.0, z: 7.6, yaw: 270, note: 'eye at the breach: level (6.5, 7.0), walkway 6.0 + eye 1.6, looking W' },

    // ---- terrain recipe (heights in m). All terms are smooth functions of (x, y). ----
    recipe: {
      home:    { top: 2.4, drop: 70, radius: 300, note: 'our hilltop, falls ~70 m into the land' },
      hill2:   { height: 58, radius: 170, note: 'hill crown under the far tower' },
      rolling: { scale: 520, octaves: 5, gain: 0.5, lacunarity: 2, amp: 34, flatNearHome: 150, flatNearTower2: 120 },
      river:   { base: 1120, a1: 110, p1: 260, a2: 45, p2: 95, ph2: 1.3, halfWidth: 10, carve: 2.0, carveEdge: [14, 8],
                 note: 'x_r(y) = base + a1 sin(y/p1) + a2 sin(y/p2 + ph2). Bed carved smoothly: carve * smoothstep(|x-x_r| 14 -> 8 m); water where |x-x_r| < halfWidth' },
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
                   species: [
                     { model: 'forestOakSmall',   weight: 22, trunkR: 0.53, trunkH: 2.55 },   // 7.20 m (raw import, owner 2026-10-04)
                     { model: 'forestOakLarge',   weight: 18, trunkR: 0.63, trunkH: 3.06 },   // 8.64 m (raw import, owner 2026-10-04)
                     { model: 'forestBirchSmall', weight: 15, trunkR: 0.39, trunkH: 2.70 },   // 6.00 m (raw import, owner 2026-10-04)
                     { model: 'forestBirchLarge', weight: 10, trunkR: 0.47, trunkH: 3.24 },   // 7.20 m (raw import, owner 2026-10-04)
                     { model: 'forestPineSmall',  weight: 20, trunkR: 0.34, trunkH: 1.50 },   // 6.00 m (raw import, owner 2026-10-04)
                     { model: 'forestPineLarge',  weight: 15, trunkR: 0.41, trunkH: 1.80 }    // 7.20 m (raw import, owner 2026-10-04)
                   ]
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
          { shape: 'capsule', ax: 1487, ay: 1000, bx: 1493, by: 1000, r: 6 }      // floodedCellar water rect [1485, 995, 1495, 1005]
        ],
        layers: [
          { name: 'tufts', seed: 38101, cellM: 2.5, jitter: 1.0, fill: 0.6, maxSlope: 0.7, clearM: 0.8, drawM: 28, lodCells: 4,
            ground: {
              grass:  [ { model: 'tuftMeadow', weight: 35, sinkM: 0.02 }, { model: 'tuftLush', weight: 30, sinkM: 0.02 },
                        { model: 'tuftShort', weight: 35, sinkM: 0.02 } ],
              forest: [ { model: 'tuftLush', weight: 50, sinkM: 0.02 }, { model: 'tuftShort', weight: 30, sinkM: 0.02 },
                        { model: 'pebbles', weight: 20, sinkM: 0.03 } ],
              rock:   [ { model: 'pebbles', weight: 50, sinkM: 0.03 }, { model: 'tuftShort', weight: 30, sinkM: 0.02 },
                        { model: 'rockSmallB', weight: 20, sinkM: 0.03 } ]
            } },
          { name: 'shrubs', seed: 38203, cellM: 5, jitter: 1.8, fill: 0.5, maxSlope: 0.55, clearM: 1.2, drawM: 45, lodCells: 4,
            ground: {
              grass:  [ { model: 'flowersYellow', weight: 20, sinkM: 0.02 }, { model: 'flowersWhite', weight: 16, sinkM: 0.02 },
                        { model: 'flowersPink', weight: 12, sinkM: 0.02 }, { model: 'bushRound', weight: 18, sinkM: 0.04, shadow: true },
                        { model: 'rockSmallA', weight: 12, sinkM: 0.03 }, { model: 'rockSmallB', weight: 10, sinkM: 0.03 },
                        { model: 'pebbles', weight: 12, sinkM: 0.03 } ],
              forest: [ { model: 'fern', weight: 40, sinkM: 0.02 }, { model: 'mushrooms', weight: 16, sinkM: 0.01 },
                        { model: 'bushRound', weight: 20, sinkM: 0.04, shadow: true }, { model: 'flowersWhite', weight: 8, sinkM: 0.02 },
                        { model: 'rockSmallA', weight: 8, sinkM: 0.03 }, { model: 'pebbles', weight: 8, sinkM: 0.03 } ],
              rock:   [ { model: 'rockSmallA', weight: 35, sinkM: 0.03 }, { model: 'rockSmallB', weight: 35, sinkM: 0.03 },
                        { model: 'pebbles', weight: 20, sinkM: 0.03 }, { model: 'tuftShort', weight: 10, sinkM: 0.02 } ]
            } },
          // rocks: maxSlope 0.35 + large sinkM 0.20 (half the 0.32-0.40 m foot layer): props are not tilted to the slope
          // (37.4: yaw only), so a 2.8 m flat-bottomed boulder must not show a gap on the downhill side.
          { name: 'rocks', seed: 38307, cellM: 11, jitter: 3.0, fill: 0.5, maxSlope: 0.35, clearM: 1.6, drawM: 70, lodCells: 4,
            ground: {
              grass:  [ { model: 'rockMedA',   weight: 28, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.44, h: 0.76 } } },
                        { model: 'rockMedB',   weight: 22, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.55, h: 0.75 } } },
                        { model: 'rockLargeA', weight: 10, sinkM: 0.20, shadow: true, collider: { prism: { r: 0.88, h: 1.52 } } },
                        { model: 'rockLargeB', weight: 6,  sinkM: 0.20, shadow: true, collider: { prism: { r: 1.10, h: 1.50 } } },
                        { model: 'logShort',   weight: 10, sinkM: 0.08, shadow: true, collider: { box: { hx: 0.96, hy: 0.24, h: 0.52 } } },
                        { model: 'stumpCut',   weight: 12, sinkM: 0.04, shadow: true, collider: { prism: { r: 0.33, h: 0.55 } } } ],
              forest: [ { model: 'logShort',   weight: 20, sinkM: 0.08, shadow: true, collider: { box: { hx: 0.96, hy: 0.24, h: 0.52 } } },
                        { model: 'logLong',    weight: 16, sinkM: 0.10, shadow: true, collider: { box: { hx: 1.43, hy: 0.33, h: 0.72 } } },
                        { model: 'stumpCut',   weight: 22, sinkM: 0.04, shadow: true, collider: { prism: { r: 0.33, h: 0.55 } } },
                        { model: 'rockMedB',   weight: 18, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.55, h: 0.75 } } },
                        { model: 'rockMedA',   weight: 10, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.44, h: 0.76 } } },
                        { model: 'rockLargeB', weight: 8,  sinkM: 0.20, shadow: true, collider: { prism: { r: 1.10, h: 1.50 } } } ],
              rock:   [ { model: 'rockLargeA', weight: 30, sinkM: 0.20, shadow: true, collider: { prism: { r: 0.88, h: 1.52 } } },
                        { model: 'rockLargeB', weight: 22, sinkM: 0.20, shadow: true, collider: { prism: { r: 1.10, h: 1.50 } } },
                        { model: 'rockMedA',   weight: 26, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.44, h: 0.76 } } },
                        { model: 'rockMedB',   weight: 22, sinkM: 0.06, shadow: true, collider: { prism: { r: 0.55, h: 0.75 } } } ]
            } }
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
      water:  { id: 2, colors: ['river', 'river', 'riverLight'], glyphs: { close: '~-~=', near: '~-', mid: '~-', far: '-~' }, face: '~', albedo: 0.90,
                glint: { hz: 1.5, amount: 0.35 } },
      rock:   { id: 3, colors: ['stoneDark', 'rock', 'stoneLight'], glyphs: { close: '#%&', near: '#%', mid: '%#', far: '%' }, face: '#%', albedo: 0.80 },
      path:   { id: 4, colors: ['strawDark', 'strawDark', 'straw'], glyphs: { close: '.:,', near: '.:', mid: '.', far: '.' }, face: ':', albedo: 0.70 }
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
        { id: 'foam', on: 'water', bands: ['close'], nearBank: 3, chance: 0.3, glyphs: '-=', colors: ['riverLight', 'white'] }
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
    return home + hill2 + roll + valley + ridge - carve;
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
  function heightAt(x, y) { checkXY('heightAt', x, y); return structureBlend(applyStamps(recipeHeight(x, y), x, y), x, y); }

  // ---------------- analytic type ----------------
  var TYPE_IDS = { grass: 0, forest: 1, water: 2, rock: 3, path: 4 };
  function typeAt(x, y) {
    checkXY('typeAt', x, y);
    var R = DEF.recipe, s = DEF.seed, T = DEF.tower, i;
    var dr = Math.abs(x - riverX(y));
    if (dr < R.river.halfWidth) return 2;
    if (pathDist(x, y) < R.path.halfWidth) return 4;
    for (i = PAINTS.length - 1; i >= 0; i--) { var p = PAINTS[i]; if (shapeDist(p, x, y) <= 0) { if (p.mode === 'set') return TYPE_IDS[p.type]; break; } }
    var e = R.slopeEps, hx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e), hy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
    var slope = Math.sqrt(hx * hx + hy * hy), dh = Math.hypot(x - T.x, y - T.y), F = R.forest, K = R.rock;
    if (slope > K.slope || (dh > K.minHomeDist && fbm(x / K.scale, y / K.scale, s + 29, 2, 0.5, 2) > K.threshold)) return 3;
    if (fbm(x / F.scale + 17, y / F.scale - 9, s + 13, F.octaves, 0.5, 2) > F.threshold && slope < F.maxSlope &&
        dr > F.riverClear && pathDist(x, y) > F.pathClear && dh > F.homeClear) return 1;
    return 0;
  }

  // ---------------- baking helpers ----------------
  function bake(x0, y0, cell, w, h) {           // any grid: far (8 m, whole map) or a near chunk (2 m, 64x64)
    var height = new Float32Array(w * h), type = new Uint8Array(w * h);
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
      height[i + j * w] = heightAt(x, y); type[i + j * w] = typeAt(x, y);
    }
    return { x0: x0, y0: y0, w: w, h: h, cell: cell, height: height, type: type, TYPES: ['grass', 'forest', 'water', 'rock', 'path'] };
  }
  function generate() { return bake(0, 0, DEF.map.cell, DEF.map.w, DEF.map.h); }
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
    heightAt: heightAt, typeAt: typeAt, recipeHeight: recipeHeight,
    generate: generate, bake: bake, bakeChunk: bakeChunk, gridHeight: gridHeight, chunkKey: chunkKey,
    reindexOverrides: indexOverrides, hash: hash, fbm: fbm, riverX: riverX, pathDist: pathDist
  };
  A.levels.overworld_far = DEF;
})(typeof window !== 'undefined' ? window : globalThis);
