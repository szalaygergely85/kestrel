// S8-C-12: cached objective HUD/log view over the shipped quest sim.
import { drawText } from '../../../engine/index.js';
import { isMainDef } from '../quest/sim/questBook.js';
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

// QG-05 / OB-097 (D-058): quest journal SCREEN over the quest book, in the pause/title menu skin (uiStyle.menu).
// TWO panes: LEFT = quest names (main first, then active; offered quests are NOT listed - OB-100; done dimmed), RIGHT = details of the selected quest
// (title, story summary from the active objective's `journal`, objectives with counts). Strings are rebuilt only on open,
// key input and a changed book.version; draw() never formats or allocates.
export const QUEST_LOG_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Tab', 'KeyE', 'Backspace', 'Enter', 'KeyJ', 'Escape', 'KeyX', 'KeyT'];
export const QUEST_LOG_TEXT = Object.freeze({ header: 'PENCIL NOTES', empty: 'Nothing yet. Not nothing.', paneL: 'QUESTS', abandon: '[X] Abandon quest', track: '[T] Track this quest', tracked: '[T] Tracked (compass + objective)', talkTo: 'Talk to ', abandonSure: '[X] again to abandon (progress resets)', finished: 'All done. Nothing left to do here.', footer: 'W/S select  T track  X abandon  J close', footerDone: 'W/S select  Enter re-read  J close', giver: 'Given by: ', reward: 'Reward: ', objectives: 'Objectives' });
const AVAILABLE = 1, READY = 3, DONE = 4, LIST_TOP = 6, LIST_ROWS = 14, LEFT_X = 4, LEFT_W = 22, DIV_X = 27, RIGHT_X = 29, RIGHT_W = 40;

/** Word wrap into at most `max` lines of `w` chars (last line ellipsised). Rebuild-time only. */
function wrap(text, w, max) {
  const out = []; let cur = '';
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > w) { out.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) out.push(cur);
  if (out.length > max) { out.length = max; out[max - 1] += '...'; }
  return out.map(l => clipped(l, w));
}

/**
 * @param {any} book createQuestBook() result
 * @param {{style?:any, text?:Partial<typeof QUEST_LOG_TEXT>, width?:number, doneTitle?:string, onJournal?:(questIndex:number)=>void}} o
 * CH1-09: a DONE main quest (index 0) is listed as `doneTitle` ("Beyond the Wall"); Enter on it closes the log and calls
 * `onJournal(0)` (main.js re-opens the chapter journal). Without `onJournal`, Enter does nothing.
 */
