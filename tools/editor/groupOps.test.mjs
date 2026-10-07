import assert from 'node:assert/strict';
import { makeFrame } from '../../engine/index.js';
import { itemToWorld } from './doc.js';
import { applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { isPatchableRecord, applyPropTransformPatch, applyLightPatch } from './livepatch.js';
import { groupSnapshot, updateGroupTransform, groupTransformRecord, groupFieldRecord, groupedItems, groupDeleteRecord, groupDuplicateRecord } from './groupOps.js';

const file=(kind,def)=>({kind,def,meta:{nextId:1},dirty:false});
const level=file('level',{props:[{id:'a',model:'crate',x:1,y:2,z:3,facing:10},{id:'b',model:'crate',x:3,y:2,z:3}],lights:[{id:'l',x:2,y:2,z:4,preset:'lantern'}]});
const worldFile=file('world',{entities:[{id:'w',type:'prop',model:'crate',x:7,y:8,z:1,yawDeg:270}]});
const doc={worldId:'fixture',files:new Map([['level/tower',level],['world/fixture',worldFile]])};
const frame=makeFrame(10,20,2,1), world={frameOf:()=>frame};
const item=(collection,id)=>({fileId:'level/tower',collection,id,structId:'tower'});
const items=[item('props','a'),item('lights','l'),{fileId:'world/fixture',collection:'entities',id:'w',structId:null}];
const defs=()=>JSON.stringify([...doc.files.values()].map(f=>f.def));
const start=defs();
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const snapshot=groupSnapshot(doc,world,items);
assert.equal(defs(),start);
updateGroupTransform(snapshot,2,-3,1);
const move=groupTransformRecord(snapshot);
assert.equal(move.batch.length,3);assert.equal(isPatchableRecord(move),true);
applyEdit(doc,move);
const moved=groupSnapshot(doc,world,items);
for(let i=0;i<3;i++) {close(moved.members[i].point.x,snapshot.members[i].point.x+2);close(moved.members[i].point.y,snapshot.members[i].point.y-3);close(moved.members[i].point.z,snapshot.members[i].point.z+1);}
const stack=createStack();stack.push(move);assert.equal(stack.size,1);applyEdit(doc,invert(stack.undo()));assert.equal(defs(),start);
for(let i=0;i<4;i++) {const s=groupSnapshot(doc,world,items);updateGroupTransform(s,0,0,0,90);const r=groupTransformRecord(s);assert.ok(isPatchableRecord(r));applyEdit(doc,r);}
const rotated=groupSnapshot(doc,world,items);
for(let i=0;i<3;i++) {close(rotated.members[i].point.x,snapshot.members[i].point.x);close(rotated.members[i].point.y,snapshot.members[i].point.y);}
close(level.def.props[0].facing,10);close(worldFile.def.entities[0].yawDeg,270);
// A snapshot's reused storage stays stable through repeated previews and exact return.
const s=groupSnapshot(doc,world,items), before=defs(), afterIdentity=s.members[0].after, localIdentity=s.local;
for(let i=0;i<1000;i++) updateGroupTransform(s,1.25,-2.5,0,45);
assert.equal(s.members[0].after,afterIdentity);assert.equal(s.local,localIdentity);assert.equal(defs(),before);
updateGroupTransform(s,0,0); // Exact quarter-turn structure conversion; existing yaw restored.
assert.equal(groupTransformRecord(s),null);
const absentYaw=groupSnapshot(doc,world,[item('props','b')]);
updateGroupTransform(absentYaw,0,0,0,45);assert.equal(absentYaw.members[0].after.yawDeg,45);
updateGroupTransform(absentYaw,0,0);assert.equal('yawDeg' in absentYaw.members[0].after,false);
assert.throws(()=>groupFieldRecord(doc,s),/one file/);
assert.throws(()=>groupSnapshot(doc,world,[items[0],{...items[0],structId:'tower2'}]),/share the same/);
assert.throws(()=>groupSnapshot(doc,world,[]),/nothing/);
assert.throws(()=>updateGroupTransform(s,NaN,0),/invalid/);

const levelItems=[item('props','a'),item('props','b'),item('lights','l')];
const gs=groupSnapshot(doc,world,levelItems), gr=groupFieldRecord(doc,gs);
applyEdit(doc,gr);assert.equal(groupedItems(doc,levelItems[0]).length,3);
const group=level.def.props[0].group;
assert.ok(group.startsWith('group_'));assert.equal(level.def.lights[0].group,group);
const grouped=defs();const clear=groupFieldRecord(doc,groupSnapshot(doc,world,levelItems),true);
applyEdit(doc,clear);assert.equal(groupedItems(doc,levelItems[0]).length,1);applyEdit(doc,invert(clear));assert.equal(defs(),grouped);
const dup=groupDuplicateRecord(doc,groupSnapshot(doc,world,levelItems));
assert.equal(new Set(dup.selection.items.map(i=>i.id)).size,3);
assert.equal(dup.record.batch[0].after.group,dup.record.batch[2].after.group);
assert.notEqual(dup.record.batch[0].after.group,group);
applyEdit(doc,dup.record);const copies=groupSnapshot(doc,world,dup.selection.items);
for(let i=0;i<3;i++) {close(copies.members[i].point.x,gs.members[i].point.x+1);close(copies.members[i].point.y,gs.members[i].point.y);}
applyEdit(doc,invert(dup.record));assert.equal(defs(),grouped);
// Disordered selection deletes atomically and reinserts at ascending original indices.
const del=groupDeleteRecord(doc,groupSnapshot(doc,world,[levelItems[1],levelItems[0],levelItems[2],items[2]]));
applyEdit(doc,del);assert.equal(level.def.props.length,0);assert.equal(worldFile.def.entities.length,0);applyEdit(doc,invert(del));assert.equal(defs(),grouped);
level.def.interactables=[{id:'use',prop:'a'}];const referenced=defs();
assert.throws(()=>groupDeleteRecord(doc,groupSnapshot(doc,world,levelItems)),/referenced/);assert.equal(defs(),referenced);
delete level.def.interactables;
applyEdit(doc,invert(gr));

level.def.props[0].z='ground';
const groundWorld={...world,entity:()=>({transform:{z:7.5}})}, grounded=groupSnapshot(doc,groundWorld,[levelItems[0],levelItems[1]]);
assert.throws(()=>updateGroupTransform(grounded,0,0,1),/numeric z/);
updateGroupTransform(grounded,1,0);assert.equal(grounded.members[0].after.z,'ground');
const scratch={x:0,y:0,z:0}, t={x:0,y:0,z:7.5,yawDeg:0};
applyPropTransformPatch(t,grounded.members[0].after,frame,scratch);assert.equal(t.z,7.5);
let params=0, pos;
applyLightPatch({move:(...p)=>pos=p,setParams:()=>params++},0,level.def.lights[0],frame,null,scratch,true);
assert.equal(params,0);assert.equal(pos.length,4);
assert.equal(isPatchableRecord({batch:[]}),false);
assert.equal(isPatchableRecord({batch:[move,del]}),false);
assert.equal(isPatchableRecord(gr),false);
console.log('groupOps: mixed-frame move/rotate/undo, duplicate, atomic delete, persistent groups and preview storage PASS');
