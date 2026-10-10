import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World, PHYSICS_DEFAULTS as P, integrate, serialize, deserialize, updateInteraction } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/title.js';
import '../design/models/lantern.js';
import '../design/models/brazier.js';
import '../design/models/lever.js';
import '../design/models/boulder.js';
import '../design/models/rubble.js';
import '../design/models/wreckage.js';
import '../design/models/relay.js';
import '../design/models/voxel_props.js';
import '../design/models/voxel_tower.js';
import '../design/models/voxel_world.js';
import '../design/models/sword.js';
import '../design/models/m3_props.js';
import '../design/models/far_tower.js';
import '../design/models/ferrum_lights.js';
import '../design/levels/overworld_far.js';

// PROP-COLLIDE-01b: real tower shapes and its wake -> burner -> stair corridor, mesh physics only.
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const { assets } = await loadTestAssets();
registerQuestBehaviours();
const def = assets.world('world_m1'), level = assets.level('tower');
const w = World.load(def, assets, { physics: 'mesh' });
const structure = w.structures.find(s => s.id === 'tower'), O = structure.origin;
const c = w.colliders.find(c => c.id === 'props:static');
ok(c && w.colliders.filter(c => c.id === 'props:static').length === 1, 'one static prop collider');
ok(c.bvh.triCount === 176 + 4 * 32, 'CH1-07: the bear prism moved to npcs:kinematic; 11 piece boxes, gondola box, practice-post prism, 4 wall-lamp prisms (BUG-LAMP-COLLIDE; the hanging lamp is decor since CH1-D1a) ; the doorBar box is gone (TOWER-DOOR-OPEN-01)');
ok(w.colliders.some(k => k.id === 'npcs:kinematic'), 'CH1-07/CH1-08a: kinematic NPC collider (bear, fen) exists');
const hashes = {
  gondola: 'bd66286192399a8c8ebf35ae625edd1f526e3c22d96fa8ce111468ff54134ce3', // owner 2026-10-06: basket back to its original wood/brass mats (cloth meant the balloon fabric),
  practiceTarget: '6a3445c8d7e10cc909dbded9c59d4a44df2e105d72d60643497810a7ce782bda', // HIT-BLEED-01 (owner): flash pose no longer a white shell (only change; old hash reproduces from m3_props.js before 89b67be8)
  awakeningCrates: '7eea5da1f03198c64defd00e024e923c1803dd50afd700a430cb7eb66ea9cb1b',
  awakeningKeeper: 'b11f68628facfc4aa2026e561462920a42c10662d4914e3bb461f8ebacb501e1',
};
for (const [key, hash] of Object.entries(hashes)) {
  ok(createHash('sha256').update(JSON.stringify(assets.model(key).voxel)).digest('hex') === hash, key + ' geometry/material/pose unchanged');
}
const crate = assets.model('awakeningCrates'), keeper = assets.model('awakeningKeeper');
ok(crate.colliders.length === 5 && keeper.colliders.length === 6, 'one box per tall piece');
// Independent expected voxel bounds in world-authored metres: exclusive upper edge of each occupied voxel.
const bounds = [
  ['awakeningCrates', [[17.36,5,0,17.96,5.56,.52], [17.44,5.04,.52,17.92,5.44,.88], [17,5.04,0,17.32,5.4,.32],
    [14.12,7.32,0,14.68,7.88,.76], [14.68,7.28,0,15,7.6,.16]]],
  ['awakeningKeeper', [[18.04,5.08,0,18.44,5.48,.44], [18.36,5.32,0,18.64,5.68,.2], [19.32,5.16,0,19.88,5.68,.8],
    [19.04,5.68,0,19.32,5.92,.4], [19.72,5.76,0,20,6,1.08], [18.36,9,0,18.84,9.32,.44]]],
];
for (const [key, boxes] of bounds) {
  const model = assets.model(key), p = level.props.find(p => p.model === key);
  model.colliders.forEach((box, i) => {
    const actual = box.c.map((v,k) => v - box.half[k] + [p.x,p.y,p.z][k])
      .concat(box.c.map((v,k) => v + box.half[k] + [p.x,p.y,p.z][k]));
    ok(actual.every((v,k) => Math.abs(v-boxes[i][k]) < 1e-9), key + ' piece ' + i + ' exact voxel bounds');
    ok(box.half[2]*2 > .12, key + ' skips low pieces');
  });
}
// Independently turn every occupied gondola voxel corner by its authored idle tilt.
const gondola = level.props.find(p => p.id === 'gondola'), gv = assets.model('gondola').voxel;
const gc = gondola.colliders[0], lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
const tilt = gv.animations.idle.frames[0].bow, pivot = gv.parts.bow.pivot;
const co = Math.cos(tilt.rot[0]*Math.PI/180), si = Math.sin(tilt.rot[0]*Math.PI/180);
for(let z=0;z<gv.size[2];z++) for(let y=0;y<gv.size[1];y++) for(let x=0;x<gv.size[0];x++) {
  if(gv.layers[z][y][x] === '.') continue;
  for(let dz=0;dz<=1;dz++) for(let dy=0;dy<=1;dy++) for(let dx=0;dx<=1;dx++) {
    const yy = y+dy-pivot[1], zz = z+dz-pivot[2];
    const v = [x+dx, z === 0 ? y+dy : pivot[1]+co*yy-si*zz,
      z === 0 ? z+dz : pivot[2]+si*yy+co*zz+tilt.pos[2]];
    v.forEach((n,k) => { const m = (n-gv.anchor[k])*gv.cellM; lo[k]=Math.min(lo[k],m); hi[k]=Math.max(hi[k],m); });
  }
}
ok(lo.every((n,k) => Math.abs(n-(gc.c[k]-gc.half[k]))<1e-9)
  && hi.every((n,k) => Math.abs(n-(gc.c[k]+gc.half[k]))<1e-9), 'gondola box exactly encloses its occupied posed voxel corners');
