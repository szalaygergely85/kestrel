// S8-C-12: cached objective HUD/log view over the shipped quest sim.
import { drawText } from '../../../engine/index.js';
import { validateQuestDefinition, questObjectives } from '../quest/sim/quest.js';

const ascii = value => value.replace(/[^\x20-\x7e]/g, '?');
function clipped(text, width) { return text.length <= width ? text : text.slice(0,width-3)+'...'; }

/** Call update on quest changes; drawHud/drawLog never format or allocate rows.
 * Approved writer copy stays in content; existing plate/foreground retained.
 */
export function createQuestLog(def, {hudWidth=60,width=72,fg='#e8e2d0',bg='#0a0b10'} = {}) {
  validateQuestDefinition(def);
  if (!Number.isInteger(hudWidth) || hudWidth < 3 || !Number.isInteger(width) || width < 12) throw new RangeError('questLog: invalid width');
  const rows = def.objectives.map(objective=>({id:objective.id,text:objective.text,status:'locked',progress:0,target:1}));
  const labels = def.objectives.map(objective=>ascii(objective.text));
  const rendered = rows.map(()=> '');
  const bounds = {x:0,y:0,w:width,h:rows.length*2+6};
  let objectiveLine = '';
  function update(state) {
    if (state.questId !== def.id) throw new Error('questLog: incompatible quest');
    questObjectives(state,def,rows);
    objectiveLine = '';
    for (let i=0;i<rows.length;i++) {
      const row = rows[i], marker = row.status === 'complete' ? '[x] ' : row.status === 'active' ? '[>] ' : '[ ] ';
      rendered[i] = clipped(marker+labels[i],width-6);
      if (row.status === 'active') objectiveLine = clipped(labels[i],hudWidth);
    }
    return objectiveLine;
  }
  function drawHud(ui,x,y) {
    for (let i=0;i<hudWidth;i++) ui.setCell(x+i,y,' ',fg,bg);
    drawText(ui,x,y,objectiveLine,fg,bg);
  }
  function drawLog(ui) {
    bounds.x=Math.floor((ui.cols-width)/2); bounds.y=Math.floor((ui.rows-bounds.h)/2);
    for (let y=0;y<bounds.h;y++) for(let x=0;x<width;x++) ui.setCell(bounds.x+x,bounds.y+y,' ',fg,bg);
    drawText(ui,bounds.x+3,bounds.y+1,'PENCIL NOTES',fg,bg);
    for (let i=0;i<rendered.length;i++) drawText(ui,bounds.x+3,bounds.y+4+i*2,rendered[i],fg,bg);
    return bounds;
  }
  return {update,drawHud,drawLog,getObjectiveLine:()=>objectiveLine,
    snapshot:()=>rows.map(row=>({...row}))};
}

// QG-05 (D-058, 38.35 item 8): quest log SCREEN over the quest book, in the pause/title menu skin (uiStyle.menu).
// Rows (strings) are rebuilt only on open, key input and a changed book.version; draw() never formats or allocates.
export const QUEST_LOG_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Enter', 'KeyJ', 'Escape'];
export const QUEST_LOG_TEXT = Object.freeze({ header: 'PENCIL NOTES', empty: 'Nothing yet. Not nothing.', active: 'Active', done: 'Done', main: '(main)' });
const READY = 3, DONE = 4, LIST_TOP = 6, LIST_ROWS = 14;

/**
 * @param {any} book createQuestBook() result
 * @param {{style?:any, text?:Partial<typeof QUEST_LOG_TEXT>, width?:number, doneTitle?:string, onJournal?:(questIndex:number)=>void}} o
 * CH1-09: a DONE main quest (index 0) is listed as `doneTitle` ("Beyond the Wall"); Enter on it closes the log and calls
 * `onJournal(0)` (main.js re-opens the chapter journal). Without `onJournal`, Enter just closes like before.
 */
