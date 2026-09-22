/*
 * ASCII Quest - master palette, glyph ramps, materials  (US-002, format v1)
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
    fogNight:       '#101626'
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
    water:     ' .-~=+'
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
    beacon:  { color: 'torch', intensity: 1.0, type: 'point', radius: 12, falloff: 'smooth',
               flicker: { hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 } }   // US-022
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

  // ---------------------------------------------------------------------------
  // 8. SEMANTIC + UI COLOR KEYS  (color language, see style-guide.md)
  // ---------------------------------------------------------------------------
  var semantic = {
    hero: 'heroGreen', danger: 'danger', magic: 'magic', interact: 'brassLight',
    warmSafe: 'torch', coolShadow: 'ambient', theDim: 'dim'
  };
  var ui = {
    text: 'uiText', hint: 'uiHint', dim: 'uiDim',
    crosshair: 'uiDim', crosshairActive: 'gold',
    prompt: 'uiText', promptKey: 'gold',
    title: ['flameCore', 'gold', 'flameMid', 'flameOuter', 'ember'], // top -> bottom rows of the logo
    subtitle: 'uiHint', endText: 'uiText'
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
