// US-090a: standalone menu view/controller; the host consumes actions for boot/settings.
import { drawText } from '../../../engine/index.js';

const PLATE = '#0a0b10'; // PC-A-authorised placeholder plate [10,11,16].
const TEXT = '#e8e2d0'; // Existing title/file-notice foreground; final design is pending.
const ascii = value => String(value).replace(/[^\x20-\x7e]/g, '?');

/** SAVE-TIME-01: "2026-10-09 21:14" (local time) or '' for old saves without meta.savedAt. */
export function formatSavedAt(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** SAVE-TIME-01: the slot Continue resumes = newest meta.savedAt among readable saves (missing = 0), first valid slot on ties. */
export function newestSlot(slots) {
  let best = null;
  for (const s of slots) {
    if (!s.ok || !s.meta) continue;
    if (!best || (s.meta.savedAt || 0) > (best.meta.savedAt || 0)) best = s;
  }
  return best ? best.slot : -1;
}

export function slotLabel(slot) {
  if (!slot.ok) return `Slot ${slot.slot + 1}: Unreadable`;
  if (!slot.meta) return `Slot ${slot.slot + 1}: Empty`;
  const minutes = Math.floor(slot.meta.playTimeSec / 60);
  const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return `Slot ${slot.slot + 1}: ${ascii(slot.meta.playerName)} - ${ascii(slot.meta.place)} - ${time}${slot.meta.savedAt ? ' - ' + formatSavedAt(slot.meta.savedAt) : ''}`;
}

/**
 * adapter = US-089a createStorageAdapter/createMemoryAdapter; no browser globals here.
 * handlePointer receives UI-grid cells (the host maps its own canvas coordinates).
 * takeAction returns {type:'newGame'|'continue'|'settings', slot?, save?} once.
 * Storage reads, formatting and allocations happen on input/refresh, never in draw.
 */
export function createTitleMenu(adapter, { title = 'KESTREL', fg = TEXT, bg = PLATE, style = null } = {}) {
  if (!adapter || ['listSlots','readSlot','deleteSlot'].some(key => typeof adapter[key] !== 'function')) throw new Error('titleMenu: save adapter required');
  const colour = key => style?.hex[key] || style?.bg[key] || fg;
  if (style) { fg = colour(style.row.normal.fg); bg = style.bg.plate; }
  const heading = ascii(title).slice(0, 66);
  const titleText = style ? style.title.decor[0] + heading.split('').join(' '.repeat(style.title.letterSpace)) + style.title.decor[1] : heading;
  const titleDecor = [];
  if (style) for(let i=0;i<titleText.length;i++) {
    const ch=titleText[i];
    if ('-=[]'.includes(ch)) titleDecor.push({x:i,ch,fg:colour(ch==='-' ? style.title.decorFg[0] : ch==='=' ? style.frame.fg : style.title.bracketFg)});
  }
  const hintsMain = 'Arrows select  Enter choose', hintsLoad = 'Arrows select  Enter choose  Del delete'; // Del only inside Load
  const partsOf = h => ['Arrows','Enter','Del'].filter(t => h.includes(t)).map(text => ({text,x:h.indexOf(text)}));
  const hintPartsMain = partsOf(hintsMain), hintPartsLoad = partsOf(hintsLoad);
  const bounds = {x:0,y:0,w:72,h:28};
  let slots = [], rows = [], selected = 0, selectedSlot = 0, mode = 'main';
  let confirmFrom = 'main', confirm = null, action = null, message = '', error = null;
  let confirmText = '';

  function buildRows() {
    if (mode === 'confirm') {
      rows = [{id:'cancel',text:'Cancel',y:12,enabled:true},{id:'yes',text:'Yes',y:15,enabled:true}];
    } else if (mode === 'new') {
      rows = slots.map(slot => ({id:'slot',slot:slot.slot,text:slot.label,y:8+slot.slot*3,enabled:true}));
      rows.push({id:'back',text:'Back',y:20,enabled:true});
    } else if (mode === 'load') { // TITLE-LOAD-SUBMENU-01: slots + Delete live inside the Load sub-card
      rows = [...slots.map(slot => ({id:'slot',slot:slot.slot,text:slot.label,y:8+slot.slot*2,enabled:true})),
        {id:'delete',text:'Delete slot',y:15,enabled:!!slots[selectedSlot]?.meta || slots[selectedSlot]?.ok === false},
        {id:'back',text:'Back',y:17,enabled:true}];
    } else {
      const anySave = slots.some(slot => slot.ok && slot.meta);
      rows = [{id:'new',text:'New game',y:6,enabled:true},
        {id:'continue',text:'Continue',y:8,enabled:anySave},
        {id:'load',text:'Load',y:10,enabled:anySave},
        {id:'settings',text:'Settings',y:12,enabled:true}];
    }
    // Cache full clipped labels, including disabled hints, away from the frame loop.
    for (const row of rows) row.display = (row.id === 'continue' && !row.enabled ? 'Continue (no save)' : row.id === 'load' && !row.enabled ? 'Load (no save)' : row.text + (row.enabled ? '' : ' (unavailable)')).slice(0,bounds.w-6);
    selected = Math.min(selected, rows.length-1);
  }

  function refresh() {
    let listed;
    try { listed = adapter.listSlots(); }
    catch (e) { error = String(e); listed = []; }
    slots = [0,1,2].map(slot => {
      const found = listed.find(row => row.slot === slot);
      const value = found ? {...found} : {slot,ok:false,meta:null};
      value.label = slotLabel(value); return value;
    });
    buildRows();
  }
  function root() { mode = 'main'; confirm = null; selected = 0; buildRows(); }
  function back() { if (mode === 'confirm' && confirmFrom === 'load') { mode = 'load'; confirm = null; selected = 0; buildRows(); } else root(); }
  function focus(index) {
    selected = index;
    if (rows[index].id === 'slot') { selectedSlot = rows[index].slot; buildRows(); }
  }
  function emit(type, slot, save) {
    action = {type};
    if (slot !== undefined) action.slot = slot;
    if (save !== undefined) action.save = save;
    root();
  }
  function ask(type, slot) {
    confirmFrom = mode === 'load' ? 'load' : 'main'; mode = 'confirm'; confirm = {type,slot}; selected = 0;
    confirmText = `${type === 'delete' ? 'Delete' : 'Overwrite'} slot ${slot+1}?`;
    message = ''; buildRows(); // Cancel is always selected first.
  }
  function load(slot) {
    try {
      const result = adapter.readSlot(slot);
      if (!result.ok || !result.save) { message = result.ok ? 'This slot is empty.' : 'Could not read slot.'; error = result.error || null; refresh(); return; }
      emit('continue',slot,result.save);
    } catch (e) { error = String(e); message = 'Could not read slot.'; refresh(); }
  }
  function acceptConfirmation() {
    if (confirm.type === 'replace') { emit('newGame',confirm.slot); return; }
    try {
      const result = adapter.deleteSlot(confirm.slot);
      if (!result.ok) { message = 'Could not delete.'; error = result.error || null; return; }
      message = 'Slot deleted.'; back(); refresh(); if (confirmFrom === 'load' && !slots.some(x => x.ok && x.meta)) root();
    } catch (e) { error = String(e); message = 'Could not delete.'; }
  }
  function activate() {
    if (action || !rows[selected].enabled) return false;
    const row = rows[selected]; message = ''; error = null;
    if (mode === 'confirm') { if (row.id === 'yes') acceptConfirmation(); else back(); }
    else if (row.id === 'back') root();
    else if (row.id === 'load') { mode = 'load'; selected = Math.max(0, selectedSlot); buildRows(); }
    else if (row.id === 'new') { mode = 'new'; selected = slots.findIndex(slot => slot.ok && !slot.meta); if (selected < 0) selected = 0; buildRows(); }
    else if (row.id === 'continue') {
      load(newestSlot(slots));
    } else if (row.id === 'settings') emit('settings');
    else if (row.id === 'delete') ask('delete',selectedSlot);
    else if (row.id === 'slot') {
      selectedSlot = row.slot;
      if (mode !== 'new') load(row.slot);
      else if (slots[row.slot].ok && !slots[row.slot].meta) emit('newGame',row.slot);
      else ask('replace',row.slot);
    }
    return true;
  }
  function handleKey(code) {
    if (action) return false;
    if (code === 'Escape') { if (mode !== 'main') { message = ''; back(); return true; } return false; }
    if (code === 'Enter' || code === 'Space') return activate();
    if (code === 'Delete' && mode === 'load' && (!!slots[selectedSlot].meta || !slots[selectedSlot].ok)) { ask('delete',selectedSlot); return true; }
    const delta = ['ArrowUp','KeyW','ArrowLeft'].includes(code) ? -1 : ['ArrowDown','KeyS','ArrowRight'].includes(code) ? 1 : 0;
    if (!delta) return false;
    for (let step = 1; step <= rows.length; step++) {
      const next = (selected + delta*step + rows.length) % rows.length;
      if (rows[next].enabled) { focus(next); break; }
    }
    return true;
  }
  function handlePointer(x, y, activateRow = true) {
    if (action || !Number.isFinite(x) || !Number.isFinite(y) || x < bounds.x+1 || x >= bounds.x+bounds.w-1) return false;
    const row = rows.findIndex(item => Math.floor(y) === bounds.y+item.y && item.enabled);
    if (row < 0) return false;
    focus(row); return activateRow ? activate() : true;
  }
  function draw(ui) {
    bounds.x = Math.floor((ui.cols-bounds.w)/2); bounds.y = Math.floor((ui.rows-bounds.h)/2);
    for (let y = bounds.y; y < bounds.y+bounds.h; y++) for (let x = bounds.x; x < bounds.x+bounds.w; x++) ui.setCell(x,y,' ',fg,bg);
    const frame = style?.frame;
    for (let x = 1; x < bounds.w-1; x++) { ui.setCell(bounds.x+x,bounds.y,frame?.h || '-',frame ? colour(frame.fg) : fg,bg); ui.setCell(bounds.x+x,bounds.y+bounds.h-1,frame?.h || '-',frame ? colour(frame.fg) : fg,bg); }
    for (let y = 0; y < bounds.h; y++) {
      const corner = y===0 || y===bounds.h-1;
      const glyph = corner ? frame?.corner || '+' : frame?.v || '|';
      const ink = frame ? colour(corner ? frame.cornerFg : frame.fg) : fg;
      ui.setCell(bounds.x,bounds.y+y,glyph,ink,bg); ui.setCell(bounds.x+bounds.w-1,bounds.y+y,glyph,ink,bg);
    }
    if (style) {
      for (const x of frame.rivets.cols) {
        ui.setCell(bounds.x+x,bounds.y,frame.rivets.glyph,colour(frame.rivets.fg),bg);
        ui.setCell(bounds.x+x,bounds.y+bounds.h-1,frame.rivets.glyph,colour(frame.rivets.fg),bg);
      }
      for (const line of style.separators) {
        if (line.row===18 && mode!=='main') continue;
        for (let x=line.from;x<=line.to;x++) ui.setCell(bounds.x+x,bounds.y+line.row,line.glyph,colour(line.fg),bg);
      }
      drawText(ui,bounds.x+Math.floor((bounds.w-style.subtitle.text.length)/2),bounds.y+style.subtitle.row,style.subtitle.text,colour(style.subtitle.fg),bg);
      drawText(ui,bounds.x+Math.floor((bounds.w-style.signal.text.length)/2),bounds.y+style.signal.row,style.signal.text,colour(style.signal.fg),bg);
      if (mode==='load') { const s=style.sectionLabel.saves; drawText(ui,bounds.x+s.col,bounds.y+s.row,s.text,colour(s.fg),bg); }
    }
    drawText(ui,bounds.x+(style ? Math.floor((bounds.w-titleText.length)/2) : 3),bounds.y+2,titleText,style ? colour(style.title.fg) : fg,bg);
    if(style) for(const part of titleDecor) ui.setCell(bounds.x+Math.floor((bounds.w-titleText.length)/2)+part.x,bounds.y+2,part.ch,part.fg,bg);
    if (mode === 'new') drawText(ui,bounds.x+4,bounds.y+5,'Choose a slot',style ? colour(style.sectionLabel.newGame.fg) : fg,bg);
    if (mode === 'confirm') drawText(ui,bounds.x+4,bounds.y+7,confirmText,style ? colour(style.confirm.fg[confirm.type]) : fg,bg);
    for (let i = 0; i < rows.length; i++) {
      const row=rows[i], focus=i===selected;
      const state=style && (focus ? style.row.focus : row.enabled ? style.row.normal : style.row.disabled);
      const destructive=style && (row.id==='delete' || row.id==='yes' && confirm?.type==='delete');
      const ink=style ? colour(destructive && row.enabled ? (focus ? style.row.destructive.focusFg : style.row.destructive.fg) : state.fg) : fg;
      const back=style ? style.bg[state.bg] : bg;
      if (focus && style) for(let x=style.row.bandFrom;x<=style.row.bandTo;x++) ui.setCell(bounds.x+x,bounds.y+row.y,' ',ink,back);
      drawText(ui,bounds.x+4,bounds.y+row.y,row.display,ink,back);
      if(style && row.id==='slot' && row.slot===selectedSlot && !focus) ui.setCell(bounds.x+style.slot.selectedMark.col,bounds.y+row.y,style.slot.selectedMark.glyph,colour(style.slot.selectedMark.fg),back);
      if (focus) {
        ui.setCell(bounds.x+2,bounds.y+row.y,style ? state.marker : '>',style ? colour(state.markerFg) : fg,back);
        if(style) ui.setCell(bounds.x+state.markerRightCol,bounds.y+row.y,state.markerRight,colour(state.markerFg),back);
      }
    }
    if (message) {
      drawText(ui,bounds.x+4,bounds.y+24,message,style ? colour(error ? style.message.error : style.message.info) : fg,bg);
      if(style) ui.setCell(bounds.x+2,bounds.y+24,'>',colour(style.message.prefixFg),bg);
    }
    const hints = mode === 'load' ? hintsLoad : hintsMain, hintParts = mode === 'load' ? hintPartsLoad : hintPartsMain;
    const hintX=bounds.x+Math.floor((bounds.w-hints.length)/2);
    drawText(ui,hintX,bounds.y+26,hints,style ? colour(style.keyHints.fg) : fg,bg);
    if(style) for(const part of hintParts) drawText(ui,hintX+part.x,bounds.y+26,part.text,colour(style.keyHints.keyFg),bg);
    return bounds;
  }
  refresh();
  return { refresh, draw, handleKey, handlePointer,
    takeAction() { const result = action; action = null; return result; },
    snapshot() { return {mode,selected,selectedSlot,message,error,rows:rows.map(row => ({...row})),confirm:confirm ? {...confirm} : null}; } };
}