export function createQuestLogScreen(book, { style = null, text = {}, width = 72, doneTitle = 'Beyond the Wall', onJournal = null } = {}) {
  const T = { ...QUEST_LOG_TEXT, ...text }, W = width - 8;
  const colour = key => (style && (style.hex[key] || style.bg[key])) || '#e8e2d0';
  const fg = style ? colour(style.row.normal.fg) : '#e8e2d0', bg = style ? style.bg.plate : '#0a0b10';
  const heading = T.header;
  const titleText = style ? style.title.decor[0] + heading.split('').join(' '.repeat(style.title.letterSpace)) + style.title.decor[1] : heading;
  const bounds = { x: 0, y: 0, w: width, h: 24 };
  const scratch = [];
  let open = false, built = -1, sel = 0, top = 0, quests = [], lines = [];

  /** quests = selectable quest indices: Active (main first, then newest = highest index) then Done. */
  function rebuild() {
    built = book.version; quests = [];
    const n = book.count, done = [];
    for (let i = 0; i < n; i++) { const s = book.status(i); if (s === 2 || s === READY) quests.push(i); }
    quests.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a));
    const nActive = quests.length;
    for (let i = n - 1; i >= 0; i--) if (book.status(i) === DONE) done.push(i);
    for (const i of done) quests.push(i);
    if (sel >= quests.length) sel = Math.max(0, quests.length - 1);
    lines = []; let selLine = 0, lastHeader = '';
    for (let k = 0; k < quests.length; k++) {
      const i = quests[k], isDone = k >= nActive, head = isDone ? T.done : T.active;
      if (head !== lastHeader) { lines.push({ kind: 'head', text: head }); lastHeader = head; }
      const def = book.def(i), s = book.status(i);
      if (k === sel) selLine = lines.length;
      lines.push({ kind: 'quest', k, text: ascii((isDone && i === 0 && doneTitle) || def.title || def.id) + (i === 0 ? ' ' + T.main : ''), done: isDone });
      if (k !== sel) continue;
      if (s === READY && def.returnText) lines.push({ kind: 'return', text: '  > ' + clipped(ascii(def.returnText), W - 8) });
      const rows = book.objectives(i, scratch);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r], mark = row.status === 'complete' ? '[x] ' : row.status === 'active' ? '[>] ' : '[ ] ';
        lines.push({ kind: 'step', status: row.status, text: '  ' + clipped(mark + ascii(row.text) + (row.target > 1 ? ' ' + row.progress + '/' + row.target : ''), W - 8) });
      }
    }
    if (selLine < top) top = selLine;
    if (selLine >= top + LIST_ROWS) top = selLine - LIST_ROWS + 1;
    if (top < 0 || lines.length <= LIST_ROWS) top = 0;
  }
  function show() { open = true; sel = 0; top = 0; rebuild(); }
  function close() { open = false; }
  /** Returns true when the key was consumed. Enter/J/Esc close; W/S move (wraps). */
  function handleKey(code) {
    if (!open) return false;
    if (code === 'Enter' && onJournal && quests[sel] === 0 && book.status(0) === DONE) { close(); onJournal(0); return true; }
    if (code === 'Enter' || code === 'KeyJ' || code === 'Escape') { close(); return true; }
    const d = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    if (!d) return false;
    if (quests.length > 1) { sel = (sel + d + quests.length) % quests.length; rebuild(); }
    return true;
  }
  function draw(ui) {
    if (built !== book.version) rebuild();
    bounds.x = Math.floor((ui.cols - bounds.w) / 2); bounds.y = Math.floor((ui.rows - bounds.h) / 2);
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) for (let x = bounds.x; x < bounds.x + bounds.w; x++) ui.setCell(x, y, ' ', fg, bg);
    const f = style?.frame, fi = f ? colour(f.fg) : fg;
    for (let x = 1; x < bounds.w - 1; x++) { ui.setCell(bounds.x + x, bounds.y, f?.h || '-', fi, bg); ui.setCell(bounds.x + x, bounds.y + bounds.h - 1, f?.h || '-', fi, bg); }
    for (let y = 0; y < bounds.h; y++) {
      const corner = y === 0 || y === bounds.h - 1, g = corner ? f?.corner || '+' : f?.v || '|', ink = f ? colour(corner ? f.cornerFg : f.fg) : fg;
      ui.setCell(bounds.x, bounds.y + y, g, ink, bg); ui.setCell(bounds.x + bounds.w - 1, bounds.y + y, g, ink, bg);
    }
    if (style) {
      for (const x of f.rivets.cols) {
        ui.setCell(bounds.x + x, bounds.y, f.rivets.glyph, colour(f.rivets.fg), bg);
        ui.setCell(bounds.x + x, bounds.y + bounds.h - 1, f.rivets.glyph, colour(f.rivets.fg), bg);
      }
      for (let x = 3; x <= 68; x++) ui.setCell(bounds.x + x, bounds.y + 4, '-', colour('brassShadow'), bg);
    }
    drawText(ui, bounds.x + (style ? Math.floor((bounds.w - titleText.length) / 2) : 3), bounds.y + 2, titleText, style ? colour(style.title.fg) : fg, bg);
    if (!lines.length) { drawText(ui, bounds.x + 4, bounds.y + LIST_TOP + 1, T.empty, fg, bg); return bounds; }
    const dim = style ? colour(style.row.disabled.fg) : fg, head = style ? colour(style.sectionLabel.newGame.fg) : fg;
    const focusSt = style?.row.focus, normSt = style?.row.normal;
    for (let r = 0; r < LIST_ROWS; r++) {
      const ln = lines[top + r]; if (!ln) break;
      const y = bounds.y + LIST_TOP + r;
      if (ln.kind === 'head') { drawText(ui, bounds.x + 4, y, ln.text, head, bg); continue; }
      if (ln.kind === 'quest') {
        const focus = ln.k === sel, ink = style ? colour(focus ? focusSt.fg : ln.done ? style.row.disabled.fg : normSt.fg) : fg, back = style && focus ? style.bg[focusSt.bg] : bg;
        if (focus && style) for (let x = style.row.bandFrom; x <= style.row.bandTo; x++) ui.setCell(bounds.x + x, y, ' ', ink, back);
        drawText(ui, bounds.x + 4, y, ln.text, ink, back);
        if (focus) ui.setCell(bounds.x + 2, y, style ? focusSt.marker : '>', style ? colour(focusSt.markerFg) : fg, back);
        continue;
      }
      const ink = ln.kind === 'return' ? head : ln.status === 'complete' ? dim : fg;
      drawText(ui, bounds.x + 4, y, ln.text, ink, bg);
    }
    return bounds;
  }
  return { open: show, close, handleKey, draw, isOpen: () => open, snapshot: () => ({ open, sel, top, lines: lines.map(l => l.text) }) };
}
