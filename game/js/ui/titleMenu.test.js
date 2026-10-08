import assert from 'node:assert/strict';
import { createUiLayer } from '../../../engine/index.js';
import { createMemoryAdapter, createStorageAdapter, stringifyGameSave } from '../quest/save/saveState.js';
import { createTitleMenu } from './titleMenu.js';
import '../../../design/models/title.js';
import '../../../design/models/menu_ui.js';

const save = {saveVersion:1,world:{version:2,entities:[],structures:[]},
  game:{quest:null,openedChests:[],deadBeasts:[]},meta:{playerName:'Wick',place:'Tower',playTimeSec:3661}};
const adapter = createMemoryAdapter(); adapter.writeSlot(0,save); adapter.writeSlot(2,save);
const menu = createTitleMenu(adapter), ui = createUiLayer({cols:160});
const bounds = menu.draw(ui);
assert.ok(menu.snapshot().rows[2].text.includes('Wick - Tower - 1:01'));
const pixel = (bounds.y+4)*ui.cols+bounds.x+4;
assert.deepEqual([...ui.cells.bg.slice(pixel*4,pixel*4+4)],[10,11,16,255]);
assert.equal(menu.draw(ui),bounds,'draw reuses its bounds object');
assert.equal(menu.handlePointer(-1,-1),false); assert.equal(menu.handleKey('KeyZ'),false);

// New games target an empty slot and leave existing saves intact until host boot/save.
menu.handleKey('Enter'); assert.equal(menu.snapshot().mode,'new');
menu.handleKey('Enter'); assert.deepEqual(menu.takeAction(),{type:'newGame',slot:1});
assert.equal(menu.takeAction(),null,'action consumed once'); assert.ok(adapter.readSlot(0).save);
// Mouse selecting an occupied new-game slot requires an explicit replacement choice.
menu.handleKey('Enter'); menu.draw(ui); menu.handlePointer(bounds.x+5,bounds.y+8);
assert.equal(menu.snapshot().mode,'confirm'); menu.handleKey('Enter'); // default Cancel
assert.equal(menu.takeAction(),null); assert.ok(adapter.readSlot(0).save);
menu.handleKey('Enter'); menu.handlePointer(bounds.x+5,bounds.y+8);
menu.handleKey('ArrowDown'); menu.handleKey('Enter');
assert.deepEqual(menu.takeAction(),{type:'newGame',slot:0}); assert.ok(adapter.readSlot(0).save,'replacement action does not prematurely delete');

// Delete asks to confirm, defaults to Cancel, and never touches the other slots.
menu.handleKey('Delete'); assert.equal(menu.snapshot().selected,0);
menu.handleKey('Escape'); assert.ok(adapter.readSlot(0).save);
menu.handleKey('Delete'); menu.handleKey('ArrowDown'); menu.handleKey('Enter');
assert.equal(adapter.readSlot(0).save,null); assert.ok(adapter.readSlot(2).save);
menu.handleKey('ArrowDown'); menu.handleKey('Enter');
const continued = menu.takeAction(); assert.equal(continued.type,'continue'); assert.equal(continued.slot,2);
assert.deepEqual(continued.save,adapter.readSlot(2).save);
menu.draw(ui); menu.handlePointer(bounds.x+5,bounds.y+21); assert.deepEqual(menu.takeAction(),{type:'settings'});
menu.handlePointer(bounds.x+5,bounds.y+16); assert.equal(menu.takeAction().slot,2,'mouse slot load');

// Persisted slots are re-read, including a corrupt slot and denied deletion.
const data = new Map([['kestrel.save.slot.0',stringifyGameSave(save)],['kestrel.save.slot.1','{bad']]);
const storage = {getItem:key=>data.get(key) ?? null,setItem:(key,value)=>data.set(key,value),removeItem:()=>{throw Error('denied');}};
const failed = createTitleMenu(createStorageAdapter(storage));
failed.handleKey('Delete'); failed.handleKey('ArrowDown'); failed.handleKey('Enter');
assert.equal(failed.snapshot().mode,'confirm'); assert.match(failed.snapshot().message,/Could not delete/);
assert.ok(data.has('kestrel.save.slot.0'));
failed.handleKey('Escape'); failed.draw(ui); failed.handlePointer(bounds.x+5,bounds.y+14);
assert.equal(failed.takeAction(),null); assert.match(failed.snapshot().message,/Could not read/);
const unavailable = createTitleMenu({listSlots:()=>{throw Error('privacy');},readSlot:()=>({ok:false}),deleteSlot:()=>({ok:false})});
assert.equal(unavailable.snapshot().rows[1].enabled,false);
unavailable.handleKey('ArrowDown'); assert.equal(unavailable.snapshot().selected,2,'disabled Continue skipped');
const empty = createTitleMenu(createMemoryAdapter());
empty.handleKey('Delete'); assert.equal(empty.snapshot().mode,'main');
assert.equal(empty.snapshot().rows[1].enabled,false);
assert.throws(()=>createTitleMenu({}),/adapter required/);
const style = globalThis.ASSETS.uiStyle.menu;
const styled = createTitleMenu(createMemoryAdapter(),{style});
const styledBounds = styled.draw(ui);
const bgAt = (x,y) => [...ui.cells.bg.slice(((styledBounds.y+y)*ui.cols+styledBounds.x+x)*4,((styledBounds.y+y)*ui.cols+styledBounds.x+x)*4+4)];
assert.deepEqual(bgAt(10,6),[52,42,16,255],'designer gold band for focused row');
assert.deepEqual(bgAt(10,8),[10,11,16,255],'disabled Continue keeps opaque plate');
assert.equal(styled.snapshot().rows[1].display,'Continue (no save)','writer disabled label');
styled.handleKey('ArrowDown'); styled.draw(ui);
assert.deepEqual(bgAt(10,6),[10,11,16,255],'moving focus clears old band');
assert.deepEqual(bgAt(10,12),[52,42,16,255],'focus skips disabled Continue');
const beforeDraw = JSON.stringify(styled.snapshot());
for(let i=0;i<100;i++) assert.equal(styled.draw(ui),styledBounds);
assert.equal(JSON.stringify(styled.snapshot()),beforeDraw,'styled drawing leaves controller state unchanged');
const styledAdapter=createMemoryAdapter(); styledAdapter.writeSlot(0,save); styledAdapter.writeSlot(2,save);
const occupied = createTitleMenu(styledAdapter,{style}); occupied.draw(ui); occupied.handleKey('Delete');
assert.equal(occupied.snapshot().selected,0,'styled confirmation still defaults to Cancel');
occupied.draw(ui); assert.equal(occupied.snapshot().mode,'confirm');
occupied.handleKey('Escape'); assert.ok(styledAdapter.readSlot(0).save && styledAdapter.readSlot(2).save,'styled cancel retains slots');
console.log('titleMenu: new/load/settings, keyboard/mouse, cancel/replacement/delete isolation and corrupt/denied storage PASS');
