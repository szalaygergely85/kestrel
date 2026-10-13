/* design/models/quest_mark.js - WoW-style quest marker (designer, v1.46, owner request 2026-10-08; v1.57 QM-SLIM, owner
 * 2026-10-10 "too much glow, too thick, make a sexy sign"): a slim golden 3D '!' that floats over a giver / the ACTIVE
 * quest step's target, spins slowly and bobs; it pops in when a step starts and scales out when the step completes.
 * `questMarkReady` (QG-D1, D-058) = the golden '?' twin shown over a giver while the quest is ready to hand in
 * (`questMarkTurnIn` = legacy alias of the same object).
 *
 * ASSET ONLY: no engine / game wiring here. Classic script (no import/export, check-deps rule 4), same loading
 * convention as design/models/chest.js:
 *   <script src="../design/models/quest_mark.js">       (browser, game/index.html, after props_m1.js)
 *   import '../../../design/models/quest_mark.js';       (Node tests: side-effect import; module.exports below)
 * Sets ASSETS.voxelModels.questMark / questMarkReady (+ alias questMarkTurnIn) (= ASSETS.models.*, no billboard) and
 * ASSETS.questMarkFx.
 * Materials: brass_dark (merged) + mark_gold / mark_shine (v1.57, appended last in palette.js + detail-pass.js).
 * Format: design/README.md sections 7 + 20, architecture.md 15.1 (VoxelModelDef). Preview: design/preview/quest-mark.html.
 *
 * Axes (15.1): x = east, y = south, z = up. The glyph stands in the x-z plane; y0 = the front face (faces -y at rot 0),
 * y2 = the back face. v1.57: cellM 0.035, grid 12 x 3 x 32 = 0.42 wide x 0.105 deep; glyph 22 rows = 0.77 m tall.
 *   z0..z9   EMPTY: the 0.35 m float (questMarkFx.floatM, unchanged). Anchor = [6, 1.5, 0] = the base point, so the
 *            instance z is the top of whatever the marker hovers over (note on the ground: z = ground + 1.55 puts the
 *            glyph's bottom 1.9 m above it, questMarkFx.placement unchanged). Instance scale (pop / fade) shrinks the
 *            float too, so the marker grows out of / sinks into its target.
 *   z10..z31 the glyph: 22 rows = an 8 x 20 gold stroke glyph + a 1-voxel dark outline all round. x0 / x11 = pads.
 *
 * Look (style guide: gold = loot / reward / quest language). A thin coin-edge sign, 3 tones:
 *   y0 / y2 (the faces): the gold glyph, strokes 2 voxels (0.07 m) wide. mark_gold (gold #ffd24a, emissive 0.40) =
 *     the body; mark_shine (brassHot #fff0b4, emissive 0.45) = a 1-voxel shine on the viewer's LEFT edge of every
 *     stroke (front: no gold at x-1; back: no gold at x+1, mirrored) = a polished bevel catching the light.
 *   y1 (the middle): the glyph dilated by 1 voxel (8-neighbour) in brass_dark (#7a5e28, NOT emissive). Face-on it is a
 *     crisp dark outline round the gold (reads against the bright sky); edge-on it is the dark coin rim.
 *   GLOW: only mark_gold / mark_shine are glow sources (glow.js: emissive >= 0.3) -> a faint aura, no blob. The old
 *     brass_glint (0.90) core band and ember_glow (0.90) lips are gone.
 *   SHAPES (core 8 x 20, top-down): '!' = a 4-wide rounded head tapering to a 2-wide bar (11 rows), a 5-row gap, a
 *     round 4 x 4 dot (corners cut). '?' = a 2-wide hook (rounded top, ball-ish left terminal), a diagonal 3-wide
 *     step into a 2-wide stem, the same gap + dot. The gap after the outline is 3 empty voxels (0.105 m), so neither
 *     glyph fuses into 'l' / '2' at 12 m.
 *
 * Parts: mark  root  box [0,0,10, 12,3,32]  pivot [6, 1.5, 21] = the glyph centre (spin about the vertical axis).
 * Clips (lane C / content: components.voxel.anim = the clip name; questMarkFx.clipFor maps marker state -> clip):
 *   idle  loop, 2 s: spin 0.5 rev/s (rot z -180 -> +180) + bob 0.08 m (sine, period 2 s), 16 keys x 125 ms
 *         + a 0.01 ms WRAP key at +180 (validator: |rot| <= 180 and durations > 0). The engine stepper (animation.js)
 *         carries leftover time past a 0.01 ms key, so the 180 -> -180 interpolation (same pose) is never visible.
 *   bob   loop, 2 s: bob only (no spin). Use it if the view drives the spin itself: inst.yawDeg += 180 * dt_s.
 *   pop   0.3 s, non-loop, held: rises from 0.2 m low, overshoots +0.06 m, settles; whips 180 deg; ends on idle's first
 *         pose (rot +-180, z 0). Scale-in = questMarkFx.popScale on inst.scale (ENGINE NOTE: clips have no scale key).
 *   fade  0.25 s, non-loop, held: hop up 0.3 m with a 180 deg whip; scale-out = questMarkFx.fadeScale. Remove the
 *         marker entity when it ends.
 *   Clip positions are in voxel units: written in metres and divided by CELL (vm()), so they survive a cell change.
 * Mounts: light (gold point light, low: questMarkFx.light; at the glyph's bottom so it warms the target below),
 *         anchor (the base point, z0), top (above the glyph, spare), center (glyph centre).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  var CELL = 0.035;
  var FLOAT = 10;              // empty voxel layers under the glyph = 0.35 m (questMarkFx.floatM)
  var CW = 8, CH = 20;         // the gold core glyph: 8 cols x 20 rows (top-down)
  var SW = CW + 2, SH = CH + 2;                   // + the 1-voxel dark outline: 10 x 22 (0.35 x 0.77 m)
  var SX = SW + 2, SY = 3, SZ = FLOAT + SH;       // + x pads: 12 x 3 x 32

  var MATS = {
    O: 'brass_dark',    // the outline / coin rim (y1, dilated glyph), not emissive
    C: 'mark_gold',     // the gold body on both faces (emissive 0.40, faint aura)
    S: 'mark_shine'     // the left-edge shine on both faces (emissive 0.45)
  };

  // Gold core glyphs drawn TOP-DOWN (row 0 = top), 'X' = gold cell; 8 cols x 20 rows.
  var GLYPHS = {
    bang: [
      '...XX...',   // 0  rounded head
      '..XXXX..',   // 1
      '..XXXX..',   // 2
      '..XXXX..',   // 3
      '...XX...',   // 4  tapering bar
      '...XX...',   // 5
      '...XX...',   // 6
      '...XX...',   // 7
      '...XX...',   // 8
      '...XX...',   // 9
      '...XX...',   // 10 tip
      '........',   // 11 gap (5 core rows = 3 empty voxels after the outline)
      '........',   // 12
      '........',   // 13
      '........',   // 14
      '........',   // 15
      '...XX...',   // 16 round dot
      '..XXXX..',   // 17
      '..XXXX..',   // 18
      '...XX...'    // 19
    ],
    query: [
      '..XXXX..',   // 0  top of the hook
      '.XXXXXX.',   // 1
      'XXX..XXX',   // 2
      'XX....XX',   // 3
      'XX....XX',   // 4  left terminal
      '......XX',   // 5
      '.....XXX',   // 6  the hook turns in
      '....XXX.',   // 7
      '...XXX..',   // 8
      '...XX...',   // 9  stem
      '...XX...',   // 10
      '........',   // 11 gap
      '........',   // 12
      '........',   // 13
      '........',   // 14
      '........',   // 15
      '...XX...',   // 16 round dot
      '..XXXX..',   // 17
      '..XXXX..',   // 18
      '...XX...'    // 19
    ]
  };

  function build(rows) {
    // c, r in the SW x SH glyph frame (outline included): core cell = rows[r - 1][c - 1]
    function core(c, r) { return c >= 1 && c <= CW && r >= 1 && r <= CH && rows[r - 1].charAt(c - 1) === 'X'; }
    function rim(c, r) {
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) if (core(c + dc, r + dr)) return true;
      return false;
    }
    var layers = [], z, y, x;
    for (z = 0; z < SZ; z++) {
      var L = [];
      for (y = 0; y < SY; y++) {
        var row = '';
        for (x = 0; x < SX; x++) {
          var c = x - 1, r = SZ - 1 - z, ch = '.';
          if (z >= FLOAT) {
            if (y === 1) { if (rim(c, r)) ch = 'O'; }
            else if (core(c, r)) {
              var edgeSide = y === 0 ? c - 1 : c + 1;   // the viewer's left: -x from the front, +x from behind
              ch = core(edgeSide, r) ? 'C' : 'S';
            }
          }
          row += ch;
        }
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }

  // ---- clips (voxel units = metres / CELL) ---------------------------------------------------------------------
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function vm(m) { return r3(m / CELL); }
  var BOB_V = 0.08 / CELL;         // 0.08 m
  var N = 16, KEY_MS = 125;        // 16 keys x 125 ms = 2000 ms
  function idleClip(spin) {
    var frames = [], durations = [], i;
    for (i = 0; i < N; i++) {
      var f = { mark: { pos: [0, 0, r3(BOB_V * Math.sin(2 * Math.PI * i / N))] } };
      if (spin) f.mark.rot = [0, 0, -180 + 360 * i / N];
      frames.push(f);
      durations.push(KEY_MS);
    }
    if (spin) {   // wrap key: +180 = the same pose as -180; 0.01 ms long, never sampled by the stepper
      frames.push({ mark: { rot: [0, 0, 180], pos: [0, 0, 0] } });
      durations[N - 1] = KEY_MS - 0.01;
      durations.push(0.01);
    }
    return { durations: durations, loop: true, frames: frames };
  }
  var CLIPS = {
    idle: idleClip(true),
    bob: idleClip(false),
    pop: { durations: [90, 90, 70, 50], loop: false, frames: [
      { mark: { rot: [0, 0, 0],   pos: [0, 0, vm(-0.2)] } },     // 0.2 m low (and scale ~0: invisible)
      { mark: { rot: [0, 0, 100], pos: [0, 0, vm(0.06)] } },     // overshoot up, whipping round
      { mark: { rot: [0, 0, 160], pos: [0, 0, vm(-0.015)] } },   // settle
      { mark: { rot: [0, 0, 180], pos: [0, 0, 0] } }             // = idle key 0 (rot -180 == +180, z 0): seamless hand-over
    ] },
    fade: { durations: [60, 90, 70, 30], loop: false, frames: [
      { mark: { rot: [0, 0, 0],   pos: [0, 0, 0] } },
      { mark: { rot: [0, 0, 45],  pos: [0, 0, vm(0.08)] } },     // a little hop (+ scale 1.15: the "ding")
      { mark: { rot: [0, 0, 135], pos: [0, 0, vm(0.2)] } },      // whips away upward while shrinking
      { mark: { rot: [0, 0, 180], pos: [0, 0, vm(0.3)] } }       // held (scale 0.05) until the entity is removed
    ] }
  };

  function record(key, rows, desc) {
    var cz = FLOAT + SH / 2;   // 21
    var voxel = {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [SX / 2, SY / 2, 0],             // the base point: instance z = top of the thing it floats over
      meshOnly: true,                          // mesh path only (ME-19a), like the chest
      mats: MATS,
      layers: build(rows),
      parts: {
        mark: { box: [0, 0, FLOAT, SX, SY, SZ], pivot: [SX / 2, SY / 2, cz] }
      },
      animations: CLIPS,
      mounts: {
        light:  { at: [SX / 2, SY / 2, FLOAT], part: 'mark' },        // glyph bottom: warms the target below
        anchor: { at: [SX / 2, SY / 2, 0], part: 'mark' },            // base point (bobs +-0.08 m with the part)
        center: { at: [SX / 2, SY / 2, cz], part: 'mark' },
        top:    { at: [SX / 2, SY / 2, SZ + 1], part: 'mark' }        // spare (e.g. a "3/5" counter label)
      }
    };
    return {
      name: key, desc: desc, voxel: voxel,
      world: { w: +(SX * CELL).toFixed(3), d: +(SY * CELL).toFixed(3), h: +(SZ * CELL).toFixed(3),
               glyphW: +(SW * CELL).toFixed(3), glyphH: +(SH * CELL).toFixed(3), floatM: +(FLOAT * CELL).toFixed(3),
               strokeM: +(2 * CELL).toFixed(3) },
      readability: { note: 'see design/preview/quest-mark.html captions: rows x cols at 3 m and 12 m, 240x90 / 400x150, day / night' }
    };
  }

  A.voxelModels.questMark = record('questMark', GLYPHS.bang,
    'Quest marker (owner 2026-10-08; v1.57 slim): a slim golden 3D "!" floating 0.35 m over a giver / the active ' +
    'quest step\'s target, 0.42 x 0.105 x 0.77 m glyph: 2-voxel gold strokes (mark_gold, emissive 0.40) with a pale ' +
    'shine edge (mark_shine 0.45) and a dark brass outline (not emissive). Spins 0.5 rev/s and bobs 0.08 m.');
  // QG-D1 (D-058, architecture 38.35 item 7): `questMarkReady` = the golden 3D '?' over a giver whose quest is READY to
  // hand in ('!' = has a quest). Built by the same record() as questMark: same size, anchor, part `mark`, pivot,
  // mounts, clips (pop / idle / bob / fade), questMarkFx curves + light and materials, so questMarks.js can swap the
  // model id with no other change. `questMarkTurnIn` = legacy alias (same object).
  A.voxelModels.questMarkReady = record('questMarkReady', GLYPHS.query,
    'Quest-ready marker (QG-D1, D-058; v1.57 slim): the golden 3D "?" floating over a quest giver while the quest is ' +
    'ready to hand in; twin of questMark ("!" = has a quest): same size, anchor, pivot, clips, fx and materials.');
  A.voxelModels.questMarkTurnIn = A.voxelModels.questMarkReady;
  A.models.questMark = A.voxelModels.questMark;
  A.models.questMarkReady = A.voxelModels.questMarkReady;
  A.models.questMarkTurnIn = A.voxelModels.questMarkReady;

  A.questMarkFx = {
    note: 'View data for the quest-marker hook (content / game step, not built). One marker entity per ACTIVE step; ' +
          'step done -> clip fade, remove after fadeMs; the next step -> a new entity at its target with clip pop, then idle.',
    models: { active: 'questMark', ready: 'questMarkReady', turnIn: 'questMarkReady' },   // turnIn = legacy alias
    turnInStatus: 'ready: QG-D1 questMarkReady ("?" while a giver quest is ready to hand in; wiring QG-04)',
    floatM: 0.35,                 // built into the model (10 empty layers x 0.035 m under the glyph; anchor = base point)
    glyphH: 0.77,                 // v1.57: glyph height incl. the outline (22 x 0.035 m); centre = floatM + glyphH / 2
    bobM: 0.08,                   // idle clip amplitude
    bobPeriodMs: 2000,
    spinRevPerS: 0.5,             // idle clip: 360 deg per 2000 ms
    popMs: 300,                   // = sum(pop.durations)
    fadeMs: 250,                  // = sum(fade.durations)
    visibleRangeM: 40,            // hide (or do not spawn the view) beyond this distance from the player
    clipFor: { appear: 'pop', active: 'idle', complete: 'fade' },
    clipForEngineSpin: { appear: 'pop', active: 'bob', complete: 'fade',
                         note: 'alternative: the view drives inst.yawDeg += spinRevPerS * 360 * dt_s and plays bob' },
    // ENGINE NOTE: voxel clips have no scale key; the view sets inst.scale (ED-SCALE-1a, uniform, about the anchor)
    // from these piecewise-linear [ms, scale] curves. computeVoxelPose treats scale <= 0 as 1, so the floor is 0.05.
    popScale:  [[0, 0.05], [90, 0.75], [180, 1.18], [250, 0.96], [300, 1.0]],
    fadeScale: [[0, 1.0], [60, 1.15], [150, 0.7], [250, 0.05]],
    fadeNote: 'fade starts at rot 0. To avoid a snap from the current idle angle, add that angle to inst.yawDeg ' +
              'when switching (idle angle at clip time t = -180 + 360 * (t % 2000) / 2000), or accept the 0.25 s snap.',
    light: {                      // ENGINE NOTE: a point light at mounts.light (emissive voxels do not light the scene)
      color: 'lantern', intensity: 0.22, radius: 1.6, mount: 'light',   // v1.57: was 0.30 / 1.8 (owner: less glow)
      popFromMs: 90, fadeToZeroMs: 150,
      note: 'low gold glow on the target below (the note page / sword / stone top). Optional by day; nice at night.'
    },
    placement: {
      aboveNoteM: 1.9,            // glyph bottom over a note lying on the ground
      noteZOffsetM: 1.55,         // instance z = note z + 1.55 (+ floatM 0.35 = 1.9)
      onPropTop: 'for a standing target (sword in its heap / pedestal, waystone) the instance z = the prop top z ' +
                 '(+ 0.35 float); e.g. waystone top + 0, sword hilt top + 0',
      facing: 'any (it spins); yaw 0 = the front face looks -y'
    },
    chainExample: {
      note: 'owner example 2026-10-08 (content / writer own the real quest data): one active marker at a time',
      steps: [
        { step: 'readNote1',  target: 'note 1 ("find something to defend yourself in the wild")', zOffsetM: 1.55 },
        { step: 'takeSword',  target: 'the sword', zOffsetM: 'sword top' },
        { step: 'readNote2',  target: 'note 2 on the way up ("kill 5 boars")', zOffsetM: 1.55 },
        { step: 'kill5Boars', target: 'none (counter step; optional marker over the boar area or no marker)', zOffsetM: null },
        { step: 'waystone',   target: 'the waystone (after the 5th boar)', zOffsetM: 'stone top' }
      ]
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { questMark: A.voxelModels.questMark, questMarkReady: A.voxelModels.questMarkReady,
                       questMarkTurnIn: A.voxelModels.questMarkReady, questMarkFx: A.questMarkFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
