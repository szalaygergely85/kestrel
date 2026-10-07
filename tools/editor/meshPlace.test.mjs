import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, PHYSICS, stringifyContent } from '../../engine/index.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import { createDoc } from './doc.js';
import { toFileObject } from './io.js';
import { applyEdit, invert, makeInsertRecord, makeFieldEditRecord, makeDeleteRecord } from './commands.js';
import { meshClass, LIFT, SHADOW, snapMeshOrigin, validateMeshStructure, validateMeshRename, createMeshPlacement } from './meshPlace.js';

const { assets, bundle } = await loadTestAssets();
const key = 'quaternius/Rock_Medium_1', mesh = assets.mesh(key);
for (const [name, cls] of Object.entries({ CommonTree_1: 'tree', DeadTree_2: 'tree', Rock_Medium_1: 'rock', RockPath_Square: 'rockpath', Pebble_Round: 'pebble', Grass_Tall: 'grass', Mushroom_1: 'mushroom', Fences: 'other' })) {
  assert.equal(meshClass('quaternius/' + name), cls);
}
assert.deepEqual(LIFT, { tree:0.2, rock:0.15, rockpath:-0.02, pebble:-0.01, grass:0, mushroom:0, other:0 });
assert.deepEqual(SHADOW, { tree:true, rock:true, rockpath:false, pebble:false, grass:false, mushroom:false, other:true });
const floor = { structureAt: () => null, sectorAt: () => null, floorAt: (x,y) => 2*x-y };
const e = 0.25*Math.max(mesh.bbox[3]-mesh.bbox[0],mesh.bbox[4]-mesh.bbox[1]);
assert.deepEqual(snapMeshOrigin(floor, mesh, key, 1.234, 4.567), { x:1.23, y:4.57, z:+(2*1.23-4.57+2*e+0.15).toFixed(2) });
assert.equal(snapMeshOrigin({ ...floor, floorAt: () => null }, mesh, key, 1, 2), null);
assert.equal(snapMeshOrigin({ ...floor, structureAt: () => ({}), sectorAt: () => null }, mesh, key, 1, 2), null);
assert.equal(snapMeshOrigin({ ...floor, floorAt: x => x>1 ? null : 0 }, mesh, key, 1, 2), null, 'footprint edge with no floor is refused');
const doc = createDoc(assets, bundle), fileId = 'world/world_m1', file = doc.files.get(fileId);
const original = readFileSync(new URL('../../content/worlds/world_m1.world.json', import.meta.url), 'utf8');
assert.equal(stringifyContent(toFileObject(file)), original, 'unedited real world saves byte-identically');
const before = structuredClone(file.def.structures), initialNext = file.meta.nextId;
const invalid = createMeshPlacement(file, 'missing', {x:0,y:0}, {assets,world:floor});
assert.ok(invalid.errors.length); assert.equal(file.meta.nextId, initialNext);
assert.ok(createMeshPlacement(file,key,{x:NaN,y:0},{assets,world:floor}).errors.length);
assert.equal(file.meta.nextId,initialNext, 'invalid placement never mints');
const result = createMeshPlacement(file,key,{x:200.14,y:300.14,z:999},{assets,world:{...floor,floorAt:()=>0},yawDeg:-192,snapStep:0.25});
assert.deepEqual(result.item, {id:`mesh_${initialNext}`,mesh:key,origin:{x:200.25,y:300.25,z:0.15},yawDeg:168});
assert.equal(file.meta.nextId, initialNext+1);
assert.deepEqual(result.errors,[]);
const inserted = makeInsertRecord(fileId,'structures',result.item);
applyEdit(doc,inserted);
const saved = stringifyContent(toFileObject(file));
assert.equal(saved.split('\n').length, original.split('\n').length+1);
assert.deepEqual(JSON.parse(saved).structures.at(-1),result.item);
assert.equal(JSON.parse(saved).nextId,initialNext+1);
applyEdit(doc,invert(inserted));
assert.deepEqual(file.def.structures,before);
assert.equal(file.meta.nextId,initialNext+1,'undo never reuses ids');
applyEdit(doc,inserted);
let item=file.def.structures.at(-1), index=file.def.structures.length-1;
const move=makeFieldEditRecord('move',fileId,'structures',item,index,{origin:{x:220.25,y:300.25,z:0.15}});
applyEdit(doc,move); applyEdit(doc,invert(move)); assert.deepEqual(file.def.structures[index],result.item); applyEdit(doc,move);
item=file.def.structures[index];
const yaw=makeFieldEditRecord('yaw',fileId,'structures',item,index,{yawDeg:90});
applyEdit(doc,yaw); applyEdit(doc,invert(yaw)); assert.equal(file.def.structures[index].yawDeg,168); applyEdit(doc,yaw);
const del=makeDeleteRecord(fileId,'structures',file.def.structures[index],index);
applyEdit(doc,del); assert.deepEqual(file.def.structures,before); applyEdit(doc,invert(del));
assert.equal(file.def.structures[index].yawDeg,90);

