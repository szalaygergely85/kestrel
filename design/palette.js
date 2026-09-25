/*
 * Kestrel (was "ASCII Quest") - master palette, glyph ramps, materials  (US-002, format v1; D-011 reskin v1.9)
 * Owner: Designer. Format documented in design/README.md.
 *
 * LOADING
 *   Classic script (works from file://, no build step):
 *     <script src="../design/palette.js"></script>
 *     const P = window.ASSETS.palette;
 *   From an ES module (only when served over http):
 *     import '../../design/palette.js';          // side-effect import, no named exports
 *     const P = window.ASSETS.palette;
 *   This file intentionally contains NO `export` statement so it loads both ways.
 *
 * All colors are '#rrggbb'. Materials / lights / UI reference colors by KEY (string),
 * never by raw hex, so the whole game can be re-colored from `colors` alone.
 * `util` is a REFERENCE implementation of the shading rules (used by the preview page);
 * the engine may re-implement it (LUTs, typed arrays) as long as results match.
 */
(function (root) {
  'use strict';
  var ASSETS = root.ASSETS = root.ASSETS || {};

  // ---------------------------------------------------------------------------
  // 1. NAMED COLORS
  // ---------------------------------------------------------------------------
  var colors = {
    // --- light sources (GDD 7.3) ---
    ambient:        '#2a3550', // cool blue fill, never fully black
    sun:            '#fff2d0', // warm white morning sun
    torch:          '#ff9a3c', // brazier fire light
    lantern:        '#ffd27a', // carried lantern, amber
    // --- fog ---
    fog:            '#262f45', // interior distance fog (dark cool blue-grey)
    fogFarNear:     '#8fa8c4', // far overworld fog at 50 m
    fogFar:         '#c4dcef', // far overworld fog at 1500 m (= horizon)
    // --- sky (morning, M1) ---
    skyTop:         '#2f6fc8',
    skyMid:         '#6fa3dc',
    skyHorizon:     '#c4dcef',
    cloudLit:       '#fff8ea',
    // --- stone ---
    stoneLight:     '#b8ab94',
    stoneMid:       '#8a7f6e',
    stoneDark:      '#4e4840',
    mortar:         '#2e2a26',
    flagstone:      '#7a7266', // floor slabs, a touch darker than walls
    rubble:         '#7d7466',
    scorch:         '#2a211c', // soot around the brazier
    moss:           '#6f8a3a',
    mossDark:       '#3b5226',
    // --- wood ---
    woodLight:      '#b07a48',
    wood:           '#8a5a32',
    woodDark:       '#5a3820',
    // --- metals ---
    ironLight:      '#9aa0a8',
    iron:           '#5c6068',
    ironDark:       '#34373d',
    rust:           '#7a4a2e',
    brassLight:     '#f0d27a', // interactable glint
    brass:          '#c9a04a',
    brassDark:      '#7a5e28',
    // --- ash, straw ---
    ashLight:       '#b9b5ae',
    ash:            '#8d8a86',
    ashDark:        '#55524f',
    strawLight:     '#ecd488',
    straw:          '#d6b45a',
    strawDark:      '#9c7e34',
    // --- fire (emissive, for US-011 brazier / US-022 beacon) ---
    flameCore:      '#fff4a0',
    flameMid:       '#ffc23c',
    flameOuter:     '#ff8a24',
    flameTip:       '#e8401c',
    ember:          '#ff5a1f',
    emberDark:      '#8a2a10',
    // --- far overworld (US-016) ---
    grassLight:     '#a6d060',
    grass:          '#6fae3e',
    grassDark:      '#3f7a2a',
    forest:         '#2f5a2a',
    forestDark:     '#1c3a1e',
    riverLight:     '#8fc8f0',
    river:          '#3f7fc4',
    rock:           '#8a8c90',
    farTower:       '#1a1d26', // the dark second beacon: unlit silhouette
    // --- semantic / UI (color language) ---
    heroGreen:      '#4fd66a',
    danger:         '#ff3b3b',
    magic:          '#3ce8ff',
    gold:           '#ffd24a',
    uiText:         '#e8e2d0',
    uiHint:         '#a9a390',
    uiDim:          '#6a6a78',
    dim:            '#4a4458', // "the Dim": desaturated violet-grey, colour being swallowed
    black:          '#000000',
    white:          '#ffffff',
    // --- time-of-day variants (M2+, M1 uses morning only) ---
    ambientNoon:    '#34405c',
    sunNoon:        '#fffaf0',
    ambientDusk:    '#3a2c48',
    sunDusk:        '#ffa860',
    skyDuskTop:     '#2c2a5a',
    skyDuskMid:     '#b0587a',
    skyDuskHorizon: '#ffb070',
    cloudDusk:      '#ffc8a0',
    fogDusk:        '#2e2436',
    ambientNight:   '#141c36',
    moon:           '#9fb4e0',
    skyNightTop:    '#050814',
    skyNightMid:    '#0e1630',
    skyNightHorizon:'#1f2c4a',
    cloudNight:     '#3a4668',
    fogNight:       '#101626',
    // --- detail pass v2 (PROPOSED, design/detail-pass.js). No live material uses these yet, ---
    // --- so the rendered image and the US-004b checksum are unchanged.                    ---
    stoneCool:      '#7e838c', // per-block stone tones (with stoneMid, stoneDeep)
    stoneWarm:      '#9c8c72',
    stoneDeep:      '#655d52',
    flagWarm:       '#8c7e68', // per-slab floor tones (with flagstone, flagDark)
    flagCool:       '#6f7174',
    flagDark:       '#5b544a',
    brickLight:     '#b8664a',
    brick:          '#9a4a36',
    brickDark:      '#6c3226',
    mossLight:      '#93ad4c',
    fogV2:          '#1f2638', // v2 interior fog: bg target (dark cool)
    fogV2Glyph:     '#5a6a90', // v2 interior fog: fg target (lighter haze, glyphs stay visible)
    // --- D-011 "Kestrel" reskin (v1.9). Fantasy first: magic = aether teal; brass / copper ONLY on machines. ---
    // aether (magic, crystals, the relay, the signal). Emissive use only; never on plain scenery.
    aetherCore:     '#e6fff9', // white-hot crystal core, brightest sparkle
    aetherLight:    '#8ffcec', // bright sparkle '+', crystal tips
    aether:         '#2fe0c6', // THE teal glow (relay light hue, signal)
    aetherMid:      '#1ea596', // reflected glow (mirror), mid sparkle
    aetherDim:      '#12665e', // dormant glint, dead relays on the chart
    aetherDead:     '#56686a', // lit (non-emissive) dead crystal: grey with a teal memory
    // machine metals (the Kestrel, the lamp, the relay mount, later doors / sentinels)
    brassHot:       '#fff0b4', // bright top step / rivet highlight / logo top row
    brassShadow:    '#4a3716', // plate seams, deep brass shadow
    copperLight:    '#ec9660',
    copper:         '#b85f2e',
    copperDark:     '#6c3318',
    verdigrisLight: '#80caa8', // copper / brass patina ( % : )
    verdigris:      '#3f8e76',
    verdigrisDark:  '#255446',
    mirror:         '#c4d0d8', // relay mirror, lit
    mirrorDark:     '#56626c', // relay mirror, dead / cracked
    // balloon canvas + rigging
    canvasLight:    '#f0ddaa', // pale ochre envelope ( ~ ) )
    canvas:         '#ccb27a',
    canvasDark:     '#8a7248',
    canvasScorch:   '#4a3826', // burnt tear edges
    ropeLight:      '#c8a870',
    rope:           '#9a7a48',
    ropeDark:       '#5e4a2c',
    // v1.14 ART-OWN-002: the envelope's red gores (alternate with the ochre ones) and the pale linen tarp of the wake spot
    goreRedLight:   '#d8765a',
    goreRed:        '#b04a36', // faded red envelope gore
    goreRedDark:    '#62281e',
    linenLight:     '#f6f1e4', // the spare tarp: near-white, cooler and paler than canvasLight
    linen:          '#d8d0bc',
    linenDark:      '#6c685e',
    // embers (the Kestrel burner) and steam
    emberHot:       '#ffa040', // glowing coal highlight (emissive)
    emberDim:       '#b43a14', // cooling coal (emissive)
    cinder:         '#3a2622', // cold cinder (lit, non-emissive)
    steam:          '#e6ecef', // steam near the source ( . ' ~ ), fades to fog
    steamDim:       '#98a2ac',
    // ivy (tower stone: tops and cracks)
    ivyLight:       '#80b04a',
    ivy:            '#4e8a36',
    ivyDark:        '#2a5424',
    // Ferrum on the horizon (warm amber pinpoints) + the Crown sky-chart (UI)
    ferrum:         '#ffb85a',
    ferrumDim:      '#a86e2c',
    // US-016 D-011 addendum: Ferrum's lights as seen on the far horizon (emissive pinpoints) + its wall/tiers silhouette.
    // Saturated amber, darker than skyHorizon so the pinpoints read by hue AND value against the pale morning horizon.
    cityLightHot:   '#ffb836', // the Crown's lamps "that never gutter" ( * ), top tier
    cityLight:      '#ff9a3a', // THE amber city light ( ' . ), upper tiers
    cityLightDim:   '#c46a2a', // Low Wards / wall lamps ( . ), bottom rows
    ferrumSil:      '#2c2a36', // wall-and-tiers silhouette hint (unlit, fog capped 0.55 -> pale blue-grey on the horizon)
    chartInk:       '#cc5c4a', // Crown print (faded red)
    pencil:         '#cfc8b2', // Wick's pencil
    chartEdge:      '#8a7a58'  // torn chart border
  };

  // ---------------------------------------------------------------------------
  // 2. GLYPH RAMPS  (string; index 0 = darkest = space, last = brightest)
  // ---------------------------------------------------------------------------
  var ramps = {
    // default: superset of the D-002 base ramp ' .:-=+*#%@' in the same order (14 steps)
    'default': ' .,:;-=+*o#%&@',
    // fine: 70-step classic ramp for smooth gradients (fades, UI, far view)
    fine:      " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    // materials
    stone:     ' .,:;+%#&@',     // chunky carved stone
    wood:      ' .-:=+|IH#',     // grain lines and planks
    iron:      ' .:-=+xX#M',     // hard, metallic, heavy top end
    floor:     ' .,-:;=+*#%',    // flagstone floor, lower density than walls
    ash:       " .,':;\"^*%",    // powdery ash
    rubble:    ' .,:;oO%#&@',    // pebbles and broken blocks
    sky:       " .'-~=+*",       // cloud wisps (density ramp, sky is emissive)
    // effects / far terrain (used by US-011, US-016)
    fire:      " .',^*%#",
    grass:     " .,'\";:",
    foliage:   ' .:*%&@',
    water:     ' .-~=+',
    // D-011 reskin (v1.9)
    brass:     ' .:-=+o*#%',     // machine brass: plates = ; rivets o; bright top steps
    copper:    ' .:-=+x#%&',     // copper: pipes, burner can; verdigris via texture '%'
    canvas:    " .'-~)(=%",      // balloon envelope: folds ) ( and seams ~
    aether:    " .'+*",           // aether sparkle (effects only; emissive)
    // US-016 D-011 addendum
    cityLight: " .'*"             // Ferrum's horizon pinpoints (emissive, pairs with colorRamps.cityLight)
  };

  // ---------------------------------------------------------------------------
  // 2b. COLOR RAMPS  (arrays of color keys, dim -> bright; pair with a glyph ramp of the same name)
  //   pick: k = round(g * (n - 1)) for a glow level g in 0..1 (g = 0 -> first key, never "off": off = don't draw).
  //   aether: the teal glow family, dormant -> white-hot core. US-016 signal-tower light (fixed k), US-022 relay wake
  //           (g ramps 0 -> 1 with lights.relay.grow), the P2 SOS pulse (g follows the pulse), later gauntlet spells.
  //   cityLight: Ferrum's amber pinpoints on the horizon (US-016), Low Wards -> the Crown.
  // ---------------------------------------------------------------------------
  var colorRamps = {
    aether:    ['aetherDim', 'aetherMid', 'aether', 'aetherLight', 'aetherCore'],
    cityLight: ['cityLightDim', 'cityLight', 'cityLightHot']
  };

  // ---------------------------------------------------------------------------
  // 3. SHADING CONSTANTS  (see README "Shading pipeline")
  // ---------------------------------------------------------------------------
  var shading = {
    cutoff: 0.03,          // brightness below this -> ramp index 0 (space)
    rampGamma: 0.85,       // default brightness -> ramp curve (b^gamma)
    fgMin: 0.32,           // fg color gain at b = 0 (keeps dim glyphs visible)
    fgGamma: 0.75,         // fg gain curve
    fgMaxGain: 1.2,        // gain cap when overbright
    tint: 0.85,            // how strongly light hue tints the material (0 = none, 1 = full)
    overbright: 0.6,       // b above 1 pushes fg toward the light hue (hot highlight)...
    overbrightMax: 0.5,    // ...by at most this much
    glyphOverrideMinIndex: 2 // texture glyph overrides only when ramp index >= this
  };

  // ---------------------------------------------------------------------------
  // 4. LIGHTS  (GDD 7.3 values; hue = color normalised to max channel 1)
  // ---------------------------------------------------------------------------
  var lights = {
    ambient: { color: 'ambient', intensity: 0.12 },
    sun:     { color: 'sun', intensity: 1.0, type: 'directional',
               elevation: 60, azimuth: 112.5 },           // compass deg, 0 = N, clockwise; ESE; light comes FROM here
    torch:   { color: 'torch', intensity: 1.0, type: 'point', radius: 6, falloff: 'smooth',
               flicker: { hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 } },
    lantern: { color: 'lantern', intensity: 0.8, type: 'point', radius: 5, falloff: 'smooth',
               flicker: { hzMin: 8, hzMax: 12, amount: 0.05, jitter: 0.0 },
               hold: { right: 0.3, down: 0.3, forward: 0.4 } },
    // OWN-REQ-006: the brass lamp burning on its hook (tower.js lights id 'lanternHook', at the voxel lantern `light`
    // mount). Same amber as the carried lamp but smaller + dimmer, so the corner glows without out-shining the burner
    // (torch 1.0 / 6 m, 1.22 m away) and the pickup reads as "the light is mine now" (carried = 0.8 / 5 m).
    lanternHook: { color: 'lantern', intensity: 0.55, type: 'point', radius: 3.5, falloff: 'smooth',
                   flicker: { hzMin: 6, hzMax: 9, amount: 0.05, jitter: 0.02 } },
    beacon: { color: 'torch', intensity: 1.0, type: 'point', radius: 12, falloff: 'smooth',
               flicker: { hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 } },  // US-022 (legacy fire beacon)
    // D-011: the woken relay (US-022 "wake the relay"). Cool teal, slow breathing, not a fire flicker.
    // The Kestrel burner keeps the `torch` preset (D-011: "same light preset").
    relay:   { color: 'aether', intensity: 0.9, type: 'point', radius: 10, falloff: 'smooth',
               flicker: { hzMin: 0.4, hzMax: 0.9, amount: 0.10, jitter: 0.0 },
               grow: { duration: 1.0, note: 'intensity ramps 0 -> 1 with the relay "wake" animation (light on at wake frame 2)' } }
  };

  // ---------------------------------------------------------------------------
  // 5. FOG
  // ---------------------------------------------------------------------------
  var fog = {
    glyphLevel: 0.0,   // brightness glyphs fade toward (0 = space at full fog)
    interior: { color: 'fog', start: 12, full: 60, curve: 1.0 },          // meters
    far:      { color: 'fogFarNear', colorFar: 'fogFar', start: 50, full: 1500, curve: 0.7 } // US-016
  };

  // ---------------------------------------------------------------------------
  // 6. TIME OF DAY  (M1 = morning; others are ready for M2 day/night)
  // ---------------------------------------------------------------------------
  var timeOfDay = {
    morning: { ambient: 'ambient',      ambientI: 0.12, sun: 'sun',     sunI: 1.0,  sunElev: 60,
               sky: [{ t: 0, c: 'skyHorizon' }, { t: 0.35, c: 'skyMid' }, { t: 1, c: 'skyTop' }],
               cloud: 'cloudLit', fog: 'fog' },
    noon:    { ambient: 'ambientNoon',  ambientI: 0.16, sun: 'sunNoon', sunI: 1.1,  sunElev: 75,
               sky: [{ t: 0, c: 'skyHorizon' }, { t: 0.3, c: 'skyMid' }, { t: 1, c: 'skyTop' }],
               cloud: 'white', fog: 'fog' },
    dusk:    { ambient: 'ambientDusk',  ambientI: 0.10, sun: 'sunDusk', sunI: 0.8,  sunElev: 10,
               sky: [{ t: 0, c: 'skyDuskHorizon' }, { t: 0.3, c: 'skyDuskMid' }, { t: 1, c: 'skyDuskTop' }],
               cloud: 'cloudDusk', fog: 'fogDusk' },
    night:   { ambient: 'ambientNight', ambientI: 0.06, sun: 'moon',    sunI: 0.25, sunElev: 40,
               sky: [{ t: 0, c: 'skyNightHorizon' }, { t: 0.3, c: 'skyNightMid' }, { t: 1, c: 'skyNightTop' }],
               cloud: 'cloudNight', fog: 'fogNight' }
  };

  // ---------------------------------------------------------------------------
  // 7. MATERIALS
  //   texture.rows are written TOP-DOWN as they look on the wall; one char per texel,
  //   each char is a key into texture.key. scale = texels per meter [u, v].
  //   key entry: { shade: brightness multiplier, tint?: colorKey, amount?: 0..1, glyph?: char }
  // ---------------------------------------------------------------------------
  var STONE_KEY = {
    m: { shade: 0.42 },            // mortar line
    h: { shade: 1.12 },            // lit top edge of a block
    a: { shade: 1.00 },            // block face
    e: { shade: 0.90 },            // block face, darker block
    f: { shade: 1.06 },            // block face, lighter block
    c: { shade: 0.82 },            // underside shade of a block
    x: { shade: 0.62 }             // chip / crack
  };
  function withKeys(baseKey, extra) {
    var k, o = {};
    for (k in baseKey) o[k] = baseKey[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }

  var materials = {
    stone: {
      desc: 'Tower wall: coursed blocks 0.5 x 0.25 m, staggered, dark mortar lines.',
      base: 'stoneMid', albedo: 0.85, ramp: 'stone',
      bg: { mode: 'darken', k: 0.20 },
      textureFade: [6, 16],
      texture: { w: 16, h: 8, scale: [16, 16], key: STONE_KEY, rows: [
        'mmmmmmmmmmmmmmmm',
        'mhhhhhhhmhhhhhhh',
        'maaxaaaameeeexee',
        'mcccccccmccccccc',
        'mmmmmmmmmmmmmmmm',
        'hhhhmhhhhhhhmhhh',
        'aaaamfffffxfmaaa',
        'ccccmcccccccmccc'
      ] }
    },
    stone_moss: {
      desc: 'Stone with moss in the joints; moss only near the floor (tintBand), north side.',
      base: 'stoneMid', albedo: 0.80, ramp: 'stone',
      bg: { mode: 'darken', k: 0.20 },
      textureFade: [6, 16],
      tintBand: { full: 1.0, zero: 2.2 },   // tint 100% up to 1.0 m above floor, 0% at 2.2 m
      texture: { w: 16, h: 8, scale: [16, 16], key: withKeys(STONE_KEY, {
        g: { shade: 0.95, tint: 'moss', amount: 0.80 },
        G: { shade: 0.70, tint: 'mossDark', amount: 0.90 }
      }), rows: [
        'mgmmmmGgmmmmmgGm',
        'mhhhhhhhGhhhhhhh',
        'maaxaaaageeeexee',
        'gcccccgcmccccgcc',
        'mmGgmmmmmmgGGmmm',
        'hhhhghhhhhhhmhhh',
        'aaaaGfffffxfgaaa',
        'cgccGccgccccGcgc'
      ] }
    },
    stone_scorched: {
      desc: 'Stone blackened by the brazier; soot fades out with height (tintBand).',
      base: 'stoneMid', albedo: 0.75, ramp: 'stone',
      bg: { mode: 'darken', k: 0.18 },
      textureFade: [6, 16],
      tintBand: { full: 0.8, zero: 2.5 },
      texture: { w: 16, h: 8, scale: [16, 16], key: withKeys(STONE_KEY, {
        s: { shade: 0.60, tint: 'scorch', amount: 0.65 },
        S: { shade: 0.38, tint: 'scorch', amount: 0.90 }
      }), rows: [
        'mmmmmmmmmmmmmmmm',
        'mhhshhhhmhhhhshh',
        'masxsaaamesSeexe',
        'mcsSscccmcsSSscc',
        'mmSmmmmmmmSSmmmm',
        'hhshmhhhhshhmhsh',
        'asSsmfffsSsfmasS',
        'cSSSmcccSSSSmcSS'
      ] }
    },
    floor: {
      desc: 'Flagstone floor 0.5 m slabs, grout lines, dusted with ash. Sampled with world x,y.',
      base: 'flagstone', albedo: 0.75, ramp: 'floor',
      bg: { mode: 'darken', k: 0.16 },
      textureFade: [5, 14],
      texture: { w: 8, h: 8, scale: [8, 8], key: {
        g: { shade: 0.50 },                                  // grout
        a: { shade: 1.00 },
        b: { shade: 1.08 },
        c: { shade: 0.90 },
        k: { shade: 0.65 },                                  // crack
        d: { shade: 1.04, tint: 'ash', amount: 0.40 }        // ash dust
      }, rows: [
        'gggggggg',
        'gabagcba',
        'gbkagabd',
        'gaadgcab',
        'gggggggg',
        'abgbaagc',
        'dagcakga',
        'bcgaabgd'
      ] }
    },
    ash: {
      desc: 'Cold ash: around the brazier and in the beacon bowl. Soft, low contrast.',
      base: 'ash', albedo: 0.70, ramp: 'ash',
      bg: { mode: 'darken', k: 0.18 },
      textureFade: [4, 12],
      texture: { w: 8, h: 4, scale: [8, 8], key: {
        a: { shade: 1.00 },
        l: { shade: 1.12, tint: 'ashLight', amount: 0.5 },
        d: { shade: 0.80, tint: 'ashDark', amount: 0.5 }
      }, rows: [
        'aladaala',
        'dalaadal',
        'aadlalaa',
        'ladaadla'
      ] }
    },
    wood: {
      desc: 'Planks (pallet, beams, lever handle). Horizontal grain, knots, seams every 0.4 m.',
      base: 'wood', albedo: 0.70, ramp: 'wood',
      bg: { mode: 'darken', k: 0.20 },
      textureFade: [5, 14],
      texture: { w: 8, h: 8, scale: [10, 20], key: {
        a: { shade: 1.00 },
        h: { shade: 1.10, tint: 'woodLight', amount: 0.4 },
        l: { shade: 0.80, tint: 'woodDark', amount: 0.4 },   // grain line
        k: { shade: 0.60, tint: 'woodDark', amount: 0.7, glyph: 'o' }, // knot
        s: { shade: 0.40 }                                    // seam between planks
      }, rows: [
        'hhhhhhhh',
        'aalaaaal',
        'aaaakaaa',
        'llaaaall',
        'ssssssss',
        'haaahhaa',
        'aallaaaa',
        'alaaaaka'
      ] }
    },
    iron: {
      desc: 'Riveted iron plate (brazier, bowl, grate frame). Specular highlight toward light hue.',
      base: 'iron', albedo: 0.60, ramp: 'iron', spec: 0.40,
      bg: { mode: 'darken', k: 0.15 },
      textureFade: [5, 14],
      texture: { w: 8, h: 8, scale: [8, 8], key: {
        s: { shade: 0.45, tint: 'ironDark', amount: 0.5 },  // plate seam
        a: { shade: 1.00 },
        d: { shade: 0.85 },
        r: { shade: 1.30, tint: 'ironLight', amount: 0.5, glyph: 'o' }, // rivet
        u: { shade: 0.80, tint: 'rust', amount: 0.60 }      // rust bloom
      }, rows: [
        'ssssssss',
        'sraaaara',
        'saadaaua',
        'saauaada',
        'sadaaaaa',
        'saaadaua',
        'sraaaara',
        'saaudaaa'
      ] }
    },
    rubble: {
      desc: 'Fallen blocks and gravel heaps (0.3-0.9 m). Irregular, pebbly, high contrast.',
      base: 'rubble', albedo: 0.80, ramp: 'rubble',
      bg: { mode: 'darken', k: 0.20 },
      textureFade: [5, 14],
      texture: { w: 8, h: 4, scale: [8, 8], key: {
        h: { shade: 1.20, tint: 'stoneLight', amount: 0.4 },
        a: { shade: 1.00 },
        c: { shade: 0.75 },
        d: { shade: 0.50, tint: 'stoneDark', amount: 0.5 },
        o: { shade: 1.10, glyph: 'o' }
      }, rows: [
        'hacdahco',
        'cadhacad',
        'dhacdaha',
        'acahdcad'
      ] }
    },
    grate: {
      desc: 'US-011 portcullis: iron bars | every 0.25 m, crossbar = every 0.5 m, # at joints. Tileable in both axes, ' +
            'so the grate face can slide with the rising ceiling (texture v anchored to the grate bottom edge). ' +
            'Gap texels are marked hole:true (see-through if the engine supports masked walls, else dark).',
      base: 'iron', albedo: 0.65, ramp: 'iron', spec: 0.35,
      bg: { mode: 'darken', k: 0.12 },
      textureFade: [6, 18],
      texture: { w: 4, h: 8, scale: [16, 16], key: {
        j: { shade: 1.15, glyph: '#' },                          // joint (bar x crossbar)
        c: { shade: 0.95, glyph: '=' },                          // crossbar
        b: { shade: 1.00, glyph: '|' },                          // bar
        B: { shade: 0.85, tint: 'rust', amount: 0.45, glyph: '|' }, // rusty bar section
        g: { shade: 0.06, hole: true }                           // gap between bars
      }, rows: [
        'jccc',
        'bggg',
        'bggg',
        'Bggg',
        'bggg',
        'bggg',
        'Bggg',
        'bggg'
      ] }
    },
    grass: {
      desc: 'Hill turf outside the tower (US-010 outcrop path, outside ring). Sampled with world x,y.',
      base: 'grass', albedo: 0.80, ramp: 'grass',
      bg: { mode: 'darken', k: 0.22 },
      textureFade: [5, 16],
      texture: { w: 8, h: 4, scale: [8, 8], key: {
        a: { shade: 1.00 },
        l: { shade: 1.15, tint: 'grassLight', amount: 0.5 },
        d: { shade: 0.75, tint: 'grassDark', amount: 0.6 },
        f: { shade: 1.05, glyph: '"' }                       // tuft
      }, rows: [
        'aldaalda',
        'daalfdal',
        'ladaadla',
        'aafdlaad'
      ] }
    },
    rock: {
      desc: 'Natural hill rock (outcrop, spur under the summit bastion). Rougher and greyer than cut stone.',
      base: 'rock', albedo: 0.80, ramp: 'rubble',
      bg: { mode: 'darken', k: 0.20 },
      textureFade: [5, 16],
      texture: { w: 8, h: 4, scale: [8, 8], key: {
        h: { shade: 1.15, tint: 'stoneLight', amount: 0.3 },
        a: { shade: 1.00 },
        c: { shade: 0.80 },
        d: { shade: 0.55, tint: 'stoneDark', amount: 0.5 }
      }, rows: [
        'haacdaha',
        'acdhaacd',
        'dahacdaa',
        'caadhaca'
      ] }
    },
    sky: {
      kind: 'sky',
      desc: 'Open sky for "sky" ceilings. Emissive (not lit, not fogged). Color = vertical gradient ' +
            'by elevation angle; glyph = cloud density from texture. Sampled with (azimuth deg, elevation deg).',
      ramp: 'sky', elevTop: 60,          // gradient t = elevation / elevTop (clamped)
      cloudBand: [2, 35, 55],            // clouds fade in 0->2 deg, full to 35, gone by 55 deg
      texture: { w: 32, h: 8, scale: [96 / 360, 0.2], key: {
        '.': { shade: 0.00 },
        a:   { shade: 0.30 },
        b:   { shade: 0.55 },
        c:   { shade: 0.85 }
      }, rows: [
        '................................',
        '......aab.............aa........',
        '....abbccba.........abbba.......',
        '..aabcccccbaa.....aabccbbaa.....',
        '.....aabbbaa..........aaa.......',
        '................................',
        '.............abba...............',
        '...........aabccbaa.............'
      ] }
    }
  };

  // --- D-011 "Kestrel" reskin materials (v1.9). Appended AFTER sky so the ids of the 11 M1 materials do not move. ---
  // Ivy: the stone texture with vines trailing down through the joints (overlay mask: '.' = keep the stone texel).
  function overlayRows(rows, mask) {
    return rows.map(function (r, y) {
      var m = mask[y] || '', o = '', x;
      for (x = 0; x < r.length; x++) { var c = m.charAt(x); o += (c && c !== '.') ? c : r.charAt(x); }
      return o;
    });
  }
  var STONE_ROWS = materials.stone.texture.rows;
  materials.stone_ivy = {
    desc: 'Tower stone overgrown with ivy: vines trail down the joints over the FULL height (no tintBand), leaf clumps ; on the faces. ' +
          'D-011 "moss and ivy on stone tops and cracks". Walls where the Kestrel broke the crown and the summit bastion.',
    base: 'stoneMid', albedo: 0.80, ramp: 'stone',
    bg: { mode: 'darken', k: 0.20 },
    textureFade: [6, 16],
    texture: { w: 16, h: 8, scale: [16, 16], key: withKeys(STONE_KEY, {
      i: { shade: 0.92, tint: 'ivy', amount: 0.85 },                 // vine
      I: { shade: 0.70, tint: 'ivyDark', amount: 0.90 },             // vine in shadow
      L: { shade: 1.05, tint: 'ivyLight', amount: 0.80, glyph: ';' } // leaf clump
    }), rows: overlayRows(STONE_ROWS, [
      '..Ii......Li....',
      '..iI.......L....',
      '..Li......Ii....',
      '...i.......I....',
      '..iL......iI....',
      '..I........i....',
      '...i.....L.I....',
      '..iI......Ii....'
    ]) }
  };
  materials.moss_top = {
    desc: 'Wall tops, ledges and the summit walkway edge: cap stones with moss cushions in the grout and on the slabs ( " , ; ). ' +
          'Sampled with world x,y (a floor / solid-top material).',
    base: 'flagstone', albedo: 0.76, ramp: 'floor',
    bg: { mode: 'darken', k: 0.18 },
    textureFade: [5, 14],
    texture: { w: 8, h: 8, scale: [8, 8], key: {
      g: { shade: 0.50 },                                              // grout
      a: { shade: 1.00 }, b: { shade: 1.08 }, c: { shade: 0.90 },
      m: { shade: 0.95, tint: 'moss', amount: 0.80 },
      M: { shade: 0.75, tint: 'mossDark', amount: 0.90 },
      l: { shade: 1.10, tint: 'mossLight', amount: 0.70, glyph: '"' }  // cushion top
    }, rows: [
      'gggggggg',
      'gammbacm',
      'gMmlmabm',
      'gammMacb',
      'gggmgggg',
      'abgmMaga',
      'mlgammga',
      'bmgaMlgm'
    ] }
  };
  materials.brass = {
    desc: 'MACHINE ONLY. Brass plate: the Kestrel gondola hull, the relay mount, later pressure doors and sentinels. ' +
          '0.5 m plates, dark seams, a bright top step on every plate, rivets o, the odd verdigris spot. Strong spec.',
    base: 'brass', albedo: 0.72, ramp: 'brass', spec: 0.55,
    bg: { mode: 'darken', k: 0.16 },
    textureFade: [5, 14],
    texture: { w: 8, h: 8, scale: [16, 16], key: {
      s: { shade: 0.50, tint: 'brassShadow', amount: 0.60 },         // plate seam
      h: { shade: 1.22, tint: 'brassHot', amount: 0.45 },            // bright top step
      a: { shade: 1.00 }, d: { shade: 0.86 },
      r: { shade: 1.30, tint: 'brassHot', amount: 0.50, glyph: 'o' }, // rivet
      v: { shade: 0.85, tint: 'verdigris', amount: 0.45 }            // patina spot
    }, rows: [
      'ssssssss',
      'shhhhhhh',
      'sraaaara',
      'saadaaaa',
      'saaaavda',
      'sadaaaaa',
      'saaaadaa',
      'sraaaara'
    ] }
  };
  materials.copper = {
    desc: 'MACHINE ONLY. Copper: the Kestrel burner can, pipes and boiler bands. Red-orange with verdigris ( % ) blooming along ' +
          'the seams. Horizontal bands 0.5 m.',
    base: 'copper', albedo: 0.66, ramp: 'copper', spec: 0.45,
    bg: { mode: 'darken', k: 0.16 },
    textureFade: [5, 14],
    texture: { w: 8, h: 8, scale: [16, 16], key: {
      s: { shade: 0.50, tint: 'copperDark', amount: 0.60 },          // band seam
      h: { shade: 1.20, tint: 'copperLight', amount: 0.50 },         // top highlight
      a: { shade: 1.00 }, d: { shade: 0.86 },
      v: { shade: 0.90, tint: 'verdigris', amount: 0.75, glyph: '%' },
      w: { shade: 1.00, tint: 'verdigrisLight', amount: 0.60, glyph: ':' }
    }, rows: [
      'hhhhhhhh',
      'aaavaaaa',
      'aavvwaad',
      'aaavaaaa',
      'ssssssss',
      'daaaaaav',
      'aaahaavv',
      'aaaaaaaw'
    ] }
  };
  materials.canvas = {
    desc: 'The Kestrel envelope: pale ochre balloon canvas in 0.6 m gores, folds ) (, seams ~, burnt tear edges. ' +
          'For sheets drawn as geometry (the canvas hanging in the stairwell); the smaller pieces are sprites (models/wreckage.js).',
    base: 'canvas', albedo: 0.80, ramp: 'canvas',
    bg: { mode: 'darken', k: 0.20 },
    textureFade: [5, 14],
    texture: { w: 8, h: 4, scale: [12, 8], key: {
      a: { shade: 1.00 },
      l: { shade: 1.12, tint: 'canvasLight', amount: 0.50, glyph: ')' }, // lit fold
      k: { shade: 0.78, tint: 'canvasDark', amount: 0.50, glyph: '(' },  // shadow fold
      s: { shade: 0.60, tint: 'canvasDark', amount: 0.70 },              // gore seam
      t: { shade: 0.50, tint: 'canvasScorch', amount: 0.70 }             // scorch
    }, rows: [
      'saalkaal',
      'salkkaal',
      'saalkaat',
      'saalkaal'
    ] }
  };
  // US-040 step 4 / OWN-REQ-001: voxel prop materials (design/models/voxel_props.js `ASSETS.voxelMaterials.v1`,
  // merged verbatim per that file's header "MERGE STEP STILL OPEN"). Appended after canvas so no existing
  // material id moves (ids are assigned by MaterialTable's Object.keys insertion order).
  materials.brass_light = {
    desc: 'VOXEL PROPS. Bright brass rim / top edges (lever plate frame, lamp base + hood rims). Catches the light first.',
    base: 'brassLight', albedo: 0.95, ramp: 'brass', spec: 0.60,
    bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [40, 40], key: {
      a: { shade: 1.00 }, h: { shade: 1.14, tint: 'brassHot', amount: 0.50 }, d: { shade: 0.90 }
    }, rows: ['haah', 'aada', 'ahaa', 'daah'] }
  };
  materials.brass_hot = {
    desc: 'VOXEL PROPS. Rivets, the lever knob and gear teeth, the lamp finial: white-hot brass with a faint self-glow ' +
          '(emissive 0.10) so the lever / lamp stay findable in shade (finding 3). Not a light source.',
    base: 'brassHot', albedo: 1.00, ramp: 'brass', spec: 0.70, emissive: 0.10,
    bg: { mode: 'darken', k: 0.20 }, textureFade: [4, 12]
  };
  materials.brass_dark = {
    desc: 'VOXEL PROPS. Dark brass body (lever plate, lamp base / rails / hood, bracket plate). Quiet, low value, so the ' +
          'rim and the handle read against it and it never matches the stone.',
    base: 'brassDark', albedo: 0.62, ramp: 'brass', spec: 0.30,
    bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [40, 40], key: {
      a: { shade: 1.00 }, s: { shade: 0.72, tint: 'brassShadow', amount: 0.60 }
    }, rows: ['aaaa', 'asaa', 'aaaa', 'aaas'] }
  };
  materials.iron_light = {
    desc: 'VOXEL PROPS. Light iron: the lever handle rod, the lamp bail, top edge of the bracket arm. Cool grey on dark brass.',
    base: 'ironLight', albedo: 0.85, ramp: 'iron', spec: 0.50,
    bg: { mode: 'darken', k: 0.15 }, textureFade: [4, 12]
  };
  materials.iron_dark = {
    desc: 'VOXEL PROPS. Dark iron: lever foot + post + the back plate that frames the rim (the dark contour), the lamp ' +
          'burner, the bracket arm / hook. Darkest value of the set.',
    base: 'ironDark', albedo: 0.60, ramp: 'iron', spec: 0.25,
    bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12]
  };
  // US-056 lamp glint (design v1.14, designer merge): voxel_props.js `voxelMaterials.v1.brass_glint`, appended last so no id moves.
  materials.brass_glint = {
    desc: 'VOXEL PROPS (US-056). The lamp\'s "take me" glint: a white-hot sparkle cross that flashes on the hood rim for ' +
          '0.26 s every ~2 s (lantern clip unlit). Emissive 0.90 so it pops in shade; never on a static voxel.',
    base: 'white', albedo: 1.00, ramp: 'brass', spec: 0.90, emissive: 0.90,
    bg: { mode: 'darken', k: 0.25 }, textureFade: [4, 12],
    texture: { w: 2, h: 2, scale: [40, 40], key: {
      a: { shade: 1.00, glyph: '*' }, h: { shade: 1.00, tint: 'brassHot', amount: 0.40, glyph: '+' }
    }, rows: ['ah', 'ha'] }
  };
  // US-056 batch 2 (design/models/voxel_tower.js `voxelMaterials.v1`, merge step): the remaining solid tower props
  // (boulder, rubble, canvas heap, gondola, strut, envelope heap, relay). Appended after brass_glint so no existing
  // material id moves. 18 keys (12 of batch 2 + 6 of the ART-OWN-002 rework: linen_light/linen/linen_dark,
  // gore_red/gore_red_dark, canvas_burnt).
  materials.canvas_light = {
    desc: 'VOXEL PROPS (wreck). Bright crests of crumpled envelope canvas: fold tops, the high ridge of a heap. Pale ochre, ' +
          'the brightest thing on the floor after the sun patch.',
    base: 'canvasLight', albedo: 0.92, ramp: 'canvas', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, f: { shade: 1.10, glyph: ')' }, s: { shade: 0.88, tint: 'canvas', amount: 0.5 }
    }, rows: ['aafa', 'asaa', 'faaa', 'aasf'] }
  };
  materials.canvas_dark = {
    desc: 'VOXEL PROPS (wreck). Canvas in the fold shadows, the flanks of the folds, the hem on the floor and the scorched ' +
          'ends (canvasScorch tone). The heap\'s dark body and ground contour.',
    base: 'canvasDark', albedo: 0.66, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, t: { shade: 0.62, tint: 'canvasScorch', amount: 0.75 }, f: { shade: 0.90, glyph: '(' }
    }, rows: ['atfa', 'aaat', 'fata', 'taaa'] }
  };
  materials.patina = {
    desc: 'VOXEL PROPS (machine). Verdigris on brass: the gondola dent, the strut kink, spots on the relay bowl. Teal-green, ' +
          'so a bend or dent reads as damage and not as a hole.',
    base: 'verdigris', albedo: 0.80, ramp: 'copper', spec: 0.20, bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, l: { shade: 1.15, tint: 'verdigrisLight', amount: 0.6, glyph: '%' },
      d: { shade: 0.78, tint: 'verdigrisDark', amount: 0.6 }
    }, rows: ['alad', 'daal', 'lada', 'adla'] }
  };
  materials.rope = {
    desc: 'VOXEL PROPS (wreck). Rope: the snapped stays on the gondola rail, the rope bands over the canvas heaps. ' +
          'Twist = alternating light ) / dark ( texels.',
    base: 'rope', albedo: 0.85, ramp: 'canvas', bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
    texture: { w: 2, h: 2, scale: [16, 16], key: {
      l: { shade: 1.15, tint: 'ropeLight', amount: 0.6, glyph: ')' }, d: { shade: 0.75, tint: 'ropeDark', amount: 0.6, glyph: '(' }
    }, rows: ['ld', 'dl'] }
  };
  materials.block_light = {
    desc: 'VOXEL PROPS (rubble). Weathered top faces and top edges of fallen cut blocks: pale, lime-washed by the rain. ' +
          'Much lighter than any wall stone, so a block on the rubble floor has a bright lid.',
    base: 'pencil', albedo: 0.92, ramp: 'stone', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, h: { shade: 1.08, tint: 'ashLight', amount: 0.4 }, x: { shade: 0.80, glyph: ',' }
    }, rows: ['aaha', 'haax', 'axah', 'aaaa'] }
  };
  materials.block_dark = {
    desc: 'VOXEL PROPS (rubble). The broken sides of the fallen blocks and the pebbles\' shadow sides: dark, so the block ' +
          'separates from the mid-value rubble floor and the wall behind it.',
    base: 'stoneDark', albedo: 0.62, ramp: 'stone', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, c: { shade: 0.70, tint: 'ashDark', amount: 0.5 }, x: { shade: 0.55, glyph: ',' }
    }, rows: ['aaca', 'caaa', 'aaxa', 'acaa'] }
  };
  materials.granite_light = {
    desc: 'VOXEL PROPS (boulder). The upper band of the boulder under its moss cap: cool pale granite with bright ' +
          'specks. Neutral / cool, never the warm wall beige.',
    base: 'ashLight', albedo: 0.90, ramp: 'rubble', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, s: { shade: 1.12, tint: 'steam', amount: 0.3 }, d: { shade: 0.85, tint: 'rock', amount: 0.5 }
    }, rows: ['asad', 'daas', 'asda', 'sada'] }
  };
  materials.granite_dark = {
    desc: 'VOXEL PROPS (boulder). The boulder\'s lower half and the crack: dark neutral granite with pale lichen specks. ' +
          'The dark body under the bright rim.',
    base: 'ashDark', albedo: 0.62, ramp: 'rubble', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, d: { shade: 0.72, tint: 'ironDark', amount: 0.6 }, l: { shade: 1.25, tint: 'ash', amount: 0.5, glyph: "'" }
    }, rows: ['adaa', 'aaad', 'alaa', 'daal'] }
  };
  materials.moss_cap = {
    desc: 'VOXEL PROPS (boulder, rubble). A thick moss cushion on the top of a stone prop, brighter and yellower than the ' +
          'wall moss (moss_top is the wall-top material), so the boulder\'s cap reads first.',
    base: 'mossLight', albedo: 0.88, ramp: 'foliage', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, d: { shade: 0.75, tint: 'mossDark', amount: 0.7, glyph: '"' }, l: { shade: 1.10, tint: 'moss', amount: 0.4 }
    }, rows: ['adal', 'laad', 'adla', 'dala'] }
  };
  materials.crystal_dead = {
    desc: 'VOXEL PROPS (relay). The dead aether crystals: grey with a teal memory, glassy (spec 0.5). Not emissive: the ' +
          'relay is asleep until US-022.',
    base: 'aetherDead', albedo: 0.78, ramp: 'iron', spec: 0.50, bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, g: { shade: 1.20, tint: 'aetherDim', amount: 0.5 }
    }, rows: ['agaa', 'aaag', 'gaaa', 'aaga'] }
  };
  materials.crystal_lit = {
    desc: 'VOXEL PROPS (relay). The awake crystals (relay clips wake / awake): aether teal with white-hot cores, emissive ' +
          '0.85 so they glow in shade. The halo / sparkles stay a billboard (US-022).',
    base: 'aether', albedo: 1.00, ramp: 'aether', spec: 0.40, emissive: 0.85, bg: { mode: 'darken', k: 0.22 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, c: { shade: 1.20, tint: 'aetherCore', amount: 0.6 }, m: { shade: 0.85, tint: 'aetherMid', amount: 0.5 }
    }, rows: ['acam', 'maac', 'acma', 'caam'] }
  };
  materials.mirror_dark = {
    desc: 'VOXEL PROPS (relay). The cracked relay mirror: dull blue-grey glass with bright streaks (spec 0.85), inside a ' +
          'brass_light frame. The crack itself is iron_dark voxels.',
    base: 'mirrorDark', albedo: 0.80, ramp: 'iron', spec: 0.85, bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, s: { shade: 1.30, tint: 'mirror', amount: 0.6 }
    }, rows: ['saaa', 'asaa', 'aasa', 'aaas'] }
  };
  materials.linen_light = {
    desc: 'VOXEL PROPS (wake spot). The spare linen tarp\'s lit crests: the crate lid edges, fold ridges, the rolled fold ' +
          'of the turned-back corner. Near-white and cool, so it never reads as the ochre envelope.',
    base: 'linenLight', albedo: 0.94, ramp: 'canvas', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, f: { shade: 1.06, glyph: ')' }, s: { shade: 0.90, tint: 'linen', amount: 0.5 }
    }, rows: ['aafa', 'asaa', 'faaa', 'aasf'] }
  };
  materials.linen = {
    desc: 'VOXEL PROPS (wake spot). The tarp\'s flat parts: the sheet on the floor, the crate lid, the folded flap. Pale ' +
          'warm-white with a faint weave.',
    base: 'linen', albedo: 0.86, ramp: 'canvas', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, w: { shade: 0.92, tint: 'linenDark', amount: 0.25, glyph: '~' }, l: { shade: 1.06, tint: 'linenLight', amount: 0.5 }
    }, rows: ['awal', 'laaw', 'waal', 'alwa'] }
  };
  materials.linen_dark = {
    desc: 'VOXEL PROPS (wake spot). The tarp in shadow: the fold valleys, the flanks of the drape down the crate sides. ' +
          'Dark cool grey-brown (value body for the pale crests).',
    base: 'linenDark', albedo: 0.66, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, f: { shade: 0.88, glyph: '(' }
    }, rows: ['afaa', 'aaaf', 'faaa', 'aafa'] }
  };
  materials.gore_red = {
    desc: 'VOXEL PROPS (envelope). The faded red envelope gores that alternate with the ochre ones (12 around the bag), ' +
          'the stripe pattern that says "balloon" from the breach. Lit folds lighter, seams darker.',
    base: 'goreRed', albedo: 0.86, ramp: 'canvas', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, l: { shade: 1.12, tint: 'goreRedLight', amount: 0.6, glyph: ')' },
      s: { shade: 0.72, tint: 'goreRedDark', amount: 0.5, glyph: '~' }
    }, rows: ['alas', 'aasa', 'laaa', 'saal'] }
  };
  materials.gore_red_dark = {
    desc: 'VOXEL PROPS (envelope). Red gores inside the collapse creases (the fold valleys across the bag).',
    base: 'goreRedDark', albedo: 0.62, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, t: { shade: 0.70, tint: 'canvasScorch', amount: 0.6, glyph: '(' }
    }, rows: ['ataa', 'aaat', 'taaa', 'aata'] }
  };
  materials.canvas_burnt = {
    desc: 'VOXEL PROPS (envelope). Burnt canvas: the ragged black rim of the tear on the east flank, the dark inside seen ' +
          'through it and through the mouth hoop, a few scorch blotches. Not emissive (the fire is long out).',
    base: 'canvasScorch', albedo: 0.50, ramp: 'ash', bg: { mode: 'darken', k: 0.10 }, textureFade: [4, 12],
    texture: { w: 4, h: 4, scale: [16, 16], key: {
      a: { shade: 1.00 }, c: { shade: 0.70, tint: 'cinder', amount: 0.7, glyph: ',' }, e: { shade: 1.15, tint: 'emberDim', amount: 0.3, glyph: "'" }
    }, rows: ['acae', 'caaa', 'aeac', 'aaca'] }
  };

  // ---------------------------------------------------------------------------
  // 8. SEMANTIC + UI COLOR KEYS  (color language, see style-guide.md)
  // ---------------------------------------------------------------------------
  var semantic = {
    hero: 'heroGreen', danger: 'danger', magic: 'aether', interact: 'brassLight',   // D-011: magic = aether teal (was 'magic' cyan)
    warmSafe: 'torch', coolShadow: 'ambient', theDim: 'dim',
    machine: 'brass', machineAlt: 'copper', signal: 'aether', ferrum: 'ferrum'
  };
  var ui = {
    text: 'uiText', hint: 'uiHint', dim: 'uiDim',
    crosshair: 'uiDim', crosshairActive: 'gold',
    prompt: 'uiText', promptKey: 'gold',
    title: ['brassHot', 'brassLight', 'brass', 'copperLight', 'copper'], // top -> bottom rows of the KESTREL logo (D-011)
    subtitle: 'uiText', endText: 'uiText'
  };

  // ---------------------------------------------------------------------------
  // 9. DERIVED TABLES + REFERENCE UTILITIES
  // ---------------------------------------------------------------------------
  function hexToRgb(h) {
    var n = parseInt(h.charAt(0) === '#' ? h.slice(1) : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    var s = '#', i, v;
    for (i = 0; i < 3; i++) { v = Math.max(0, Math.min(255, Math.round(c[i]))); s += (v < 16 ? '0' : '') + v.toString(16); }
    return s;
  }
  function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  var rgb = {}, hue = {}, key;
  for (key in colors) {
    rgb[key] = hexToRgb(colors[key]);
    var mx = Math.max(rgb[key][0], rgb[key][1], rgb[key][2]) || 1;
    hue[key] = [rgb[key][0] / mx, rgb[key][1] / mx, rgb[key][2] / mx];
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smoothstep(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  // Add a light's contribution to an accumulator L = [r,g,b] (energy, not 0..255).
  // `amount` = intensity * falloff * max(0, N.L) * shadow (engine computes these).
  function addLight(L, colorKey, amount) {
    var h = hue[colorKey]; L[0] += h[0] * amount; L[1] += h[1] * amount; L[2] += h[2] * amount; return L;
  }
  // Smooth falloff, exactly 0 at radius, no hard ring: (1 - (d/r)^2)^2
  function falloff(d, r) { if (d >= r) return 0; var x = d / r; x = 1 - x * x; return x * x; }

  function rampIndex(len, b, gamma) {
    if (!(b >= shading.cutoff)) return 0;
    var t = Math.pow(b > 1 ? 1 : b, gamma || shading.rampGamma);
    var i = Math.floor(t * (len - 1));
    return 1 + (i > len - 2 ? len - 2 : i);
  }
  function rampGlyph(rampKeyOrString, b, gamma) {
    var r = ramps[rampKeyOrString] || rampKeyOrString;
    return r.charAt(rampIndex(r.length, b, gamma));
  }
  // Build a lookup table: lut[i] = glyph for b = i/(size-1). Engine convenience.
  function buildLUT(rampKeyOrString, size, gamma) {
    var r = ramps[rampKeyOrString] || rampKeyOrString, out = new Array(size), i;
    for (i = 0; i < size; i++) out[i] = r.charAt(rampIndex(r.length, i / (size - 1), gamma));
    return out;
  }

  function fogFactor(dist, fogKey) {
    var f = fog[fogKey || 'interior'];
    if (dist <= f.start) return 0;
    if (dist >= f.full) return 1;
    return Math.pow((dist - f.start) / (f.full - f.start), f.curve || 1);
  }
  function bandFactor(band, z) {
    if (!band || z == null) return 1;
    if (z <= band.full) return 1;
    if (z >= band.zero) return 0;
    return 1 - (z - band.full) / (band.zero - band.full);
  }
  // Texture lookup. u,v in meters (sky: degrees). v grows UPWARD; rows are authored top-down.
  function texel(tex, u, v) {
    var tu = Math.floor(u * tex.scale[0]) % tex.w; if (tu < 0) tu += tex.w;
    var tv = Math.floor(v * tex.scale[1]) % tex.h; if (tv < 0) tv += tex.h;
    return tex.key[tex.rows[tex.h - 1 - tv].charAt(tu)];
  }
  function skyGradient(stops, t, out) {
    var i, a, b, k;
    t = clamp01(t);
    for (i = 0; i < stops.length - 1; i++) if (t <= stops[i + 1].t) break;
    if (i >= stops.length - 1) i = stops.length - 2;
    a = rgb[stops[i].c]; b = rgb[stops[i + 1].c];
    k = (t - stops[i].t) / ((stops[i + 1].t - stops[i].t) || 1);
    out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
    return out;
  }
  function ensureOut(out) {
    out = out || {};
    if (!out.fg) out.fg = [0, 0, 0];
    if (!out.bg) out.bg = [0, 0, 0];
    return out;
  }

  // Sky cell. az = compass degrees, elev = degrees above horizon.
  function shadeSky(az, elev, out, timeKey) {
    out = ensureOut(out);
    var T = timeOfDay[timeKey || 'morning'], m = materials.sky, cb = m.cloudBand;
    skyGradient(T.sky, elev / m.elevTop, out.bg);
    var e = texel(m.texture, az, elev);
    var d = (e ? e.shade : 0) * smoothstep(0, cb[0], elev) * (1 - smoothstep(cb[1], cb[2], elev));
    var r = ramps[m.ramp];
    out.glyph = r.charAt(rampIndex(r.length, d, 1));
    var c = rgb[T.cloud], k = 0.35 + 0.65 * d;
    out.fg[0] = out.bg[0] + (c[0] - out.bg[0]) * k;
    out.fg[1] = out.bg[1] + (c[1] - out.bg[1]) * k;
    out.fg[2] = out.bg[2] + (c[2] - out.bg[2]) * k;
    out.b = d;
    return out;
  }

  // Reference surface shader.
  //   mat  : material key or object
  //   L    : [r,g,b] accumulated light (ambient + sun + point lights), see addLight
  //   u, v : texture coords in meters (walls: along-wall, height; floors/ceilings: world x, y)
  //   dist : camera distance in meters (fog + texture fade)
  //   out  : { glyph, fg:[r,g,b], bg:[r,g,b], b } written in place (no allocation if reused)
  //   opt  : { z: height above sector floor (m) for tintBand, default v;
  //            fog: 'interior' | 'far' | null (null = no fog); time: timeOfDay key (sky only) }
  function shade(mat, L, u, v, dist, out, opt) {
    var m = typeof mat === 'string' ? materials[mat] : mat;
    out = ensureOut(out);
    if (m.kind === 'sky') return shadeSky(u, v, out, opt && opt.time);
    dist = dist || 0;
    var z = opt && opt.z != null ? opt.z : v;
    var fogKey = opt && opt.fog !== undefined ? opt.fog : 'interior';
    var base = rgb[m.base];
    var br = base[0], bgc = base[1], bb = base[2];
    var s = 1, gl = null;

    if (m.texture) {
      var e = texel(m.texture, u, v);
      var tf = 1 - smoothstep(m.textureFade[0], m.textureFade[1], dist);
      if (e) {
        var bf = e.tint ? bandFactor(m.tintBand, z) : 1;
        s = 1 + (e.shade - 1) * tf * bf;
        if (e.tint) {
          var tc = rgb[e.tint], ta = (e.amount == null ? 0.6 : e.amount) * tf * bf;
          br += (tc[0] - br) * ta; bgc += (tc[1] - bgc) * ta; bb += (tc[2] - bb) * ta;
        }
        if (e.glyph && tf > 0.5) gl = e.glyph;
      }
    }

    var Lm = Math.max(L[0], L[1], L[2]);
    var b = Lm * m.albedo * s + (m.emissive || 0);
    var f = fogKey ? fogFactor(dist, fogKey) : 0;

    // glyph
    var ramp = ramps[m.ramp];
    var gb = b * (1 - f) + fog.glyphLevel * f;
    var idx = rampIndex(ramp.length, gb, m.rampGamma);
    out.glyph = (gl && idx >= shading.glyphOverrideMinIndex) ? gl : ramp.charAt(idx);

    // color
    var hr = 1, hg = 1, hb = 1;
    if (Lm > 1e-6) { hr = L[0] / Lm; hg = L[1] / Lm; hb = L[2] / Lm; }
    var k = shading.tint;
    var tr = 1 + (hr - 1) * k, tg = 1 + (hg - 1) * k, tb = 1 + (hb - 1) * k;
    var bc = b < 0 ? 0 : b;
    var gain = shading.fgMin + (1 - shading.fgMin) * Math.pow(bc > 1 ? 1 : bc, shading.fgGamma);
    if (bc > 1) gain = Math.min(shading.fgMaxGain, gain + (bc - 1) * 0.5);
    var r = br * tr * gain, g = bgc * tg * gain, bl = bb * tb * gain;

    var hot = 0;
    if (m.spec) hot += m.spec * Math.pow(bc > 1 ? 1 : bc, 3);
    if (bc > 1) hot += Math.min(shading.overbrightMax, (bc - 1) * shading.overbright);
    if (hot > 0) {
      if (hot > 0.8) hot = 0.8;
      var hx = 255 * (0.5 + 0.5 * hr), hy = 255 * (0.5 + 0.5 * hg), hz = 255 * (0.5 + 0.5 * hb);
      r += (hx - r) * hot; g += (hy - g) * hot; bl += (hz - bl) * hot;
    }
    if (r > 255) r = 255; if (g > 255) g = 255; if (bl > 255) bl = 255;

    // background rule
    var bgm = m.bg || { mode: 'black' }, xr = 0, xg = 0, xb = 0;
    if (bgm.mode === 'darken') { xr = r * bgm.k; xg = g * bgm.k; xb = bl * bgm.k; }
    else if (bgm.mode === 'fixed') { var fc0 = rgb[bgm.color]; xr = fc0[0]; xg = fc0[1]; xb = fc0[2]; }

    // fog
    if (f > 0) {
      var fc = rgb[fog[fogKey].color];
      r += (fc[0] - r) * f; g += (fc[1] - g) * f; bl += (fc[2] - bl) * f;
      xr += (fc[0] - xr) * f; xg += (fc[1] - xg) * f; xb += (fc[2] - xb) * f;
    }
    out.fg[0] = r; out.fg[1] = g; out.fg[2] = bl;
    out.bg[0] = xr; out.bg[1] = xg; out.bg[2] = xb;
    out.b = b;
    return out;
  }

  // Reference SPRITE shader (US-011 billboards). The glyph is fixed art; only the color is lit.
  //   colorKey : palette key of the cell (from the model's key map)
  //   L        : [r,g,b] light at the sprite (same accumulation as surfaces)
  //   nf       : normal factor 0..1 for this cell (see design/README.md section 4; 1 = facing the light)
  //   emissive : true -> full palette color, ignores light AND fog (flames, glints)
  //   fogF     : 0..1 fog factor at the sprite distance (util.fogFactor), optional
  //   out      : { fg:[r,g,b], visible, b } written in place
  function shadeSprite(colorKey, L, nf, emissive, fogF, out) {
    out = ensureOut(out);
    var base = rgb[colorKey];
    if (emissive) { out.fg[0] = base[0]; out.fg[1] = base[1]; out.fg[2] = base[2]; out.visible = true; out.b = 1; return out; }
    var Lm = Math.max(L[0], L[1], L[2]);
    var b = Lm * (0.35 + 0.65 * (nf == null ? 1 : nf));
    var f = fogF || 0;
    out.b = b;
    out.visible = b * (1 - f) >= shading.cutoff;
    var hr = 1, hg = 1, hb = 1;
    if (Lm > 1e-6) { hr = L[0] / Lm; hg = L[1] / Lm; hb = L[2] / Lm; }
    var k = shading.tint, bc = b < 0 ? 0 : b;
    var gain = shading.fgMin + (1 - shading.fgMin) * Math.pow(bc > 1 ? 1 : bc, shading.fgGamma);
    if (bc > 1) gain = Math.min(shading.fgMaxGain, gain + (bc - 1) * 0.5);
    var r = base[0] * (1 + (hr - 1) * k) * gain, g = base[1] * (1 + (hg - 1) * k) * gain, bl = base[2] * (1 + (hb - 1) * k) * gain;
    if (f > 0) { var fc = rgb[fog.interior.color]; r += (fc[0] - r) * f; g += (fc[1] - g) * f; bl += (fc[2] - bl) * f; }
    out.fg[0] = r > 255 ? 255 : r; out.fg[1] = g > 255 ? 255 : g; out.fg[2] = bl > 255 ? 255 : bl;
    return out;
  }

  // Data self-check: returns [] when everything is consistent.
  function validate() {
    var errs = [], mk, m, t, i, j, ch, ek;
    function col(k, where) { if (!colors[k]) errs.push(where + ': unknown color key "' + k + '"'); }
    for (mk in materials) {
      m = materials[mk];
      if (!ramps[m.ramp]) errs.push(mk + ': unknown ramp "' + m.ramp + '"');
      if (m.kind !== 'sky') col(m.base, mk + '.base');
      t = m.texture;
      if (t) {
        if (t.rows.length !== t.h) errs.push(mk + ': texture has ' + t.rows.length + ' rows, h=' + t.h);
        for (i = 0; i < t.rows.length; i++) {
          if (t.rows[i].length !== t.w) errs.push(mk + ': row ' + i + ' length ' + t.rows[i].length + ' != w ' + t.w);
          for (j = 0; j < t.rows[i].length; j++) {
            ch = t.rows[i].charAt(j);
            if (!t.key[ch]) errs.push(mk + ': row ' + i + ' col ' + j + ' char "' + ch + '" not in key');
          }
        }
        for (ek in t.key) if (t.key[ek].tint) col(t.key[ek].tint, mk + '.key.' + ek);
      }
    }
    for (mk in lights) col(lights[mk].color, 'lights.' + mk);
    for (mk in colorRamps) for (i = 0; i < colorRamps[mk].length; i++) col(colorRamps[mk][i], 'colorRamps.' + mk);
    for (mk in timeOfDay) {
      col(timeOfDay[mk].ambient, 'timeOfDay.' + mk); col(timeOfDay[mk].sun, 'timeOfDay.' + mk);
      col(timeOfDay[mk].cloud, 'timeOfDay.' + mk); col(timeOfDay[mk].fog, 'timeOfDay.' + mk);
      for (i = 0; i < timeOfDay[mk].sky.length; i++) col(timeOfDay[mk].sky[i].c, 'timeOfDay.' + mk + '.sky');
    }
    for (mk in ramps) {
      if (ramps[mk].charAt(0) !== ' ') errs.push('ramp ' + mk + ' must start with space');
      for (i = 0; i < ramps[mk].length; i++) {
        var cc = ramps[mk].charCodeAt(i);
        if (cc < 32 || cc > 126) errs.push('ramp ' + mk + ' has non-ASCII char at ' + i);
      }
    }
    return errs;
  }

  var palette = {
    version: 1,
    colors: colors,
    rgb: rgb,          // derived: key -> [r,g,b] 0..255
    hue: hue,          // derived: key -> [r,g,b] normalised to max channel = 1 (use for lights)
    ramps: ramps,
    colorRamps: colorRamps,
    shading: shading,
    lights: lights,
    fog: fog,
    timeOfDay: timeOfDay,
    defaultTime: 'morning',
    materials: materials,
    semantic: semantic,
    ui: ui,
    util: {
      hexToRgb: hexToRgb, rgbToHex: rgbToHex, css: css, clamp01: clamp01, smoothstep: smoothstep,
      addLight: addLight, falloff: falloff, rampIndex: rampIndex, rampGlyph: rampGlyph, buildLUT: buildLUT,
      fogFactor: fogFactor, bandFactor: bandFactor, texel: texel, skyGradient: skyGradient,
      shade: shade, shadeSky: shadeSky, shadeSprite: shadeSprite, validate: validate
    }
  };

  ASSETS.palette = palette;
  if (typeof module === 'object' && module && module.exports) module.exports = palette;
})(typeof window !== 'undefined' ? window : globalThis);
