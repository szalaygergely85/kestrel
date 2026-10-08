import assert from 'node:assert/strict';
import {World,AssetRegistry} from '../../../../engine/index.js';
import {createQuest,applyQuestEvent,stringifyQuest} from './quest.js';
import {createQuestMarkers} from './questMarkers.js';
import {collectSave,applySave,stringifyGameSave,parseGameSave} from '../save/saveState.js';

// Fixture-only future chain, not new production note copy/anchors/boars.
const def={version:1,id:'markerFixture',objectives:[
  {id:'wake',text:'wake',when:{type:'flag',id:'wake',equals:true}},
  {id:'lantern',text:'lantern',when:{type:'item',id:'lantern'}},
  {id:'breach',text:'breach',when:{type:'area',id:'breach'}},
  {id:'note1',text:'note1',when:{type:'flag',id:'note1.read',equals:true}},
  {id:'sword',text:'sword',when:{type:'item',id:'sword'}},
  {id:'note2',text:'note2',when:{type:'flag',id:'note2.read',equals:true}},
  {id:'beasts',text:'beasts',when:{type:'beasts',ids:['boar1','boar2','boar3','boar4','boar5'],count:5}},
  {id:'waystone',text:'waystone',when:{type:'flag',id:'waystone.touched',equals:true}},
]};
const bindings=[{objectiveId:'note1',targets:['noteProp1']},{objectiveId:'note2',targets:['noteProp2']},
  {objectiveId:'waystone',targets:['waystoneProp']}];
