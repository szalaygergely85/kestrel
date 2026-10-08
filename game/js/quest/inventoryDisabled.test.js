import assert from 'node:assert/strict';
import '../../../design/palette.js';
import '../../../design/items.js';
import '../../../design/models/inventory_ui.js';
import {createUiLayer} from '../../../engine/index.js';
import {createInventoryView} from './inventoryView.js';
import {ensureInventory} from './sim/inventory.js';

const A=globalThis.ASSETS,style=A.uiStyle.inventory;
const player={components:{health:{hp:20,max:30}}};
const inv=ensureInventory(player,{pack:[{id:'sword',n:1},{id:'spell.fireball',n:1},{id:'boar.meat',n:2}],left:'sword',right:'spell.fireball'});
const locked=new Set([1,3]), busy=new Set(['right']);
const view=createInventoryView({style,items:A.items,rgb:A.palette.rgb,inventoryOf:()=>inv,healthOf:()=>player.components.health,
  isSlotDisabled:i=>locked.has(i),isHandDisabled:hand=>busy.has(hand)});
const pressed=new Set(), input={pressed:code=>pressed.has(code),consumePressed:()=>pressed.clear()};
function step(code){pressed.add(code);view.step(1/60,input,true);}
view.open();assert.equal(view.cursor.idx,0);
step('ArrowRight');assert.equal(view.cursor.idx,2,'keyboard skips locked slot');
step('ArrowLeft');assert.equal(view.cursor.idx,0);
view.setPointer(style.panel.x+style.grid.x+style.grid.pitchX+2,style.panel.y+style.grid.y+2);
assert.equal(view.cursor.idx,0,'pointer cannot select locked slot');
const before=JSON.stringify(inv);
step('KeyE');assert.equal(JSON.stringify(inv),before,'busy target hand refuses assignment');
locked.delete(1);step('ArrowRight');assert.equal(view.cursor.idx,1);
step('KeyQ');assert.equal(JSON.stringify(inv),before,'cannot move an item out of a busy other hand');
view.setPointer(style.panel.x+style.hands.right.box.x+2,style.panel.y+style.hands.right.box.y+2);
step('Enter');assert.equal(inv.right,'spell.fireball','cannot empty busy hand');
const ui=createUiLayer({cols:160});view.draw(ui);
function line(y){return Array.from(ui.cells.glyphIdx.slice((style.panel.y+y)*ui.cols+style.panel.x,(style.panel.y+y)*ui.cols+style.panel.x+style.panel.w),v=>String.fromCharCode(v+32)).join('');}
assert.ok(line(style.hands.right.label.y).includes('(busy)'));
busy.clear();step('Enter');assert.equal(inv.right,null,'unlock restores normal hand action');
view.setPointer(style.panel.x+style.grid.x+style.grid.pitchX*2+2,style.panel.y+style.grid.y+2);
locked.add(2);const hp=player.components.health.hp;step('Enter');assert.equal(player.components.health.hp,hp);assert.equal(inv.slots[2].n,2);
ui.clear();view.draw(ui);assert.ok(line(style.details.emptySlot.y).includes('Locked'));
const x=style.panel.x+style.grid.x+style.grid.pitchX*2+style.slot.disabled.x;
const y=style.panel.y+style.grid.y+style.slot.disabled.y;
assert.equal(ui.cells.glyphIdx[y*ui.cols+x]+32,'x'.charCodeAt(0));
assert.deepEqual([...ui.cells.bg.slice((y*ui.cols+x)*4,(y*ui.cols+x)*4+3)],style.slot.disabled.innerBg);
const borderX=style.panel.x+style.grid.x+style.grid.pitchX*3;
assert.equal(ui.cells.glyphIdx[(style.panel.y+style.grid.y)*ui.cols+borderX]+32,'.'.charCodeAt(0),'shared border between two locked slots is dotted');
locked.delete(3);ui.clear();view.draw(ui);
assert.equal(ui.cells.glyphIdx[(style.panel.y+style.grid.y)*ui.cols+borderX]+32,style.slot.border.corner.charCodeAt(0),'live border wins shared locked border');
locked.clear();step('Enter');assert.equal(player.components.health.hp,30);assert.equal(inv.slots[2].n,1);
for(let i=0;i<24;i++)locked.add(i);
view.close();view.open();step('ArrowRight');assert.equal(view.cursor.idx,0,'all locked navigation terminates');
ui.clear();view.draw(ui);assert.ok(line(style.details.emptySlot.y).includes('Locked'));
const fake={cols:160,rows:60,setCellRGB(){}};
for(let i=0;i<1000;i++)view.draw(fake);
if(global.gc){global.gc();const beforeHeap=process.memoryUsage().heapUsed;for(let i=0;i<5000;i++)view.draw(fake);global.gc();assert.ok(process.memoryUsage().heapUsed<=beforeHeap+3e5,'same existing inventory draw heap bar for disabled path');}
console.log('inventory disabled: skip/hover, dynamic lock, busy assignment/swap/clear refusal, unlock, authored style/shared borders, all locked and GC PASS');
