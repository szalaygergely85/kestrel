/*
 * Kestrel - VOXEL PROPS (D-019, row 25g/25h): the lever and the brass lamp as real 3D voxel models.
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + 15.3 item 4 (voxel.mounts) + 15.3 item 6 (content
 * contract). Preview: design/preview/voxel-props.html (engine oracle: packVoxelModel + computeVoxelPose + marchVoxelRay).
 *
 * Target feel: Blood (1997) voxel items - chunky, solid, fixed in the world, one light direction, a bright top/rim over a
 * dark body, a dark contour (ART-OWN-001 findings 2-4). Flames / glows / sparks stay billboards (separate props).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.lever    { name, desc, voxel: VoxelModelDef, placement, readability }
 *   ASSETS.voxelModels.lantern  (the brass lamp ON its wall bracket; one model, the lamp is its own root part)
 *   ASSETS.voxelMaterials       the 5 new prop materials: v1 records (palette.materials format) + v2 records
 *                               (detail-pass.js materials format) + remap + the proposed edges.modelRim value.
 *   ASSETS.voxelModels.attach() puts `.voxel` onto ASSETS.models.lever / ASSETS.models.lantern (15.3 item 1 spawn
 *                               rule: `model.voxel` present -> components.voxel). It only does so when every material
 *                               key is ALREADY in palette.materials AND detailPass.materials (else a missing v2 record
 *                               would turn the GPU path off, 15.3 item 6). Called once at load; no-op otherwise.
 *
 * MERGE STEP STILL OPEN (not done in this pass, file scope): append ASSETS.voxelMaterials.v1 to palette.js `materials`
 * (after `canvas`, so no existing material id moves) and .v2 to detail-pass.js `materials` + .remap to `remap`, and set
 * detail-pass.js `edges.modelRim = 0.55`. Until then the models validate against these keys (the preview does) and the
 * `fallback` map gives existing keys for a castModels run.
 *
 * AXES (15.1): x = east (x0 = west), y = SOUTH with y0 = the model's FRONT row (faces north at yaw 0), z = up (z0 = bottom).
 * Yaw = level `facing` (compass, clockwise, free degrees; wall props use multiples of 90).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};

  function rep(s, n) { var o = ''; while (n-- > 0) o += s; return o; }

  // ===================================================================================================================
  // 1. MATERIALS (proposed; merge into palette.js + detail-pass.js, see header)
  //    Value contrast vs the tower stone (ART-OWN-001 finding 2): stoneMid #8a7f6e (luma ~128), stoneLight #b8ab94 (~172).
  //    brass_light brassLight ~210 and brass_hot brassHot ~239 sit ABOVE stoneLight; brass_dark brassDark ~96 and
  //    iron_dark ironDark ~55 sit BELOW stoneMid; the handle iron_light ironLight ~159 is 1.66x the dark plate.
  // ===================================================================================================================
  var V1 = {
    brass_light: {
      desc: 'VOXEL PROPS. Bright brass rim / top edges (lever plate frame, lamp base + hood rims). Catches the light first.',
      base: 'brassLight', albedo: 0.95, ramp: 'brass', spec: 0.60,
      bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [40, 40], key: {
        a: { shade: 1.00 }, h: { shade: 1.14, tint: 'brassHot', amount: 0.50 }, d: { shade: 0.90 }
      }, rows: ['haah', 'aada', 'ahaa', 'daah'] }
    },
    brass_hot: {
      desc: 'VOXEL PROPS. Rivets, the lever knob and gear teeth, the lamp finial: white-hot brass with a faint self-glow ' +
            '(emissive 0.10) so the lever / lamp stay findable in shade (finding 3). Not a light source.',
      base: 'brassHot', albedo: 1.00, ramp: 'brass', spec: 0.70, emissive: 0.10,
      bg: { mode: 'darken', k: 0.20 }, textureFade: [4, 12]
    },
    brass_dark: {
      desc: 'VOXEL PROPS. Dark brass body (lever plate, lamp base / rails / hood, bracket plate). Quiet, low value, so the ' +
            'rim and the handle read against it and it never matches the stone.',
      base: 'brassDark', albedo: 0.62, ramp: 'brass', spec: 0.30,
      bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [40, 40], key: {
        a: { shade: 1.00 }, s: { shade: 0.72, tint: 'brassShadow', amount: 0.60 }
      }, rows: ['aaaa', 'asaa', 'aaaa', 'aaas'] }
    },
    iron_light: {
      desc: 'VOXEL PROPS. Light iron: the lever handle rod, the lamp bail, top edge of the bracket arm. Cool grey on dark brass.',
      base: 'ironLight', albedo: 0.85, ramp: 'iron', spec: 0.50,
      bg: { mode: 'darken', k: 0.15 }, textureFade: [4, 12]
    },
    iron_dark: {
      desc: 'VOXEL PROPS. Dark iron: lever foot + post + the back plate that frames the rim (the dark contour), the lamp ' +
            'burner, the bracket arm / hook. Darkest value of the set.',
      base: 'ironDark', albedo: 0.60, ramp: 'iron', spec: 0.25,
      bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12]
    }
  };
  // v2: grid 2.5 cm = half a lever voxel (tones + glyph alternates change inside a voxel face, so a near voxel that covers
  // 2 x 2 cells is not one repeated glyph; finding 1). lines: false (the edge pass draws the voxel steps, 15.2 item 5).
  function v2(v1, seed, albedo, tones, set, extra) {
    var o = { v1: v1, seed: seed, desc: V1[v1].desc, albedo: albedo, bgK: V1[v1].bg.k, detail: 40, jitter: 0.05,
              tones: tones, grid: { u: 0.025, v: 0.025, stagger: 0, lines: false },
              face: { set: set, mid: set, far: set }, lod: { mid: 12, far: 25, dither: 3 } }, k;
    for (k in extra || {}) o[k] = extra[k];
    return o;
  }
  var V2 = {
    brass_light: v2('brass_light', 201, 0.95, [['brassLight', 4], ['brassHot', 1]], 'brassFace'),
    brass_hot:   v2('brass_hot',   202, 1.00, [['brassHot', 3], ['brassLight', 1]], 'brassFace', { emissive: 0.10 }),
    brass_dark:  v2('brass_dark',  203, 0.62, [['brassDark', 3], ['brassShadow', 1]], 'brassFace'),
    iron_light:  v2('iron_light',  204, 0.85, [['ironLight', 3], ['iron', 1]], 'ironFace'),
    iron_dark:   v2('iron_dark',   205, 0.60, [['ironDark', 3], ['iron', 1]], 'ironFace')
  };
  A.voxelMaterials = {
    status: 'PROPOSED - merge v1 into palette.materials, v2 into detailPass.materials (+ remap), edges.modelRim into detailPass.edges',
    v1: V1, v2: V2,
    remap: { brass_light: 'brass_light', brass_hot: 'brass_hot', brass_dark: 'brass_dark', iron_light: 'iron_light', iron_dark: 'iron_dark' },
    edges: { modelRim: 0.55 },   // 15.2 item 5: kind-8 rule cells fg AND bg x 0.55 = the dark contour (finding 2)
    // castModels / preview only, before the merge: nearest existing material per key (NOT the intended look)
    fallback: { brass_light: 'brass', brass_hot: 'brass', brass_dark: 'brass', iron_light: 'iron', iron_dark: 'iron' }
  };

  var MATS = { R: 'brass_light', H: 'brass_hot', b: 'brass_dark', i: 'iron_light', d: 'iron_dark' };

  // ===================================================================================================================
  // 2. LEVER  15 x 8 x 22 voxels at 0.05 m = 0.75 m wide x 0.40 m deep x 1.10 m tall. Parts (15.3 item 3): plate (root,
  //    static: foot + post + collar + plate) and handle (child, pivot at the hub: gear + rod + knob).
  //    Front view (from the player, who stands in FRONT = north at yaw 0; the level yaw 90 turns the front east):
  //      dark iron back plate framing everything (the contour), bright brass rim frame with 4 brass_hot rivets, recessed
  //      dark brass plate, a brass_hot / brass_light 8-tooth hub gear, a light-iron rod and a big brass_hot knob that
  //      sticks 0.2 m out ABOVE the plate (finding 3). Plate on a dark iron post + collar + foot (lit front lip).
  //    Pull = the handle swings IN THE PLATE PLANE about local y (rot y +135 = knob to local +x = the player's LEFT =
  //    south at yaw 90 = toward the grate, which is ~30 deg left of view centre: the swing leads the eye to it).
  // ===================================================================================================================
  var E = rep('.', 15);
  var F0 = '...' + rep('d', 9) + '...';            // foot z0, x3..11
  var F1f = '....' + rep('i', 7) + '....';         // foot z1 front lip (lit), x4..10
  var F1 = '....' + rep('d', 7) + '....';
  var PO = '......ddd......';                      // post x6..8
  var CR = '.....RRRRR.....';                      // collar front (lit)
  var CB = '.....bbbbb.....';
  var PB = '.' + rep('d', 13) + '.';               // plate bottom edge x1..13
  var BK = rep('d', 15);                           // back plate x0..14 (1 voxel wider all round = the dark contour)
  var RT = '.H' + rep('R', 11) + 'H.';             // rim top / bottom row, rivets at the corners
  var RS = '.R' + rep('.', 11) + 'R.';             // rim sides (inside = recess, the dark body shows 1 voxel deeper)
  var RH = '.R....ddd....R.';                      // rim sides + dark hub boss x6..8
  var BD = '.' + rep('b', 13) + '.';               // dark brass body
  var TC = '.' + rep('R', 13) + '.';               // lit top cap
  var G0 = '......H.H......';                      // gear teeth rows (x6, x8)
  var G1 = '.....HRRRH.....';                      // gear x5..9, teeth at the ends
  var G2 = '......RdR......';                      // gear centre row, dark axle
  var IR = '.......i.......';                      // handle rod x7
  var K1 = '.......R.......', K2 = '......RRR......', K3 = '......HHH......', K4 = '.......H.......'; // knob x6..8
  // rows per layer: y0 (front) .. y7 (back)
  var LEVER_LAYERS = [
    /* z0  */ [E, E, E, F0, F0, F0, F0, F0],
    /* z1  */ [E, E, E, F1f, F1, F1, F1, F1],
    /* z2  */ [E, E, E, E, PO, PO, PO, E],
    /* z3  */ [E, E, E, E, PO, PO, PO, E],
    /* z4  */ [E, E, E, E, PO, PO, PO, E],
    /* z5  */ [E, E, E, E, PO, PO, PO, E],
    /* z6  */ [E, E, E, CR, CB, CB, CB, E],
    /* z7  */ [E, E, E, PB, PB, PB, BK, E],
    /* z8  */ [E, E, E, RT, BD, BD, BK, E],
    /* z9  */ [E, E, E, RS, BD, BD, BK, E],
    /* z10 */ [E, E, G0, RS, BD, BD, BK, E],
    /* z11 */ [E, E, G1, RH, BD, BD, BK, E],
    /* z12 */ [IR, IR, G2, RH, BD, BD, BK, E],
    /* z13 */ [IR, IR, G1, RH, BD, BD, BK, E],
    /* z14 */ [IR, IR, G0, RS, BD, BD, BK, E],
    /* z15 */ [IR, IR, E, RS, BD, BD, BK, E],
    /* z16 */ [IR, IR, E, RT, BD, BD, BK, E],
    /* z17 */ [IR, IR, E, TC, TC, TC, BK, E],
    /* z18 */ [IR, IR, E, E, E, E, BK, E],
    /* z19 */ [K1, K2, K1, E, E, E, E, E],
    /* z20 */ [K3, K3, K3, E, E, E, E, E],
    /* z21 */ [K4, K3, K4, E, E, E, E, E]
  ];

  A.voxelModels.lever = {
    name: 'lever',
    desc: 'Voxel lever (D-019): brass plate housing framed by a dark iron back plate, bright rim + rivets, 8-tooth hub gear, ' +
          'light-iron handle with a big brass knob above the plate, on an iron post and foot. Pull (0.4 s) swings the handle ' +
          '135 deg in the plate plane toward the grate side, with anticipation and a small overshoot; then it holds.',
    voxel: {
      version: 1,
      cellM: 0.05,
      size: [15, 8, 22],
      anchor: [7.5, 5.5, 0],                 // foot centre (x3..11, y3..7), bottom
      mats: MATS,
      layers: LEVER_LAYERS,
      parts: {
        plate:  { box: [0, 3, 0, 15, 8, 19], pivot: [7.5, 5.5, 0] },                     // extent 15+5+19 = 39
        handle: { box: [5, 0, 10, 10, 3, 22], pivot: [7.5, 1.5, 12.5], parent: 'plate' } // extent 5+3+12 = 20
      },
      animations: {
        idle: { durations: [1000], loop: true, frames: [{}] },
        // 0 rest, 1 anticipation (a nudge the other way), 2-3 the swing, 4 overshoot + clunk, 5 settle (held: 15.3 item 3)
        pull: { durations: [50, 70, 80, 80, 70, 50], loop: false, events: { clunk: 4 }, frames: [
          { handle: { rot: [0, 0, 0] } },
          { handle: { rot: [0, -12, 0] } },
          { handle: { rot: [0, 50, 0] } },
          { handle: { rot: [0, 115, 0] } },
          { handle: { rot: [0, 148, 0] } },
          { handle: { rot: [0, 135, 0] } }
        ] },
        down: { durations: [1000], loop: true, frames: [{ handle: { rot: [0, 135, 0] } }] }
      },
      mounts: {
        glint:  { at: [7.5, 1.5, 22], part: 'handle' },   // knob top: sparkle billboard every ~1.8 s (billboard scope)
        prompt: { at: [7.5, 0, 14], part: 'plate' }        // 0.70 m above the foot = the interactable aim z 3.7 on the ledge
      }
    },
    // Level data stays as is (tower.js props.lever): x 19.25, y 9.3, z 3.0, facing 90. World footprint at yaw 90: foot
    // x 19.125..19.375 / y 9.075..9.525 (on the ledge cell 19,9); the plate spans y 8.925..9.675 (overhangs the north
    // edge by 7.5 cm, above the drop - fine); handle front at x 19.525. Pulled, the knob ends at about y 9.59, z 3.34.
    placement: { level: 'tower', prop: 'lever', x: 19.25, y: 9.3, z: 3.0, facing: 90, levelEdit: false },
    readability: { note: 'At 2.5 m: 160x60 ~31 rows tall (1.4 rows / voxel), 240x90 ~46 rows (2.1 rows / voxel). cellM 0.05 ' +
                   'is the finest the 15.3 contract allows at 1.1 m; v2 grid 2.5 cm keeps near voxel faces from being one glyph.' }
  };

  // ===================================================================================================================
  // 3. LANTERN (the brass lamp) ON ITS WALL BRACKET  8 x 13 x 19 voxels at 1/32 m (0.25 x 0.41 x 0.59 m).
  //    Parts: mount (root: the wall plate), arm (child of mount: arm + brace + hook + finial), lamp (ROOT of its own:
  //    base, cage, hood, cap, bail) - so the lamp can leave while the bracket stays.
  //    Lamp: dark brass base with a bright rim and 2 front rivets, an OPEN cage (4 bright brass corner posts between dark
  //    rails) around a dark burner, bright hood rim, bright cap, brass_hot finial, light-iron bail hanging on the dark
  //    hook (the hook fills the gap in the bail bar). No glass voxels: the flame billboard (separate prop) shows through
  //    the cage and is cut by the near posts (15.2 item 5, the Build look).
  //    Anchor = the level point (19.9, 6.5, 1.3) as it is today: x = lamp centre, z = lamp bottom, y chosen so the back
  //    of the wall plate touches the wall face (x 20.0 at yaw 270). So NO level edit: lamp centre ends at x 19.72.
  //    empty / hookEmpty (after pickup, US-012 sets the variant) = the lamp part moved 2.0 m down, under the floor
  //    (hidden by the floor from every view; engine request, optional: a per-keyframe part `hide`).
  // ===================================================================================================================
  var e = '........';
  var O6 = [e, '..bbbb..', '.bbbbbb.', '.bbbbbb.', '.bbbbbb.', '.bbbbbb.', '..bbbb..', e];
  var O8 = ['.bbbbbb.', 'bbbbbbbb', 'bbbbbbbb', 'bbbbbbbb', 'bbbbbbbb', 'bbbbbbbb', 'bbbbbbbb', '.bbbbbb.'];
  var Z2 = ['.RHRRHR.', 'RRbbbbRR', 'RbbbbbbR', 'RbbddbbR', 'RbbddbbR', 'RbbbbbbR', 'RRbbbbRR', '.RRRRRR.'];
  var Z3 = ['.bbbbbb.', 'bb....bb', 'b......b', 'b..dd..b', 'b..dd..b', 'b......b', 'bb....bb', '.bbbbbb.'];
  var Z4 = ['.R....R.', 'RR....RR', e, '...dd...', '...dd...', e, 'RR....RR', '.R....R.'];
  var ZP = ['.R....R.', 'RR....RR', e, e, e, e, 'RR....RR', '.R....R.'];
  var Z10 = ['.bbbbbb.', 'bb....bb', 'b......b', 'b......b', 'b......b', 'b......b', 'bb....bb', '.bbbbbb.'];
  var Z11 = ['.RRRRRR.', 'RRbbbbRR', 'RbbbbbbR', 'RbbbbbbR', 'RbbbbbbR', 'RbbbbbbR', 'RRbbbbRR', '.RRRRRR.'];
  var Z12 = [e, e, '...RR...', '.iRRRRi.', '.iRRRRi.', '...RR...', e, e];
  var Z13 = [e, e, e, '.i.HH.i.', '.i.HH.i.', e, e, e];
  var Z14 = [e, e, e, '.i....i.', '.i....i.', e, e, e];
  var Z15 = [e, e, e, '.iiddii.', '.iiddii.', e, e, e];        // bail bar + the hook through it (hook = arm part)
  var Z16 = [e, e, e, '...dd...', '...dd...', e, e, e];        // hook stroke
  var BR = '...dd...', PL0 = '.dddddd.', PLH = '.HbbbbH.', PLB = '.bbbbbb.', PLT = '.RRRRRR.';
  var AD = '...dd...', AI = '...ii...', FH = '...HH...';
  function cat(a, b) { return a.concat(b); }
  var NONE5 = [e, e, e, e, e];
  // rows per layer: y0 (front, west at yaw 270) .. y12 (the wall plate)
  var LANTERN_LAYERS = [
    /* z0  */ cat(O6, NONE5),
    /* z1  */ cat(O8, NONE5),
    /* z2  */ cat(Z2, NONE5),
    /* z3  */ cat(Z3, NONE5),
    /* z4  */ cat(Z4, NONE5),
    /* z5  */ cat(ZP, NONE5),
    /* z6  */ cat(ZP, NONE5),
    /* z7  */ cat(ZP, NONE5),
    /* z8  */ cat(ZP, NONE5),
    /* z9  */ cat(ZP, NONE5),
    /* z10 */ cat(Z10, [e, e, e, e, PL0]),
    /* z11 */ cat(Z11, [e, e, e, e, PLH]),
    /* z12 */ cat(Z12, [e, e, e, e, PLB]),
    /* z13 */ cat(Z13, [e, e, e, e, PLB]),
    /* z14 */ cat(Z14, [e, e, e, BR, PLB]),
    /* z15 */ cat(Z15, [e, e, BR, e, PLB]),
    /* z16 */ cat(Z16, [e, BR, e, e, PLB]),
    /* z17 */ [e, e, FH, AD, AD, AD, AD, AD, AD, AD, AD, AD, PLH],
    /* z18 */ [e, e, FH, AI, AI, AI, AI, AI, AI, AI, AI, AI, PLT]
  ];
  var HIDE = { lamp: { pos: [0, 0, -64] } };

  A.voxelModels.lantern = {
    name: 'lantern',
    desc: 'Voxel brass lamp on its wall bracket (D-019): open brass cage (bright posts, dark rails), dark burner, bright ' +
          'rims, brass_hot finial and rivets, light-iron bail on a dark iron hook; bracket = dark brass wall plate with a ' +
          'lit top, dark arm with a light top edge, brace, brass_hot tip. The flame is a separate billboard prop.',
    voxel: {
      version: 1,
      cellM: 0.03125,
      size: [8, 13, 19],
      anchor: [4, 9.8, 0],                   // see the section comment: (19.9, 6.5, 1.3) facing 270 unchanged
      mats: MATS,
      layers: LANTERN_LAYERS,
      parts: {
        mount: { box: [1, 12, 10, 7, 13, 19], pivot: [4, 13, 14] },                    // wall plate (extent 16)
        arm:   { box: [3, 2, 14, 5, 12, 19], pivot: [4, 12, 17], parent: 'mount' },    // arm, brace, hook (extent 17)
        lamp:  { box: [0, 0, 0, 8, 8, 16], pivot: [4, 4, 15.5] }                       // root; pivot = hang point (extent 32)
      },
      animations: {
        unlit:     { durations: [1000], loop: true, frames: [{}] },
        lit:       { durations: [1000], loop: true, frames: [{}] },   // same body; the flame billboard + light are level data
        empty:     { durations: [1000], loop: true, frames: [HIDE] },
        hookEmpty: { durations: [1000], loop: true, frames: [HIDE] }  // alias kept (billboard clip names)
      },
      mounts: {
        flame:  { at: [4, 4, 5], part: 'lamp' },      // flame billboard base = burner top (z 1.456)
        light:  { at: [4, 4, 7], part: 'lamp' },      // lights.lantern origin when lit
        prompt: { at: [4, 0, 8], part: 'lamp' },
        hook:   { at: [4, 4, 15.5], part: 'arm' }     // where the bail hangs (= lamp pivot; hook voxels x3..4, y3..4)
      }
    },
    // tower.js props.lantern stays: x 19.9, y 6.5, z 1.3, facing 270. World: wall plate back at x 20.0 (step 8 west face),
    // lamp centre x 19.72 (1.22 m from the burner centre 18.5), lamp bottom z 1.30, top of bail 1.80, bracket top 1.89.
    placement: { level: 'tower', prop: 'lantern', x: 19.9, y: 6.5, z: 1.3, facing: 270, wallX: 20.0, levelEdit: false },
    readability: { note: 'At 2.5 m: 160x60 ~16 rows tall incl. bracket (0.87 rows / voxel), 240x90 ~25 rows (1.3 rows / voxel).' }
  };

  // ===================================================================================================================
  // 4. ATTACH (15.3 item 1): only once the materials are merged, so a missing v2 record can never switch the GPU off.
  // ===================================================================================================================
  A.voxelModels.attach = function attach() {
    var P = A.palette, DP = A.detailPass, M = A.models, k, key, done = [];
    if (!P || !DP || !M) return done;
    for (k in MATS) if (!P.materials[MATS[k]] || !DP.materials[MATS[k]]) return done;
    for (key in { lever: 1, lantern: 1 }) {
      if (M[key] && !M[key].voxel) { M[key].voxel = A.voxelModels[key].voxel; done.push(key); }
    }
    return done;
  };
  A.voxelModels.attach();

  if (typeof module === 'object' && module && module.exports) module.exports = A.voxelModels;
})(typeof window !== 'undefined' ? window : globalThis);
