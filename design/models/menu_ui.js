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
 *   r26  |     Arrows: select   Enter: choose   Del: delete   Esc: back           |
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
                text: 'Arrows: select   Enter: choose   Del: delete   Esc: back',
                keys: ['Arrows', 'Enter', 'Del', 'Esc'] },
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
                text: 'W/S select   A/D change   Enter toggle   Esc back', keys: ['W/S', 'A/D', 'Enter', 'Esc'] },
    stepRule: 'as uiStyle.settings.stepRule; Enter / Space on a toggle flips it, on Back = Esc',
    mock: {
      note: 'preview stand-in values; options.js is the source of truth in the game',
      values: { quality: 'auto', qualityResolved: 'high', shadows: 'mid', grid: '400x150', volume: 7, mute: false,
                textSize: 'normal', reduceMotion: false },
      disabled: { quality: ['ultra'], rows: [] }
    }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { menu: A.uiStyle.menu, settings: S };
})(typeof window !== 'undefined' ? window : globalThis);