const markers=createQuestMarkers(def,bindings),state=createQuest(def);
const send=event=>applyQuestEvent(state,event,def);
const prefix=[{type:'flag:set',key:'wake',value:true},{type:'item:got',id:'lantern'},{type:'area:entered',id:'breach'}];
assert.deepEqual(markers.markerTargets(state),[]);
for(const e of prefix)send(e);
const noteTargets=markers.markerTargets(state);assert.deepEqual(noteTargets,['noteProp1']);
assert.equal(markers.markerTargets(state),noteTargets,'target array reused');assert.equal(Object.isFrozen(noteTargets),true);
send({type:'flag:set',key:'note1.read',value:true});assert.deepEqual(markers.markerTargets(state),[],'take removes note marker immediately');
assert.equal(state.completed.at(-1),'note1','sword goal remains unfinished');
send({type:'flag:set',key:'note1.read',value:false});assert.deepEqual(markers.markerTargets(state),[],'completed take stays latched');
send({type:'item:got',id:'sword'});assert.deepEqual(markers.markerTargets(state),['noteProp2']);
send({type:'flag:set',key:'note2.read',value:true});assert.deepEqual(markers.markerTargets(state),[]);
for(let i=1;i<=4;i++){send({type:'beast:died',id:'boar'+i});assert.deepEqual(markers.markerTargets(state),[]);}
send({type:'beast:died',id:'boar1'});send({type:'beast:died',id:'unrelated'});assert.deepEqual(markers.markerTargets(state),[],'duplicate/unrelated deaths cannot unlock next quest');
send({type:'beast:died',id:'boar5'});assert.deepEqual(markers.markerTargets(state),['waystoneProp']);
const before=stringifyQuest(state,def);for(let i=0;i<1000;i++)markers.markerTargets(state);
assert.equal(stringifyQuest(state,def),before,'query does not mutate quest facts/save');
const assets=new AssetRegistry({palette:{}}),world=World.load({name:'marker_fixture',terrain:null,structures:[],entities:[]},assets,{});
const save=collectSave(world,{quest:state,questDef:def}),bytes=stringifyGameSave(save);
const restored=applySave(parseGameSave(bytes),assets,{questDef:def});
assert.deepEqual(markers.markerTargets(restored.quest),['waystoneProp']);
assert.equal(stringifyGameSave(collectSave(restored.world,{...restored,questDef:def})),bytes,'real game save round trip is byte-stable');
send({type:'flag:set',key:'waystone.touched',value:true});assert.deepEqual(markers.markerTargets(state),[]);
assert.deepEqual(markers.markerTargets(createQuest(def,state)),[],'taken marker remains hidden after restore');
const early=createQuest(def);applyQuestEvent(early,{type:'flag:set',key:'note1.read',value:true},def);
for(const e of prefix)applyQuestEvent(early,e,def);assert.deepEqual(markers.markerTargets(early),[],'an early take never produces a later marker flash');
// Accept is a completed step separate from the still-active item goal; no unlatched secondary take flag.
const goal={version:1,id:'acceptedFixture',objectives:[
  {id:'accept',text:'accept',when:{type:'flag',id:'accepted',equals:true}},
  {id:'collect',text:'collect',when:{type:'item',id:'sword'}},
]};
const separate=createQuestMarkers(goal,[{objectiveId:'accept',targets:['giver']}]);
const accepted=createQuest(goal);assert.deepEqual(separate.markerTargets(accepted),['giver']);
applyQuestEvent(accepted,{type:'flag:set',key:'accepted',value:true},goal);
assert.deepEqual(accepted.completed,['accept']);assert.deepEqual(separate.markerTargets(accepted),[]);
applyQuestEvent(accepted,{type:'flag:set',key:'accepted',value:false},goal);
assert.deepEqual(separate.markerTargets(createQuest(goal,accepted)),[],'latched take survives cleared flag/restore while goal remains active');
const areaDef={version:1,id:'areaFixture',objectives:[{id:'touch',text:'touch',when:{type:'area',id:'stone'}}]};
const area=createQuestMarkers(areaDef,[{objectiveId:'touch',targets:['stoneA','stoneB']}]);
const areaState=createQuest(areaDef);assert.deepEqual(area.markerTargets(areaState),['stoneA','stoneB']);
applyQuestEvent(areaState,{type:'area:entered',id:'stone'},areaDef);assert.deepEqual(area.markerTargets(areaState),[]);
assert.throws(()=>createQuestMarkers(def,[bindings[0],bindings[0]]),/duplicate/);
assert.throws(()=>createQuestMarkers(def,[{objectiveId:'missing',targets:['x']}]),/unknown/);
assert.throws(()=>createQuestMarkers(def,[{objectiveId:'sword',targets:['x']}]),/take step/);
assert.throws(()=>createQuestMarkers(def,[{objectiveId:'note1',targets:['constructor']}]),/targets/);
assert.throws(()=>createQuestMarkers(def,[{objectiveId:'note1',targets:['x','x']}]),/targets/);
assert.throws(()=>createQuestMarkers(def,[{objectiveId:'note1',targets:['x'],taken:{type:'flag',id:'bad id',equals:true}}]),/take step/);
assert.throws(()=>markers.markerTargets(accepted),/incompatible/);
const mutable=structuredClone(bindings),copied=createQuestMarkers(def,mutable),first=createQuest(def);
for(const e of prefix)applyQuestEvent(first,e,def);mutable[0].targets[0]='changed';
assert.deepEqual(copied.markerTargets(first),['noteProp1'],'bindings copied at create');
function replay(resume=false) {
  let q=createQuest(def);const trace=[];
  const events=[...prefix,{type:'flag:set',key:'note1.read',value:true},{type:'item:got',id:'sword'},
    {type:'flag:set',key:'note2.read',value:true},...Array.from({length:5},(_,i)=>({type:'beast:died',id:'boar'+(i+1)})),
    {type:'flag:set',key:'waystone.touched',value:true}];
  for(let tick=0;tick<600;tick++) {
    if(tick%40===0 && events[tick/40])applyQuestEvent(q,events[tick/40],def);
    if(resume && tick===299)q=createQuest(def,JSON.parse(stringifyQuest(q,def)));
    trace.push(markers.markerTargets(q).join('|'));
  }
  return {trace,bytes:stringifyQuest(q,def)};
}
assert.deepEqual(replay(),replay(),'same event sequence produces identical marker trace');
assert.deepEqual(replay(),replay(true),'600-step marker replay survives midpoint save/restore');
if(typeof global.gc==='function') {
  function measure(){let total=0;for(let i=0;i<200000;i++)total+=markers.markerTargets(i%2 ? first : state).length;return total;}
  measure();global.gc();const start=process.memoryUsage().heapUsed;
  assert.equal(measure(),100000);global.gc();assert.ok(process.memoryUsage().heapUsed-start<65536,'marker query does not allocate per step');
}
console.log('questMarkers: availability/take, independent active goal, 5-boar unlock, existing save restore, immutable reused targets and GC PASS');
