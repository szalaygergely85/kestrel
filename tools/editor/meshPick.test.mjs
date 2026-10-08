import assert from 'node:assert/strict';
import { makeFrame, KIND_MESH, KIND_TERRAIN, KIND_MODEL } from '../../engine/index.js';
import { resolveMeshPick } from './meshPick.js';
import { decodePlaneId } from './ray.js';
import { computeMeshHighlightRect, drawMeshHighlightRect } from './select.js';
import { pickAt } from './pick.js';

assert.deepEqual(decodePlaneId(KIND_MESH,0xA0001234),{type:'mesh'});
assert.deepEqual(decodePlaneId(KIND_MESH,0xD0000001),{type:'cloth'});
assert.deepEqual(decodePlaneId(KIND_TERRAIN,0),{type:'terrain'});
assert.equal(decodePlaneId(KIND_MODEL,0xf3000000).type,'voxel');
const frame=makeFrame(0,0,0,0);
const bbox={x0:-1,x1:1,y0:4,y1:6,z0:0,z1:2};
const tri=y=>Float32Array.from([-1,y,0,1,y,0,0,y,2]);
const front={id:'front',kind:'mesh',frame,bbox,mesh:{pos:tri(5)}};
const back={id:'back',kind:'mesh',frame,bbox,mesh:{pos:tri(5.05)}};
const ray={ox:0,oy:0,oz:1,dx:0,dy:1,dz:0};
assert.equal(resolveMeshPick({structures:[back,front]},ray,5),'front','triangle distance wins over draw order');
assert.equal(resolveMeshPick({structures:[front,back]},ray,5),'front');
const scaled={...front,id:'scaled',scale:2,mesh:{pos:tri(2.5)}};
assert.equal(resolveMeshPick({structures:[back,scaled]},ray,5),'scaled','scaled local triangles preserve world-space ray distance');
assert.equal(resolveMeshPick({structures:[front]},ray,5),'front');
assert.equal(resolveMeshPick({structures:[front]},ray,10),null);
const small={...back,id:'small',bbox:{...bbox,x0:-0.2,x1:0.2},mesh:{pos:tri(8)}};
assert.equal(resolveMeshPick({structures:[front,small]},ray,5.5),'small','no matching render triangle uses smallest candidate bbox');
const moved={...front,id:'moved',frame:makeFrame(20,0,0,0),bbox:{...bbox,x0:19,x1:21}};
assert.equal(resolveMeshPick({structures:[moved]}, {...ray,ox:20},5),'moved');
const camera={x:0,y:10,z:1,yawDeg:0,pitchDeg:0};
const rect=computeMeshHighlightRect(camera,400,150,8,16,bbox);
assert.ok(rect.minCol<rect.maxCol && rect.minRow<rect.maxRow);
let writes=0;
drawMeshHighlightRect({setCell(x,y,g,fg,bg){writes++;assert.equal(bg,'#0a0b10');}},rect,'#ffd24a');
assert.ok(writes>0 && writes<=400);
writes=0;
drawMeshHighlightRect({setCell(){writes++;}}, {minCol:50,maxCol:300,minRow:20,maxRow:130}, '#ffd24a');
assert.equal(writes,12,'large bounds draw bounded corner markers');
assert.equal(computeMeshHighlightRect({...camera,y:-10},400,150,8,16,bbox),null,'behind-camera bounds do not project');

// CPU surface readback routes kind 9 to a mesh placement, never structures[0].
const world={structures:[{id:'tower',kind:'level'},front],forEachEntity(){}};
const cam={x:0,y:0,z:1,yawDeg:180,pitchDeg:0};
const ctx={cam,cols:16,rows:6,pxCellW:8,pxCellH:16,world,assets:{},renderer:'mesh',gpuActive:false,
 fb:{gbuf:{kind:Array(96).fill(KIND_MESH),face:Array(96).fill(0),mat:Array(96).fill(0),planeId:Array(96).fill(0xA0000000)},depth:{depth:Array(96).fill(5)}}};
const picked=pickAt(8,3,ctx);
assert.equal(picked.kind,'meshStructure');assert.equal(picked.structureId,'front');
ctx.fb.gbuf.planeId[56]=0xD0000000;
assert.equal(pickAt(8,3,ctx).structureId,null,'cloth is never decoded as the tower');
console.log('meshPick: overlapping triangles, bbox fallback, kind-9/cloth routing and bounded plated highlights PASS');
