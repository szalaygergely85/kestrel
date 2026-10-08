/* design/items.js - Sprint 6 designer pass A (v1.34): item definitions, inventory icons, the boar loot table, the
 * loot toast style and the loot sprites (US-091a; icons also used by US-091b / HANDS-01).
 *
 * Classic script (no import/export, check-deps rule 4), loaded after design/palette.js:
 *   <script src="../design/items.js"></script>          (browser, game/index.html)
 *   import '../../../design/items.js';                    (Node tests: side-effect import)
 * Format: design/README.md section 13.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.items = { version, order, defs, keys, loot, toast, validate(palette) }
 *     defs[id]  = { id, name, kind, stackMax, desc, hand, inPack, use?, glyph: {ch, c}, icon: {glyphs[3], fg[3]},
 *                   sprite?, placeholderName: false }
 *     keys      = icon colour keys: one char -> { c: palette colour key, e?: true (emissive / glow) }
 *     loot      = drop tables (seeded rolls in game/js/quest/sim/loot.js; this file only holds the data)
 *     toast     = the "+1 Boar Meat" toast style (UI layer, literal RGB like uiStyle.vitals)
 *   ASSETS.lootSprites = { lootGlint, lootMeat, lootHide, lootTusk } (README 4 sprite format)
 *   ASSETS.items.attachSprites() -> copies ASSETS.lootSprites into ASSETS.models (call once at boot, like attachM3)
 *
 * RULES
 *   - Gameplay numbers that tune the fight (damage, mana cost, cooldowns) live in game/js/quest/*Config.js. The few
 *     numbers here (stack sizes, meat +10 HP, drop chances) are the design defaults the US-091a ACs name; a config
 *     may read them from here or copy them, but there is one source per number.
 *   - Names and descriptions are approved writer copy; ids never change (saves use the ids).
 *   - Icons: 5 x 3 cells (cells are ~1:1.5, so 5 x 3 reads about square), printable ASCII, a space glyph with a space
 *     fg key = transparent (the slot background shows). Every icon has a 1-cell `glyph` for the hands strip / toast.
 *   - Colour language: fire = flame + ember keys, HP = vital crimson, MP = mana blue, steel = mirror, bronze guard,
 *     meat = gore red (never danger red #ff3b3b: that colour belongs to the enemy bar), hide/tusk = earthy + ivory.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  // ---- icon colour keys (shared by every icon; one char = one palette key) ----
  var keys = {
    // steel + bronze (sword)
    S: { c: 'mirror' },        s: { c: 'ironLight' },     W: { c: 'white', e: true },
    Z: { c: 'bronzeLight' },   z: { c: 'bronze' },        l: { c: 'woodDark' },
    // fire (fireball, torch)
    C: { c: 'flameCore', e: true }, M: { c: 'flameMid', e: true }, O: { c: 'flameOuter', e: true },
    t: { c: 'flameTip', e: true },  e: { c: 'ember', e: true },     E: { c: 'emberHot', e: true },
    k: { c: 'emberDark', e: true },
    // wood / iron (torch shaft, band)
    w: { c: 'wood' },          i: { c: 'iron' },
    // meat
    R: { c: 'goreRedLight' },  r: { c: 'goreRed' },       d: { c: 'vitalDark' },
    f: { c: 'linen' },         b: { c: 'linenLight' },
    // hide
    H: { c: 'woodLight' },     h: { c: 'wood' },          D: { c: 'ropeDark' },
    // tusk
    T: { c: 'linenLight' },    u: { c: 'linen' },         n: { c: 'linenDark' },
    // HP flask (mirrors m3_props pickupHp)
    c: { c: 'vital' },         g: { c: 'mirror' },        G: { c: 'mirrorDark' },
    L: { c: 'vital', e: true }, P: { c: 'vitalLight', e: true },
    // MP shard (mirrors m3_props pickupMp)
    m: { c: 'mana', e: true }, q: { c: 'manaDark', e: true }, Q: { c: 'manaCore', e: true },
    // loot glint
    Y: { c: 'gold', e: true }, y: { c: 'brassHot', e: true }, a: { c: 'brass', e: true }
  };

  function icon(glyphs, fg) { return { w: 5, h: 3, glyphs: glyphs, fg: fg }; }

  var defs = {
    // ---------------- hand items ----------------
    sword: {
      id: 'sword', name: 'Ruin Steel', kind: 'weapon', stackMax: 1, hand: true, inPack: true,
      desc: 'Old watch steel. Nicked, still true.',
      glyph: { ch: '/', c: 'mirror' },
      //  .        cross-guard top
      // o+==>     pommel, guard, blade, point
      //  '        cross-guard bottom
      icon: icon([' .   ', 'o+==>', " '   "],
                 [' Z   ', 'zZSSW', ' z   '])
    },
    'spell.fireball': {
      id: 'spell.fireball', name: 'Ember', kind: 'spell', stackMax: 1, hand: true, inPack: true,
      desc: 'A coal that answers the hand.',
      glyph: { ch: '*', c: 'flameMid' },
      //  .^,      flame tips
      // (*@*)     the burning ball, white-hot core
      //  `~'      embers falling off
      icon: icon([' .^, ', '(*@*)', " `~' "],
                 [' tOt ', 'OMCMO', ' eke '])
    },
    torch: {
      id: 'torch', name: 'Torch', kind: 'tool', stackMax: 1, hand: true, inPack: true,
      desc: 'Pitch and rag on a stick. See by it.',
      glyph: { ch: '^', c: 'flameMid' },
      //  '^'      flame
      //  [#]      iron band round the burning head
      //   |       shaft
      icon: icon([" '^' ", ' [#] ', '  |  '],
                 [' tMt ', ' iEi ', '  w  '])
    },
    // ---------------- boar loot ----------------
    'boar.meat': {
      id: 'boar.meat', name: 'Boar Meat', kind: 'food', stackMax: 10, hand: false, inPack: true,
      desc: 'A haunch, still warm. Eat to heal.',
      use: { heal: 10, sound: 'eat', fullHpToast: 'Not hurt' },
      glyph: { ch: '%', c: 'goreRed' },
      sprite: 'lootMeat',
      //  ,--.     rind
      // (%##)     marbled meat
      //  `-=o     bone end
      icon: icon([' ,--.', '(%##)', ' `-=o'],
                 [' RRRR', 'rfrrd', ' ddbb'])
    },
    'boar.hide': {
      id: 'boar.hide', name: 'Boar Hide', kind: 'material', stackMax: 20, hand: false, inPack: true,
      desc: 'Coarse, bristled. Good for something.',
      use: { none: 'Material - no use yet' },
      glyph: { ch: '&', c: 'wood' },
      sprite: 'lootHide',
      // /^^^\     bristle ridge
      // |%:%|     the pelt
      // \/ \/     leg flaps
      icon: icon(['/^^^\\', '|%:%|', '\\/ \\/'],
                 ['hDDDh', 'hHhHh', 'hh hh'])
    },
    'boar.tusk': {
      id: 'boar.tusk', name: 'Boar Tusk', kind: 'material', stackMax: 20, hand: false, inPack: true,
      desc: 'Yellow ivory, sharp at the tip.',
      use: { none: 'Material - no use yet' },
      glyph: { ch: ')', c: 'linenLight' },
      sprite: 'lootTusk',
      //    ,'     tip (glint)
      //   //      the curve
      // (=/       root
      icon: icon(["   ,'", '  // ', '(=/  '],
                 ['   TW', '  uT ', 'nnu  '])
    },
    // ---------------- ground orbs (US-080b drops; NOT stored: used on touch) ----------------
    'orb.hp': {
      id: 'orb.hp', name: 'Herb Flask', kind: 'pickup', stackMax: 0, hand: false, inPack: false,
      desc: 'Bitter herbs under red wax. Heals.',
      use: { heal: 10, onTouch: true, note: 'existing pickups.js kind hp (PICKUP_AMOUNT 10); def is for the toast only' },
      glyph: { ch: '+', c: 'vital' },
      sprite: 'pickupHp',
      icon: icon([' _n_ ', '(#*#)', " `-' "],
                 [' cPc ', 'gLWLG', ' GGG '])
    },
    'orb.mp': {
      id: 'orb.mp', name: 'Cold Shard', kind: 'pickup', stackMax: 0, hand: false, inPack: false,
      desc: 'A sliver of teal light. Restores MP.',
      use: { mana: 10, onTouch: true, note: 'existing pickups.js kind mp (PICKUP_AMOUNT 10); def is for the toast only' },
      glyph: { ch: '*', c: 'manaLight' },
      sprite: 'pickupMp',
      icon: icon(['  /| ', ' /*| ', ' \\/  '],
                 ['  gq ', ' gQq ', ' gq  '])
    }
  };

  // ==================================================================================================================
  // S8-A-07 (appended, v1.43): the 12-icon set. 4 icons already exist above (sword, orb.hp = the "potion" icon - canon
  // has no potions -, boar.hide, boar.tusk); the 8 below are NEW ids from the writer list (docs/story.md "S8-A-13
  // Items"), names + lines are the writer's (final, placeholderName false). All definitions carry the approved writer copy.
  // S8-C-08: explicit shield / key / upgrade / currency kinds are accepted by both validators.
  // These definitions do not grant items; currency rewards still await the owner decision.
  // ==================================================================================================================
  // new icon colour keys (one char -> palette key; all existing palette colours)
  keys.A = { c: 'brassLight' };  keys.B = { c: 'brass' };        keys.J = { c: 'brassDark' };
  keys.j = { c: 'brassShadow' }; keys.V = { c: 'brassHot' };     keys.v = { c: 'verdigris' };
  keys.K = { c: 'ironDark' };    keys.U = { c: 'rust' };
  keys.F = { c: 'copperLight' }; keys.p = { c: 'copper' };       keys.o = { c: 'copperDark' };
  keys.X = { c: 'lantern', e: true };

  defs.shield = {
    id: 'shield', name: 'Brass Buckler', kind: 'shield', stackMax: 1, hand: true, inPack: true,
    desc: 'Gondola plate, bent round a strap.',
    glyph: { ch: 'O', c: 'brass' },
    // /=o=\     rim + top rivet
    // |:@:|     dented plate, bright boss
    // \___/     lower rim in shadow
    icon: icon(['/=o=\\', '|:@:|', '\\___/'],
               ['ABVBA', 'BjAjJ', 'JjjjJ'])
  };
  defs.lantern = {
    id: 'lantern', name: 'Kestrel Lamp', kind: 'tool', stackMax: 1, hand: true, inPack: true,
    desc: "The gondola's lamp. It still burns.",
    note: 'quest item id (M1 objective `lantern`); today lantern.take sets a flag, S8-C-08 decides if it also adds this item',
    glyph: { ch: '#', c: 'lantern' },
    //  ,^,      hood + carry ring
    // [(*)]     brass cage, glowing glass, flame core
    //  =#=      base
    icon: icon([' ,^, ', '[(*)]', ' =#= '],
               [' BAB ', 'BXCXB', ' JBJ '])
  };
  defs['key.small'] = {
    id: 'key.small', name: 'Small Key', kind: 'key', stackMax: 9, hand: false, inPack: true,
    desc: 'Iron, brown with rust. Fits one lock.',
    use: { opens: 'lock', note: 'consumed by the lock it opens (door / chest story); no use from the pack' },
    glyph: { ch: 'F', c: 'ironLight' },
    // ,-.       bow (ring)
    // (o)=E     hole, shaft, rusty bit
    // `-'
    icon: icon([',-.  ', '(o)=E', "`-'  "],
               ['sss  ', 'sKUiU', 'iUi  '])
  };
  defs.bow = {
    id: 'bow', name: "Hunter's Bow", kind: 'weapon', stackMax: 1, hand: true, inPack: true,
    desc: 'Yew and gut. Quiet, and it reaches.',
    glyph: { ch: '}', c: 'woodLight' },
    //  /|       upper limb + string
    // (-+->     grip, fletch, nock on the string, shaft, iron head
    //  \|       lower limb + string
    icon: icon([' /|  ', '(-+->', ' \\|  '],
               [' Hu  ', 'hfuws', ' lu  '])
  };
  defs.bomb = {
    id: 'bomb', name: 'Blast Pot', kind: 'tool', stackMax: 10, hand: true, inPack: true,
    desc: 'Clay, black powder, a short fuse.',
    use: { note: 'throw: a later story (no sim yet)' },
    glyph: { ch: 'o', c: 'copper' },
    //  .-'*     shoulder, fuse, spark
    // (=#=)     fired clay, rope lashing
    // `-=-'     foot in shadow
    icon: icon([" .-'*", '(=#=)', "`-=-'"],
               [' FpDE', 'FpDpo', 'oopoo'])
  };
  defs['heart.piece'] = {
    id: 'heart.piece', name: 'Heart Piece', kind: 'upgrade', stackMax: 3, hand: false, inPack: true,
    desc: 'A warm red stone. Four make a heart.',
    use: { note: 'the 4th piece is consumed at once: +1 heart (max HP), a later sim story; stackMax 3 = never 4 in the pack' },
    glyph: { ch: 'v', c: 'vitalLight' },
    // (#v#)     a heart outline; ONE quarter (top-left) glows, the rest is a dark ghost = "a piece of"
    //  \#/
    //   v
    icon: icon(['(#v#)', ' \\#/ ', '  v  '],
               ['LPddd', ' Ldd ', '  d  '])
  };
  defs.cog = {
    id: 'cog', name: 'Brass Cog', kind: 'currency', stackMax: 99, hand: false, inPack: true,
    desc: "Ferrum's small change. Worth a trade.",
    pending: 'owner', pendingNote: 'currency is an open owner question (GDD 10); icon + def ready, nothing grants it yet',
    glyph: { ch: '@', c: 'brass' },
    //  "#"      teeth
    // =(o)=     rim, axle hole, teeth
    //  "#"
    icon: icon([' "#" ', '=(o)=', ' "#" '],
               [' AVA ', 'BAjBJ', ' JBJ '])
  };
  defs['brass.scrap'] = {
    id: 'brass.scrap', name: 'Brass Scrap', kind: 'material', stackMax: 20, hand: false, inPack: true,
    desc: 'From the Kestrel. Ferrum, in pieces.',
    use: { none: 'Material - no use yet' },
    glyph: { ch: '=', c: 'brass' },
    //  ._/|     torn plate edge
    // /%o=/     green patina, a rivet
    // `~-'      bent lower lip
    icon: icon([' ._/|', '/%o=/', "`~-' "],
               [' ABAB', 'BvVBJ', 'JvjJ '])
  };
  // the S8-A-07 icon list in sheet order (sword, shield, lantern, potion, key, bow, bomb, heart piece, currency, 3 materials)
  var iconSet = ['sword', 'shield', 'lantern', 'orb.hp', 'key.small', 'bow', 'bomb', 'heart.piece', 'cog',
                 'boar.hide', 'boar.tusk', 'brass.scrap'];

  for (var id in defs) defs[id].placeholderName = false;

  // ---- loot tables: one independent roll per entry (seeded, sim side). `n` = count when the roll succeeds. ----
  var loot = {
    boar: {
      story: 'US-091a',
      mode: 'corpse',     // owner 2026-10-05: press E at the dead boar, loot goes straight into the pack (no ground drop)
      entries: [
        { item: 'boar.meat', chance: 1.00, n: 1 },
        { item: 'boar.hide', chance: 0.60, n: 1 },
        { item: 'boar.tusk', chance: 0.25, n: 1 }
      ],
      // the existing US-080b HP/MP drop stays a GROUND drop (walk-over): 50 %, then hp or mp 50/50
      groundDrop: { chance: 0.50, kinds: ['hp', 'mp'], note: 'pickups.spawnDrop(world, kind, corpse x, y, z) at death' },
      rollOrder: 'roll entries in array order with the seeded RNG at death time (not at loot time), store the result ' +
                 'on the corpse; the E press only transfers it (deterministic, replay-safe)',
      packFull: 'items that do not fit stay on the corpse; toast "Pack full"; the corpse stays lootable (timeout still runs)'
    }
  };

  // ---- toast (UI layer 160x60, literal RGB) ----
  //   row 4..6, centred:        % +1 Boar Meat
  //                             & +1 Boar Hide
  //   newest at the bottom; a 4th line pushes the oldest out.
  var toast = {
    story: 'US-091a',
    anchor: { row: 4, align: 'center', note: 'UI-grid row of the OLDEST visible line; lines at row, row+1, row+2 ' +
              '(clear of the vitals HUD rows 1-2 at the left, and the crosshair/prompt rows round 30)' },
    maxLines: 3, lifeSteps: 90,                         // 1.5 s
    format: '{glyph} +{n} {name}', note: 'glyph = the item\'s 1-cell glyph in its colour; "+n" gold; name uiText',
    colors: {
      glyph: 'item', plus: [255, 210, 74], name: [232, 226, 208], plate: [10, 11, 16],
      note: 'plus = palette gold #ffd24a, name = uiText, plate = the uiStyle.vitals textBg'
    },
    plate: { pad: 1, note: 'one plate cell left and right of the text, bg = colors.plate (reads on bright sky + grass)' },
    popSteps: 4, pop: { name: [255, 255, 255], note: 'first 4 steps: the name is white (new-line pop)' },
    fade: { lastSteps: 18, nameTo: [106, 106, 120], plusTo: [150, 120, 50],
            note: 'last 0.3 s: lerp name -> uiDim, plus -> dim gold, then the line is dropped (no alpha on the UI layer)' },
    stack: 'same item again while its line is visible: update that line to "+{total}" and restart its life (no new line)',
    messages: {
      packFull: { text: 'Pack full', fg: [214, 112, 64], note: 'soft ember (= overlay targetNone), not danger red' },
      notHurt:  { text: 'Not hurt', fg: [169, 163, 144], note: 'uiHint' },
      material: { text: 'Material - no use yet', fg: [169, 163, 144], note: 'uiHint' },
      orbHp:    { text: '+10 HP', fg: [255, 143, 126], note: 'vitalLight: optional, if orbs get a toast' },
      orbMp:    { text: '+10 MP', fg: [156, 194, 255], note: 'manaLight: optional' }
    }
  };

  // ---- loot sprites (README 4 format, billboards) ----
  function frame(glyphs, fg) { return { S: { glyphs: glyphs, fg: fg } }; }
  // a gold twinkle over a lootable corpse: long dim rest, quick flare, = "something here, press E"
  var lootGlint = {
    name: 'lootGlint', billboard: true, directions: ['S'],
    desc: 'US-079b/US-091a: gold twinkle hovering over a lootable boar corpse. Emissive, glyph-only.',
    size: { w: 3, h: 3 }, anchor: { x: 1, y: 2 }, world: { w: 0.18, h: 0.18 },
    keys: { Y: { c: 'gold', e: true, fill: false }, y: { c: 'brassHot', e: true, fill: false },
            a: { c: 'brass', e: true, fill: false }, W: { c: 'white', e: true, fill: false } },
    animations: { idle: { durations: [700, 80, 80, 120, 80], loop: true, frames: [
      frame(['   ', ' . ', '   '], ['   ', ' a ', '   ']),
      frame(['   ', ' + ', '   '], ['   ', ' Y ', '   ']),
      frame([' | ', '-*-', ' | '], [' y ', 'yWy', ' y ']),
      frame([" ' ", '-+-', ' . '], [' Y ', 'aYa', ' a ']),
      frame(['   ', ' + ', '   '], ['   ', ' a ', '   '])
    ] } }
  };
  function iconSprite(name, def, wM, hM) {
    var k = {}, i, j, ch;
    for (i = 0; i < 3; i++) for (j = 0; j < 5; j++) {
      ch = def.icon.fg[i].charAt(j);
      if (ch !== ' ') k[ch] = keys[ch].e ? { c: keys[ch].c, e: true } : { c: keys[ch].c };
    }
    return {
      name: name, billboard: true, directions: ['S'],
      desc: 'SPARE (owner 2026-10-05: boar loot goes straight into the pack): world drop of ' + def.name +
            ', the inventory icon as a billboard. Only needed when a later story drops items on the ground.',
      size: { w: 5, h: 3 }, anchor: { x: 2, y: 2 }, world: { w: wM, h: hM },
      keys: k, outline: { k: 0.4 },
      animations: { idle: { durations: [1000], loop: true, frames: [frame(def.icon.glyphs.slice(), def.icon.fg.slice())] } }
    };
  }
  A.lootSprites = {
    lootGlint: lootGlint,
    lootMeat: iconSprite('lootMeat', defs['boar.meat'], 0.30, 0.20),
    lootHide: iconSprite('lootHide', defs['boar.hide'], 0.40, 0.26),
    lootTusk: iconSprite('lootTusk', defs['boar.tusk'], 0.22, 0.15)
  };

  function attachSprites() {
    A.models = A.models || {};
    for (var n in A.lootSprites) if (!A.models[n]) A.models[n] = A.lootSprites[n];
    return true;
  }

  // Data self-check: [] = OK. palette = ASSETS.palette (optional: checks colour keys exist).
  function validate(palette) {
    var errs = [], rgb = palette && palette.rgb, id, d, r, j, cc, ch;
    var KINDS = { weapon: 1, spell: 1, tool: 1, food: 1, material: 1, pickup: 1, shield: 1, key: 1, upgrade: 1, currency: 1 };
    for (ch in keys) if (rgb && !rgb[keys[ch].c]) errs.push('keys.' + ch + ': unknown colour ' + keys[ch].c);
    for (id in defs) {
      d = defs[id];
      if (d.id !== id) errs.push(id + ': id mismatch');
      if (!KINDS[d.kind]) errs.push(id + ': bad kind ' + d.kind);
      if (!(d.stackMax >= 0)) errs.push(id + ': stackMax');
      if (!d.glyph || d.glyph.ch.length !== 1) errs.push(id + ': glyph');
      else if (rgb && !rgb[d.glyph.c]) errs.push(id + ': glyph colour ' + d.glyph.c);
      if (d.icon.glyphs.length !== 3 || d.icon.fg.length !== 3) errs.push(id + ': icon rows');
      for (r = 0; r < 3; r++) {
        var g = d.icon.glyphs[r] || '', f = d.icon.fg[r] || '';
        if (g.length !== 5 || f.length !== 5) errs.push(id + ': icon row ' + r + ' not 5 wide (' + g.length + '/' + f.length + ')');
        for (j = 0; j < g.length; j++) {
          cc = g.charCodeAt(j);
          if (cc < 32 || cc > 126) errs.push(id + ': non-ASCII glyph row ' + r);
          var fk = f.charAt(j);
          if ((g.charAt(j) === ' ') !== (fk === ' ')) errs.push(id + ': row ' + r + ' col ' + j + ' glyph/fg space mismatch');
          if (fk !== ' ' && !keys[fk]) errs.push(id + ': unknown icon key ' + fk);
        }
      }
    }
    var e = loot.boar.entries;
    for (j = 0; j < e.length; j++) if (!defs[e[j].item]) errs.push('loot.boar: unknown item ' + e[j].item);
    return errs;
  }

  A.items = {
    version: 1,
    order: ['sword', 'spell.fireball', 'torch', 'boar.meat', 'boar.hide', 'boar.tusk', 'orb.hp', 'orb.mp'],
    defs: defs,
    keys: keys,
    loot: loot,
    toast: toast,
    attachSprites: attachSprites,
    validate: validate
  };

  // S8-A-07 (appended): new ids at the end of the pack display order + the 12-icon set
  A.items.order.push('shield', 'lantern', 'key.small', 'bow', 'bomb', 'heart.piece', 'cog', 'brass.scrap');
  A.items.iconSet = iconSet;

  if (typeof module === 'object' && module && module.exports) module.exports = { items: A.items, lootSprites: A.lootSprites };
})(typeof window !== 'undefined' ? window : globalThis);
