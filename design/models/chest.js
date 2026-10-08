/* design/models/chest.js - S8-A-06 treasure chests (designer, v1.42): a small chest and a big (boss) chest, closed /
 * opening / open, a 0.6 s lid clip on a back hinge, a gold light seam + "take me" glint while the loot is still inside.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_beast.js:
 *   <script src="../design/models/chest.js">           (browser, game/index.html, after voxel_beast.js)
 *   import '../../../design/models/chest.js';           (Node tests: side-effect import; module.exports below)
 * Sets ASSETS.voxelModels.chestSmall / chestBig, ASSETS.models.chestSmall / chestBig (the same records; there is no
 * billboard) and ASSETS.chestFx (clip map, timings, light + interact data for the sim / view, S8-C-06 / S8-B1-04).
 * Only ALREADY-MERGED materials (palette.materials AND detailPass.materials): no palette.js / detail-pass.js edit.
 * Format: design/README.md sections 7 + 16, architecture.md 15.1 (VoxelModelDef). Preview: design/preview/chest.html.
 *
 * Axes (15.1): x = east, y = SOUTH with y0 = the FRONT row (faces north at yaw 0: the lock side), z = up. y0 holds only
 * the proud lock plate (body part) and the lid hasp (lid part); the box itself is y1..sy-1.
 *
 * Look (Blood / Zelda chest, 3 hue families = wood brown, iron grey, brass gold; style guide rule 7):
 *   wood plank box (`wood`, grain + knots + seams from the material) on a dark timber base with iron feet; dark iron
 *   bottom band, top rim band and vertical straps (`iron_dark`); bright brass corner caps (`brass_light`); a brass lock
 *   plate with a dark keyhole on the front; a barrel lid with an iron rim at its lower edge, iron straps over the top and
 *   a hot-brass hasp hanging over the lock. The big chest adds double straps with hot-brass rivets, brass-trimmed lid
 *   ends, 2-voxel corner caps, a riveted side strap and a bigger lock plate.
 *   LOOT GLOW: one layer between the body top rim and the lid (the `loot` part) is `brass_glint` (white-gold, emissive
 *   0.90) round the edge with brass_hot specks inside. Closed, it reads as light leaking out of the seam all round the
 *   chest (dark iron above and below = the Blood contrast frame). Open, it is the glowing pool the item rises out of.
 *   After the grant (`opened`) the loot part is moved 64 voxels down (the lantern/relay hide trick, README 7 v1.14):
 *   the chest shows its dark empty inside and the light is gone.
 *   GLINT: a 5-voxel `brass_glint` plus stored sealed in the double floor (layer z1, like the lamp glint); clip `closed`
 *   shows it on the hasp front for 270 ms every ~2.5 s ( + x + twinkle; style guide: idle glints every 2-3 s, ~0.3 s).
 *
 * Parts (insertion order = part index; a parent must be EARLIER):
 *   glint  root  box = the 3x3x1 plus in the floor (sealed at rest), pivot = its centre
 *   body   root  box [0,0,0, sx,sy,zb]       pivot = footprint centre, bottom      (base, walls, floor, lock plate)
 *   loot   body  box [0,1,zb, sx,sy,zb+1]    pivot = the same                      (the light seam / pool layer)
 *   lid    body  box [0,0,zb, sx,sy,sz]      pivot [sx/2, sy, zb+1] = the HINGE: back face, lid bottom
 *                rot x NEGATIVE opens (the front edge swings up and back); -110 = open, resting just past vertical.
 * Clips (lane C: components.voxel.anim = the clip name; chestFx.clipFor maps sim state -> clip):
 *   closed  loop, step, [2200, 90, 90, 90]: key 0 rest; keys 1-3 the glint on the hasp front (+ / x / +).
 *   open    0.6 s, linear, non-loop, held at the end: 60 latch pop (body hops 0.6 voxel, lid cracks -10: light gasps
 *           out) / 90 catch (-6) / 60 swing (-65) / 110 overshoot (-118) / 120 bounce (-104) / 90 settle (-110) / 70 hold.
 *           events: unlatch 1, swing 3, thud 5 (lid hits its stop: sound + dust at mounts.dust), reveal 6 (item rises
 *           from mounts.loot, item-get card).   sum(durations) = 600 ms = chestFx.openMs.
 *   opened  1 frame, loop: lid -110, loot hidden (after the grant, and on load from a save with the chest opened).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  // one char per material; every key is already merged in palette.materials + detailPass.materials
  var MATS = {
    w: 'wood',          // planks: box walls, lid
    t: 'timber_old',    // base boards, floor, lid underside (dark old wood)
    d: 'iron_dark',     // feet, bands, straps, rims, keyhole
    R: 'brass_light',   // corner caps, lock plate rim, hasp, big-chest lid trim
    H: 'brass_hot',     // hasp tongue, rivets, gold specks in the light pool (emissive 0.10)
    b: 'brass_dark',    // big lock plate body
    G: 'brass_glint'    // the light seam / pool + the glint (emissive 0.90)
  };

  var SPEC = {
    chestSmall: {
      sx: 14, sy: 9, zb: 6, cellM: 0.05,
      lidInset: [0, 0, 1, 2],                // barrel lid: y inset per lid layer (front and back)
      bands: [2, 11], sideBands: [], studs: false, capH: 1, feet: 2, endTrim: 'd',
      plate: { x0: 5, zTop: 5, rows: ['RRRR', 'RddR', '.RR.'] },
      hasp:  { x0: 6, zTop: 7, rows: ['RR', 'HH'] },
      glint: { x0: 6, y0: 3 }
    },
    chestBig: {
      sx: 22, sy: 15, zb: 10, cellM: 0.05,
      lidInset: [0, 0, 0, 1, 2, 3, 5],
      bands: [3, 4, 17, 18], sideBands: [7, 8], studs: true, capH: 2, feet: 3, endTrim: 'R',
      plate: { x0: 8, zTop: 9, rows: ['RRRRRR', 'RbHHbR', 'RbddbR', 'RbbbbR', '.RRRR.'] },
      hasp:  { x0: 10, zTop: 12, rows: ['RR', 'RR', 'HH'] },
      glint: { x0: 10, y0: 6 }
    }
  };

  function hash3(x, y, z) {   // deterministic, no Math.random
    var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }

  function build(S) {
    var sx = S.sx, sy = S.sy, zb = S.zb, zs = zb, nl = S.lidInset.length, sz = zs + 1 + nl;
    var yHi = sy - 1, g = [], x, y, z, i, j, c;
    for (z = 0; z < sz; z++) { g.push([]); for (y = 0; y < sy; y++) { g[z].push([]); for (x = 0; x < sx; x++) g[z][y].push('.'); } }
    function set(x, y, z, ch) { g[z][y][x] = ch; }
    function band(x) { return S.bands.indexOf(x) >= 0; }

    // z0: base boards + iron feet at the corners
    for (y = 1; y <= yHi; y++) for (x = 0; x < sx; x++) {
      set(x, y, 0, (x < S.feet || x >= sx - S.feet) && (y < 1 + S.feet || y > yHi - S.feet) ? 'd' : 't');
    }
    // body walls z1..zb-1, floor z1..z2
    for (z = 1; z < zb; z++) for (y = 1; y <= yHi; y++) for (x = 0; x < sx; x++) {
      var ex = x === 0 || x === sx - 1, ey = y === 1 || y === yHi;
      if (!ex && !ey) { if (z <= 2) set(x, y, z, 't'); continue; }
      var stud = S.studs && z % 3 === 0;
      if (ex && ey) c = (z === zb - 1 || z === 1 || (S.capH > 1 && (z === zb - 2 || z === 2))) ? 'R' : 'd';
      else if (z === zb - 1 || z === 1) c = 'd';
      else if (ey && band(x)) c = stud ? 'H' : 'd';
      else if (ex && S.sideBands.indexOf(y) >= 0) c = stud ? 'H' : 'd';
      else c = 'w';
      set(x, y, z, c);
    }
    // glint plus, sealed in the double floor (z1; z0 below and z2 above are solid, the box corners stay empty)
    var gx = S.glint.x0, gy = S.glint.y0;
    for (j = 0; j < 3; j++) for (i = 0; i < 3; i++) set(gx + i, gy + j, 1, (i === 1 || j === 1) ? 'G' : '.');
    // lock plate on the proud front row y0 (body part)
    for (i = 0; i < S.plate.rows.length; i++) for (j = 0; j < S.plate.rows[i].length; j++) {
      c = S.plate.rows[i].charAt(j); if (c !== '.') set(S.plate.x0 + j, 0, S.plate.zTop - i, c);
    }
    // loot layer z = zs: glint seam round the edge, a white-gold pool with hot-brass specks inside
    for (y = 1; y <= yHi; y++) for (x = 0; x < sx; x++) {
      var edge = x === 0 || x === sx - 1 || y === 1 || y === yHi;
      set(x, y, zs, edge ? 'G' : (hash3(x, y, zs) < 35 ? 'H' : 'G'));
    }
    // lid z = zs+1 .. sz-1 (barrel)
    for (i = 0; i < nl; i++) {
      z = zs + 1 + i;
      var ylo = 1 + S.lidInset[i], yhi = yHi - S.lidInset[i], top = i === nl - 1;
      for (y = ylo; y <= yhi; y++) for (x = 0; x < sx; x++) {
        var lx = x === 0 || x === sx - 1, ly = y === ylo || y === yhi;
        if (i === 0) c = lx && ly ? 'R' : (lx || ly) ? 'd' : 't';
        else if (band(x)) c = S.studs && ((ly && i % 2 === 1) || (top && y % 3 === 0)) ? 'H' : 'd';
        else if (lx) c = (ly || top) ? S.endTrim : 'w';
        else c = 'w';
        set(x, y, z, c);
      }
    }
    // hasp on y0 (lid part: it starts at z = zs)
    for (i = 0; i < S.hasp.rows.length; i++) for (j = 0; j < S.hasp.rows[i].length; j++) {
      c = S.hasp.rows[i].charAt(j); if (c !== '.') set(S.hasp.x0 + j, 0, S.hasp.zTop - i, c);
    }
    var layers = g.map(function (L) { return L.map(function (r) { return r.join(''); }); });
    return { layers: layers, sz: sz, zs: zs };
  }

  var OPEN_DEG = -110;
  function record(key, S, desc) {
    var B = build(S), sx = S.sx, sy = S.sy, sz = B.sz, zs = B.zs;
    var cx = sx / 2, cy = (1 + sy) / 2;
    var gp = [S.glint.x0 + 1.5, S.glint.y0 + 1.5, 1.5];                       // glint rest centre
    var hz = S.hasp.zTop + 1 - S.hasp.rows.length / 2;                          // hasp centre z
    var hx = S.hasp.x0 + S.hasp.rows[0].length / 2;                             // hasp centre x
    var GP = [hx - gp[0], -0.65 - gp[1], hz - gp[2]];                           // glint 0.15 voxel proud of the hasp
    var hide = [0, 0, -64];
    var voxel = {
      version: 1,
      cellM: S.cellM,
      size: [sx, sy, sz],
      anchor: [cx, cy, 0],                       // footprint centre, bottom (y0 lock row excluded)
      meshOnly: true,                            // mesh path only (ME-19a), like the boar; fits the DDA limits anyway
      mats: MATS,
      layers: B.layers,
      parts: {
        glint: { box: [S.glint.x0, S.glint.y0, 1, S.glint.x0 + 3, S.glint.y0 + 3, 2], pivot: gp },
        body:  { box: [0, 0, 0, sx, sy, zs], pivot: [cx, cy, 0] },
        loot:  { box: [0, 1, zs, sx, sy, zs + 1], pivot: [cx, cy, 0], parent: 'body' },
        lid:   { box: [0, 0, zs, sx, sy, sz], pivot: [cx, sy, zs + 1], parent: 'body' }
      },
      animations: {
        closed: { durations: [2200, 90, 90, 90], loop: true, interp: 'step', frames: [
          {},
          { glint: { rot: [90, 0, 0], pos: GP } },
          { glint: { rot: [90, 45, 0], pos: GP } },
          { glint: { rot: [90, 0, 0], pos: GP } }
        ] },
        open: { durations: [60, 90, 60, 110, 120, 90, 70], loop: false,
                events: { unlatch: 1, swing: 3, thud: 5, reveal: 6 }, frames: [
          { body: { pos: [0, 0, 0] },   lid: { rot: [0, 0, 0] } },
          { body: { pos: [0, 0, 0.6] }, lid: { rot: [-10, 0, 0] } },
          { body: { pos: [0, 0, 0] },   lid: { rot: [-6, 0, 0] } },
          { lid: { rot: [-65, 0, 0] } },
          { lid: { rot: [-118, 0, 0] } },
          { lid: { rot: [-104, 0, 0] } },
          { lid: { rot: [OPEN_DEG, 0, 0] } }
        ] },
        opened: { durations: [1000], loop: true, frames: [{ lid: { rot: [OPEN_DEG, 0, 0] }, loot: { pos: hide } }] }
      },
      mounts: {
        prompt: { at: [cx, 0, sz + 2], part: 'body' },        // above the front top edge
        loot:   { at: [cx, cy, zs + 1], part: 'body' },       // top of the light pool: the item rises from here
        light:  { at: [cx, cy, zs + 2], part: 'body' },       // warm point light (chestFx.light)
        dust:   { at: [cx, sy + 0.5, zs + 1], part: 'body' }, // behind the hinge: thud dust
        hinge:  { at: [cx, sy, zs + 1], part: 'lid' },
        glint:  { at: [hx, -0.5, hz], part: 'lid' }           // hasp front (spare: billboard sparkle)
      }
    };
    return {
      name: key, desc: desc, voxel: voxel,
      world: { w: +(sx * S.cellM).toFixed(3), d: +((sy - 1) * S.cellM).toFixed(3), h: +(sz * S.cellM).toFixed(3) },
      interact: { prompt: '[E] Open', radius: 1.6, facingDeg: 70, from: 'front',
                  note: 'radius from the anchor (footprint centre); facing = player forward within 70 deg of the chest ' +
                        'centre AND the player in the front half-plane (local -y). Sim owns the numbers (S8-C-06 data fields); these are defaults.' },
      readability: { note: 'see design/preview/chest.html captions: rows x cols at 1.6 m and 6 m, 240x90 / 400x150' }
    };
  }

  A.voxelModels.chestSmall = record('chestSmall', SPEC.chestSmall,
    'Small treasure chest (S8-A-06), 0.70 x 0.40 x 0.55 m: wood planks, iron bands / straps / feet, brass corner caps, ' +
    'brass lock plate + hasp, barrel lid on a back hinge. Gold light seam + hasp glint while closed; 0.6 s open.');
  A.voxelModels.chestBig = record('chestBig', SPEC.chestBig,
    'Big (boss / key-item) treasure chest (S8-A-06), 1.10 x 0.70 x 0.90 m: the small chest\'s language, doubled iron ' +
    'straps with hot-brass rivets, brass-trimmed lid ends, 2-voxel corner caps, riveted side strap, big lock plate.');
  A.models.chestSmall = A.voxelModels.chestSmall;
  A.models.chestBig = A.voxelModels.chestBig;

  A.chestFx = {
    note: 'S8-A-06 view data for S8-C-06 (chest sim) / S8-B1-04 (hook). Sim state -> clip; events come from the open clip.',
    models: ['chestSmall', 'chestBig'],
    clipFor: { closed: 'closed', opening: 'open', open: 'opened' },
    openMs: 600,                                   // = sum(open.durations); the sim timer
    events: { unlatch: 1, swing: 3, thud: 5, reveal: 6 },
    revealMs: 530,                                 // start of key 6 (60+90+60+110+120+90): item rises / card may start
    light: {                                       // ENGINE NOTE: point light at mounts.light (emissive voxels do not light the scene)
      color: 'lantern',
      closed: { intensity: 0.25, radius: 1.4 },    // faint warm glow on the ground while the loot is inside
      open:   { intensity: 0.90, radius: 2.6, fromMs: 60 },   // the burst from the latch pop until the grant
      opened: { intensity: 0 }
    },
    particles: { thud: 'dust', note: 'optional: a small dust puff at mounts.dust on event thud (particles.js preset `dust`)' },
    interact: { radius: 1.6, facingDeg: 70, prompt: '[E] Open' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { chestSmall: A.voxelModels.chestSmall, chestBig: A.voxelModels.chestBig, chestFx: A.chestFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
