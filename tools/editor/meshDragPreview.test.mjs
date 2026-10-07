import assert from 'node:assert/strict';
import { World } from '../../engine/index.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import { beginMeshDragPreview, updateMeshDragPreview, cancelMeshDragPreview } from './meshDragPreview.js';

const {assets} = await loadTestAssets();
const item = {id:'rock',mesh:'quaternius/Rock_Medium_1',origin:{x:200,y:300,z:0.15},yawDeg:37};
const def = {terrain:null,structures:[item],entities:[]};
const world = World.load(def,assets,{physics:'mesh'}), s=world.structures[0];
const original = JSON.stringify(def), collider = world.colliders.find(c=>c.id==='meshes:static');
const before={origin:{...s.origin},frame:{...s.frame},bbox:{...s.bbox}};
const preview=beginMeshDragPreview(world,'rock'), version=world.renderVersion, structureVersion=world.structVersion;
assert.equal(beginMeshDragPreview(world,'missing'),null);
assert.equal(updateMeshDragPreview(world,preview,{x:NaN,y:0,z:0}),false);
assert.equal(world.renderVersion,version);

const next={x:205.25,y:297.5,z:1.25};
assert.equal(updateMeshDragPreview(world,preview,next),true);
const fresh=World.load({...def,structures:[{...item,origin:next}]},assets,{physics:'mesh'}).structures[0];
for(const axis of ['x','y','z']) assert.equal(s.frame[axis],fresh.frame[axis]);
for(const field of ['x0','x1','y0','y1','z0','z1']) assert.ok(Math.abs(s.bbox[field]-fresh.bbox[field])<1e-9,field);
assert.equal(s.frame.yawDeg,before.frame.yawDeg);
assert.equal(world.renderVersion,version+1);
assert.equal(world.structVersion,structureVersion);
assert.equal(world.colliders.find(c=>c.id==='meshes:static'),collider,'no preview BVH rebuild');
assert.equal(JSON.stringify(def),original,'content stays unchanged until release');

// Repeated previews derive bounds from the snapshot, never accumulating rounding drift.
for(let i=0;i<1000;i++) updateMeshDragPreview(world,preview,{x:200+i*.001,y:300-i*.001,z:.15+i*.001});
cancelMeshDragPreview(world,preview);
assert.deepEqual(s.origin,before.origin);
assert.deepEqual(s.frame,before.frame);
assert.deepEqual(s.bbox,before.bbox);
assert.equal(JSON.stringify(def),original);
const restoredVersion=world.renderVersion;
cancelMeshDragPreview(world,preview);
assert.equal(world.renderVersion,restoredVersion,'cancel/no-op does not dirty another frame');
world.structures=[];
assert.equal(updateMeshDragPreview(world,preview,next),false,'stale runtime snapshot is refused');
console.log('meshDragPreview: visible runtime pose, rotated fresh-load bounds, cancel, no doc/BVH edits PASS');
