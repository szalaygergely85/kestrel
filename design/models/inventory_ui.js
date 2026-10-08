/*
 * Kestrel - THE PACK SCREEN (US-091b inventory, D-040: two hand slots, any item in either hand). Designer pass B.
 * Owner: Designer. Format: design/README.md section 14 (+ section 5 UI rules). Preview: design/preview/fireball.html
 * section 4 (interactive mock).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.uiStyle.inventory   layout, colours, glyphs and states of the pause inventory screen, as data the
 *                              programmer reads (inventoryView.js). Item names / icons / kinds come from
 *                              ASSETS.items (design/items.js: 5x3 `icon`, 1-cell `glyph`, `kind`, `hand`, `use`).
 *
 * LOADING (classic script): AFTER models/title.js (title.js assigns ASSETS.uiStyle = {...}) and design/items.js.
 *   game/index.html: <script src="../design/models/inventory_ui.js"></script>
 *
 * GRID: every number is a cell of the FIXED 160x60 UI layer (uiStyle.uiGrid; cellScale = sceneCols / 160), so the
 * screen is cell-identical at 240x90, 320x120, 400x150 and 480x180 (one UI cell = 12x18 px at 1920x1080): the US-091b
 * "readable at 240x90 and 400x150" AC holds by construction; only the scene plate under it maps to more scene cells.
 * Colours are literal RGB (like uiStyle.vitals / items.toast); the palette key is in `key` / the comment.
 * UI cells are opaque: every drawn cell carries its own bg (panel bg unless a style says otherwise).
 *
 * LAYOUT (panel at UI (30, 15), 100 x 29; numbers below are panel-relative col / row)
 *
 *   col 0  3         13                                  55        65                               99
 *   r0   +------------------------------------- PACK -------------------------------------------+
 *   r2   |  +-------+ LEFT HAND [LMB]                      +-------+ RIGHT HAND [RMB]                |
 *   r3   |  | o+==> | Ruin-steel Sword                     | (*@*) | Ember                           |
 *   r4   |  |       | Weapon                               |       | Spell                           |
 *   r6   |  +-------+                                      +-------+                                 |
 *   r7   |  ------------------------------------------------------------------------------------   |
 *   r8   |  +-------+-------+-------+-------+-------+-------+ : +-------+                          |
 *   r9   |  |L      |R      |       |                       : | icon  | Boar Meat                 |
 *   ..   |  6 x 4 slots, pitch 8 x 4, shared borders        : +-------+ Food                      |
 *   r14  |                                                  : A haunch, still warm. Eat it to heal.|
 *   r19  |                                                  : [Enter] / [U]  Eat (+10 HP)         |
 *   r24  |  +-------+-------+-------+-------+-------+-------+ :                                     |
 *   r25  |  ------------------------------------------------------------------------------------   |
 *   r26  |    W/A/S/D select   Q / LMB left hand   E / RMB right hand   Enter use   I close        |
 *   r28  +------------------------------------------------------------------------ paused -------+
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.uiStyle = A.uiStyle || {};

  var RGB = {
    panel:       [18, 15, 12],   // dark oiled canvas (between scorch #2a211c and black)
    slotIn:      [26, 22, 17],   // slot interior, a step above the panel
    slotSel:     [52, 42, 16],   // selected slot interior (dark gold)
    rope:        [154, 122, 72], // rope #9a7a48: panel frame
    ropeDark:    [94, 74, 44],   // ropeDark #5e4a2c: slot borders, separators
    bronze:      [134, 96, 68],  // bronze #866044: hand-slot frames
    bronzeLight: [196, 154, 108],// bronzeLight #c49a6c: frame corners, hand-slot corners
    canvasLight: [240, 221, 170],// canvasLight #f0ddaa: the PACK title
    uiText:      [232, 226, 208],
    uiHint:      [169, 163, 144],
    uiDim:       [106, 106, 120],
    ghost:       [72, 70, 80],   // the empty-hand outline (uiDim, darker)
    emptyDot:    [62, 54, 44],
    gold:        [255, 210, 74],
    heroGreen:   [79, 214, 106],
    ember:       [214, 112, 64]  // soft ember (= overlay targetNone / toast packFull): refusals, never danger red
  };

  A.uiStyle.inventory = {
    story: 'US-091b (+ HANDS-01 hand state)',
    rgb: RGB,
    open: { toggleKeys: ['I'], closeKeys: ['Escape'], pause: 'same gate as pause / Settings (US-087): sim, beasts, targeting, ' +
            'vitals, fireballs frozen', pointer: 'pointer lock released while open, re-locked on close (click-to-resume rule)',
            onOpen: 'cursor on the first grid slot that holds an item (else slot 0)' },
    fadeIn: 0.12, fadeOut: 0.08, fadeRule: 'uiStyle.fade (ramp-step dim, no alpha)',
    sceneDim: { bgMul: 0.35, note: 'whole scene x 0.35 while open (as Settings)' },
    plate: { pad: 1, bgMul: 0.18, note: 'scene cells under the panel (+1) x 0.18' },
    hudVisible: true, hudNote: 'the vitals HUD (rows 1-2) stays drawn above the plate so "eat meat" shows the HP rise',

    panel: { x: 30, y: 15, w: 100, h: 29, bg: RGB.panel, note: 'top-left UI cell; centred: (160 - 100) / 2, (60 - 29) / 2 rounded down' },
    frame: { corner: '+', h: '-', v: '|', fg: RGB.rope, cornerFg: RGB.bronzeLight,
             title: { text: 'PACK', pad: 1, align: 'center', fg: RGB.canvasLight, note: '"- PACK -" on row 0, one space each side' },
             pausedTag: { text: 'paused', pad: 1, col: 88, row: 28, fg: RGB.uiDim, note: 'in the bottom frame row, right' } },
    separators: [
      { row: 7, from: 3, to: 96, glyph: '-', fg: RGB.ropeDark },
      { row: 25, from: 3, to: 96, glyph: '-', fg: RGB.ropeDark },
      { col: 53, from: 8, to: 24, glyph: ':', fg: RGB.ropeDark, note: 'vertical divider grid | details' }
    ],

    // ---- slot box: 9 x 5 cells incl. border; interior 7 x 3; a 5 x 3 item icon is drawn at interior col 1..5 ----
    slot: {
      box: { w: 9, h: 5 }, inner: { x: 1, y: 1, w: 7, h: 3 }, icon: { x: 2, y: 1, w: 5, h: 3,
             note: 'box-relative; icons narrower than 5 are centred, a space glyph with a space fg = transparent (slot bg shows)' },
      border: { corner: '+', h: '-', v: '|', fg: RGB.ropeDark },
      innerBg: RGB.slotIn,
      empty: { glyph: '.', x: 4, y: 2, fg: RGB.emptyDot, note: 'one quiet dot in the middle of an empty grid slot' },
      count: { format: 'x{n}', minN: 2, fg: RGB.uiText, bg: RGB.panel, row: 'bottom border',
               rule: 'right-aligned so the last char sits on box col 7 (x3 -> cols 6-7, x12 -> cols 5-7), over the border glyphs' },
      equippedTag: { left: 'L', right: 'R', col: 1, row: 0, fg: RGB.heroGreen, bg: RGB.panel,
                     rule: 'on the top border of the grid slot whose item is in a hand (one item is never in both hands)' },
      selected: { corner: '#', h: '=', v: '|', fg: RGB.gold, innerBg: RGB.slotSel,
                  rule: 'the cursor slot (keyboard or mouse hover): drawn LAST so its border wins over the shared borders' },
      flash: {
        assign: { ms: 200, borderFg: RGB.heroGreen, note: 'the hand slot that just received an item' },
        cleared: { ms: 200, borderFg: RGB.uiDim, note: 'the hand slot that was emptied (moved / clicked)' },
        use: { ms: 120, innerBg: [96, 82, 44], note: 'the grid slot whose item was used (meat eaten)' },
        refuse: { ms: 160, borderFg: RGB.ember, note: 'Q/E on a non-hand item, U on a material: border flashes, nothing moves' }
      }
    },

    // ---- hands strip (rows 2-6) ----
    hands: {
      row: 2,
      left:  { box: { x: 3, y: 2 }, label: { x: 13, y: 2, text: 'LEFT HAND' }, button: { text: '[LMB]', gap: 1 },
               name: { x: 13, y: 3 }, kind: { x: 13, y: 4 }, hint: { x: 13, y: 5 } },
      right: { box: { x: 55, y: 2 }, label: { x: 65, y: 2, text: 'RIGHT HAND' }, button: { text: '[RMB]', gap: 1 },
               name: { x: 65, y: 3 }, kind: { x: 65, y: 4 }, hint: { x: 65, y: 5 } },
      frame: { corner: '+', h: '=', v: '|', fg: RGB.bronze, cornerFg: RGB.bronzeLight, note: 'hand slots are gear: bronze, heavier = rows' },
      label: { fg: RGB.uiHint }, button: { fg: RGB.gold },
      name: { fg: RGB.uiText }, kind: { fg: RGB.uiDim },
      emptyName: { text: '- empty -', fg: RGB.uiDim },
      hint: { text: 'click: empty this hand', fg: RGB.uiDim, show: 'only while the hand slot is the cursor' },
      // the empty-hand glyph: a ghost outline of an open hand in the 7x3 interior (thumb toward the screen centre)
      emptyGlyph: {
        left:  [' .|||. ', ' |   |/', '  \\_/  '],
        right: [' .|||. ', '\\|   | ', '  \\_/  '],
        fg: RGB.ghost
      },
      kindText: { weapon: 'Weapon', spell: 'Spell', tool: 'Tool' }
    },

    // ---- the 6 x 4 pack grid (rows 8-24) ----
    grid: {
      x: 3, y: 8, cols: 6, rows: 4, pitchX: 8, pitchY: 4,
      note: 'shared borders: slot (c, r) box top-left = (x + 8c, y + 4r), box 9 x 5, so the grid spans cols 3-51, rows 8-24. ' +
            'Slot i = inventory slot index i, row-major (r = floor(i / 6), c = i mod 6). Hand items stay in the grid ' +
            '(tagged L / R) - the hands strip shows what is held.',
      mouse: 'a cell inside a slot box (borders included) hovers it; LMB-click = Q, RMB-click = E on that slot'
    },

    // ---- details panel (cols 55-96, rows 8-24) ----
    details: {
      x: 55, y: 8, w: 42, h: 17,
      iconBox: { x: 55, y: 8, note: 'a 9 x 5 slot box (normal border) with the selected item icon' },
      name: { x: 66, y: 9, fg: RGB.uiText },
      kind: { x: 66, y: 10, fg: RGB.uiHint,
              text: { weapon: 'Weapon - either hand', spell: 'Spell - either hand', tool: 'Tool - either hand',
                      food: 'Food', material: 'Material' } },
      status: { x: 66, y: 11, fg: RGB.heroGreen, inLeft: 'In your left hand', inRight: 'In your right hand',
                count: { format: 'x{n} in the pack', fg: RGB.uiHint }, note: 'hand state wins over the count line' },
      desc: { x: 55, y: 14, w: 42, maxLines: 4, fg: RGB.uiText, wrap: 'word wrap at w; a word longer than w is cut', src: 'items.defs[id].desc' },
      actions: {
        x: 55, y: 19, gapRows: 1, keyFg: RGB.gold, textFg: RGB.uiHint, here: { text: '(here now)', fg: RGB.heroGreen },
        byKind: {
          hand: [{ keys: 'Q / LMB', text: 'Left hand', hand: 'left' }, { keys: 'E / RMB', text: 'Right hand', hand: 'right' }],
          food: [{ keys: 'Enter / U', text: 'Eat (+{heal} HP)' }],
          material: [{ text: 'Material - no use yet', fg: RGB.uiDim }]
        },
        rule: 'hand = items.defs[id].hand === true; food / material by kind. A hand row whose hand already holds this item ' +
              'shows `here` after the text. Cols: keys at x, text at x + 12.'
      },
      emptySlot: { text: 'Empty', x: 66, y: 9, fg: RGB.uiDim },
      handSlotSelected: { text: 'Click or Enter: empty this hand', x: 55, y: 19, fg: RGB.uiHint, note: 'details when a hand slot is the cursor' }
    },

    keyHints: { row: 26, align: 'center', fg: RGB.uiDim, keyFg: RGB.gold,
                text: 'W/A/S/D select   Q / LMB left hand   E / RMB right hand   Enter use   I close',
                keys: ['W/A/S/D', 'Q / LMB', 'E / RMB', 'Enter', 'I'], note: 'arrow keys work too; Esc closes too' },

    nav: {
      grid: 'W/S/A/D or arrows move one slot, no wrap at the grid edges',
      up: 'W from grid row 0 -> the hands strip (cols 0-2 -> LEFT, cols 3-5 -> RIGHT)',
      down: 'S from a hand slot -> grid row 0 (LEFT -> col 0, RIGHT -> col 3)',
      sideways: 'A/D on the hands strip switch LEFT <-> RIGHT',
      handClick: 'LMB / RMB / Enter on a hand slot empties it (the item stays in the pack)'
    },

    // the preview's stand-in pack (the game uses player.components.inventory)
    mock: {
      slots: [{ id: 'sword', n: 1 }, { id: 'spell.fireball', n: 1 }, { id: 'boar.meat', n: 3 }, { id: 'boar.hide', n: 2 },
              { id: 'boar.tusk', n: 1 }, { id: 'torch', n: 1 }],
      left: 'sword', right: 'spell.fireball', hp: 22, hpMax: 30
    }
  };

  // ---- S8-A-05 (appended, v1.41): the third state for the S8-C-09 view. normal = slot.border / hands.frame,
  // focus = slot.selected (unchanged). disabled = a slot or hand that cannot take input right now (slots past the pack
  // capacity, a hand locked while a spell charges / a cutscene runs). Preview: design/preview/ui-menu-settings.html.
  A.uiStyle.inventory.slot.disabled = {
    corner: '.', h: '.', v: ':', fg: [74, 58, 34], innerBg: [14, 12, 10],
    glyph: 'x', x: 4, y: 2, glyphFg: [62, 54, 44], focusable: false,
    rule: 'dotted rope border (ropeDark x 0.8), darker interior, one quiet x in the middle; the cursor skips it; drawn BEFORE ' +
          'normal slots so a shared border with a live slot shows the live border'
  };
  A.uiStyle.inventory.hands.disabled = {
    frame: { corner: '+', h: '-', v: ':', fg: [74, 58, 34], cornerFg: [94, 74, 44] },
    label: { fg: RGB.uiDim }, tag: { text: '(busy)', fg: RGB.uiDim, gap: 1, note: 'after the [LMB] / [RMB] button text' },
    rule: 'a hand locked for now (charging, cutscene): bronze frame drops to dotted rope, item icon still drawn, Q/E flash refuse'
  };
  A.uiStyle.inventory.states = {
    slot: { normal: 'slot.border', focus: 'slot.selected', disabled: 'slot.disabled' },
    hand: { normal: 'hands.frame', focus: 'slot.selected', disabled: 'hands.disabled' },
    detailLine: 'details.name / kind / status / desc (unchanged); a disabled slot shows details.emptySlot with text "Locked"',
    lockedText: 'Locked'
  };

  if (typeof module === 'object' && module && module.exports) module.exports = A.uiStyle.inventory;
})(typeof window !== 'undefined' ? window : globalThis);
