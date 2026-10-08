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
console.log('quest: ordered objectives, early facts, deduplicated deaths, atomic validation, canonical restore and 600-step replay PASS');
