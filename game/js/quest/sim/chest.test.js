import assert from 'node:assert/strict';
import {World,AssetRegistry} from '../../../../engine/index.js';
import '../../../../design/palette.js';
import '../../../../design/items.js';
import '../../../../design/models/chest.js';
import {createChests} from './chest.js';
import {CHEST_DEFAULTS as C} from './lootConfig.js';
import {ensureInventory,addItem,countOf,removeItem} from './inventory.js';
import {collectSave,applySave,stringifyGameSave,parseGameSave} from '../save/saveState.js';

const items=globalThis.ASSETS.items.defs, assets=new AssetRegistry({palette:{}});
const table={fixed:[{item:'brass.scrap',n:2}],weighted:[{item:'boar.hide',n:1,weight:2},{item:'boar.tusk',n:1,weight:1}]};
const def={id:'fixtureChest',x:0,y:0,z:0,frontX:0,frontY:-1,interact:{radius:C.radius,facingDeg:C.facingDeg,facingCos:C.facingCos},table};
const pose={x:0,y:-1,z:0,forwardX:0,forwardY:1};
function rig(defs=[def], restored=null) {
  const world=restored?.world || World.load({name:'chest_fixture',terrain:null,structures:[],entities:[]},assets,{});
  const player=world.get('player') || world.spawn('unit',{x:0,y:-1,z:0},{},'player');
  const inv=ensureInventory(player.data,{pack:[],left:null,right:null}), log=[];
  let sim, saveOnGrant;
  const events={emit(name,p){log.push({name,...p});if(name==='inventory:added')saveOnGrant=collectSave(world,{openedChests:sim.openedIds()});}};
  sim=createChests(defs,{items,inventoryOf:()=>inv,events,openedChests:restored?.openedChests,seed:7});
  return {world,inv,sim,log,get saveOnGrant(){return saveOnGrant;}};
}
const r=rig();
assert.equal(r.sim.stateOf(def.id),'closed');assert.equal(r.sim.stateOf('unknown'),null);
for(const p of [{...pose,y:-1.61},{...pose,y:1,forwardY:-1},{...pose,forwardY:-1},
  {...pose,forwardX:1,forwardY:0},{...pose,z:2},{...pose,x:NaN},{...pose,forwardY:0}])assert.equal(r.sim.open(def.id,p),false);
