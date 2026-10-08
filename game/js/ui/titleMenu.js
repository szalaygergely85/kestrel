// US-090a: standalone menu view/controller; the host consumes actions for boot/settings.
import { drawText } from '../../../engine/index.js';

const PLATE = '#0a0b10'; // PC-A-authorised placeholder plate [10,11,16].
const TEXT = '#e8e2d0'; // Existing title/file-notice foreground; final design is pending.
const ascii = value => String(value).replace(/[^\x20-\x7e]/g, '?');

function slotLabel(slot) {
  if (!slot.ok) return `Slot ${slot.slot + 1}: Unavailable`;
  if (!slot.meta) return `Slot ${slot.slot + 1}: Empty`;
  const minutes = Math.floor(slot.meta.playTimeSec / 60);
  const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return `Slot ${slot.slot + 1}: ${ascii(slot.meta.playerName)} - ${ascii(slot.meta.place)} - ${time}`;
}

/**
 * adapter = US-089a createStorageAdapter/createMemoryAdapter; no browser globals here.
 * handlePointer receives UI-grid cells (the host maps its own canvas coordinates).
 * takeAction returns {type:'newGame'|'continue'|'settings', slot?, save?} once.
 * Storage reads, formatting and allocations happen on input/refresh, never in draw.
 */
export function createTitleMenu(adapter, { title = 'Kestrel', fg = TEXT, bg = PLATE } = {}) {
  if (!adapter || ['listSlots','readSlot','deleteSlot'].some(key => typeof adapter[key] !== 'function')) throw new Error('titleMenu: save adapter required');
  const heading = ascii(title).slice(0, 66);
  const bounds = {x:0,y:0,w:72,h:28};
  let slots = [], rows = [], selected = 0, selectedSlot = 0, mode = 'main';
  let confirm = null, action = null, message = '', error = null;
  let confirmText = '';

  function buildRows() {
    if (mode === 'confirm') {
      rows = [{id:'cancel',text:'Cancel',y:12,enabled:true},{id:'yes',text:'Yes',y:15,enabled:true}];
    } else if (mode === 'new') {
      rows = slots.map(slot => ({id:'slot',slot:slot.slot,text:slot.label,y:8+slot.slot*3,enabled:true}));
      rows.push({id:'back',text:'Back',y:20,enabled:true});
    } else {
      rows = [{id:'new',text:'New game',y:6,enabled:true},
        {id:'continue',text:'Continue',y:8,enabled:slots.some(slot => slot.ok && slot.meta)},
        ...slots.map(slot => ({id:'slot',slot:slot.slot,text:slot.label,y:12+slot.slot*2,enabled:true})),
        {id:'delete',text:'Delete selected slot',y:19,enabled:!!slots[selectedSlot]?.meta || slots[selectedSlot]?.ok === false},
        {id:'settings',text:'Settings',y:21,enabled:true}];
    }
    // Cache full clipped labels, including disabled hints, away from the frame loop.
    for (const row of rows) row.display = (row.text + (row.enabled ? '' : ' (unavailable)')).slice(0,bounds.w-6);
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
    mode = 'confirm'; confirm = {type,slot}; selected = 0;
    confirmText = `${type === 'delete' ? 'Delete' : 'Replace'} slot ${slot+1}?`;
    message = ''; buildRows(); // Cancel is always selected first.
  }
  function load(slot) {
    try {
      const result = adapter.readSlot(slot);
      if (!result.ok || !result.save) { message = result.ok ? 'This slot is empty.' : 'Could not load this slot.'; error = result.error || null; refresh(); return; }
      emit('continue',slot,result.save);
    } catch (e) { error = String(e); message = 'Could not load this slot.'; refresh(); }
  }
  function acceptConfirmation() {
    if (confirm.type === 'replace') { emit('newGame',confirm.slot); return; }
    try {
      const result = adapter.deleteSlot(confirm.slot);
      if (!result.ok) { message = 'Could not delete this slot. Try again.'; error = result.error || null; return; }
      message = 'Slot deleted.'; root(); refresh();
    } catch (e) { error = String(e); message = 'Could not delete this slot. Try again.'; }
  }
  function activate() {
    if (action || !rows[selected].enabled) return false;
    const row = rows[selected]; message = ''; error = null;
    if (mode === 'confirm') { if (row.id === 'yes') acceptConfirmation(); else root(); }
    else if (row.id === 'back') root();
    else if (row.id === 'new') { mode = 'new'; selected = slots.findIndex(slot => slot.ok && !slot.meta); if (selected < 0) selected = 0; buildRows(); }
    else if (row.id === 'continue') {
      const slot = slots[selectedSlot].ok && slots[selectedSlot].meta ? selectedSlot : slots.find(slot => slot.ok && slot.meta).slot;
      load(slot);
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
    if (code === 'Escape') { if (mode !== 'main') { message = ''; root(); return true; } return false; }
    if (code === 'Enter' || code === 'Space') return activate();
    if (code === 'Delete' && mode === 'main' && (!!slots[selectedSlot].meta || !slots[selectedSlot].ok)) { ask('delete',selectedSlot); return true; }
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
    for (let x = 1; x < bounds.w-1; x++) { ui.setCell(bounds.x+x,bounds.y,'-',fg,bg); ui.setCell(bounds.x+x,bounds.y+bounds.h-1,'-',fg,bg); }
    for (let y = 0; y < bounds.h; y++) { ui.setCell(bounds.x,bounds.y+y,y===0 || y===bounds.h-1 ? '+' : '|',fg,bg); ui.setCell(bounds.x+bounds.w-1,bounds.y+y,y===0 || y===bounds.h-1 ? '+' : '|',fg,bg); }
    drawText(ui,bounds.x+3,bounds.y+2,heading,fg,bg);
    if (mode === 'new') drawText(ui,bounds.x+3,bounds.y+5,'Choose a slot for the new game',fg,bg);
    if (mode === 'confirm') drawText(ui,bounds.x+3,bounds.y+7,confirmText,fg,bg);
    for (let i = 0; i < rows.length; i++) {
      drawText(ui,bounds.x+4,bounds.y+rows[i].y,rows[i].display,fg,bg);
      if (i === selected) ui.setCell(bounds.x+2,bounds.y+rows[i].y,'>',fg,bg);
    }
    if (message) drawText(ui,bounds.x+3,bounds.y+24,message,fg,bg);
    drawText(ui,bounds.x+3,bounds.y+26,'Arrows: select   Enter: choose   Del: delete   Esc: back',fg,bg);
    return bounds;
  }
  refresh();
  return { refresh, draw, handleKey, handlePointer,
    takeAction() { const result = action; action = null; return result; },
    snapshot() { return {mode,selected,selectedSlot,message,error,rows:rows.map(row => ({...row})),confirm:confirm ? {...confirm} : null}; } };
}
