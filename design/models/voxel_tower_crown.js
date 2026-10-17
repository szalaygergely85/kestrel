/*
 * Kestrel - TOWER CROWN voxel model (CH1-D1b part 2, D-062, architecture.md 38.37 item 2 (b)).
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef), same builder style as voxel_tower.js (deterministic
 * integer hash, no Math.random, plain layer strings at load). Preview: design/preview/tower-crown.html.
 *
 * WHAT IT IS
 *   The broken crown of the Hollow Watchtower, seen from the meadow above the 12-14 m sector walls (layer (a) of 38.37
 *   item 2, another designer's level rework). A round corbelled parapet ring: a stub course that sinks into the wall
 *   tops, a projecting string course on 38 dark corbels (machicolation), 19 merlons with crenels and arrow slits on
 *   top. Jagged, crumbled in 0.5 m masonry blocks; the WEST side (where the Kestrel came through) is broken down to the
 *   string course, with loose blocks on it, and ONE broken merlon tooth still standing at the north-west. The
 *   Kestrel's torn envelope is SNAGGED on that tooth: a red / ochre gored canvas sheet tented over it, hanging 2-5 m
 *   down the outer north-west face in vertical folds, billowed by the wind, torn hem with burnt edges, two long torn
 *   streamers, a short flap inside; 7 ropes (suspension lines) hang from it, one loops along the parapet to the north,
 *   one hangs inside the tower from the tooth (seen from the summit / interior looking up).
 *
 * MATERIALS: existing palette.materials + detailPass.materials only (no new keys): stone, stone_moss, stone_ivy (= the
 *   sector wall mats, so the crown continues the walls), block_light (lit top rims), block_dark (corbels), moss_top,
 *   granite_light / granite_dark (loose blocks), balloon* / balloon_red* (v1.39 fabric), canvas_burnt, rope.
 *
 * GRID: 56 x 52 x 36 @ 0.25 m = 14.0 x 13.0 x 9.0 m. Axes 15.1: x = east, y = SOUTH (y0 = north row), z = up.
 *   Anchor [30, 26, 20] = the ring centre at the crown BASE (top of the stub course = the string-course underside).
 *   Below the anchor: the 0.75 m stub + corbels and the hanging canvas / ropes (down to 5.0 m below the base).
 *   Above: string course 0.5 m, parapet to 2.6 m, tooth to 2.9 m, canvas tent to ~3.1 m.
 *
 * PLACEMENT (38.37 item 2 (b)): one world entity, no collider (unreachable), castShadow true (one caster).
 *   Tower level origin = world (1480, 1018, 0). The ring centre is level (17.0, 7.0) (wall ring x 11..23, y 1..13),
 *   so the entity goes to world (1497.0, 1025.0), yawDeg 0, z = 12.0 (absolute; the crown base). See `.placement`.
 *   Wall tops it expects: 12.0-12.5 m under the N / E / S ring, 11.0-12.0 m on the west (the stub course hides any
 *   gap down to 11.25 m); cells taller than 12.5 m poke through the ring as extra broken masonry.
 *
 * REGISTRATION: sets ASSETS.voxelModels.towerCrown and, when every material key is merged, ASSETS.models.towerCrown
 *   (the registry key for components.voxel.model 'towerCrown', like voxel_world.js does for the waystone).
 *   LOAD ORDER: after palette.js + detail-pass.js (needs no other model file).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.models = A.models || {};

  // ===================================================================================================================
  // 0. HELPERS (copy of voxel_tower.js section 0, trimmed)
  // ===================================================================================================================
  function hash(x, y, z, s) {
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) +
             Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }
  function Grid(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz; this.a = [];
    for (var i = 0; i < sx * sy * sz; i++) this.a.push('.');
  }
  Grid.prototype.inb = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; };
  Grid.prototype.get = function (x, y, z) { return this.inb(x, y, z) ? this.a[x + this.sx * (y + this.sy * z)] : '.'; };
  Grid.prototype.set = function (x, y, z, c) { if (this.inb(x, y, z)) this.a[x + this.sx * (y + this.sy * z)] = c; };
  Grid.prototype.full = function (x, y, z) { return this.get(x, y, z) !== '.'; };
  Grid.prototype.exposed = function (x, y, z) {
    return !this.full(x + 1, y, z) || !this.full(x - 1, y, z) || !this.full(x, y + 1, z) || !this.full(x, y - 1, z) ||
           !this.full(x, y, z + 1) || !this.full(x, y, z - 1);
  };
  Grid.prototype.each = function (fn) {
    for (var z = 0; z < this.sz; z++) for (var y = 0; y < this.sy; y++) for (var x = 0; x < this.sx; x++) {
      if (this.full(x, y, z)) fn(x, y, z, this.get(x, y, z));
    }
  };
  Grid.prototype.layers = function () {
    var L = [], z, y, x, rows, row;
    for (z = 0; z < this.sz; z++) {
      rows = [];
      for (y = 0; y < this.sy; y++) { row = ''; for (x = 0; x < this.sx; x++) row += this.a[x + this.sx * (y + this.sy * z)]; rows.push(row); }
      L.push(rows);
    }
    return L;
  };

  var KEY = {
    S: 'stone', s: 'stone_moss', i: 'stone_ivy', T: 'block_light', D: 'block_dark', m: 'moss_top',
    g: 'granite_dark', L: 'granite_light',
    A: 'balloon_light', a: 'balloon', n: 'balloon_dark', F: 'balloon_red_light', f: 'balloon_red', h: 'balloon_red_dark',
    z: 'canvas_burnt', r: 'rope'
  };
  var STONE = { S: 1, s: 1, i: 1, T: 1, D: 1, m: 1, g: 1, L: 1 };

  // ===================================================================================================================
  // 1. DIMENSIONS (metres unless named V*). Tune here; everything below derives from these.
  // ===================================================================================================================
  var CELL = 0.25, SX = 56, SY = 52, SZ = 36, CX = 30, CY = 26, ZB = 20;   // anchor = (CX, CY, ZB) in voxels
  var D2R = Math.PI / 180;
  var R_IN = 4.9;          // inner face of the ring (the tower's inner wall line)
  var R_WALL = 6.0;        // outer face of the sector walls = outer face of the stub course
  var R_BAND = 6.3;        // string course overhang (one voxel proud of the wall)
  var R_PAR = 5.15;        // parapet inner face (a 0.25 m ledge = the old wall-walk lip on the string course)
  var SKIRT = 0.75;        // stub course depth below the base (sinks into / hides the wall tops)
  var BAND = 0.5;          // string course height
  var MERLON = 2.6;        // intact merlon top
  var SILL = 1.4;          // crenel sill
  var EAST_TOP = 2.6;      // cap over the east (sun-side) arc |th| < 40: lower it if the interior sun shaft is lost
  var N_MERLON = 19, N_CORBEL = 38;
  var TOOTH = -148;        // the surviving merlon tooth (NW) the envelope is snagged on; th: 0 east, -90 north, +-180 west
  var SNAG0 = -176, SNAG1 = -112;    // canvas arc (deg)
  var R_CLOTH = 6.45;

  function westDist(th) { return 180 - Math.abs(th); }
  function chunkOf(th) { return Math.floor((th + 180) * D2R * R_WALL / 0.5); }    // 0.5 m masonry blocks round the ring

  // parapet top above the base, metres (column noise added by the caller)
  function crownTop(th) {
    var per = 360 / N_MERLON, u = (th + 180) / per, idx = Math.floor(u), f = u - idx, top;
    var wd = westDist(th), ch = chunkOf(th), j = hash(ch, 0, 0, 511);
    if (f > 0.62) top = SILL;                                                   // crenel
    else {
      var hb = hash(idx, 0, 0, 501);
      top = MERLON - (hb < 0.22 ? 0.75 + 0.75 * hash(idx, 1, 0, 502) : 0.25 * Math.floor(hash(idx, 2, 0, 503) * 2));
      top = Math.max(top, SILL - 0.25);
    }
    if (wd < 34) {                                                              // the west: down to the string course
      top = (wd < 9 && j < 0.55) ? 0 : BAND + (j < 0.3 ? 0.25 + 0.25 * Math.floor(hash(ch, 1, 0, 512) * 2) : 0);
    } else if (wd < 78) {                                                       // crumbling up to full height, stepped
      var t = (wd - 34) / 44;
      top = Math.min(top, BAND + t * (MERLON - BAND) + (j - 0.5) * 0.9);
    } else if (j < 0.08) top -= 0.5;                                            // an odd chipped block
    if (Math.abs(th) < 40) top = Math.min(top, EAST_TOP);
    var td = Math.abs(th - TOOTH);
    if (td < 3.4) top = Math.max(top, 2.9 - (td / 3.4) * 0.8);                  // the tooth, tapering
    return top;
  }
  function slitAt(th, h) {                                                      // arrow slit through every 3rd merlon
    var per = 360 / N_MERLON, u = (th + 180) / per, idx = Math.floor(u), f = u - idx;
    return idx % 3 === 1 && Math.abs(f - 0.31) < 0.06 && h > 1.5 && h < 2.15 && westDist(th) > 70;
  }
  function corbelAt(th) { var u = (th + 180) / (360 / N_CORBEL); return (u - Math.floor(u)) < 0.45; }

  // ===================================================================================================================
  // 2. BUILD
  // ===================================================================================================================
  function vx(m) { return Math.floor(CX + m / CELL); }
  function vy(m) { return Math.floor(CY + m / CELL); }
  function vz(h) { return Math.floor(ZB + h / CELL); }

  function buildCrown() {
    var G = new Grid(SX, SY, SZ), x, y, z;
    // 2a. masonry
    for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      var mx = (x + 0.5 - CX) * CELL, my = (y + 0.5 - CY) * CELL, r = Math.sqrt(mx * mx + my * my);
      if (r < R_IN || r > R_BAND) continue;
      var th = Math.atan2(my, mx) / D2R, top = crownTop(th), wd = westDist(th);
      if (top > BAND && hash(x, y, 0, 520) < 0.18) top -= CELL;                 // crumbled column tops
      var bandGone = top <= 0;
      var stubTop = bandGone ? (hash(x, y, 1, 521) < 0.5 ? -CELL : 0) : 0;
      for (z = 0; z < SZ; z++) {
        var h = (z + 0.5 - ZB) * CELL, c = null;
        if (h >= -SKIRT && h < stubTop && r <= R_WALL) c = 'S';                                  // stub course
        else if (h >= -0.5 && h < 0 && r > R_WALL && !bandGone && wd > 9 && corbelAt(th)) c = 'D'; // corbels
        else if (h >= 0 && h < BAND && !bandGone) c = 'S';                                       // string course
        else if (h >= BAND && h < top && r >= R_PAR && !slitAt(th, h)) c = 'S';                  // parapet
        if (c) G.set(x, y, z, c);
      }
    }
    // 2b. loose blocks on the broken west string course (2 x 2 x 1-2 voxels)
    for (var ch = 0; ch < 80; ch++) {
      var thc = (ch + 0.5) * 0.5 / R_WALL / D2R - 180;
      if (westDist(thc) > 40 || hash(ch, 0, 0, 530) > 0.45) continue;
      var rr = R_PAR + 0.2 + 0.5 * hash(ch, 1, 0, 531);
      var bx = vx(rr * Math.cos(thc * D2R)), by = vy(rr * Math.sin(thc * D2R)), bz = vz(BAND), tall = hash(ch, 2, 0, 532) < 0.35 ? 2 : 1;
      while (G.full(bx, by, bz) && bz < SZ - 3) bz++;
      for (var k = 0; k < 4; k++) for (var t = 0; t < tall; t++) G.set(bx + (k & 1), by + (k >> 1), bz + t, t === tall - 1 ? 'L' : 'g');
    }
    // 2c. surface materials on the masonry
    G.each(function (x, y, z, c) {
      if (c !== 'S') return;
      var mx = (x + 0.5 - CX) * CELL, my = (y + 0.5 - CY) * CELL, r = Math.sqrt(mx * mx + my * my);
      var th = Math.atan2(my, mx) / D2R, h = (z + 0.5 - ZB) * CELL, north = th < -25 && th > -155;
      if (!G.full(x, y, z + 1)) {                                               // lit top rim, moss on the north tops
        G.set(x, y, z, hash(x, y, z, 540) < (north ? 0.5 : 0.22) ? 'm' : 'T');
        return;
      }
      var outer = r > R_WALL - 0.35 && G.exposed(x, y, z);
      if (!outer) return;
      if (th > 95 && westDist(th) < 85 && h < 1.4 && hash(x >> 1, y >> 1, z >> 2, 541) < 0.55 - h * 0.25) G.set(x, y, z, 'i'); // ivy (SW)
      else if (north && h < 0.9 && hash(x, y, z, 542) < 0.4) G.set(x, y, z, 's');                                      // moss (N)
    });

    // 2d. the snagged envelope
    var LEN = (SNAG1 - SNAG0) * D2R * R_CLOTH;
    function cs(a) { return (a - SNAG0) * D2R * R_CLOTH; }                      // arc metres along the sheet
    function clothTop(a) {
      var dT = Math.abs(a - TOOTH) * D2R * R_WALL;
      var under = Math.max(crownTop(a - 2), crownTop(a), crownTop(a + 2)) + CELL;   // drapes OVER any stone it crosses
      return Math.max(3.15 - 0.95 * dT, BAND + 0.3 + 0.18 * Math.sin(cs(a) * 2.3), under);
    }
    function hem(a) {
      var s = cs(a), L = 2.4 + 1.1 * Math.sin(2 * Math.PI * s / 3.1 + 1.3) + 0.6 * hash(Math.floor(s / 0.5), 0, 0, 550);
      L += 2.0 * Math.exp(-Math.pow((s - 1.6) / 0.28, 2)) + 1.6 * Math.exp(-Math.pow((s - 5.3) / 0.25, 2));   // streamers
      var e = Math.min(1, Math.min(s, LEN - s) / 1.2);
      L *= 0.3 + 0.7 * e;
      return Math.min(L, clothTop(a) + ZB * CELL - CELL);                       // stay inside the grid
    }
    function foldPhase(s, d) { return Math.sin(2 * Math.PI * s / 0.95 + 0.4 * d); }
    function rOut(s, d, L) { return R_CLOTH + (0.08 + 0.1 * d) * foldPhase(s, d) + 0.25 * Math.sin(Math.PI * Math.min(1, d / Math.max(L, 0.5))); }
    function clothChar(s, d, edge) {
      var red = Math.floor(s / 0.85) % 2 === 1, p = foldPhase(s, d);
      if (edge === 'hem') return hash(Math.floor(s * 8), 0, 0, 551) < 0.55 ? 'z' : (red ? 'h' : 'n');
      if (edge === 'top') return (s < 0.3 || s > LEN - 0.3) ? 'z' : (red ? 'F' : 'A');
      if (edge === 'in') return red ? 'h' : 'n';
      return p > 0.45 ? (red ? 'F' : 'A') : p < -0.45 ? (red ? 'h' : 'n') : (red ? 'f' : 'a');
    }
    function put(rm, a, hz, c) { G.set(vx(rm * Math.cos(a * D2R)), vy(rm * Math.sin(a * D2R)), vz(hz), c); }
    var dA = (0.4 * CELL / R_CLOTH) / D2R, a, hemPts = [];
    for (a = SNAG0; a <= SNAG1; a += dA) {
      var s = cs(a), top = clothTop(a), L = Math.max(CELL, hem(a) - 0.5 * hash(Math.floor(s / CELL), 0, 0, 552)), zt = vz(top), zb = vz(top - L);
      var rr, prevR = R_CLOTH;
      for (rr = R_IN - 0.2; rr <= R_CLOTH; rr += CELL * 0.5) put(rr, a, top, clothChar(s, 0, 'top'));       // over the wall top
      var flap = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(s * 1.7));
      for (var hf = top - CELL; hf > top - flap; hf -= CELL) put(R_IN - 0.2, a, hf, clothChar(s, 0, 'in')); // inner flap
      for (z = zt; z >= zb; z--) {                                              // the outer drape
        var d = (zt - z) * CELL, ro = rOut(s, d, L), hz = (z + 0.5 - ZB) * CELL;
        if (d > 1.0 && hash(Math.round(s / 0.5), Math.round(d / 0.5), 0, 553) < 0.07) { prevR = ro; continue; }   // torn holes
        var c = z === zb ? clothChar(s, d, 'hem') : clothChar(s, d, 'drape');
        var r0 = Math.min(prevR, ro), r1 = Math.max(prevR, ro);
        for (rr = r0; rr <= r1 + 1e-6; rr += CELL * 0.5) put(rr, a, hz, c);
        put(ro, a, hz, c);
        prevR = ro;
      }
      hemPts.push([a, top - L, rOut(s, L, L)]);
    }

    // 2e. ropes (suspension lines): hang = from a point straight down with outward drift + sideways sway
    function setR(xm, ym, hz) { var X = vx(xm), Y = vy(ym), Z = vz(hz); if (!G.full(X, Y, Z)) G.set(X, Y, Z, 'r'); }
    function hang(aDeg, rm, h0, len, drift, sway) {
      var ca = Math.cos(aDeg * D2R), sa = Math.sin(aDeg * D2R);
      for (var t = 0; t <= 1.0001; t += CELL * 0.4 / len) {
        var rr = rm + drift * t * t, side = sway * Math.sin(Math.PI * t), hz = h0 - len * t;
        if (hz < -ZB * CELL + 0.05) break;
        setR(rr * ca - side * sa, rr * sa + side * ca, hz);
      }
    }
    function sag(a0, h0, a1, h1, rm, dip) {                                     // rope lying along the parapet
      for (var t = 0; t <= 1.0001; t += 0.004) {
        var aa = (a0 + (a1 - a0) * t) * D2R, hz = h0 + (h1 - h0) * t - dip * 4 * t * (1 - t);
        setR(rm * Math.cos(aa), rm * Math.sin(aa), hz);
      }
    }
    function hemAt(aDeg) { var best = hemPts[0]; hemPts.forEach(function (p) { if (Math.abs(p[0] - aDeg) < Math.abs(best[0] - aDeg)) best = p; }); return best; }
    var p1 = hemAt(SNAG0 + 1), p2 = hemAt(SNAG1 - 1), p3 = hemAt(SNAG0 + 3.4 / R_CLOTH / D2R), p4 = hemAt(SNAG0 + 4.3 / R_CLOTH / D2R);
    hang(SNAG0 + 0.5, R_CLOTH + 0.1, clothTop(SNAG0), 4.6, 0.3, 0.25);           // the west edge line, long
    hang(SNAG1 - 0.5, R_CLOTH + 0.1, clothTop(SNAG1), 3.8, 0.35, -0.2);          // the north edge line
    hang(p3[0], p3[2], p3[1], Math.max(0.8, p3[1] + ZB * CELL - 0.5), 0.25, 0.15); // from the hem, to the grid floor
    hang(p4[0], p4[2], p4[1], 1.6, 0.2, -0.15);                                   // a short frayed end
    hang(TOOTH + 1.0, R_IN - 0.35, 2.4, 2.9, -0.25, 0.2);                         // looped round the tooth, hangs INSIDE
    hang(170, R_BAND + 0.15, BAND, 4.7, 0.35, 0.3);                               // trailing toward the heap below (west)
    sag(SNAG1, clothTop(SNAG1) - 0.2, -84, MERLON + 0.15, (R_PAR + R_BAND) / 2, 0.9); // a line looped along the parapet
    hang(-84, R_BAND + 0.15, MERLON, 2.8, 0.3, 0.2);                              // ... and dropping off it outside
    void p1; void p2;
    return G;
  }

  function stats(G) {
    var solid = 0, surface = 0, per = {};
    G.each(function (x, y, z, c) {
      solid++;
      if (G.exposed(x, y, z)) { surface++; per[c] = (per[c] || 0) + 1; }
    });
    return { solid: solid, surface: surface, surfaceByChar: per };
  }
  function matsOf(G) {
    var used = {}, o = {}, k;
    G.each(function (x, y, z, c) { used[c] = 1; });
    for (k in used) o[k] = KEY[k];
    return o;
  }

  var gC = buildCrown(), st = stats(gC);
  if (st.surface > 8000 && root.console) root.console.warn('towerCrown: ' + st.surface + ' surface voxels > 8000 budget');
  A.voxelModels.towerCrown = {
    name: 'towerCrown',
    desc: 'Voxel crown of the Hollow Watchtower (CH1-D1b): a round corbelled parapet ring on top of the 12-14 m walls - stub ' +
          'course, string course on 38 dark corbels, 19 merlons with crenels and arrow slits, crumbled in 0.5 m blocks, ' +
          'moss on the north tops, ivy on the south-west face; the west broken down to the string course with loose blocks, ' +
          'one merlon tooth left at the north-west. The Kestrel\'s torn red / ochre envelope is snagged on the tooth and ' +
          'hangs 2-5 m down the outer north-west face in folds, with a burnt torn hem, two streamers and 8 rope lines.',
    voxel: {
      version: 1, meshOnly: true, cellM: CELL, // meshOnly: 56x52x36 > the 256-row DDA atlas (voxelPacks.test)
      size: [SX, SY, SZ], anchor: [CX, CY, ZB], mats: matsOf(gC), layers: gC.layers(),
      parts: { crown: { box: [0, 0, 0, SX, SY, SZ], pivot: [CX, CY, ZB] } },
      animations: { idle: { durations: [1000], loop: true, frames: [{}] } }
    },
    budget: { surfaceVoxels: st.surface, solidVoxels: st.solid, limit: 8000, surfaceByChar: st.surfaceByChar,
              note: 'surface = solid voxels with at least one empty 6-neighbour (computed at load; the preview shows it)' },
    placement: {
      entity: { id: 'towerCrown', type: 'prop', x: 1497.0, y: 1025.0, z: 12.0, yawDeg: 0, castShadow: true,
                components: { voxel: { model: 'towerCrown', anim: 'idle', loop: true } } },
      note: 'Tower level origin world (1480, 1018, 0); ring centre = level (17.0, 7.0) -> world (1497.0, 1025.0). z 12.0 ' +
            'is ABSOLUTE (the crown base = anchor z): the stub course reaches down to 11.25 m, the canvas and ropes to ' +
            '7.0 m on the north-west / west face. No collider (unreachable, 38.37 item 2 (b)). If the wall rework settles ' +
            'on a different base height, move z only (tops of N / E / S cells should end 0-0.5 m above z). If the ring ' +
            'footprint changes, scale R_* in section 1 of this file. EAST_TOP lowers the east arc if the sun shaft is lost.',
      worldExtent: { x: [1489.5, 1503.5], y: [1018.5, 1031.5], z: [7.0, 16.0] }
    },
    readability: { note: 'From the meadow (30-60 m) the merlon rhythm (2.0 m) and the crenel gaps read as a crown at ' +
                   '160x60; the broken west + the red / ochre sheet are the silhouette break that says "the Kestrel hit ' +
                   'here". The hanging canvas faces the summit / overlook, so it also reads from the breach.' }
  };

  // registry key (like voxel_world.js attachWorld): only when every material is merged in palette + detail-pass
  A.voxelModels.attachCrown = function attachCrown() {
    var P = A.palette, DP = A.detailPass, vox = A.voxelModels.towerCrown.voxel, k;
    if (!P || !DP || A.models.towerCrown) return false;
    for (k in vox.mats) if (!P.materials[vox.mats[k]] || !DP.materials[vox.mats[k]]) return false;
    A.models.towerCrown = A.voxelModels.towerCrown;
    return true;
  };
  A.voxelModels.attachCrown();
})(typeof window !== 'undefined' ? window : globalThis);
