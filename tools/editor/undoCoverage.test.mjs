// S8-C-18 / D-049: authored bytes round-trip; minted ids never rewind.
import assert from 'node:assert/strict';
import { createEditLayer, heightDelta, stringifyContent } from '../../engine/index.js';
import { mintId } from './doc.js';
import { toFileObject } from './io.js';
import { makeRecord, makeInsertRecord, makeDeleteRecord, makeFieldEditRecord, makeRenameBatch, applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { clampScale } from './scale.js';
import { createMeshPlacement, prepareMeshEdit } from './meshPlace.js';
import { groupSnapshot, updateGroupTransform, groupTransformRecord, groupFieldRecord, groupDeleteRecord, groupDuplicateRecord } from './groupOps.js';
import { beginStroke, endStroke, applyTerrainSide, isTerrainRecord, terrainEditsText } from './terrainBrush.js';

const fileId='level/room', worldId='world/fixture';
function fixture(cap=50) {
  const file={kind:'level',id:'room',meta:{schema:1,nextId:1},def:{props:[
    {id:'a',model:'crate',x:2,y:3,z:0,facing:0}, {id:'b',model:'crate',x:4,y:3,z:0,facing:90}],
    lights:[{id:'lamp',x:3,y:3,z:2,preset:'lantern',intensity:1}],interactables:[]}};
  const wf={kind:'world',id:'fixture',meta:{schema:1,nextId:1},def:{structures:[],entities:[]}};
  const doc={worldId:'fixture',files:new Map([[fileId,file],[worldId,wf]])};
  const world={frameOf:()=>null,structureAt:()=>null,floorAt:()=>0};
  const assets={has:()=>true,mesh:()=>({bbox:[0,0,0,1,1,1]})};
  const layer=createEditLayer(2,16), terrain={heightAt:(x,y)=>heightDelta(layer,x,y)};
  const ctx={layer,terrain,key:'fixture'}, stack=createStack(cap);
  const items=()=>file.def.props.map(p=>({fileId,collection:'props',id:p.id,structId:null}));
  function bytes() {
    return [...doc.files.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([id,f])=>{
      const envelope=toFileObject(f);delete envelope.nextId;
      return id+'\n'+stringifyContent(envelope);
    }).join('\n')+'\n'+terrainEditsText(layer,'fixture');
  }
  const counters=()=>[file.meta.nextId,wf.meta.nextId];
  let last=counters();
  function monotonic() {const now=counters();for(let i=0;i<now.length;i++)assert.ok(now[i]>=last[i],'nextId must not decrease');last=now;}
  function apply(rec,undo=false) {
    if(isTerrainRecord(rec)) applyTerrainSide(layer,rec,undo ? rec.before : rec.after);
    else applyEdit(doc,undo ? invert(rec) : rec);
    monotonic();
  }
  function commit(rec) {assert.ok(rec,'operation must produce an edit');apply(rec);stack.push(rec);}
  function undo() {const rec=stack.undo();assert.ok(rec);apply(rec,true);}
  function redo() {const rec=stack.redo();assert.ok(rec);apply(rec);}
  return {file,wf,doc,world,assets,ctx,stack,items,bytes,counters,monotonic,commit,undo,redo};
}
const field=(f,label,patch)=>makeFieldEditRecord(label,fileId,'props',f.file.def.props[0],0,patch);
function stroke(f,op='raise',x=4,y=4) {
  const s=beginStroke(f.ctx,{op,radius:3,strength:op==='paint' ? 3 : 0.2,x,y});
  s.dab(x,y);return endStroke(f.ctx,s);
}
const operations=[
  ['place prop',f=>makeInsertRecord(fileId,'props',{id:mintId(f.file,'prop'),model:'crate',x:6,y:3,z:0})],
  ['move',f=>field(f,'move',{x:f.file.def.props[0].x+0.5,y:8})],
  ['delete',f=>makeDeleteRecord(fileId,'props',f.file.def.props.at(-1),f.file.def.props.length-1)],
  ['scale',f=>field(f,'scale',{scale:clampScale(1.37)})],
  ['reset scale',f=>{const before=f.file.def.props[0],after={...before};delete after.scale;return makeRecord('scale',fileId,'props',before.id,0,before,after);},f=>{f.file.def.props[0].scale=2;}],
  ['yaw',f=>field(f,'yaw',{facing:(f.file.def.props[0].facing+90)%360})],
  ['drop',f=>field(f,'drop',{z:0}),f=>{f.file.def.props[0].z=2;}],
  ['light edit',f=>makeFieldEditRecord('light',fileId,'lights',f.file.def.lights[0],0,{intensity:2,x:7})],
  ['rename with reference',f=>makeRenameBatch(fileId,'level','props',f.file.def.props[0],0,'renamed',f.file.def),f=>{f.file.def.interactables=[{id:'use',prop:'a'}];}],
  ['terrain raise',f=>stroke(f)],
  ['terrain paint',f=>stroke(f,'paint')],
  ['group',f=>groupFieldRecord(f.doc,groupSnapshot(f.doc,f.world,f.items()))],
  ['ungroup',f=>groupFieldRecord(f.doc,groupSnapshot(f.doc,f.world,f.items()),true),f=>{for(const p of f.file.def.props)p.group='existing';}],
  ['group move/yaw',f=>groupTransformRecord(updateGroupTransform(groupSnapshot(f.doc,f.world,f.items()),1,-2,0,90))],
  ['group duplicate',f=>groupDuplicateRecord(f.doc,groupSnapshot(f.doc,f.world,f.items())).record],
  ['group delete',f=>groupDeleteRecord(f.doc,groupSnapshot(f.doc,f.world,f.items().reverse()))],
  ['place mesh',f=>{const result=createMeshPlacement(f.wf,'Rock_fixture',{x:10,y:10},{assets:f.assets,world:f.world});assert.deepEqual(result.errors,[]);return makeInsertRecord(worldId,'structures',result.item);}],
  ['move mesh',f=>{const before=f.wf.def.structures[0],result=prepareMeshEdit(before,{origin:{x:12,y:14,z:0}},{assets:f.assets,world:f.world,file:f.wf});assert.deepEqual(result.errors,[]);return makeRecord('move mesh',worldId,'structures',before.id,0,before,result.after);},f=>{f.wf.def.structures=[{id:'rock',mesh:'Rock_fixture',origin:{x:8,y:8,z:0.15},yawDeg:0}];}],
  ['terrain lower',f=>stroke(f,'lower')],
  ['terrain flatten',f=>stroke(f,'flatten'),f=>{stroke(f);}],
  ['terrain smooth',f=>stroke(f,'smooth'),f=>{stroke(f);}],
  ['place light',f=>makeInsertRecord(fileId,'lights',{id:mintId(f.file,'light'),x:6,y:3,z:2,preset:'lantern'})],
  ['place world entity',f=>makeInsertRecord(worldId,'entities',{id:mintId(f.wf,'prop'),type:'prop',model:'crate',x:6,y:3,z:0})],
  ['delete mesh',f=>makeDeleteRecord(worldId,'structures',f.wf.def.structures[0],0),f=>{f.wf.def.structures=[{id:'rock',mesh:'Rock_fixture',origin:{x:8,y:8,z:0.15},yawDeg:0}];}],
];
for(const [name,build,prepare] of operations) {
  const f=fixture();prepare?.(f);const start=f.bytes();
  f.commit(build(f));const end=f.bytes(), minted=f.counters();assert.notEqual(end,start,name+' changes authored bytes');
  f.undo();assert.equal(f.bytes(),start,name+' undo');assert.deepEqual(f.counters(),minted,name+' undo retains counter');
  f.redo();assert.equal(f.bytes(),end,name+' redo');assert.deepEqual(f.counters(),minted,name+' redo retains counter');
  console.log('PASS '+name);
}

function walk(seed) {
  const f=fixture(200), start=f.bytes(), changes=[];let rng=seed>>>0;
  for(let i=0;i<200;i++) {
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    let op=[0,1,2,3,5,7,9,10,11,13,14][rng%11];
    if(op===2 && f.file.def.props.length<=1)op=0;
    const rec=op===9 || op===10 ? stroke(f,op===10 ? 'paint' : 'raise',(i%20)*4,Math.floor(i/20)*4)
      : op===14 ? groupDuplicateRecord(f.doc,groupSnapshot(f.doc,f.world,f.items().slice(0,2))).record : operations[op][1](f);
    f.commit(rec);changes.push(operations[op][0]);
  }
  const end=f.bytes(), minted=f.counters();assert.equal(f.stack.size,200);
  for(let i=0;i<200;i++)f.undo();assert.equal(f.bytes(),start,'200 undos restore authored and terrain bytes');
  assert.deepEqual(f.counters(),minted,'200 undos never rewind minted ids');assert.equal(f.stack.canUndo,false);
  for(let i=0;i<200;i++)f.redo();assert.equal(f.bytes(),end,'200 redos restore final bytes');
  assert.deepEqual(f.counters(),minted);assert.equal(f.stack.canRedo,false);
  f.undo();assert.equal(f.stack.canRedo,true);f.commit(operations[0][1](f));assert.equal(f.stack.canRedo,false,'new edit clears redo');
  assert.ok(f.file.meta.nextId>minted[0],'new placement consumes a fresh id after undo');
  return {end,minted,changes};
}
assert.deepEqual(walk(0xc18),walk(0xc18),'fixed seed repeats identical bytes, counters and commands');
const capped=fixture();for(let i=0;i<60;i++)capped.commit(operations[1][1](capped));assert.equal(capped.stack.size,50,'production default history remains capped at 50');
console.log(`undoCoverage: ${operations.length} command rows, two seeded 200-op undo/redo walks, redo invalidation and monotonic ids PASS`);
