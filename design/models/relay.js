/*
 * Kestrel - the summit RELAY (D-011 reskin of the US-011 beacon bowl, for US-022 "wake the relay").
 * An aether-crystal cluster in a brass bowl, a brass-rimmed mirror behind it (cracked), on a brass tripod
 * with a gear hub (@). Magic (the crystal, teal) + machine (the mount, brass).
 * Format: design/README.md section 4 (+ 4.2). Sets ASSETS.models.relay.
 *
 * Animations (same names in lods.half, same frame counts, so a frame index is valid in both tiers):
 *   dead   loop, durations: long rest, then ONE crystal cell flickers dim teal ("something is in there")
 *   wake   once, 8 frames at 8 fps (1.0 s): the glow climbs from the core to the tips, the mirror catches it,
 *          sparkles rise, a flare on frame 5, settle. `wakeLightFrame` = when the engine switches lights.relay on.
 *   awake  loop, 4 frames at 6 fps (AC): calm shimmer, `* + . '` sparkles drift above the crystals.
 * mounts.glow (full and half LOD) = the centre crystal: the US-022 glow anchor (renamed from beaconBowl.mounts.fire).
 * The legacy `beaconBowl` + `beaconFire` (models/rubble.js, models/brazier.js) stay for old data; the level swap is
 * listed in models/wreckage.js `levelPatch.tower`.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- full size 13x7 (centre column 6) ----
  //            0123456789012
  var BASE = ['             ',   // 0 sparkles (awake only)
              '  .=/^^^-=.  ',   // 1 mirror rim (brass . =), mirror top edge (- , cracked /), crystal tips ^^^
              '  |:/\\|/\\:|  ', // 2 brass rim |, mirror :, crystals / \ | / \
              ' \\=o=====o=/ ',  // 3 bowl rim, rivets o
              '  \\=%===%=/  ',  // 4 bowl underside, verdigris %
              '    \\(@)/    ',  // 5 stem, gear hub (@)
              '   /  |  \\   ']; // 6 tripod legs
  // crystal cells [row, col] in a fixed order (tips first, then the body; index 5 = the tall centre crystal)
  var CRY = [[1, 5], [1, 6], [1, 7], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8]];
  var MIR = [[1, 4], [1, 8], [2, 3], [2, 9]];      // mirror cells (the one at [1,4] is the crack '/')

  // base colour key per cell (brass mount), crystals / mirror are painted per frame
  function baseKeys(row, col, g) {
    if (g === ' ') return ' ';
    if (row === 1 || row === 2) return (g === '|' && (col === 2 || col === 10)) ? 'b' : 'B';   // rim | and . =
    if (row === 3) return g === 'o' ? 'H' : (g === '=' ? 'b' : 'D');
    if (row === 4) return g === '%' ? 'v' : 'D';
    if (row === 5) return g === '@' ? 'B' : (g === '\\' || g === '/' ? 'D' : 'b');
    return 'D';
  }
  function setCh(s, i, c) { return s.substr(0, i) + c + s.substr(i + 1); }

  // stage = { spark: row-0 string | null, cry: 8 keys, mir: key }
  function pad(s, w) { while (s.length < w) s += ' '; return s.slice(0, w); }
  BASE = BASE.map(function (r) { return pad(r, 13); });
  function build(stage) {
    var g = BASE.slice(), fg = [], r, c;
    if (stage.spark) g[0] = pad(stage.spark, 13);
    for (r = 0; r < g.length; r++) {
      var k = '';
      for (c = 0; c < g[r].length; c++) k += r === 0 ? (g[0].charAt(c) === ' ' ? ' ' : spark(g[0].charAt(c))) : baseKeys(r, c, g[r].charAt(c));
      fg.push(k);
    }
    CRY.forEach(function (p, i) { fg[p[0]] = setCh(fg[p[0]], p[1], stage.cry[i]); });
    MIR.forEach(function (p) { fg[p[0]] = setCh(fg[p[0]], p[1], stage.mir); });
    return { S: { glyphs: g, fg: fg, n: normals(g) } };
  }
  // sparkles use their own keys (same colours as W / X / A) so they can stay glyph-only (`fill: false`)
  function spark(ch) { return ch === '*' ? 'P' : ch === '+' ? 'Q' : 'R'; }
  function normals(g) {
    return g.map(function (row, r) {
      var o = '', first = -1, last = -1, c;
      for (c = 0; c < row.length; c++) if (row.charAt(c) !== ' ') { if (first < 0) first = c; last = c; }
      for (c = 0; c < row.length; c++) {
        o += row.charAt(c) === ' ' ? '.' : r === 3 ? 'u' : c === first ? 'l' : c === last ? 'r' : r >= 4 ? 'd' : 'f';
      }
      return o;
    });
  }

  // ---- half LOD 7x4 (centre column 3) ----
  var HBASE = [' .^^^. ',
               '\\=o=o=/',
               ' \\(@)/ ',
               ' /   \\ '];
  var HCRY = [[0, 2], [0, 3], [0, 4]];
  var HMIR = [[0, 1], [0, 5]];
  function hbuild(stage) {
    var g = HBASE.slice(), fg = [];
    fg.push(' ' + 'B' + '   ' + 'B' + ' ');
    fg.push('DbHbHbD');
    fg.push(' DbBbD ');
    fg.push(' D   D ');
    var hk = [stage.cry[0], stage.cry[5], stage.cry[2]];
    HCRY.forEach(function (p, i) { fg[p[0]] = setCh(fg[p[0]], p[1], hk[i]); });
    HMIR.forEach(function (p) { fg[p[0]] = setCh(fg[p[0]], p[1], stage.mir === 'M' ? 'B' : stage.mir); });
    return { S: { glyphs: g, fg: fg } };
  }

  // ---- stages ----
  // keys: x dead crystal (lit), q dormant glint (e), A aether (e), X aetherLight (e), W aetherCore (e), n mirror glow (e)
  var DEAD = ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'];
  var GLINT = ['x', 'x', 'x', 'x', 'x', 'q', 'x', 'x'];
  var stDead = [{ spark: null, cry: DEAD, mir: 'M' }, { spark: null, cry: GLINT, mir: 'M' }];
  var stWake = [
    { spark: null,            cry: ['x', 'x', 'x', 'x', 'q', 'A', 'q', 'x'], mir: 'M' },
    { spark: null,            cry: ['x', 'q', 'x', 'q', 'A', 'X', 'A', 'q'], mir: 'M' },
    { spark: null,            cry: ['q', 'A', 'q', 'A', 'X', 'W', 'X', 'A'], mir: 'm' },
    { spark: '      .      ', cry: ['A', 'X', 'A', 'X', 'X', 'W', 'X', 'X'], mir: 'n' },
    { spark: '   .  +  .   ', cry: ['X', 'W', 'X', 'X', 'W', 'W', 'W', 'X'], mir: 'n' },
    { spark: " '. + * + .' ", cry: ['W', 'W', 'W', 'W', 'W', 'W', 'W', 'W'], mir: 'n' },   // flare
    { spark: "  '   *   .  ", cry: ['X', 'W', 'X', 'A', 'X', 'W', 'X', 'A'], mir: 'n' },
    { spark: "  '   *   .  ", cry: ['X', 'X', 'X', 'A', 'A', 'W', 'A', 'A'], mir: 'n' }
  ];
  var stAwake = [
    { spark: "  '   *   .  ", cry: ['X', 'X', 'X', 'A', 'A', 'W', 'A', 'A'], mir: 'n' },
    { spark: "   .  +  '   ", cry: ['X', 'W', 'X', 'A', 'X', 'W', 'A', 'A'], mir: 'n' },
    { spark: "  .   '   *  ", cry: ['W', 'X', 'X', 'A', 'A', 'W', 'X', 'A'], mir: 'n' },
    { spark: "    * . +    ", cry: ['X', 'X', 'W', 'A', 'A', 'W', 'A', 'X'], mir: 'n' }
  ];
  function frames(list, f) { return list.map(f); }

  A.models.relay = {
    name: 'relay',
    desc: 'The dead relay on the summit plinth: aether crystals in a brass bowl, cracked brass-rimmed mirror, brass tripod ' +
          'with a gear hub. Dead = grey crystals, dull mirror; awake = teal emissive crystals, the mirror glows, sparkles.',
    size: { w: 13, h: 7 }, anchor: { x: 6, y: 6 }, world: { w: 2.4, h: 1.75 },
    directions: ['S'], billboard: true,
    // BUG-OWN-003 (engine pending): solid bowl/mirror/crystals; the gaps between the tripod legs (row 6) and the
    // empty sparkle row are real holes (space keys), intended. ART-OWN-001 follow-up: a larger (~20x11) redraw.
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: {
      B: { c: 'brassLight' }, b: { c: 'brass' }, D: { c: 'brassDark' }, H: { c: 'brassHot' }, v: { c: 'verdigris' },
      M: { c: 'mirrorDark' }, m: { c: 'mirror' },
      x: { c: 'aetherDead' },
      q: { c: 'aetherDim', e: true }, A: { c: 'aether', e: true }, X: { c: 'aetherLight', e: true },
      W: { c: 'aetherCore', e: true }, n: { c: 'aetherMid', e: true },
      P: { c: 'aetherCore', e: true, fill: false }, Q: { c: 'aetherLight', e: true, fill: false }, R: { c: 'aether', e: true, fill: false }
    },
    variants: ['dead', 'awake'],
    animations: {
      dead:  { loop: true, durations: [3200, 160], frames: frames(stDead, build) },
      wake:  { fps: 8, loop: false, frames: frames(stWake, build) },
      awake: { fps: 6, loop: true, frames: frames(stAwake, build) }
    },
    // US-022 glow anchor (was beaconBowl.mounts.fire, D-011): the body cell of the tall centre crystal (CRY[5]).
    // In cells of this tier; world height = (anchor.y - y + 0.5) * world.h / size.h = 1.125 m (matches light.offset.z 1.1).
    mounts: { glow: { x: 6, y: 2, note: 'centre crystal body; US-022 glow / light anchor' } },
    lods: {
      half: { size: { w: 7, h: 4 }, anchor: { x: 3, y: 3 }, mounts: { glow: { x: 3, y: 0 } }, animations: {
        dead:  { loop: true, durations: [3200, 160], frames: frames(stDead, hbuild) },
        wake:  { fps: 8, loop: false, frames: frames(stWake, hbuild) },
        awake: { fps: 6, loop: true, frames: frames(stAwake, hbuild) }
      } }
    },
    light: { preset: 'relay', offset: { x: 0, y: 0, z: 1.1 }, on: 'awake',
             note: 'point light at the crystals (1.1 m above the anchor, plinth top 6.6 -> z 7.7); off while dead' },
    wakeLightFrame: 2,          // wake frame at which lights.relay starts its 1.0 s grow (palette lights.relay.grow)
    interact: { prompt: '[E] Wake the relay', radius: 1.8, requires: 'lantern',
                note: 'D-011: "bring the lamp to the crystal bowl". dead -> wake (once) -> awake (loop)' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
