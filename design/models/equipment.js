/*
 * Kestrel - EQUIPMENT VOXEL MODELS (EQ-D1; epic docs/equipment-epic-2026-10-10.md section 3, architecture.md 38.41).
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + README 7.4 (view models) + README 22 (variants:
 * key field `v` names the variant shown from that key on, as viewModels.hand). Preview: design/preview/equipment.html.
 *
 * Style (style-guide 0): realistic objects from voxels, no cartoon. Old-world colour language: wood, dark iron rim,
 * pale steel, leather, linen / gut string, goose fletching (one red cock feather). No brass / copper / aether.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.shieldHeld    round plank shield, iron rim + boss, back battens + leather arm strap and grip
 *   ASSETS.voxelModels.shieldBack    same voxels, anchor = back centre, `worn` = slung on the back (front out)
 *   ASSETS.voxelModels.bowRest       wooden longbow, braced, no arrow (= bowHeld)
 *   ASSETS.voxelModels.bowDraw1..3   string pulled 1/3, 2/3, full with a nocked arrow (variants of viewModels.bow)
 *   ASSETS.voxelModels.bowBack       bowRest voxels, `worn` = across the back
 *   ASSETS.voxelModels.arrow         flight model (tip = y0 = forward), anchor at the balance point
 *   ASSETS.voxelModels.arrowStuck    head buried, anchor 0.05 m behind the surface (sim stuckBack), clip `twang`
 *   ASSETS.voxelModels.quiverFull / quiverHalf / quiverEmpty   leather quiver, `worn` = back right shoulder or right hip
 *   ASSETS.viewModels.shield         first-person (left forearm): rest, raised, clips idle / raise / lower / block, spark
 *   ASSETS.viewModels.bow            first-person: variants, clips idle / raise / lower / draw / hold / release / dry
 *   ASSETS.equipment.attach()        registers the models in ASSETS.models only when every material exists in BOTH
 *                                    palette.materials and detailPass.materials (all are existing materials today)
 *
 * AXES (15.1): x = east, y = SOUTH with y0 = the FRONT row (faces north / forward at yaw 0), z = up.
 * Materials: only existing ones (palette.js + detail-pass.js). No palette additions were needed.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};

  var MATS = {
    w: 'wood', W: 'wood_cut', t: 'timber_old', i: 'iron', I: 'iron_light', d: 'iron_dark', S: 'steel_edge',
    s: 'steel_old', l: 'leather', r: 'rope', N: 'linen_light', k: 'linen_dark', R: 'gore_red', z: 'bronze'
  };

  // ---- tiny grid builder (layers[z][y] = string over x, '.' = empty) ----
  function Grid(sx, sy, sz) {
    var g = [], z, y;
    for (z = 0; z < sz; z++) { g.push([]); for (y = 0; y < sy; y++) g[z].push(new Array(sx + 1).join('.').split('')); }
    return {
      sx: sx, sy: sy, sz: sz,
      put: function (x, y, z, ch) { if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) g[z][y][x] = ch; },
      get: function (x, y, z) { return g[z][y][x]; },
      layers: function () { return g.map(function (L) { return L.map(function (r) { return r.join(''); }); }); },
      count: function () { var n = 0; g.forEach(function (L) { L.forEach(function (r) { r.forEach(function (c) { if (c !== '.') n++; }); }); }); return n; }
    };
  }
  function hash(x, y, z) { var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) % 100; }
  function def(name, desc, cell, G, anchor, extra) {
    var o = { name: name, desc: desc, voxel: { version: 1, cellM: cell, size: [G.sx, G.sy, G.sz], anchor: anchor, mats: MATS,
      layers: G.layers(), parts: { body: { box: [0, 0, 0, G.sx, G.sy, G.sz], pivot: anchor } },
      animations: { held: { durations: [1000], loop: true, frames: [{}] } }, mounts: {} }, stats: { voxels: G.count() } }, k;
    for (k in extra || {}) o.voxel[k] = extra[k];
    return o;
  }

  // =================================================================================================================
  // 1. SHIELD: round plank shield, 17 x 4 x 17 at 3.5 cm = 0.60 m across, 0.14 m deep (boss included).
  //    y0 boss dome (3x3, steel-bright crown), y1 boss flange (r 2.6) + front rim lip + 8 rim nails,
  //    y2 six vertical planks (wood / timber_old / wood_cut, weathered grey spots, dark seams, a healed sword gash
  //    upper-left), iron rim channel with rust-worn patches and a battle notch upper-right,
  //    y3 back: rim lip, two horizontal battens, leather arm strap (bronze buckle) at x4 and rope-bound hand grip at x11.
  //    In first person the player sees the BACK (battens, straps, rim edge), as with a real shield on the forearm.
  // =================================================================================================================
  function buildShield() {
    var G = new Grid(17, 4, 17), x, z, dx, dz, r, p, h, a;
    var PLANK = ['w', 't', 'W', 'w', 't', 'W'];
    for (z = 0; z < 17; z++) for (x = 0; x < 17; x++) {
      dx = x - 8; dz = z - 8; r = Math.sqrt(dx * dx + dz * dz);
      if (r > 8.45) continue;
      h = hash(x, 2, z);
      var notch = (x === 13 && z === 14) || (x === 14 && z === 13);   // battle notch in the rim
      if (r > 7.45) {
        if (notch) continue;
        G.put(x, 2, z, h < 22 ? 's' : 'd');
        G.put(x, 1, z, 'd'); G.put(x, 3, z, 'd');
      } else {
        p = Math.min(5, Math.floor(x / 3));
        var m = PLANK[p];
        if (x % 3 === 0 && x > 0 && h < 40) m = 'l';            // plank seam
        else if (h < 7) m = 'k';                                // sun-greyed, weathered spot
        if (x + z === 16 && x >= 3 && x <= 6) m = 'l';          // old sword gash, upper-left
        G.put(x, 2, z, m);
        if (r <= 2.6) G.put(x, 1, z, 'i');                      // boss flange
        if (r <= 1.5) G.put(x, 0, z, (x === 8 && z === 8) ? 'S' : 'I');   // boss dome + bright crown
        if ((z === 4 || z === 12) && r <= 7.45) G.put(x, 3, z, 't');      // back battens
      }
    }
    // rim nails on the front lip (8, every 45 deg, offset 22.5)
    for (a = 0; a < 8; a++) {
      var ang = (a * 45 + 22.5) * Math.PI / 180;
      G.put(Math.round(8 + 7.9 * Math.cos(ang)), 1, Math.round(8 + 7.9 * Math.sin(ang)), 'I');
    }
    // boss rivets
    G.put(6, 1, 8, 'I'); G.put(10, 1, 8, 'I'); G.put(8, 1, 6, 'I'); G.put(8, 1, 10, 'I');
    // arm strap (enarmes) + buckle, hand grip with rope bindings
    for (z = 6; z <= 10; z++) { G.put(4, 3, z, z === 8 ? 'z' : 'l'); G.put(11, 3, z, (z === 6 || z === 10) ? 'r' : 'l'); }
    return G;
  }
  var SHIELD = buildShield();
  A.voxelModels.shieldHeld = def('shieldHeld',
    'EQ-D1: round wooden plank shield (0.60 m) with a dark iron rim (rust-worn patches, a battle notch upper-right, 8 rim ' +
    'nails), an iron boss with a bright crown, a healed sword gash, sun-greyed planks; back: two battens, leather arm ' +
    'strap with a bronze buckle, rope-bound grip. Pivot = forearm point behind the boss.',
    0.035, SHIELD, [8.5, 4.5, 8.5]);
  A.voxelModels.shieldHeld.voxel.mounts = {
    boss: { at: [8.5, 0, 8.5], part: 'body' },          // world block spark (third person / mirrors)
    rimTop: { at: [8.5, 1.5, 16.5], part: 'body' },     // first-person block spark: the top rim is what the eye sees
    arm: { at: [4.5, 4, 8.5], part: 'body' }, grip: { at: [11.5, 4, 8.5], part: 'body' }
  };
  A.voxelModels.shieldBack = def('shieldBack', 'EQ-D1: the shield slung on the back, front (boss) facing out.',
    0.035, SHIELD, [8.5, 4, 8.5]);
  A.voxelModels.shieldBack.worn = { mount: 'back', pos: [0, 0.03, 0.04], rot: [0, 8, 180],
    note: 'mount name proposed (EQ-04b decides): back centre between the shoulder blades, the back layer (straps) on the ' +
          'body, boss out, tilted 8 deg; shown when `off` holds the shield but the bow set is out (Q swap)' };

  // =================================================================================================================
  // 2. BOW: wooden longbow 1.68 m, 4 x 41 x 56 at 3 cm. Local ly (depth, + = toward the archer) = y index - 16.
  //    Limbs: D-section, 2 deep near the grip (pale sapwood back W + heartwood belly w), 1 deep (w) beyond, bend
  //    ly = round(B * u^2) (u = 0 at grip, 1 at the tip); horn nocks (k) at both tips; leather grip x1..3 z25..30 with
  //    rope bindings at z25 / z30. String (linen_light, gut) from tip to tip, through the nock point at z31.
  //    Variants: rest B 4 (brace 15 cm), draw1/2/3 B 6/8/10, tips 1/2/3 cells shorter, nock pulled to ly 11 / 17 / 23
  //    (full draw 0.70 m), the arrow on the LEFT side of the stave (x1), resting on the bow hand above the grip.
  // =================================================================================================================
  var BOW_OY = 16, BOW_GRIP_Z = 28, BOW_NOCK_Z = 31;
  var BOW_V = { rest: { B: 4, inset: 0, nock: null }, draw1: { B: 6, inset: 1, nock: 11 },
                draw2: { B: 8, inset: 2, nock: 17 }, draw3: { B: 10, inset: 3, nock: 23 } };
  function bowLy(B, z) { var u = Math.abs(z - 27.5) / 27; return Math.round(B * u * u); }
  function buildBow(v) {
    var G = new Grid(4, 41, 56), z, ly, zTop = 54 - v.inset, zBot = 1 + v.inset, X = 2, tipLy, nockLy, i;
    for (z = zBot; z <= zTop; z++) {
      ly = bowLy(v.B, z);
      var near = Math.abs(z - 27.5) < 13;
      var tip = z >= zTop - 1 || z <= zBot + 1;
      if (z >= 25 && z <= 30) {                                   // grip
        var gm = (z === 25 || z === 30) ? 'r' : 'l';
        G.put(1, ly + BOW_OY, z, gm); G.put(2, ly + BOW_OY, z, gm); G.put(3, ly + BOW_OY, z, gm);
        G.put(2, ly + 1 + BOW_OY, z, gm);
        continue;
      }
      if (tip) { G.put(X, ly + BOW_OY, z, 'k'); continue; }
      G.put(X, ly + BOW_OY, z, near ? 'W' : (hash(2, ly, z) < 12 ? 't' : 'w'));
      if (near) G.put(X, ly + 1 + BOW_OY, z, 'w');
    }
    tipLy = bowLy(v.B, zTop) + 1;
    nockLy = v.nock === null ? tipLy : v.nock;
    function stringSeg(z0, y0, z1, y1) {
      var n = Math.abs(z1 - z0), s;
      for (s = 0; s <= n; s++) { var zz = z0 + (z1 > z0 ? s : -s); G.put(X, Math.round(y0 + (y1 - y0) * s / n) + BOW_OY, zz, 'N'); }
    }
    stringSeg(zTop - 1, tipLy, BOW_NOCK_Z, nockLy);
    stringSeg(zBot + 1, tipLy, BOW_NOCK_Z, nockLy);
    if (v.nock !== null) {
      G.put(X, nockLy + BOW_OY, BOW_NOCK_Z, 'k');                // serving at the nock point
      // arrow (27 cells = 0.81 m) on the left of the stave: nock at the string, head toward -ly
      for (i = 1; i <= 27; i++) {
        ly = nockLy - i; var m = 'W';
        if (i === 1) m = 'k';                                      // horn nock
        else if (i >= 2 && i <= 6) {                               // fletching: up vane + side vane (x0), red cock below
          G.put(1, ly + BOW_OY, BOW_NOCK_Z + 1, 'N');
          if (i >= 3) G.put(0, ly + BOW_OY, BOW_NOCK_Z, i === 4 ? 'N' : 'k');
          G.put(1, ly + BOW_OY, BOW_NOCK_Z - 1, 'R');
        } else if (i === 8) m = 'R';                               // cresting band
        else if (i === 25) m = 'd';                                // socket
        else if (i === 26) { m = 's'; G.put(1, ly + BOW_OY, BOW_NOCK_Z + 1, 's'); G.put(1, ly + BOW_OY, BOW_NOCK_Z - 1, 's'); }
        else if (i === 27) m = 'S';
        G.put(1, ly + BOW_OY, BOW_NOCK_Z, m);
      }
    }
    return G;
  }
  var BOW_DESC = {
    rest: 'braced, no arrow', draw1: 'string pulled 1/3 (0.30 m), arrow nocked', draw2: 'string pulled 2/3 (0.50 m)',
    draw3: 'full draw (0.70 m), limbs deeply bent'
  };
  var bowVariants = {};
  Object.keys(BOW_V).forEach(function (vn) {
    var G = buildBow(BOW_V[vn]), name = 'bow' + vn.charAt(0).toUpperCase() + vn.slice(1);
    var d = def(name, 'EQ-D1: wooden longbow 1.68 m (pale sapwood back, heartwood belly, horn nocks, leather grip with ' +
      'rope bindings, gut string) - ' + BOW_DESC[vn] + '. Pivot = grip centre.', 0.03, G, [2.5, BOW_OY + 1, BOW_GRIP_Z]);
    d.variantOf = 'bow'; d.variant = vn;
    var nl = BOW_V[vn].nock === null ? bowLy(BOW_V[vn].B, 54) + 1 : BOW_V[vn].nock;
    d.voxel.mounts = {
      grip: { at: [2.5, BOW_OY + 1, BOW_GRIP_Z], part: 'body' },          // bow hand (left fist)
      nock: { at: [2.5, nl + BOW_OY + 0.5, BOW_NOCK_Z + 0.5], part: 'body' },  // draw hand (right, 3 fingers on the string)
      arrowTip: { at: [1.5, nl - 27 + BOW_OY + 0.5, BOW_NOCK_Z + 0.5], part: 'body' },  // launch point
      tipTop: { at: [2.5, bowLy(BOW_V[vn].B, 54 - BOW_V[vn].inset) + BOW_OY + 0.5, 55 - BOW_V[vn].inset], part: 'body' }
    };
    A.voxelModels[name] = d; bowVariants[vn] = d;
  });
  A.voxelModels.bowHeld = A.voxelModels.bowRest;
  A.voxelModels.bowBack = def('bowBack', 'EQ-D1: the braced longbow worn across the back.', 0.03,
    buildBow(BOW_V.rest), [2.5, BOW_OY + 1, BOW_GRIP_Z]);
  A.voxelModels.bowBack.worn = { mount: 'back', pos: [0, 0.06, 0.02], rot: [0, 35, 0],
    note: 'mount proposed: diagonal across the back, upper tip over the LEFT shoulder, string against the back; shown when ' +
          '`ranged` holds the bow but the melee set is out' };

  // =================================================================================================================
  // 3. ARROW: 3 x 40 x 3 at 2 cm = 0.80 m. Tip at y0 (forward). Head y0..3 (steel tip, steel_old barbs at y2..3),
  //    iron socket y4, shaft y5..37 (wood_cut), red cresting band y28, 3 vanes y30..36 (top vane linen_light, side
  //    vanes linen_light / linen_dark, red cock feather below), tapered (the first 2 rows only the top vane), nock y38..39.
  // =================================================================================================================
  function buildArrow(buryTo) {
    var G = new Grid(3, 40, 3), y;
    for (y = 0; y < 40; y++) {
      var m = 'W';
      if (y === 0 || y === 1) m = 'S'; else if (y <= 3) m = 's'; else if (y === 4) m = 'd';
      else if (y === 28) m = 'R'; else if (y >= 38) m = 'k';
      G.put(1, y, 1, m);
      if (y === 2 || y === 3) { G.put(0, y, 1, 's'); G.put(2, y, 1, 's'); }
      if (y >= 30 && y <= 36) {
        G.put(1, y, 2, 'N');
        if (y >= 32) { G.put(0, y, 1, 'N'); G.put(2, y, 1, 'k'); G.put(1, y, 0, 'R'); }
      }
    }
    if (buryTo) for (y = 0; y < buryTo; y++) { G.put(1, y, 1, '.'); G.put(0, y, 1, '.'); G.put(2, y, 1, '.'); }
    return G;
  }
  A.voxelModels.arrow = def('arrow', 'EQ-D1: arrow in flight: steel bodkin with two barbs, iron socket, pale shaft, red ' +
    'cresting, 3 goose vanes (red cock feather), horn nock. Tip = y0 = forward; anchor = balance point (0.30 m from the tip).',
    0.02, buildArrow(0), [1.5, 15, 1.5]);
  A.voxelModels.arrow.voxel.mounts = { tip: { at: [1.5, 0, 1.5], part: 'body' }, nock: { at: [1.5, 40, 1.5], part: 'body' } };
  A.voxelModels.arrow.trail = { note: 'optional view effect (EQ-09): 1 cell behind the nock per 2 steps, `-` linenDark, 100 ms', glyph: '-', color: 'linenDark', lifeMs: 100 };
  var STUCK_BURY = 6;   // head + socket buried 0.12 m, the shaft enters the surface at y6
  A.voxelModels.arrowStuck = def('arrowStuck', 'EQ-D1: arrow stuck in a surface: head buried, shaft + fletching out. ' +
    'Anchor = 0.05 m behind the entry point (= the sim stuck position, 38.41 item 7 stuckBack 0.05).',
    0.02, buildArrow(STUCK_BURY), [1.5, STUCK_BURY + 2.5, 1.5]);
  A.voxelModels.arrowStuck.voxel.parts = { body: { box: [0, 0, 0, 3, 40, 3], pivot: [1.5, STUCK_BURY, 1.5] } };
  A.voxelModels.arrowStuck.voxel.animations = {
    held: { durations: [1000], loop: true, frames: [{}] },
    twang: { durations: [40, 50, 60, 70, 80], loop: false, interp: 'linear', note: 'on impact: the shaft quivers about the entry point and settles',
             frames: [{ body: { rot: [4, 0, 0] } }, { body: { rot: [-3, 0, 1] } }, { body: { rot: [2, 0, -1] } }, { body: { rot: [-1, 0, 0] } }, { body: { rot: [0, 0, 0] } }] }
  };
  A.voxelModels.arrowStuck.voxel.mounts = { entry: { at: [1.5, STUCK_BURY, 1.5], part: 'body' }, nock: { at: [1.5, 40, 1.5], part: 'body' } };

  // =================================================================================================================
  // 4. QUIVER: leather tube 4 x 4 x 24 at 3 cm (0.12 m across, 0.54 m tube + 0.18 m of fletchings). Shell = 8 cells
  //    per ring (corners chamfered off), hollow core; rawhide bottom (linen_dark), stitched seam (rope) on the back,
  //    two rope strap rings, a turned-over leather cuff. Arrows in the core: 4 / 2 / 0 shafts with goose vanes.
  //    Not visible in first person.
  // =================================================================================================================
  function buildQuiver(n) {
    var G = new Grid(4, 4, 24), x, y, z, r;
    for (z = 0; z <= 18; z++) for (y = 0; y < 4; y++) for (x = 0; x < 4; x++) {
      r = Math.sqrt((x - 1.5) * (x - 1.5) + (y - 1.5) * (y - 1.5));
      if (r > 2) continue;
      var core = r < 1;
      if (z === 0) { G.put(x, y, z, 'k'); continue; }
      if (core) continue;
      var m = 'l';
      if (z === 4 || z === 14) m = 'r';
      else if (z >= 17) m = 't';
      else if (y === 3 && x === 2 && z % 2 === 0) m = 'r';
      else if (hash(x, y, z) < 10) m = 'w';
      G.put(x, y, z, m);
    }
    var spots = [[1, 1], [2, 2], [2, 1], [1, 2]];
    for (var a = 0; a < n; a++) {
      x = spots[a][0]; y = spots[a][1];
      var top = 22 - (a % 2);
      for (z = 15; z <= top; z++) G.put(x, y, z, z >= 19 ? (z === top ? 'k' : (a === 0 && z === 20 ? 'R' : 'N')) : 'W');
    }
    return G;
  }
  var QUIVER_WORN = { mount: 'back', pos: [0.12, 0.05, 0.10], rot: [0, -20, 0],
    alt: { mount: 'hip.r', pos: [0.04, 0.02, -0.05], rot: [10, 0, 0] },
    note: 'mount proposed: on the back, fletchings over the RIGHT shoulder (draw hand); alt = right hip on the belt. ' +
          'Variant by equipment.quiver.n: full >= 16, half 1..15, empty 0' };
  [['quiverFull', 4], ['quiverHalf', 2], ['quiverEmpty', 0]].forEach(function (q) {
    var d = def(q[0], 'EQ-D1: leather quiver, rawhide bottom, stitched seam, rope strap rings, ' + q[1] + ' arrows showing. ' +
      'Anchor = the strap point on the back face.', 0.03, buildQuiver(q[1]), [2, 4, 12]);
    d.worn = QUIVER_WORN; A.voxelModels[q[0]] = d;
  });
  A.voxelModels.quiver = A.voxelModels.quiverFull;

  // =================================================================================================================
  // 5. FIRST-PERSON VIEW MODELS (README 7.4: eye space x right, y BACK (forward -y), z up, metres; R = Rz*Ry*Rx).
  // =================================================================================================================
  function k(t, pos, rot, v) { var o = { t: t, pos: pos, rot: rot }; if (v) o.v = v; return o; }
  // SHIELD on the LEFT forearm. The eye sees the shield's BACK (battens, strap, grip) and the rim edge.
  var SH_REST = { pos: [-0.30, -0.50, -0.34], rot: [6, -4, 40] };     // low-left, angled, top third of the shield in view
  var SH_UP = { pos: [-0.30, -0.50, -0.18], rot: [-4, 4, 16] };       // raised: front centre-left, ~25-30 % of the view
  A.viewModels.shield = {
    hand: 'left', model: 'shieldHeld',
    space: 'eye: x right, y back (forward = -y), z up, metres', rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees',
    depth: { near: 0.05, far: 1.5 },
    rest: SH_REST, raised: SH_UP,
    drive: 'shieldView (38.41 item 4): pose = lerp(rest, raised, raiseFrac) per component; raise 7 steps, lower 9 steps. ' +
           'The clips below are the authored timing for the same motion (use either).',
    clips: {
      idle: { loop: true, keys: [k(0, SH_REST.pos, SH_REST.rot), k(1300, [-0.30, -0.50, -0.333], [6.8, -4, 40]), k(2600, SH_REST.pos, SH_REST.rot)] },
      raise: { loop: false, keys: [k(0, SH_REST.pos, SH_REST.rot), k(70, [-0.31, -0.49, -0.21], [-2, 2, 22]),
                                   k(100, [-0.30, -0.505, -0.17], [-5, 4, 14]), k(117, SH_UP.pos, SH_UP.rot)] },
      lower: { loop: false, keys: [k(0, SH_UP.pos, SH_UP.rot), k(90, [-0.30, -0.50, -0.27], [2, 0, 30]), k(150, SH_REST.pos, SH_REST.rot)] },
      blocked: { loop: false, note: 'on a blockTick edge while raised: the hit shoves the shield 5 cm toward the eye and tips its top back, then recovers',
                 keys: [k(0, SH_UP.pos, SH_UP.rot), k(35, [-0.28, -0.45, -0.16], [-12, 6, 12]), k(90, [-0.295, -0.485, -0.175], [-6, 4, 15]),
                        k(160, SH_UP.pos, SH_UP.rot)] }
    },
    bob: { z: 0.010, x: -0.005, rollDeg: -0.8, raisedScale: 0.4 },
    sparks: {
      block: { note: 'blockTick: 5x3 burst at mount rimTop (first person) / boss (world), 40+50+50 ms, plus the `clank` cue',
               mount: 'rimTop', durations: [40, 50, 50],
               frames: [
                 { glyphs: ['  |  ', '-=*=-', '  |  '], fg: ['  m  ', 'mWWWm', '  m  '] },
                 { glyphs: ["\\ ' /", '- + -', "/ . \\"], fg: ['f m f', 'm W m', 'f i f'] },
                 { glyphs: [".   '", '     ', "'   ."], fg: ['e   i', '     ', 'i   e'] }
               ],
               keys: { W: { c: 'white', e: true }, m: { c: 'mirror', e: true }, i: { c: 'ironLight', e: true },
                       f: { c: 'flameCore', e: true }, e: { c: 'ember', e: true } },
               anchor: { x: 2, y: 1 } }
    }
  };
  // BOW in the LEFT hand (grip mount), the right hand draws (engine: handFist variant mirrored at mount `nock`).
  var BW_REST = { pos: [-0.24, -0.52, -0.36], rot: [30, 28, 0] };     // lowered, canted, lower-left
  var BW_AIM = { pos: [-0.08, -0.76, -0.10], rot: [0, 10, 0] };       // arm out, stave canted 10 deg, string toward the eye
  A.viewModels.bow = {
    hand: 'left', model: 'bowRest', variants: bowVariants,
    space: 'eye: x right, y back (forward = -y), z up, metres', rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees',
    depth: { near: 0.05, far: 2.0 },
    rest: BW_REST, aim: BW_AIM,
    clips: {
      idle: { loop: true, keys: [k(0, BW_REST.pos, BW_REST.rot, 'rest'), k(1400, [-0.24, -0.52, -0.352], [31, 28, 0]), k(2800, BW_REST.pos, BW_REST.rot)] },
      raise: { loop: false, note: 'Q swap / draw start: 0.3 s', keys: [k(0, BW_REST.pos, BW_REST.rot, 'rest'), k(180, [-0.10, -0.70, -0.14], [6, 14, 0]), k(300, BW_AIM.pos, BW_AIM.rot)] },
      lower: { loop: false, keys: [k(0, BW_AIM.pos, BW_AIM.rot, 'rest'), k(300, BW_REST.pos, BW_REST.rot)] },
      draw: { loop: false, holdMs: 800, note: 'hold LMB: draw 0 -> full in 0.8 s (drawSteps 48); tMs = drawSteps * 1000/60. ' +
              'The variant steps with the draw; the stave settles in 2 cm and leans 2 deg more at full (effort). FOV-in 4 deg at full = engine.',
              keys: [k(0, BW_AIM.pos, BW_AIM.rot, 'draw1'), k(267, [-0.08, -0.755, -0.10], [0, 11, 0], 'draw2'),
                     k(533, [-0.075, -0.75, -0.095], [0, 12, 0], 'draw3'), k(800, [-0.075, -0.745, -0.095], [0, 12, 0])] },
      hold: { loop: true, note: 'full draw held: a fine strain tremble', keys: [k(0, [-0.075, -0.745, -0.095], [0, 12, 0], 'draw3'),
              k(90, [-0.073, -0.745, -0.094], [0.3, 12, 0]), k(180, [-0.076, -0.744, -0.096], [-0.2, 12.2, 0]), k(270, [-0.075, -0.745, -0.095], [0, 12, 0])] },
      release: { loop: false, note: 'string snaps to brace (variant rest = no arrow), the stave kicks forward + rolls with the shot, then back to aim',
                 keys: [k(0, [-0.075, -0.745, -0.095], [0, 12, 0], 'rest'), k(40, [-0.07, -0.80, -0.11], [-5, 18, 0]),
                        k(140, [-0.08, -0.77, -0.105], [-1, 12, 0]), k(250, BW_AIM.pos, BW_AIM.rot)] },
      dry: { loop: false, note: 'draw pressed with an empty quiver: a short hitch, no variant change (toast "No arrows")',
             keys: [k(0, BW_AIM.pos, BW_AIM.rot, 'rest'), k(60, [-0.08, -0.74, -0.10], [0, 9, 0]), k(150, BW_AIM.pos, BW_AIM.rot)] }
    },
    bob: { z: 0.010, x: -0.005, rollDeg: -0.8, drawScale: 0.2 },
    drawHand: { mount: 'nock', variant: 'handFistL', mirror: true, note: 'right hand at the nock mount from draw1 on (engine/hands.js)' }
  };

  // =================================================================================================================
  // 6. ATTACH
  // =================================================================================================================
  var LIST = ['shieldHeld', 'shieldBack', 'bowRest', 'bowDraw1', 'bowDraw2', 'bowDraw3', 'bowBack', 'arrow', 'arrowStuck',
              'quiverFull', 'quiverHalf', 'quiverEmpty'];
  A.equipment = {
    list: LIST, mats: MATS,
    stats: LIST.reduce(function (o, n) { o[n] = A.voxelModels[n].stats.voxels; return o; }, {}),
    attach: function () {
      var P = A.palette, DP = A.detailPass, done = [], m;
      if (!P || !DP) return done;
      for (m in MATS) if (!P.materials[MATS[m]] || !DP.materials[MATS[m]]) return done;
      A.models = A.models || {};
      LIST.forEach(function (n) { if (!A.models[n]) { A.models[n] = A.voxelModels[n]; done.push(n); } });
      return done;
    }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { equipment: A.equipment };
})(typeof window !== 'undefined' ? window : globalThis);
