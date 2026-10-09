/*
 * Kestrel - TITLE MENU + SETTINGS (full panel) style. S8-A-04 (uiStyle.menu) + S8-A-05 (uiStyle.settings.controls /
 * .quality / .full). Owner: Designer. Format: design/README.md section 15 (+ section 5 UI rules).
 * Preview: design/preview/ui-menu-settings.html.
 *
 * WHAT THIS FILE SETS (append-only: no existing uiStyle key or value is changed)
 *   ASSETS.uiStyle.menu               the title menu card (game/js/ui/titleMenu.js, US-090a / S8-C-03). Geometry = the
 *                                     placeholder's (72 x 28, rows at the same y), so lane C swaps colours/glyphs by data.
 *   ASSETS.uiStyle.settings.controls  the 4 settings controls (select, strip, slider, toggle, action) x 3 states
 *                                     (normal, focus, disabled). Shared by `settings.full` and any later panel.
 *   ASSETS.uiStyle.settings.quality   the GFX-01 Quality row (low / medium / high / ultra / auto), drawn as a strip.
 *   ASSETS.uiStyle.settings.full      a 64 x 25 settings panel (title-menu Settings sub-view + pause Settings, S8-C-04):
 *                                     same field names as the US-038b `uiStyle.settings` (panel, frame, title, rows,
 *                                     labels, valueText, notes, marker, separator, keyHints...) plus `layout` (explicit
 *                                     row y per id, section labels). The old 40 x 12 `uiStyle.settings` stays as is.
 *   ASSETS.uiStyle.itemGetCard        S8-A-07: the item-get card (56 x 11, title bar + glowing icon box), for S8-C-07.
 *                                     Preview: design/preview/item-icons.html.
 *
 * COLOURS: every fg is an EXISTING palette.js key (no palette edit). `menu` also carries the hex of each key
 * (`hex`, checked against palette.js by the preview) because titleMenu.js draws with ui.setCell(x, y, g, '#hex', '#hex').
 * The only non-palette values are 4 backgrounds (literal, like uiStyle.inventory): plate [10,11,16] (lane C's
 * authorised placeholder, = items.toast plate), focus band [52,42,16] (= inventory slotSel), disabled band, soft ember.
 *
 * GRID: every number is a cell of the FIXED 160x60 UI layer (uiStyle.uiGrid), so the card is cell-identical at
 * 240x90 / 400x150 / 480x180 (12 x 18 px per glyph at 1920x1080). Widest panel here: 72 cells (< the 100-cell cap).
 *
 * LOADING (classic script): AFTER models/title.js (title.js assigns ASSETS.uiStyle = {...}, incl. uiStyle.settings).
 *   game/index.html: <script src="../design/models/menu_ui.js"></script>
 *
 * TITLE MENU (main mode, panel-relative col / row; 72 x 28 centred = UI (44, 16))
 *
 *   r0   +==o================================================================o==+
 *   r2   |                    -=[  K E S T R E L  ]=-                             |
 *   r3   |                     someone is calling                                 |
 *   r4   |  ----------------------- . . . - - - . . . ------------------------    |
 *   r6   |>> New game                                                          << |   (focus band, gold)
 *   r8   |   Continue                                                             |
 *   r10  |   SAVED GAMES                                                          |
 *   r12  |   [#] Slot 1   Wick           Watchtower                      1:01     |
 *   r14  |   [ ] Slot 2   - empty -                                               |
 *   r16  |   [#] Slot 3   Wick           Waystone                        0:13     |
 *   r18  |  ------------------------------------------------------------------    |
 *   r19  |   Delete selected slot                                                 |
 *   r21  |   Settings                                                             |
 *   r23  |  ------------------------------------------------------------------    |
 *   r24  |   (message line)                                                       |
 *   r26  |       Arrows: select   Enter: choose   Del: delete                     |
 *   r27  +==o================================================================o==+
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.uiStyle = A.uiStyle || {};

  // palette keys used (all exist in design/palette.js) and their hex, for hex-drawing callers (titleMenu.js)
  var HEX = {
    brassHot: '#fff0b4', brassLight: '#f0d27a', brass: '#c9a04a', brassDark: '#7a5e28', brassShadow: '#4a3716',
    gold: '#ffd24a', uiText: '#e8e2d0', uiHint: '#a9a390', uiDim: '#6a6a78',
    aether: '#2fe0c6', aetherDim: '#12665e', heroGreen: '#4fd66a', copperLight: '#ec9660'
  };
  // literal backgrounds / non-palette fg (same convention as uiStyle.inventory.rgb)
  var BG = {
    plate:     [10, 11, 16],   // lane C placeholder plate, kept: cool night card under warm brass
    band:      [52, 42, 16],   // focus band (= inventory slotSel): dark gold behind the focused row
    bandOff:   [20, 20, 26],   // disabled row band when the pointer hovers it (no gold: "nothing here")
    softEmber: [214, 112, 64]  // destructive / refusal fg (= overlay targetNone, inventory ember), never danger red
  };
  function hex(rgb) { return '#' + rgb.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }

  // =====================================================================================================
  // S8-A-04  uiStyle.menu  (title menu card)
  // =====================================================================================================
  A.uiStyle.menu = {
    story: 'S8-A-04 (for S8-C-03 titleMenu.js, S8-B1-03 boot)',
    hex: HEX,                                    // palette key -> '#rrggbb' (draw helper for setCell callers)
    bgRgb: BG,
    bg: { plate: hex(BG.plate), band: hex(BG.band), bandOff: hex(BG.bandOff), softEmber: hex(BG.softEmber) },
    fadeIn: 0.25, fadeOut: 0.15, fadeRule: 'uiStyle.fade (ramp-step dim, no alpha)',
    sceneDim: { bgMul: 0.35, note: 'scene behind the card (title backdrop / pause) x 0.35' },
    plate: { pad: 1, bgMul: 0.18, note: 'scene cells under the card (+1) x 0.18; the card cells themselves are opaque `bg.plate`' },

    // ---- card geometry: identical to the US-090a placeholder (bounds 72 x 28, centred on the 160 x 60 UI grid) ----
    panel: { w: 72, h: 28, align: 'center', note: 'x = floor((160 - 72) / 2) = 44, y = floor((60 - 28) / 2) = 16' },
    frame: {
      corner: '+', h: '=', v: '|', fg: 'brass', cornerFg: 'brassLight',
      rivets: { glyph: 'o', cols: [3, 68], rows: 'top and bottom', fg: 'brassLight',
                note: 'name-board rivets on the top / bottom frame rows, 3 cells in from each corner' },
      innerBevel: { glyph: '.', fg: 'brassShadow', note: 'OPTIONAL: col 1 and col w-2 one shade darker; leave out if it costs code' }
    },
    title: {
      row: 2, align: 'center', text: 'KESTREL', letterSpace: 1,       // drawn as "K E S T R E L"
      fg: 'brassHot', decor: ['-=[  ', '  ]=-'], decorFg: ['brassDark', 'brass'],
      decorRule: 'decor[0] / decor[1] around the spaced text; per char: "-" brassDark, "=" brass, "[" "]" brassLight',
      bracketFg: 'brassLight'
    },
    subtitle: { row: 3, align: 'center', text: 'someone is calling', fg: 'uiDim', optional: true,
                note: 'lower-case whisper under the name board (canon: models.subtitle); writer may change via S8-A-12' },
    signal: { row: 4, align: 'center', text: '. . . - - - . . .', fg: 'aetherDim', litFg: 'aether',
              pulse: { use: 'models.title.signal.ms (short 180, long 480, rest 1200)', optional: true,
                       rule: 'mark n lit (aether) in the SOS order, others aetherDim; static aetherDim is fine' },
              note: 'the one magic colour on the card, sits centred in the row-4 separator' },
    separators: [
      { row: 4, from: 3, to: 68, glyph: '-', fg: 'brassShadow', note: 'under the title; the signal text is drawn over its centre (1 space each side)' },
      { row: 18, from: 3, to: 68, glyph: '-', fg: 'brassShadow', note: 'between the slots and the Delete / Settings rows (main mode only)' },
      { row: 23, from: 3, to: 68, glyph: '-', fg: 'brassShadow', note: 'above the message line' }
    ],
    sectionLabel: { saves: { row: 10, col: 4, text: 'SAVED GAMES', fg: 'brassDark', mode: 'main' },
                    newGame: { row: 5, col: 4, text: 'Choose a slot for the new game', fg: 'uiHint', mode: 'new',
                               note: 'titleMenu.js already draws this string at row 5 (fg -> uiHint)' } },

    // ---- rows (every selectable line: New game, Continue, slots, Delete, Settings, Back, Cancel, Yes) ----
    row: {
      markerCol: 2, textCol: 4, bandFrom: 1, bandTo: 70,   // band = panel cols [bandFrom, bandTo] on the row
      normal:   { fg: 'uiText', bg: 'plate' },
      focus:    { fg: 'gold', bg: 'band', marker: '>', markerFg: 'gold', markerRight: '<', markerRightCol: 69,
                  pulse: { from: 'gold', to: 'brassHot', periodSec: 1.6, optional: true,
                           note: 'marker only; a static gold marker is the minimum' },
                  note: 'focused row: whole band filled bg.band, text + both markers gold' },
      disabled: { fg: 'uiDim', bg: 'plate', suffix: ' (unavailable)', suffixFg: 'uiDim', marker: null, focusable: false,
                  hover: { bg: 'bandOff', note: 'pointer over a disabled row: grey band, no marker, nothing happens' },
                  note: 'suffix = the string titleMenu.js already appends; S8-A-12 may reword it' },
      destructive: { ids: ['delete', 'yes@delete'], fg: 'softEmber', focusFg: 'softEmber', focusBg: 'band',
                     note: 'Delete row and the Yes row of a delete confirm: soft ember text (refusal colour, not danger red); ' +
                           'focus keeps the gold band + markers so the cursor stays one language' }
    },

    // ---- save slot rows (main: y 12 / 14 / 16; new: y 8 / 11 / 14) ----
    slot: {
      cols: { icon: 4, label: 8, name: 17, place: 32, timeEnd: 66,
              note: 'panel-relative; time is right-aligned so its last char sits on timeEnd; name clipped to 14, place to 28' },
      icon: { filled: '[#]', empty: '[ ]', broken: '[!]',
              fg: { bracket: 'brassDark', filled: 'brass', empty: 'uiDim', broken: 'softEmber' } },
      label: { format: 'Slot {n}', fg: 'brassLight' },
      name: { fg: 'uiText', max: 14 },
      place: { fg: 'uiHint', max: 28 },
      time: { format: '{h}:{mm}', fg: 'uiDim' },
      empty: { text: '- empty -', fg: 'uiDim' },
      broken: { text: 'Unreadable save', fg: 'softEmber', note: 'meta missing / ok false (titleMenu label "Unavailable")' },
      focus: { allFg: 'gold', keepIconFg: true, note: 'focused slot: every text part gold on the band, the icon keeps its own colours' },
      selectedMark: { glyph: '*', col: 3, fg: 'brass',
                      note: 'the slot Continue / Delete act on (selectedSlot) when it is NOT the focused row: one brass * left of the icon' },
      flatFallback: 'if per-part drawing is not done yet: draw row.display at textCol in row fg (one colour), still readable'
    },

    confirm: {
      textRow: 7, textCol: 4, fg: { delete: 'softEmber', replace: 'gold' },
      note: 'Cancel (row 12) is focused first; Yes (row 15) uses row.destructive when confirming a delete'
    },
    message: { row: 24, col: 4, info: 'uiHint', error: 'softEmber', prefix: '> ', prefixFg: 'uiDim' },
    keyHints: { row: 26, align: 'center', fg: 'uiDim', keyFg: 'gold',
                text: 'Arrows: select   Enter: choose   Del: delete',
                keys: ['Arrows', 'Enter', 'Del'] },
    version: { row: 27, colEnd: 67, fg: 'brassShadow', optional: true, note: 'build tag in the bottom frame, right; e.g. " v0.8 "' },

    adopt: [
      'titleMenu.js: createTitleMenu(adapter, { style: ASSETS.uiStyle.menu }) and read every colour as style.hex[key] / style.bg[name]',
      'frame: corner/h/v + rivets; title row 2 spaced + decor; subtitle row 3; separators 4 / 18 / 23 (+ signal over row 4)',
      'rows: band + markers on focus, uiDim + suffix when disabled, softEmber for destructive rows',
      'slots: per-part columns (or flatFallback); message colours; keyHints keys in gold. Geometry, row ids, y values: unchanged'
    ]
  };

  // =====================================================================================================
  // S8-A-05  uiStyle.settings.controls / .quality / .full
  // =====================================================================================================
  var S = A.uiStyle.settings = A.uiStyle.settings || {};   // exists (title.js, US-038b); only new keys are added

  // Controls: every state names fg palette keys (palette.rgb[key]) and bg by name in settings.full.bgRgb.
  S.controls = {
    story: 'S8-A-05',
    states: ['normal', 'focus', 'disabled'],
    label: { normal: 'uiText', focus: 'gold', disabled: 'uiDim' },
    marker: { glyph: '>', fg: 'gold', show: 'focus' },
    band: { focus: 'band', disabled: null, note: 'bg name (settings.full.bgRgb); normal rows sit on the panel bg' },
    disabledSuffix: { text: ' n/a', fg: 'uiDim', note: 'same as uiStyle.settings.disabled.suffix' },

    // < High >    one value, arrows step it
    select: {
      format: '< {text} >', arrows: ['<', '>'],
      normal:   { text: 'uiHint', arrows: 'uiDim' },
      focus:    { text: 'gold',   arrows: 'gold' },
      disabled: { text: 'uiDim',  arrows: 'brassShadow' },
      endStop: { arrowFg: 'brassShadow', note: 'at the first / last value the arrow on that side is drawn brassShadow (no wrap)' }
    },

    // Low  Medium [High] Ultra  Auto     every choice visible, current one bracketed (used by quality)
    strip: {
      gap: 2, bracket: ['[', ']'],
      normal:   { choice: 'uiDim',  current: 'uiText', bracket: 'brassDark' },
      focus:    { choice: 'uiHint', current: 'gold',   bracket: 'gold' },
      disabled: { choice: 'brassShadow', current: 'uiDim', bracket: 'brassShadow' },
      disabledChoice: { fg: 'brassShadow', skip: true,
                        note: 'one choice the device cannot take (e.g. Ultra): drawn brassShadow in every state, A/D skips it; ' +
                              'the note line says why' },
      rule: 'choices laid out left to right with `gap` spaces; the current one gets the brackets in place of the gap spaces ' +
            '(so the strip never shifts when the value changes)'
    },

    // [=======---]  7       0..10 steps
    slider: {
      cells: 10, left: '[', right: ']', fill: '=', empty: '-', knob: '|', valueFormat: '{v}', valueGap: 2,
      normal:   { bracket: 'brassDark', fill: 'brass',       empty: 'brassShadow', knob: 'brassLight', value: 'uiHint' },
      focus:    { bracket: 'gold',      fill: 'gold',        empty: 'brassDark',   knob: 'brassHot',   value: 'gold' },
      disabled: { bracket: 'brassShadow', fill: 'uiDim',     empty: 'brassShadow', knob: 'uiDim',      value: 'uiDim' },
      rule: 'filled cells = round(v / max * cells); the knob replaces the last filled cell (v = 0: knob on cell 0, rest empty)'
    },

    // [#] On   /   [ ] Off
    toggle: {
      on: { box: '[#]', text: 'On' }, off: { box: '[ ]', text: 'Off' }, gap: 1,
      normal:   { bracket: 'brassDark', mark: 'heroGreen', text: 'uiHint' },
      focus:    { bracket: 'gold',      mark: 'heroGreen', text: 'gold' },
      disabled: { bracket: 'brassShadow', mark: 'uiDim',   text: 'uiDim' }
    },

    // Back   (no value)
    action: { normal: 'uiText', focus: 'gold', disabled: 'uiDim' }
  };

  // The GFX-01 Quality row (game/js/ui/gfxPresets.js QUALITY_CHOICES). Writer may reword the notes (S8-A-12).
  S.quality = {
    id: 'quality', control: 'strip',
    choices: ['low', 'medium', 'high', 'ultra', 'auto'],
    text: { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', auto: 'Auto' },
    autoResolved: { format: 'Auto ({name})', note: 'when auto is current, its strip text shows the preset it resolved to, e.g. "Auto (High)"' },
    notes: {
      low: 'Fastest. Fewer light rays, short shadows.',
      medium: 'Balanced for laptops.',
      high: 'Full look. Recommended.',
      ultra: 'Every effect on. Needs a fast GPU.',
      auto: 'Picks a preset from a short GPU test.',
      disabled: 'Not available on this device.'
    },
    lead: 1, trail: 1,
    width: '" Low  Medium  High  Ultra  Auto (High) " = 39 cells (1 lead + 1 trail cell for the brackets of the first / last ' +
           'choice); fits settings.full valueW 40'
  };

  // 64 x 25 panel: the S8-C-04 Settings view (title menu "Settings" and the pause [S] entry).
  S.full = {
    story: 'S8-A-05 (for S8-C-04 settingsView / settings.js extension)',
    bgRgb: { panel: BG.plate, band: BG.band, bandOff: BG.bandOff },
    panel: { x: 48, y: 17, w: 64, h: 25, bg: 'panel', note: 'centred: (160 - 64) / 2, (60 - 25) / 2 rounded down; opaque cells' },
    frame: { corner: '+', h: '=', v: '|', color: 'brass', cornerColor: 'brassLight',
             rivets: { glyph: 'o', cols: [3, 60], color: 'brassLight' } },
    title: { text: 'SETTINGS', row: 0, align: 'center', color: 'brassHot', pad: 1, decor: ['[', ']'], decorColor: 'brassLight',
             note: 'top frame row: +==o===...===[ SETTINGS ]===...===o==+' },
    plate: { pad: 1, bgMul: 0.18 }, sceneDim: { bgMul: 0.35 },
    fadeIn: 0.15, fadeOut: 0.10,
    rows: { markerCol: 2, labelCol: 4, valueCol: 20, valueW: 40, noteOffset: 1, bandFrom: 1, bandTo: 62,
            note: 'cols panel-relative; y per row from `layout` (not first + i * gap)' },
    // explicit rows: sections are labels only (not selectable). rowOrder = the selectable ids top -> bottom.
    layout: [
      { section: 'GRAPHICS', y: 2 },
      { id: 'quality', y: 3 },
      { id: 'shadows', y: 5 },
      { id: 'grid', y: 7 },
      { section: 'SOUND', y: 9 },
      { id: 'volume', y: 10 },
      { id: 'mute', y: 12 },
      { section: 'COMFORT', y: 14 },
      { id: 'textSize', y: 15 },
      { id: 'reduceMotion', y: 17 },
      { id: 'back', y: 19 }
    ],
    rowOrder: ['quality', 'shadows', 'grid', 'volume', 'mute', 'textSize', 'reduceMotion', 'back'],
    section: { col: 3, color: 'brassDark', rule: { glyph: '-', color: 'brassShadow', gap: 1, toCol: 61,
               note: '"GRAPHICS -------------..." : the label, one space, then a brassShadow rule to toCol' } },
    controlOf: { quality: 'strip', shadows: 'select', grid: 'select', volume: 'slider', mute: 'toggle',
                 textSize: 'select', reduceMotion: 'toggle', back: 'action' },
    labels: { quality: 'Quality', shadows: 'Shadows', grid: 'Grid', volume: 'Volume', mute: 'Mute',
              textSize: 'Text size', reduceMotion: 'Reduce motion', back: 'Back' },
    valueText: {
      quality: S.quality.text,
      shadows: { off: 'Off', low: 'Low', mid: 'Medium', high: 'High' },
      grid: { '240x90': '240x90', '320x120': '320x120', '400x150': '400x150', '480x180': '480x180 ultra' },
      textSize: { small: 'Small', normal: 'Normal', large: 'Large' }
    },
    notes: {
      quality: S.quality.notes,
      shadows: { off: 'No sun shadows. Fastest.', default: null },
      grid: { '480x180': 'Ultra: needs a fast GPU.', default: 'More cells = finer picture, more GPU time.' },
      volume: { default: 'Music and effects.' },
      mute: { default: 'Same as the N key.' },
      textSize: { default: 'Menus and hints.' },
      reduceMotion: { default: 'Less camera shake, no screen flash.' }
    },
    note: { color: 'uiDim', col: 6, show: 'focus', note: 'the note line under the focused row only' },
    separator: { row: 21, glyph: '-', color: 'brassShadow', inset: 3 },
    keyHints: { row: 23, align: 'center', color: 'uiDim', key: 'gold',
                text: 'W/S select   A/D change   Enter toggle', keys: ['W/S', 'A/D', 'Enter'] },
    stepRule: 'as uiStyle.settings.stepRule; Enter / Space on a toggle flips it, on Back = Esc',
    mock: {
      note: 'preview stand-in values; options.js is the source of truth in the game',
      values: { quality: 'auto', qualityResolved: 'high', shadows: 'mid', grid: '400x150', volume: 7, mute: false,
                textSize: 'normal', reduceMotion: false },
      disabled: { quality: ['ultra'], rows: [] }
    }
  };

  // =====================================================================================================
  // S8-A-07 (appended, v1.43)  uiStyle.itemGetCard  (game/js/ui/itemGetCard.js, S8-C-07; hook S8-B1-04)
  // =====================================================================================================
  // 56 x 11 card, centred on the 160 x 60 UI grid (x 52, y 24). Panel-relative layout:
  //
  //   col 0  3        12 15                                          52  55
  //   r0   +==o===================[ FOUND ]=========================o==+
  //   r1   |######################*  Brass Buckler  *###################|   title bar: band bg, name gold
  //   r2   | .-----.----*-------------------------------------------- . |   separator (sparkles drawn over it)
  //   r3   |  +-------+                                                 |
  //   r4   |  | /=o=\ |  Gondola plate, bent round a strap.             |   desc (writer line, <= 38)
  //   r5  *|  | |:@:| |*                                                |   (sparkle ring round the icon box)
  //   r6   |  | \___/ |  Shield - either hand                           |   kind line
  //   r7   |  +-------+  x3 in the pack                                 |   count / progress line (optional)
  //   r8   |  .   +   .                                                 |
  //   r9   |  2 / 3                                        - any key -  |   queue tag (n >= 2) + continue
  //   r10  +==o=========================================================o==+
  var CARD_BG = {
    plate:   [10, 11, 16],   // = menu plate (cool night card under warm brass)
    band:    [52, 42, 16],   // = menu focus band: the title bar
    glow:    [64, 48, 14],   // icon box interior, the "lit from inside" warm gold (a step above band)
    glowHot: [92, 70, 22]    // glow pulse peak
  };
  A.uiStyle.itemGetCard = {
    story: 'S8-A-07 (for S8-C-07 itemGetCard.js)',
    hex: {
      brassHot: HEX.brassHot, brassLight: HEX.brassLight, brass: HEX.brass, brassDark: HEX.brassDark, brassShadow: HEX.brassShadow,
      gold: HEX.gold, uiText: HEX.uiText, uiHint: HEX.uiHint, uiDim: HEX.uiDim, heroGreen: HEX.heroGreen, white: '#ffffff'
    },
    bgRgb: CARD_BG,
    bg: { plate: hex(CARD_BG.plate), band: hex(CARD_BG.band), glow: hex(CARD_BG.glow), glowHot: hex(CARD_BG.glowHot) },
    iconColours: 'icon cells: ASSETS.items.keys[fgChar].c -> ASSETS.palette.rgb (same as inventoryView.js); a space = the cell bg',

    timing: {
      holdSec: 1.5, keyLockSec: 0.25, fadeIn: 0.12, fadeOut: 0.10, gapSec: 0.10,
      rule: 'game paused while a card shows. Auto-close after holdSec; any key / click closes it earlier, but keys in the ' +
            'first keyLockSec are ignored (the E that opened the chest must not skip the card). Queue: the next card shows ' +
            'gapSec after the previous fade-out (no re-fade of the scene dim between queued cards)'
    },
    sceneDim: { bgMul: 0.5, note: 'scene x 0.5 while a card shows (lighter than the pack: the world is still "there")' },
    plate: { pad: 1, bgMul: 0.18, note: 'scene cells under the card (+1) x 0.18; card cells are opaque' },

    panel: { x: 52, y: 24, w: 56, h: 11, bg: 'plate', note: 'x = (160 - 56) / 2, y = (60 - 11) / 2 rounded down' },
    frame: { corner: '+', h: '=', v: '|', fg: 'brass', cornerFg: 'brassLight',
             rivets: { glyph: 'o', cols: [3, 52], rows: 'top and bottom', fg: 'brassLight' },
             tag: { text: 'FOUND', row: 0, align: 'center', fg: 'brassHot', bracket: ['[ ', ' ]'], bracketFg: 'brassLight',
                    note: '"[ FOUND ]" in the top frame row; writer may give a key (proposal card.title)' } },

    // the title bar: the item NAME, the thing the player reads first
    titleBar: {
      row: 1, from: 1, to: 54, bg: 'band', align: 'center', fg: 'gold',
      decor: ['*  ', '  *'], decorFg: 'brassHot',
      pop: { sec: 0.07, fg: 'white', note: 'first ~4 frames the name is white, then gold (= items.toast pop)' },
      src: 'items.defs[id].name (<= 14 chars)'
    },
    separator: { row: 2, from: 2, to: 53, glyph: '-', fg: 'brassShadow' },

    // the glowing icon box (a slot box: 9 x 5, icon at box (2, 1))
    iconBox: {
      x: 3, y: 3, w: 9, h: 5, border: { corner: '+', h: '-', v: '|' }, icon: { x: 2, y: 1, w: 5, h: 3 },
      fg: 'gold', cornerFg: 'brassHot', innerBg: 'glow',
      pulse: { periodSec: 1.2, fg: ['gold', 'brassHot'], innerBg: ['glow', 'glowHot'],
               rule: 'border fg and interior bg step between the two values on a sine (> 0.5 = second value); ' +
                     'static gold + glow is the minimum' },
      reduceMotion: 'no pulse, no sparkles (options.reduceMotion)'
    },
    // the glow: 8 sparkle cells round the icon box, twinkling out of phase
    sparkles: {
      cells: [[2, 2], [7, 2], [12, 2], [1, 5], [13, 5], [2, 8], [7, 8], [12, 8]],
      frames: ['.', '+', '*', '+', '.', ' ', ' ', ' '],
      fg: ['brassDark', 'brass', 'brassHot', 'gold', 'brassDark', null, null, null],
      stepSec: 0.09, phase: 'cell i shows frames[(step + 3 * i) % 8]; a space = draw nothing (separator / plate shows)',
      note: 'panel-relative cells; row 2 sits on the separator (a sparkle replaces the "-" while lit)'
    },

    // the body, right of the box
    desc: { x: 15, y: 4, w: 38, maxLines: 1, fg: 'uiText', src: 'items.defs[id].desc (writer lines are <= 38)',
            wrap: 'one line; a longer desc wraps once onto row 5' },
    kind: {
      x: 15, y: 6, fg: 'uiHint',
      text: { weapon: 'Weapon', shield: 'Shield', spell: 'Spell', tool: 'Tool', food: 'Food', material: 'Material',
              key: 'Key', upgrade: 'Heart piece', currency: 'Currency', pickup: 'Used on touch' },
      handSuffix: ' - either hand',
      rule: 'text[def.kindNext || def.kind] + (def.hand ? handSuffix : "")'
    },
    count: { x: 15, y: 7, format: 'x{n} in the pack', fg: 'uiDim', show: 'def.stackMax > 1 and n >= 2',
             progress: { 'heart.piece': { format: '{n} of 4', fg: 'heroGreen' } },
             full: { text: 'Pack full - left behind', fg: [214, 112, 64], note: 'soft ember (= toast packFull) when the grant failed' } },
    pending: { show: 'def.pending', text: '(pending owner)', x: 15, y: 8, fg: 'uiDim', note: 'preview / dev builds only' },

    footer: {
      row: 9,
      continue: { text: '- any key -', colEnd: 52, fg: 'uiDim', show: 'after keyLockSec',
                  blink: { onSec: 0.7, offSec: 0.3, optional: true }, src: 'writer key card.continue' },
      queue: { col: 3, format: '{i} / {n}', fg: 'brassDark', show: 'n >= 2' }
    },

    mock: { queue: [{ id: 'shield', n: 1 }, { id: 'cog', n: 12 }, { id: 'heart.piece', n: 2 }] },
    adopt: [
      'itemGetCard.js: createItemGetCard(adapter, { style: ASSETS.uiStyle.itemGetCard, items: ASSETS.items, rgb: palette.rgb })',
      'fg = style.hex[key] (or palette rgb), bg = style.bg[name]; icons as inventoryView.js (items.keys -> palette.rgb)',
      'title bar = name, desc / kind / count rows, glow box + sparkles, footer; timing + queue per `timing`'
    ]
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { menu: A.uiStyle.menu, settings: S };
})(typeof window !== 'undefined' ? window : globalThis);
