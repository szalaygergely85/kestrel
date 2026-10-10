import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuest,applyQuestEvent } from '../quest/sim/quest.js';
import { createQuestLog } from './questLog.js';

const def=JSON.parse(readFileSync(new URL('../quest/sim/fixtures/m1.legacy.quest.json',import.meta.url)));
def.objectives[4].when={type:'beasts',ids:['boar1','boar2','boar3','boar4','boar5'],count:5}; // legacy m1 shape (QG-03)

const state=createQuest(def), view=createQuestLog(def,{hudWidth:12}), ui=createUiLayer({cols:160});
assert.equal(view.update(state),'Get up fr...');
applyQuestEvent(state,{type:'flag:set',key:'wake',value:true},def);
assert.equal(view.update(state),'Take the ...');
assert.equal(view.snapshot()[0].status,'complete'); assert.equal(view.snapshot()[1].status,'active');
applyQuestEvent(state,{type:'item:got',id:'lantern'},def);
assert.equal(view.update(state),'Climb to ...');
view.drawHud(ui,1,1); assert.deepEqual([...ui.cells.bg.slice((ui.cols+1)*4,(ui.cols+1)*4+4)],[10,11,16,255]);
const bounds=view.drawLog(ui); assert.equal(view.drawLog(ui),bounds,'layout object reused');
const original=structuredClone(state);
for(let i=0;i<100;i++){view.drawLog(ui);view.drawHud(ui,1,1);}
assert.deepEqual(state,original,'drawing never changes quest state');
const snapshot=view.snapshot(); snapshot[0].status='locked'; assert.equal(view.snapshot()[0].status,'complete');
for(const event of [{type:'area:entered',id:'breach'},{type:'item:got',id:'sword'},
  {type:'beast:died',id:'boar1'},{type:'beast:died',id:'boar2'},{type:'beast:died',id:'boar3'},{type:'beast:died',id:'boar4'},{type:'beast:died',id:'boar5'},{type:'area:entered',id:'waystone'}]) {
  applyQuestEvent(state,event,def); view.update(state);
}
assert.equal(view.getObjectiveLine(),''); assert.ok(view.snapshot().every(row=>row.status==='complete'));
view.drawHud(ui,1,1);
assert.ok(ui.cells.glyphIdx.slice(ui.cols+1,ui.cols+13).every(code=>code===0),'shorter/empty HUD clears old text');
assert.throws(()=>createQuestLog(def,{hudWidth:2}),RangeError);
assert.throws(()=>view.update({...state,questId:'other'}),/incompatible/);
console.log('questLog: active/done chain, clipped text, opaque plate, reused draw layout and cleared HUD PASS');
