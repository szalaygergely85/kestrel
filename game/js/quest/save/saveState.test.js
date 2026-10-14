import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { ensureInventory } from '../sim/inventory.js';
import { createQuest, applyQuestEvent } from '../sim/quest.js';
import { collectSave,applySave,stringifyGameSave,parseGameSave,createMemoryAdapter,createStorageAdapter,createPlayTime } from './saveState.js';
const assets=new AssetRegistry({palette:{}}),world=World.load({name:'save_fixture',terrain:null,structures:[],entities:[]},assets,{});
const player=world.spawn('unit',{x:12.25,y:-3.5,z:2,yawDeg:123,pitchDeg:-9},{health:{hp:3,max:5,invuln:0},mana:{mp:7,max:10}},'player');
ensureInventory(player.data,{pack:[{id:'lantern',n:1},{id:'sword',n:1}],left:'lantern',right:'sword'});
const questDef=JSON.parse(readFileSync(new URL('../../../../content/quests/m1.quest.json',import.meta.url)));
const quest=createQuest(questDef);applyQuestEvent(quest,{type:'flag:set',key:'wake',value:true},questDef);
const options={quest,questDef,openedChests:['chestB','chestA','chestA'],deadBeasts:['boar2','boar1'],place:'Tower',playTimeSec:125.5};
const save=collectSave(world,options),text=stringifyGameSave(save);
const restored=applySave(parseGameSave(text),assets,{questDef});
assert.equal(restored.world.get('player').data.components.health.hp,3);
assert.equal(restored.world.get('player').data.components.mana.mp,7);
assert.equal(restored.world.get('player').data.components.inventory.left,'lantern');
assert.equal(restored.world.get('player').data.components.inventory.right,'sword');
assert.equal(restored.world.get('player').data.transform.x,12.25);
assert.equal(restored.world.get('player').data.transform.yawDeg,123);
assert.deepEqual(restored.openedChests,['chestA','chestB']);assert.deepEqual(restored.deadBeasts,['boar1','boar2']);
assert.deepEqual(restored.quest,quest);
assert.equal(stringifyGameSave(collectSave(restored.world,{...restored,...restored.meta,questDef})),text,'byte-stable collect/apply/collect');
world.get('player').data.components.health.hp=1;assert.equal(save.world.entities[0].components.health.hp,3,'snapshot has no aliases');
restored.quest.flags.wake=false;assert.equal(save.game.quest.flags.wake,true,'restore has no aliases');
const legacy=structuredClone(save);legacy.world.version=1;for(const e of legacy.world.entities)delete e.parent;
assert.equal(collectSave(applySave(legacy,assets,{questDef}).world).world.version,3,'public deserialize migrates WorldState v1');
const newer=structuredClone(save);newer.saveVersion=3;assert.throws(()=>applySave(newer,assets,{questDef}));
const bad=structuredClone(save);bad.meta.playTimeSec=NaN;assert.throws(()=>stringifyGameSave(bad));
const adapter=createMemoryAdapter();assert.equal(adapter.readSlot(0).save,null);
assert.equal(adapter.writeSlot(0,save).ok,true);assert.equal(adapter.writeSlot(2,save).ok,true);
assert.equal(stringifyGameSave(adapter.readSlot(0).save),text);
assert.equal(adapter.listSlots().length,3);assert.equal(adapter.listSlots()[1].meta,null);
assert.equal(adapter.listSlots()[0].meta.playerName,'Wick');assert.equal(adapter.deleteSlot(0).ok,true);
assert.equal(adapter.readSlot(0).save,null);assert.ok(adapter.readSlot(2).save,'slot deletion isolated');
assert.throws(()=>adapter.writeSlot(3,save));
const unavailable=createStorageAdapter({getItem:()=>{throw Error('privacy');},setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('privacy');}});
assert.equal(unavailable.writeSlot(0,save).ok,false);assert.equal(unavailable.readSlot(0).ok,false);assert.equal(unavailable.deleteSlot(0).ok,false);
const corrupt=createStorageAdapter({getItem:()=>'{bad',setItem:()=>{},removeItem:()=>{}});assert.equal(corrupt.readSlot(0).ok,false);
assert.equal(createStorageAdapter({getItem:()=>null,setItem:()=>{},removeItem:()=>{}}).writeSlot(0,save).ok,false,'read-back detects silent write loss');
assert.deepEqual(world.get('player').data.components.inventory,save.world.entities[0].components.inventory);
// S8-C-02: active simulation time only, resumed through the existing save envelope.
const clock = createPlayTime(save.meta.playTimeSec);
assert.equal(clock.tick(12,false),125.5,'menus/paused time excluded');
assert.equal(clock.tick(0.25,true),125.75);
assert.equal(clock.tick(0,true),125.75);
const timedSave = collectSave(world,{...options,playTimeSec:clock.seconds});
adapter.writeSlot(1,timedSave);
const resumedClock = createPlayTime(adapter.readSlot(1).save.meta.playTimeSec);
for (let i=0;i<600;i++) resumedClock.tick(1/60,i%2===0);
assert.ok(Math.abs(resumedClock.seconds-130.75)<1e-10,'only 300 active steps counted');
const persisted = stringifyGameSave(collectSave(world,{...options,playTimeSec:resumedClock.seconds}));
assert.equal(createPlayTime(parseGameSave(persisted).meta.playTimeSec).seconds,resumedClock.seconds);
assert.equal(adapter.readSlot(2).save.meta.playTimeSec,125.5,'other slot time unchanged');
const independent = createPlayTime(); assert.equal(independent.tick(3,true),3);
assert.equal(independent.tick(5,undefined),3,'explicit active flag required');
for (const invalid of [-1,NaN,Infinity,'1']) {
  assert.throws(()=>createPlayTime(invalid),RangeError);
  assert.throws(()=>clock.tick(invalid,true),RangeError);
  assert.equal(clock.seconds,125.75,'invalid step changes nothing');
}
const overflow = createPlayTime(Number.MAX_VALUE);
assert.throws(()=>overflow.tick(Number.MAX_VALUE,true),RangeError);
assert.equal(overflow.seconds,Number.MAX_VALUE);
console.log('saveState: player components/hands, quest/chests/deaths, byte-stable round trip, CO-5 migration, isolated/error-safe slots and active play time PASS');

