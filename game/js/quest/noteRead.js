// game/js/quest/noteRead.js (READ-01, owner 2026-10-05: wall writing becomes
// readable notes "open it with E and read the text"). Real body of
// `note.read`, named by the 4 tower interactables READ-01 appends from
// `ASSETS.levelPatch.towerNotes` (design/models/notes.js) - each
// `{ id, interact: 'note.read', noteId, prompt: '[E] Read', prop, radius, x,
// y, z, once: false }`. No literal coordinate here (US-010 tech note 1 rule).
//
// Split (same shape as end.js/beacon.js/lantern.js): the behaviour only
// records what it can see (`ctx.def.noteId` - the interactable's own data)
// into a module-level "open this note" request plus the optional persistent
// read mark (`world.state['notes.<noteId>.read'] = true`, uiStyle.note.open
// .state - nothing reads it yet, but world.state serializes so it survives a
// save/load). The actual per-frame fade + `[E]`/`[Esc]` close + the paper
// panel draw live here too (called from main.js's fixed step / render loop,
// next to the other quest UI gates), so the note panel knows no `ASSETS` of
// its own - main.js hands it `notes` (ASSETS.notes) + `uiStyle` (ASSETS
// .uiStyle, which notes.js extends with `.note`), the same "no ASSETS in a
// behaviour" precedent as hints.js/endCard.js.
//
// The panel is a CUSTOM text draw (title + word-wrapped lines + footer), not
// `engine/ui/panel.js`'s `buildPanelArt` - `uiStyle.note` is a descriptive
// spec (colours, torn-edge patterns, wrap width), not a `{size, animations}`
// panel model, so there is no `PanelArt` to bake. It reuses the same
// primitives the end/map/death cards use (`compileRichLine`/`drawRichLine` +
// `setCellRGB` on the duck-typed `UiLayer`), no new engine helper.
import { compileRichLine, drawRichLine } from '../../../engine/index.js';

// Module-level runtime state, rebuilt on every 'world:loaded' (architecture.md
// 7.6 item 6 "runtime state is NOT world.state" - same as mapCard.js's `panel`
// / hints.js's `current`). `note.read` (the behaviour) and the panel helpers
// below are in this one module, so the behaviour can hand the open request
// straight to the panel state without a world.state round trip.
let noteState = 'closed'; // 'closed' | 'opening' | 'open' | 'closing'
let noteId = null;        // ASSETS.notes key of the note currently open
let noteA = 0;            // 0..1 fade alpha (uiStyle.note fadeIn/fadeOut)
let fadeIn = 0.12;
let fadeOut = 0.08;
let prevLocked = false;   // pointer-lock state of the previous step (BUG-NOTE-ESC-01)
let sceneMul = 0.35;      // uiStyle.note.sceneDim.bgMul (whole scene while open)

// Per-note render cache, built once per open (NOT per frame - rule 9): the
// wrapped text rows, the panel geometry, and the compiled RichLines. The note
// texts never change at runtime, so this only rebuilds when the open note id
// changes (or after a reset).
let noteRender = null; // { id, rows, h, panelX, panelY, titleLine, footerLine, textLines, titleX, footerStartX }

const FOOTER_TEXT = ''; // owner 2026-10-09: no 'Esc to close' hint text (E / Esc still close)
const PANEL_W = 64;

/** ASCII 32-126 only (uiStyle.note.text.wrapRule): any other char -> "?". */
function sanitizeLine(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += (c >= 32 && c <= 126) ? s[i] : '?';
  }
  return out;
}

/**
 * Word-wraps the note's raw lines (uiStyle.note.text.wrapRule): a line that
 * already fits `wrap` cols is kept verbatim (leading/inner spaces preserved -
 * the tally / signal lines); a longer line is wrapped at spaces; a word longer
 * than `wrap` is hard-broken; "" stays an empty row. More than `maxRows`
 * wrapped rows are cut, the last row ending in "...". Pure - exported for the
 * test's wrap checks.
 * @param {string[]} lines
 * @param {number} wrap
 * @param {number} maxRows
 * @returns {{rows: string[], truncated: boolean}}
 */
export function wrapNoteLines(lines, wrap, maxRows) {
  const rows = [];
  for (const raw of lines) {
    const line = sanitizeLine(raw);
    if (line.length <= wrap) { rows.push(line); continue; }
    const words = line.split(' ');
    let cur = '';
    for (let w of words) {
      while (w.length > wrap) { // a word longer than wrap is hard-broken
        if (cur) { rows.push(cur); cur = ''; }
        rows.push(w.slice(0, wrap));
        w = w.slice(wrap);
      }
      if (cur === '') cur = w;
      else if (cur.length + 1 + w.length <= wrap) cur += ' ' + w;
      else { rows.push(cur); cur = w; }
    }
    if (cur !== '') rows.push(cur);
  }
  let truncated = false;
  if (rows.length > maxRows) {
    rows.length = maxRows;
    const tail = '...';
    const last = rows[maxRows - 1];
    rows[maxRows - 1] = (last.length + tail.length <= wrap) ? last + tail : last.slice(0, wrap - tail.length) + tail;
    truncated = true;
  }
  return { rows, truncated };
}

