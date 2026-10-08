/* design/models/quest_mark.js - WoW-style quest marker (designer, v1.46, owner request 2026-10-08): a bold 3D golden
 * '!' that floats over the ACTIVE quest step's target (note, sword, waystone ...), spins slowly and bobs; it pops in
 * when a step starts and scales out when the step completes. `questMarkTurnIn` = the golden '?' (WoW "turn in"),
 * built in the same style for LATER (no step uses it yet).
 *
 * ASSET ONLY: no engine / game wiring here. Classic script (no import/export, check-deps rule 4), same loading
 * convention as design/models/chest.js:
 *   <script src="../design/models/quest_mark.js">       (browser, game/index.html, after props_m1.js)
 *   import '../../../design/models/quest_mark.js';       (Node tests: side-effect import; module.exports below)
 * Sets ASSETS.voxelModels.questMark / questMarkTurnIn (= ASSETS.models.*, no billboard) and ASSETS.questMarkFx.
 * Only ALREADY-MERGED materials (palette.materials AND detailPass.materials, the chest's brass set + iron_dark):
 * no palette.js / detail-pass.js edit. Format: design/README.md sections 7 + 20, architecture.md 15.1 (VoxelModelDef).
 * Preview: design/preview/quest-mark.html.
 *
 * Axes (15.1): x = east, y = south, z = up. The glyph stands in the x-z plane; y0 = the front face (faces -y at rot 0),
 * y4 = the back face. cellM 0.05: grid 9 x 5 x 25 = 0.45 wide x 0.25 deep, glyph 0.90 m tall.
 *   z0..z6   EMPTY: the 0.35 m float (questMarkFx.floatM). Anchor = [4.5, 2.5, 0] = the base point, so the instance z is
 *            simply the top of whatever the marker hovers over (a note lying on the ground: z = ground + 1.55 puts the
 *            glyph's bottom 1.9 m above the note, see questMarkFx.placement). Instance scale (pop / fade) shrinks the
 *            float too, so the marker grows out of / sinks into its target.
 *   z7..z24  the glyph: 16 rows of gold + a 1-voxel dark outline row below and above.
 *
 * Look (style guide: gold = loot / reward / quest language, 2 hue families = gold + iron dark):
 *   GOLD SLAB: the glyph S (7 x 16 cells, rounded bar tapering to a point, a 3-row gap, a 5 x 3 dot) is 5 voxels deep.
 *     faces y0 / y4: edge cells brass_light (bevel), interior brass_hot (warm, emissive 0.10), a CORE line brass_glint
 *       (white-gold, emissive 0.90) down the bar and across the dot: the emboss highlight by day, the glowing stroke
 *       at night. The back face carries the mirrored core (x -> 6 - x) so the mark reads the same from behind.
 *       v1.47 (owner: glow + read at 12 m night on Low 240x90): core rule = 3-wide band on strokes 5+ wide (the '!'
 *       bar head), 1-voxel line on 3-wide strokes, solid 3 x 3 dot core (0.15 x 0.15 m > one 240x90 cell at 12 m).
 *     y1 / y3: brass_light. y2: brass_dark = a dark coin-edge seam on the sides when it turns edge-on.
 *   DARK PLATE: layer y2 also carries the outline ring O (iron_dark): every cell 4-adjacent to S. From the front it is
 *     a 1-voxel dark rim round the gold, so the '!' reads against a bright sky (and its rounded corners stay round:
 *     4-adjacency leaves the diagonal corners empty). Total width with the rim = 9 voxels = 0.45 m.
 *   READABILITY (400x150, 75 deg HFOV): 3 m ~52 rows x ~37 cols; 12 m ~13 rows x ~10 cols, the gold gap between the
 *     bar and the dot = 4 voxels (0.20 m: tip, outline, empty, outline) ~3 rows at 12 m, so '!' never fuses into 'l'.
 *
 * Parts: mark  root  box [0,0,7, 9,5,25]  pivot [4.5, 2.5, 16] = the glyph centre (spin about the vertical axis).
 * Clips (lane C / content: components.voxel.anim = the clip name; questMarkFx.clipFor maps marker state -> clip):
 *   idle  loop, 2 s: spin 0.5 rev/s (rot z -180 -> +180) + bob 0.08 m (1.6 voxels, sine, period 2 s), 16 keys x 125 ms
 *         + a 0.01 ms WRAP key at +180 (validator: |rot| <= 180 and durations > 0). The engine stepper (animation.js)
 *         carries leftover time past a 0.01 ms key, so the 180 -> -180 interpolation (same pose) is never visible.
 *   bob   loop, 2 s: bob only (no spin). Use it if the view drives the spin itself: inst.yawDeg += 180 * dt_s.
 *   pop   0.3 s, non-loop, held: rises from 0.2 m low, overshoots +0.06 m, settles; whips 180 deg; ends on idle's first
 *         pose (rot +-180, z 0). Scale-in = questMarkFx.popScale on inst.scale (ENGINE NOTE: clips have no scale key).
 *   fade  0.25 s, non-loop, held: hop up 0.3 m with a 180 deg whip; scale-out = questMarkFx.fadeScale. Remove the
 *         marker entity when it ends.
 * Mounts: light (gold point light, low: questMarkFx.light; at the glyph's bottom so it warms the note below),
 *         anchor (the base point, z0), top (above the glyph, spare), center (glyph centre).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  var CELL = 0.05;
  var FLOAT = 7;               // empty voxel layers under the glyph = 0.35 m
  var SW = 7, SH = 16;         // glyph S: 7 cols x 16 rows (top-down)
  var SX = SW + 2, SY = 5, SZ = FLOAT + SH + 2;   // 9 x 5 x 25

  // every key is already merged in palette.materials + detailPass.materials (the chest set)
  var MATS = {
    d: 'iron_dark',     // outline ring / back plate (layer y2)
    D: 'brass_dark',    // the side seam (layer y2 inside the glyph)
    R: 'brass_light',   // face bevel (edge cells), the y1 / y3 slabs
    H: 'brass_hot',     // face interior (emissive 0.10)
    G: 'brass_glint'    // the core line (emissive 0.90)
  };

  // Glyphs drawn TOP-DOWN (row 0 = top), 'R' = gold. core = [row, col] cells that get brass_glint on the FRONT face
  // (the back face uses col -> 6 - col).
  var GLYPHS = {
    bang: {
      rows: [
        '.RRRRR.',   // 0  rounded top
        'RRRRRRR',   // 1
        'RRRRRRR',   // 2
        'RRRRRRR',   // 3
        '.RRRRR.',   // 4
        '.RRRRR.',   // 5
        '..RRR..',   // 6
        '..RRR..',   // 7
        '..RRR..',   // 8
        '...R...',   // 9  tip
        '.......',   // 10 (outline under the tip)
        '.......',   // 11 empty: the gap
        '.......',   // 12 (outline over the dot)
        '.RRRRR.',   // 13 dot
        '.RRRRR.',   // 14
        '.RRRRR.'    // 15
      ],
      // v1.47 core rule (both glyphs): 5+ wide strokes get a 3-wide core band, 3-wide strokes a 1-voxel line,
      // the dot a solid 3 x 3 core (DOT_CORE). Here: bar head rows 1-5 cols 2-4, neck rows 6-8 col 3.
      core: [[1, 2], [1, 3], [1, 4], [2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4],
             [5, 2], [5, 3], [5, 4], [6, 3], [7, 3], [8, 3]]
    },
    query: {
      rows: [
        '.RRRRR.',   // 0  top of the hook
        'RRRRRRR',   // 1
        'RRR.RRR',   // 2  counter (filled dark by the outline plate)
        'RR..RRR',   // 3  left end of the hook
        '....RRR',   // 4
        '...RRR.',   // 5
        '..RRR..',   // 6  stem
        '..RRR..',   // 7
        '..RRR..',   // 8
        '...R...',   // 9  tip
        '.......',   // 10
        '.......',   // 11 gap
        '.......',   // 12
        '.RRRRR.',   // 13 dot
        '.RRRRR.',   // 14
        '.RRRRR.'    // 15
      ],
      // the hook / stem are 3-wide strokes: 1-voxel core line (+ DOT_CORE, same rule as the '!')
      core: [[2, 1], [1, 2], [1, 3], [1, 4], [2, 5], [3, 5], [4, 5], [5, 4], [6, 3], [7, 3], [8, 3]]
    }
  };
  // the dot's solid 3 x 3 core (rows 13-15, cols 2-4 = 0.15 x 0.15 m): larger than one Low-preset (240x90) cell at
  // 12 m (~0.077 m wide x ~0.115 m tall), so at least one cell always lands on brass_glint = the mark reads at night.
  var DOT_CORE = [[13, 2], [13, 3], [13, 4], [14, 2], [14, 3], [14, 4], [15, 2], [15, 3], [15, 4]];
  GLYPHS.bang.core = GLYPHS.bang.core.concat(DOT_CORE);
  GLYPHS.query.core = GLYPHS.query.core.concat(DOT_CORE);

  function build(G) {
    function inS(c, r) { return c >= 0 && c < SW && r >= 0 && r < SH && G.rows[r].charAt(c) === 'R'; }
    function edge(c, r) { return !inS(c - 1, r) || !inS(c + 1, r) || !inS(c, r - 1) || !inS(c, r + 1); }
    function inO(c, r) { return !inS(c, r) && (inS(c - 1, r) || inS(c + 1, r) || inS(c, r - 1) || inS(c, r + 1)); }
    var coreF = {}, coreB = {}, i;
    for (i = 0; i < G.core.length; i++) {
      coreF[G.core[i][0] + ',' + G.core[i][1]] = 1;
      coreB[G.core[i][0] + ',' + (SW - 1 - G.core[i][1])] = 1;
    }
    var layers = [], z, y, x;
    for (z = 0; z < SZ; z++) {
      var L = [];
      for (y = 0; y < SY; y++) {
        var row = '';
        for (x = 0; x < SX; x++) {
          var c = x - 1, r = FLOAT + SH - z, ch = '.';
          if (z >= FLOAT && inS(c, r)) {
            if (y === 0 || y === SY - 1) {
              var core = y === 0 ? coreF : coreB;
              ch = core[r + ',' + c] ? 'G' : edge(c, r) ? 'R' : 'H';
            } else if (y === 2) ch = 'D';
            else ch = 'R';
          } else if (z >= FLOAT && y === 2 && inO(c, r)) ch = 'd';
          row += ch;
        }
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }

  // ---- clips (voxel units; 1 voxel = 0.05 m) -------------------------------------------------------------------
  var BOB_V = 1.6;                 // 0.08 m
  var N = 16, KEY_MS = 125;        // 16 keys x 125 ms = 2000 ms
  function r3(v) { return Math.round(v * 1000) / 1000; }
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
      { mark: { rot: [0, 0, 0],   pos: [0, 0, -4] } },     // 0.2 m low (and scale ~0: invisible)
      { mark: { rot: [0, 0, 100], pos: [0, 0, 1.2] } },    // overshoot up, whipping round
      { mark: { rot: [0, 0, 160], pos: [0, 0, -0.3] } },   // settle
      { mark: { rot: [0, 0, 180], pos: [0, 0, 0] } }       // = idle key 0 (rot -180 == +180, z 0): seamless hand-over
    ] },
    fade: { durations: [60, 90, 70, 30], loop: false, frames: [
      { mark: { rot: [0, 0, 0],   pos: [0, 0, 0] } },
      { mark: { rot: [0, 0, 45],  pos: [0, 0, 1.6] } },    // a little hop (+ scale 1.15: the "ding")
      { mark: { rot: [0, 0, 135], pos: [0, 0, 4] } },      // whips away upward while shrinking
      { mark: { rot: [0, 0, 180], pos: [0, 0, 6] } }       // held (scale 0.05) until the entity is removed
    ] }
  };

  function record(key, G, desc) {
    var cz = FLOAT + (SH + 2) / 2;   // 16
    var voxel = {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [SX / 2, SY / 2, 0],             // the base point: instance z = top of the thing it floats over
      meshOnly: true,                          // mesh path only (ME-19a), like the chest
      mats: MATS,
      layers: build(G),
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
               glyphH: +((SH + 2) * CELL).toFixed(3), floatM: +(FLOAT * CELL).toFixed(3) },
      readability: { note: 'see design/preview/quest-mark.html captions: rows x cols at 3 m and 12 m, 240x90 / 400x150, day / night' }
    };
  }

  A.voxelModels.questMark = record('questMark', GLYPHS.bang,
    'Quest marker (owner 2026-10-08): a bold golden 3D "!" floating 0.35 m over the active quest step\'s target, ' +
    '0.45 x 0.25 x 0.90 m, dark iron rim plate, glowing white-gold core line. Spins 0.5 rev/s and bobs 0.08 m.');
  A.voxelModels.questMarkTurnIn = record('questMarkTurnIn', GLYPHS.query,
    'LATER (not used by any step yet): the golden 3D "?" turn-in marker, same style, size and clips as questMark.');
  A.models.questMark = A.voxelModels.questMark;
  A.models.questMarkTurnIn = A.voxelModels.questMarkTurnIn;

  A.questMarkFx = {
    note: 'View data for the quest-marker hook (content / game step, not built). One marker entity per ACTIVE step; ' +
          'step done -> clip fade, remove after fadeMs; the next step -> a new entity at its target with clip pop, then idle.',
    models: { active: 'questMark', turnIn: 'questMarkTurnIn' },
    turnInStatus: 'later',
    floatM: 0.35,                 // built into the model (7 empty layers under the glyph; anchor = base point)
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
      color: 'lantern', intensity: 0.30, radius: 1.8, mount: 'light',
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
    module.exports = { questMark: A.voxelModels.questMark, questMarkTurnIn: A.voxelModels.questMarkTurnIn,
                       questMarkFx: A.questMarkFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
