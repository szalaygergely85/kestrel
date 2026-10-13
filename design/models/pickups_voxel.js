/* design/models/pickups_voxel.js - OB-132 / OB-137 (designer, owner 2026-10-14 "use voxels for items!", "voxels pleaseeeee",
 * "remove these sprites"): every world pickup, gear drop, potion and the floor lamp as a small VOXEL model, so the
 * player reads WHAT is lying there at 2-4 m in first person. Replaces the billboard sprites pickupGear (one blurry helm
 * for every drop), pickupRedCap, berrySprig (m3_props.js) and floorLantern (lantern.js).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/chest.js:
 *   <script src="../design/models/pickups_voxel.js">   (browser, after palette.js / detail-pass.js)
 *   import '../../../design/models/pickups_voxel.js';   (Node tests: side-effect import; module.exports below)
 * Sets ASSETS.voxelModels[id] AND ASSETS.models[id] (the same record, no billboard) for every id below, and
 * ASSETS.pickupsVoxel = { ids, pickupModelFor(itemId, slot), itemModel, slotModel, spriteReplace, validate() }.
 * Format: VoxelModelDef (architecture.md 15.1, design/README.md sections 7 + 16), one part `body`, static clips.
 * Only ALREADY-MERGED materials (palette.materials AND detailPass.materials): no palette.js / detail-pass.js edit.
 * Axes: x = east, y = SOUTH (y0 = the front row), z = up. Anchor = footprint centre, bottom (sits on the ground).
 * Preview: design/preview/pickups-voxel.html (all models turning, light sliders, world-scale toggle).
 *
 * Look rules (style guide 0 + 2): real objects at real-ish size, lying the way a dropped thing lies (gear flat on the
 * ground, helm on its rim, boots standing, flasks upright), silhouette first, 2-3 hue families per item. Old-world gear
 * = steel / bronze / leather / woad wool (never brass); brass only on the relay fittings and the lamp (machine).
 * Turning in the world = the entity yaw (no spin clip: a 270 -> 0 deg key would interpolate backwards).
 *
 * Model ids:
 *   quest   pickup.signArm  pickup.packet  pickup.barleySheaf  pickup.berry.blue  pickup.brass.scrap  pickup.emberpod
 *           pickup.redcap  pickup.relay.brass  pickup.relay.mirror  pickup.potion.hp  pickup.potion.mp
 *   gear    pickup.gear.<slot>  slot = head body cloak hands belt legs feet main off ranged (one model for every tier)
 *   lamp    floorLanternVox (clips lit / unlit / idle, glowing glass)   floorLanternVoxCold (cold glass, same clips)
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  // one char per material (every key already in palette.materials + detailPass.materials); each model gets only the
  // chars it uses (record() builds its own mats map)
  var MAT = {
    w: 'wood', W: 'wood_cut', t: 'timber_old',
    d: 'iron_dark', i: 'iron_light', s: 'steel_edge', S: 'steel_old', z: 'bronze', Z: 'bronze_light',
    b: 'brass', B: 'brass_light', D: 'brass_dark', H: 'brass_hot',
    l: 'leather', c: 'canvas', C: 'canvas_light', k: 'canvas_dark', r: 'rope', n: 'linen', N: 'linen_dark',
    y: 'straw', Y: 'straw_light', u: 'straw_dark', f: 'leaf', F: 'leaf_dark', v: 'leaf_light', p: 'petal_white',
    e: 'ember_core', g: 'ember_glow', T: 'flame_tip', R: 'gore_red', Q: 'gore_red_dark', M: 'mirror_dark',
    o: 'dye_woad', O: 'dye_woad_dark', q: 'dye_woad_light', a: 'dye_madder', x: 'dye_walnut', X: 'dye_walnut_dark'
  };

  function hash3(x, y, z) {   // deterministic, no Math.random (same as chest.js)
    var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function sq(a) { return a * a; }
  function pick(c, X, Y, Z, e) { return typeof c === 'function' ? c(X, Y, Z, e) : c; }

  // ---- voxel grid helpers (shape tests use voxel CENTRES X = x + 0.5 ...) ----
  function grid(sx, sy, sz) {
    var g = [], x, y, z, L, r;
    for (z = 0; z < sz; z++) { L = []; for (y = 0; y < sy; y++) { r = []; for (x = 0; x < sx; x++) r.push('.'); L.push(r); } g.push(L); }
    var G = { sx: sx, sy: sy, sz: sz };
    G.set = function (x, y, z, c) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (!c || c === '.' || x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
      g[z][y][x] = c;
    };
    G.get = function (x, y, z) { return (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) ? '.' : g[z][y][x]; };
    G.each = function (fn) {
      for (var z = 0; z < sz; z++) for (var y = 0; y < sy; y++) for (var x = 0; x < sx; x++) {
        var c = fn(x + 0.5, y + 0.5, z + 0.5, x, y, z);
        if (c) G.set(x, y, z, c);
      }
    };
    G.seg = function (x0, y0, z0, x1, y1, z1, r, c) {   // thick line (capsule) between two continuous points
      var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
      var ax = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1)), bx = Math.min(sx - 1, Math.ceil(Math.max(x0, x1) + r + 1));
      var ay = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1)), by = Math.min(sy - 1, Math.ceil(Math.max(y0, y1) + r + 1));
      var az = Math.max(0, Math.floor(Math.min(z0, z1) - r - 1)), bz = Math.min(sz - 1, Math.ceil(Math.max(z0, z1) + r + 1));
      for (var z = az; z <= bz; z++) for (var y = ay; y <= by; y++) for (var x = ax; x <= bx; x++) {
        var X = x + 0.5, Y = y + 0.5, Z = z + 0.5;
        var t = ((X - x0) * dx + (Y - y0) * dy + (Z - z0) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (sq(X - x0 - dx * t) + sq(Y - y0 - dy * t) + sq(Z - z0 - dz * t) <= r * r) G.set(x, y, z, pick(c, X, Y, Z, t));
      }
    };
    G.ell = function (cx, cy, cz, rx, ry, rz, c) {
      G.each(function (X, Y, Z) {
        var e = sq((X - cx) / rx) + sq((Y - cy) / ry) + sq((Z - cz) / rz);
        return e <= 1 ? pick(c, X, Y, Z, e) : null;
      });
    };
    G.top = function (x, y) { for (var z = sz - 1; z >= 0; z--) if (g[z][y][x] !== '.') return z; return -1; };
    G.layers = function () { return g.map(function (L) { return L.map(function (r) { return r.join(''); }); }); };
    return G;
  }

  // =============================== QUEST PICKUPS ===============================

  // signArm: the broken arm of a wooden fingerpost, lying flat: planks with darker grain, a pointed end, a splintered
  // break, faded black lettering on the top face, two nail heads (one bent nail sticking up) where it was fixed.
  function mSignArm() {
    var G = grid(22, 7, 3);
    var paint = ['X.X.XXX.X..X', 'XXX..X..XX.X', 'X.X.XXX.X.XX'];
    G.each(function (X, Y, Z, x, y, z) {
      if (z > 1) return null;
      var hw = x < 17 ? 3.5 : 3.5 * (21.6 - X) / 4.6;               // pointed end
      if (Math.abs(Y - 3.5) > hw) return null;
      if (x <= 1 && hash3(x, y, 7) < (x === 0 ? 55 : 25)) return null; // splintered break
      if (z === 0) return (y % 3 === 0) ? 't' : 'w';
      if (y === 0 || y === 6 || Math.abs(Y - 3.5) > hw - 0.8) return 't'; // bevelled top edge
      if (x >= 4 && x < 16 && y >= 2 && y <= 4 && paint[y - 2].charAt(x - 4) === 'X') return 'X';
      return hash3(x, y, z) < 12 ? 'W' : 'w';
    });
    G.set(2, 1, 1, 'd'); G.set(2, 5, 1, 'd'); G.set(2, 1, 2, 'i');
    return G;
  }

  // packet: an oilcloth parcel (dark waxed canvas, pale creases of the folded ends) tied both ways with string, knot on top.
  function mPacket() {
    var G = grid(12, 10, 6);
    G.each(function (X, Y, Z, x, y, z) {
      if (x < 1 || x > 10 || y < 1 || y > 8 || z > 4) return null;
      var ex = x === 1 || x === 10, ey = y === 1 || y === 8;
      if (ex && ey) return null;                          // rounded vertical edges
      if (z === 4 && (ex || ey)) return null;             // rounded top edges
      if (x === 6 || y === 5) return 'r';                 // the string, both ways round
      if (z === 4 && (Math.abs((x - 1) - (y - 1) * 1.1) < 0.8 || Math.abs((10 - x) - (y - 1) * 1.1) < 0.8)) return 'c';
      return hash3(x, y, z) < 14 ? 'c' : 'k';
    });
    G.set(5, 4, 5, 'r'); G.set(6, 4, 5, 'r'); G.set(5, 5, 5, 'r'); G.set(6, 5, 5, 'r'); G.set(7, 6, 5, 'r'); G.set(8, 7, 5, 'r');
    return G;
  }

  // barleySheaf: a sheaf lying on its side: straight stalks (per-stalk colour, constant along the length), cut ends,
  // a rope tie, and the ears fanning out of the head in pale straw.
  function mSheaf() {
    var G = grid(24, 9, 8), i;
    G.each(function (X, Y, Z, x, y, z) {
      if (x > 15) return null;
      var tie = x === 9 || x === 10, r = Math.sqrt(sq(Y - 4.5) + sq(Z - 3.5));
      if (r > (tie ? 3.3 : 3.0)) return null;
      if (tie) return 'r';
      if (x === 0) return hash3(y, z, 1) < 30 ? null : (hash3(y, z, 2) < 50 ? 'u' : 'y');
      var h = hash3(y, z, 3);
      return h < 22 ? 'u' : h < 45 ? 'Y' : 'y';
    });
    for (i = 0; i < 11; i++) {
      var a = (i / 10 - 0.5) * 2.2, b = ((i * 7) % 5) / 4 - 0.5;
      G.seg(15.5, 4.5 + Math.sin(a) * 1.8, 3.5 + b * 2.2, 22.5 - (i % 3), 4.5 + Math.sin(a) * 4.0, Math.max(0.6, 2.4 + b * 3.0), 0.72,
        function (X, Y, Z, t) { return t > 0.35 && hash3(Math.floor(X), Math.floor(Y), Math.floor(Z)) >= 30 ? 'Y' : 'y'; });
    }
    return G;
  }

  // berry.blue: a short twig lying on the ground with three leaves and clusters of round blue berries (bloom on top).
  function mBerry() {
    var G = grid(14, 10, 5), i;
    G.seg(1, 8.5, 0.5, 12.5, 2, 1.2, 0.7, 'X');
    G.seg(5, 6.3, 0.8, 4, 2.2, 1.8, 0.6, 'X');
    G.seg(8.5, 4.3, 1, 11.5, 7.5, 1.6, 0.6, 'X');
    function leaf(cx, cy, rx, ry, c) { G.ell(cx, cy, 0.6, rx, ry, 0.6, function (X, Y) { return Math.abs(Y - cy) < 0.5 ? 'F' : c; }); }
    leaf(2.6, 8.4, 2.4, 1.3, 'f'); leaf(9.5, 1.6, 2.2, 1.2, 'v'); leaf(6.5, 8.2, 1.8, 1.2, 'f');
    var B = [[4, 2.5, 2.2], [5.8, 3.3, 2.0], [3.2, 3.8, 1.8], [11.6, 7.3, 2.2], [12.3, 5.6, 1.9], [10.2, 8.3, 1.6], [7.6, 5.2, 1.7], [12.6, 2.6, 2.0]];
    for (i = 0; i < B.length; i++) (function (bx, by, bz) {
      G.ell(bx, by, bz, 1.05, 1.05, 1.05, function (X, Y, Z) { return Z > bz + 0.4 ? 'q' : Z < bz - 0.4 ? 'O' : 'o'; });
    })(B[i][0], B[i][1], B[i][2]);
    return G;
  }

  // brass.scrap: two torn brass plates, one bent up 45 deg along a fold, rivets proud, a curled strip.
  function mScrap() {
    var G = grid(14, 12, 6), x, y, z;
    for (x = 0; x <= 9; x++) for (y = 1; y <= 7; y++) {
      z = x < 6 ? 0 : x - 5;
      if ((x === 0 || x === 9 || y === 1 || y === 7) && hash3(x, y, 9) < 30) continue;   // torn edge
      G.set(x, y, z, (y === 1 || y === 7 || x === 0) ? 'D' : 'b');
      if (x >= 6) G.set(x, y, z - 1, 'D');
    }
    G.set(2, 2, 1, 'H'); G.set(2, 6, 1, 'H');
    for (x = 4; x <= 13; x++) for (y = 7; y <= 11; y++) {
      if ((x === 13 || y === 11) && hash3(x, y, 4) < 40) continue;
      z = x <= 8 ? 1 : (y >= 9 ? 1 : 0);
      G.set(x, y, z, (x === 4 || y === 11 || x === 13) ? 'D' : 'B');
    }
    G.set(7, 9, 2, 'H'); G.set(11, 8, 1, 'H');
    G.seg(11, 2, 0.5, 13, 3.5, 2.5, 0.65, 'B'); G.seg(13, 3.5, 2.5, 11.5, 4.5, 3.5, 0.65, 'D');
    return G;
  }

  // emberpod: a husked seed pod lying on its side; the dark husk splits along 6 spiral seams that glow ember orange,
  // white-hot in the middle (emissive ember_glow / ember_core). Stalk and dried tip in dark walnut.
  function mEmberpod() {
    var G = grid(12, 8, 7);
    G.ell(5.8, 4, 3.0, 5.2, 3.0, 2.7, function (X, Y, Z) {
      var a = Math.atan2(Z - 3.0, Y - 4) + X * 0.25, f = ((a / (2 * Math.PI)) * 6 % 1 + 1) % 1;
      if (f < 0.16 && Math.abs(X - 5.8) < 3) return 'e';
      if (f < 0.32) return 'g';
      return hash3(Math.floor(X), Math.floor(Y), Math.floor(Z)) < 25 ? 'x' : 't';
    });
    G.seg(0.2, 4, 3.0, 1.2, 4, 3.0, 0.6, 'X');
    G.seg(10.8, 4, 3.0, 11.8, 4, 3.4, 0.55, 'X');
    return G;
  }

  // redcap: two red-capped mushrooms (pale stems, white flecks, pale gills under the rim) on a moss pad.
  function mRedcap() {
    var G = grid(12, 10, 9);
    G.ell(6, 5, 0.3, 5.6, 4.6, 0.9, function (X, Y) { return hash3(Math.floor(X), Math.floor(Y), 3) < 30 ? 'f' : 'F'; });
    G.each(function (X, Y, Z, x, y, z) {
      var r1 = Math.sqrt(sq(X - 5) + sq(Y - 5)), r2 = Math.sqrt(sq(X - 9.5) + sq(Y - 7.5));
      if (z >= 1 && z <= 3 && r1 <= 1.6) return z === 1 ? 'N' : 'n';
      if (z === 4 && r1 <= 3.8) return r1 <= 1.6 ? 'n' : 'N';                    // gills under the big cap
      if (z >= 5) { var e = sq(r1 / 4.0) + sq((Z - 4.6) / 3.0); if (e <= 1) return hash3(x, y, z) < 14 ? 'p' : (Z > 7 ? 'Q' : 'R'); }
      if (z === 1 && r2 <= 0.9) return 'n';
      if (z === 2 && r2 <= 1.6) return r2 <= 0.9 ? 'n' : 'N';
      if (z === 3 && r2 <= 1.9) return hash3(x, y, z) < 12 ? 'p' : 'R';
      return null;
    });
    return G;
  }

  // relay.brass: a heavy brass ring fitting (torus, dark underside, four hot bolt heads) with a threaded pipe stub.
  function mRelayBrass() {
    var G = grid(14, 14, 5), k;
    G.each(function (X, Y, Z, x, y, z) {
      var rho = Math.sqrt(sq(X - 5.8) + sq(Y - 7)), d = Math.sqrt(sq(rho - 4.2) + sq(Z - 1.3));
      if (d > 1.35) return null;
      return z === 0 ? 'D' : z === 1 ? 'b' : 'B';
    });
    for (k = 0; k < 4; k++) { var a = Math.PI / 4 + k * Math.PI / 2; G.set(5.8 + 4.2 * Math.cos(a), 7 + 4.2 * Math.sin(a), 2, 'H'); }
    G.seg(9.6, 7, 1.3, 13.0, 7, 1.3, 1.25, function (X) { return Math.floor(X) % 2 ? 'b' : 'D'; });
    G.seg(13.1, 7, 1.3, 13.6, 7, 1.3, 1.6, 'B');
    return G;
  }

  // relay.mirror: a round mirror in a brass frame, propped up ~37 deg on a back strut (face = front + up).
  function mRelayMirror() {
    var G = grid(14, 10, 11);
    var cx = 7, cy = 4.6, cz = 5.3;                 // n = (0,-0.8,0.6) faces front/up; w = (0,0.6,0.8) = in-plane up
    G.each(function (X, Y, Z, x, y, z) {
      var px = X - cx, py = Y - cy, pz = Z - cz, d = -0.8 * py + 0.6 * pz;
      if (Math.abs(d) > 1.1) return null;
      var v = 0.6 * py + 0.8 * pz, u = px, rr = Math.sqrt(u * u + v * v);
      if (rr > 5.4) return null;
      if (rr > 4.3) return d < -0.35 ? 'D' : (hash3(x, y, z) < 10 ? 'H' : 'B');
      if (d < -0.1) return 'D';                       // back plate
      if (Math.abs(u + v * 0.8 - 1.2) < 0.75) return 's'; // the bright streak across the glass
      return 'M';
    });
    G.seg(7, 6.8, 4.8, 7, 9.4, 0.5, 0.7, 'D');
    return G;
  }

  // ================================= GEAR =================================

  // head: an old nasal spangenhelm of the watch, sitting on its rim: steel dome, 4 bronze strips, bronze brow band with
  // rivets, bronze knob, nasal guard on the front.
  function rHelm(Z) { return 6.3 * Math.pow(Math.max(0, 1 - Z / 9.2), 0.62); }
  function mHelm() {
    var G = grid(15, 15, 10), z;
    G.each(function (X, Y, Z, x, y, z) {
      var rho = Math.sqrt(sq(X - 7.5) + sq(Y - 7.5)), r = rHelm(Z), a = Math.atan2(Y - 7.5, X - 7.5);
      if (rho > r) return null;
      if (z <= 1) { var k = ((Math.round(a / (Math.PI / 8)) % 2) + 2) % 2; return (z === 1 && k === 0 && rho > r - 1.2) ? 'Z' : 'z'; }
      if (Z > 8.0) return 'Z';
      var f = ((a / (Math.PI / 2)) % 1 + 1) % 1;
      if (Math.abs(f - 0.5) < 0.11 + 0.05 * Z / 9) return 'Z';
      return hash3(x, y, z) < 10 ? 's' : 'S';
    });
    for (z = 0; z <= 4; z++) { var yy = Math.floor(7.5 - rHelm(z + 0.5) - 0.3); G.set(7, yy, z, 'z'); G.set(8, yy, z, 'z'); }
    return G;
  }

  // body: a steel breastplate lying face up: domed, a bright centre ridge, bronze rim, leather shoulder straps and a
  // skirt of leather fauld strips with bronze rivets.
  function mBody() {
    var M = ['...##....##...', '..####..####..', '.#####..#####.', '.############.', '..##########..', '..##########..',
             '..##########..', '..##########..', '...########...', '...########...', '...########...', '..##########..',
             '..##########..', '..##########..'];
    var G = grid(14, 14, 4), x, y, z;
    function on(x, y) { return y >= 0 && y < M.length && x >= 0 && x < 14 && M[y].charAt(x) === '#'; }
    for (y = 0; y < 14; y++) for (x = 0; x < 14; x++) {
      if (!on(x, y)) continue;
      var leather = y === 0 || y >= 12;
      var h = leather ? 0 : (y <= 2 ? 1 : Math.round(2.4 * (1 - sq((x - 6.5) / 6.5))));
      var edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
      for (z = 0; z <= h; z++) {
        var c;
        if (leather) c = (y >= 12 && x % 3 === 1) ? 'X' : 'l';
        else if (z < h) c = 'S';
        else if (y === 11 && x % 3 === 0) c = 'Z';
        else if (edge) c = 'z';
        else if (x === 6 || x === 7) c = 's';
        else c = hash3(x, y, 9) < 10 ? 's' : 'S';
        G.set(x, y, z, c);
      }
    }
    return G;
  }

  // cloak: a woad wool cloak dropped in a soft heap: fold ridges light / valleys dark, a pale ochre hem (the watch
  // colours, like cloth.banner), a bronze brooch with a madder-red stone on top.
  function mCloak() {
    var G = grid(16, 14, 6), i, j;
    G.each(function (X, Y, Z, x, y, z) {
      var e = sq((X - 8) / 7.6) + sq((Y - 7) / 6.4);
      if (e > 1 - hash3(x, y, 5) / 100 * 0.18) return null;
      var fold = Math.sin(X * 0.95 + Y * 0.45);
      var h = Math.max(0.9, 0.6 + 3.1 * Math.exp(-(sq(X - 7.5) / 22 + sq(Y - 6.5) / 14)) + 0.7 * fold);
      if (Z > h) return null;
      if (e > 0.78) return 'C';
      return fold > 0.45 ? 'q' : fold < -0.45 ? 'O' : 'o';
    });
    var bz = Math.max(G.top(8, 6), G.top(7, 6), G.top(9, 6), G.top(8, 5), G.top(8, 7)) + 1;
    for (j = 5; j <= 7; j++) for (i = 7; i <= 9; i++) G.set(i, j, bz, (i === 8 && j === 6) ? 'a' : 'Z');
    return G;
  }

  // hands: a pair of leather gloves lying flat (alternate finger heights = finger seams), dark cuffs with a bronze stud.
  function mGloves() {
    var GL = ['..#....', '.###...', '.####..', '#####..', '#####..', '#####.#', '######.', '######.', '.####..',
              '.#####.', '.#####.', '.#####.', '.#####.'];
    var G = grid(17, 17, 2);
    function glove(ox, oy, mirror) {
      for (var y = 0; y < GL.length; y++) for (var x = 0; x < 7; x++) {
        if (GL[y].charAt(x) !== '#') continue;
        var gx = ox + (mirror ? 6 - x : x), gy = oy + y;
        if (y <= 4) { G.set(gx, gy, 0, 'x'); if (x % 2 === 1) G.set(gx, gy, 1, 'x'); }
        else if (y <= 8) { G.set(gx, gy, 0, 'x'); if (x >= 1 && x <= 4) G.set(gx, gy, 1, x === 1 || x === 4 ? 'X' : 'x'); }
        else { G.set(gx, gy, 0, 'l'); G.set(gx, gy, 1, y === 9 ? 'X' : (y === 11 && x === 3 ? 'Z' : 'l')); }
      }
    }
    glove(1, 1, false); glove(9, 3, true);
    return G;
  }

  // belt: a leather belt lying in a loose loop, lighter tooled middle, bronze buckle with a prong, tail with holes.
  function mBelt() {
    var G = grid(18, 12, 2), x, y;
    G.each(function (X, Y, Z, x, y, z) {
      if (z > 0) return null;
      var e = sq((X - 7.5) / 7.2) + sq((Y - 6) / 5.2);
      if (e < 0.58 || e > 1.0) return null;
      if (X > 12.4 && Y > 3.4 && Y < 8.6) return null;
      return (e > 0.9 || e < 0.66) ? 'l' : 'x';
    });
    for (x = 13; x <= 17; x++) for (y = 5; y <= 7; y++) G.set(x, y, 0, (y === 6 && (x === 15 || x === 17)) ? 'X' : 'x');
    for (x = 12; x <= 15; x++) for (y = 4; y <= 8; y++) {
      if (x === 12 || x === 15 || y === 4 || y === 8) { G.set(x, y, 0, 'z'); G.set(x, y, 1, 'Z'); }
    }
    G.set(13, 6, 1, 'z'); G.set(14, 6, 1, 'z');
    return G;
  }

  // legs: wool trousers laid flat: dark waistband with a drawstring, two tapering legs, leather knee patches, dark cuffs.
  function mLegs() {
    var G = grid(14, 20, 3), x, y, z;
    function on(x, y) {
      if (y < 0 || y > 19 || x < 0 || x > 13) return false;
      if (y <= 6) return x >= 1 && x <= 12;
      var t = (y - 7) / 12, l0 = 1 + Math.round(t * 1.2), l1 = 5 - Math.round(t * 0.6);
      return (x >= l0 && x <= l1) || (x >= 13 - l1 && x <= 13 - l0);
    }
    for (y = 0; y <= 19; y++) for (x = 0; x <= 13; x++) {
      if (!on(x, y)) continue;
      var inner = on(x - 1, y) && on(x + 1, y);
      var c = y <= 1 || y === 19 ? 'X' : (y >= 11 && y <= 13 && inner && y > 6) ? 'l' : ((y === 5 || y === 6) && (x === 6 || x === 7)) ? 'X' : (hash3(x, y, 2) < 15 ? 'X' : 'x');
      for (z = 0; z <= (inner ? 1 : 0); z++) G.set(x, y, z, z === 0 && c === 'l' ? 'x' : c);
    }
    G.set(6, 0, 2, 'r'); G.set(7, 0, 2, 'r'); G.set(5, 1, 2, 'r'); G.set(8, 2, 1, 'r');
    return G;
  }

  // feet: a pair of tall leather boots standing side by side: dark soles, rounded toes, laced instep and shaft front,
  // turned-down lighter cuffs, the dark opening at the top.
  function mBoots() {
    var G = grid(14, 12, 11);
    function boot(ox, oy) {
      for (var z = 0; z <= 9; z++) for (var y = 0; y <= 10; y++) for (var x = 0; x <= 4; x++) {
        var shaft = y >= 6, top = shaft ? 9 : (y <= 1 ? 2 : 3);
        if (z > top) continue;
        if (y === 0 && (x === 0 || x === 4 || z >= 2)) continue;           // rounded toe
        if (y === 10 && (x === 0 || x === 4)) continue;                       // rounded heel
        var inside = shaft && x >= 1 && x <= 3 && y >= 7 && y <= 9;
        if (inside && z >= 9) continue;                                       // the opening
        var c;
        if (z === 0) c = 'X';
        else if (inside && z === 8) c = 'X';
        else if (shaft && z >= 8) c = 'x';                                    // turned-down cuff
        else if ((shaft && y === 6 && x === 2 && z >= 3 && z <= 7) || (!shaft && z === 3 && x === 2 && y >= 3)) c = 'r';
        else c = hash3(x + ox, y + oy, z) < 12 ? 'x' : 'l';
        G.set(ox + x, oy + y, z, c);
      }
    }
    boot(1, 0); boot(8, 1);
    return G;
  }

  // main: a ruin-steel sword lying flat: pale steel edges, dark fuller, bronze crossguard, leather grip with a wrap,
  // bronze pommel (style guide 2: old-world metal, never brass).
  function mSword() {
    var G = grid(31, 7, 3), x, y;
    for (x = 0; x <= 21; x++) {
      var hw = x === 0 ? 0 : 1;
      for (y = 3 - hw; y <= 3 + hw; y++) G.set(x, y, 0, y === 3 ? 'S' : 's');
      if (x >= 2) G.set(x, 3, 1, (x >= 5 && x <= 19) ? 'd' : 'S');
    }
    for (x = 22; x <= 23; x++) for (y = 0; y <= 6; y++) { G.set(x, y, 0, 'z'); G.set(x, y, 1, (y === 0 || y === 6) ? 'Z' : 'z'); }
    for (x = 24; x <= 28; x++) { for (y = 2; y <= 4; y++) G.set(x, y, 0, 'l'); G.set(x, 3, 1, x % 2 ? 'x' : 'l'); }
    for (x = 29; x <= 30; x++) { for (y = 2; y <= 4; y++) { G.set(x, y, 0, 'Z'); G.set(x, y, 1, 'Z'); } G.set(x, 3, 2, 'Z'); }
    return G;
  }

  // off: a round wooden shield lying face up: quartered woad / pale ochre paint (watch colours) worn through to the
  // planks here and there, plank seams, iron rim with 12 rivets, domed iron boss.
  function mShield() {
    var G = grid(21, 21, 5);
    G.each(function (X, Y, Z, x, y, z) {
      var dx = X - 10.5, dy = Y - 10.5, rho = Math.sqrt(dx * dx + dy * dy);
      if (rho > 10.3) return null;
      if (z === 0) return rho > 9.2 ? 'd' : 't';
      if (z === 1) {
        if (rho > 9.2) { var a = Math.atan2(dy, dx), k = Math.round(a / (Math.PI / 6)); return Math.abs(a - k * Math.PI / 6) * rho < 0.6 ? 'i' : 'd'; }
        if (rho < 3.6) return 'S';
        if (hash3(x, y, 4) < 9) return 'w';
        if (x % 4 === 0) return dx * dy > 0 ? 'O' : 'k';
        return dx * dy > 0 ? 'o' : 'C';
      }
      if (Math.sqrt(dx * dx + dy * dy + sq((Z - 1.4) * 1.1)) > 3.3) return null;
      return Z > 3.0 ? 'i' : 'S';
    });
    return G;
  }

  // ranged: a recurve hunting bow lying flat: wood limbs thickening to a leather-wrapped grip, pale nocks, linen string.
  function mBow() {
    var G = grid(34, 9, 2), i, x;
    for (i = 0; i <= 400; i++) {
      var t = i / 200 - 1, at = Math.abs(t);
      var X = 16.5 + 16 * t, Y = 1.6 + 6.3 * (1 - t * t) - (at > 0.85 ? 1.2 * (at - 0.85) / 0.15 : 0);
      var gx = Math.floor(X), gy = Math.floor(Y), grip = at < 0.13;
      G.set(gx, gy, 0, at > 0.96 ? 'W' : grip ? 'l' : 'w');
      if (at < 0.55) G.set(gx, gy + 1, 0, grip ? 'l' : 'w');
      if (grip) G.set(gx, gy, 1, i % 6 < 3 ? 'x' : 'l');
    }
    for (x = 1; x <= 31; x++) if (G.get(x, 0, 0) === '.') G.set(x, 0, 0, 'n');
    return G;
  }

  // ================================ POTIONS ================================
  // a round glass flask standing up: coloured liquid fills the belly (deep at the bottom), clear glass shoulders,
  // a bright streak on the glass, twine round the neck, a lip, a cork.
  function mPotion(liq, deep) {
    var G = grid(9, 9, 13);
    G.each(function (X, Y, Z, x, y, z) {
      var dx = X - 4.5, dy = Y - 4.5, rho = Math.sqrt(dx * dx + dy * dy);
      if (z < 8) {
        var d = Math.sqrt(rho * rho + sq((Z - 3.9) * 1.05));
        if (d > 3.95) return null;
        if (dx < -1.2 && dy < -0.8 && Z > 2.5 && Z < 6.5 && d > 3.0) return 's';
        if (z >= 6) return d > 3.0 ? 'M' : null;
        return z === 0 ? deep : liq;
      }
      if (z <= 9) return z === 8 && rho <= 1.8 ? 'r' : (rho <= 1.3 ? 'M' : null);
      if (z === 10) return rho <= 1.8 ? 'M' : null;
      return rho <= 1.2 ? (z === 12 ? 'W' : 'w') : null;
    });
    return G;
  }

  // ================================= LAMP =================================
  // floorLanternVox: the spare Kestrel brass lamp standing on the floor (same design as the floorLantern sprite): wide
  // dark foot, brass font with a bright band, cage of 4 diagonal brass posts round glowing glass (ember_glow, emissive)
  // with a white-hot flame core, brass cap, hot finial, iron bail. Cold variant: dark glass and a black wick.
  function mLamp(lit) {
    var G = grid(9, 9, 16);
    G.each(function (X, Y, Z, x, y, z) {
      var dx = X - 4.5, dy = Y - 4.5, rho = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      if (z === 0) return rho <= 4.1 ? 'D' : null;
      if (z === 1) return rho <= 3.4 ? 'b' : null;
      if (z <= 4) return rho <= 3.0 ? (z === 3 ? 'B' : 'D') : null;
      if (z === 5 || z === 12) return rho <= 3.4 ? 'B' : null;
      if (z <= 11) {
        if (rho > 3.4) return null;
        var f = ((a / (Math.PI / 2)) % 1 + 1) % 1;
        if (rho > 2.3 && Math.abs(f - 0.5) < 0.16) return 'b';
        if (!lit) return rho <= 0.8 && z <= 7 ? 'X' : 'M';
        return (rho <= 1.2 && z >= 7 && z <= 9) ? 'e' : (rho <= 1.0 && z === 10) ? 'T' : 'g';
      }
      if (z === 13) return rho <= 2.4 ? 'B' : null;
      if (z === 14) return rho <= 1.3 ? 'H' : null;
      return null;
    });
    G.set(3, 4, 15, 'd'); G.set(4, 4, 15, 'd'); G.set(5, 4, 15, 'd');
    return G;
  }

  // ================================ RECORDS ================================
  function record(id, G, cellM, desc, clips, extra) {
    var layers = G.layers(), mats = {}, sx = G.sx, sy = G.sy, sz = G.sz, z, y, j, ch;
    for (z = 0; z < layers.length; z++) for (y = 0; y < layers[z].length; y++) for (j = 0; j < layers[z][y].length; j++) {
      ch = layers[z][y].charAt(j);
      if (ch !== '.') mats[ch] = MAT[ch];
    }
    var anims = {};
    (clips || ['idle']).forEach(function (k) { anims[k] = { durations: [1000], loop: true, frames: [{}] }; });
    var rec = {
      name: id, desc: desc,
      voxel: {
        version: 1, cellM: cellM, size: [sx, sy, sz], anchor: [sx / 2, sy / 2, 0], meshOnly: true,
        mats: mats, layers: layers,
        parts: { body: { box: [0, 0, 0, sx, sy, sz], pivot: [sx / 2, sy / 2, 0] } },
        animations: anims,
        mounts: { prompt: { at: [sx / 2, sy / 2, sz + 3], part: 'body' } }
      },
      world: { w: +(sx * cellM).toFixed(3), d: +(sy * cellM).toFixed(3), h: +(sz * cellM).toFixed(3) }
    };
    if (extra) for (var k in extra) rec[k] = extra[k];
    return rec;
  }

  var DEFS = [
    ['pickup.signArm', mSignArm, 0.030, 'Broken fingerpost arm lying flat (0.66 m): planks, pointed end, splintered break, faded black lettering, nails.'],
    ['pickup.packet', mPacket, 0.030, 'Oilcloth parcel (0.30 x 0.24 m) tied both ways with string, knot on top, pale fold creases.'],
    ['pickup.barleySheaf', mSheaf, 0.025, 'Barley sheaf lying on its side (0.60 m): straight stalks, cut ends, rope tie, fanned pale ears.'],
    ['pickup.berry.blue', mBerry, 0.025, 'Blue-berry sprig on the ground (0.35 m): dark twig, three leaves, 8 round blue berries with a pale bloom on top.'],
    ['pickup.brass.scrap', mScrap, 0.030, 'Bent brass scrap: two torn plates, one bent up 45 deg, proud rivets, a curled strip.'],
    ['pickup.emberpod', mEmberpod, 0.025, 'Ember pod lying on its side (0.30 m): dark husk split by 6 spiral seams glowing ember orange, white-hot centre.'],
    ['pickup.redcap', mRedcap, 0.025, 'Two red-capped mushrooms with white flecks and pale gills on a moss pad (cap 0.2 m).'],
    ['pickup.relay.brass', mRelayBrass, 0.025, 'Brass relay fitting: heavy ring with 4 hot bolt heads and a threaded pipe stub.'],
    ['pickup.relay.mirror', mRelayMirror, 0.025, 'Small round relay mirror (0.27 m) in a brass frame, propped up on a back strut, bright streak on the glass.'],
    ['pickup.potion.hp', function () { return mPotion('R', 'Q'); }, 0.020, 'Healing draught: round glass flask, red liquid in the belly, clear shoulders, twine, cork (0.26 m).'],
    ['pickup.potion.mp', function () { return mPotion('o', 'O'); }, 0.020, 'Mana draught: round glass flask, blue liquid in the belly, clear shoulders, twine, cork (0.26 m).'],
    ['pickup.gear.head', mHelm, 0.020, 'Head gear: old nasal spangenhelm on its rim, steel dome, bronze strips, rivets, knob.'],
    ['pickup.gear.body', mBody, 0.030, 'Body gear: steel breastplate lying face up, bright ridge, bronze rim, leather straps and fauld strips.'],
    ['pickup.gear.cloak', mCloak, 0.030, 'Cloak: woad wool in a soft heap, pale ochre hem, bronze brooch with a madder-red stone.'],
    ['pickup.gear.hands', mGloves, 0.025, 'Hands gear: a pair of leather gloves lying flat, finger seams, dark cuffs, bronze stud.'],
    ['pickup.gear.belt', mBelt, 0.030, 'Belt: leather belt in a loose loop, bronze buckle with prong, tail with holes.'],
    ['pickup.gear.legs', mLegs, 0.030, 'Legs gear: wool trousers laid flat, waistband + drawstring, leather knee patches, dark cuffs.'],
    ['pickup.gear.feet', mBoots, 0.025, 'Feet gear: a pair of tall leather boots standing, laced, turned-down cuffs, dark soles.'],
    ['pickup.gear.main', mSword, 0.026, 'Main weapon: ruin-steel sword lying flat (0.8 m), dark fuller, bronze guard + pommel, leather grip.'],
    ['pickup.gear.off', mShield, 0.030, 'Off hand: round wooden shield face up (0.63 m), quartered woad / ochre, iron rim + rivets + boss.'],
    ['pickup.gear.ranged', mBow, 0.035, 'Ranged weapon: recurve bow lying flat (1.2 m), leather grip, pale nocks, linen string.']
  ];

  var ids = [], i;
  for (i = 0; i < DEFS.length; i++) {
    var rec = record(DEFS[i][0], DEFS[i][1](), DEFS[i][2], DEFS[i][3]);
    A.voxelModels[DEFS[i][0]] = rec; A.models[DEFS[i][0]] = rec; ids.push(DEFS[i][0]);
  }
  var LAMP_EXTRA = { colliders: [{ type: 'prism', c: [0, 0, 0.2], r: 0.12, h: 0.4 }], light: 'lanternFloor',
                     lightAt: [4.5, 4.5, 8.5], note: 'light = palette.lights.lanternFloor at mounts.light (voxel z 8.5 = 0.21 m)' };
  [['floorLanternVox', true, 'Brass floor lamp, LIT (0.40 m): glowing glass cage (ember_glow, emissive), white-hot flame core, brass cap, iron bail.'],
   ['floorLanternVoxCold', false, 'Brass floor lamp, cold: same lamp with dark glass and a black wick.']].forEach(function (L) {
    var r = record(L[0], mLamp(L[1]), 0.025, L[2], ['lit', 'unlit', 'idle'], LAMP_EXTRA);
    r.voxel.mounts.light = { at: [4.5, 4.5, 8.5], part: 'body' };
    A.voxelModels[L[0]] = r; A.models[L[0]] = r; ids.push(L[0]);
  });

  // ============================ ITEM -> MODEL MAP ============================
  var ITEM = {
    signArm: 'pickup.signArm', packet: 'pickup.packet', barleySheaf: 'pickup.barleySheaf', 'berry.blue': 'pickup.berry.blue',
    'brass.scrap': 'pickup.brass.scrap', emberpod: 'pickup.emberpod', redcap: 'pickup.redcap', redCap: 'pickup.redcap',
    'relay.brass': 'pickup.relay.brass', 'relay.mirror': 'pickup.relay.mirror',
    'potion.hp': 'pickup.potion.hp', 'potion.mp': 'pickup.potion.mp', hp: 'pickup.potion.hp', mp: 'pickup.potion.mp'
  };
  var SLOT = { head: 1, body: 1, cloak: 1, hands: 1, belt: 1, legs: 1, feet: 1, main: 1, off: 1, ranged: 1 };
  var SLOT_ALIAS = { helm: 'head', helmet: 'head', chest: 'body', torso: 'body', armor: 'body', armour: 'body', cape: 'cloak',
                     gloves: 'hands', hand: 'hands', waist: 'belt', leggings: 'legs', boots: 'feet', foot: 'feet',
                     weapon: 'main', mainhand: 'main', sword: 'main', offhand: 'off', shield: 'off', bow: 'ranged' };
  function pickupModelFor(itemId, slot) {
    if (itemId != null && ITEM[itemId]) return ITEM[itemId];
    var s = slot == null ? null : (SLOT[slot] ? slot : SLOT_ALIAS[slot]);
    if (s) return 'pickup.gear.' + s;
    return null;   // unknown: caller keeps its fallback
  }
  var slotModel = {};
  for (var s in SLOT) slotModel[s] = 'pickup.gear.' + s;

  function validate() {
    var errs = [], P = A.palette && A.palette.materials, k, id, v, z, y;
    for (k = 0; k < ids.length; k++) {
      id = ids[k]; v = A.voxelModels[id].voxel;
      if (v.layers.length !== v.size[2]) errs.push(id + ': layers ' + v.layers.length + ' != sz ' + v.size[2]);
      for (z = 0; z < v.layers.length; z++) {
        if (v.layers[z].length !== v.size[1]) errs.push(id + ': z' + z + ' rows ' + v.layers[z].length);
        for (y = 0; y < v.layers[z].length; y++) if (v.layers[z][y].length !== v.size[0]) errs.push(id + ': z' + z + ' y' + y + ' len');
      }
      for (var ch in v.mats) {
        if (!v.mats[ch]) errs.push(id + ': char "' + ch + '" has no material');
        else if (P && !P[v.mats[ch]]) errs.push(id + ': material "' + v.mats[ch] + '" not in palette.materials');
      }
    }
    for (k in ITEM) if (!A.voxelModels[ITEM[k]]) errs.push('item ' + k + ' -> missing ' + ITEM[k]);
    return errs;
  }

  A.pickupsVoxel = {
    note: 'OB-132 / OB-137 voxel pickups. Gear: one model per equip slot for every tier (tint by tier: none yet). ' +
          'Turning = entity yaw. A "take me" glint / bob stays an engine effect (style guide 2: glint every 2-3 s).',
    ids: ids, itemModel: ITEM, slotModel: slotModel, slotAlias: SLOT_ALIAS,
    pickupModelFor: pickupModelFor,
    spriteReplace: { pickupGear: 'pickup.gear.<slot> via pickupModelFor(item, slot)', pickupRedCap: 'pickup.redcap',
                     berrySprig: 'pickup.berry.blue', floorLantern: 'floorLanternVox' },
    validate: validate
  };

  if (typeof module === 'object' && module && module.exports) module.exports = A.pickupsVoxel;
})(typeof window !== 'undefined' ? window : globalThis);