const lamp = assets.model('floorLantern'), lp = lamp.colliders[0];
ok(lp.type === 'prism' && lp.r*2 === lamp.world.w && lp.h === lamp.world.h && lp.c[2] === lp.h/2, 'lamp uses authored sprite dimensions');
const target = level.props.find(p => p.id === 'practiceTarget').colliders[0];
ok(target.r === assets.model('practiceTarget').target.collider.r && target.h === assets.model('practiceTarget').target.collider.h, 'practice post uses designer collider note');
for (const p of level.props.filter(p => p.colliders?.length || (assets.has('model',p.model) && assets.model(p.model).colliders?.length))) {
  ok(!p.dynamic && (!p.interactable || p.id === 'doorBar'), p.id + ' remains static and never picked up (only the doorBar prop is an interactable, a variant swap: the interact ray is sector-LOS, never collider-based)');
}
// Floor lanterns are spare content; PC-A replaced the production placements with wall lanterns.
// Keep the static sprite model-default and explicit [] coverage on a synthetic placement.
const syntheticLamp = { id: 'floorLanternFixture', model: 'floorLantern', x: 5, y: 5, z: 0, variant: 'lit' };
const optAssets = Object.create(assets), optLevel = structuredClone(level);
optLevel.props = [syntheticLamp];
optAssets.level = key => key === 'tower' ? optLevel : assets.level(key);
const lw = World.load({...def, entities: []}, optAssets, { physics: 'mesh' });
ok(lw.colliders.find(c => c.id === 'props:static').bvh.triCount === 32, 'spare floor lantern resolves its model-default prism');
optLevel.props = [{ ...syntheticLamp, colliders: [] }];
const ow = World.load({...def, entities: []}, optAssets, { physics: 'mesh' });
ok(!ow.colliders.some(c => c.id === 'props:static'), 'explicit [] overrides spare floor-lantern default');
const cw = deserialize(serialize(w), assets, { physics: 'mesh' });
ok(Buffer.from(cw.colliders.find(c => c.id === 'props:static').bvh.tri.buffer).equals(Buffer.from(c.bvh.tri.buffer)), 'save reload collider bytes stable');
const opts = { height:P.height, stepUpMax:P.stepUpMax, walkCos:Math.cos(P.maxSlopeDeg*Math.PI/180) }, out = {};
// The authored centre line keeps at least 1.0 m between the NEW prop blockers. Sample every centimetre.
const corridor = [[17,9.5], [17,7.5], [18.5,7.5], [17,7.5], [16.5,6.5], [16.5,5.5], [15.5,5.5], [15.5,3.5]];
// Isolate each real placement: its authored shape stops a ground-level airborne capsule from all eight sides.
// Grounded players may step onto the low sacks; their height and the engine's step-up rule remain unchanged.
for (const id of ['dressCrates','dressKeeper','practiceTarget','gondola','floorLanternFixture']) {
  const prop = id === syntheticLamp.id ? syntheticLamp : level.props.find(p => p.id === id);
  const only = structuredClone(level); only.props = [prop];
  const isolatedAssets = Object.create(assets); isolatedAssets.level = key => key === 'tower' ? only : assets.level(key);
  const iw = World.load({...def,entities:[]}, isolatedAssets, {physics:'mesh'});
  iw.colliders = iw.colliders.filter(c => c.id === 'props:static');
  const shape = prop.colliders?.[0] || assets.model(prop.model).colliders[0];
  const angle = (prop.facing || 0)*Math.PI/180;
  const cx = O.x+prop.x+Math.cos(angle)*shape.c[0]-Math.sin(angle)*shape.c[1];
  const cy = O.y+prop.y+Math.sin(angle)*shape.c[0]+Math.cos(angle)*shape.c[1];
  for(let side=0;side<8;side++) {
    const a = side*Math.PI/4, dx = Math.cos(a), dy = Math.sin(a);
    let x = cx+dx*3, y = cy+dy*3, blocked = false;
    for(let step=0;step<160;step++) {
      iw.collideCircle(x,y,-dx*.04,-dy*.04,P.radius,O.z,false,opts,out);
      blocked ||= out.blockedX || out.blockedY || Math.hypot(out.x-(x-dx*.04),out.y-(y-dy*.04))>1e-8;
      x=out.x; y=out.y;
    }
    ok(blocked && Math.hypot(x-cx,y-cy)>=P.radius-1e-5, id+' blocks side '+side);
  }
}
const saved = w.colliders; w.colliders = [c];
let clearanceSamples = 0;
for (let i=1;i<corridor.length;i++) {
  const [ax,ay]=corridor[i-1], [bx,by]=corridor[i], n=Math.ceil(Math.hypot(bx-ax,by-ay)/.01);
  for (let j=0;j<=n;j++) {
    const x=O.x+ax+(bx-ax)*j/n, y=O.y+ay+(by-ay)*j/n;
    w.collideCircle(x,y,0,0,.5,O.z,true,opts,out);
    ok(Math.hypot(out.x-x,out.y-y)<1e-5 && !out.overflow, '1m new-prop clearance at '+[i,j]);
    clearanceSamples++;
  }
}
w.colliders = saved;
const player = { id:'probe',type:'player',transform:{x:O.x+17,y:O.y+9.5,z:O.z,yawDeg:0,pitchDeg:0},
  components:{body:{radius:P.radius,height:P.height,eyeH:P.eyeHeight,vx:0,vy:0,vz:0,grounded:true,coyote:0,buffer:0,jumpHeldPrev:false,peakZ:O.z}} };
