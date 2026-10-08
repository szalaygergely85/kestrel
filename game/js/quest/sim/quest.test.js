import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuest, applyQuestEvent, questObjectives, stringifyQuest, questHash, validateQuestDefinition } from './quest.js';
const def=JSON.parse(readFileSync(new URL('../../../../content/quests/m1.quest.json',import.meta.url)));
const events=[{type:'flag:set',key:'wake',value:true},{type:'item:got',id:'lantern'},{type:'area:entered',id:'breach'},
 {type:'item:got',id:'sword'},{type:'beast:died',id:'boar1'},{type:'beast:died',id:'boar2'},{type:'area:entered',id:'waystone'}];
const state=createQuest(def);
assert.equal(questObjectives(state,def)[0].status,'active');
applyQuestEvent(state,events[6],def);assert.deepEqual(state.completed,[],'early facts cannot skip predecessors');
for(const e of events.slice(0,5)) applyQuestEvent(state,e,def);
assert.equal(questObjectives(state,def)[4].progress,1);
assert.equal(applyQuestEvent(state,events[4],def),false,'same beast cannot count twice');
applyQuestEvent(state,{type:'beast:died',id:'unrelated'},def);assert.equal(questObjectives(state,def)[4].progress,1);
applyQuestEvent(state,events[5],def);assert.deepEqual(state.completed,def.objectives.map(o=>o.id));
applyQuestEvent(state,{type:'flag:set',key:'wake',value:false},def);assert.equal(state.completed.length,6,'completed objectives are latched');
const bytes=stringifyQuest(state,def);
assert.equal(stringifyQuest(createQuest(def,JSON.parse(bytes)),def),bytes);
const before=stringifyQuest(state,def);
for(const e of [{type:'flag:set',key:'constructor',value:true},{type:'flag:set',key:'okay',value:NaN},{type:'item:got',id:42}]) {
 assert.throws(()=>applyQuestEvent(state,e,def));assert.equal(stringifyQuest(state,def),before,'invalid events are atomic');
}
assert.equal(applyQuestEvent(state,{type:'unknown'},def),false);
const bad=JSON.parse(bytes);bad.completed=['sword'];assert.throws(()=>createQuest(def,bad));
const dup=structuredClone(def);dup.objectives[1].id='wake';assert.throws(()=>validateQuestDefinition(dup));
function replay(resume=false) {
 let s=createQuest(def),hash=0;
 for(let tick=0;tick<600;tick++) {
  if(tick%60===0 && tick/60<events.length) applyQuestEvent(s,events[tick/60],def);
  if(tick%17===0) applyQuestEvent(s,{type:'beast:died',id:'boar1'},def);
  if(resume && tick===299) s=createQuest(def,JSON.parse(stringifyQuest(s,def)));
  hash=Math.imul(hash ^ questHash(s,def),16777619)>>>0;
 }
 return {hash,bytes:stringifyQuest(s,def)};
}
assert.deepEqual(replay(),replay());assert.deepEqual(replay(),replay(true),'600-step replay survives midpoint reload');
const reversed=createQuest(def);for(const e of [...events].reverse())applyQuestEvent(reversed,e,def);
const forward=createQuest(def);for(const e of events)applyQuestEvent(forward,e,def);
assert.equal(questHash(reversed,def),questHash(forward,def),'fact insertion order has canonical bytes');
const rows=questObjectives(state,def),first=rows[0];
for(let i=0;i<1000;i++)assert.equal(questObjectives(state,def,rows),rows);
assert.equal(rows[0],first,'journal projection reuses supplied rows');
// S8-C-13: production M3 beats remain in m1, with stable objective/area/item ids.
const areas=JSON.parse(readFileSync(new URL('../../../../content/quests/areas.json',import.meta.url)));
const worldDef=JSON.parse(readFileSync(new URL('../../../../content/worlds/world_m1.world.json',import.meta.url)));
const towerDef=JSON.parse(readFileSync(new URL('../../../../content/levels/tower.level.json',import.meta.url)));
const breach=def.objectives.find(o=>o.id==='breach'),sword=def.objectives.find(o=>o.id==='sword');
assert.equal(breach.text,'Climb to the breach at the top');
assert.deepEqual(breach.when,{type:'area',id:'breach'});
assert.equal(sword.text,'Take up the ruin steel');
assert.deepEqual(sword.when,{type:'item',id:'sword'});
const target=areas.areas[breach.when.id];
assert.equal(target.world,worldDef.id);
assert.equal(worldDef.structures.find(s=>s.id===target.structure).level,towerDef.id);
assert.ok(towerDef.markers[target.marker], 'breach aliases a point on the placed tower');
const pickup=towerDef.interactables.find(i=>i.id===sword.when.id);
assert.equal(pickup.interact,'sword.take');
assert.ok(towerDef.props.some(p=>p.id===pickup.prop),'quest sword names the existing real pickup');
const waypoint=areas.areas.waystone;
assert.ok(worldDef.triggers.some(t=>t.id===waypoint.trigger),'last beat references the existing waystone circle');
function beginM3() {
 const s=createQuest(def);
 applyQuestEvent(s,events[0],def);applyQuestEvent(s,events[1],def);
 return s;
}
function restore(s) {return createQuest(def,JSON.parse(stringifyQuest(s,def)));}
function active(s) {return questObjectives(s,def).find(o=>o.status==='active')?.id;}
let m3=beginM3();
assert.equal(active(m3),'breach');
applyQuestEvent(m3,{type:'area:entered',id:'end'},def);
applyQuestEvent(m3,{type:'flag:set',key:'tower.sword.taken',value:true},def);
assert.equal(active(m3),'breach','raw trigger ids and pickup flags alone cannot bypass the semantic area beat');
m3=restore(m3);
applyQuestEvent(m3,events[2],def);assert.equal(active(m3),'sword');
m3=restore(m3);assert.equal(active(m3),'sword','reload between the breach and pickup preserves the active beat');
applyQuestEvent(m3,events[3],def);assert.equal(active(m3),'beasts');
m3=restore(m3);assert.equal(active(m3),'beasts');
assert.equal(applyQuestEvent(m3,events[3],def),false,'replayed pickup is idempotent after reload');
let earlySword=beginM3();
applyQuestEvent(earlySword,events[3],def);assert.equal(active(earlySword),'breach','downstairs sword can be taken before reaching the summit');
earlySword=restore(earlySword);applyQuestEvent(earlySword,events[2],def);
assert.equal(active(earlySword),'beasts','early sword fact satisfies its beat as soon as breach completes');
for(const s of [m3,earlySword]) {
 applyQuestEvent(s,events[4],def);assert.equal(active(s),'beasts');
 applyQuestEvent(s,events[5],def);assert.equal(active(s),'waystone');
 applyQuestEvent(s,events[6],def);assert.equal(active(s),undefined);
}
// The unrelated raw end fact/real pickup flag may be present only in m3; both
// paths still produce exactly the same completed objective prefix.
assert.deepEqual(m3.completed,earlySword.completed);
assert.deepEqual(m3.completed,def.objectives.map(o=>o.id));
console.log('quest: ordered objectives, early facts, deduplicated deaths, atomic validation, canonical restore and 600-step replay PASS');
