/*
 * Kestrel - READABLE NOTES (READ-01, owner 2026-10-05: "the text on the wall is not visible - it should be a document, a
 * letter or page somewhere, and you open it with E and read the text, instead of writing it on the wall").
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + README section 7 (voxel props) + section 5 (UI rules).
 * Texts: docs/story.md (writer) - copied verbatim, the writer owns them.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.note        a loose page lying flat (on a floor, a mat, a crate): 0.24 x 0.18 m, one voxel thick,
 *                                  pale linen paper, faded ink lines, a dog-eared corner folded back over the page.
 *   ASSETS.voxelModels.notePinned  the same page NAILED UPRIGHT to a wall: 0.18 x 0.24 m, torn top edge, an iron nail
 *                                  head, the bottom-right corner curling off the wall. Back face = the anchor plane, so the
 *                                  level point (x / y) IS the wall face (place it 5 mm in front of the face).
 *   ASSETS.notes                   { <id>: { title, lines[] } } - the text a note.read interactable opens (noteId).
 *   ASSETS.uiStyle.note            the paper reading panel on the fixed 160x60 UI layer (colours, border, title row,
 *                                  wrap width 56, footer "[E] / [Esc] close").
 *   ASSETS.voxelModels.attachNotes()  registers ASSETS.models.note / notePinned once every material is merged (all are
 *                                  today: linen_light, canvas_light, linen_dark, iron_dark). Called at load.
 *
 * LOADING (classic script, no build step): after palette.js + detail-pass.js (+ title.js for uiStyle, which this file only
 *   extends). content/levels/tower.level.json now places `note` / `notePinned` props, and World.load throws on an
 *   unregistered prop model, so EVERY page / Node loader that loads the tower needs this file (README change log v1.36).
 *
 * AXES (15.1): x = east, y = SOUTH with y0 = the model's FRONT row (faces north at facing 0), z = up.
 * READABILITY: at 400x150 and 1.5-2 m the flat page is ~6-8 cells wide, the pinned page ~6 x 8 cells: a pale
 *   rectangle with darker stripes (ink lines) is enough to read "paper"; the nearby wall lanterns light every page.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};
  A.uiStyle = A.uiStyle || {};

  // READ-01 / owner 2026-10-05: the page models `note` + `notePinned` live in design/models/m3_props.js (section 6c),
  // which every loader already includes; this file only holds the texts + the read-panel style (game-only).

  // ===================================================================================================================
  // 3. TEXTS (docs/story.md, verbatim). ASCII 32-126 only. '' = an empty line. The panel wraps at 56 cols (words; a
  //    word longer than 56 is hard-broken); lines that already fit are drawn as-is, spaces kept (tallies, signal).
  // ===================================================================================================================
  A.notes = {
    keeperLog: {
      title: 'Keeper\'s log',
      lines: [
        'Ink gone. The wall keeps the count now.',
        'Stool broke. Watched it from the floor. Same hour, same blink.',
        'If it ever stops, someone answered. It has not stopped.',
        '',
        'IIII IIII IIII IIII IIII',
        'IIII IIII IIII IIII III',
        '... --- ...  STILL'
      ],
      source: 'docs/story.md "The keeper\'s corner" (log book lines + the tally / signal that were the scrawlKeeper decals)'
    },
    journalCh1: {
      title: 'Pencil, on the back of the chart',
      lines: [
        'I thought the Wall kept the world out.',
        '',
        'Now I wonder what it kept hidden.',
        '',
        'A talking bear. Stones that shine without fire.',
        'A stranger who says magic is real.',
        '',
        'And somewhere ahead, that same blinking light.',
        '',
        'Three short. Three long. Three short.',
        '',
        'Someone is still calling.',
        '- W.'
      ],
      source: 'docs/story.md "Chapter complete + journal (CH1-W5)"'
    },
    keepLight: {
      title: 'A scrap, nailed up',
      lines: [
        'Up. Do not stay down here.',
        '',
        'Climb the stair to the very top.',
        'A blade waits by the broken wall.',
        '',
        'Do not go out without it.'
      ],
      source: 'docs/story.md q01 note 0 `note.keepLight` (PC-B writer, owner request 2026-10-10: first quest, sends the player up to the sword; was the scrawl KEEP THE LIGHT)'
    },
    steelHush: {
      title: 'A note by the sword',
      lines: [
        'To whoever finds this place:',
        '',
        'The road beyond is no longer safe.',
        'Take the blade. You may need it.',
        '',
        'And if you hear something below, do not answer.'
      ],
      source: 'docs/story.md q01 note 1 `note.steelHush` (CH1-D1a: page by the sword on the summit; was the scrawl STEEL FOR THE HUSH)'
    },
    leave: {
      title: 'A note by the stair',
      lines: [
        'These stones are not as dead as they seem.',
        '',
        'Do not stay here after dark.',
        'Something moves beneath the tower.',
        '',
        'Leave while there is still light.'
      ],
      source: 'docs/story.md q01 note 2 `note.leave` (CH1-D1a: summit doorway, prompt only after tower.sword.taken)'
    },
    masonChit: {
      title: 'Mason\'s chit',
      lines: ['Stones set by StickyBizcuit.'],
      source: 'docs/story.md "Credits / easter eggs" (OWN-REQ-013, exact case; was the decal `scrawlMason`). Never hinted.'
    }
  };

  // ===================================================================================================================
  // 4. THE READING PANEL (fixed 160x60 UI layer, literal RGB like uiStyle.inventory). A sheet of old paper over the
  //    dimmed scene. Height grows with the wrapped text: h = 8 + rows (rows = wrapped text lines), clamped 10..44.
  //
  //    col 0   4                                                         59  63
  //    r0     .-~--.-~---_-~-.--~-----.-~--.-~---_-~-.--~-----.-~--.-~-.        torn top edge (pattern, repeated)
  //    r1     |                                                         |
  //    r2     |                     Keeper's log                         |      title, centred, rust ink
  //    r3     |   ----------------------------------------------------   |      rule (faded ink)
  //    r4     |                                                         |
  //    r5..   |   Ink gone. The wall keeps the count now.               |      text, ink, wrap 56 from col 4
  //    ..     |                                                         |
  //    h-2    |                                     [E] / [Esc] close    |      footer, right-aligned at col 59
  //    h-1    '-.~--'-~--._-~-'--~-'.-~--'-~--._-~-'--~-'.-~--'-~--'-~-'        torn bottom edge
  //           + 1-cell drop shadow to the right / below (bg shadow)
  // ===================================================================================================================
  var RGB = {
    paper:      [214, 198, 158],  // the sheet (aged linen, between canvasLight and canvas)
    paperEdge:  [184, 164, 120],  // border cells (the torn rim is a shade darker)
    edgeInk:    [120, 98, 66],    // border glyphs on paperEdge
    ink:        [40, 32, 24],     // body text
    inkFaded:   [104, 88, 66],    // rule, footer text
    inkTitle:   [104, 40, 26],    // title: dried rust-brown ink
    inkKey:     [128, 64, 22],    // [E] / [Esc] in the footer (warm brown: gold would vanish on paper)
    shadow:     [8, 6, 5]         // drop shadow
  };
  A.uiStyle.note = {
    story: 'READ-01',
    rgb: RGB,
    open: {
      by: 'interactables[] with interact "note.read" + noteId (prompt "[E] Read"); the text is ASSETS.notes[noteId]',
      closeKeys: ['E', 'Escape'],
      closeRule: 'close on the NEXT key-down of E or Esc (the E press that opened the note must not close it)',
      pause: 'same gate as the pack screen (uiStyle.inventory.open.pause): sim, beasts, targeting frozen while reading',
      pointer: 'pointer lock released while open is NOT needed (no mouse use); keep it locked',
      state: 'optional: set world.state "notes.<noteId>.read" = true on first open (future journal / hints; nothing reads it yet)'
    },
    fadeIn: 0.12, fadeOut: 0.08, fadeRule: 'uiStyle.fade (ramp-step dim, no alpha)',
    sceneDim: { bgMul: 0.35, note: 'whole scene x 0.35 while open (as the pack screen)' },
    hudVisible: false,

    panel: {
      w: 64, x: 48, minH: 10, maxH: 44,
      h: '8 + wrapped text rows, clamped minH..maxH',
      y: 'floor((60 - h) / 2)',
      bg: RGB.paper,
      note: 'x = (160 - 64) / 2; every cell inside the frame is drawn with bg paper (opaque, README 5)'
    },
    frame: {
      top:    { pattern: '.-~--.-~---_-~-.--~-----', fg: RGB.edgeInk, bg: RGB.paperEdge,
                rule: 'row 0, cols 0..63: pattern repeated from col 0 and cut at 64 (a torn, uneven edge)' },
      bottom: { pattern: '\'-.~--\'-~--._-~-\'--~-', fg: RGB.edgeInk, bg: RGB.paperEdge,
                rule: 'row h-1, cols 0..63, same repeat rule' },
      side:   { glyph: '|', fg: RGB.edgeInk, bg: RGB.paperEdge, rule: 'cols 0 and 63, rows 1..h-2' },
      shadow: { dx: 1, dy: 1, bg: RGB.shadow, glyph: ' ', rule: 'col 64 rows 1..h, row h cols 1..64 (over the dimmed scene)' }
    },
    title: { row: 2, align: 'center', fg: RGB.inkTitle, rule: 'ASSETS.notes[id].title, centred in cols 1..62' },
    rule:  { row: 3, from: 4, to: 59, glyph: '-', fg: RGB.inkFaded },
    text: {
      row: 5, col: 4, wrap: 56, fg: RGB.ink,
      wrapRule: 'word wrap at spaces into 56 cols; a word > 56 is hard-broken; "" = an empty row; leading / inner spaces ' +
                'of a line that fits are kept (tally / signal lines). ASCII 32-126 only (validate: any other char -> "?")',
      overflow: 'more than maxH - 8 = 36 rows: cut and end the last row with "..." (no scrolling needed for any M1 note)'
    },
    footer: {
      row: 'h - 2', alignRight: 59,
      parts: [], note: 'owner 2026-10-09: no close hint is printed'
    },
    sound: { open: 'optional: a short paper rustle (audio may reuse any cloth / UI tick); none required for READ-01' },
    mock: { noteId: 'keeperLog', note: 'the preview / test fixture' }
  };

  // 4b. READ-01 level patch: the 4 `note.read` interactables (prompt [E] Read). Kept OUT of tower.level.json until READ-01
  //     registers the `note.read` behaviour (World.load / content-smoke reject unknown behaviours); the page props are
  //     already placed in the level. READ-01 appends these to tower.level.json `interactables` in the same commit.
  A.levelPatch = A.levelPatch || {};
  A.levelPatch.towerNotes = { file: 'content/levels/tower.level.json', appendInteractables: [{"id": "noteKeeperLog", "interact": "note.read", "note": "READ-01: opens the paper panel (uiStyle.note) with ASSETS.notes[noteId]; re-readable (once false), the page stays. Aim = the page's prompt mount (z + 0.015)", "noteId": "keeperLog", "once": false, "prompt": "[E] Read", "prop": "noteKeeperLog", "radius": 1.8, "x": 18.62, "y": 9.52, "z": 0.06}, {"id": "noteKeepLight", "interact": "note.read", "note": "READ-01: the pinned page behind the wake spot; aim = the front of the sheet, mid height", "noteId": "keepLight", "once": false, "prompt": "[E] Read", "prop": "noteKeepLight", "radius": 1.8, "x": 17.45, "y": 9.965, "z": 0.92}, {"id": "noteSteelHush", "interact": "note.read", "note": "READ-01: the pinned page beside the sword (the sword's own prompt aims at its guard, 1.45 m: the two aim points are 1.2 m apart and at different heights, so the view-angle pick separates them)", "noteId": "steelHush", "once": false, "prompt": "[E] Read", "prop": "noteSteelHush", "radius": 1.8, "x": 13.55, "y": 6.965, "z": 0.97}, {"id": "noteMason", "interact": "note.read", "note": "READ-01 / OWN-REQ-013: the mason's chit; smaller radius so it only prompts when the player looks for it (never hinted)", "noteId": "masonChit", "once": false, "prompt": "[E] Read", "prop": "noteMason", "radius": 1.2, "x": 16.35, "y": 3.965, "z": 0.67}] };

  // ===================================================================================================================
  // 5. ATTACH: the note page models register through attachM3 (m3_props.js 6c); kept as a no-op for old callers.
  // ===================================================================================================================
  A.voxelModels.attachNotes = function attachNotes() { return A.voxelModels.attachM3 ? A.voxelModels.attachM3() : []; };
  A.voxelModels.attachNotes();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { note: A.voxelModels.note, notePinned: A.voxelModels.notePinned, notes: A.notes,
                       uiStyle: A.uiStyle.note, attachNotes: A.voxelModels.attachNotes };
  }
})(typeof window !== 'undefined' ? window : globalThis);