/** OB-137: humanise a raw id ('gear.feet.boots.sturdy' -> 'Gear feet boots sturdy', 'signArm' -> 'Sign arm'); warns once per id. */
const warnedNames = new Set();
export function humaniseId(id) {
  const h = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim().toLowerCase();
  if (!warnedNames.has(id)) { warnedNames.add(id); console.warn('[journal] no display name for', id); }
  return h.charAt(0).toUpperCase() + h.slice(1);
}
export function createQuestLogScreen(book, { style = null, text = {}, width = 72, doneTitle = 'Beyond the Wall', onJournal = null, giverName = humaniseId, itemName = humaniseId } = {}) {
  const T = { ...QUEST_LOG_TEXT, ...text };
  const colour = key => (style && (style.hex[key] || style.bg[key])) || '#e8e2d0';
  const fg = style ? colour(style.row.normal.fg) : '#e8e2d0', bg = style ? style.bg.plate : '#0a0b10';
  const heading = T.header;
  const titleText = style ? style.title.decor[0] + heading.split('').join(' '.repeat(style.title.letterSpace)) + style.title.decor[1] : heading;
  const bounds = { x: 0, y: 0, w: width, h: 24 };
  const scratch = [];
  let open = false, built = -1, sel = 0, top = 0, quests = [], names = [], doneFrom = 0, right = [], sure = false;

  /** MAIN = the chapter quest (index 0), `mq.*` ids, or def.kind === 'main'. */
  const isMain = i => typeof book.isMain === 'function' ? book.isMain(i) : (i === 0 || isMainDef(book.def(i))); // OB-155: shared rule
  // OB-099: counts only on item / kill steps (row.counted); go / talk / explore steps show none
  const cnt = (row) => (row.counted ? '  ' + row.progress + '/' + row.target : '');
  /** OB-099: the m1 chain is NOT a quest of its own. While a step belongs to a `silent` section (covered by a giver quest) it is
   * not listed; otherwise it is ONE small entry named after the current step's section (its short title). Returns the section or null. */
  function mainSection(def, rows) {
    if (!def.sections) return { title: def.title || def.id, id: undefined };
    const k = rows.findIndex(r => r.status === 'active'); if (k < 0) return { title: def.title || def.id, id: undefined };
    const sec = def.sections.find(x => x.id === def.objectives[k].section);
    return sec && sec.silent ? null : { title: (sec && sec.title) || def.title, id: sec && sec.id };
  }
  const mainRows = [];
  function rebuild() {
    built = book.version; quests = []; names = [];
    const n = book.count, act = [], mainAct = [], off = [], done = [];
    for (let i = 0; i < n; i++) {
      const s = book.status(i);
      if (i === 0 && s !== DONE && !mainSection(book.def(0), book.objectives(0, mainRows))) continue; // OB-099: covered by a giver quest
      if (s === 2 || s === READY) (isMain(i) ? mainAct : act).push(i);
    }
    mainAct.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a)); act.sort((a, b) => b - a);
    // OB-100 (owner): a quest shows only once it is picked up (accepted) - offered / unlocked quests are not listed
    if (book.status(0) === DONE) done.push(0); // OB-099: handed-in giver quests disappear; only the finished chapter row (CH1-09 re-read) stays
    for (const i of mainAct) quests.push(i);
    for (const i of act) quests.push(i);
    for (const i of off) quests.push(i);
    doneFrom = quests.length;
    for (const i of done) quests.push(i);
    for (let k = 0; k < quests.length; k++) { const i = quests[k], d = book.def(i); names.push(clipped(ascii((k >= doneFrom && i === 0 && doneTitle) || d.title || d.id), LEFT_W)); }
    for (let k = 0; k < quests.length; k++) if (quests[k] === 0 && k < doneFrom) { const m = mainSection(book.def(0), book.objectives(0, mainRows)); if (m) names[k] = clipped(ascii(m.title), LEFT_W); }
    if (sel >= quests.length) sel = Math.max(0, quests.length - 1);
    if (sel < top) top = sel;
    if (sel >= top + LIST_ROWS) top = sel - LIST_ROWS + 1;
    if (quests.length <= LIST_ROWS || top < 0) top = 0;
    right = [];
    if (quests[sel] === undefined) return;
    const i = quests[sel], def = book.def(i), s = book.status(i), isDone = s === DONE;
    const msec = i === 0 && !isDone ? mainSection(def, book.objectives(0, mainRows)) : null;
    right.push({ kind: 'head', text: clipped(ascii((isDone && i === 0 && doneTitle) || (msec && msec.title) || def.title || def.id), RIGHT_W) });
    if (def.giver && def.giver.npc) right.push({ kind: 'dim', text: clipped(T.giver + ascii(String(giverName(def.giver.npc))), RIGHT_W) });
    const rows = book.objectives(i, scratch);
    // story summary: the active step's `journal` (fallback: its objective text); READY -> returnText; AVAILABLE -> talk to the giver
    let summary = '';
    if (s === AVAILABLE) summary = T.talkTo + String(giverName(book.giverOf ? book.giverOf(i) : ''));
    else if (s === READY) summary = def.returnText || T.finished;
    else if (isDone) summary = T.finished;
    else for (let r = 0; r < rows.length; r++) if (rows[r].status === 'active') { summary = rows[r].journal || rows[r].text; break; }
    for (const l of wrap(ascii(summary), RIGHT_W, 3)) right.push({ kind: 'text', text: l });
    right.push({ kind: 'blank', text: '' });
    if (s !== AVAILABLE) {
      right.push({ kind: 'head', text: T.objectives });
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.status === 'locked') continue; // OB-099: never show future objectives
        if (msec && msec.id !== undefined && def.objectives[r].section !== msec.id) continue; // m1 entry: only the current step's section
        const mark = row.status === 'complete' ? '[x] ' : row.status === 'active' ? '[>] ' : '[ ] ', c = cnt(row);
        right.push({ kind: 'step', status: row.status, text: clipped(mark + ascii(row.text), RIGHT_W - c.length) + c });
      }
    }
    if (def.reward && def.reward.items && def.reward.items.length) right.push({ kind: 'dim', text: clipped(T.reward + def.reward.items.map(it => ascii(itemName(it.id)) + (it.n > 1 ? ' x' + it.n : '')).join(', '), RIGHT_W) });
    if (i > 0 && !isDone && s !== AVAILABLE && book.track) right.push({ kind: 'head', text: book.tracked() === i ? T.tracked : T.track });
    if (book.canAbandon && book.canAbandon(def.id)) right.push({ kind: 'head', text: sure ? T.abandonSure : T.abandon });
  }
  function show() { open = true; sure = false; sel = 0; top = 0; rebuild(); }
  function close() { open = false; }
  /** Mouse: grid cell coords; selects the clicked quest name. True when consumed. */
  function handleClick(cx, cy) {
    if (!open) return false;
    const r = cy - bounds.y - LIST_TOP, c = cx - bounds.x, k = top + r;
    if (r >= 0 && r < LIST_ROWS && c >= LEFT_X - 2 && c < DIV_X && k < quests.length) { sure = false; sel = k; rebuild(); return true; }
    return false;
  }
  /** Returns true when the key was consumed. Enter on the done main quest hands off to the journal; J/Esc close; W/S move (wraps). */
  function handleKey(code) {
    if (!open) return false;
    if (code === 'Enter' && onJournal && quests[sel] === 0 && book.status(0) === DONE) { close(); onJournal(0); return true; }
    if (code === 'Escape' || code === 'Backspace' || code === 'KeyJ') { sure = false; close(); return true; }
    if (code === 'Enter' || code === 'KeyE' || code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD' || code === 'Tab') { sure = false; return true; }
    if (code === 'KeyX') { // QUESTS-01: two presses abandon the selected quest (only `abandonable` ones)
      const id = quests[sel] !== undefined ? book.def(quests[sel]).id : null;
      if (!id || !book.canAbandon || !book.canAbandon(id)) return true;
      if (!sure) { sure = true; rebuild(); return true; }
      sure = false; book.abandon(id); rebuild(); return true;
    }
    if (code === 'KeyT') { // QL-03: pin the selected active side quest as THE tracked one; again = back to newest
      const i = quests[sel];
      if (i > 0 && (book.status(i) === 2 || book.status(i) === READY) && book.track) { sure = false; book.track(book.tracked() === i ? null : book.def(i).id); rebuild(); }
      return true;
    }
    const d = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    sure = false;
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
    const dim = style ? colour(style.row.disabled.fg) : fg, head = style ? colour(style.sectionLabel.newGame.fg) : fg;
    const doneSel = quests[sel] === 0 && book.status(0) === DONE && !!onJournal;
    drawText(ui, bounds.x + 4, bounds.y + bounds.h - 3, doneSel ? T.footerDone : T.footer, dim, bg);
    if (!quests.length) { drawText(ui, bounds.x + 4, bounds.y + LIST_TOP + 1, T.empty, fg, bg); return bounds; }
    const div = style ? colour('brassShadow') : fg;
    for (let y = bounds.y + LIST_TOP - 1; y < bounds.y + LIST_TOP + LIST_ROWS; y++) ui.setCell(bounds.x + DIV_X, y, '|', div, bg);
    drawText(ui, bounds.x + LEFT_X, bounds.y + LIST_TOP - 1, T.paneL, head, bg);
    const focusSt = style?.row.focus, normSt = style?.row.normal;
    for (let r = 0; r < LIST_ROWS; r++) { // LEFT pane
      const k = top + r; if (k >= quests.length) break;
      const y = bounds.y + LIST_TOP + r, focus = k === sel, isDone = k >= doneFrom;
      const ink = style ? colour(focus ? focusSt.fg : isDone ? style.row.disabled.fg : normSt.fg) : fg, back = style && focus ? style.bg[focusSt.bg] : bg;
      if (focus && style) for (let x = style.row.bandFrom; x < DIV_X; x++) ui.setCell(bounds.x + x, y, ' ', ink, back);
      drawText(ui, bounds.x + LEFT_X, y, names[k], ink, back);
      if (focus) ui.setCell(bounds.x + 2, y, style ? focusSt.marker : '>', style ? colour(focusSt.markerFg) : fg, back);
    }
    for (let r = 0; r < LIST_ROWS + 1; r++) { // RIGHT pane
      const ln = right[r]; if (!ln) break;
      const y = bounds.y + LIST_TOP - 1 + r;
      if (ln.status === 'active' && style) { drawText(ui, bounds.x + RIGHT_X, y, ln.text, colour(focusSt.fg), style.bg[focusSt.bg]); continue; }
      drawText(ui, bounds.x + RIGHT_X, y, ln.text, ln.kind === 'head' ? head : ln.kind === 'dim' || ln.status === 'complete' || ln.status === 'locked' ? dim : fg, bg);
    }
    return bounds;
  }
  return { open: show, close, handleKey, handleClick, draw, isOpen: () => open, snapshot: () => ({ open, sel, top, left: names.slice(), doneFrom, right: right.map(l => l.text), lines: names.concat(right.map(l => l.text)) }) };
}
