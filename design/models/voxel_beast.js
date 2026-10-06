/* design/models/voxel_beast.js - US-079 real wild boar (designer, v1.40), replacing the US-079a placeholder art.
 *                                Sprint 6 designer pass A (v1.34) data kept: hurt / flinch / windup / charge / die / dead /
 *                                sink clips, the hit-flash copy part, the mounts and ASSETS.boarFx (US-079b / US-079c).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/rts_unit.js:
 *   <script src="../design/models/voxel_beast.js">     (browser, game/index.html)
 *   import '../../../design/models/voxel_beast.js';     (Node tests: side-effect import)
 * Sets ASSETS.models.boarPlaceholder directly (format: design/README.md section 4/7, architecture.md 15.1). The model
 * KEY stays `boarPlaceholder` (world files, tests and the editor folder table use it); only the art and the clip poses
 * changed. Only ALREADY-MERGED palette materials (no merge step). v1.40: `meshOnly: true` (the game renders voxels
 * through the mesh path only since ME-19a; the finer 12 x 25 x 29 grid would otherwise cost DDA atlas rows).
 *
 * Axes (15.1): x = east (= the boar's RIGHT at yaw 0), y = SOUTH with y0 = the model's FRONT row (faces north at
 * yaw 0), z = up. v1.40: cellM 0.1 -> 0.05 (twice the detail, the SAME world size). The boar is 0.5 m wide, 1.05 m
 * snout to rump (+ a 0.1 m curly tail), 0.7 m to the top of the shoulder mane: boar-local box 10 x 23 x 14 voxels at
 * grid offset (1, 1, 15), one free voxel ring round it for the flash copy. Anchor [6, 11.5, 15] = the feet, centred
 * under snout..rump = the same world placement as before. Clip `pos` values are VOXELS (so 0.05 m each now).
 *
 * Look (owner taste: chunky Blood / Build-engine voxel props): wedge head held low, heavy shoulder hump with a dark
 * bristle mane crest, back sloping to a smaller rump, short dark legs with iron-dark hooves, a small curly tail.
 * Value ladder: pale tusks (linen_light) > tan muzzle (rope) > grey cheeks (linen_dark) > grizzled grey-brown hide
 * (timber_old, `|` bristle texels) > brown belly (leather) > near-black mane / legs / ears (canvas_burnt) > hooves
 * (iron_dark). Eyes: 1 voxel each of ember_glow (emissive) so the facing reads at 12 m in shade; swap EYE_MAT to
 * 'iron_dark' for plain dark eyes.
 *
 * v1.40 parts (8 = MAX_VOX_PARTS; insertion order = part index; children list a parent EARLIER in the order):
 *   body   box [0,8,19, 12,22,29]  pivot [11, 11.5, 15] = the boar's RIGHT body edge, mid-length, on the ground. Root.
 *                                  rx = pitch (+ = nose down), ry = roll (+ = top to the boar's right; 90 = lying on
 *                                  its right side, legs out to the left). Torso, mane, belly.
 *   flash  box [0,0,0, 12,25,15]   pivot [11, 11.5, 0]: a WHITE (`hit_flash`, emissive 1.0) copy of the WHOLE rest-pose
 *                                  boar grown by one voxel to the sides and on top, stored BELOW the body (underground
 *                                  even with no clip). A clip shows it with pos body + [0,0,+15] and hides it with
 *                                  [0,0,-64]; it always copies the body rot. Root. While it is shown (clip `hurt`) every
 *                                  child part is at rest, so the shell covers the whole boar.
 *   head   box [0,0,15, 12,8,29]   pivot [6, 8, 22] (the neck), parent body: snout, nose disc, tusks, eyes, ears, jowls.
 *   legFL / legFR / legBL / legBR  box 2 x 2 x 4 under the belly (z 15..18), pivot at the hip / shoulder top (z 19),
 *                                  parent body. rx - = foot forward, rx + = foot back. (L = x small = the boar's left.)
 *   tail   box [5,22,22, 7,24,25]  pivot [6, 22, 24.5], parent body. rx + = raised (boars run tail-up), ry = wag.
 *
 * Clip -> state map (who plays what: ASSETS.boarFx.clipFor; view-only, beastView.js sets components.voxel.anim). Every
 * clip name, key count used by boarFx and every duration is unchanged from v1.34 except `idle` (1 -> 4 keys, a free
 * idle loop) and `charge` (2 x 100 -> 4 x 50 ms, same 200 ms loop):
 *   idle (sniff + tail wag loop), hurt (6 steps, flash ON, step interp), flinch (9 steps, flash off), windup (0.5 s: back
 *   0.15 m, head down, the LEFT forefoot scrapes back at 150 / 300 / 450 ms = boarFx.scrape kicks, tail up), charge
 *   (gallop: legs reach / gather, body bob, head low, tail up; loop), die (0.4 s: squeal, legs buckle, roll onto the
 *   right side, thud key at 320 ms with the legs kicking, settles), dead (held: stiff splayed legs, lootable), sink
 *   (0.5 s, 0.55 m into the ground, from the dead pose). Spare: walk (trot loop for 1.5 m/s; needs a beastView line).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- boar-local box (x 0..9, y 0..22 snout -> tail, z 0..13) and the grid around it ----
  var BW = 10, BLEN = 23, BH = 14;
  var OX = 1, OY = 1, FZ = BH + 1;                  // grid offset of the boar; FZ = flash layers (14 + the cap) = anchor z
  var SX = BW + 2, SY = BLEN + 2, SZ = FZ + BH;     // 12 x 25 x 29
  var EYE_MAT = 'ember_glow';                       // 'iron_dark' = plain dark eyes (see the header)

  // Per-slice profile of head + torso, y 0 (snout) .. 20 (rump): [zLo, zHi, width]. Widths are even (centred on x 5).
  var PROFILE = [
    [3, 5, 4],  [3, 6, 4],  [3, 6, 4],  [3, 7, 6],  [2, 8, 6],  [2, 9, 6],  [2, 10, 8],     // y0..6  head (snout -> jowls)
    [4, 11, 8], [4, 12, 10], [4, 12, 10], [4, 12, 10], [4, 12, 10],                         // y7..11 neck + shoulder hump
    [4, 11, 10], [4, 11, 10], [4, 11, 10], [4, 10, 10], [4, 10, 10], [4, 10, 10],           // y12..17 barrel, back slopes
    [4, 10, 8], [5, 9, 8], [5, 9, 6]                                                        // y18..20 rump
  ];

  function blank() {
    var g = [], z, y, x;
    for (z = 0; z < BH; z++) { g.push([]); for (y = 0; y < BLEN; y++) { g[z].push([]); for (x = 0; x < BW; x++) g[z][y].push('.'); } }
    return g;
  }
  function rowWidth(p, z) {                        // rounded cross-section: narrower top rows and belly row
    var w = p[2];
    if (z === p[1]) w -= (w >= 8 ? 4 : w >= 4 ? 2 : 0);
    else if (z === p[1] - 1 && w >= 8) w -= 2;
    else if (z === p[0] && w >= 6) w -= 2;
    return Math.max(2, w);
  }
  function buildBoar() {
    var g = blank(), y, z, x, p, w, x0, c;
    function put(px, py, pz, ch) { if (px >= 0 && px < BW && py >= 0 && py < BLEN && pz >= 0 && pz < BH) g[pz][py][px] = ch; }
    for (y = 0; y < PROFILE.length; y++) {
      p = PROFILE[y];
      for (z = p[0]; z <= p[1]; z++) {
        w = rowWidth(p, z); x0 = 5 - w / 2;
        for (x = x0; x < x0 + w; x++) {
          c = 'H';                                                    // grizzled grey-brown hide
          if (y === 0) c = z >= 4 ? 'N' : 'S';                        // nose disc over a tan lip
          else if (y <= 2 || (y === 3 && z <= 5)) c = 'S';            // long tan muzzle
          else if (y <= 6) {                                          // head: grey cheeks + jaw
            if (z === p[0] || (z <= p[0] + 2 && (x === x0 || x === x0 + w - 1))) c = 'C';
          } else {                                                    // torso
            if (z === p[0]) c = 'L';                                  // brown belly
            else if (z === p[1] && y <= 12) c = 'M';                  // dark mane over the shoulders
          }
          put(x, y, z, c);
        }
      }
    }
    // mane crest: a 2-wide bristle ridge, solid over the hump, ragged down the back
    for (y = 7; y <= 17; y++) {
      if (y > 12 && (y % 2) === 0) continue;
      put(4, y, PROFILE[y][1] + 1, 'M'); put(5, y, PROFILE[y][1] + 1, 'M');
    }
    // eyes (y5, z7: the outer columns of the head) and the ears (y6, over the brow, pointing up and out)
    put(2, 5, 7, 'E'); put(7, 5, 7, 'E');
    put(2, 6, 11, 'M'); put(3, 6, 11, 'M'); put(2, 6, 12, 'M');
    put(6, 6, 11, 'M'); put(7, 6, 11, 'M'); put(7, 6, 12, 'M');
    // tusks: from the jaw corner forward and hooking up beside the snout (outside the 4-wide muzzle)
    var TUSK = [[3, 4], [2, 4], [2, 5], [1, 5], [1, 6]];
    for (c = 0; c < TUSK.length; c++) { put(2, TUSK[c][0], TUSK[c][1], 'T'); put(7, TUSK[c][0], TUSK[c][1], 'T'); }
    // legs: 2 x 2, hoof + 3 dark leg voxels; front pair under the shoulders, back pair under the haunch
    var LEGS = [[1, 8], [7, 8], [1, 16], [7, 16]];
    for (c = 0; c < LEGS.length; c++) {
      for (z = 0; z < 4; z++) for (y = 0; y < 2; y++) for (x = 0; x < 2; x++) {
        put(LEGS[c][0] + x, LEGS[c][1] + y, z, z === 0 ? 'K' : 'F');
      }
    }
    // small curly tail off the rump top: back, down, a dark tuft curling forward
    var TAIL = [[21, 9, 'H'], [22, 9, 'H'], [22, 8, 'H'], [22, 7, 'M'], [21, 7, 'M']];
    for (c = 0; c < TAIL.length; c++) { put(4, TAIL[c][0], TAIL[c][1], TAIL[c][2]); put(5, TAIL[c][0], TAIL[c][1], TAIL[c][2]); }
    return g;
  }
  var BOAR = buildBoar();

  function boarAt(x, y, z) {            // grid coords (boar region, z >= FZ) -> char or '.'
    var bx = x - OX, by = y - OY, bz = z - FZ;
    if (bx < 0 || bx >= BW || by < 0 || by >= BLEN || bz < 0 || bz >= BH) return '.';
    return BOAR[bz][by][bx];
  }
  function solidL(x, y, zb) {           // grid x/y, boar-local z
    return boarAt(x, y, zb + FZ) !== '.';
  }
  function buildLayers() {
    var out = [], x, y, z;
    for (z = 0; z < SZ; z++) {
      var rows = [];
      for (y = 0; y < SY; y++) {
        var r = '';
        for (x = 0; x < SX; x++) {
          var c = '.';
          if (z >= FZ) c = boarAt(x, y, z);
          else if (solidL(x, y, z) || solidL(x - 1, y, z) || solidL(x + 1, y, z) || solidL(x, y - 1, z) ||
                   solidL(x, y + 1, z) || solidL(x, y, z - 1)) c = 'W';   // inflated white copy (layer z = boar z)
          r += c;
        }
        rows.push(r);
      }
      out.push(rows);
    }
    return out;
  }

  // ---- pose helper. o = { b: [rx, ry, rz, px, py, pz] body, h: head pitch, hz: head turn, fl/fr/bl/br: leg swing,
  // t: [rx, ry] tail }. The flash part copies the body rot; pos = body pos + [0,0,+15] (shown) or -64 (hidden). ----
  function pose(o, flashOn) {
    var b = o.b || [0, 0, 0, 0, 0, 0], t = o.t || [0, 0];
    var dz = flashOn ? FZ : -64;
    return {
      body:  { rot: [b[0], b[1], b[2]], pos: [b[3], b[4], b[5]] },
      flash: { rot: [b[0], b[1], b[2]], pos: [b[3], b[4], b[5] + dz] },
      head:  { rot: [o.h || 0, 0, o.hz || 0] },
      legFL: { rot: [o.fl || 0, 0, 0] },
      legFR: { rot: [o.fr || 0, 0, 0] },
      legBL: { rot: [o.bl || 0, 0, 0] },
      legBR: { rot: [o.br || 0, 0, 0] },
      tail:  { rot: [t[0], t[1], 0] }
    };
  }
  var REST = pose({}, false);
  var DEAD_O = { b: [0, 90, 0, 0, 0, 0], h: -6, fl: -24, fr: -16, bl: 24, br: 16, t: [25, 0] };
  var DEAD = pose(DEAD_O, false);
  var SUNK = pose({ b: [0, 90, 0, 0, 0, -11], h: -6, fl: -24, fr: -16, bl: 24, br: 16, t: [25, 0] }, false);
  // windup keys: crouch (left forefoot forward, ready) / scrape (forefoot swept back = the dust kick)
  var W_READY = pose({ b: [6, 0, 0, 0, 3, 0], h: 12, fl: -28, bl: -10, br: -10, t: [60, 0] }, false);
  var W_KICK = pose({ b: [7.5, 0, 0, 0, 3, -0.6], h: 15, fl: 32, bl: -10, br: -10, t: [60, 10] }, false);

  var animations = {
    // free idle loop (2.4 s): sniffs down to the left, looks right, tail wags
    idle:   { durations: [600, 500, 700, 600], loop: true, frames: [
      pose({ t: [10, 0] }, false),
      pose({ h: 7, hz: 6, t: [10, 25] }, false),
      pose({ h: 4, hz: -5, t: [10, -20] }, false),
      pose({ h: 1, t: [10, 0] }, false)
    ] },
    // US-079b hurt: every damaging hit. 6 steps (100 ms) white, the whole boar snaps head-UP (body rx -8) and jolts
    // 0.1 m back. Children at rest so the white shell covers everything.
    hurt:   { durations: [50, 50], loop: false, interp: 'step', frames: [
      pose({ b: [-8, 0, 0, 0, 2, 0] }, true), pose({ b: [-5, 0, 0, 0, 2, 0] }, true)
    ] },
    // flinch follow-through: 9 steps (150 ms), flash off; the head drops past rest, the forelegs brace, tail clamps.
    flinch: { durations: [60, 90, 100], loop: false, frames: [
      pose({ b: [-5, 0, 0, 0, 2, 0], h: -6, t: [40, 0] }, false),
      pose({ b: [3, 0, 0, 0, 0.8, 0], h: 8, fl: 8, fr: 8, t: [20, 0] }, false),
      REST
    ] },
    // US-079c windup (0.5 s = 30 steps): backs 0.15 m (pos y +3, VIEW-ONLY), head down, tail up, and the left forefoot
    // scrapes back at 150 / 300 / 450 ms (keys 2 / 4 / 6) = the moments boarFx.scrape kicks dust at the forefeet.
    windup: { durations: [120, 30, 75, 75, 75, 75, 50, 100], loop: false, frames: [
      REST, W_READY, W_KICK, W_READY, W_KICK, W_READY, W_KICK,
      pose({ b: [7, 0, 0, 0, 3, 0], h: 16, bl: -14, br: -14, t: [70, 0] }, false)
    ] },
    // charge (also chase): a 0.2 s bound gallop - legs reach (front fwd / back back), lift, gather under, lift. Head
    // low, tail up and flicking. Loop. The first key blends from the windup end pose.
    charge: { durations: [50, 50, 50, 50], loop: true, frames: [
      pose({ b: [5, 0, 0, 0, 0, 0], h: 14, fl: -30, fr: -24, bl: 30, br: 24, t: [75, 8] }, false),
      pose({ b: [3, 0, 0, 0, 0, 1.2], h: 12, fr: 6, br: -6, t: [75, 0] }, false),
      pose({ b: [7, 0, 0, 0, 0, 0], h: 16, fl: 26, fr: 20, bl: -26, br: -20, t: [75, -8] }, false),
      pose({ b: [5, 0, 0, 0, 0, 0.6], h: 14, fl: 6, bl: -6, t: [75, 0] }, false)
    ] },
    // spare (not wired): trot for wander / return at 1.5 m/s, diagonal pairs, 280 ms loop
    walk:   { durations: [70, 70, 70, 70], loop: true, frames: [
      pose({ h: 3, fl: -22, br: -22, fr: 18, bl: 18, t: [20, 8] }, false),
      pose({ b: [0, 0, 0, 0, 0, 0.5], h: 4 }, false),
      pose({ h: 3, fl: 18, br: 18, fr: -22, bl: -22, t: [20, -8] }, false),
      pose({ b: [0, 0, 0, 0, 0, 0.5], h: 4 }, false)
    ] },
    // US-079b die: 0.4 s (24 steps). Starts AFTER the killing hit's `hurt` (6 steps). Squeal (head up), legs buckle,
    // it rolls onto its right side about the right body edge, overshoots 8 deg into the ground with the legs kicking out
    // (the "thud" key at 320 ms, dust n 6 here) and settles at 90 with stiff splayed legs. 90 + 110 + 120 + 80 = 400 ms.
    die:    { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      pose({ b: [-5, 0, 0, 0, 0, 0], h: -12, t: [30, 0] }, false),
      pose({ b: [4, 18, 0, 0, 0, -1], h: 6, fl: 25, fr: 25, bl: -20, br: -20 }, false),
      pose({ b: [2, 62, 0, 0, 0, -0.6], fl: -10, fr: -5, bl: 15, br: 10 }, false),
      pose({ b: [0, 98, 0, 0, 0, 0], h: -10, fl: -35, fr: -28, bl: 35, br: 28, t: [20, 0] }, false),
      DEAD
    ] },
    // the corpse, held while lootable (owner 2026-10-05: the body stays until looted or the timeout)
    dead:   { durations: [1000], loop: true, frames: [DEAD] },
    // sink: 0.5 s from the dead pose 0.55 m (11 voxels) into the ground (the lying body + legs are <= 0.55 m tall, so
    // nothing is left to pop when the entity is hidden at the end). corpseDust bursts at 0 and 250 ms cover it.
    sink:   { durations: [500, 100], loop: false, frames: [DEAD, SUNK] }
  };

  A.models.boarPlaceholder = {
    name: 'boarPlaceholder',
    displayName: 'wild boar',
    desc: 'US-079 wild boar (v1.40; key kept from the US-079a placeholder): low wedge head with a tan muzzle, nose disc ' +
          'and pale hooked tusks, glowing eyes, heavy shoulder hump under a near-black bristle mane, grizzled grey-brown ' +
          'hide, brown belly, short dark legs, a small curly tail. 0.5 x 1.05 x 0.7 m. 8 parts (body, hit-flash shell, ' +
          'head, 4 legs, tail): sniff idle, hurt flash, flinch, hoof-scrape windup, gallop charge, roll-over death, ' +
          'lootable corpse, sink, spare trot.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [6, 11.5, FZ],                  // the feet (grid z 15); the flash copy below is underground
      mats: {
        H: 'timber_old',      // hide: grizzled grey-brown, `|` bristle texels
        L: 'leather',         // belly
        M: 'canvas_burnt',    // mane crest, ears, tail tuft (near-black bristle)
        F: 'canvas_burnt',    // legs
        K: 'iron_dark',       // hooves
        S: 'rope',            // muzzle (lighter tan)
        N: 'gore_red_dark',   // nose disc
        C: 'linen_dark',      // grey cheeks / jaw
        T: 'linen_light',     // tusks
        E: EYE_MAT,           // eyes
        W: 'hit_flash'        // the flash shell
      },
      layers: buildLayers(),
      parts: {
        body:  { box: [0, 8, FZ + 4, SX, 22, SZ], pivot: [11, 11.5, FZ] },
        flash: { box: [0, 0, 0, SX, SY, FZ], pivot: [11, 11.5, 0] },
        head:  { box: [0, 0, FZ, SX, 8, SZ], pivot: [6, 8, FZ + 7], parent: 'body' },
        legFL: { box: [2, 9, FZ, 4, 11, FZ + 4], pivot: [3, 10, FZ + 4], parent: 'body' },
        legFR: { box: [8, 9, FZ, 10, 11, FZ + 4], pivot: [9, 10, FZ + 4], parent: 'body' },
        legBL: { box: [2, 17, FZ, 4, 19, FZ + 4], pivot: [3, 18, FZ + 4], parent: 'body' },
        legBR: { box: [8, 17, FZ, 10, 19, FZ + 4], pivot: [9, 18, FZ + 4], parent: 'body' },
        tail:  { box: [5, 22, FZ + 7, 7, 24, FZ + 10], pivot: [6, 22, FZ + 9.5], parent: 'body' }
      },
      animations: animations,
      // grid coords, rest pose, on part `body` (posed with the part where the engine supports it). z 15 = ground.
      // Same world points as v1.34 (cellM halved, coordinates doubled round the new anchor).
      mounts: {
        notice:   { at: [6, 4, FZ + 22], part: 'body' },     // 1.1 m: 0.4 m over the 0.7 m mane top (= t.z + 1.1)
        forefeet: { at: [6, 10, FZ + 0.4], part: 'body' },   // scrape dust origin, between the front legs
        hit:      { at: [6, 11.5, FZ + 7], part: 'body' },   // flank centre (0.35 m): spark / bristle fallback point
        loot:     { at: [0, 11.5, FZ + 7], part: 'body' }    // 0.05 m off the LEFT flank = the top of the corpse (0.55 m)
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
      note: 'chase uses the charge gallop. v1.40: a spare `walk` trot clip (280 ms loop, tuned for walk 1.5 m/s) exists; ' +
            'wiring it for wander / return while the boar moves is a beastView change (STATE_CLIPS), not done here'
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
      // the lying body is NOT centred on the entity: it rolled onto its right side about the right body edge
      corpseCentre: { rightM: 0.6, fwdM: 0, upM: 0.25, note: 'from the entity origin, in the boar\'s own frame ' +
                      '(right = +x at yaw 0; the body rolled about its right body edge, so the lying body spans 0.25 .. ' +
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
      noticeUpM: 1.1,                           // 0.4 m above the 0.7 m mane top (mount `notice`)
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
      backM: 0.15, pitchDeg: 10, note: 'back-off, head dip and the left-forefoot scrape are in the clip (view-only); the ' +
                                       'sim does not move the boar'
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
