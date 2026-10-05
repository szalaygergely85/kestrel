/* design/models/voxel_beast.js - US-079a placeholder boar (architecture.md 29.1, AC 1)
 *                                + Sprint 6 designer pass A (v1.34): hurt / flinch / windup / charge / die / dead / sink
 *                                  clips, a hit-flash copy part, mounts, and ASSETS.boarFx (US-079b / US-079c data).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/rts_unit.js:
 *   <script src="../design/models/voxel_beast.js">     (browser, game/index.html)
 *   import '../../../design/models/voxel_beast.js';     (Node tests: side-effect import)
 * Sets ASSETS.models.boarPlaceholder directly (format: design/README.md section 4/7, architecture.md 15.1) using
 * only ALREADY-MERGED palette materials (leather, canvas_dark, hit_flash) - no merge step needed; usable on both
 * ?renderer=dda and ?renderer=mesh (7 x 12 x 16 = 1344 cells, 7 + 12 + 16 = 35 steps: inside the dda limits).
 *
 * Axes (15.1): x = east (= the boar's RIGHT at yaw 0), y = SOUTH with y0 = the model's FRONT row (faces north at
 * yaw 0), z = up. cellM 0.1. The BODY (unchanged art, 5 x 10 x 7 voxels = 0.5 x 1.0 x 0.7 m) now sits at grid
 * x 1..5, y 1..10, z 8..14 (one free voxel ring round it); anchor [3.5, 6, 8] = its feet = the same world placement
 * as before.
 *
 * v1.34 parts (2, MAX_VOX_PARTS 8):
 *   body   box [0,0,8, 7,12,16]  pivot [6, 6, 8] = the boar's RIGHT foot edge, mid-length, on the ground. Every clip
 *                                rotates about it: rx = pitch (+ = nose down), ry = roll (+ = top to the boar's
 *                                right; 90 = lying on its right side, legs out to the left).
 *   flash  box [0,0,0, 7,12,8]   pivot [6, 6, 0]: a WHITE (`hit_flash`, emissive 1.0) copy of the body grown by one
 *                                voxel to the sides and on top (the pell flash-shell trick, README 7.5, but a full
 *                                inflated copy because the boar is not a box). Stored BELOW the body in the grid (so
 *                                it is underground even with no clip); a clip shows it with pos [0,0,+8] (exactly
 *                                over the body, 1 voxel proud = a white "pop") and hides it with pos [0,0,-64]. It
 *                                always copies the body's rot, so it stays glued to the body in any pose.
 *
 * Clip -> state map (who plays what: ASSETS.boarFx.clipFor; view-only, beastView.js sets components.voxel.anim):
 *   idle (rest), hurt (6 steps, flash ON, step interp), flinch (9 steps, flash off), windup (0.5 s: back 0.15 m, head
 *   down 10 deg, 3 scrape dips at 150 / 300 / 450 ms), charge (head down, gallop bob loop), die (0.4 s tip-over onto the
 *   right side, overshoot thud), dead (held corpse pose, lootable), sink (0.5 s into the ground, from the dead pose).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- the original 5 x 10 x 7 body art (US-079a), unchanged ----
  var E = '.....';
  var LEGS_FRONT = 'B...B'; // z0-1, y1: front leg pair
  var LEGS_BACK = 'B...B';  // z0-1, y8: back leg pair
  var SNOUT = '.BBB.';      // z1-3, y0: head/snout, held low like a boar's
  var TORSO = 'BBBBB';      // z2-3, y1..y8: full torso
  var TAIL = '..D..';       // z2-3, y9: short tail
  var BACK = 'BBBBB';       // z4, y1..y7: body top, tapered at the ends
  var EARS = '.D.D.';       // z5, y1: small ear nubs near the head
  var RIDGE = '.DDD.';      // z5, y2..y6: low back ridge/bristle hump
  var PEAK = '..D..';       // z6, y3..y4: ridge peak (top of the hump)

  var BODY = [
    /* z0 */ [E, LEGS_FRONT, E, E, E, E, E, E, LEGS_BACK, E],
    /* z1 */ [SNOUT, LEGS_FRONT, E, E, E, E, E, E, LEGS_BACK, E],
    /* z2 */ [SNOUT, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TAIL],
    /* z3 */ [SNOUT, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TAIL],
    /* z4 */ [E, BACK, BACK, BACK, BACK, BACK, BACK, BACK, E, E],
    /* z5 */ [E, EARS, RIDGE, RIDGE, RIDGE, RIDGE, RIDGE, E, E, E],
    /* z6 */ [E, E, E, PEAK, PEAK, E, E, E, E, E],
  ];

  // ---- v1.34 grid: inflated white copy in z 0..7, the body at offset (1, 1, 8) above it. The anchor z is 8 (the
  // body's feet), so with NO clip (zero pose) the copy sits 0..0.8 m under the ground = hidden even then. ----
  var SX = 7, SY = 12, SZ = 16, FLASH_DZ = 8;
  function bodyAt(x, y, z) {            // grid coords -> body char or '.'
    var bx = x - 1, by = y - 1;
    if (z < 0 || z >= BODY.length || by < 0 || by >= 10 || bx < 0 || bx >= 5) return '.';
    return BODY[z][by].charAt(bx);
  }
  function solid(x, y, z) { return bodyAt(x, y, z) !== '.'; }
  function buildLayers() {
    var out = [], x, y, z;
    for (z = 0; z < SZ; z++) {
      var rows = [];
      for (y = 0; y < SY; y++) {
        var r = '';
        for (x = 0; x < SX; x++) {
          var c = '.';
          if (z >= FLASH_DZ) c = bodyAt(x, y, z - FLASH_DZ);
          else {
            // inflated copy (body layer zb = z): self + 4-neighbours in the layer + a cap one voxel up
            if (solid(x, y, z) || solid(x - 1, y, z) || solid(x + 1, y, z) || solid(x, y - 1, z) ||
                solid(x, y + 1, z) || solid(x, y, z - 1)) c = 'F';
          }
          r += c;
        }
        rows.push(r);
      }
      out.push(rows);
    }
    return out;
  }

  // ---- pose helpers: flash part always copies the body rot; pos = body pos + [0,0,+8] (shown, exactly over the
  // body) or -64 (hidden 6.4 m under the ground) ----
  function pose(rx, ry, rz, px, py, pz, flashOn) {
    var dz = flashOn ? FLASH_DZ : -64;
    return {
      body:  { rot: [rx, ry, rz], pos: [px, py, pz] },
      flash: { rot: [rx, ry, rz], pos: [px, py, pz + dz] }
    };
  }
  var REST = pose(0, 0, 0, 0, 0, 0, false);
  var DEAD = pose(0, 90, 0, 0, 0, 0, false);

  var animations = {
    idle:   { durations: [1000], loop: true, frames: [REST] },
    // US-079b hurt: every damaging hit. 6 steps (100 ms) white, the head snaps UP (rx -8) and the body jolts 0.1 m back.
    hurt:   { durations: [50, 50], loop: false, interp: 'step', frames: [pose(-8, 0, 0, 0, 1, 0, true), pose(-5, 0, 0, 0, 1, 0, true)] },
    // flinch follow-through: 9 steps (150 ms), flash off, the head drops past rest (rx +3) and settles. Hold = rest.
    flinch: { durations: [60, 90, 100], loop: false, frames: [pose(-5, 0, 0, 0, 1, 0, false), pose(3, 0, 0, 0, 0.4, 0, false), REST] },
    // US-079c windup (0.5 s = 30 steps): backs 0.15 m (pos y +1.5, VIEW-ONLY), head down 10 deg, and three scrape dips
    // (rx 13, body 0.03 m down) at 150 / 300 / 450 ms = the moments boarFx.scrape kicks dust at the forefeet.
    windup: { durations: [120, 30, 75, 75, 75, 75, 50, 100], loop: false, frames: [
      REST,
      pose(10, 0, 0, 0, 1.5, 0, false),
      pose(13, 0, 0, 0, 1.5, -0.3, false),
      pose(10, 0, 0, 0, 1.5, 0, false),
      pose(13, 0, 0, 0, 1.5, -0.3, false),
      pose(10, 0, 0, 0, 1.5, 0, false),
      pose(13, 0, 0, 0, 1.5, -0.3, false),
      pose(10, 0, 0, 0, 1.5, 0, false)
    ] },
    // charge: head down, a 0.2 s gallop bob (body up 0.05 m, rocking 3 deg). Loop. The first key blends from windup.
    charge: { durations: [100, 100], loop: true, frames: [pose(8, 0, 0, 0, 0, 0, false), pose(5, 0, 0, 0, 0, 0.5, false)] },
    // US-079b die: 0.4 s (24 steps). Starts AFTER the killing hit's `hurt` (6 steps). Legs buckle (small sink), it rolls
    // onto its right side about the right foot edge, overshoots 8 deg into the ground (the "thud" frame, dust n 6 here)
    // and settles at 90. Linear keys 90 + 110 + 120 + 80 = 400 ms, then held.
    die:    { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      pose(-5, 0, 0, 0, 0, 0, false),
      pose(4, 18, 0, 0, 0, -0.5, false),
      pose(2, 62, 0, 0, 0, -0.3, false),
      pose(0, 98, 0, 0, 0, 0, false),
      DEAD
    ] },
    // the corpse, held while lootable (owner 2026-10-05: the body stays until looted or the timeout)
    dead:   { durations: [1000], loop: true, frames: [DEAD] },
    // sink: 0.5 s from the dead pose 0.55 m into the ground (the lying body is 0.5 m tall, so nothing is left to pop
    // when the entity is removed at the end). corpseDust bursts at 0 and 250 ms cover it.
    sink:   { durations: [500, 100], loop: false, frames: [DEAD, pose(0, 90, 0, 0, 0, -5.5, false)] }
  };

  A.models.boarPlaceholder = {
    name: 'boarPlaceholder',
    displayName: 'boar (placeholder)',
    desc: 'US-079a placeholder beast: a low two-tone quadruped silhouette (leather hide, a darker back ridge/ears/ ' +
          'tail), 1.0 m long, 0.7 m tall. v1.34: hurt flash (white inflated copy), flinch, windup scrape, charge bob, ' +
          'tip-over death, lootable corpse, sink. Final art comes later; the clip names and timings are the contract.',
    voxel: {
      version: 1,
      cellM: 0.1,
      size: [SX, SY, SZ],
      anchor: [3.5, 6, FLASH_DZ],              // the body's feet (grid z 8); the flash copy below is underground
      mats: { B: 'leather', D: 'canvas_dark', F: 'hit_flash' },
      layers: buildLayers(),
      parts: {
        body:  { box: [0, 0, FLASH_DZ, SX, SY, SZ], pivot: [6, 6, FLASH_DZ] },
        flash: { box: [0, 0, 0, SX, SY, FLASH_DZ], pivot: [6, 6, 0] }
      },
      animations: animations,
      // grid coords, rest pose, on part `body` (posed with the part where the engine supports it). z 8 = ground.
      mounts: {
        notice:   { at: [3.5, 2, 19], part: 'body' },   // 1.1 m: 0.4 m over the 0.7 m ear tops (= t.z + 1.1, as today)
        forefeet: { at: [3.5, 1.5, 8.2], part: 'body' }, // scrape dust origin, between the front legs
        hit:      { at: [3.5, 5, 11.5], part: 'body' }, // flank centre (0.35 m): spark / bristle fallback point
        loot:     { at: [0.5, 6, 11.5], part: 'body' }  // the LEFT flank face = the top of the corpse after the roll
      }
    }
  };

  // ===================================================================================================================
  // ASSETS.boarFx - presentation data for US-079b (hurt / death) and US-079c (notice / windup / scrape).
  // Steps = 60 Hz sim steps. Colours in `overlay` are literal RGB (the overlay takes no palette keys); particle colours
  // are palette keys (the particles.js EmitterDef format, README 8).
  // ===================================================================================================================
  var particles = {
    // windup scrape: 4 clods per kick (3 kicks in the 0.5 s windup), thrown BACKWARD from the forefeet: call
    // setEmitterDir(-facing.x * 0.8, -facing.y * 0.8, 0.6) before burstAt (or pass dx,dy,dz). Brown earth `o` clods
    // -> `,` `.` grit, real-ish gravity, they land and die within ~0.5 s and ~0.6 m. Lit (non-emissive).
    scrapeDust: {
      rate: 0, burst: 4,
      life: [0.35, 0.55], speed: [1.0, 1.8],
      dir: [0, 0, 1], spreadDeg: 35, box: [0.12, 0.05, 0.01],
      accelZ: -6.0, drag: 1.5, wind: 0.2,
      maxLive: 24, killBelow: 0.02,
      glyphs: "oo,,'..",
      colors: ['canvasDark', 'wood', 'wood', 'woodDark', 'ropeDark', 'ashDark', 'ashDark'],
      emissive: false, emissiveFog: 0, sizeM: 0.08
    },
    // corpse "turns to dust": a low rolling cloud over the whole lying body while it sinks. Two bursts (8 + 6 = 14,
    // the US-079b n) at sink 0 and +15 steps. Rises slowly (accelZ +0.3), spreads, drifts with the wind, earthy ash ->
    // pale motes. Box = the lying-body footprint (world-axis half extents, good for any yaw).
    corpseDust: {
      rate: 0, burst: 8,
      life: [0.7, 1.1], speed: [0.3, 0.9],
      dir: [0, 0, 1], spreadDeg: 70, box: [0.35, 0.35, 0.08],
      accelZ: 0.3, drag: 2.0, wind: 0.5,
      maxLive: 32, killBelow: null,
      glyphs: '%%o;;::,.',
      colors: ['ash', 'canvasDark', 'canvasDark', 'ashLight', 'flagWarm', 'ash', 'ash', 'ashDark', 'ashDark'],
      emissive: false, emissiveFog: 0, sizeM: 0.18
    },
    // OPTIONAL hit bristles: 3 dark hairs knocked off the flank on a damaging hit (with the sword `sparks`). Lit.
    hurtBristle: {
      rate: 0, burst: 3,
      life: [0.3, 0.45], speed: [1.0, 2.0],
      dir: [0, 0, 1], spreadDeg: 60, box: [0.05, 0.05, 0.05],
      accelZ: -7.0, drag: 1.0, wind: 0.3,
      maxLive: 12, killBelow: 0.6,
      glyphs: "\\/''.",
      colors: ['ropeDark', 'ropeDark', 'woodDark', 'woodDark', 'ashDark'],
      emissive: false, emissiveFog: 0, sizeM: 0.05
    }
  };

  A.boarFx = {
    version: 1,
    story: 'US-079b (hurt, death, corpse), US-079c (notice, windup scrape)',
    model: 'boarPlaceholder',

    // which voxel clip beastView.js puts in components.voxel.anim (loop flag in the clip). Overrides win in this order:
    // death timeline > hurt/flinch timer > state clip.
    clipFor: {
      state: { wander: 'idle', notice: 'idle', chase: 'charge', windup: 'windup', charge: 'charge', recover: 'idle',
               return: 'idle', stagger: 'flinch' },
      note: 'chase uses the charge gallop too (a placeholder has no walk cycle); swap to a walk clip when the final art lands'
    },

    // US-079b hurt (every damaging hit, incl. the killing one)
    hurt: {
      flashSteps: 6, flashClip: 'hurt', flashColor: 'white', flashMat: 'hit_flash',
      flinchSteps: 9, flinchClip: 'flinch',      // 6 + 9 = 15 steps = the AC's 0.25 s no-movement flinch
      sparks: 'sword sparks as today (particles.mounts.sparks); add hurtBristle at the hit point (optional)',
      rule: 'hit -> clip hurt (restart from key 0 even if playing) for 6 steps -> clip flinch 9 steps -> clipFor.state. ' +
            'A hit during windup cancels the charge (sim) and the view goes straight to hurt.',
      tintAlt: { rgb: [255, 255, 255], steps: 6, note: 'ENGINE OPTION: a per-instance flash tint in the shade pass would ' +
                 'replace the flash part (no doubled grid). Not needed for Sprint 6.' }
    },

    // US-079b death + corpse + despawn (owner 2026-10-05: no instant dust; E to loot; body stays until looted / timeout)
    death: {
      timeline: [
        { step: 0,  clip: 'hurt', note: 'the killing hit flashes like any hit; brain stops; collision off within 6 steps; ' +
                                         'untargetable now (Z-lock breaks)' },
        { step: 6,  clip: 'die', note: 'tip over 24 steps' },
        { step: 25, fx: 'dust', n: 6, at: 'corpseCentre', note: 'the thud (die key 3, 320 ms in): existing particles `dust` preset' },
        { step: 30, clip: 'dead', lootable: true, note: '`[E] Loot boar` interactable + lootGlint on; emit beast:died here ' +
                                                       'or at step 0 (sim choice, exactly once)' }
      ],
      corpseTimeoutSec: 90,                     // suggestion for beastConfig: unlooted corpse sinks after this (loot lost)
      afterLoot: { delaySteps: 18, note: 'after a successful loot (or timeout) wait 0.3 s, then sink' },
      sink: { clip: 'sink', steps: 30, depthM: 0.55,
              dust: [{ atStep: 0, preset: 'corpseDust', n: 8 }, { atStep: 15, preset: 'corpseDust', n: 6 }],
              removeAtStep: 30, note: 'entity removed (or hidden per architecture.md 37.16) at the end of the sink' },
      // the lying body is NOT centred on the entity: it rolled onto its right side about the right foot edge
      corpseCentre: { rightM: 0.6, fwdM: 0, upM: 0.25, note: 'from the entity origin, in the boar\'s own frame ' +
                      '(right = +x at yaw 0; the body rolled about its right foot edge, so the lying body spans 0.25 .. ' +
                      '0.95 m to the right, 0 .. 0.5 m up). Use it for the loot prompt aim, the dust bursts and the ' +
                      'interactable centre' },
      lootInteract: { prompt: '[E] Loot boar', radiusM: 1.6, aimUpM: 0.35,
                      note: 'interactable centre = corpseCentre; prompt style = uiStyle.prompt (gold [E])' },
      lootGlint: { sprite: 'lootGlint', anim: 'idle', upM: 0.7, note: 'billboard at the corpseCentre x/y, entity z + upM ' +
                   '(0.15 m over the 0.55 m flank top = mount `loot` posed) while lootable; removed when looted. Sprite in ' +
                   'ASSETS.lootSprites (design/items.js)' }
    },

    // US-079c notice `!` (overlay.bar 1 x 1 at t.z + noticeUpM, as beastView.js does today)
    notice: {
      noticeUpM: 1.1,                           // 0.4 m above the 0.7 m ears (mount `notice`)
      popSteps: 6, styles: ['beastNoticePop', 'beastNotice'],
      rule: 'first popSteps steps of the notice pause draw style beastNoticePop (white-hot), then beastNotice (alert ' +
            'yellow) until the notice pause ends. Not drawn in windup (the scrape is the windup read).',
      readability: '1 overlay cell at any distance (screen-space): at 12 m / 240x90 the boar is ~6 rows tall, the `!` ' +
                   'sits 2-3 rows over it'
    },

    // US-079c windup (0.5 s) scrape
    scrape: {
      clip: 'windup', kickSteps: [9, 18, 27], preset: 'scrapeDust', n: 4, at: 'mount forefeet (z + 0.03)',
      dir: 'backward: (-facing.x * 0.8, -facing.y * 0.8, 0.6)',
      backM: 0.15, pitchDeg: 10, note: 'back-off and pitch are in the clip (view-only); the sim does not move the boar'
    },

    // overlay styles: spread into engine.overlay.setStyles AFTER questOverlayStyles(uiStyle) (they replace the US-079a
    // placeholder beastNotice). fg literal RGB; palette key in note.
    overlay: {
      beastNotice:    { glyph: '!', fg: [255, 210, 58],  note: 'palette alert #ffd23a (ui.alert)' },
      beastNoticePop: { glyph: '!', fg: [255, 246, 196], note: 'palette alertLight #fff6c4: the first 6 steps (pop)' }
    },

    particles: particles,
    // copies the boar presets into ASSETS.particles.presets so the existing main.js defineEmitter loop picks them up.
    // Call once after design/models/particles.js and this file are both loaded (before the loop).
    attach: function () {
      var P = A.particles;
      if (!P || !P.presets) return false;
      for (var k in particles) if (!P.presets[k]) P.presets[k] = particles[k];
      return true;
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { boarPlaceholder: A.models.boarPlaceholder, boarFx: A.boarFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