const ctx={assets,siblingIds:new Set(),nextId:file.meta.nextId}, valid=file.def.structures[index];
assert.deepEqual(validateMeshStructure(valid,ctx),[]);
for(const patch of [{id:'1bad'},{id:'mesh_999999'},{mesh:'missing'},{origin:{x:0,y:0,z:NaN}},{yawDeg:360},{yawDeg:0.5},{castShadow:'false'},{collide:0},{scale:1},{level:'tower'},{yawSteps:0},{dynamics:{}},{origin:{x:0,y:0,z:0,w:1}}]) assert.ok(validateMeshStructure({...valid,...patch},ctx).length,JSON.stringify(patch));
assert.ok(validateMeshStructure(valid,{...ctx,siblingIds:new Set([valid.id])}).length);
assert.ok(validateMeshRename('hand_123').length); assert.deepEqual(validateMeshRename('roadS00'),[]);
const clashFile={def:{structures:[{id:'mesh_1'}]},meta:{nextId:1}};
assert.equal(createMeshPlacement(clashFile,key,{x:0,y:0},{assets,world:floor}).item.id,'mesh_2');
const pebble=createMeshPlacement(clashFile,'quaternius/Pebble_Round_1',{x:0,y:0},{assets,world:floor}).item;
assert.equal(pebble.castShadow,false); assert.equal('collide' in pebble,false,'mesh collider default remains inherited');
const crowded={def:{structures:Array.from({length:60},(_,i)=>({id:`road${i}`,mesh:key,origin:{x:0,y:0,z:0}}))},meta:{nextId:1}};
assert.equal(createMeshPlacement(crowded,key,{x:0,y:0},{assets,world:floor}).warnings.length,1);

// Fresh loads rebuild the merged collider from committed placement data.
const worldFor = placement => World.load({terrain:null,structures:[placement],entities:[]}, assets, {physics:'mesh'});
const oldWorld=worldFor(result.item), newWorld=worldFor(valid);
assert.deepEqual(newWorld.colliders.find(c=>c.id==='meshes:static').parts.map(p=>p.id),[valid.id]);
const options={height:PHYSICS.height,stepUpMax:PHYSICS.stepUpMax,walkCos:Math.cos(PHYSICS.maxSlopeDeg*Math.PI/180)};
const query=(world,x,y)=>world.collideCircle(x,y,0,0,0.3,0.25,true,options,{});
let newHits=0, oldHits=0;
for(let dx=-1.5;dx<=1.5;dx+=0.15) for(let dy=-1.5;dy<=1.5;dy+=0.15) {
  for(const [which,world,origin] of [['new',newWorld,valid.origin],['old',oldWorld,result.item.origin]]) {
    const x=origin.x+dx,y=origin.y+dy, hit=query(world,x,y);
    if(Math.hypot(hit.x-x,hit.y-y)>1e-6) {if(which==='new')newHits++;else oldHits++;}
  }
  const x=result.item.origin.x+dx,y=result.item.origin.y+dy, free=query(newWorld,x,y);
  assert.ok(Math.hypot(free.x-x,free.y-y)<1e-9,'moved mesh no longer blocks the old footprint');
}
assert.ok(newHits>10 && oldHits>10, `actual rock collision: old ${oldHits}, new ${newHits}`);
console.log('meshPlace: class/snap/validation/mint, real-world commands and canonical round-trip, moved-rock collider reload PASS');
