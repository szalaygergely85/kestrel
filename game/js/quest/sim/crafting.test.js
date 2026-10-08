import assert from 'node:assert/strict';
import {World,AssetRegistry} from '../../../../engine/index.js';
import {ensureInventory,countOf,SLOTS} from './inventory.js';
import {createCrafting} from './crafting.js';
import {collectSave,applySave,stringifyGameSave,parseGameSave} from '../save/saveState.js';

// Fixture-only recipes/items: no approved game economy is implied.
const items={fiber:{stackMax:5},wood:{stackMax:5},tool:{stackMax:1},bulk:{stackMax:99},coin:{stackMax:99,pending:'owner'},orb:{stackMax:0}};
const recipes=[{id:'tool.make',inputs:[{item:'fiber',n:2},{item:'wood',n:1}],output:{item:'tool',n:1}},
  {id:'tool.two',inputs:[{item:'fiber',n:1}],output:{item:'tool',n:2}},
  {id:'fiber.repack',inputs:[{item:'fiber',n:2}],output:{item:'fiber',n:3}}];
const crafting=createCrafting(recipes,{items});
const pack=rows=>ensureInventory({components:{}},{pack:rows,left:null,right:null});
const inv=pack([{id:'fiber',n:2}]), before=JSON.stringify(inv);
assert.equal(crafting.canCraft(inv,'tool.make'),false);assert.equal(JSON.stringify(inv),before);
assert.deepEqual(crafting.craft(inv,'tool.make'),{ok:false,reason:'missing-inputs'});assert.equal(JSON.stringify(inv),before,'partial input is not consumed');
assert.deepEqual(crafting.craft(inv,'missing'),{ok:false,reason:'unknown-recipe'});assert.equal(JSON.stringify(inv),before);
inv.slots[1]={id:'wood',n:2};inv.left='fiber';inv.right='wood';
const slots=inv.slots,firstSlot=inv.slots[0], fullBefore=JSON.stringify(inv);
assert.equal(crafting.canCraft(inv,'tool.make'),true);assert.equal(JSON.stringify(inv),fullBefore,'query never mutates');
const success=crafting.craft(inv,'tool.make');assert.deepEqual(success,{ok:true,reason:null});assert.ok(Object.isFrozen(success));
assert.equal(countOf(inv,'fiber'),0);assert.equal(countOf(inv,'wood'),1);assert.equal(countOf(inv,'tool'),1);
assert.equal(inv.left,null);assert.equal(inv.right,'wood');assert.equal(inv.slots,slots);assert.equal(inv.slots[0],firstSlot,'slot identities retained');
assert.equal(crafting.canCraft(inv,'tool.make'),false,'repeated craft requires new inputs');

// Capacity is measured after consuming ingredients; partial output grants must roll back.
const full=pack(Array.from({length:SLOTS},()=>({id:'bulk',n:99})));full.slots[0]={id:'fiber',n:2};
const fullText=JSON.stringify(full);assert.equal(crafting.canCraft(full,'tool.two'),false);
const refused=crafting.craft(full,'tool.two');assert.deepEqual(refused,{ok:false,reason:'output-full'});assert.equal(JSON.stringify(full),fullText);
full.slots[0].n=1;const stillFull=JSON.stringify(full);assert.equal(crafting.canCraft(full,'tool.two'),false);
assert.equal(crafting.craft(full,'tool.two'),refused);assert.equal(JSON.stringify(full),stillFull,'one freed slot cannot fit two nonstacking outputs');
full.slots[1]={id:null,n:0};assert.equal(crafting.canCraft(full,'tool.two'),true);assert.equal(crafting.craft(full,'tool.two'),success);assert.equal(countOf(full,'tool'),2);
const repack=pack([{id:'fiber',n:2}]);assert.equal(crafting.craft(repack,'fiber.repack').ok,true);assert.equal(countOf(repack,'fiber'),3);
const split=pack([{id:'fiber',n:1},{id:'fiber',n:1},{id:'wood',n:1}]);assert.equal(crafting.craft(split,'tool.make').ok,true);assert.equal(countOf(split,'tool'),1);

const config=structuredClone(recipes),defs=structuredClone(items), copied=createCrafting(config,{items:defs});
config[0].inputs[0].n=99;config[0].output.n=99;defs.tool.stackMax=99;
assert.equal(copied.craft(pack([{id:'fiber',n:2},{id:'wood',n:1}]),'tool.make').ok,true,'configuration copied');
for(const bad of [[],[{item:'fiber',n:0}],[{item:'unknown',n:1}],[{item:'coin',n:1}],[{item:'orb',n:1}],
  [{item:'fiber',n:1},{item:'fiber',n:1}],[{item:'fiber',n:1.5}],[{item:'fiber',n:Number.MAX_SAFE_INTEGER+1}]]) {
  assert.throws(()=>createCrafting([{id:'bad',inputs:bad,output:{item:'tool',n:1}}],{items}));
}
assert.throws(()=>createCrafting([recipes[0],recipes[0]],{items}),/duplicate/);
assert.throws(()=>createCrafting([{...recipes[0],output:{item:'coin',n:1}}],{items}),/pending/);
assert.throws(()=>createCrafting([{...recipes[0],id:'__proto__'}],{items}),/invalid/);
assert.throws(()=>crafting.craft({slots:[]},'tool.make'),/inventory/);
const invalid=pack([]);invalid.slots[23].n=-1;const invalidBefore=JSON.stringify(invalid);
assert.throws(()=>crafting.craft(invalid,'tool.make'),/slot/);assert.equal(JSON.stringify(invalid),invalidBefore);

// Uses the actual save layer: crafting adds no persisted state.
const assets=new AssetRegistry({palette:{}}),world=World.load({name:'craft_fixture',terrain:null,structures:[],entities:[]},assets,{});
const player=world.spawn('unit',{x:0,y:0,z:0,yawDeg:0},{health:{hp:3,max:3}},'player');
const savedInv=ensureInventory(player.data,{pack:[{id:'fiber',n:2},{id:'wood',n:1}],left:'fiber',right:'wood'});
assert.equal(crafting.craft(savedInv,'tool.make').ok,true);
const text=stringifyGameSave(collectSave(world)),restored=applySave(parseGameSave(text),assets);
assert.equal(stringifyGameSave(collectSave(restored.world)),text,'byte-stable actual save round trip');
assert.equal(countOf(restored.world.get('player').data.components.inventory,'tool'),1);
function replay(){const r=pack([{id:'fiber',n:5},{id:'wood',n:5}]),trace=[];for(let i=0;i<600;i++) {
  const id=i%3===0 ? 'fiber.repack' : 'tool.make';trace.push([crafting.canCraft(r,id),crafting.craft(r,id).reason,JSON.stringify(r)]);
}return trace;}
assert.deepEqual(replay(),replay(),'600-step same-input sequence is deterministic across reused scratch');
const queryPack=pack([{id:'fiber',n:2},{id:'wood',n:1}]);const queryBefore=JSON.stringify(queryPack);
for(let i=0;i<1000;i++)crafting.canCraft(queryPack,'tool.make');assert.equal(JSON.stringify(queryPack),queryBefore);
console.log('crafting: atomic ingredients/output capacity, freed slots, existing hand rules/identities, copied validation, actual save and deterministic 600-step replay PASS');