/**
 * `note.read` behaviour. `ctx.def.noteId` is the interactable's own data
 * (`ASSETS.levelPatch.towerNotes`, hand-copied into content/levels/tower
 * .level.json) - never a hard-coded id. `once: false` means `usedKey` is null
 * (World.load), so the page stays re-readable; this only opens the panel and
 * sets the (optional, idempotent) read mark.
 * @param {{world: import('../../../engine/index.js').World, def: Object}} ctx
 * @returns {boolean}
 */
export function noteRead(ctx) {
  const { world, def } = ctx;
  const id = def && def.noteId;
  if (typeof id !== 'string') return false;
  world.state['notes.' + id + '.read'] = true; // optional read mark (persisted; nothing reads it yet)
  noteId = id;
  noteState = 'opening';
  noteA = 0;
  return true;
}

/** Rebuilds runtime state + the fade/panel config from `uiStyle.note`. Call on 'world:loaded'. */
export function resetNoteRead(uiStyle) {
  noteState = 'closed';
  noteId = null;
  noteA = 0;
  noteRender = null;
  const n = uiStyle && uiStyle.note;
  fadeIn = (n && typeof n.fadeIn === 'number') ? n.fadeIn : 0.12;
  fadeOut = (n && typeof n.fadeOut === 'number') ? n.fadeOut : 0.08;
  sceneMul = (n && n.sceneDim && typeof n.sceneDim.bgMul === 'number') ? n.sceneDim.bgMul : 0.35;
}

/**
 * One fixed step (main.js, after `updateInteraction` - the same slot the other
 * quest steps use): advances the fade, and closes on the NEXT `[E]`/`[Esc]`
 * key-down while `open` (the E press that opened the note fired the behaviour
 * and set `noteState = 'opening'`, so the close check's `state === 'open'`
 * guard means that same edge can never close it - uiStyle.note.open.closeRule).
 * A cheap no-op the rest of the time.
 * @param {number} dt - seconds
 * @param {{pressed:(code:string)=>boolean, consumePressed?:()=>void}} input
 * @param {boolean} [locked] pointer-lock state this step (see BUG-NOTE-ESC-01 below)
 */
export function stepNoteRead(dt, input, locked) {
  // BUG-NOTE-ESC-01: under pointer lock Chrome eats Esc (releases the lock, no keydown reaches the page), so a lock-lost
  // edge (true -> false) while a note is up closes it. `locked` undefined (old callers / no lock support) = never closes.
  if (typeof locked === 'boolean') {
    if (prevLocked && !locked && (noteState === 'open' || noteState === 'opening')) noteState = 'closing';
    prevLocked = locked;
  }
  if (noteState === 'opening') {
    noteA += fadeIn > 0 ? dt / fadeIn : 1;
    if (noteA >= 1) { noteA = 1; noteState = 'open'; }
  } else if (noteState === 'closing') {
    noteA -= fadeOut > 0 ? dt / fadeOut : 1;
    if (noteA <= 0) { noteA = 0; noteState = 'closed'; noteId = null; }
  }
  if (noteState === 'open' && input && (input.pressed('KeyE') || input.pressed('Escape'))) {
    if (input.consumePressed) input.consumePressed();
    noteState = 'closing';
  }
}

/** Input gate (main.js ORs this into `uiLocked`, same as `isMapOpen()`). */
export function isNoteOpen() { return noteState !== 'closed'; }

/** Test/debug: the `ASSETS.notes` key currently open, or null. */
export function getOpenNoteId() { return noteId; }

/**
 * Whole-scene dim while open (uiStyle.note.sceneDim.bgMul, e.g. 0.35) - sets
 * `dim.all` like panel.js's `pushDim` does for a `sceneMul` panel. Call in
 * render() before `applySceneDim`, same slot as `mapPanel.pushDim`/`pushHintDim`.
 * @param {{all:number}} dim - main.js's reused `sceneDim`
 */
export function pushNoteDim(dim) {
  if (noteState === 'closed' || !dim) return;
  const mul = 1 + (sceneMul - 1) * noteA;
  if (mul < dim.all) dim.all = mul;
}

/**
 * Draws the paper reading panel into the fixed UI layer (`ui`, duck-typed like
 * a RenderTarget - `setCellRGB` only) using `uiStyle.note`'s literal RGB.
 * Geometry (uiStyle.note.panel/frame/title/rule/text/footer): a 64-wide sheet
 * centred on `ui.cols`, height `8 + wrapped rows` clamped [minH, maxH], torn
 * top/bottom edges, `|` sides, a drop shadow, centred title, a rule, the
 * wrapped body, and the right-aligned "[E] / [Esc] close" footer. Fade: fg is
 * scaled by `noteA` (the paper/edge/shadow backgrounds stay opaque - the same
 * "bg stays, fg fades" shape engine/ui/panel.js uses). No allocation per frame
 * (rule 9): the wrap + RichLine compile happens once per open, cached.
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {Object} notes - `ASSETS.notes` ({id: {title, lines}})
 * @param {Object} uiStyle - `ASSETS.uiStyle` (with `.note`)
 */
