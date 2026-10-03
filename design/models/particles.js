/*
 * Kestrel - particle presets (US-053c; engine format = docs/architecture.md 32.1 EmitterDef).
 * Owner: Designer. Format: design/README.md section 8. Preview: design/preview/particles.html (runs the REAL
 * engine sim, engine/fx/particles.js, through the same toEmitterDef() the game uses).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.particles.presets.<key>   one EmitterDef per preset, EXACTLY the 32.1 fields, except `colors`, which is
 *                                    an array of PALETTE KEYS (not [r,g,b]); the caller resolves them (32.1:
 *                                    "colours resolved by the CALLER"). Keys: flame, embers, smoke, sparks, dust.
 *                                    36.2: the burner = sprite `burnerFire` (wreckage.js) + `embers` + `smoke`;
 *                                    `flame` is no longer placed at the burner (kept for small torches / tests).
 *   ASSETS.particles.toEmitterDef(key, rgb)
 *                                    -> a NEW plain EmitterDef with colors = rgb[k] triplets, ready for
 *                                    engine.particles.defineEmitter(key, def). `rgb` = ASSETS.palette.rgb
 *                                    (or assets.palette.rgb). Throws naming the preset + colour key if one is missing.
 *   ASSETS.particles.mounts.<key>    placement HINTS for the content step (not read by the engine): suggested
 *                                    components.emitters offset {right, fwd, up} relative to a mount, burst counts.
 *   ASSETS.particles.LANDING_DUST_SPEED  6 (m/s) - the US-053c AC5 data constant (fall speed above which dust bursts).
 *
 * GAME WIRING (US-053c AC1, main.js boot, after the AssetRegistry exists):
 *   const PS = window.ASSETS.particles;
 *   for (const k of Object.keys(PS.presets)) engine.particles.defineEmitter(k, PS.toEmitterDef(k, assets.palette.rgb));
 *   game/index.html: <script src="../design/models/particles.js"></script> after palette.js (no other dependency).
 *
 * RULES (style-guide 7c)
 *   - glyph ramps run over LIFE (index 0 = newborn), <= 16 steps, printable ASCII 33..126, NO space (a space step
 *     would be an invisible step; the presets fade by colour + sparser glyphs instead, the particle dies at the end).
 *   - stepped ramps, no lerp (32.1): both ramps are stretched to the longer one (nearest-earlier index), so the colour
 *     list is written at the same length as the glyph list here, one colour per glyph, to keep the pairing obvious.
 *   - emissive = fire only (flame, sparks). Smoke and dust are LIT by their emitter's light only (32.1 "Known
 *     limit"), and ignore the sprite cutoff (US-053c AC8). So smoke colours stay DARK: every smoke key is <= 35 % of
 *     full brightness (max channel <= 89), and it darkens over life. Even under the full burner torch (gain cap 1.2)
 *     it reads as a faint warm haze, and in a pitch-dark room (gain fgMin 0.32) as a barely-there grey, never as a
 *     lit cloud. The preview's "check" line measures this.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  var presets = {
    // --- flame: the Kestrel burner tongue. ~40 spawns/s, each lives 0.4-0.6 s and climbs ~1 m/s (drag pulls the
    // start speed 0.8-1.2 toward the buoyant terminal speed accelZ/drag = 1.25 m/s), so the column is ~0.5 m tall.
    // Narrow cone + a small spawn box = a flickering tongue, not a fountain. Dense hot core at the base (# % white-
    // yellow), the classic `^` tongue in the middle, wisps `'` `.` at the tip going ember-red.
    flame: {
      // RETUNE 2026-10-03 (owner walk-test "too small"): 60/s, life 0.5-0.8, speed 1.2-1.8, terminal 1.6 m/s -> ~0.9 m tall.
      rate: 60, burst: 0,
      life: [0.5, 0.8], speed: [1.2, 1.8],
      dir: [0, 0, 1], spreadDeg: 13, box: [0.09, 0.09, 0.03],
      accelZ: 1.6, drag: 1.0, wind: 0.25,
      maxLive: 52, killBelow: null,
      glyphs:  "%#**^^^'':.",
      colors: ['flameCore', 'flameCore', 'flameCore', 'flameMid', 'flameMid', 'flameMid', 'flameOuter', 'flameOuter',
               'flameTip', 'ember', 'emberDark'],
      emissive: true, emissiveFog: 0.15
    },
    // --- embers (36.2a): the particles OVER the burnerFire sprite (which is the fire body now). A few bright coals
    // per second lifted out of the flames: 8/s, 0.8-1.4 s, start 0.6-1.2 m/s in a 25 deg cone, drag pulls them to a
    // slow buoyant drift (accelZ/drag = 0.33 m/s) and the draught carries them (wind 0.6), so they climb ~0.6-0.9 m
    // above their spawn and wander. Spawn box 0.3 x 0.3 m = the width of the sprite body. `*` hot -> `'` `.` cooling,
    // emberHot -> ember -> emberDim -> emberDark. Emissive (fire), slight fog.
    embers: {
      rate: 8, burst: 0,
      life: [0.8, 1.4], speed: [0.6, 1.2],
      dir: [0, 0, 1], spreadDeg: 25, box: [0.15, 0.15, 0.05],
      accelZ: 0.4, drag: 1.2, wind: 0.6,
      maxLive: 16, killBelow: null,
      glyphs:  "**+''..",
      colors: ['emberHot', 'emberHot', 'ember', 'ember', 'emberDim', 'emberDim', 'emberDark'],
      emissive: true, emissiveFog: 0.15
    },
    // --- smoke: slow, dark, drifting. Buoyant (accelZ +0.6, terminal 0.75 m/s), takes the full wind (wind 1), lives
    // 3-4 s, so it climbs ~2-2.5 m past the burner and leans with any draught. Puffs `O o` near the source, thin
    // `; : ~ -` mid-life, dissolving to `' ` .` - while the colour darkens from warm ash to near-black soot.
    smoke: {
      rate: 12, burst: 0,
      life: [3.0, 4.0], speed: [0.3, 0.5],
      dir: [0, 0, 1], spreadDeg: 18, box: [0.12, 0.12, 0.03],
      accelZ: 0.6, drag: 0.8, wind: 1,
      maxLive: 48, killBelow: null,
      glyphs:  "oOo%;:~-'`.",
      colors: ['ashDark', 'ashDark', 'ashDark', 'ironDark', 'ironDark', 'ironDark', 'mortar', 'mortar',
               'cinder', 'scorch', 'scorch'],
      emissive: false, emissiveFog: 0
    },
    // --- sparks: the sword-hit burst (burstAt, cone along the hit normal via setEmitterDir; default axis = up).
    // 10 sparks at 2.5-5 m/s in a wide 50 deg cone, real gravity, 0.3-0.4 s: a short bright spray that arcs down.
    // White-hot `*` -> `+` -> ember `'` `.`. Kill plane 1.5 m below the hit (the floor at sword height).
    sparks: {
      rate: 0, burst: 10,
      life: [0.3, 0.4], speed: [2.5, 5.0],
      dir: [0, 0, 1], spreadDeg: 50, box: [0.02, 0.02, 0.02],
      accelZ: -9.8, drag: 0.6, wind: 0,
      maxLive: 24, killBelow: 1.5,
      glyphs:  "**+*+''.",
      colors: ['white', 'flameCore', 'flameCore', 'flameMid', 'flameOuter', 'ember', 'emberDim', 'emberDark'],
      emissive: true, emissiveFog: 0.1
    },
    // --- dust: the hard-landing puff at the feet (burstAt). 10 motes in an 80 deg cone around up = mostly a flat
    // ring that skids out 0.5-1.5 m/s and stops fast (drag 3), sinks a little (accelZ -0.4) and dies on the floor
    // (kill plane 2 cm under the feet). Sand / stone-dust tones, lit (non-emissive). `; :` puffs -> `, ' .` motes.
    dust: {
      rate: 0, burst: 10,
      life: [0.5, 0.8], speed: [0.5, 1.5],
      dir: [0, 0, 1], spreadDeg: 80, box: [0.18, 0.18, 0.01],
      accelZ: -0.4, drag: 3.0, wind: 0.3,
      maxLive: 16, killBelow: 0.02,
      glyphs:  "o;::,,'.",
      colors: ['ashLight', 'flagWarm', 'flagWarm', 'ash', 'ash', 'flagstone', 'ashDark', 'ashDark'],
      emissive: false, emissiveFog: 0
    }
  };

  // Placement hints for US-053c AC3-5 (content / game code). Not read by the engine.
  var mounts = {
    flame:  { use: 'SPARE since 36.2 (the burner fire body is the burnerFire sprite); small torches / tests', offset: { right: 0, fwd: 0, up: 0.02 }, on: true },
    // 36.2: offsets relative to the voxel burner `flame` mount (grate top, world z 1.05). The burnerFire sprite spans
    // z 1.05 .. 2.05, so embers start mid-body (z 1.50) and rise out of the tips; smoke starts AT the tip (z 2.0) so the
    // dark (lit, non-emissive) smoke never sits over the bright body. Level offsets are from the burner prop's feet
    // (z 0.5): embers up 1.0, smoke up 1.5.
    embers: { use: 'Kestrel burner: components.emitters on the burner entity (replaces `flame`), over the burnerFire sprite', offset: { right: 0, fwd: 0, up: 0.45 }, on: true },
    smoke:  { use: 'same entity, after embers; starts at the sprite\'s tip so smoke never covers the fire body', offset: { right: 0, fwd: 0, up: 0.95 }, on: true },
    sparks: { use: 'combat:hit from the player sword: burstAt(sparks, hit point); setEmitterDir / burstAt dx,dy,dz = hit normal when known', n: 10, nHeavy: 14 },
    dust:   { use: 'landing with fall speed > LANDING_DUST_SPEED: burstAt(dust, feet x, y, z + 0.03)', n: 10, nHeavy: 14 }
  };

  function toEmitterDef(key, rgb) {
    var p = presets[key], out = {}, k, i;
    if (!p) throw new Error('ASSETS.particles.toEmitterDef: unknown preset "' + key + '"');
    if (!rgb) throw new Error('ASSETS.particles.toEmitterDef("' + key + '"): pass palette.rgb');
    for (k in p) {
      if (k === 'colors') continue;
      var v = p[k];
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
    out.colors = [];
    for (i = 0; i < p.colors.length; i++) {
      var c = rgb[p.colors[i]];
      if (!c) throw new Error('ASSETS.particles.toEmitterDef("' + key + '"): unknown palette key "' + p.colors[i] + '"');
      out.colors.push([c[0], c[1], c[2]]);
    }
    return out;
  }

  // Data self-check (the preview runs it; the engine's defineEmitter is the real gate). [] = OK.
  function validate(rgb) {
    var errs = [], key, p, i, cc;
    for (key in presets) {
      p = presets[key];
      if (typeof p.glyphs !== 'string' || !p.glyphs.length) errs.push(key + ': glyphs empty');
      if (p.glyphs.length > 16) errs.push(key + ': glyph ramp > 16');
      if (p.colors.length > 16) errs.push(key + ': colour ramp > 16');
      for (i = 0; i < p.glyphs.length; i++) {
        cc = p.glyphs.charCodeAt(i);
        if (cc < 33 || cc > 126) errs.push(key + ': glyph ' + i + ' outside ASCII 33..126');
      }
      if (rgb) for (i = 0; i < p.colors.length; i++) if (!rgb[p.colors[i]]) errs.push(key + ': unknown colour ' + p.colors[i]);
    }
    // AC8: smoke colours <= ~35 % of full brightness
    if (rgb) for (i = 0; i < presets.smoke.colors.length; i++) {
      var c = rgb[presets.smoke.colors[i]];
      if (c && Math.max(c[0], c[1], c[2]) > 0.35 * 255) errs.push('smoke: ' + presets.smoke.colors[i] + ' brighter than 35 %');
    }
    return errs;
  }

  A.particles = {
    version: 1,
    presets: presets,
    mounts: mounts,
    LANDING_DUST_SPEED: 6,
    toEmitterDef: toEmitterDef,
    validate: validate
  };
  if (typeof module === 'object' && module && module.exports) module.exports = A.particles;
})(typeof window !== 'undefined' ? window : globalThis);