const controls = {forward:1,strafe:0,run:false,jump:false,yawDeg:0};
let walkSteps=0;
for (const [x,y] of corridor.slice(1)) {
  let n=0;
  while(Math.hypot(O.x+x-player.transform.x,O.y+y-player.transform.y)>.12 && n++<600) {
    controls.yawDeg=Math.atan2(O.x+x-player.transform.x,-(O.y+y-player.transform.y))*180/Math.PI;
    integrate(player,P.fixedDt,controls,w,P); walkSteps++;
  }
  ok(n<600, 'capsule reaches corridor waypoint '+[x,y]);
  ok(player.transform.z>=O.z-.01, 'capsule stays above floor');
}
// CH1-D1a: the barred ground-floor SW door (props.doorBar, 12-tri box) blocks the doorway, door.unbar is offered
// from the alcove through its own collider (sector-LOS), and unbarring drops the collider (also after a save reload).
{
  const dw = World.load(def, assets, { physics: 'mesh' });
  const bar = level.props.find(p => p.id === 'doorBar'), bx = O.x + bar.x, by = O.y + bar.y;
  const o2 = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(P.maxSlopeDeg*Math.PI/180) }, r2 = {};
  // walk +y from the alcove (inside) into the doorway cell; feet at floor level
  const push = () => { let x = bx, y = by - 0.9, blocked = false; for (let i = 0; i < 150; i++) { dw.collideCircle(x, y, 0, 0.01, P.radius, O.z, true, o2, r2); blocked ||= Math.abs(r2.y - (y + 0.01)) > 1e-8; x = r2.x; y = r2.y; } return { blocked, y }; };
  ok(!push().blocked, 'open door (TOWER-DOOR-OPEN-01): the doorway is walkable from the start (no bar collider)');
  const re = deserialize(serialize(dw), assets, { physics: 'mesh' });
  ok(!(() => { const q = re; let x = bx, y = by - 0.9, bl = false; for (let i = 0; i < 150; i++) { q.collideCircle(x, y, 0, 0.01, P.radius, O.z, true, o2, r2); bl ||= Math.abs(r2.y - (y + 0.01)) > 1e-8; x = r2.x; y = r2.y; } return bl; })(), 'save reload keeps the doorway open');
}
console.log(`tower-prop-colliders: ${checks} PASS; ${clearanceSamples} clearance samples; ${walkSteps} capsule steps; ${c.bvh.triCount} triangles`);