export function drawNotePanel(ui, notes, uiStyle) {
  if (noteState === 'closed' || !noteId) return;
  const cfg = uiStyle && uiStyle.note;
  if (!cfg || !cfg.rgb || !ui) return;
  const RGB = cfg.rgb;
  const panel = cfg.panel || {};
  const frame = cfg.frame || {};
  const textCfg = cfg.text || {};
  const wrap = typeof textCfg.wrap === 'number' ? textCfg.wrap : 56;
  const minH = typeof panel.minH === 'number' ? panel.minH : 10;
  const maxH = typeof panel.maxH === 'number' ? panel.maxH : 44;
  const textCol = typeof textCfg.col === 'number' ? textCfg.col : 4;
  const textRow = typeof textCfg.row === 'number' ? textCfg.row : 5;

  if (!noteRender || noteRender.id !== noteId) {
    const note = notes && notes[noteId];
    const lines = note && Array.isArray(note.lines) ? note.lines : [];
    const { rows } = wrapNoteLines(lines, wrap, maxH - 8);
    const h = Math.max(minH, Math.min(maxH, 8 + rows.length));
    const panelX = (ui.cols - PANEL_W) >> 1;
    const panelY = (ui.rows - h) >> 1;
    const title = note && typeof note.title === 'string' ? sanitizeLine(note.title) : '';
    const titleLine = compileRichLine(title, RGB.inkTitle, RGB.inkTitle, []);
    const footerLine = compileRichLine(FOOTER_TEXT, RGB.inkFaded, RGB.inkKey, ['[Esc]', '[E]']);
    const textLines = rows.map((r) => compileRichLine(r, RGB.ink, RGB.ink, []));
    noteRender = {
      id: noteId, rows, h, panelX, panelY, titleLine, footerLine, textLines,
      titleX: panelX + 1 + ((62 - title.length) >> 1),
      footerStartX: panelX + 59 - footerLine.n + 1, // right-aligned so the last char lands on col 59
    };
  }

  const { rows, h, panelX, panelY, titleLine, footerLine, textLines, titleX, footerStartX } = noteRender;
  const a = noteA;
  const paper = RGB.paper, paperEdge = RGB.paperEdge, edgeInk = RGB.edgeInk, inkFaded = RGB.inkFaded, shadow = RGB.shadow;

  const glyph = (x, y, ch, fg, bg, k) => {
    const code = (ch && ch.length ? ch.charCodeAt(0) : 32) - 32;
    ui.setCellRGB(x, y, (code < 0 || code > 94) ? 0 : code, (fg[0] * k) | 0, (fg[1] * k) | 0, (fg[2] * k) | 0, bg[0], bg[1], bg[2]);
  };

  // Drop shadow: one cell right (col 64) rows 1..h, and one cell below (row h) cols 1..64.
  for (let y = 1; y <= h; y++) glyph(panelX + PANEL_W, panelY + y, ' ', shadow, shadow, 1);
  for (let x = 1; x <= PANEL_W; x++) glyph(panelX + x, panelY + h, ' ', shadow, shadow, 1);

  // The sheet: every interior cell opaque paper (README 5), then the torn rims.
  for (let y = 1; y <= h - 2; y++) for (let x = 1; x <= 62; x++) glyph(panelX + x, panelY + y, ' ', paper, paper, 1);

  // Side borders (cols 0 / 63) + torn top/bottom edges (rows 0 / h-1).
  for (let y = 1; y <= h - 2; y++) {
    glyph(panelX, panelY + y, '|', edgeInk, paperEdge, a);
    glyph(panelX + 63, panelY + y, '|', edgeInk, paperEdge, a);
  }
  const top = (frame.top && frame.top.pattern) || '';
  const bottom = (frame.bottom && frame.bottom.pattern) || '';
  for (let x = 0; x < PANEL_W; x++) {
    glyph(panelX + x, panelY, top[x % top.length] || ' ', edgeInk, paperEdge, a);
    glyph(panelX + x, panelY + h - 1, bottom[x % bottom.length] || ' ', edgeInk, paperEdge, a);
  }

  // Rule (row 3, cols 4..59), then the title / wrapped body / footer.
  for (let x = 4; x <= 59; x++) glyph(panelX + x, panelY + 3, '-', inkFaded, paper, a);
  drawRichLine(ui, titleX, panelY + 2, titleLine, a, null, titleLine.n, paper);
  for (let i = 0; i < rows.length; i++) {
    drawRichLine(ui, panelX + textCol, panelY + textRow + i, textLines[i], a, null, textLines[i].n, paper);
  }
  drawRichLine(ui, footerStartX, panelY + h - 2, footerLine, a, null, footerLine.n, paper);
}