// SAVE-TIME-01: savedAt written (ms epoch); old saves without it still load.
{
  assert.equal(collectSave(world, {}).meta.savedAt, undefined, 'pure collect stays deterministic (saveRelay stamps savedAt)');
  const t0 = Date.now(), fresh = collectSave(world, { savedAt: Date.now() });
  assert.ok(Number.isFinite(fresh.meta.savedAt) && fresh.meta.savedAt >= t0, 'save writes meta.savedAt when passed');
  assert.equal(collectSave(world, { savedAt: 42 }).meta.savedAt, 42);
  const old = structuredClone(fresh); delete old.meta.savedAt;
  assert.doesNotThrow(() => applySave(parseGameSave(stringifyGameSave(old)), assets, {}), 'old save without savedAt loads');
  const bad2 = structuredClone(fresh); bad2.meta.savedAt = 'x'; assert.throws(() => stringifyGameSave(bad2));
}

// OB-079: transient questMark_* entities (scale 0.05 mid-pop) are not saved, and old saves holding them still load; player vitals survive
{
  const w2=World.load({name:'save_fixture2',terrain:null,structures:[],entities:[]},assets,{});
  w2.spawn('unit',{x:1,y:2,z:0,yawDeg:0,pitchDeg:0},{health:{hp:17,max:30,invuln:0}},'player');
  w2.spawn('prop',{x:3,y:3,z:0,yawDeg:0,scale:0.05},{voxel:{model:'questMark',anim:'idle',loop:true,hidden:false}},'questMark_0');
  const s2=collectSave(w2,{});
  assert.ok(!s2.world.entities.some(e=>/^questMark/.test(e.id)),'marker not persisted');
  const old=structuredClone(s2);old.world.entities.push({id:'questMark_0',kind:'prop',transform:{x:3,y:3,z:0,yawDeg:0,scale:0.05},components:{voxel:{model:'questMark',anim:'idle',loop:true,hidden:false}}});
  const r2=applySave(old,assets,{});
  assert.equal(r2.world.get('player').data.components.health.hp,17,'hp restored on Continue');
  assert.ok(!r2.world.get('questMark_0'));
}

// Browser finding (verify-continue): swim.js leaves body.waterZ/waterFloorZ = NaN ("no water") on every body -> save threw 'expected finite JSON data'.
{
  const w=World.load({name:'nowater',terrain:null,structures:[],entities:[]},assets,{});
  const p=w.spawn('unit',{x:1,y:2,z:0,yawDeg:0,pitchDeg:0},{health:{hp:3,max:5,invuln:0}},'player');
  p.data.components.body={waterZ:NaN,waterFloorZ:NaN,swimming:false};
  const s=collectSave(w,{});
  assert.doesNotThrow(()=>stringifyGameSave(s),'NaN water feed must not break save');
  assert.ok(!('waterZ' in (s.world.entities.find(e=>e.id==='player').components.body||{})),'NaN water feed dropped');
  assert.ok(Number.isNaN(p.data.components.body.waterZ),'live body untouched');
}
