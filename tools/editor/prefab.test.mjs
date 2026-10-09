import assert from 'node:assert/strict';
import { makeFrame, prefabFromJSON, placePrefabItems, loadContentPack, stringifyContent } from '../../engine/index.js';
import { selectionToPrefab, prefabPlacement, prefabSlug } from './prefab.js';
import { addPrefabFile, appendPrefabManifest, toFileObject, savePrefabFile } from './io.js';
import { createDoc, itemToWorld } from './doc.js';
import { applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { validateContent } from '../validate-content.mjs';
const frame=makeFrame(10,20,2,1), structure={id:'tower', frame, level:{name:'tower'}};
const level={kind:'level',id:'tower',def:{props:[{id:'a',model:'crate',x:1,y:2,z:3,facing:10,group:'old',colliders:[{r:1}]},{id:'b',model:'crate',x:3,y:2,z:3}],lights:[{id:'l',x:2,y:2,z:4,preset:'lantern',flameProp:'a'}]},meta:{schema:1,nextId:1},dirty:false};
const worldFile={kind:'world',id:'fixture',def:{entities:[]},meta:{schema:1,nextId:1},dirty:false};
const doc={worldId:'fixture',files:new Map([['level/tower',level],['world/fixture',worldFile]])};
const world={frameOf:()=>frame,structureAt:()=>structure,sectorAt:()=>({})};
const assets={has:(kind,key)=>kind==='model' && key==='crate',palette:{lights:{lantern:{}}}};
const picks=['a','b'].map(id=>({fileId:'level/tower',collection:'props',id,structId:'tower'}));
picks.push({fileId:'level/tower',collection:'lights',id:'l',structId:'tower'});
const before=JSON.stringify(level.def), obj=selectionToPrefab(doc,world,picks,'Crate corner');
assert.equal(prefabSlug('12 / Crates'),'prefab_12_crates'); assert.equal(obj.id,'crate_corner');
assert.equal(obj.items[0].facing,100); assert.equal('group' in obj.items[0],false); assert.equal('flameProp' in obj.items[2],false);
assert.deepEqual(obj.items[0].colliders,[{r:1}]); assert.equal(JSON.stringify(level.def),before);
assert.ok(obj.items.every(it=>typeof it.id==='string'));
const frozen=prefabFromJSON(obj), pivot={x:8,y:22,z:5,yawDeg:0};
for(const [i,stamp] of placePrefabItems(frozen,pivot).entries()) {
 const source=i<2?level.def.props[i]:level.def.lights[0], expected=itemToWorld(frame,source.x,source.y,source.z);
 for(const k of ['x','y','z']) assert.ok(Math.abs(stamp.item[k]-expected[k])<1e-9);
}
const a=prefabPlacement(doc,world,assets,frozen,{x:10,y:5,z:2,yawDeg:90});
assert.equal(a.errors.length,0);assert.equal(a.record.batch.length,3); assert.equal(new Set(a.record.batch.map(r=>r.after.group)).size,1);
applyEdit(doc,a.record);const stack=createStack();stack.push(a.record);assert.equal(stack.size,1);
const b=prefabPlacement(doc,world,assets,frozen,{x:15,y:5,z:2,yawDeg:90});applyEdit(doc,b.record);stack.push(b.record);
assert.notEqual(a.record.batch[0].after.group,b.record.batch[0].after.group);
assert.equal(new Set([...a.record.batch,...b.record.batch].map(r=>r.after.id)).size,6);
const placed=level.def.props.find(p=>p.id===a.record.batch[0].after.id);
const expected=placePrefabItems(frozen,{x:10,y:5,z:2,yawDeg:90})[0].item;
const wp=itemToWorld(frame,placed.x,placed.y,placed.z); for(const k of ['x','y','z']) assert.ok(Math.abs(wp[k]-expected[k])<1e-9);
assert.equal(placed.facing,100); // world 190 minus structure 90
applyEdit(doc,invert(stack.undo()));assert.equal(level.def.props.length,4);applyEdit(doc,invert(stack.undo()));assert.equal(JSON.stringify(level.def),before);
const outside={...world,structureAt:()=>null,sectorAt:()=>null};
const partial=prefabPlacement(doc,outside,assets,frozen,{x:100,y:200,z:3,yawDeg:90});assert.equal(partial.record.batch.length,2);assert.match(partial.errors[0],/inside/);
const entity=partial.record.batch[0].after;assert.equal(entity.components.voxel.model,'crate');assert.equal(entity.yawDeg,190);
const no=prefabPlacement(doc,world,{...assets,has:()=>false},frozen,{x:0,y:0,z:0,yawDeg:0});assert.equal(no.record.batch.length,1);assert.equal(no.errors.length,2);
const gap=prefabPlacement(doc,{...world,sectorAt:()=>null},assets,frozen,{x:0,y:0,z:0,yawDeg:0});assert.equal(gap.record,null);assert.equal(gap.errors.length,3);
const pf=addPrefabFile(doc,obj);assert.equal(pf.dirty,true);assert.equal(pf.meta.manifestPending,true);assert.throws(()=>addPrefabFile(doc,obj),/already exists/);
const manifest={kind:'manifest',schema:1,id:'editor',contentVersion:0,files:[]};
const appended=appendPrefabManifest(manifest,obj.id);assert.deepEqual(manifest.files,[]);assert.deepEqual(appendPrefabManifest(appended,obj.id),appended);
const texts={'manifest.json':JSON.stringify(appended),'prefabs/crate_corner.prefab.json':stringifyContent(toFileObject(pf))};
const bundle=await loadContentPack('http://fixture/manifest.json',{fetchText:url=>Promise.resolve(texts[new URL(url).pathname.slice(1)])});
assert.deepEqual(bundle.prefabs.crate_corner,frozen);
const reloaded=createDoc({keys:()=>[]},bundle);assert.equal(reloaded.files.get('prefab/crate_corner').def.items.length,3);
const lint=validateContent({models:{},prefabs:{bad:{items:[{type:'prop',model:'missing'},{type:'light',preset:'missing'}]}}});
assert.ok(lint.errors.some(e=>e.includes('prefabs.bad.items[0].model')));assert.ok(lint.errors.some(e=>e.includes('prefabs.bad.items[1].preset')));
console.log('Prefab selection/save/load, rotated placement, independent groups/IDs, one-step undo and partial refusal PASS');

// Save writes the prefab first and preserves other manifest entries; refusal stays dirty/retryable.
const writes=[], disk={'manifest.json':JSON.stringify({...manifest,files:['levels/tower.level.json']})};
globalThis.window={showDirectoryPicker:async()=>({
 getFileHandle:async key=>({getFile:async()=>({text:async()=>disk[key]}),createWritable:async()=>({write:async text=>{writes.push(key);disk[key]=text;},close:async()=>{}})}),
 getDirectoryHandle:async()=>({getFileHandle:async key=>({createWritable:async()=>({write:async text=>{writes.push(key);disk[key]=text;},close:async()=>{}})})})
})};
await savePrefabFile(pf,manifest);assert.deepEqual(writes,['crate_corner.prefab.json','manifest.json']);assert.deepEqual(JSON.parse(disk['manifest.json']).files,['levels/tower.level.json','prefabs/crate_corner.prefab.json']);assert.equal(pf.dirty,false);assert.equal(pf.meta.manifestPending,false);
pf.dirty=true;pf.meta.manifestPending=true;window.showDirectoryPicker=async()=>{throw new Error('cancelled');};
await assert.rejects(savePrefabFile(pf,manifest),/cancelled/);assert.equal(pf.dirty,true);assert.equal(pf.meta.manifestPending,true);delete globalThis.window;

const entityDoc={worldId:'out',files:new Map([['world/out',{kind:'world',def:{entities:[{id:'w',type:'prop',x:2,y:4,z:1,yawDeg:270,scale:1.5,components:{voxel:{model:'crate'}}}]},meta:{nextId:1}}]])};
const entitySel=[{fileId:'world/out',collection:'entities',id:'w',structId:null}];
const fromWorld=selectionToPrefab(entityDoc,{},entitySel,'World crate');assert.equal(fromWorld.items[0].model,'crate');assert.equal(fromWorld.items[0].scale,1.5);assert.equal(fromWorld.items[0].facing,270);assert.equal('components' in fromWorld.items[0],false);
entityDoc.files.get('world/out').def.entities[0].components.ai={};assert.throws(()=>selectionToPrefab(entityDoc,{},entitySel,'No AI'),/visual props only/);
const missingPreset=prefabFromJSON({kind:'prefab',id:'no_preset',items:[{type:'light',x:0,y:0,z:1}]});
assert.equal(prefabPlacement(doc,world,assets,missingPreset,{x:0,y:0,z:0,yawDeg:0}).record,null);
