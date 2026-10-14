/*
 * design/chargen/npc_looks.js - QFIX-S5a-4 / QFIX-S5c (NEEDS DESIGNER, owner D-082 / D-087 "quests given by characters",
 * D-074 humans = placeholder kit): the Post-keeper + the 10 region quest-giver looks, all on the EXISTING human kit base
 * `m_avg` (content/chargen/human.charkit.json). No new body, no palette edit: every look is a CharRecipe (same format as
 * design/chargen/recipes/fen.recipe.json / kit.looks.fen) using the kit's existing shells, ramps and slot chars, plus
 * 8 new HAT attachments (kit attachment format: slot 'hat', bone 'Head', anchor 'head_top', layers[z][y] string of x,
 * chars H h j = hat ramp light / base / dark, fixed chars y R k U u for badges / feathers, G g K = hair ramp).
 *
 * Classic script (no import/export, check-deps rule 4), same convention as human_kit.js:
 *   <script src="../chargen/npc_looks.js">     (browser; human_kit.js NOT required)
 *   require('design/chargen/npc_looks.js')      (Node: module.exports = ASSETS.npcLooks)
 *
 * API  ASSETS.npcLooks = {
 *   ids            ['npcPostKeeper', 'npcGlasswater', ... 'npcWhitecombs'] (11; region ids = content/quests/regions giverNpc)
 *   looks          { id: CharRecipe }   (v 1, kit kestrel.chargen.human, base m_avg; no `res` = kit default res)
 *   notes          { id: one-line description of the person (for the writer / PO) }
 *   hatIds         ['hatPost', 'hatBrim', 'sowester', 'capKnit', 'furHat', 'hood', 'headband', 'headbandFeather']
 *   buildHats(kit) -> [attachment]  the hats FITTED to the kit's own head + `short` hair (computed from the kit, so they
 *                                   follow any later head change); deterministic, no Math.random
 *   extendKit(kit) -> kit'          shallow copy: attachments + hats, looks + the 11 looks, random.hat + hats at weight 0
 *                                   (never drawn by the random generator). The input kit is not changed.
 *   validate(kit)  -> string[]      errors (hat layer sizes / chars / clip box, recipe ramps + items on extendKit(kit))
 *   modelId(id)    -> 'char.' + id   suggested model id for AssetRegistry
 * }
 *
 * GAME WIRING (programmer, not done here): like char.kit in game/js/main.js, per look
 *   const K2 = ASSETS.npcLooks.extendKit(K); composeCharacter(K2, K2.looks[id]) -> meshCharacter -> collapseRig ->
 *   riggedModelDef -> assets.add('model', 'char.' + id, ...), and the NPC entity uses voxel.model 'char.<id>'.
 *   Alternative: copy buildHats() into human_kit.js buildHumanKit() and re-run node tools/chargen-build-kit.mjs.
 *
 * HAT FIT RULES (why the boxes are what they are):
 *   - every hat lives in X -5..5, Y -9..8, z 59..71 (centred cells). At the kit default res {head: 2} a Head-bone
 *     attachment goes into the fine head block, kit.regions.head.box = X 13..23 (-5..5 centred), z 59..71: anything
 *     outside is CLIPPED by composeCharacter, and the grid ends at z 71. So no wide side brims and no tall crowns;
 *     brims reach out front / back (Y), crowns are 3 rows (7.5 cm) over the brim.
 *   - nothing is painted at or below the brow row in front of the face (faceTop = highest eye / brow cell), so eyes,
 *     brows and the face read under every hat.
 *   - `hood` hides the hair slot (the hood covers it); all other hats paint over the hair top and let the hair show
 *     below the brim / band at the sides and the back.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  var KIT_ID = 'kestrel.chargen.human';
  var BOX = { X0: -5, Y0: -9, z0: 59, w: 11, d: 18, h: 13 };   // X -5..5, Y -9..8, z 59..71

  function hash3(x, y, z) {   // deterministic 0..99 (same as pickups_voxel.js)
    var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function K(X, Y, z) { return X + ',' + Y + ',' + z; }

  // ------------------------------------------------------------------ head geometry from the kit (centred cells)
  function headGeo(kit) {
    var B = kit.bases.m_avg, S = B.size, CX = Math.floor(B.anchor[0]), CY = Math.floor(B.anchor[1]);
    var head = {}, hair = {}, faceTop = 0, front = {}, x, y, z, c, X, Y;
    for (z = BOX.z0; z < S[2]; z++) for (y = 0; y < S[1]; y++) {
      var row = B.layers[z][y];
      for (x = 0; x < S[0]; x++) {
        c = row.charAt(x);
        if (c === '.' || c === ' ' || c === '') continue;
        X = x - CX; Y = y - CY;
        head[K(X, Y, z)] = c;
        if ('becPi'.indexOf(c) >= 0 && z > faceTop) faceTop = z;
        if (Math.abs(X) === 2 && (front[z] === undefined || Y < front[z])) front[z] = Y;   // face plane beside the nose
      }
    }
    var hr = (kit.attachments || []).filter(function (a) { return a.slot === 'hair' && a.id === 'short'; })[0];
    if (hr) {
      var anc = B.anchors[hr.anchor], ox = anc[0] + hr.offset[0], oy = anc[1] + hr.offset[1], oz = anc[2] + hr.offset[2];
      for (z = 0; z < hr.box[2]; z++) for (y = 0; y < hr.box[1]; y++) for (x = 0; x < hr.box[0]; x++) {
        c = hr.layers[z][y].charAt(x);
        if (c === '.' || c === ' ') continue;
        hair[K(Math.round(ox + x) - CX, Math.round(oy + y) - CY, Math.round(oz + z))] = c;
      }
    }
    if (!faceTop) faceTop = 66;
    var g = {
      CX: CX, CY: CY, anc: B.anchors.head_top, faceTop: faceTop, zb: Math.min(faceTop + 2, S[2] - 4), zTop: S[2] - 1,
      head: function (X, Y, z) { return !!head[K(X, Y, z)]; },
      hair: function (X, Y, z) { return !!hair[K(X, Y, z)]; },
      any: function (X, Y, z) { return !!head[K(X, Y, z)] || !!hair[K(X, Y, z)]; },
      frontY: function (z) { return front[z] === undefined ? -4 : front[z]; }
    };
    g.near = function (fn, X, Y, z, r, planar) {
      for (var dz = planar ? 0 : -r; dz <= (planar ? 0 : r); dz++)
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) if (fn(X + dx, Y + dy, z + dz)) return true;
      return false;
    };
    g.extent = function (fn, z) {   // XY bounds of fn at row z
      var e = { x0: 99, x1: -99, y0: 99, y1: -99 };
      for (var Yq = -10; Yq <= 9; Yq++) for (var Xq = -9; Xq <= 9; Xq++) if (fn(Xq, Yq, z)) {
        e.x0 = Math.min(e.x0, Xq); e.x1 = Math.max(e.x1, Xq); e.y0 = Math.min(e.y0, Yq); e.y1 = Math.max(e.y1, Yq);
      }
      if (e.x0 > e.x1) e = { x0: -4, x1: 4, y0: -4, y1: 4 };
      return e;
    };
    // the open face: in front of the face plane, between the cheeks, up to one row over the brows
    g.faceOpen = function (X, Y, z) { return z <= faceTop + 1 && Math.abs(X) <= 3 && Y <= g.frontY(z) + 1; };
    return g;
  }

  // ------------------------------------------------------------------ hat shapes: fn(X, Y, z) -> slot char | null
  // Felt hat with a round crown, a band and a brim that dips at the front and back. o: {band, badge}
  function brimHat(g, o) {
    var zb = g.zb, e = g.extent(g.any, zb);
    var cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, crx = (e.x1 - e.x0) / 2 + 0.9, cry = (e.y1 - e.y0) / 2 + 0.9;
    var brx = 5.6, bry = cry + 2.6;
    function inC(X, Y, z) {
      if (z <= zb || z > g.zTop) return false;
      var s = z >= zb + 3 ? 0.74 : 1, dx = (X - cx) / (crx * s), dy = (Y - cy) / (cry * s);
      return dx * dx + dy * dy <= 1;
    }
    function inB(X, Y) { var dx = (X - cx) / brx, dy = (Y - cy) / bry; return dx * dx + dy * dy <= 1; }
    function dip(X, Y) { return Math.abs(Y - cy) > bry - 1.3; }   // front / back edge one row lower
    return function (X, Y, z) {
      if (inC(X, Y, z)) {
        var ring = !inC(X + 1, Y, z) || !inC(X - 1, Y, z) || !inC(X, Y + 1, z) || !inC(X, Y - 1, z);
        var isFront = !inC(X, Y - 1, z);
        if (o.badge && isFront && ((z === zb + 1 && Math.abs(X - cx) <= 1) || (z === zb + 2 && Math.abs(X - cx) < 0.6))) return o.badge;
        if (z === zb + 1 && ring) return o.band || 'j';
        if (!inC(X, Y, z + 1) && Math.abs(X - cx) < 0.6 && !ring) return 'j';             // the pinch crease along the top
        return hash3(X, Y, z) < 14 ? 'H' : 'h';
      }
      if (inB(X, Y) && !(z === zb && dip(X, Y)) && z === zb || (z === zb - 1 && inB(X, Y) && dip(X, Y))) {
        var edge = !inB(X + 1, Y) || !inB(X - 1, Y) || !inB(X, Y + 1) || !inB(X, Y - 1);
        return edge ? 'j' : 'h';
      }
      return null;
    };
  }
  // Sou'wester: low round crown, short front brim, long back flap sloping down over the neck, chin straps.
  function sowester(g) {
    var zb = g.zb, e = g.extent(g.any, zb);
    var cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, crx = (e.x1 - e.x0) / 2 + 0.9, cry = (e.y1 - e.y0) / 2 + 0.9;
    function inC(X, Y, z) {
      if (z <= zb || z > g.zTop) return false;
      var s = z >= zb + 2 ? 0.8 : 1, dx = (X - cx) / (crx * s), dy = (Y - cy) / (cry * s);
      return dx * dx + dy * dy <= 1;
    }
    function inB(X, Y) {
      var ry = Y <= cy ? cry + 1.3 : cry + 4.6, dx = (X - cx) / 5.6, dy = (Y - cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    function lvl(Y) { var b = Y - cy - cry; return b <= 0 ? zb : zb - Math.floor(b / 1.4) - 1; }   // brim row at this Y
    var strapY = Math.round(cy) - 1;
    return function (X, Y, z) {
      if (inC(X, Y, z)) return z === zb + 1 && (!inC(X + 1, Y, z) || !inC(X - 1, Y, z)) ? 'j' : (hash3(X, Y, z) < 18 ? 'H' : 'h');
      if (inB(X, Y)) {
        var L = lvl(Y), Lp = lvl(Y - 1);
        if (z === L || (z > L && z <= Lp)) {   // the brim row + the step up to the previous row (no gaps in the flap)
          var edge = !inB(X + 1, Y) || !inB(X - 1, Y) || !inB(X, Y + 1) || !inB(X, Y - 1);
          return edge ? 'H' : 'h';             // a lit rolled edge (oilskin)
        }
      }
      if ((X === 4 || X === -4) && Y === strapY && z >= g.faceTop - 4 && z < zb && !g.head(X, Y, z)) return 'j';
      return null;
    };
  }
  // Knitted cap hugging the skull: a turned-up band (2 rows) and ribbed knit above.
  function capKnit(g) {
    var zb = g.zb;
    return function (X, Y, z) {
      if (z < zb) return null;
      if (!g.any(X, Y, z) && !g.near(g.any, X, Y, z, 1)) return null;
      if (z <= zb + 1) return ((X + Y) & 1) ? 'j' : 'h';                       // turn-up, ribbed
      return (((X - Y) % 3) + 3) % 3 === 0 ? 'H' : 'h';                         // knit ribs
    };
  }
  // Round fur hat with ear flaps.
  function furHat(g) {
    var zb = g.zb, e = g.extent(g.any, zb), cy = (e.y0 + e.y1) / 2;
    return function (X, Y, z) {
      var flap = Math.abs(X) >= 4 && Math.abs(X) <= 5 && Y >= cy - 1.5 && Y <= cy + 2 && z >= g.faceTop - 4 && z < zb - 1 && !g.head(X, Y, z);
      if (!flap) {
        if (z < zb - 1 || g.faceOpen(X, Y, z)) return null;
        if (!g.any(X, Y, z) && !g.near(g.any, X, Y, z, z >= zb + 2 ? 1 : 2)) return null;
      }
      if (z >= zb + 3 && g.any(X, Y, z - 1) && !g.near(g.any, X, Y, z, 0)) return 'j';   // the cloth crown on top
      var h = hash3(X, Y, z);
      return h < 22 ? 'H' : h < 78 ? 'h' : 'j';                                         // fur, 3 tones
    };
  }
  // Hood (hides the hair): one cell round the face, two over the top and the back, a lit folded rim, a liripipe tail.
  function hood(g) {
    var zb = g.zb, eh = g.extent(g.head, g.faceTop), cyh = (eh.y0 + eh.y1) / 2, backY = -99, X, Y, z;
    function body(X, Y, z) {
      if (z < BOX.z0 || g.head(X, Y, z) || g.faceOpen(X, Y, z)) return false;
      if (g.near(g.head, X, Y, z, 1)) return true;
      return g.near(g.head, X, Y, z, 2) && (Y >= cyh || z >= zb);
    }
    for (z = zb - 2; z <= zb; z++) for (Y = -9; Y <= 8; Y++) for (X = -1; X <= 0; X++) if (body(X, Y, z) && Y > backY) backY = Y;
    return function (X, Y, z) {
      if (body(X, Y, z)) {
        if (g.faceOpen(X, Y - 1, z) || g.faceOpen(X + 1, Y, z) || g.faceOpen(X - 1, Y, z) || g.faceOpen(X, Y, z - 1)) return 'H';   // rim
        if (!g.near(g.head, X, Y, z, 1)) return ((X + z) % 4 === 0 && Y > cyh) ? 'j' : 'h';                                         // outer layer + back folds
        return 'j';                                                                                                                   // inner layer
      }
      if ((X === -1 || X === 0) && Y === backY + 1 && z >= g.faceTop - 6 && z <= zb - 1) return z & 1 ? 'h' : 'j';                // liripipe tail
      return null;
    };
  }
  // Cloth band round the brow (one row over the brows), knot + two tails at the back; o.feather: a white feather.
  function headband(g, o) {
    var zb = g.zb, z0 = g.faceTop + 1, z1 = zb - 1, backY = -99, X, Y, z;
    function band(X, Y, z) { return z >= z0 && z <= z1 + 1 && z <= zb && !g.any(X, Y, z) && g.near(g.any, X, Y, z, 1, true); }
    for (Y = -9; Y <= 8; Y++) if (band(0, Y, z0)) backY = Math.max(backY, Y);
    var fx = 0;
    for (X = 5; X >= 0; X--) if (band(X, Math.round((backY - 3) / 2), z0)) { fx = X; break; }
    return function (X, Y, z) {
      if (band(X, Y, z) && z <= z0 + 1) return (Y === backY && (X === 0 || X === -1)) ? 'j' : (z === z0 + 1 ? 'H' : 'h');
      if ((X === 0 || X === -1) && Y === backY + 1 && z >= z0 - 4 && z <= z0) return X === 0 ? 'h' : 'j';                         // tails
      if (o.feather && X === fx && Y === Math.round((backY - 3) / 2) + 1 && z >= z0 && z <= g.zTop) return z === g.zTop ? 'U' : z === z0 ? 'u' : 'k';
      if (o.feather && X === fx && Y === Math.round((backY - 3) / 2) + 2 && z >= g.zTop - 1) return 'k';                           // vane leans back
      return null;
    };
  }

  var HATS = [
    { id: 'hatPost', make: function (g) { return brimHat(g, { band: 'R', badge: 'y' }); },
      desc: 'Post-keeper felt hat: round crown with a madder-red band and a small gold post badge at the front, brim dipping front and back' },
    { id: 'hatBrim', make: function (g) { return brimHat(g, { band: 'j' }); }, desc: 'Plain brimmed felt / straw hat, dark band, pinched crown' },
    { id: 'sowester', make: sowester, desc: 'Sou\'wester: low crown, short front brim, long back flap over the neck, lit rolled edge, chin straps' },
    { id: 'capKnit', make: capKnit, desc: 'Knitted cap hugging the skull, ribbed turn-up band' },
    { id: 'furHat', make: furHat, desc: 'Round fur hat in 3 tones with ear flaps and a cloth crown on top' },
    { id: 'hood', make: hood, hides: ['hair'], desc: 'Loose hood: lit folded rim round the face, inner shadow layer, back folds, liripipe tail' },
    { id: 'headband', make: function (g) { return headband(g, {}); }, desc: 'Cloth band round the brow, knot and two tails at the back' },
    { id: 'headbandFeather', make: function (g) { return headband(g, { feather: true }); }, desc: 'Brow band + a white feather with a dark tip on the right side' }
  ];

  function buildHats(kit) {
    var g = headGeo(kit), anc = g.anc;
    return HATS.map(function (H) {
      var fn = H.make(g), layers = [], x, y, z;
      for (z = 0; z < BOX.h; z++) {
        var L = [];
        for (y = 0; y < BOX.d; y++) {
          var row = '';
          for (x = 0; x < BOX.w; x++) row += fn(BOX.X0 + x, BOX.Y0 + y, BOX.z0 + z) || '.';
          L.push(row);
        }
        layers.push(L);
      }
      var a = { id: H.id, slot: 'hat', bone: 'Head', anchor: 'head_top',
                offset: [r3(BOX.X0 + g.CX - anc[0]), r3(BOX.Y0 + g.CY - anc[1]), r3(BOX.z0 - anc[2])],
                box: [BOX.w, BOX.d, BOX.h] };
      if (H.hides) a.hides = H.hides.slice();
      a.desc = H.desc;
      a.layers = layers;
      return a;
    });
  }

  // ------------------------------------------------------------------ the 11 looks (existing ramps / shells only)
  function look(o) {
    return {
      v: 1, kit: KIT_ID, base: 'm_avg', height: o.height || 0, age: o.age || 'adult', skin: o.skin, eyes: o.eyes,
      hair: o.hair ? { id: 'short', ramp: o.hair } : null,
      beard: o.beard ? { id: 'full', ramp: o.beard } : null,
      top: { id: o.top[0], ramp: o.top[1] }, legs: { id: 'trousers', ramp: o.legs }, feet: { id: 'boots', ramp: o.feet },
      hands: o.hands ? { id: 'gloves', ramp: o.hands } : null,
      belt: o.sash ? { id: 'girdle', ramp: o.sash } : null,
      outer: o.belt ? { id: 'belt', ramp: o.belt } : null,
      cloak: o.cloak ? { id: 'cloak', ramp: o.cloak } : null,
      hat: { id: o.hat[0], ramp: o.hat[1] }
    };
  }
  var LOOKS = {
    npcPostKeeper: look({ skin: 'medium', eyes: 'brown', hair: 'grey', beard: 'grey', age: 'elder', top: ['tunic', 'woad'], legs: 'gall',
      feet: 'walnut', belt: 'walnut', cloak: 'madder', hat: ['hatPost', 'gall'] }),
    npcGlasswater: look({ skin: 'warm', eyes: 'green', hair: 'brown', beard: 'brown', height: 1, top: ['shirt', 'undyed'], legs: 'woad',
      feet: 'gall', belt: 'walnut', hat: ['capKnit', 'madder'] }),
    npcNorthwood: look({ skin: 'warm', eyes: 'brown', hair: 'darkbrown', beard: 'darkbrown', height: 2, top: ['tunic', 'walnut'], legs: 'walnut',
      feet: 'gall', belt: 'gall', cloak: 'lincoln', hands: 'walnut', hat: ['hood', 'lincoln'] }),
    npcHighPastures: look({ skin: 'brown', eyes: 'brown', hair: 'black', top: ['tunic', 'madder'], legs: 'undyed', feet: 'walnut',
      belt: 'walnut', hat: ['hatBrim', 'weld'] }),
    npcAshMile: look({ skin: 'dark', eyes: 'brown', hair: 'black', beard: 'black', top: ['shirt', 'gall'], legs: 'walnut', feet: 'gall',
      sash: 'madder', hands: 'gall', hat: ['headband', 'madder'] }),
    npcDowns: look({ skin: 'fair', eyes: 'grey', hair: 'auburn', beard: 'auburn', height: -1, top: ['tunic', 'gall'], legs: 'undyed',
      feet: 'walnut', belt: 'walnut', cloak: 'undyed', hat: ['hood', 'undyed'] }),
    npcSignalHill: look({ skin: 'medium', eyes: 'grey', hair: 'black', beard: 'black', height: 2, top: ['mail', 'undyed'], legs: 'woad',
      feet: 'gall', belt: 'walnut', cloak: 'woad', hat: ['capKnit', 'woad'] }),
    npcHeath: look({ skin: 'warm', eyes: 'green', hair: 'blond', age: 'young', top: ['tunic', 'weld'], legs: 'lincoln', feet: 'walnut',
      belt: 'walnut', cloak: 'walnut', hat: ['headbandFeather', 'madder'] }),
    npcReedmire: look({ skin: 'warm', eyes: 'brown', hair: 'black', height: 1, top: ['tunic', 'lincoln'], legs: 'gall', feet: 'gall',
      belt: 'gall', cloak: 'gall', hat: ['hood', 'gall'] }),
    npcStrand: look({ skin: 'brown', eyes: 'grey', hair: 'grey', beard: 'grey', age: 'elder', top: ['shirt', 'undyed'], legs: 'woad',
      feet: 'gall', belt: 'walnut', cloak: 'weld', hat: ['sowester', 'weld'] }),
    npcWhitecombs: look({ skin: 'fair', eyes: 'green', hair: 'blond', beard: 'blond', height: 1, top: ['tunic', 'madder'], legs: 'walnut',
      feet: 'walnut', belt: 'walnut', cloak: 'walnut', hands: 'walnut', hat: ['furHat', 'undyed'] })
  };
  var NOTES = {
    npcPostKeeper: 'Crossroads post-keeper (elder): woad-blue tunic under a madder-red shoulder cape, dark felt hat with a red band and gold post badge, grey beard.',
    npcGlasswater: 'Glasswater lake fisher: white linen shirt, woad trousers, red knitted cap, brown beard.',
    npcNorthwood: 'Northwood hunter (tall): green hood + green cape over a walnut tunic, leather gloves, dark beard.',
    npcHighPastures: 'High Pastures herder: straw-yellow brimmed hat, madder-red tunic, pale trousers, clean-shaven.',
    npcAshMile: 'Ash Mile charcoal-burner: sooty grey shirt, red waist sash and red sweat-band, dark gloves, black beard.',
    npcDowns: 'Downs shepherd (short): white wool hood + white cape over a grey tunic, auburn beard.',
    npcSignalHill: 'Signal Hill watchman (tall): mail shirt, woad-blue cape and blue knitted coif, black beard.',
    npcHeath: 'Heath forager (young): weld-yellow tunic, green trousers, walnut cape, red brow band with a white feather.',
    npcReedmire: 'Reedmire marsh-walker: dark grey hood + cape over a green tunic, grey trousers, clean-shaven.',
    npcStrand: 'Strand shore-walker (elder): yellow oilskin sou\'wester + yellow cape, linen shirt, blue trousers, grey beard.',
    npcWhitecombs: 'Whitecombs mountain guide: pale fur hat with ear flaps, walnut fur cape + gloves, red tunic, blond beard.'
  };
  var IDS = Object.keys(LOOKS);

  function extendKit(kit) {
    var k2 = {}, key;
    for (key in kit) k2[key] = kit[key];
    var hats = buildHats(kit), have = {};
    (kit.attachments || []).forEach(function (a) { have[a.slot + ':' + a.id] = 1; });
    k2.attachments = (kit.attachments || []).concat(hats.filter(function (h) { return !have['hat:' + h.id]; }));
    k2.looks = {};
    for (key in kit.looks || {}) k2.looks[key] = kit.looks[key];
    IDS.forEach(function (id) { k2.looks[id] = JSON.parse(JSON.stringify(LOOKS[id])); });
    if (kit.random) {
      k2.random = JSON.parse(JSON.stringify(kit.random));
      k2.random.hat = k2.random.hat || { none: 1 };
      hats.forEach(function (h) { if (k2.random.hat[h.id] === undefined) k2.random.hat[h.id] = 0; });
    }
    return k2;
  }

  function validate(kit) {
    var errs = [], k2 = extendKit(kit), slots = kit.slots || {};
    k2.attachments.filter(function (a) { return HATS.some(function (H) { return H.id === a.id; }); }).forEach(function (a) {
      var W = 'hat ' + a.id, n = 0;
      if (a.layers.length !== a.box[2]) errs.push(W + ': layers ' + a.layers.length + ' != box z ' + a.box[2]);
      a.layers.forEach(function (L, z) {
        if (L.length !== a.box[1]) errs.push(W + ': z' + z + ' rows ' + L.length);
        L.forEach(function (r, y) {
          if (r.length !== a.box[0]) errs.push(W + ': z' + z + ' y' + y + ' length ' + r.length);
          for (var x = 0; x < r.length; x++) { var c = r.charAt(x); if (c === '.') continue; n++; if (!slots[c]) errs.push(W + ': char "' + c + '" has no kit slot'); }
        });
      });
      if (!n) errs.push(W + ': empty');
      var reg = kit.regions && kit.regions.head && kit.regions.head.box, anc = kit.bases.m_avg.anchors[a.anchor];
      if (reg) {
        var gx0 = anc[0] + a.offset[0], gy0 = anc[1] + a.offset[1], gz0 = anc[2] + a.offset[2];
        if (gx0 < reg[0] || gx0 + a.box[0] - 1 > reg[3] || gy0 < reg[1] || gy0 + a.box[1] - 1 > reg[4] || gz0 < reg[2] || gz0 + a.box[2] - 1 > reg[5])
          errs.push(W + ': box leaves kit.regions.head.box (would be clipped at res head 2)');
      }
    });
    IDS.forEach(function (id) {
      var r = k2.looks[id], R = kit.ramps;
      if (!R.skin[r.skin]) errs.push(id + ': skin ' + r.skin);
      if (!R.eyes[r.eyes]) errs.push(id + ': eyes ' + r.eyes);
      ['legs', 'feet', 'top', 'hands', 'belt', 'outer', 'cloak', 'hair', 'beard', 'hat'].forEach(function (s) {
        var p = r[s];
        if (!p) return;
        var item = k2.shells.concat(k2.attachments).filter(function (i) { return i.slot === s && i.id === p.id; })[0];
        if (!item) errs.push(id + ': ' + s + ' item ' + p.id + ' not in the kit');
        var grp = s === 'beard' ? 'hair' : s;
        if (!R[grp] || !R[grp][p.ramp]) errs.push(id + ': ' + s + ' ramp ' + p.ramp + ' not in kit.ramps.' + grp);
      });
    });
    return errs;
  }

  A.npcLooks = {
    note: 'QFIX-S5a-4 / S5c NPC looks on the human kit base m_avg: 11 CharRecipes + 8 hats (no new body, no palette edit). Names NEEDS WRITER.',
    ids: IDS, looks: LOOKS, notes: NOTES, hatIds: HATS.map(function (H) { return H.id; }),
    hatBox: BOX, buildHats: buildHats, extendKit: extendKit, validate: validate,
    modelId: function (id) { return 'char.' + id; }
  };
  if (typeof module === 'object' && module && module.exports) module.exports = A.npcLooks;
})(typeof window !== 'undefined' ? window : globalThis);
