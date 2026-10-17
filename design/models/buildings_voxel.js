/*
 * Kestrel - OUR OWN BUILDINGS as voxel models (OB-139, owner 2026-10-14). PROPOSAL SET - the owner picks before any code.
 * Owner: Designer. Replaces the kit-assembled Medieval Village houses (OB-138 overlapping pieces / unwalkable stairs /
 * player stuck, OB-129 lone chimney, OB-147 quest giver on an unreachable roof).
 * Format: architecture.md 15.1 (VoxelModelDef, same as design/models/voxel_tower.js) + two NEW fields per model,
 * documented in design/README.md "Buildings (voxel, OB-139)":
 *   colliders: [{ id, kind, box:[x0,y0,z0,x1,y1,z1] }]  METRES, relative to the anchor (feet point), axes as 15.1
 *              (x east, y SOUTH, z up; y0 side = the FRONT, faces north at facing 0; rotate with the placement yaw).
 *              kind: wall | floor | step | landing | rail | post | rubble | prop | roof ('roof' = blocker only, never walkable).
 *              Small visual recesses (hearth, plaster panels, window reveals) are INSIDE wall boxes on purpose.
 *   walk:      { levels:[{name,z}], doors:[{id,wall,box}], stairs:[{id,axis,steps:[collider ids, low->high]}],
 *                spots:{name:[x,y,z]} }  - what the preview checks (step rise <= 0.3, depth >= 0.3, width >= 1.2,
 *                doors >= 1.0 x 2.1, no pocket < 0.9 m, nothing floating) and where NPCs may stand.
 * Preview: design/preview/buildings-voxel.html. cellM 0.1 m for every model (1 voxel = 10 cm, owner "realistic, from squares").
 * The rows are GENERATED at load by the deterministic builders below (integer hash, no Math.random).
 *
 * MODELS (A.voxelModels.<id>, list in A.buildingsVoxel.ids)          footprint (walls)   height
 *   bldCottageStone   1 room, coursed stone, slate roof, east chimney   6.0 x 5.0 m          6.4 m (chimney)
 *   bldCottageTimber  1 room, timber frame + plaster, thatch roof       6.0 x 5.0 m          6.9 m (chimney)
 *   bldHouseTwo       stone ground floor + timber upper floor, inner     7.0 x 6.0 m          9.5 m (chimney)
 *                     straight stair (11 x 0.25 m risers + landing)
 *   bldRuin           roofless broken house, rubble inside              6.0 x 5.0 m          2.7 m
 *   bldTradePost      open stall, counter, shelves, striped awning      4.0 x 3.0 m (+1.2)   2.9 m
 *   bldStairsStone    modular outdoor stair, 4 risers of 0.25 m         1.6 x 2.0 m          1.0 m
 *   bldWallLow        modular low wall segment (tiles every 2.0 m)      2.0 x 0.5 m          1.0 m
 *   bldFence          modular fence segment (tiles every 2.0 m)         2.0 x 0.2 m          1.2 m
 *   bldFencePost      end post for a fence run                          0.2 x 0.2 m          1.2 m
 *   bldWatchtower     timber tower, closed stair + landing, platform   3.6 x 3.6 m (+stair) 8.4 m
 *                     at 4.0 m with rails, pyramid shingle roof
 * Materials: only existing palette.materials keys (KEY below). The engine also wants them in detailPass.materials
 * (attach rule of voxel_tower.js) - see README open points.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  var CM = 0.1;
  var IDS = [];

  // ---------------------------------------------------------------------------------------------------- helpers
  function hash(x, y, z, s) {
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) +
             Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function Grid(sx, sy, sz) { this.sx = sx; this.sy = sy; this.sz = sz; this.a = new Array(sx * sy * sz).fill('.'); }
  Grid.prototype.inb = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; };
  Grid.prototype.get = function (x, y, z) { return this.inb(x, y, z) ? this.a[x + this.sx * (y + this.sy * z)] : '.'; };
  Grid.prototype.set = function (x, y, z, c) { if (this.inb(x, y, z)) this.a[x + this.sx * (y + this.sy * z)] = c; };
  Grid.prototype.full = function (x, y, z) { return this.get(x, y, z) !== '.'; };
  Grid.prototype.layers = function () {
    var L = [], z, y, x, rows, row;
    for (z = 0; z < this.sz; z++) {
      rows = [];
      for (y = 0; y < this.sy; y++) { row = ''; for (x = 0; x < this.sx; x++) row += this.a[x + this.sx * (y + this.sy * z)]; rows.push(row); }
      L.push(rows);
    }
    return L;
  };

  // voxel char -> existing palette.materials key
  var KEY = {
    S: 'stone', L: 'block_light', D: 'block_dark', M: 'stone_moss', V: 'stone_ivy',      // masonry
    G: 'granite_dark', g: 'granite_light',                                               // slate roof + ridge
    F: 'floor', A: 'ash', K: 'stone_scorched', R: 'rubble', m: 'moss_cap', Z: 'grass',   // floors, hearth, ruin
    W: 'wood', T: 'timber_old', w: 'wood_cut',                                           // timber, planks, shingles
    P: 'linen_light', p: 'linen',                                                        // lime plaster (daub)
    Y: 'straw_light', y: 'straw', s: 'straw_dark',                                       // thatch
    C: 'canvas_light', c: 'canvas', k: 'canvas_dark', E: 'gore_red',                     // awning, sacks
    I: 'iron_dark', X: 'mirror_dark', r: 'rope'                                          // hinges, glass, rope
  };

  // Bld: geometry is written in METRES in a building-local frame (origin = NW outer wall corner, x east, y south, z up)
  function Bld(o) {
    this.id = o.id; this.mx = o.min[0]; this.my = o.min[1];
    this.sx = Math.round((o.max[0] - this.mx) / CM); this.sy = Math.round((o.max[1] - this.my) / CM);
    this.sz = Math.round(o.max[2] / CM);
    this.G = new Grid(this.sx, this.sy, this.sz);
    this.ax = o.anchor[0]; this.ay = o.anchor[1];
    this.cols = []; this.mounts = {};
  }
  var P = Bld.prototype;
  P.X = function (m) { return Math.round((m - this.mx) / CM); };
  P.Y = function (m) { return Math.round((m - this.my) / CM); };
  P.Z = function (m) { return Math.round(m / CM); };
  // fill a metre box; c = char, or fn(xm, ym, zm, ix, iy, iz) -> char | '.' (cut) | null (leave as is)
  P.fill = function (x0, y0, z0, x1, y1, z1, c) {
    var X0 = this.X(x0), X1 = this.X(x1), Y0 = this.Y(y0), Y1 = this.Y(y1), Z0 = this.Z(z0), Z1 = this.Z(z1), x, y, z, ch;
    for (z = Z0; z < Z1; z++) for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) {
      ch = typeof c === 'function' ? c(this.mx + (x + 0.5) * CM, this.my + (y + 0.5) * CM, (z + 0.5) * CM, x, y, z) : c;
      if (ch) this.G.set(x, y, z, ch);
    }
    return this;
  };
  P.paint = function (x0, y0, z0, x1, y1, z1, c) {      // recolour only voxels that already exist
    var G = this.G;
    return this.fill(x0, y0, z0, x1, y1, z1, function (xm, ym, zm, x, y, z) {
      return G.full(x, y, z) ? (typeof c === 'function' ? c(xm, ym, zm, x, y, z) : c) : null;
    });
  };
  P.col = function (id, kind, x0, y0, z0, x1, y1, z1) { this.cols.push({ id: id, kind: kind, box: [x0, y0, z0, x1, y1, z1] }); return this; };
  P.solid = function (id, kind, x0, y0, z0, x1, y1, z1, c) { this.fill(x0, y0, z0, x1, y1, z1, c); return this.col(id, kind, x0, y0, z0, x1, y1, z1); };
  P.mount = function (name, x, y, z) { this.mounts[name] = { at: [r2((x - this.mx) / CM), r2((y - this.my) / CM), r2(z / CM)], part: 'body' }; };
  P.rel = function (b) { return [r2(b[0] - this.ax), r2(b[1] - this.ay), r2(b[2]), r2(b[3] - this.ax), r2(b[4] - this.ay), r2(b[5])]; };
  P.finish = function (meta) {
    var self = this, used = {}, mats = {}, k, i, a = this.G.a;
    for (i = 0; i < a.length; i++) if (a[i] !== '.') used[a[i]] = 1;
    for (k in used) mats[k] = KEY[k];
    var w = meta.walk || {}, spots = {};
    for (k in (w.spots || {})) spots[k] = [r2(w.spots[k][0] - this.ax), r2(w.spots[k][1] - this.ay), r2(w.spots[k][2])];
    var anchor = [r2((this.ax - this.mx) / CM), r2((this.ay - this.my) / CM), 0];
    A.voxelModels[this.id] = {
      name: this.id, proposal: 'OB-139', desc: meta.desc, sizeM: meta.sizeM,
      voxel: {
        version: 1, cellM: CM, size: [this.sx, this.sy, this.sz], anchor: anchor, mats: mats, layers: this.G.layers(),
        parts: { body: { box: [0, 0, 0, this.sx, this.sy, this.sz], pivot: anchor } },
        animations: { idle: { durations: [1000], loop: true, interp: 'step', frames: [{}] } },
        mounts: this.mounts
      },
      colliders: this.cols.map(function (c) { return { id: c.id, kind: c.kind, box: self.rel(c.box) }; }),
      walk: {
        levels: w.levels || [{ name: 'ground', z: 0 }],
        doors: (w.doors || []).map(function (d) { return { id: d.id, wall: d.wall, box: self.rel(d.box) }; }),
        stairs: w.stairs || [],
        spots: spots
      }
    };
    IDS.push(this.id);
  };

  // ---------------------------------------------------------------------------------------------------- textures
  // coursed rubble-stone: 0.3 m courses, 0.4 m blocks, staggered; 3 tones; moss low down; dressed quoins at corners
  function stoneTex(seed, o) {
    o = o || {};
    return function (xm, ym, zm, x, y, z) {
      var course = Math.floor(z / 3), off = (course & 1) * 2, u = x + y;
      var h = hash(Math.floor((u + off) / 4), course, seed, 3);
      var c = h < 0.13 ? 'L' : (h < 0.30 ? 'D' : 'S');
      if (o.W) {
        var dx = Math.min(xm, o.W - xm), dy = Math.min(ym, o.D - ym);
        if ((course & 1) ? (dx < 0.4 && dy < 0.7) : (dx < 0.7 && dy < 0.4)) c = 'L';    // long / short quoins
      }
      if (o.moss && zm < 0.4 && hash(x, y, z, seed + 5) < 0.5) c = 'M';
      return c;
    };
  }
  function slateTex(xm, ym, zm, x, y, z) {
    var h = hash(Math.floor((x + (z & 1)) / 2), z, 0, 11);
    return h < 0.10 ? 'g' : (h < 0.26 ? 'D' : 'G');
  }
  function thatchTex(xm, ym, zm, x, y, z) {
    var h = hash(x, 0, Math.floor(z / 2), 9);
    return h < 0.30 ? 'Y' : (h < 0.86 ? 'y' : 's');
  }
  function shingleTex(xm, ym, zm, x, y, z) {
    if (z % 3 === 0) return 'T';
    return hash(Math.floor((x + y + (Math.floor(z / 3) & 1)) / 2), z, 0, 13) < 0.2 ? 'W' : 'w';
  }
  function plankX(xm, ym, zm, x, y) { return (y % 3 === 0) ? 'T' : (hash(Math.floor(x / 7), y, 0, 17) < 0.15 ? 'w' : 'W'); }
  function plankY(xm, ym, zm, x, y) { return (x % 3 === 0) ? 'T' : (hash(x, Math.floor(y / 7), 0, 19) < 0.15 ? 'w' : 'W'); }
  function boardsV(xm, ym, zm, x, y) { return ((x + y) % 3 === 0) ? 'T' : 'W'; }
  function plaster(x, y, z) { return hash(x >> 1, y >> 1, z >> 1, 21) < 0.25 ? 'p' : 'P'; }

  // timber frame (posts, sill, rail, plate, corner braces) with lime-plaster panels set 1 voxel back from the frame
  function timberFrame(W, D, t, zS, zR, zP) {
    return function (xm, ym, zm, x, y, z) {
      var onNS = (ym < t || ym > D - t), u = onNS ? xm : ym, L = onNS ? W : D;
      var dOut = Math.min(xm, W - xm, ym, D - ym), uu = Math.min(u, L - u);
      var post = uu < 0.2 || Math.abs(u - L / 2) < 0.1 || Math.abs(u - L / 4) < 0.1 || Math.abs(u - 3 * L / 4) < 0.1;
      if (post || zm < zS + 0.2 || zm > zP - 0.2) return 'T';
      if (Math.abs(zm - zR) < 0.05) return 'W';
      if (uu > 0.2 && uu < L / 4 - 0.1 && zm > zR) {
        var f = (uu - 0.2) / (L / 4 - 0.3), zb = zR + 0.05 + f * (zP - 0.25 - zR);
        if (Math.abs(zm - zb) < 0.09) return 'W';
      }
      if (dOut < 0.1) return '.';                       // panel recess: the frame stands proud
      return plaster(x, y, z);
    };
  }
  function gableTimber(W, D, t, eave) {
    return function (xm, ym, zm, x, y, z) {
      if (ym < t || ym > D - t) return 'T';             // wall-plate wedge on the long walls
      if (Math.abs(ym - D / 2) < 0.1 || Math.abs(zm - (eave + 1.05)) < 0.05) return 'T';   // king post + collar
      if (Math.min(xm, W - xm) < 0.1) return '.';
      return plaster(x, y, z);
    };
  }

  // ---------------------------------------------------------------------------------------------------- parts
  function ring(b, x0, y0, x1, y1, th, z0, z1, tex) {
    b.fill(x0, y0, z0, x1, y0 + th, z1, tex); b.fill(x0, y1 - th, z0, x1, y1, z1, tex);
    b.fill(x0, y0 + th, z0, x0 + th, y1 - th, z1, tex); b.fill(x1 - th, y0 + th, z0, x1, y1 - th, z1, tex);
  }
  // gable roof, ridge along x. R = {x0,x1,y0,y1,zEdge,slope,thick,tex,ridge,edge,soft}
  function roofTop(R, ym) { return R.zEdge + ((R.y1 - R.y0) / 2 - Math.abs(ym - (R.y0 + R.y1) / 2)) * R.slope; }
  function roof(b, R) {
    var yc = (R.y0 + R.y1) / 2;
    b.fill(R.x0, R.y0, 0, R.x1, R.y1, b.sz * CM, function (xm, ym, zm, x, y, z) {
      var zt = roofTop(R, ym), d = (R.y1 - R.y0) / 2 - Math.abs(ym - yc);
      if (Math.abs(ym - yc) < 0.1 && zm > zt && zm <= zt + 0.1001) return R.ridge;
      if (zm > zt || zm < zt - R.thick) return null;
      var verge = xm < R.x0 + 0.1 || xm > R.x1 - 0.1;
      if (verge && R.soft && zm > zt - 0.1) return null;
      if (d < 0.12 || verge) return R.edge;
      return R.tex(xm, ym, zm, x, y, z);
    });
  }
  function underRoof(b, x0, y0, x1, y1, zFrom, R, tex) {
    b.fill(x0, y0, zFrom, x1, y1, b.sz * CM, function (xm, ym, zm, x, y, z) {
      return zm < roofTop(R, ym) - R.thick ? tex(xm, ym, zm, x, y, z) : null;
    });
  }
  function wb(W, D, wall, a0, a1, d0, d1) {     // wall-relative box -> [x0,y0,x1,y1]; d = depth from the OUTER face
    if (wall === 'N') return [a0, d0, a1, d1];
    if (wall === 'S') return [a0, D - d1, a1, D - d0];
    if (wall === 'W') return [d0, a0, d1, a1];
    return [W - d1, a0, W - d0, a1];
  }
  function windowAt(b, W, D, t, wall, a0, a1, z0, z1, stone) {
    var r = wb(W, D, wall, a0, a1, 0, t), mid = Math.floor(t / CM / 2) * CM, g = wb(W, D, wall, a0, a1, mid, mid + CM);
    var n = Math.round((a1 - a0) / CM), nz = Math.round((z1 - z0) / CM), ns = (wall === 'N' || wall === 'S');
    var trim = stone ? 'L' : 'T';
    b.paint.apply(b, wb(W, D, wall, a0 - 0.2, a1 + 0.2, 0, t).slice(0, 2).concat([z1], wb(W, D, wall, a0 - 0.2, a1 + 0.2, 0, t).slice(2), [z1 + 0.2, trim]));
    b.fill(r[0], r[1], z0, r[2], r[3], z1, '.');
    b.fill(g[0], g[1], z0, g[2], g[3], z1, function (xm, ym, zm) {
      var i = Math.floor(((ns ? xm : ym) - a0) / CM), k = Math.floor((zm - z0) / CM);
      if (i === 0 || i === n - 1 || k === 0 || k === nz - 1 || i === (n >> 1) || k === (nz >> 1)) return 'W';
      return 'X';
    });
    var s = wb(W, D, wall, a0 - 0.1, a1 + 0.1, -0.1, t);
    b.fill(s[0], s[1], z0 - 0.1, s[2], s[3], z0, trim);
    [[a0 - 0.4, a0], [a1, a1 + 0.4]].forEach(function (sh) {     // open shutters, 1 voxel proud of the wall
      var q = wb(W, D, wall, sh[0], sh[1], -0.1, 0);
      b.fill(q[0], q[1], z0, q[2], q[3], z1, function (xm, ym, zm) {
        return (Math.abs(zm - (z0 + 0.25)) < 0.05 || Math.abs(zm - (z1 - 0.25)) < 0.05) ? 'T' : 'W';
      });
    });
  }
  // chimney attached to the outside of a gable wall; side 'E' (face = x of the outer wall face) or 'W'
  function chimney(b, side, face, y0, y1, zTop, shoulder, idp) {
    function xr(d0, d1) { return side === 'E' ? [face + d0, face + d1] : [face - d1, face - d0]; }
    var tex = stoneTex(7), a = xr(0, 0.8), s = xr(0, 0.6), c = xr(-0.1, 0.7), f = xr(0.2, 0.4), cy = (y0 + y1) / 2;
    b.solid(idp + 'Base', 'wall', a[0], y0, 0, a[1], y1, shoulder, tex);
    b.fill(a[0], y0, shoulder, a[1], y1, shoulder + 0.1, function (xm, ym) {      // weathered shoulder slope
      var dd = side === 'E' ? xm - face : face - xm;
      return (dd < 0.6 && ym > y0 + 0.2 && ym < y1 - 0.2) ? null : (dd < 0.7 ? 'L' : null);
    });
    b.solid(idp + 'Stack', 'wall', s[0], y0 + 0.2, shoulder, s[1], y1 - 0.2, zTop, tex);
    b.fill(c[0], y0 + 0.1, zTop - 0.4, c[1], y1 - 0.1, zTop - 0.3, 'L');           // corbelled drip course
    b.fill(s[0], y0 + 0.2, zTop - 0.2, s[1], y1 - 0.2, zTop, 'K');                 // soot-black crown
    b.fill(f[0], cy - 0.1, zTop - 0.5, f[1], cy + 0.1, zTop, '.');                // flue
    b.fill(f[0], cy - 0.1, zTop - 0.6, f[1], cy + 0.1, zTop - 0.5, 'A');
    b.mount('smoke', (f[0] + f[1]) / 2, cy, zTop);
  }

  // ---------------------------------------------------------------------------------------------------- 1. cottages
  function buildCottage(id, stone) {
    var W = 6.0, D = 5.0, t = stone ? 0.5 : 0.3, eave = 2.8;
    var slope = stone ? 0.95 : 1.1, thick = stone ? 0.25 : 0.4, ov = stone ? 0.4 : 0.5, gov = stone ? 0.3 : 0.4;
    var zEdge = eave - ov * slope + thick, ridge = zEdge + (D / 2 + ov) * slope, chTop = Math.ceil((ridge + 0.8) * 10) / 10;
    var b = new Bld({ id: id, min: [-gov - 0.1, -ov - 0.1], max: [W + 0.9, D + ov + 0.1, chTop + 0.2], anchor: [W / 2, D / 2] });
    var wallTex = stone ? stoneTex(1, { moss: true, W: W, D: D }) : timberFrame(W, D, t, 0.5, 1.45, eave);
    var plinthH = stone ? 0.3 : 0.2;
    ring(b, -0.1, -0.1, W + 0.1, D + 0.1, t + 0.1, 0, plinthH, stoneTex(2, { moss: true }));     // footing lip
    if (stone) ring(b, 0, 0, W, D, t, 0, eave, wallTex);
    else { ring(b, 0, 0, W, D, t, 0, 0.5, stoneTex(3, { moss: true, W: W, D: D })); ring(b, 0, 0, W, D, t, 0.5, eave, wallTex); }
    b.fill(t, t, 0, W - t, D - t, 0.2, stone ? 'F' : plankX);
    var R = { x0: -gov, x1: W + gov, y0: -ov, y1: D + ov, zEdge: zEdge, slope: slope, thick: thick,
              tex: stone ? slateTex : thatchTex, ridge: stone ? 'g' : 's', edge: stone ? 'D' : 's', soft: !stone };
    var gTex = stone ? wallTex : gableTimber(W, D, t, eave);
    underRoof(b, 0, 0, W, t, eave, R, gTex); underRoof(b, 0, D - t, W, D, eave, R, gTex);
    underRoof(b, 0, t, t, D - t, eave, R, gTex); underRoof(b, W - t, t, W, D - t, eave, R, gTex);
    b.fill(2.0, t, eave - 0.2, 2.2, D - t, eave, 'T'); b.fill(4.0, t, eave - 0.2, 4.2, D - t, eave, 'T');  // tie beams
    roof(b, R);
    // door (front, x 1.7..2.9), worn threshold + doorstep, dressed jambs + lintel, leaf standing open against the inner wall
    b.paint(1.5, 0, 2.4, 3.1, t, 2.6, stone ? 'L' : 'T');
    b.fill(1.7, 0, 0.2, 2.9, t, 2.4, '.');
    b.paint(1.6, 0, 0.2, 1.7, t, 2.4, stone ? 'L' : 'T'); b.paint(2.9, 0, 0.2, 3.0, t, 2.4, stone ? 'L' : 'T');
    b.fill(1.5, -0.1, 0.1, 3.1, 0, plinthH, '.');
    b.fill(1.5, -0.4, 0, 3.1, 0, 0.1, 'L');
    b.fill(1.7, 0, 0, 2.9, t, 0.2, 'L');
    b.fill(0.5, t, 0.2, 1.7, t + 0.1, 2.3, function (xm, ym, zm, x) {
      return (Math.abs(zm - 0.55) < 0.05 || Math.abs(zm - 1.95) < 0.05) ? 'I' : (x % 3 === 0 ? 'T' : 'W');
    });
    // windows: front, back x2, west gable
    windowAt(b, W, D, t, 'N', 3.4, 4.2, 1.0, 1.9, stone);
    windowAt(b, W, D, t, 'S', 1.8, 2.6, 1.0, 1.9, stone); windowAt(b, W, D, t, 'S', 3.4, 4.2, 1.0, 1.9, stone);
    windowAt(b, W, D, t, 'W', 2.8, 3.6, 1.0, 1.9, stone);
    // hearth in the east wall + raised hearth stone + mantel beam; the chimney stands outside that wall
    var hr = wb(W, D, 'E', 2.0, 3.0, Math.max(0, t - 0.3), t);
    b.fill(hr[0], hr[1], 0.3, hr[2], hr[3], 1.2, '.');
    b.fill(hr[0], hr[1], 0.2, hr[2], hr[3], 0.3, 'A');
    var hs = wb(W, D, 'E', 1.8, 3.2, t, t + 0.6);
    b.solid('hearth', 'floor', hs[0], hs[1], 0.2, hs[2], hs[3], 0.3, 'L');
    var mt = wb(W, D, 'E', 1.8, 3.2, t, t + 0.1); b.fill(mt[0], mt[1], 1.2, mt[2], mt[3], 1.35, 'T');
    var so = wb(W, D, 'E', 1.9, 3.1, Math.max(0, t - 0.4), t); b.paint(so[0], so[1], 0.3, so[2], so[3], 1.6, 'K');
    chimney(b, 'E', W, 1.9, 3.1, chTop, 2.0, 'chimney');
    b.paint(W, 2.0, 0.3, W + 0.1, 3.0, 1.2, 'K');                                             // fire-back
    // iron lamp bracket beside the door (lantern prop hangs at mounts.lamp)
    b.fill(3.0, -0.3, 2.2, 3.1, 0, 2.3, 'I'); b.fill(3.0, -0.3, 2.0, 3.1, -0.2, 2.2, 'I');   // on the post / quoin
    b.mount('lamp', 3.05, -0.25, 1.95); b.mount('door', 2.3, 0, 0.2);
    // colliders
    b.col('floor', 'floor', t, t, 0, W - t, D - t, 0.2).col('threshold', 'floor', 1.7, 0, 0, 2.9, t, 0.2);
    b.col('doorstep', 'step', 1.5, -0.4, 0, 3.1, 0, 0.1);
    b.col('wallN_w', 'wall', 0, 0, 0, 1.7, t, eave).col('wallN_e', 'wall', 2.9, 0, 0, W, t, eave);
    b.col('wallN_head', 'wall', 1.7, 0, 2.4, 2.9, t, eave);
    b.col('wallS', 'wall', 0, D - t, 0, W, D, eave).col('wallW', 'wall', 0, t, 0, t, D - t, eave).col('wallE', 'wall', W - t, t, 0, W, D - t, eave);
    b.col('doorLeaf', 'wall', t, t, 0.2, 1.7, t + 0.1, 2.3);      // from the wall face: no slot behind the leaf
    b.col('roof', 'roof', -gov, -ov, eave, W + gov, D + ov, r2(ridge));
    b.finish({
      desc: stone ? 'Stone cottage: one room, coursed stone with dressed quoins and a mossy footing, slate roof with a ' +
                    'pale ridge, open plank door leaning on the inner wall, shuttered windows, hearth in the east wall ' +
                    'and a chimney built against it (no lone chimney: OB-129).'
                  : 'Timber cottage: one room on a stone footing, dark oak frame (posts, rails, corner braces) with lime ' +
                    'plaster panels set back, thick straw thatch with soft verges, plank floor, same door / hearth / ' +
                    'stone chimney as the stone cottage.',
      sizeM: [W, D, r2(chTop)],
      walk: { levels: [{ name: 'ground', z: 0 }],
              doors: [{ id: 'front', wall: 'N', box: [1.7, 0, 0.2, 2.9, t, 2.4] }],
              spots: { giver: [2.3, -1.6, 0], inside: [3.6, 2.6, 0.2] } }
    });
  }
  buildCottage('bldCottageStone', true);
  buildCottage('bldCottageTimber', false);

  // ---------------------------------------------------------------------------------------------------- 2. two-storey
  (function () {
    var W = 7.0, D = 6.0, t = 0.5, t2 = 0.3, z1 = 3.2, eave = 5.6, slope = 0.9, thick = 0.25, ov = 0.4, gov = 0.3;
    var zEdge = eave - ov * slope + thick, ridge = zEdge + (D / 2 + ov) * slope, chTop = Math.ceil((ridge + 0.8) * 10) / 10;
    var b = new Bld({ id: 'bldHouseTwo', min: [-0.9, -ov - 0.1], max: [W + gov + 0.1, D + ov + 0.1, chTop + 0.2], anchor: [W / 2, D / 2] });
    var st = stoneTex(31, { moss: true, W: W, D: D });
    ring(b, -0.1, -0.1, W + 0.1, D + 0.1, t + 0.1, 0, 0.3, stoneTex(32, { moss: true }));
    ring(b, 0, 0, W, D, t, 0, z1, st);
    b.fill(t, t, 0, W - t, D - t, 0.2, 'F');
    ring(b, 0, 0, W, D, t2, z1, eave, timberFrame(W, D, t2, z1, 4.3, eave));
    b.fill(0, 0, z1 - 0.2, W, D, z1, function (xm, ym, zm, x, y, z) {               // jetty-less floor beam band
      return (Math.min(xm, W - xm, ym, D - ym) < 0.1) ? 'T' : null;
    });
    // upper floor: planks on joists, stair opening x 2.6..5.0 / y 4.3..5.5, landing pier x 5.0..6.5
    var OX0 = 2.6, OX1 = 5.0, OY0 = 4.3, OY1 = D - t;
    b.fill(t, t, z1 - 0.2, W - t, D - t, z1, function (xm, ym, zm, x, y, z) {
      if (ym > OY0 && xm > OX0 && xm < OX1) return null;
      if (ym > OY0 && xm > OX1) return null;
      return plankX(xm, ym, zm, x, y, z);
    });
    [1.0, 2.0, 3.0, 4.0, 5.0, 6.0].forEach(function (jx) {
      var yEnd = (jx > OX0 && jx < OX1) ? OY0 - 0.1 : (jx >= OX1 ? OY0 : D - t);
      b.fill(jx, t, z1 - 0.4, jx + 0.2, yEnd, z1 - 0.2, 'T');
    });
    b.fill(OX0, OY0 - 0.1, z1 - 0.4, OX1, OY0, z1, 'T');                                   // trimmer beam
    // the stair: 11 risers of 0.25 m, treads 0.3 m deep, 1.2 m wide, along the back wall, rising east; landing = floor
    var steps = [];
    for (var i = 1; i <= 11; i++) {
      var x0 = 1.7 + (i - 1) * 0.3, top = 0.2 + 0.25 * i;
      b.solid('s' + i, 'step', r2(x0), OY0, 0.2, r2(x0 + 0.3), OY1, r2(top), function (xm, ym, zm) {
        return zm > top - 0.1 - 1e-6 ? (xm < 0 ? 'W' : 'w') : (ym < OY0 + 0.1 ? 'W' : 'T');
      });
      b.paint(r2(x0), OY0, r2(top - 0.1), r2(x0 + 0.1), OY1, r2(top), 'W');              // tread nosing
      steps.push('s' + i);
    }
    b.solid('landing', 'landing', OX1, OY0, 0.2, W - t, OY1, z1, function (xm, ym, zm, x, y, z) {
      return zm > z1 - 0.2 ? plankX(xm, ym, zm, x, y, z) : st(xm, ym, zm, x, y, z);
    });
    steps.push('landing');
    // balustrade round the opening on the upper floor (posts, rails, turned-looking balusters every 0.2 m)
    function balu(x0, y0, x1, y1, id) {
      b.solid(id, 'rail', x0, y0, z1, x1, y1, z1 + 1.0, function (xm, ym, zm, x, y) {
        if (zm > z1 + 0.9 || zm < z1 + 0.1) return 'W';
        var u = (x1 - x0 > y1 - y0) ? x : y;
        return (u % 6 === 0) ? 'T' : (u % 2 === 0 ? 'T' : null);
      });
    }
    balu(OX0 - 0.1, OY0 - 0.1, OX1, OY0, 'railN'); balu(OX0 - 0.1, OY0, OX0, OY1, 'railW');
    // ground door + windows; upper windows
    b.paint(0.8, 0, 2.4, 2.4, t, 2.6, 'L'); b.fill(1.0, 0, 0.2, 2.2, t, 2.4, '.');
    b.paint(0.9, 0, 0.2, 1.0, t, 2.4, 'L'); b.paint(2.2, 0, 0.2, 2.3, t, 2.4, 'L');
    b.fill(0.8, -0.1, 0.1, 2.4, 0, 0.3, '.'); b.fill(0.8, -0.4, 0, 2.4, 0, 0.1, 'L'); b.fill(1.0, 0, 0, 2.2, t, 0.2, 'L');
    b.fill(2.2, t, 0.2, 3.4, t + 0.1, 2.3, function (xm, ym, zm, x) {
      return (Math.abs(zm - 0.55) < 0.05 || Math.abs(zm - 1.95) < 0.05) ? 'I' : (x % 3 === 0 ? 'T' : 'W');
    });
    windowAt(b, W, D, t, 'N', 4.4, 5.2, 1.0, 1.9, true); windowAt(b, W, D, t, 'E', 1.5, 2.3, 1.0, 1.9, true);
    windowAt(b, W, D, t2, 'N', 1.6, 2.4, 4.0, 4.9, false); windowAt(b, W, D, t2, 'N', 4.4, 5.2, 4.0, 4.9, false);
    windowAt(b, W, D, t2, 'S', 0.9, 1.7, 4.0, 4.9, false); windowAt(b, W, D, t2, 'E', 2.6, 3.4, 4.0, 4.9, false);
    // roof (slate), gables (timber), tie beams; west hearth + chimney
    var R = { x0: -gov, x1: W + gov, y0: -ov, y1: D + ov, zEdge: zEdge, slope: slope, thick: thick, tex: slateTex, ridge: 'g', edge: 'D' };
    var gT = gableTimber(W, D, t2, eave);
    underRoof(b, 0, 0, W, t2, eave, R, gT); underRoof(b, 0, D - t2, W, D, eave, R, gT);
    underRoof(b, 0, t2, t2, D - t2, eave, R, gT); underRoof(b, W - t2, t2, W, D - t2, eave, R, gT);
    b.fill(2.4, t2, eave - 0.2, 2.6, D - t2, eave, 'T'); b.fill(4.6, t2, eave - 0.2, 4.8, D - t2, eave, 'T');
    roof(b, R);
    var hr = wb(W, D, 'W', 2.6, 3.4, 0.2, t); b.fill(hr[0], hr[1], 0.3, hr[2], hr[3], 1.2, '.'); b.fill(hr[0], hr[1], 0.2, hr[2], hr[3], 0.3, 'A');
    var hs = wb(W, D, 'W', 2.4, 3.6, t, t + 0.6); b.solid('hearth', 'floor', hs[0], hs[1], 0.2, hs[2], hs[3], 0.3, 'L');
    var mt = wb(W, D, 'W', 2.4, 3.6, t, t + 0.1); b.fill(mt[0], mt[1], 1.2, mt[2], mt[3], 1.35, 'T');
    var so = wb(W, D, 'W', 2.5, 3.5, 0.1, t); b.paint(so[0], so[1], 0.3, so[2], so[3], 1.6, 'K');
    chimney(b, 'W', 0, 2.4, 3.6, chTop, 2.4, 'chimney');
    b.fill(3.6, -0.3, 2.2, 3.7, 0, 2.3, 'I'); b.fill(3.6, -0.3, 2.0, 3.7, -0.2, 2.2, 'I');
    b.mount('lamp', 3.65, -0.25, 1.95); b.mount('door', 1.6, 0, 0.2);
    // colliders
    b.col('floor0', 'floor', t, t, 0, W - t, D - t, 0.2).col('threshold', 'floor', 1.0, 0, 0, 2.2, t, 0.2);
    b.col('doorstep', 'step', 0.8, -0.4, 0, 2.4, 0, 0.1);
    b.col('wallN_w', 'wall', 0, 0, 0, 1.0, t, z1).col('wallN_e', 'wall', 2.2, 0, 0, W, t, z1).col('wallN_head', 'wall', 1.0, 0, 2.4, 2.2, t, z1);
    b.col('wallS', 'wall', 0, D - t, 0, W, D, z1).col('wallW', 'wall', 0, t, 0, t, D - t, z1).col('wallE', 'wall', W - t, t, 0, W, D - t, z1);
    b.col('doorLeaf', 'wall', 2.2, t, 0.2, 3.4, t + 0.1, 2.3);
    b.col('floor1a', 'floor', t, t, z1 - 0.2, W - t, OY0, z1).col('floor1b', 'floor', t, OY0, z1 - 0.2, OX0, OY1, z1);
    b.col('wall1N', 'wall', 0, 0, z1, W, t2, eave).col('wall1S', 'wall', 0, D - t2, z1, W, D, eave);
    b.col('wall1W', 'wall', 0, t2, z1, t2, D - t2, eave).col('wall1E', 'wall', W - t2, t2, z1, W, D - t2, eave);
    b.col('roof', 'roof', -gov, -ov, eave, W + gov, D + ov, r2(ridge));
    b.finish({
      desc: 'Two-storey house: coursed stone ground floor (door, hearth, west chimney), timber-framed plaster upper ' +
            'floor, slate roof. INSIDE: a straight wooden stair along the back wall (11 risers x 0.25 m, treads 0.3 m, ' +
            '1.2 m wide) to a 1.5 m landing, a balustrade round the stair opening; headroom >= 2.05 m on every step.',
      sizeM: [W, D, r2(chTop)],
      walk: { levels: [{ name: 'ground', z: 0 }, { name: 'upper', z: z1 }],
              doors: [{ id: 'front', wall: 'N', box: [1.0, 0, 0.2, 2.2, t, 2.4] }],
              stairs: [{ id: 'inner', axis: '+x', steps: steps }],
              spots: { giver: [1.6, -1.6, 0], upstairs: [3.5, 2.4, z1] } }
    });
  })();

  // ---------------------------------------------------------------------------------------------------- 3. ruin
  (function () {
    var W = 6.0, D = 5.0, t = 0.5;
    var b = new Bld({ id: 'bldRuin', min: [-1.1, -1.1], max: [W + 1.3, D + 1.0, 2.9], anchor: [W / 2, D / 2] });
    function hWall(xm, ym) {
      var u = ym < t ? xm : (xm > W - t ? W + ym : (ym > D - t ? W + D + (W - xm) : 2 * W + D + (D - ym)));
      if (ym < t && xm > 2.2 && xm < 3.6) return 0;                     // doorway, sill gone
      if (xm > W - t && ym > 1.6 && ym < 3.4) return 0.2;                // the breach (rubble spills out)
      var ui = Math.floor(u / 0.4), ub = ui * 0.4 + 0.2;
      var h = 1.2 + 0.7 * Math.sin(ub * 1.1 + 0.5) + 0.45 * Math.sin(ub * 2.9 + 2.0) + 0.3 * (hash(ui, 0, 0, 77) - 0.5);
      if (Math.min(xm, W - xm) < 0.7 && Math.min(ym, D - ym) < 0.7) h = Math.max(h, 2.2 + 0.4 * hash(ui, 1, 0, 78));
      return Math.round(Math.max(0.3, Math.min(2.7, h)) * 10) / 10;
    }
    var st = stoneTex(41, { moss: true, W: W, D: D });
    function wallFn(xm, ym, zm, x, y, z) {
      var h = hWall(xm, ym); if (zm > h) return null;
      var dOut = Math.min(xm, W - xm, ym, D - ym);
      if (dOut < 0.1 && zm > h - 0.2 && hash(x, y, 0, 79) < 0.4) return null;          // chipped outer edge
      if (zm > h - 0.1 && hash(x, y, 1, 80) < 0.55) return 'm';
      if (xm < 0.1 && zm < h - 0.2 && hash(0, y >> 1, 0, 81) < 0.6) return 'V';         // ivy on the west face
      return st(xm, ym, zm, x, y, z);
    }
    b.fill(0, 0, 0, W, D, 2.8, function (xm, ym, zm, x, y, z) {
      return (Math.min(xm, W - xm, ym, D - ym) < t) ? wallFn(xm, ym, zm, x, y, z) : null;
    });
    b.fill(t, t, 0, W - t, D - t, 0.1, function (xm, ym, zm, x, y) {
      var h = hash(Math.floor(x / 3), Math.floor(y / 3), 0, 82); return h < 0.2 ? 'Z' : (h < 0.32 ? 'R' : 'F');
    });
    b.fill(2.2, 0, 0, 3.6, t, 0.1, 'F');
    b.paint(t - 0.1, 2.0, 0.1, t, 3.0, 1.0, 'K');                                      // soot on the old hearth wall
    b.paint(t, 2.1, 0, t + 0.6, 2.9, 0.1, 'A');                                         // cold hearth ash
    // rubble heaps: terraced in 0.1 m steps, max 0.3 m above the floor -> walk over them
    function heap(id, cx, cy, r, hmax) {
      b.fill(cx - r, cy - r, 0, cx + r, cy + r, 0.1 + hmax + 0.1, function (xm, ym, zm, x, y, z) {
        var d = Math.sqrt((xm - cx) * (xm - cx) + (ym - cy) * (ym - cy));
        var hh = Math.round((hmax * (1 - d / r) + 0.06 * (hash(x, y, 0, 83) - 0.5)) * 10) / 10;
        if (hh <= 0 || zm > 0.1 + hh) return null;
        var top = zm > hh, hv = hash(x >> 1, y >> 1, z, 84);
        return hv < 0.16 ? 'L' : (hv < 0.28 ? 'D' : (top && hv > 0.85 ? 'm' : 'R'));
      });
      for (var k = 1; k * 0.1 <= hmax + 1e-6; k++) {
        var hs = r2(r * (1 - (k * 0.1) / hmax) * 0.7);
        if (hs > 0.15) b.col(id + '_' + k, 'rubble', r2(cx - hs), r2(cy - hs), 0, r2(cx + hs), r2(cy + hs), r2(0.1 + k * 0.1));
      }
    }
    heap('heapA', 1.5, 3.6, 1.0, 0.3); heap('heapB', 4.4, 1.3, 0.8, 0.2); heap('heapC', 5.9, 2.5, 1.1, 0.3);
    b.solid('beam', 'step', 2.0, 2.3, 0.1, 4.6, 2.5, 0.3, function (xm) { return xm > 4.2 ? 'K' : 'T'; });
    [[-0.8, 1.2, 'L'], [2.0, -0.8, 'D'], [6.7, 4.4, 'L'], [-0.7, 3.9, 'D']].forEach(function (p, n) {
      b.solid('block' + n, 'prop', p[0], p[1], 0, r2(p[0] + 0.4), r2(p[1] + 0.3), 0.3, function (xm, ym, zm) { return zm > 0.2 && n % 2 === 0 ? 'm' : p[2]; });
    });
    // wall colliders: 0.1 m slices (exact at the doorway / breach edges), height = highest column, equal runs merged
    function segs(name, horiz, a0, a1, c0, c1) {
      var list = [], a, s;
      for (a = a0; a < a1 - 1e-6; a = r2(a + 0.1)) {
        var e = Math.min(a1, r2(a + 0.1)), hm = 0, u, v;
        for (u = a + 0.05; u < e; u += 0.1) for (v = c0 + 0.05; v < c1; v += 0.1) hm = Math.max(hm, horiz ? hWall(u, v) : hWall(v, u));
        if (list.length && list[list.length - 1].h === hm) list[list.length - 1].e = e; else list.push({ s: a, e: e, h: hm });
      }
      list.forEach(function (q, n) {
        if (q.h <= 0) return;
        if (horiz) b.col(name + n, 'wall', q.s, c0, 0, q.e, c1, q.h); else b.col(name + n, 'wall', c0, q.s, 0, c1, q.e, q.h);
      });
      void s;
    }
    segs('wallN', true, 0, W, 0, t); segs('wallS', true, 0, W, D - t, D); segs('wallW', false, t, D - t, 0, t); segs('wallE', false, t, D - t, W - t, W);
    b.col('floor', 'floor', t, t, 0, W - t, D - t, 0.1).col('sill', 'floor', 2.2, 0, 0, 3.6, t, 0.1);
    b.mount('door', 2.9, 0, 0.1);
    b.finish({
      desc: 'Ruined house: the same 6 x 5 m plan with broken coursed walls (0.3 - 2.7 m, tall corners, chipped edges, moss ' +
            'on the tops, ivy on the west face), no roof, doorway without a door, a breach in the east wall. Inside: ' +
            'cracked flagstones with grass, a cold hearth, terraced rubble heaps (max 0.3 m) and a charred beam (0.2 m) - ' +
            'everything walkable, every voxel stands on the ground.',
      sizeM: [W, D, 2.7],
      walk: { doors: [{ id: 'doorway', wall: 'N', box: [2.2, 0, 0.1, 3.6, t, 2.8] }, { id: 'breach', wall: 'E', box: [W - t, 1.6, 0.2, W, 3.4, 2.8] }],
              spots: { giver: [2.9, -1.0, 0], inside: [3.0, 3.6, 0.1] } }
    });
  })();

  // ---------------------------------------------------------------------------------------------------- 4. trade post
  (function () {
    var b = new Bld({ id: 'bldTradePost', min: [-0.3, -1.3], max: [4.3, 3.1, 3.1], anchor: [2.0, 1.5] });
    b.solid('deck', 'floor', 0, 0, 0, 4.0, 3.0, 0.2, function (xm, ym, zm, x, y) {
      return (xm < 0.1 || xm > 3.9 || ym < 0.1 || ym > 2.9) ? 'T' : plankY(xm, ym, zm, x, y);
    });
    [[0, 0, 2.6], [3.8, 0, 2.6], [0, 2.8, 2.9], [3.8, 2.8, 2.9]].forEach(function (p, n) {
      b.solid('post' + n, 'post', p[0], p[1], 0, p[0] + 0.2, p[1] + 0.2, p[2], 'T');
    });
    b.solid('pole0', 'post', 0, -1.2, 0, 0.1, -1.1, 2.4, 'T'); b.solid('pole1', 'post', 3.9, -1.2, 0, 4.0, -1.1, 2.4, 'T');
    b.solid('back', 'wall', 0.2, 2.8, 0.2, 3.8, 3.0, 2.8, boardsV);
    b.solid('sideW', 'wall', 0, 0.2, 0.2, 0.1, 2.8, 1.2, function (xm, ym, zm, x, y, z) { return z % 3 === 0 ? 'T' : 'W'; });
    b.solid('sideE', 'wall', 3.9, 0.2, 0.2, 4.0, 2.8, 1.2, function (xm, ym, zm, x, y, z) { return z % 3 === 0 ? 'T' : 'W'; });
    // counter (entry gap x 2.8..3.8 = 1.0 m between the counter end and the east front post)
    b.fill(0.2, 0.2, 0.2, 2.7, 0.8, 0.9, function (xm, ym, zm, x) { return (x % 4 === 0) ? 'T' : 'W'; });
    b.fill(0.2, 0.1, 0.9, 2.8, 0.8, 1.0, 'W');
    b.col('counter', 'prop', 0.2, 0.1, 0.2, 2.8, 0.8, 1.0);
    b.fill(0.4, 0.3, 1.0, 0.8, 0.7, 1.3, function (xm, ym, zm) { return (xm < 0.5 || xm > 0.7 || zm > 1.2) ? 'T' : 'w'; });
    b.fill(0.5, 0.4, 1.2, 0.7, 0.6, 1.3, 'Y');
    b.fill(1.2, 0.3, 1.0, 1.6, 0.7, 1.35, function (xm, ym, zm) {
      return (zm > 1.25 && (Math.abs(xm - 1.4) > 0.15 || Math.abs(ym - 0.5) > 0.15)) ? null : (zm > 1.3 ? 'r' : 'k');
    });
    b.fill(2.0, 0.3, 1.0, 2.5, 0.7, 1.2, 'w'); b.fill(2.05, 0.35, 1.1, 2.45, 0.65, 1.2, 'E');      // a crate of red apples
    // shelving unit across the back (x 0.1..3.9 so no slot by the side boards), barrel + crates below
    b.fill(0.1, 2.3, 0.2, 0.2, 2.8, 2.0, 'T'); b.fill(3.8, 2.3, 0.2, 3.9, 2.8, 2.0, 'T');
    b.fill(0.2, 2.4, 1.3, 3.8, 2.8, 1.4, 'W'); b.fill(0.2, 2.4, 1.9, 3.8, 2.8, 2.0, 'W');
    for (var j = 0; j < 8; j++) {
      var jx = 0.4 + j * 0.42, jz = (j % 2) ? 1.4 : 2.0, jc = ['L', 'D', 'c', 'L'][j % 4];
      b.fill(jx, 2.5, jz, jx + 0.2, 2.7, jz + 0.2 + (j % 3) * 0.1, jc);
    }
    b.fill(0.3, 2.4, 0.2, 1.3, 2.8, 0.8, function (xm, ym, zm) { return (zm > 0.7 || xm < 0.4 || xm > 1.2) ? 'T' : 'w'; });
    b.fill(2.3, 2.3, 0.2, 2.8, 2.8, 1.0, function (xm, ym, zm) {
      var d = Math.sqrt((xm - 2.55) * (xm - 2.55) + (ym - 2.55) * (ym - 2.55));
      if (d > 0.25 - (Math.abs(zm - 0.6) > 0.3 ? 0.05 : 0)) return null;
      return (Math.abs(zm - 0.35) < 0.05 || Math.abs(zm - 0.85) < 0.05) ? 'I' : 'W';
    });
    b.col('shelves', 'prop', 0.1, 2.3, 0.2, 3.9, 2.8, 2.0);
    // striped awning: 2.9 m at the back -> 2.48 m at the front pole line, scalloped valance (bottom >= 2.15 m)
    b.fill(-0.2, -1.2, 2.1, 4.2, 3.0, 3.0, function (xm, ym, zm) {
      var zt = 2.6 + 0.1 * ym, stripe = (Math.floor((xm + 0.2) / 0.5) % 2) ? 'E' : 'C';
      if (zm <= zt && zm >= zt - 0.1) return stripe;
      if (ym < -1.1 && zm < zt && zm >= zt - 0.3 && (zm >= zt - 0.2 || Math.floor((xm + 0.2) / 0.25) % 2 === 0)) return stripe === 'C' ? 'c' : 'E';
      return null;
    });
    b.fill(0, -1.1, 2.3, 0.1, 0, 2.4, 'r'); b.fill(3.9, -1.1, 2.3, 4.0, 0, 2.4, 'r');      // tie ropes pole -> post
    b.col('awning', 'roof', -0.2, -1.2, 2.6, 4.2, 3.0, 2.9);
    b.mount('trader', 1.5, 1.5, 0.2); b.mount('sign', 2.0, -1.2, 2.5);
    b.finish({
      desc: 'Trade post: open timber stall on a plank deck (0.2 m step), counter with a crate, a sack and a crate of apples, ' +
            'shelves with jars, a barrel and crates on the back wall, half-height side boards, and a red / canvas striped ' +
            'awning on two front poles with a scalloped valance (headroom >= 2.15 m). Trader stands behind the counter.',
      sizeM: [4.0, 4.2, 2.9],
      walk: { doors: [{ id: 'entry', wall: 'N', box: [2.8, 0, 0.2, 3.8, 0.8, 2.6] }],
              spots: { trader: [1.5, 1.5, 0.2], customer: [1.5, -0.6, 0] } }
    });
  })();

  // ---------------------------------------------------------------------------------------------------- 5. modular pieces
  (function () {
    var b = new Bld({ id: 'bldStairsStone', min: [0, 0], max: [1.6, 2.0, 1.0], anchor: [0.8, 0] });
    var st = stoneTex(51), steps = [];
    for (var i = 1; i <= 3; i++) {
      var y0 = r2((i - 1) * 0.4), top = r2(0.25 * i);
      b.solid('s' + i, 'step', 0, y0, 0, 1.6, r2(y0 + 0.4), top, function (xm, ym, zm, x, y, z) {
        if (zm > top - 0.1 && ym < y0 + 0.1) return 'L';                 // worn nosing
        if (xm < 0.1 || xm > 1.5) return (zm < 0.3 && hash(x, y, z, 52) < 0.4) ? 'M' : 'D';
        return st(xm, ym, zm, x, y, z);
      });
      steps.push('s' + i);
    }
    b.solid('landing', 'landing', 0, 1.2, 0, 1.6, 2.0, 1.0, function (xm, ym, zm, x, y, z) {
      if (zm > 0.9) return (hash(x >> 1, y >> 1, 0, 53) < 0.12 && (xm < 0.2 || xm > 1.4)) ? 'm' : 'L';
      return (xm < 0.1 || xm > 1.5) ? 'D' : st(xm, ym, zm, x, y, z);
    });
    steps.push('landing');
    b.finish({ desc: 'Outdoor stone stair: 1.6 m wide, 3 treads 0.4 m deep + 0.8 m top landing, 4 risers of 0.25 m = 1.0 m, ' +
                     'pale worn nosings, dark cheek stones with moss. Tops out level with bldWallLow (terrace edge kit).',
               sizeM: [1.6, 2.0, 1.0], walk: { stairs: [{ id: 'flight', axis: '+y', steps: steps }] } });

    b = new Bld({ id: 'bldWallLow', min: [0, -0.1], max: [2.0, 0.6, 1.0], anchor: [1.0, 0.25] });
    st = stoneTex(54, { moss: true });
    b.solid('wall', 'wall', 0, 0, 0, 2.0, 0.5, 0.9, st);
    b.fill(0, -0.1, 0.9, 2.0, 0.6, 1.0, function (xm, ym, zm, x, y) { return hash(x >> 1, y, 0, 55) < 0.15 ? 'm' : (x % 5 === 0 ? 'D' : 'L'); });
    b.col('coping', 'wall', 0, -0.1, 0.9, 2.0, 0.6, 1.0);
    b.finish({ desc: 'Low stone wall segment, 2.0 m, coursed, mossy foot, pale coping stones 0.1 m proud each side. ' +
                     'Tiles end to end; 1.0 m high = the top of bldStairsStone.', sizeM: [2.0, 0.7, 1.0] });

    function post(bb, x0) {
      bb.fill(x0, 0, 0, x0 + 0.2, 0.2, 1.2, function (xm, ym, zm) {
        if (zm > 1.1 && (xm > x0 + 0.1 || ym > 0.1)) return null;                       // cut, weathered top
        return zm < 0.15 ? 'D' : 'T';
      });
    }
    b = new Bld({ id: 'bldFence', min: [0, 0], max: [2.0, 0.2, 1.2], anchor: [1.0, 0.1] });
    post(b, 0);
    [0.4, 0.9].forEach(function (zr) {
      b.fill(0.2, 0.1, zr, 2.0, 0.2, zr + 0.1, function (xm, ym, zm, x) { return hash(x >> 2, 0, 0, 56) < 0.2 ? 'T' : 'W'; });
    });
    b.col('fence', 'wall', 0, 0, 0, 2.0, 0.2, 1.2);
    b.finish({ desc: 'Split-rail fence segment, 2.0 m: one oak post (stone-dark foot, cut top) + two split rails (lighter / darker lengths). ' +
                     'Tiles end to end; close a run with bldFencePost.', sizeM: [2.0, 0.2, 1.2] });
    b = new Bld({ id: 'bldFencePost', min: [0, 0], max: [0.2, 0.2, 1.2], anchor: [0.1, 0.1] });
    post(b, 0); b.col('post', 'post', 0, 0, 0, 0.2, 0.2, 1.2);
    b.finish({ desc: 'Fence end post (0.2 x 0.2 x 1.2 m).', sizeM: [0.2, 0.2, 1.2] });
  })();

  // ---------------------------------------------------------------------------------------------------- 6. watchtower
  (function () {
    var S = 3.6, PZ = 4.0, eaveZ = 6.2, rs = 0.8;
    var b = new Bld({ id: 'bldWatchtower', min: [-1.3, -2.7], max: [S + 0.5, S + 0.5, 8.4], anchor: [S / 2, S / 2] });
    function roofZ(xm, ym) { return eaveZ + (S / 2 + 0.4 - Math.max(Math.abs(xm - S / 2), Math.abs(ym - S / 2))) * rs; }
    // legs at the corners (flush with the platform edge), up to the roof underside
    [0, S - 0.3].forEach(function (lx) { [0, S - 0.3].forEach(function (ly) {
      b.fill(lx, ly, 0, lx + 0.3, ly + 0.3, 7.0, function (xm, ym, zm) { return zm < roofZ(xm, ym) - 0.15 ? 'T' : null; });
    }); });
    // ground sills, mid girts, X braces on the 4 faces (plane 0.1..0.2 inside the leg line)
    function face(fn) {                           // fn(u, zm) on each side; maps u (0..S along the side) into the plane
      b.fill(0.3, 0.1, 0, S - 0.3, 0.2, PZ - 0.2, function (xm, ym, zm) { return fn(xm, zm); });
      b.fill(0.3, S - 0.2, 0, S - 0.3, S - 0.1, PZ - 0.2, function (xm, ym, zm) { return fn(xm, zm); });
      b.fill(0.1, 0.3, 0, 0.2, S - 0.3, PZ - 0.2, function (xm, ym, zm) { return fn(ym, zm); });
      b.fill(S - 0.2, 0.3, 0, S - 0.1, S - 0.3, PZ - 0.2, function (xm, ym, zm) { return fn(ym, zm); });
    }
    face(function (u, zm) {
      if (zm < 0.2 || Math.abs(zm - 1.9) < 0.1) return 'T';
      var lo = zm < 1.9 ? 0.2 : 2.0, hi = zm < 1.9 ? 1.8 : PZ - 0.4, f = (zm - lo) / (hi - lo), a = 0.3 + f * (S - 0.6);
      return (Math.abs(u - a) < 0.12 || Math.abs(u - (S - a)) < 0.12) ? 'W' : null;
    });
    // platform: joists + plank floor, rails flush with the edge (gap on the west side y 1.9..3.3 for the stair)
    for (var jy = 0; jy < S; jy = r2(jy + 0.6)) b.fill(0, Math.min(jy, S - 0.2), PZ - 0.4, S, Math.min(jy, S - 0.2) + 0.2, PZ - 0.2, 'T');
    b.fill(0, 0, PZ - 0.2, S, S, PZ, function (xm, ym, zm, x, y) { return (xm < 0.1 || xm > S - 0.1 || ym < 0.1 || ym > S - 0.1) ? 'T' : plankX(xm, ym, zm, x, y); });
    function rail(x0, y0, x1, y1, id) {
      b.solid(id, 'rail', x0, y0, PZ, x1, y1, PZ + 1.0, function (xm, ym, zm) {
        if (zm < PZ + 0.3) return 'W';                                                   // kick boards
        return (Math.abs(zm - (PZ + 0.55)) < 0.05 || zm > PZ + 0.9) ? 'W' : null;
      });
    }
    rail(0.3, 0, S - 0.3, 0.1, 'railN'); rail(0.3, S - 0.1, S - 0.3, S, 'railS'); rail(S - 0.1, 0.3, S, S - 0.3, 'railE');
    rail(0, 0.3, 0.1, 1.9, 'railW'); b.fill(0, 1.7, PZ, 0.2, 1.9, PZ + 1.0, 'T');
    // closed (board-clad) stair: 16 risers of 0.25 m, 15 treads 0.3 m deep, 1.2 m wide, rising south to the landing
    var steps = [];
    for (var i = 1; i <= 15; i++) {
      var y0 = r2(1.9 - 4.5 + (i - 1) * 0.3), top = r2(0.25 * i);
      b.solid('s' + i, 'step', -1.2, y0, 0, 0, r2(y0 + 0.3), top, function (xm, ym, zm, x, y, z) {
        if (zm > top - 0.1) return ym < y0 + 0.1 ? 'W' : 'w';
        if (xm < -1.1 || xm > -0.1) return (x + z) % 3 === 0 ? 'T' : 'W';
        return ym < y0 + 0.1 ? 'T' : 'W';
      });
      steps.push('s' + i);
    }
    b.solid('landing', 'landing', -1.2, 1.9, 0, 0, 3.3, PZ, function (xm, ym, zm, x, y, z) {
      if (zm > PZ - 0.2) return plankX(xm, ym, zm, x, y);
      if ((xm < -1.0 && (ym < 2.1 || ym > 3.1))) return 'T';                           // corner posts
      return (y + z) % 3 === 0 ? 'T' : 'W';
    });
    steps.push('landing');
    rail(-1.2, 1.9, -1.1, 3.3, 'railLW'); rail(-1.2, 3.2, 0, 3.3, 'railLS');
    // pyramid shingle roof + finial
    b.fill(-0.4, -0.4, eaveZ - 0.3, S + 0.4, S + 0.4, 8.2, function (xm, ym, zm, x, y, z) {
      var zt = roofZ(xm, ym), d = S / 2 + 0.4 - Math.max(Math.abs(xm - S / 2), Math.abs(ym - S / 2));
      if (zm > zt || zm < zt - 0.2) return null;
      return d < 0.12 ? 'T' : shingleTex(xm, ym, zm, x, y, z);
    });
    var peak = eaveZ + (S / 2 + 0.4) * rs;
    b.fill(1.7, 1.7, peak - 0.3, 1.9, 1.9, peak + 0.2, 'T'); b.fill(1.7, 1.7, peak + 0.2, 1.9, 1.9, peak + 0.3, 'I');
    b.mount('lookout', S / 2, S / 2, PZ); b.mount('brazier', 2.7, 2.7, PZ); b.mount('lamp', S / 2, S / 2, 6.3);
    // colliders
    b.col('core', 'wall', 0, 0, 0, S, S, PZ - 0.2).col('platform', 'floor', 0, 0, PZ - 0.2, S, S, PZ);
    [[0, 0], [S - 0.3, 0], [0, S - 0.3], [S - 0.3, S - 0.3]].forEach(function (p, n) {
      b.col('leg' + n, 'post', p[0], p[1], PZ, r2(p[0] + 0.3), r2(p[1] + 0.3), eaveZ);
    });
    b.col('railWpost', 'rail', 0, 1.7, PZ, 0.2, 1.9, PZ + 1.0);
    b.col('roof', 'roof', -0.4, -0.4, eaveZ, S + 0.4, S + 0.4, r2(peak));
    b.finish({
      desc: 'Wooden watchtower: four oak corner legs with sills, girts and X braces, a 3.6 m plank platform at 4.0 m ' +
            'with kick-boarded rails, a closed board-clad stair (16 x 0.25 m risers, 1.2 m wide) and a landing on the ' +
            'west side, a pyramid shingle roof on the legs (headroom 2.3 m) with an iron-tipped finial.',
      sizeM: [S + 1.2, S + 2.6, r2(peak + 0.3)],
      walk: { levels: [{ name: 'ground', z: 0 }, { name: 'platform', z: PZ }],
              stairs: [{ id: 'west', axis: '+y', steps: steps }],
              doors: [{ id: 'railGap', wall: 'W', box: [0, 1.9, PZ, 0.1, 3.3, eaveZ] }],
              spots: { giver: [S / 2, S / 2, PZ], foot: [-0.6, -3.0, 0] } }
    });
  })();

  A.buildingsVoxel = { version: 1, story: 'OB-139', status: 'proposal', ids: IDS, materialKeys: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