assert.equal(r.sim.canOpen(def.id,{...pose,y:-1.6}),true,'inclusive authored radius');
assert.equal(r.sim.canOpen(def.id,{...pose,forwardX:0.9,forwardY:C.facingCos}),true,'near authored facing boundary');
assert.equal(r.sim.canOpen(def.id,{...pose,forwardX:1,forwardY:0.1}),false,'beyond facing cone');
assert.equal(r.sim.open(def.id,pose),true);assert.equal(r.sim.open(def.id,pose),false);
r.sim.step(10,false);assert.equal(r.sim.stateOf(def.id),'opening','pause freezes animation and grant');
r.sim.step(0.59);assert.equal(countOf(r.inv,'brass.scrap'),0);
r.sim.step(0.01);assert.equal(r.sim.stateOf(def.id),'open');assert.equal(countOf(r.inv,'brass.scrap'),2);
assert.deepEqual(r.sim.openedIds(),[def.id]);assert.equal(r.sim.open(def.id,pose),false);
const count=r.log.length;r.sim.step(100);assert.equal(r.log.length,count,'grant/open events occur once');
assert.equal(r.log.filter(e=>e.name==='chest:opened').length,1);
assert.deepEqual(r.saveOnGrant.game.openedChests,[def.id],'inventory event save already contains the opened id');
const bytes=stringifyGameSave(collectSave(r.world,{openedChests:r.sim.openedIds()}));
const restored=applySave(parseGameSave(bytes),assets), loaded=rig([def],restored);
assert.equal(loaded.sim.stateOf(def.id),'open');assert.equal(loaded.sim.open(def.id,pose),false);
loaded.sim.step(1);assert.deepEqual(loaded.log,[]);assert.equal(countOf(loaded.inv,'brass.scrap'),2);
assert.equal(stringifyGameSave(collectSave(loaded.world,{openedChests:loaded.sim.openedIds()})),bytes);
const again=rig();again.sim.open(def.id,pose);again.sim.step(0.6);
assert.deepEqual(again.inv,r.inv,'seeded loot repeat is identical');
const interrupted=rig();interrupted.sim.open(def.id,pose);interrupted.sim.step(0.3);
const resume=rig([def],applySave(collectSave(interrupted.world,{openedChests:interrupted.sim.openedIds()}),assets));
assert.equal(resume.sim.stateOf(def.id),'closed','ungranted transient opening restarts safely');
resume.sim.open(def.id,pose);resume.sim.step(0.6);assert.deepEqual(resume.inv,r.inv);
// Whole-reward capacity includes competition for empty slots and fixed/weighted rows of the same id.
const full=rig();for(let i=0;i<24;i++)addItem(full.inv,items,'boar.meat',10);
assert.equal(full.sim.open(def.id,pose),false);assert.deepEqual(full.sim.openedIds(),[]);
assert.equal(full.log.at(-1).name,'inventory:full');removeItem(full.inv,'boar.meat',20);
assert.equal(full.sim.open(def.id,pose),true);full.sim.step(0.6);assert.equal(countOf(full.inv,'brass.scrap'),2);
const filledDuring=rig();filledDuring.sim.open(def.id,pose);for(let i=0;i<24;i++)addItem(filledDuring.inv,items,'boar.meat',10);
filledDuring.sim.step(0.6);assert.equal(filledDuring.sim.stateOf(def.id),'closed');assert.equal(countOf(filledDuring.inv,'brass.scrap'),0);
removeItem(filledDuring.inv,'boar.meat',20);filledDuring.sim.open(def.id,pose);filledDuring.sim.step(0.6);
assert.equal(countOf(filledDuring.inv,'brass.scrap'),2,'retry loses no reward and does not reroll');
const other={...def,id:'otherChest'};
function rewards(defs,order){const t=rig(defs), out={};for(const id of order){const start=t.log.length;t.sim.open(id,pose);t.sim.step(0.6);out[id]=t.log.slice(start).filter(e=>e.name==='inventory:added');}return out;}
assert.deepEqual(rewards([def,other],[def.id,other.id]),rewards([other,def],[other.id,def.id]),'per-id streams ignore load/open order');
for(const dt of [-1,NaN,Infinity])assert.throws(()=>r.sim.step(dt),/invalid dt/);
assert.throws(()=>rig([def,def]),/duplicate/);
for(const badTable of [{fixed:[],weighted:[]},{fixed:[{item:'missing',n:1}],weighted:[]},
  {fixed:[{item:'cog',n:1}],weighted:[]},{fixed:[],weighted:[{item:'boar.hide',n:1,weight:0}]},
  {fixed:[{item:'orb.hp',n:1}],weighted:[]}])assert.throws(()=>rig([{...def,table:badTable}]),/chest loot/);
assert.equal(globalThis.ASSETS.chestFx.openMs/1000,C.openSeconds,'sim matches supplied clip duration');
assert.equal(globalThis.ASSETS.chestFx.interact.radius,C.radius);
assert.equal(globalThis.ASSETS.chestFx.interact.facingDeg,C.facingDeg);
assert.equal(C.prompt,'[E] Open chest');
const stale=rig([def],{world:null,openedChests:['oldChest']});
assert.deepEqual(stale.sim.openedIds(),['oldChest'],'unloaded opened ids survive save');
const combined={...def,table:{fixed:[{item:'boar.hide',n:19}],weighted:[{item:'boar.hide',n:2,weight:1}]}};
const combinedRig=rig([combined]);for(let i=0;i<23;i++)addItem(combinedRig.inv,items,'boar.meat',10);
assert.equal(combinedRig.sim.open(def.id,pose),false,'merged reward needs two slots, one is insufficient');
removeItem(combinedRig.inv,'boar.meat',10);combinedRig.sim.open(def.id,pose);combinedRig.sim.step(0.6);
assert.equal(countOf(combinedRig.inv,'boar.hide'),21,'fixed and selected rows merge without loss');
if(typeof global.gc==='function') {
  for(let i=0;i<1000;i++){r.sim.step(1/60);r.sim.canOpen(def.id,pose);}
  global.gc();const before=process.memoryUsage().heapUsed;
  for(let i=0;i<200000;i++){r.sim.step(1/60);r.sim.canOpen(def.id,pose);}
  global.gc();assert.ok(process.memoryUsage().heapUsed-before < 65536,'idle sim does not allocate per frame');
}
console.log('chest: lifecycle, range/facing, atomic capacity, seeded order, save/load and event-time save PASS');
