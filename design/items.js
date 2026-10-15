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
      id: 'sword', name: 'Old Sword', kind: 'weapon', stackMax: 1, hand: true, inPack: true,
      desc: 'Old watch steel. Nicked, still true.',
      glyph: { ch: '/', c: 'mirror' },
      //  .        cross-guard top
      // o+==>     pommel, guard, blade, point
      //  '        cross-guard bottom
      icon: icon([' .   ', 'o+==>', " '   "],
                 [' Z   ', 'zZSSW', ' z   ']),
      equip: { slot: 'main', tier: 'worn', def: 0, held: 'sword' }   // EQ-01
    },
    'spell.fireball': {
      id: 'spell.fireball', name: 'Fireball', kind: 'spell', stackMax: 1, hand: true, inPack: true,
      equip: { slot: 'off', tier: 'worn', def: 0 }, // FB-01 fix: hands are derived from equipment (OB-017); without an off-slot the spell could never reach a hand
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
    'goblin.trinket': { // GOB-05: a sell item; icon + sprite are the tusk's placeholders (NEEDS DESIGNER)
      id: 'goblin.trinket', name: 'Goblin Trinket', kind: 'material', stackMax: 20, hand: false, inPack: true,
      desc: 'Bent wire and bone. Sells well.',
      use: { none: 'Material - sell it' },
      glyph: { ch: '*', c: 'linenLight' },
      sprite: 'lootTusk',
      icon: icon(["   ,'", '  // ', '(=/  '],
                 ['   TW', '  uT ', 'nnu  '])
    },
    // ---------------- ground orbs (US-080b drops; NOT stored: used on touch) ----------------
    'orb.hp': {
      id: 'orb.hp', name: 'Health Orb', kind: 'pickup', stackMax: 0, hand: false, inPack: false,
      desc: 'Bitter herbs under red wax. Heals.',
      use: { heal: 10, onTouch: true, note: 'existing pickups.js kind hp (PICKUP_AMOUNT 10); def is for the toast only' },
      glyph: { ch: '+', c: 'vital' },
      sprite: 'pickupHp',
      icon: icon([' _n_ ', '(#*#)', " `-' "],
                 [' cPc ', 'gLWLG', ' GGG '])
    },
    'orb.mp': {
      id: 'orb.mp', name: 'Mana Orb', kind: 'pickup', stackMax: 0, hand: false, inPack: false,
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
    id: 'shield', name: 'Brass Shield', kind: 'shield', stackMax: 1, hand: true, inPack: true,
    desc: 'Gondola plate, bent round a strap.',
    glyph: { ch: 'O', c: 'brass' },
    // /=o=\     rim + top rivet
    // |:@:|     dented plate, bright boss
    // \___/     lower rim in shadow
    icon: icon(['/=o=\\', '|:@:|', '\\___/'],
               ['ABVBA', 'BjAjJ', 'JjjjJ']),
    equip: { slot: 'off', tier: 'worn', def: 2, held: 'shield' }   // EQ-01 (shield counts x2)
  };
  defs.lantern = {
    id: 'lantern', name: 'Lantern', kind: 'tool', stackMax: 1, hand: true, inPack: true,
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
               [' Hu  ', 'hfuws', ' lu  ']),
    equip: { slot: 'ranged', tier: 'worn', def: 0, held: 'bow' }   // EQ-01
  };
  defs.bomb = {
    id: 'bomb', name: 'Bomb', kind: 'tool', stackMax: 10, hand: true, inPack: true,
    desc: 'Clay, black powder, a short fuse.',
    use: { note: 'throw: a later story (no sim yet)' },
    glyph: { ch: 'o', c: 'copper' },
    //  .-'*     shoulder, fuse, spark
    // (=#=)     fired clay, rope lashing
    // `-=-'     foot in shadow
    icon: icon([" .-'*", '(=#=)', "`-=-'"],
               [' FpDE', 'FpDpo', 'oopoo'])
  };
  defs['berry.blue'] = {
    id: 'berry.blue', name: 'Blue Sprig', kind: 'material', stackMax: 20, hand: false, inPack: true,
    desc: 'Blue berries. Burl is counting.',
    use: { none: 'Material - quest errand (sq.burl.blue)' },
    glyph: { ch: 'o', c: 'manaLight' },
    //  .o.      berry cluster
    // (oQo)
    //   |       stem
    icon: icon([' .o. ', '(oQo)', '  |  '],
               [' qQq ', 'qQqQq', '  h  '])
  };
  defs.redcap = {
    id: 'redcap', name: 'Red Cap', kind: 'material', stackMax: 10, hand: false, inPack: true,
    desc: 'East-bank mushroom. Rook wants some.',
    use: { none: 'Material - quest errand (sq.rook.caps)' },
    glyph: { ch: 'n', c: 'goreRed' },
    //  .-.      red cap, white warts
    // (o:o)
    //  |=|      stem
    icon: icon([' .-. ', '(obo)', ' |=| '],
               [' rRr ', 'RbRbR', ' ffb '])
  };
  defs.signArm = {
    id: 'signArm', name: 'Signpost Arm', kind: 'material', stackMax: 1, hand: false, inPack: true,
    desc: 'Washed up. For the crossroads post.',
    use: { none: 'Material - quest errand (sq.fc.sign, MAP-26 pickup)' },
    glyph: { ch: '=', c: 'goreRed' },
    icon: icon(['=---=', '  |  ', '  |  '],
               ['bbbbb', '  b  ', '  b  '])
  };
  defs.barleySheaf = {
    id: 'barleySheaf', name: 'Barley Sheaf', kind: 'material', stackMax: 1, hand: false, inPack: true,
    desc: 'A tied sheaf from the barley gate.',
    use: { none: 'Material - quest errand (sq.ow.barley, QL-22b pickup)' },
    glyph: { ch: '#', c: 'goreRed' },
    icon: icon([' .|. ', ' ||| ', '=====' ],
               [' bbb ', ' bbb ', 'bbbbb'])
  };
  defs.emberpod = {
    id: 'emberpod', name: 'Emberpod', kind: 'material', stackMax: 3, hand: false, inPack: true,
    desc: 'A dry red pod. Warm as a held coal.',
    use: { none: 'Material - quest item (sq.burl.fire, FB-02; handed to Burl)' },
    glyph: { ch: 'o', c: 'goreRed' },
    icon: icon([' .-. ', '(ooo)', " '-' "],
               [' rRr ', 'RoRoR', ' rRr '])
  };
  defs.parcel = {
    id: 'parcel', name: 'Forge Parcel', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Heavy for its size. FOR THE FORGE.',
    use: { none: 'Quest item - leave it at the forge (sq.ow.parcel, QL-22 texts)' },
    glyph: { ch: '=', c: 'brass' },
    icon: icon(['.---.', '|=+=|', "'---'"],
               ['hhhhh', 'hAfAh', 'hhhhh'])
  };
  defs['key.crypt'] = {
    id: 'key.crypt', name: 'Crypt Key', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Old black iron. Opens the crypt door.',
    use: { opens: 'lock', note: 'UNDER-02: opens the cemetery crypt door (game/js/quest/under/crypt.js); given by Bram in UNDER-07' },
    glyph: { ch: 'F', c: 'ironLight' },
    icon: icon([',-.  ', '(o)=E', "`-'  "],
               ['sss  ', 'sKUiU', 'iUi  '])
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
  defs['scroll.spell'] = {
    id: 'scroll.spell', name: 'Spell Scroll', kind: 'upgrade', stackMax: 3, hand: false, inPack: true,
    desc: 'One of your spells grows stronger.',
    use: { chooseSpell: true, note: 'D-114: E in the inventory opens a list of learned spells; the pick gains +1 level and the scroll is used (quest/sim/spellTiers.js)' },
    glyph: { ch: '*', c: 'flameMid' },
    icon: icon([' .^, ', '(*@*)', " `~' "],
               [' tOt ', 'OMCMO', ' eke '])
  };
  defs['relay.mirror'] = {
    id: 'relay.mirror', name: 'Waystone Glass', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Round, silvered, scratched by claws.',
    use: { none: 'Quest item - the Ford Waystone needs it (mq.ford.mirror)' },
    glyph: { ch: 'o', c: 'mirror' },
    icon: icon([' .-. ', '( o )', " '-' "],
               [' sss ', 's S s', ' sss '])
  };
  defs['chart.river'] = {
    id: 'chart.river', name: 'River Chart', kind: 'upgrade', stackMax: 1, hand: false, inPack: true,
    desc: 'Crow paper. A river is drawn on it.',
    use: { none: 'Chart piece - the map card shows the ford (mq.bend.call)' },
    glyph: { ch: '~', c: 'manaLight' },
    icon: icon(['.---.', '|~~~|', "'---'"],
               ['hhhhh', 'hqqqh', 'hhhhh'])
  };
  defs['relay.brass'] = {
    id: 'relay.brass', name: 'Brass Collar', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'A green brass collar, cut with glyphs.',
    use: { none: 'Quest item - the Outwall Waystone needs it' },
    glyph: { ch: '=', c: 'brass' },
    icon: icon([' .=. ', '( o )', " '=' "],
               [' AAA ', 'A J A', ' AAA '])
  };
  defs['chart.westFells'] = {
    id: 'chart.westFells', name: 'West Chart', kind: 'upgrade', stackMax: 1, hand: false, inPack: true,
    desc: 'Crow paper. The West Fells on it.',
    use: { none: 'Chart piece - the map card shows the West Fells (mq.ow.board)' },
    glyph: { ch: '^', c: 'manaLight' },
    icon: icon(['.---.', '|^^^|', "'---'"],
               ['hhhhh', 'hqqqh', 'hhhhh'])
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
  // M4 story quests (QL-10 sq.honey, QL-12 sq.packet): two quest carry items, no use.
  defs.honeycomb = {
    id: 'honeycomb', name: 'Honeycomb', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Sticky gold. It is for the crow.',
    use: { none: 'Quest item - bring it to Rook (sq.honey)' },
    glyph: { ch: '%', c: 'brass' },
    icon: icon([' ._. ', '(%o%)', " '-' "],
               [' AAA ', 'AJAJA', ' AAA '])
  };
  defs.packet = {
    id: 'packet', name: 'Cloth Packet', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Tied with twine. FOR THE FORD POST.',
    use: { none: 'Quest item - leave it at the trade post (sq.packet)' },
    glyph: { ch: '=', c: 'brass' },
    icon: icon(['.---.', '|=+=|', "'---'"],
               ['hhhhh', 'hAfAh', 'hhhhh'])
  };
  // CH1-D2 (architecture.md 38.37 item 3): the crystal the boars were rooting for. Name + desc = docs/story.md CH1-W3
  // (item.aetherCrystal.*; the in-world name avoids "aether"). stackMax 1. The inventory has NO key-item / no-drop tag
  // today (game/js/quest/sim/inventory.js), so this is a plain item of kind 'key'; the real gate is the flag
  // aether.attuned, the item is only proof (dropping it can never soft-lock). Not consumed when it wakes a stone.
  keys.N = { c: 'aether', e: true };  keys.I = { c: 'aetherLight', e: true };
  keys.x = { c: 'aetherCore', e: true }; keys['1'] = { c: 'aetherMid', e: true };
  defs.aetherCrystal = {
    id: 'aetherCrystal', name: 'Teal Crystal', kind: 'key', stackMax: 1, hand: false, inPack: true,
    desc: 'Warm, and it hums like the old stones.',
    use: { none: 'not used from the pack', note: 'proof of aether.attuned (game/js/quest/crystal.js grants it); ' +
           'held up at a stone by relayWake.js, never consumed' },
    keyItem: false, keyItemNote: 'set true once the inventory supports a no-drop / no-sell tag',
    glyph: { ch: '*', c: 'aether' },
    //   /\'     the tip, a sparkle off it
    //  |*:|     the prism, white-hot core, shaded right facet
    //  \__/     the broken base
    icon: icon(["  /\\'", ' |*:|', ' \\__/'],
               ['  INx', ' IxN1', ' N11N'])
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

  // ==================================================================================================================
  // EQ-01 (equipment epic, docs/equipment-epic-2026-10-10.md s1): equip data. PLACEHOLDER icons (EQ-D1/D2 replace them).
  // equip: { slot, tier: worn|sturdy|fine|tempered|warden, def, shell?, held? }. 11 slots; 7 wearable bases x 5 tiers = 35 gear ids (EQ-21: tempered/warden)
  // `gear.<slot>.<base>.<tier>`; def worn 1 / sturdy 2 / fine 3 / tempered 4 / warden 5, body x2. Ammo `arrow` (quiver), `potion.hp` / `potion.mp`.
  // ==================================================================================================================
  var EQUIP_SLOTS = ['head', 'body', 'cloak', 'hands', 'belt', 'legs', 'feet', 'main', 'off', 'ranged', 'quiver'];
  var EQUIP_TIERS = ['worn', 'sturdy', 'fine', 'tempered', 'warden'];
  var tierPrefix = { worn: 'Worn', sturdy: 'Sturdy', fine: 'Fine', tempered: 'Elite', warden: 'Warden' }; // OB-135 plain names
  var tierKey = { worn: 'h', sturdy: 'v', fine: 'Y', tempered: 'i', warden: 's' }; // placeholder icon colour per tier (wood / verdigris / gold / iron / light iron)
  var tierGlyphC = { worn: 'wood', sturdy: 'verdigris', fine: 'gold', tempered: 'iron', warden: 'ironLight' };
  var gearBases = [
    { slot: 'head', base: 'hood', name: 'Hood', ch: 'n', rows: [' ,-. ', '(   )', '     '], shell: 'hat' },
    { slot: 'body', base: 'jerkin', name: 'Jerkin', ch: 'T', rows: ['\\   /', ' |#| ', ' |_| '], shell: 'top' },
    { slot: 'cloak', base: 'cloak', name: 'Cloak', ch: 'A', rows: [' ,-. ', '/ | \\', '/_|_\\'], shell: 'outer' },
    { slot: 'hands', base: 'gloves', name: 'Gloves', ch: 'm', rows: ['     ', '|||||', '\\___/'], shell: 'gloves' },
    { slot: 'belt', base: 'belt', name: 'Belt', ch: '=', rows: ['     ', '=[o]=', '     '], shell: 'belt' },
    { slot: 'legs', base: 'pants', name: 'Pants', ch: 'H', rows: ['|===|', '| | |', '|_|_|'], shell: 'legs' },
    { slot: 'feet', base: 'boots', name: 'Boots', ch: 'L', rows: ['     ', '|_| |', '|_|_|'], shell: 'feet' }
  ];
  gearBases.forEach(function (b) {
    EQUIP_TIERS.forEach(function (tier, ti) {
      var id = 'gear.' + b.slot + '.' + b.base + '.' + tier, k = tierKey[tier];
      var fg = b.rows.map(function (r) { return r.replace(/[^ ]/g, k); });
      defs[id] = {
        id: id, name: tierPrefix[tier] + ' ' + b.name, kind: 'gear', stackMax: 1, hand: false, inPack: true,
        desc: 'A ' + tierPrefix[tier].toLowerCase() + ' ' + b.name.toLowerCase() + '. Gives ' + (ti + 1) * (b.slot === 'body' ? 2 : 1) + ' defence.',
        glyph: { ch: b.ch, c: tierGlyphC[tier] },
        icon: icon(b.rows, fg),
        equip: { slot: b.slot, tier: tier, def: (ti + 1) * (b.slot === 'body' ? 2 : 1), shell: b.shell }
      };
      if (b.slot === 'cloak') defs[id].equip.passive = { nightDef: 0.1 }; // QL-19: +10 % damage reduction at night (clock 21-05), inside the 0.6 cap
    });
  });
  // QL-16/QL-19: River Boots (mq.ford.mirror chest by Rook's nest). `unique` keeps it OUT of the random gear rolls (loot.js gearIdFor skips it).
  defs['gear.feet.riverBoots'] = {
    id: 'gear.feet.riverBoots', name: 'River Boots', kind: 'gear', stackMax: 1, hand: false, inPack: true, unique: true,
    desc: 'Greased leather. Sure on wet stones.',
    glyph: { ch: 'L', c: 'verdigris' },
    icon: icon(['     ', '|_| |', '|_|_|'], ['     ', 'vvv v', 'vvvvv']),
    equip: { slot: 'feet', tier: 'sturdy', def: 2, shell: 'feet', passive: { wetStone: true } } // QL-19: no stumble on wet stepping stones
  };
  defs.arrow = {
    id: 'arrow', name: 'Arrow', kind: 'ammo', stackMax: 30, hand: false, inPack: true,
    desc: 'Yew shaft, iron head.',
    glyph: { ch: '>', c: 'woodLight' },
    icon: icon(['     ', '-->>>', '     '], ['     ', 'hhhss', '     ']),
    equip: { slot: 'quiver', tier: 'worn', def: 0 }
  };
  defs['potion.hp'] = {
    id: 'potion.hp', name: 'Health Potion', kind: 'potion', stackMax: 5, hand: false, inPack: true,
    desc: 'Heals two hearts.',
    use: { heal: 2, unit: 'hearts', time: 0.6 },
    glyph: { ch: '!', c: 'vital' },
    icon: icon(['  _  ', ' (R) ', ' \\_/ '], ['  g  ', ' cLc ', ' ccc '])
  };
  defs['potion.mp'] = {
    id: 'potion.mp', name: 'Mana Potion', kind: 'potion', stackMax: 5, hand: false, inPack: true,
    desc: 'Restores magic.',
    use: { mp: 2, unit: 'mana', time: 0.6, dropped: false },
    glyph: { ch: '!', c: 'mana' },
    icon: icon(['  _  ', ' (M) ', ' \\_/ '], ['  g  ', ' qmq ', ' qqq '])
  };


  // Data self-check: [] = OK. palette = ASSETS.palette (optional: checks colour keys exist).
  function validate(palette) {
    var errs = [], rgb = palette && palette.rgb, id, d, r, j, cc, ch;
    var KINDS = { weapon: 1, spell: 1, tool: 1, food: 1, material: 1, pickup: 1, shield: 1, key: 1, upgrade: 1, currency: 1, gear: 1, ammo: 1, potion: 1 };
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
    for (id in defs) {
      var q = defs[id].equip;
      if (q && EQUIP_SLOTS.indexOf(q.slot) < 0) errs.push(id + ': bad equip.slot ' + q.slot);
      if (q && EQUIP_TIERS.indexOf(q.tier) < 0) errs.push(id + ': bad equip.tier ' + q.tier);
      if (q && !(q.def >= 0)) errs.push(id + ': bad equip.def');
      if (defs[id].kind === 'gear' && !q) errs.push(id + ': gear without equip');
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
    validate: validate,
    equipSlots: EQUIP_SLOTS,
    equipTiers: EQUIP_TIERS
  };

  // S8-A-07 (appended): new ids at the end of the pack display order + the 12-icon set
  A.items.order.push('shield', 'lantern', 'key.small', 'bow', 'bomb', 'heart.piece', 'cog', 'brass.scrap');
  A.items.order.push('aetherCrystal');
  Object.keys(defs).forEach(function (k) { if (A.items.order.indexOf(k) < 0 && (defs[k].kind === 'gear' || k === 'arrow' || k.indexOf('potion.') === 0)) A.items.order.push(k); });  // EQ-01                                   // CH1-D2
  A.items.iconSet = iconSet;

  // EQ-D1 (appended): equipment icons (5x3, existing keys only). The shield + bow icons now match the voxel models in
  // models/equipment.js (round plank shield, iron rim + boss; plain wooden longbow, gut string). arrow / potion.hp /
  // potion.mp have no defs yet (EQ-01 adds them): their icons wait here, keyed by the planned item id.
  A.items.eqIcons = {
    //  .=-=.     iron rim, lit top
    //  (H@H)     planks either side of the bright boss
    //  `=-='     rim underside in shadow
    shield: icon(['.=-=.', '(H@H)', "`=-='"],
                 ['sSsSs', 'iHShi', 'KiKiK']),
    //  /'|       upper limb, horn nock, string
    // (#  |      grip wrap ... string        (the D of a braced bow)
    //  \,|       lower limb, horn nock, string
    bow: icon([" /'| ", '(#  |', ' \\,| '],
              [' HnT ', 'hl  T', ' hnT ']),
    // \\         fletching (grey goose, red cock feather)
    // =-->       nock, shaft, iron socket, steel head
    // //
    arrow: icon(['\\\\   ', '=--=>', '//   '],
                ['Tr   ', 'nwwiS', 'Tr   ']),
    //  _#_       glass shoulders, wooden cork
    // (*%%)      round flask, highlight, red draught
    // `-=-'      dark bottom
    'potion.hp': icon([' _#_ ', '(*%%)', "`-=-'"],
                      [' GhG ', 'gPLcG', 'GdddG']),
    'potion.mp': icon([' _#_ ', '(*%%)', "`-=-'"],
                      [' GhG ', 'gQmmG', 'GqqqG'])
  };
  defs.shield.icon = A.items.eqIcons.shield; defs.shield.glyph = { ch: 'O', c: 'wood' };
  defs.bow.icon = A.items.eqIcons.bow;

  if (typeof module === 'object' && module && module.exports && typeof require === 'function') require('./itemsWeapons.js'); // EQ-20 (browser: own script tag)
  if (typeof module === 'object' && module && module.exports) module.exports = { items: A.items, lootSprites: A.lootSprites };
})(typeof window !== 'undefined' ? window : globalThis);
