/*
 * Kestrel - HELD AXE + SPEAR (ITEM-D1; epic docs/epics/ep-items-stats.md sections 2 + 7, owner D-081 / D-084).
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + README 7.4 (view models, same clip schema as
 * models/sword.js) + README 31 (this file). Preview: design/preview/items-weapons.html.
 *
 * Style (style-guide 0): realistic old-world weapons from voxels. Ash / oak hafts, forged iron and steel, leather grip
 * wraps, rope bindings, bronze fittings on the fine look. No brass / copper / aether (machine + magic colours only).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.axeHeld1 / axeHeld2 / axeHeld3       iL 1-3 / 4-6 / 7-10 looks (Hand Axe / Battle Axe / War Axe)
 *   ASSETS.voxelModels.spearHeld1 / spearHeld2 / spearHeld3 iL 1-3 / 4-6 / 7-10 looks (Short / Long / War Spear)
 *   ASSETS.voxelModels.axeHeld = axeHeld1, spearHeld = spearHeld1 (default look)
 *   ASSETS.axeForHand(hand) / ASSETS.spearForHand(hand)      view models (as ASSETS.swordForHand): clips idle,
 *                                                            light (chop / thrust), charge, hard; aliases swingLR /
 *                                                            swingHard so the sword player can run them unchanged
 *   ASSETS.viewModels.axe / ASSETS.viewModels.spear          = forHand('left') (the sword hand today)
 *   ASSETS.weaponsHeld = { looks, lookForIL(iL), modelFor(type, iL), list, mats, stats, validate(), attach() }
 *
 * LOOKS (one model per iL step; geometry AND materials change, all built by the same builder below):
 *   look 0  iL 1-3   plain: pale ash haft, black-forged iron head, a nick in the edge, a rope lashing
 *   look 1  iL 4-6   steel: steel head + bright edge, leather grip wrap, rope binding, iron butt
 *   look 2  iL 7-10  fine: steel head, wide polished edge, etched dark line, bronze collar + langets / lugs, bronze
 *                    butt cap, leather wrap with two rope bindings (spear: red horsehair tassel under the head)
 *
 * AXES (15.1): x = east, y = SOUTH with y0 = the FRONT row (forward at yaw 0), z = up. Held models stand TIP UP like
 * swordHeld; pivot / anchor = the grip centre.
 *   axe   3 x 11 x 25 at 0.03 m = 0.09 x 0.33 x 0.75 m: shorter + heavier than the sword (0.96 m); haft 0.72 m (oval
 *         1 x 2 cells), head 0.12 m tall at the socket, the bearded edge faces FORWARD (-y, y0) at rot 0.
 *   spear 5 x 3 x 66 at 0.03 m = 0.15 x 0.09 x 1.98 m: ~2 m, shaft 1 cell (3 cm), leaf head 0.24-0.36 m.
 *         Grip at z 20 (0.60 m from the butt), so ~1.4 m of spear is in front of the hand = the +0.6 m reach.
 * Materials: only existing ones (palette.materials + detailPass.materials). No palette edit.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};

  var CELL = 0.03;
  var MATS = {
    w: 'wood', W: 'wood_cut', t: 'timber_old', i: 'iron', I: 'iron_light', d: 'iron_dark', S: 'steel_edge',
    s: 'steel_old', l: 'leather', r: 'rope', z: 'bronze', Z: 'bronze_light', R: 'gore_red'
  };

  // ---- tiny grid builder (layers[z][y] = string over x, '.' = empty), as models/equipment.js ----
  function Grid(sx, sy, sz) {
    var g = [], z, y;
    for (z = 0; z < sz; z++) { g.push([]); for (y = 0; y < sy; y++) g[z].push(new Array(sx + 1).join('.').split('')); }
    return {
      sx: sx, sy: sy, sz: sz,
      put: function (x, y, z, ch) { if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) g[z][y][x] = ch; },
      get: function (x, y, z) { return (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) ? g[z][y][x] : '.'; },
      layers: function () { return g.map(function (L) { return L.map(function (r) { return r.join(''); }); }); },
      count: function () { var n = 0; g.forEach(function (L) { L.forEach(function (r) { r.forEach(function (c) { if (c !== '.') n++; }); }); }); return n; }
    };
  }
  function hash(x, y, z) { var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) % 100; }
  function def(name, desc, G, anchor, mounts, look) {
    return { name: name, desc: desc, variantOf: name.replace(/[0-9]$/, ''), variant: 'il' + (look + 1), look: look,
      voxel: { version: 1, cellM: CELL, size: [G.sx, G.sy, G.sz], anchor: anchor, mats: MATS, layers: G.layers(),
        parts: { body: { box: [0, 0, 0, G.sx, G.sy, G.sz], pivot: anchor } },
        animations: { held: { durations: [1000], loop: true, frames: [{}] } }, mounts: mounts },
      stats: { voxels: G.count() } };
  }

  var LOOKS = [
    { look: 0, iL: [1, 3], key: 'il1', tag: 'plain: ash + black iron' },
    { look: 1, iL: [4, 6], key: 'il2', tag: 'steel: steel head, leather grip' },
    { look: 2, iL: [7, 10], key: 'il3', tag: 'fine: polished steel, bronze fittings' }
  ];
  function lookForIL(iL) { return iL >= 7 ? 2 : iL >= 4 ? 1 : 0; }

  // =================================================================================================================
  // 1. AXE  3 x 11 x 25. Haft x1 / y6..7 / z0..23 (oval 3 x 6 cm). Socket (eye) z18..21 round the haft: x0..2 /
  //    y5..8 with the 4 corners chamfered off. Blade y4..y0 (d = 5 - y = distance from the socket, 1..5): 1 cell
  //    thick (x1), wedge cheeks x0 / x2 near the socket, top edge rises (zt), the beard drops in a concave curve
  //    (zb = hz0 - beard * (d/5)^2.2) so the lower edge hooks down like a real bearded axe. Edge = the front 1-2 rows
  //    + the corner cells of the curve. Poll behind the socket: none / flat hammer poll / short back spike.
  // =================================================================================================================
  var AXE_HZ0 = 18, AXE_HZ1 = 21;
  var AXE_LOOK = [
    { body: 'i', edge: 'I', edgeDepth: 1, beard: 2, up: 1, cheek: 2, poll: 0, haft: 'W', grip: null, bindTop: null, bindLow: null,
      butt: 'W', buttRing: 'W', wedge: null, collar: null, langet: null, etch: null, nick: true },
    { body: 's', edge: 'S', edgeDepth: 1, beard: 3, up: 1, cheek: 1, poll: 1, haft: 'w', grip: 'l', bindTop: 'r', bindLow: null,
      butt: 'd', buttRing: 'i', wedge: 'd', collar: null, langet: null, etch: null, nick: false },
    { body: 's', edge: 'S', edgeDepth: 2, beard: 4, up: 2, cheek: 1, poll: 2, haft: 'w', grip: 'l', bindTop: 'r', bindLow: 'r',
      butt: 'Z', buttRing: 'z', wedge: 'Z', collar: 'Z', langet: 'z', etch: 'd', nick: false }
  ];
  function axeZt(L, d) { return AXE_HZ1 + Math.floor((d - 1) * L.up / 4); }
  function axeZb(L, d) { return AXE_HZ0 - Math.round(L.beard * Math.pow(d / 5, 2.2)); }
  function buildAxe(L) {
    var G = new Grid(3, 11, 25), x, y, z, d, zt, zb, m;
    var RING = [[0, 6], [0, 7], [2, 6], [2, 7], [1, 5], [1, 8]];
    // haft: ash / oak, grain spots, the front a touch darker (oiled hand side)
    for (z = 0; z <= 23; z++) for (y = 6; y <= 7; y++) {
      m = hash(1, y, z) < 14 ? 't' : (L.haft === 'W' ? (y === 6 && hash(3, y, z) < 30 ? 'w' : 'W') : (y === 7 && hash(5, y, z) < 25 ? 'W' : 'w'));
      G.put(1, y, z, m);
    }
    // butt knob (the haft swells so the hand cannot slip off) / iron or bronze butt cap
    G.put(1, 6, 0, L.butt); G.put(1, 7, 0, L.butt);
    RING.forEach(function (c) { G.put(c[0], c[1], 0, L.butt); });
    [[0, 6], [0, 7], [2, 6], [2, 7]].forEach(function (c) { G.put(c[0], c[1], 1, L.buttRing); });
    // grip wrap + bindings
    if (L.grip) for (z = 2; z <= 9; z++) { G.put(1, 6, z, L.grip); G.put(1, 7, z, L.grip); }
    if (L.bindTop) [[0, 6], [0, 7], [2, 6], [2, 7]].forEach(function (c) { G.put(c[0], c[1], 9, L.bindTop); });
    if (L.bindLow) [[0, 6], [0, 7], [2, 6], [2, 7]].forEach(function (c) { G.put(c[0], c[1], 2, L.bindLow); });
    // langets (metal strips down the haft below the head) + collar ring
    if (L.langet) for (z = 14; z <= 16; z++) { G.put(0, 6, z, L.langet); G.put(2, 6, z, L.langet); }
    if (L.collar) RING.forEach(function (c) { G.put(c[0], c[1], AXE_HZ0 - 1, L.collar); });
    // socket (eye), chamfered
    for (z = AXE_HZ0; z <= AXE_HZ1; z++) for (y = 5; y <= 8; y++) for (x = 0; x <= 2; x++) {
      if (x === 1 && (y === 6 || y === 7)) continue;                          // the haft runs through
      if ((x === 0 || x === 2) && (y === 5 || y === 8)) continue;             // chamfer
      G.put(x, y, z, L.body);
    }
    // haft end + wedge above the eye
    if (L.wedge) { G.put(1, 6, 23, L.wedge); G.put(1, 7, 23, L.wedge); }
    // blade
    for (y = 4; y >= 0; y--) {
      d = 5 - y; zt = axeZt(L, d); zb = axeZb(L, d);
      for (z = zb; z <= zt; z++) {
        m = y < L.edgeDepth ? L.edge : L.body;
        G.put(1, y, z, m);
        if (d <= L.cheek && z > AXE_HZ0 && z < AXE_HZ1) { G.put(0, y, z, L.body); G.put(2, y, z, L.body); }
      }
      // curved edge corners: the top + bottom cell of the row just behind the edge catch the light too
      if (y === L.edgeDepth) { G.put(1, y, zt, L.edge); G.put(1, y, zb, L.edge); }
    }
    if (L.etch) for (z = AXE_HZ0 + 1; z <= AXE_HZ1 - 1; z++) G.put(1, 3, z, L.etch);   // etched line across the cheek
    if (L.nick) G.put(1, 0, AXE_HZ0, '.');                                          // a nick in the old edge
    // poll
    if (L.poll === 1) for (z = AXE_HZ0 + 1; z <= AXE_HZ1 - 1; z++) { G.put(0, 9, z, L.body); G.put(1, 9, z, 'i'); G.put(2, 9, z, L.body); }
    if (L.poll === 2) { G.put(1, 9, 19, L.body); G.put(1, 9, 20, L.body); G.put(1, 10, 20, L.edge); }
    return G;
  }
  var AXE_NAMES = ['Hand Axe', 'Battle Axe', 'War Axe'];   // = design/itemBases.js names (placeholders, NEEDS WRITER)
  var AXE_DESC = [
    'pale ash haft with a swelled knob, black-forged iron head with a small beard, an old nick in the edge',
    'oiled haft, steel head with a deeper beard and a flat hammer poll, bright edge, leather grip wrap with a rope binding, iron butt',
    'oiled haft, polished wide-edged steel head with a long beard, an etched line, a short back spike, bronze collar + langets, ' +
      'bronze butt cap, leather wrap between two rope bindings'
  ];
  var AXE_ANCHOR = [1.5, 7, 5.5];
  AXE_LOOK.forEach(function (L, i) {
    var G = buildAxe(L), zt = axeZt(L, 5), zb = axeZb(L, 5);
    A.voxelModels['axeHeld' + (i + 1)] = def('axeHeld' + (i + 1),
      'ITEM-D1 axe look ' + i + ' (' + AXE_NAMES[i] + ', iL ' + LOOKS[i].iL.join('-') + '): ' + AXE_DESC[i] +
      '. 0.75 m, edge forward (-y) at rot 0, pivot = grip centre.', G, AXE_ANCHOR, {
        tip:   { at: [1.5, 0, (zt + zb + 1) / 2], part: 'body' },          // edge centre: trail head, hit sample, chargeGlint
        mid:   { at: [1.5, 5, (AXE_HZ0 + AXE_HZ1 + 1) / 2], part: 'body' }, // socket: ghost line start
        guard: { at: [1.5, 7, 10], part: 'body' },                           // top of the grip
        butt:  { at: [1.5, 7, 0], part: 'body' }
      }, i);
  });
  A.voxelModels.axeHeld = A.voxelModels.axeHeld1;

  // =================================================================================================================
  // 2. SPEAR  5 x 3 x 66. Shaft x2 / y1 (3 cm ash), z2..socket. Socket = a plus-shaped tube (x1..3 / y0..2) that
  //    tapers into the blade. Leaf blade in the x-z plane: half-width per row (halfW), bright edges on the outline,
  //    a midrib that is 3 cells deep (y0..2) in the lower 60 % (diamond section, not a flat plate), point = 2 edge
  //    cells. Look 2 adds side lugs (wings) on the socket, a bronze collar and a red horsehair tassel.
  // =================================================================================================================
  var SP_LOOK = [
    { body: 'i', edge: 'I', rib: 'i', halfW: [0, 1, 1, 1, 1, 1, 0, 0], sock0: 54, sockN: 4, haft: 'W', grip: null,
      bind: null, lash: 'r', butt: 'i', buttRing: null, collar: null, lugs: false, tassel: false },
    { body: 's', edge: 'S', rib: 'd', halfW: [0, 1, 1, 2, 2, 1, 1, 1, 0, 0], sock0: 52, sockN: 4, haft: 'w', grip: 'l',
      bind: 'r', lash: null, butt: 'd', buttRing: 'i', collar: null, lugs: false, tassel: false },
    { body: 's', edge: 'S', rib: 'S', halfW: [1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0], sock0: 49, sockN: 5, haft: 'w', grip: 'l',
      bind: 'r', lash: null, butt: 'Z', buttRing: 'z', collar: 'Z', lugs: true, tassel: true }
  ];
  var SP_GRIP_Z0 = 16, SP_GRIP_Z1 = 24, SP_PIVOT_Z = 20;
  function buildSpear(L) {
    var G = new Grid(5, 3, 66), z, k, dx, w, m, zb = L.sock0 + L.sockN, n = L.halfW.length;
    var PLUS = [[2, 0], [2, 2], [1, 1], [3, 1]];
    for (z = 0; z < L.sock0; z++) G.put(2, 1, z, hash(2, 1, z) < 12 ? 't' : L.haft);
    // butt: ferrule / spike / bronze cap
    G.put(2, 1, 0, L.butt);
    if (L.buttRing) { PLUS.forEach(function (c) { G.put(c[0], c[1], 1, L.buttRing); }); G.put(2, 1, 1, L.buttRing); }
    if (L.butt === 'Z') PLUS.forEach(function (c) { G.put(c[0], c[1], 0, 'z'); });
    // grip wrap + bindings
    if (L.grip) for (z = SP_GRIP_Z0; z <= SP_GRIP_Z1; z++) G.put(2, 1, z, L.grip);
    if (L.bind) [SP_GRIP_Z0, SP_GRIP_Z1].forEach(function (bz) { PLUS.forEach(function (c) { G.put(c[0], c[1], bz, L.bind); }); });
    // rope lashing under the socket (plain look) / bronze collar (fine look)
    if (L.lash) PLUS.forEach(function (c) { G.put(c[0], c[1], L.sock0 - 1, L.lash); });
    if (L.collar) PLUS.forEach(function (c) { G.put(c[0], c[1], L.sock0, L.collar); });
    // socket tube, tapering: full plus for all but the top row, which is the centre + front/back only
    for (z = L.sock0; z < zb; z++) {
      G.put(2, 1, z, L.body);
      if (z < zb - 1) PLUS.forEach(function (c) { if (G.get(c[0], c[1], z) === '.') G.put(c[0], c[1], z, L.body); });
      else { G.put(2, 0, z, L.body); G.put(2, 2, z, L.body); }
    }
    if (L.lugs) { G.put(0, 1, L.sock0 + 1, L.edge); G.put(1, 1, L.sock0 + 1, L.body); G.put(3, 1, L.sock0 + 1, L.body); G.put(4, 1, L.sock0 + 1, L.edge); }
    if (L.tassel) for (z = L.sock0 - 4; z < L.sock0; z++) { if (z >= L.sock0 - 3) G.put(1, 1, z, 'R'); G.put(3, 1, z, 'R'); }
    // leaf blade
    for (k = 0; k < n; k++) {
      z = zb + k; w = L.halfW[k];
      for (dx = -w; dx <= w; dx++) {
        if (w === 0) m = k >= n - 2 ? L.edge : L.rib;
        else if (Math.abs(dx) === w) m = L.edge;
        else if (dx === 0) m = L.rib;
        else m = L.body;
        G.put(2 + dx, 1, z, m);
      }
      if (k < Math.ceil(n * 0.6)) { G.put(2, 0, z, L.rib); G.put(2, 2, z, L.rib); }   // midrib depth (diamond section)
    }
    return G;
  }
  var SP_NAMES = ['Short Spear', 'Long Spear', 'War Spear'];   // = design/itemBases.js names (NEEDS WRITER)
  var SP_DESC = [
    'pale ash shaft, a black-iron leaf head 0.24 m on a rope-lashed socket, plain iron ferrule',
    'oiled shaft, a broad steel leaf head 0.30 m with a dark forged midrib and bright edges, leather grip between rope bindings, iron butt spike',
    'oiled shaft, a long polished steel head 0.36 m with a bright raised midrib, side lugs, bronze collar, red horsehair tassel, ' +
      'leather grip between rope bindings, bronze butt cap'
  ];
  var SP_ANCHOR = [2.5, 1.5, SP_PIVOT_Z + 0.5];
  SP_LOOK.forEach(function (L, i) {
    var G = buildSpear(L), zb = L.sock0 + L.sockN, top = zb + L.halfW.length;
    A.voxelModels['spearHeld' + (i + 1)] = def('spearHeld' + (i + 1),
      'ITEM-D1 spear look ' + i + ' (' + SP_NAMES[i] + ', iL ' + LOOKS[i].iL.join('-') + '): ' + SP_DESC[i] +
      '. 1.98 m, point up at rot 0, pivot = grip 0.6 m from the butt.', G, SP_ANCHOR, {
        tip:   { at: [2.5, 1.5, top], part: 'body' },       // the point: trail head, hit ray end, chargeGlint
        mid:   { at: [2.5, 1.5, zb], part: 'body' },        // head base: ghost line start
        guard: { at: [2.5, 1.5, SP_GRIP_Z1 + 1], part: 'body' },
        butt:  { at: [2.5, 1.5, 0], part: 'body' }
      }, i);
  });
  A.voxelModels.spearHeld = A.voxelModels.spearHeld1;

  // =================================================================================================================
  // 3. VIEW MODELS (README 7.4: eye space x right, y BACK (forward = -y), z up, metres; R = Rz * Ry * Rx; keys
  //    linear, key spacing carries the timing). Authored for the RIGHT hand, mirrored by forHand('left') exactly like
  //    ASSETS.swordForHand (S R S, S = diag(-1, 1, 1)).
  //    Timing from the epic (section 2): axe swing 15 % slower than the sword (light 350 -> 400 ms, hard 633 -> 728),
  //    spear 10 % faster (light 350 -> 315, hard 633 -> 570). The windup / active / recover windows scale the same way.
  //    Clip names: light = `chop` / `thrust`, hard = `chopHard` / `thrustHard`, `charge` as the sword (D-034). The
  //    sword player only knows swingLR / swingHard: both views carry those two names as ALIASES of the same key
  //    lists, so the existing code path plays them with no change (the alias keeps its own windup/active/recover).
  // =================================================================================================================
  function mirrorFor(hand) {
    if (hand !== 'left' && hand !== 'right') throw new Error('forHand: hand must be left or right');
    var sign = hand === 'left' ? -1 : 1;
    function mx(pos, rot) { return { pos: [sign * pos[0], pos[1], pos[2]], rot: [rot[0], sign * rot[1], sign * rot[2]] }; }
    function k(t, pos, rot) { var p = mx(pos, rot); return { t: t, pos: p.pos, rot: p.rot }; }
    return { sign: sign, mx: mx, k: k };
  }
  function swordSparks(hand) { return A.swordForHand ? A.swordForHand(hand).sparks : null; }
  function lookModels(prefix) { return { il1: prefix + '1', il2: prefix + '2', il3: prefix + '3' }; }

  // ---- AXE: an overhead diagonal CHOP. The head comes down from above the view (it leaves the top edge in the
  //      windup = the arm loads), hangs a beat at the top (heavy), crashes through the centre with the edge leading
  //      (rx 30 -> 105), bites low past the centre (follow-through), then is hauled back up to rest.
  var AXE_REST = { pos: [0.26, -0.38, -0.26], rot: [40, -12, 4] };          // haft low-right, head up-forward, canted in
  var AXE_CHARGE_END = { pos: [0.10, -0.45, -0.16], rot: [30, 30, 0] };     // cocked over the right shoulder: head top-right IN view
  A.axeForHand = function axeForHand(hand) {
    var M = mirrorFor(hand), k = M.k, sign = M.sign;
    var chop = { loop: false, windup: [0, 140], active: [140, 260], recover: [260, 400], leadEdge: 'edge (-y, down)', keys: [
      k(0,   AXE_REST.pos, AXE_REST.rot),
      k(110, [0.22, -0.30, -0.06], [5, -10, 14]),        // windup: haft raised, head lifts out of the top of the view
      k(140, [0.21, -0.29, -0.04], [0, -10, 15]),        // the heavy hang at the top (anticipation beat)
      k(180, [0.16, -0.40, -0.08], [32, -6, 10]),        // active 1: the head drops into view, top-right
      k(220, [0.10, -0.50, -0.08], [62, -2, 4]),         // active 2: through the centre, edge leading
      k(260, [0.06, -0.50, -0.14], [90, 0, 0]),          // active 3: the bite, head at the bottom edge of the view
      k(320, [0.05, -0.44, -0.30], [118, 2, -4]),        // follow-through: the weight drags it low, out of view
      k(400, AXE_REST.pos, AXE_REST.rot)                  // recovered (hauled back up)
    ] };
    var chopHard = { loop: false, windup: [0, 80], active: [80, 210], recover: [210, 728], leadEdge: 'edge (-y, down)', keys: [
      k(0,   AXE_CHARGE_END.pos, AXE_CHARGE_END.rot),    // the charge end pose (blend: replaced by the captured pose)
      k(80,  [0.14, -0.36, -0.04], [4, 26, 6]),          // windup: the heave, head thrown back over the shoulder
      k(120, [0.09, -0.48, -0.10], [45, 12, 2]),         // active 1: hammering down from top-right
      k(160, [0.04, -0.55, -0.10], [66, 4, 0]),          // active 2: centre, full reach
      k(210, [0.02, -0.55, -0.16], [92, 0, 0]),          // active 3: deep bite at the bottom edge of the view
      k(290, [0.02, -0.48, -0.38], [135, -2, -2]),       // follow-through: buried low
      k(400, [0.03, -0.47, -0.39], [138, -2, -2]),       // hang: stuck for a beat (you're open)
      k(560, [0.18, -0.42, -0.30], [70, -8, 2]),         // wrench it back up
      k(728, AXE_REST.pos, AXE_REST.rot)
    ] };
    return {
      hand: hand, weapon: 'axe', model: 'axeHeld1', looks: lookModels('axeHeld'),
      lookRule: 'model = looks[ASSETS.weaponsHeld.looks[lookForIL(item iL)].key]; poses and clips are the same for every look',
      space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
      rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
      depth: { near: 0.05, far: 1.5 },
      rest: M.mx(AXE_REST.pos, AXE_REST.rot),
      clips: {
        idle: { loop: true, keys: [k(0, AXE_REST.pos, AXE_REST.rot), k(1300, [0.262, -0.38, -0.252], [41.5, -12, 3]), k(2600, AXE_REST.pos, AXE_REST.rot)] },
        chop: chop,
        charge: { loop: false, holdMs: 400, keys: [
          k(0,   AXE_REST.pos, AXE_REST.rot),
          k(100, [0.24, -0.36, -0.20], [32, -2, 6]),       // small pull-back (all a tap shows)
          k(260, [0.14, -0.42, -0.15], [30, 22, 2]),       // the head swings up over the right shoulder
          k(340, [0.09, -0.46, -0.16], [28, 34, 0]),       // overshoot (the arm loads)
          k(400, AXE_CHARGE_END.pos, AXE_CHARGE_END.rot)
        ] },
        chopHard: chopHard,
        swingLR: chop,          // alias for the sword player (light)
        swingHard: chopHard     // alias for the sword player (hard)
      },
      chain: { max: 2, queueDuring: 'recover', restMs: 350, startAtMs: 320, blendMs: 100,
               note: 'as the sword (D-034) but heavier: light #2 starts at the follow-through key (320 ms), 350 ms rest after 2' },
      bob: { z: 0.013, x: sign * 0.006, rollDeg: sign * 1.0, note: 'as sword bob; x0.4 during chop, x0.2 during charge / chopHard' },
      trail: {
        note: 'as sword trail (active window only, slope glyphs, colour by age, emissive, drawn under the head); 7 samples',
        mount: 'tip', ghostMount: 'mid', stepMs: 16.7, samples: 7, lifeMs: 117,
        glyphs: { h: '-', d1: '/', d2: '\\', v: '|', head: { h: '=', d1: '/', d2: '\\', v: '!' } },
        slope: { hMaxDeg: 22.5, vMinDeg: 67.5 },
        colors: [[34, 'white'], [67, 'mirror'], [117, 'ironLight']],
        ghost: { ageMs: 50, glyph: ':', color: 'iron' }
      },
      trailHard: {
        note: 'as sword trailHard: 9 samples / 150 ms, heavy glyphs, fire colours (steel heated by the blow)',
        mount: 'tip', ghostMount: 'mid', stepMs: 16.7, samples: 9, lifeMs: 150,
        glyphs: { h: '=', d1: '/', d2: '\\', v: '|', head: { h: '#', d1: '%', d2: '%', v: '#' } },
        slope: { hMaxDeg: 22.5, vMinDeg: 67.5 },
        colors: [[25, 'white'], [50, 'flameCore'], [90, 'flameMid'], [125, 'flameOuter'], [150, 'emberDim']],
        ghost: { ageMs: 33, glyph: '%', color: 'mirror' }
      },
      sparks: swordSparks(hand),
      sparksNote: 'the sword spark presets (clink, hit, hitHeavy, chargeGlint at mount tip, targetFlash); null = load sword.js first'
    };
  };

  // ---- SPEAR: a straight THRUST. Rest = shaft low-right, point forward and a little up, aimed at the crosshair.
  //      Windup pulls the hand back 13 cm (the point stays aimed), the active window drives it 0.45 m forward along
  //      the aim line, a 4 cm overshoot, then it slides back. Reads as a fast poke that "keeps distance".
  var SP_REST = { pos: [0.24, -0.34, -0.30], rot: [80, 0, -6] };
  var SP_CHARGE_END = { pos: [0.28, -0.14, -0.22], rot: [76, -4, -9] };     // drawn far back along the forearm, point still on target
  A.spearForHand = function spearForHand(hand) {
    var M = mirrorFor(hand), k = M.k, sign = M.sign;
    var thrust = { loop: false, windup: [0, 90], active: [90, 170], recover: [170, 315], leadEdge: 'tip (+z)', keys: [
      k(0,   SP_REST.pos, SP_REST.rot),
      k(90,  [0.26, -0.21, -0.27], [82, 0, -5]),          // windup end: pulled back 13 cm, a hair up
      k(120, [0.20, -0.46, -0.24], [85, 0, -4]),          // active 1: driving out
      k(170, [0.12, -0.78, -0.19], [88, 0, -2]),          // active 2: full extension on the aim line
      k(215, [0.11, -0.82, -0.20], [90, 0, -1]),          // follow-through: 4 cm overshoot, point dips
      k(315, SP_REST.pos, SP_REST.rot)                     // recovered
    ] };
    var thrustHard = { loop: false, windup: [0, 60], active: [60, 170], recover: [170, 570], leadEdge: 'tip (+z)', keys: [
      k(0,   SP_CHARGE_END.pos, SP_CHARGE_END.rot),
      k(60,  [0.30, -0.08, -0.21], [74, -4, -9]),         // windup: the last coil
      k(100, [0.20, -0.52, -0.20], [84, 0, -4]),          // active 1: the lunge
      k(170, [0.10, -0.98, -0.16], [90, 0, -1]),          // active 2: full lunge (0.2 m past the light thrust)
      k(260, [0.09, -1.02, -0.20], [93, 0, 0]),           // follow-through: the point drops a little
      k(380, [0.10, -0.98, -0.22], [94, 0, -1]),          // hang: over-extended (you're open)
      k(570, SP_REST.pos, SP_REST.rot)
    ] };
    return {
      hand: hand, weapon: 'spear', model: 'spearHeld1', looks: lookModels('spearHeld'),
      lookRule: 'model = looks[ASSETS.weaponsHeld.looks[lookForIL(item iL)].key]; poses and clips are the same for every look',
      space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
      rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
      depth: { near: 0.05, far: 2.4 },
      depthNote: 'the butt end (0.6 m behind the hand) passes beside / behind the eye: cells closer than near are simply not drawn',
      rest: M.mx(SP_REST.pos, SP_REST.rot),
      clips: {
        idle: { loop: true, keys: [k(0, SP_REST.pos, SP_REST.rot), k(1200, [0.243, -0.34, -0.294], [80.8, 0, -6.5]), k(2400, SP_REST.pos, SP_REST.rot)] },
        thrust: thrust,
        charge: { loop: false, holdMs: 400, keys: [
          k(0,   SP_REST.pos, SP_REST.rot),
          k(100, [0.25, -0.28, -0.28], [81, -1, -7]),      // small pull-back (all a tap shows)
          k(300, [0.28, -0.16, -0.23], [77, -4, -9]),      // drawn back along the forearm
          k(350, [0.285, -0.13, -0.22], [76, -4, -9.5]),   // overshoot
          k(400, SP_CHARGE_END.pos, SP_CHARGE_END.rot)
        ] },
        thrustHard: thrustHard,
        swingLR: thrust,         // alias for the sword player (light)
        swingHard: thrustHard    // alias for the sword player (hard)
      },
      chain: { max: 3, queueDuring: 'recover', restMs: 200, startAtMs: 215, blendMs: 60,
               note: 'fast pokes: up to 3 light thrusts in a row, the next one starts at the follow-through key (215 ms)' },
      bob: { z: 0.010, x: sign * 0.005, rollDeg: sign * 0.6, note: 'as sword bob; x0.4 during thrust, x0.2 during charge / thrustHard' },
      reachM: 0.6, reachNote: 'epic: reach +0.6 m vs the sword; the hit ray runs from mount mid to mount tip',
      trail: {
        note: 'as sword trail; a thrust barely moves on screen, so the trail is a short streak behind the point (4 samples)',
        mount: 'tip', ghostMount: 'mid', stepMs: 16.7, samples: 4, lifeMs: 67,
        glyphs: { h: '-', d1: '/', d2: '\\', v: '|', head: { h: '=', d1: '/', d2: '\\', v: '|' } },
        slope: { hMaxDeg: 22.5, vMinDeg: 67.5 },
        colors: [[34, 'white'], [67, 'mirror']],
        ghost: { ageMs: 33, glyph: ':', color: 'iron' }
      },
      trailHard: {
        note: 'as sword trailHard, 6 samples / 100 ms (the lunge is short on screen)',
        mount: 'tip', ghostMount: 'mid', stepMs: 16.7, samples: 6, lifeMs: 100,
        glyphs: { h: '=', d1: '/', d2: '\\', v: '|', head: { h: '#', d1: '%', d2: '%', v: '#' } },
        slope: { hMaxDeg: 22.5, vMinDeg: 67.5 },
        colors: [[25, 'white'], [50, 'flameCore'], [75, 'flameMid'], [100, 'flameOuter']],
        ghost: { ageMs: 33, glyph: '%', color: 'mirror' }
      },
      sparks: swordSparks(hand),
      sparksNote: 'the sword spark presets (clink, hit, hitHeavy, chargeGlint at mount tip, targetFlash); null = load sword.js first'
    };
  };
  A.viewModels.axe = A.axeForHand('left');
  A.viewModels.spear = A.spearForHand('left');

  // =================================================================================================================
  // 4. INDEX, SELF-CHECK, ATTACH
  // =================================================================================================================
  var LIST = ['axeHeld1', 'axeHeld2', 'axeHeld3', 'spearHeld1', 'spearHeld2', 'spearHeld3'];
  function validate(palette, detailPass) {
    var errs = [];
    LIST.forEach(function (n) {
      var v = A.voxelModels[n].voxel, z, y, x, ch;
      if (v.layers.length !== v.size[2]) errs.push(n + ': layer count');
      for (z = 0; z < v.layers.length; z++) {
        if (v.layers[z].length !== v.size[1]) errs.push(n + ': rows in layer ' + z);
        for (y = 0; y < v.layers[z].length; y++) {
          if (v.layers[z][y].length !== v.size[0]) errs.push(n + ': row length z' + z + ' y' + y);
          for (x = 0; x < v.layers[z][y].length; x++) { ch = v.layers[z][y].charAt(x); if (ch !== '.' && !v.mats[ch]) errs.push(n + ': unknown char ' + ch); }
        }
      }
      for (ch in v.mats) {
        if (palette && palette.materials && !palette.materials[v.mats[ch]]) errs.push(n + ': palette lacks material ' + v.mats[ch]);
        if (detailPass && detailPass.materials && !detailPass.materials[v.mats[ch]]) errs.push(n + ': detailPass lacks material ' + v.mats[ch]);
      }
      for (var m in v.mounts) { var at = v.mounts[m].at; for (var i = 0; i < 3; i++) if (at[i] < 0 || at[i] > v.size[i]) errs.push(n + ': mount ' + m + ' outside'); }
    });
    return errs;
  }
  A.weaponsHeld = {
    looks: LOOKS, lookForIL: lookForIL,
    names: { axe: AXE_NAMES, spear: SP_NAMES },
    modelFor: function (type, iL) { var p = type === 'axe' ? 'axeHeld' : type === 'spear' ? 'spearHeld' : null; return p ? p + (lookForIL(iL || 1) + 1) : null; },
    list: LIST, mats: MATS,
    stats: LIST.reduce(function (o, n) { o[n] = A.voxelModels[n].stats.voxels; return o; }, {}),
    validate: function () { return validate(A.palette, A.detailPass); },
    attach: function () {
      var P = A.palette, DP = A.detailPass, done = [], m;
      if (!P || !DP) return done;
      for (m in MATS) if (!P.materials[MATS[m]] || !DP.materials[MATS[m]]) return done;
      A.models = A.models || {};
      LIST.forEach(function (n) { if (!A.models[n]) { A.models[n] = A.voxelModels[n]; done.push(n); } });
      return done;
    }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { weaponsHeld: A.weaponsHeld, axeForHand: A.axeForHand, spearForHand: A.spearForHand };
})(typeof window !== 'undefined' ? window : globalThis);
