// Kestrel - biome look data (ENV-02-DESIGN ground richness + ENV-03-DESIGN biome atmosphere).
// PROPOSAL for the owner pick. Plain data, no functions: the code stories (ENV-02 / ENV-03) consume it.
// Previews: design/preview/ground-richness.html, design/preview/biome-atmos.html (both read this file).
// Colours are hex; most are palette.js keys (named in comments) or blends of them. palette.js is unchanged.
//
// Per biome:
//   pick:   { ground: 'A'|'B'|'C', atmos: 'A'|'B' }   <- the owner's choice; code reads ground[pick.ground], atmos[pick.atmos]
//   ground: { A, B, C } each =
//     glyphs      string, sparse -> dense (glyph index grows with tone + a per-cell hash)
//     ramp        [4 hex] fg tone ramp dark -> light (continuous lerp, never hard bands)
//     bg          [2 hex] bg ramp dark -> light (same tone)
//     noiseScale  metres, wavelength of the small patches (soft value noise, 2 octaves)
//     macroScale  metres, wavelength of the large, slow tone drift
//     contrast    0..1, how far the tone swings from 0.5
//     footprint rule (no flicker, 38.50): a noise octave fades to its mean once one cell covers
//                 > 0.15..0.5 x its wavelength (depth footprint z*z/(camH*f)); glyph keyed by world cell, never by screen move
//     shimmer     { amp 0..1, mode 'sheen' (colour only) | 'lean' (glyph -> lean[i] under a gust + sheen),
//                   lean = string same length as glyphs, sheen 0..1 lighten toward ramp[3] }
//                 effect = amp * wind01 * gust(world x,z,t). wind01 = 0 -> identical output every frame (calm is static).
//     accents     [{ g glyph, c hex, d density 0..1, cluster 0..1 (1 = only inside patches), maxDist metres }]
//                 => decor-sized speckles (petals, pebbles, blade tips); fade out toward maxDist.
//     water       optional { from m, edge m (wet band), glyphs, color, light, bg, wet } (shore only, preview: water past `from`)
//   atmos:  { A, B } each =
//     fog         { day, dusk, night } hex - the fog target colour
//     fogDensity  per metre, k = 1 - exp(-fogDensity * d)
//     haze        { day, dusk, night } hex - sky tint at the horizon
//     hazeAmount  0..1, how much the horizon band of the sky moves toward haze
//     grade       { day, dusk, night } each { lift [r,g,b] 0..0.1, gamma [r,g,b] ~1, gain [r,g,b] ~1, sat ~1 }
//                 c = gain * (c + lift * (1 - c)); c = pow(c, 1 / gamma); c = luma + (c - luma) * sat
// Biomes without an entry = today's look (ENV-03 AC).
(function (root) {
  var BIOME_LOOK = {
    version: 1,
    order: ['meadow', 'forest', 'glade', 'fields', 'foothills', 'shore'],
    biomes: {

      meadow: {
        label: 'Start meadow',
        pick: { ground: 'A', atmos: 'A' },
        ground: {
          A: { name: 'Soft sward', glyphs: ".,'\"", ramp: ['#3f7a2a', '#5c9a36', '#7fba48', '#a6d060'], bg: ['#1a3412', '#2a5020'],
               noiseScale: 3.5, macroScale: 24, contrast: 0.55,
               shimmer: { amp: 0.35, mode: 'lean', lean: '.,``', sheen: 0.25 },
               accents: [{ g: '.', c: '#f6f3ea', d: 0.006, cluster: 0.6, maxDist: 25 }] },          // petalWhite specks
          B: { name: 'Lush tufts', glyphs: ",;'\"", ramp: ['#2f6424', '#4a8a30', '#6aa83e', '#8ec452'], bg: ['#14300f', '#22481a'],
               noiseScale: 2.2, macroScale: 16, contrast: 0.45,
               shimmer: { amp: 0.3, mode: 'sheen', lean: ",;'\"", sheen: 0.3 },
               accents: [{ g: "'", c: '#a6d060', d: 0.04, cluster: 0.3, maxDist: 15 }] },            // grassLight blade tips
          C: { name: 'Sunlit, straw-tinged', glyphs: " .,'", ramp: ['#4f7a2c', '#7ea43e', '#a6c45a', '#cfd27a'], bg: ['#22381a', '#3a5226'],
               noiseScale: 6, macroScale: 30, contrast: 0.6,
               shimmer: { amp: 0.45, mode: 'lean', lean: ' .,`', sheen: 0.3 },
               accents: [{ g: ',', c: '#d6b45a', d: 0.02, cluster: 0.8, maxDist: 30 }] }             // straw dry blades
        },
        atmos: {
          A: { name: 'Clear warm afternoon',
               fog: { day: '#c8dcd8', dusk: '#d49a80', night: '#18223a' }, fogDensity: 0.0035,
               haze: { day: '#efe6c6', dusk: '#ffc07a', night: '#1f2c4a' }, hazeAmount: 0.55,   // hazeWarm / skyEveHorizon / skyNightHorizon
               grade: { day:   { lift: [0.01, 0.01, 0.0],  gamma: [1, 1, 1],       gain: [1.04, 1.02, 0.96], sat: 1.05 },
                        dusk:  { lift: [0.03, 0.0, 0.02],  gamma: [1, 0.97, 0.95], gain: [1.08, 0.94, 0.84], sat: 1.0 },
                        night: { lift: [0.0, 0.01, 0.04],  gamma: [1, 1, 1.05],    gain: [0.62, 0.7, 0.92],  sat: 0.6 } } },
          B: { name: 'Soft morning haze',
               fog: { day: '#d6e2e4', dusk: '#c8a090', night: '#1c2440' }, fogDensity: 0.006,
               haze: { day: '#e8eee6', dusk: '#f0b080', night: '#24304e' }, hazeAmount: 0.75,
               grade: { day:   { lift: [0.03, 0.03, 0.035], gamma: [1, 1, 1],      gain: [0.98, 1.0, 1.0],   sat: 0.92 },
                        dusk:  { lift: [0.04, 0.02, 0.03],  gamma: [1, 1, 0.97],   gain: [1.04, 0.95, 0.88], sat: 0.95 },
                        night: { lift: [0.01, 0.02, 0.05],  gamma: [1, 1, 1.05],   gain: [0.6, 0.68, 0.9],   sat: 0.55 } } }
        }
      },

      forest: {
        label: 'Pine / oak forest',
        pick: { ground: 'D', atmos: 'A' },   // OB-184 part 4: D = mossy leaf-litter floor (A was flat dark brown)
        ground: {
          D: { name: 'Mossy leaf litter', glyphs: ' .,`', ramp: ['#25402a', '#3b5226', '#574428', '#6e5a30'], bg: ['#0f1e12', '#241c12'],   // mossDark / moss + litter browns of A
               noiseScale: 3, macroScale: 16, contrast: 0.6,
               shimmer: { amp: 0.05, mode: 'sheen', lean: ' .,`', sheen: 0.1 },
               accents: [{ g: ',', c: '#5f7a34', d: 0.05, cluster: 0.8, maxDist: 30 },               // moss flecks
                         { g: '`', c: '#6e5a30', d: 0.03, cluster: 0.5, maxDist: 25 }] },          // dry leaves
          A: { name: 'Needle litter (pine)', glyphs: '.,:;', ramp: ['#3a2e1c', '#574428', '#6e5a30', '#7a7038'], bg: ['#16110a', '#241c12'],
               noiseScale: 2.5, macroScale: 14, contrast: 0.5,
               shimmer: { amp: 0.08, mode: 'sheen', lean: '.,:;', sheen: 0.15 },
               accents: [{ g: '"', c: '#6f8a3a', d: 0.03, cluster: 0.8, maxDist: 30 },               // moss tufts
                         { g: 'o', c: '#6a4a24', d: 0.004, cluster: 0.5, maxDist: 18 }] },            // pine cones
          B: { name: 'Moss carpet', glyphs: ".,'\"", ramp: ['#25402a', '#3b5226', '#5f7a34', '#93ad4c'], bg: ['#0f1e12', '#1a2e16'],  // mossDark / moss / mossLight
               noiseScale: 4.5, macroScale: 20, contrast: 0.6,
               shimmer: { amp: 0.05, mode: 'sheen', lean: ".,'\"", sheen: 0.1 },
               accents: [{ g: '*', c: '#f6f3ea', d: 0.004, cluster: 0.8, maxDist: 20 }] },           // wood sorrel
          C: { name: 'Oak leaf litter', glyphs: '.,`;', ramp: ['#3a2a18', '#62442a', '#86622e', '#a8823c'], bg: ['#1a120a', '#2a1e10'],
               noiseScale: 1.8, macroScale: 12, contrast: 0.5,
               shimmer: { amp: 0.1, mode: 'sheen', lean: '.,`;', sheen: 0.15 },
               accents: [{ g: ',', c: '#6f8a3a', d: 0.08, cluster: 0.9, maxDist: 40 }] }              // moss patches
        },
        atmos: {
          A: { name: 'Green gloom',
               fog: { day: '#7a9a7e', dusk: '#5a4a48', night: '#0e1820' }, fogDensity: 0.012,
               haze: { day: '#b8d0b0', dusk: '#d09878', night: '#18263a' }, hazeAmount: 0.5,
               grade: { day:   { lift: [0.0, 0.02, 0.01],  gamma: [0.97, 1.0, 0.97], gain: [0.92, 1.0, 0.9],  sat: 0.95 },
                        dusk:  { lift: [0.02, 0.01, 0.02], gamma: [1, 0.97, 0.97],   gain: [1.0, 0.88, 0.8],  sat: 0.9 },
                        night: { lift: [0.0, 0.015, 0.03], gamma: [1, 1, 1.05],      gain: [0.5, 0.6, 0.8],   sat: 0.5 } } },
          B: { name: 'Golden shafts',
               fog: { day: '#a8a878', dusk: '#8a6048', night: '#121a24' }, fogDensity: 0.009,
               haze: { day: '#efe6c6', dusk: '#ffb070', night: '#1f2c4a' }, hazeAmount: 0.6,
               grade: { day:   { lift: [0.02, 0.015, 0.0], gamma: [1.0, 1.0, 0.95],  gain: [1.06, 1.02, 0.88], sat: 1.05 },
                        dusk:  { lift: [0.04, 0.01, 0.0],  gamma: [1, 0.95, 0.92],   gain: [1.1, 0.9, 0.75],   sat: 1.0 },
                        night: { lift: [0.0, 0.01, 0.03],  gamma: [1, 1, 1.05],      gain: [0.55, 0.62, 0.82], sat: 0.5 } } }
        }
      },

      glade: {
        label: 'Flower glade',
        pick: { ground: 'A', atmos: 'A' },
        ground: {
          A: { name: 'Mixed bloom', glyphs: ".,'\"", ramp: ['#467e2e', '#64a03a', '#86c04c', '#b0d468'], bg: ['#1e3a16', '#2e5622'],
               noiseScale: 3, macroScale: 18, contrast: 0.5,
               shimmer: { amp: 0.35, mode: 'lean', lean: '.,``', sheen: 0.2 },
               accents: [{ g: '*', c: '#f2c62e', d: 0.035, cluster: 0.7, maxDist: 45 },              // petalYellow
                         { g: 'o', c: '#f6f3ea', d: 0.025, cluster: 0.7, maxDist: 35 },              // petalWhite
                         { g: '+', c: '#e8709e', d: 0.012, cluster: 0.85, maxDist: 35 }] },          // petalPink
          B: { name: 'Daisies + buttercups, sparse', glyphs: ".,'\"", ramp: ['#4e8630', '#6ea83e', '#92c652', '#b8da72'], bg: ['#20401a', '#325c24'],
               noiseScale: 4, macroScale: 22, contrast: 0.45,
               shimmer: { amp: 0.3, mode: 'sheen', lean: ".,'\"", sheen: 0.25 },
               accents: [{ g: '*', c: '#f6f3ea', d: 0.015, cluster: 0.4, maxDist: 35 },
                         { g: '.', c: '#fff09a', d: 0.02, cluster: 0.4, maxDist: 40 }] },            // petalYellowLight
          C: { name: 'Pink drift', glyphs: ".,'\"", ramp: ['#467e2e', '#62a03a', '#84bc4c', '#a8d064'], bg: ['#1e3a16', '#2e5622'],
               noiseScale: 3, macroScale: 18, contrast: 0.5,
               shimmer: { amp: 0.35, mode: 'lean', lean: '.,``', sheen: 0.2 },
               accents: [{ g: '*', c: '#ffc4dc', d: 0.07, cluster: 1.0, maxDist: 45 },               // petalPinkLight
                         { g: '.', c: '#e8709e', d: 0.035, cluster: 1.0, maxDist: 40 },
                         { g: 'o', c: '#f6f3ea', d: 0.005, cluster: 0.3, maxDist: 25 }] }
        },
        atmos: {
          A: { name: 'Pastel bright',
               fog: { day: '#d4e4d6', dusk: '#d8a48c', night: '#1a2440' }, fogDensity: 0.004,
               haze: { day: '#f2ecd2', dusk: '#ffc07a', night: '#22304e' }, hazeAmount: 0.6,
               grade: { day:   { lift: [0.02, 0.02, 0.02], gamma: [1, 1.02, 1],    gain: [1.03, 1.03, 0.98], sat: 1.1 },
                        dusk:  { lift: [0.04, 0.01, 0.03], gamma: [1, 0.97, 0.97], gain: [1.08, 0.94, 0.88], sat: 1.05 },
                        night: { lift: [0.01, 0.02, 0.05], gamma: [1, 1, 1.05],    gain: [0.62, 0.7, 0.95],  sat: 0.6 } } },
          B: { name: 'Dreamy peach haze',
               fog: { day: '#e8dcc8', dusk: '#e0a088', night: '#1e2440' }, fogDensity: 0.007,
               haze: { day: '#f6e2c8', dusk: '#ffb488', night: '#262c4c' }, hazeAmount: 0.8,
               grade: { day:   { lift: [0.04, 0.03, 0.03], gamma: [1, 1, 1],       gain: [1.02, 0.99, 0.95], sat: 0.95 },
                        dusk:  { lift: [0.05, 0.02, 0.03], gamma: [1, 0.97, 0.96], gain: [1.08, 0.92, 0.86], sat: 1.0 },
                        night: { lift: [0.02, 0.02, 0.05], gamma: [1, 1, 1.05],    gain: [0.62, 0.66, 0.9],  sat: 0.55 } } }
        }
      },

      fields: {
        label: 'Far fields',
        pick: { ground: 'A', atmos: 'A' },
        ground: {
          A: { name: 'Summer grass', glyphs: ".,'\"", ramp: ['#56782c', '#80a03e', '#aab654', '#d0c47a'], bg: ['#26381a', '#3e5224'],
               noiseScale: 7, macroScale: 40, contrast: 0.55,
               shimmer: { amp: 0.55, mode: 'lean', lean: '.,``', sheen: 0.35 },
               accents: [] },
          B: { name: 'Golden hay', glyphs: ".,'\"", ramp: ['#7a6428', '#9c7e34', '#c8a64e', '#ecd488'], bg: ['#3a2e14', '#54421e'],   // strawDark / straw / strawLight
               noiseScale: 9, macroScale: 50, contrast: 0.5,
               shimmer: { amp: 0.6, mode: 'sheen', lean: ".,'\"", sheen: 0.4 },
               accents: [{ g: '.', c: '#3f7a2a', d: 0.03, cluster: 0.7, maxDist: 30 }] },
          C: { name: 'Green pasture', glyphs: ".,'\"", ramp: ['#3e6a2e', '#5a8a3a', '#78a648', '#98bc5a'], bg: ['#1a3014', '#28461e'],
               noiseScale: 5, macroScale: 32, contrast: 0.5,
               shimmer: { amp: 0.45, mode: 'lean', lean: '.,``', sheen: 0.3 },
               accents: [{ g: '.', c: '#f6f3ea', d: 0.01, cluster: 0.6, maxDist: 25 }] }              // clover
        },
        atmos: {
          A: { name: 'Long clear view',
               fog: { day: '#c4dcef', dusk: '#d4a080', night: '#16203a' }, fogDensity: 0.0015,   // fogFar
               haze: { day: '#c8ecf3', dusk: '#ffc07a', night: '#1f2c4a' }, hazeAmount: 0.5,    // skyCyanHorizon
               grade: { day:   { lift: [0.0, 0.0, 0.01],   gamma: [1, 1, 1],       gain: [1.02, 1.02, 1.0],  sat: 1.05 },
                        dusk:  { lift: [0.03, 0.0, 0.02],  gamma: [1, 0.97, 0.95], gain: [1.1, 0.93, 0.82],  sat: 1.05 },
                        night: { lift: [0.0, 0.01, 0.04],  gamma: [1, 1, 1.05],    gain: [0.62, 0.7, 0.92],  sat: 0.6 } } },
          B: { name: 'Summer heat haze',
               fog: { day: '#e0d8b8', dusk: '#e0a070', night: '#1c2238' }, fogDensity: 0.003,
               haze: { day: '#f2e4bc', dusk: '#ffb060', night: '#22284a' }, hazeAmount: 0.8,
               grade: { day:   { lift: [0.03, 0.02, 0.0],  gamma: [1, 1, 0.95],    gain: [1.06, 1.02, 0.9],  sat: 1.0 },
                        dusk:  { lift: [0.05, 0.01, 0.0],  gamma: [1, 0.95, 0.9],  gain: [1.12, 0.92, 0.76], sat: 1.05 },
                        night: { lift: [0.01, 0.01, 0.04], gamma: [1, 1, 1.05],    gain: [0.64, 0.68, 0.88], sat: 0.55 } } }
        }
      },

      foothills: {
        label: 'Rocky foothills',
        pick: { ground: 'A', atmos: 'A' },
        ground: {
          A: { name: 'Grass over scree', glyphs: ".,:'", ramp: ['#4a5038', '#68704a', '#8a8a64', '#a8a080'], bg: ['#20221a', '#30322a'],
               noiseScale: 3, macroScale: 16, contrast: 0.6,
               shimmer: { amp: 0.2, mode: 'lean', lean: '.,:`', sheen: 0.15 },
               accents: [{ g: 'o', c: '#b8ab94', d: 0.03, cluster: 0.6, maxDist: 30 },               // stoneLight pebbles
                         { g: '.', c: '#7e838c', d: 0.05, cluster: 0.5, maxDist: 40 }] },           // stoneCool grit
          B: { name: 'Bare scree', glyphs: '.:;%', ramp: ['#4e4840', '#726857', '#8a7f6e', '#b8ab94'], bg: ['#221e1a', '#322c26'],   // stoneDark .. stoneLight
               noiseScale: 2, macroScale: 12, contrast: 0.55,
               shimmer: { amp: 0.0, mode: 'sheen', lean: '.:;%', sheen: 0.0 },
               accents: [{ g: ',', c: '#6f8a3a', d: 0.05, cluster: 0.85, maxDist: 30 },              // moss
                         { g: '#', c: '#9c8c72', d: 0.008, cluster: 0.6, maxDist: 20 }] },          // stoneWarm chips
          C: { name: 'Heather + bilberry', glyphs: '.,;"', ramp: ['#463a34', '#5e4a40', '#6e6440', '#848656'], bg: ['#1e1814', '#2a2420'],
               noiseScale: 2.8, macroScale: 18, contrast: 0.5,
               shimmer: { amp: 0.15, mode: 'sheen', lean: '.,;"', sheen: 0.12 },
               accents: [{ g: '.', c: '#c47a9a', d: 0.05, cluster: 0.8, maxDist: 30 }] }            // heather bloom (pink, not Dim violet)
        },
        atmos: {
          A: { name: 'Cool clear',
               fog: { day: '#a8bcd0', dusk: '#a0788a', night: '#121a30' }, fogDensity: 0.0025,
               haze: { day: '#c4dcef', dusk: '#f0a878', night: '#1f2c4a' }, hazeAmount: 0.5,
               grade: { day:   { lift: [0.0, 0.01, 0.02],  gamma: [1, 1, 1.02],    gain: [0.98, 1.0, 1.04],  sat: 0.95 },
                        dusk:  { lift: [0.02, 0.0, 0.03],  gamma: [1, 0.97, 0.97], gain: [1.06, 0.92, 0.88], sat: 0.95 },
                        night: { lift: [0.0, 0.01, 0.05],  gamma: [1, 1, 1.05],    gain: [0.58, 0.66, 0.92], sat: 0.5 } } },
          B: { name: 'Mountain mist',
               fog: { day: '#b8bec4', dusk: '#887884', night: '#141a28' }, fogDensity: 0.008,
               haze: { day: '#d8dcdc', dusk: '#d8a088', night: '#202838' }, hazeAmount: 0.85,
               grade: { day:   { lift: [0.03, 0.03, 0.04], gamma: [1, 1, 1],       gain: [0.96, 0.97, 1.0],  sat: 0.8 },
                        dusk:  { lift: [0.03, 0.02, 0.04], gamma: [1, 0.98, 0.98], gain: [1.02, 0.92, 0.9],  sat: 0.85 },
                        night: { lift: [0.01, 0.02, 0.05], gamma: [1, 1, 1.04],    gain: [0.55, 0.6, 0.8],   sat: 0.45 } } }
        }
      },

      shore: {
        label: 'River bank / shore',
        pick: { ground: 'A', atmos: 'A' },
        ground: {
          A: { name: 'Sand + pebbles (sea shore)', glyphs: ' .,:', ramp: ['#8a7650', '#a8946a', '#c8b48a', '#e2d4ac'], bg: ['#4a3e28', '#64563a'],
               noiseScale: 2.5, macroScale: 14, contrast: 0.45,
               shimmer: { amp: 0.0, mode: 'sheen', lean: ' .,:', sheen: 0.0 },
               accents: [{ g: 'o', c: '#8a7f6e', d: 0.02, cluster: 0.6, maxDist: 25 },               // stoneMid pebbles
                         { g: '.', c: '#f6f3ea', d: 0.01, cluster: 0.4, maxDist: 20 }],              // shell bits
               water: { from: 20, edge: 3, glyphs: '~- ', color: '#3f7fc4', light: '#8fc8f0', bg: '#1d4a78', wet: '#5e5038' } },  // river / riverLight
          B: { name: 'Mud bank + reeds (river)', glyphs: '.,:;', ramp: ['#3a3020', '#54462e', '#6e5e3c', '#86764c'], bg: ['#1c160e', '#2a2216'],
               noiseScale: 2, macroScale: 12, contrast: 0.5,
               shimmer: { amp: 0.3, mode: 'sheen', lean: '.,:;', sheen: 0.25 },
               accents: [{ g: '|', c: '#6f8a3a', d: 0.06, cluster: 0.9, maxDist: 30 },              // reeds
                         { g: '!', c: '#93ad4c', d: 0.02, cluster: 0.9, maxDist: 25 }],
               water: { from: 16, edge: 2, glyphs: '~- ', color: '#2f6a8a', light: '#7ab0c4', bg: '#15384c', wet: '#2a2216' } },
          C: { name: 'Grassy bank', glyphs: ".,'\"", ramp: ['#2e5a2c', '#467a36', '#62963e', '#84b054'], bg: ['#122a12', '#1e3e1a'],
               noiseScale: 3, macroScale: 18, contrast: 0.5,
               shimmer: { amp: 0.3, mode: 'lean', lean: '.,``', sheen: 0.2 },
               accents: [{ g: ':', c: '#25402a', d: 0.04, cluster: 0.9, maxDist: 30 }],              // wet dark clumps
               water: { from: 18, edge: 2.5, glyphs: '~- ', color: '#3f7fc4', light: '#8fc8f0', bg: '#1d4a78', wet: '#2a3a20' } }
        },
        atmos: {
          A: { name: 'Bright sea air',
               fog: { day: '#c0dce8', dusk: '#c89c90', night: '#142038' }, fogDensity: 0.003,
               haze: { day: '#d8f0f4', dusk: '#ffc07a', night: '#1f2c4a' }, hazeAmount: 0.65,
               grade: { day:   { lift: [0.0, 0.01, 0.02],  gamma: [1, 1, 1.02],    gain: [1.02, 1.03, 1.05], sat: 1.05 },
                        dusk:  { lift: [0.03, 0.01, 0.03], gamma: [1, 0.97, 0.97], gain: [1.08, 0.94, 0.88], sat: 1.0 },
                        night: { lift: [0.0, 0.015, 0.05], gamma: [1, 1, 1.05],    gain: [0.6, 0.7, 0.95],   sat: 0.6 } } },
          B: { name: 'River mist',
               fog: { day: '#dce4e4', dusk: '#a89098', night: '#182030' }, fogDensity: 0.009,
               haze: { day: '#e8eeee', dusk: '#e8b090', night: '#222c40' }, hazeAmount: 0.85,
               grade: { day:   { lift: [0.04, 0.04, 0.045], gamma: [1, 1, 1],      gain: [0.96, 0.98, 1.0],  sat: 0.85 },
                        dusk:  { lift: [0.04, 0.03, 0.04],  gamma: [1, 0.98, 0.98], gain: [1.02, 0.93, 0.9], sat: 0.9 },
                        night: { lift: [0.02, 0.03, 0.06],  gamma: [1, 1, 1.04],   gain: [0.55, 0.62, 0.84], sat: 0.5 } } }
        }
      }
    }
  };
  // ENV-02a (arch 38.63): look = f(ground type, biome). Ordered rules, the FIRST match wins, no match = look 0 = today's ground (byte-identical).
  // ground = terrain type names (overworld_far.js terrain), biomes = geo.biomes ids (world_geo.js); a missing key matches anything.
  // DEFAULTS PENDING OWNER (mapping questions unanswered): fields=grassFields(6), glade=flowerFields(5), foothills=alpineMeadow(9);
  // fen(8) and beachDunes(7) get the shore look only on sand/reeds; Ash Mile(4) and twistedWood(3) keep today's ground.
  BIOME_LOOK.lookMap = [
    { look: 'shore', ground: ['sand', 'reeds'] },
    { look: 'glade', biomes: [5] },
    { look: 'fields', biomes: [6] },
    { look: 'forest', ground: ['forest'] },
    { look: 'foothills', biomes: [9], ground: ['grass', 'rock'] },
    { look: 'meadow', ground: ['grass'], biomes: [0] }
  ];
  // ENV-03a (arch 38.65): which biome id (geo.biomes ids, 0 = start meadow) gets which atmosphere entry (a name in order; atmos by pick.atmos).
  // Ids not listed (3 twistedWood, 4 ashMile) = today's atmosphere. Picks = the preview default (A everywhere); the owner may change them later.
  BIOME_LOOK.atmosMap = { 0: 'meadow', 1: 'forest', 2: 'forest', 5: 'glade', 6: 'fields', 9: 'foothills', 7: 'shore', 8: 'shore' };
  root.BIOME_LOOK = BIOME_LOOK;
  if (typeof module !== 'undefined' && module.exports) module.exports = BIOME_LOOK;
})(typeof window !== 'undefined' ? window : globalThis);
