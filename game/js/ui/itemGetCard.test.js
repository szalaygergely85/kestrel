import assert from 'node:assert/strict';
import {createUiLayer} from '../../../engine/index.js';
import '../../../design/palette.js';
import '../../../design/items.js';
import '../../../design/models/title.js';
import '../../../design/models/inventory_ui.js';
import '../../../design/models/menu_ui.js';
import {createItemGetCard} from './itemGetCard.js';
const A=globalThis.ASSETS, style=A.uiStyle.itemGetCard;
const rgb=Object.fromEntries(Object.entries(A.palette.colors).map(([k,h])=>[k,[1,3,5].map(i=>parseInt(h.slice(i,i+2),16))]));
function rig(reduceMotion=false){const pause=[],view=createItemGetCard({setPaused:p=>pause.push(p)},{style,items:A.items,rgb,reduceMotion});return {view,pause};}
const {view:v,pause}=rig();
v.push('shield');v.push('key.small',2);v.push('heart.piece',2);
assert.equal(v.isOpen,true);assert.deepEqual(pause,[true]);assert.equal(v.snapshot().id,'shield');
assert.equal(v.dismiss(),false);v.step(0.24,true);assert.equal(v.snapshot().phase,'show');
v.step(0.01);assert.equal(v.dismiss(),true);v.step(0.1);assert.equal(v.snapshot().phase,'gap');
const dim={all:1};v.pushDim(dim);assert.equal(dim.all,style.sceneDim.bgMul,'dim persists during queue gap');
v.step(0.1,true);assert.equal(v.snapshot().id,'key.small');assert.equal(v.snapshot().phase,'show','held key does not skip next card');
v.step(1.499);assert.equal(v.snapshot().phase,'show');v.step(0.001);assert.equal(v.snapshot().phase,'fadeOut');
v.step(0.2);assert.equal(v.snapshot().id,'heart.piece');assert.equal(v.snapshot().phase,'show');
v.step(2);assert.equal(v.isOpen,false);assert.deepEqual(pause,[true,false],'one pause/unpause for the whole burst');
const large=rig();for(const id of ['shield','key.small','heart.piece'])large.view.push(id);large.view.step(10);
assert.equal(large.view.isOpen,false,'large dt drains all phases/queued cards');
const ui=createUiLayer({cols:160}), drawn=rig(true).view;drawn.push('shield');drawn.step(0.3);drawn.draw(ui);
function line(y,x,n){let out='';for(let i=0;i<n;i++)out+=String.fromCharCode(ui.cells.glyphIdx[y*ui.cols+x+i]+32);return out;}
const P=style.panel;
assert.ok(line(P.y+1,P.x,P.w).includes('Brass Buckler'));
assert.ok(line(P.y+4,P.x+15,38).startsWith('Gondola plate, bent round a strap.'));
assert.ok(line(P.y+6,P.x+15,38).startsWith('Shield - either hand'));
assert.ok(line(P.y+9,P.x,P.w).includes('- any key -'));
assert.equal(ui.cells.bg[((P.y+4)*ui.cols+P.x+15)*4+3],255,'opaque readable text plate');
assert.equal(ui.cells.mask[(P.y+5)*ui.cols+P.x+1],1,'reduce motion retains underlying plate and suppresses sparkles');
assert.throws(()=>drawn.push('missing'),/invalid reward/);assert.throws(()=>drawn.push('shield',0),/invalid reward/);
for(const dt of [-1,NaN,Infinity])assert.throws(()=>drawn.step(dt),/invalid dt/);
const before=drawn.snapshot();for(let i=0;i<100;i++)drawn.draw(ui);assert.deepEqual(drawn.snapshot(),before,'draw never advances queue/state');
const appended=rig();appended.view.push('shield');appended.view.step(0.3);appended.view.dismiss();appended.view.push('key.small');
appended.view.step(0.2);assert.equal(appended.view.snapshot().id,'key.small','late arrivals survive fading');
appended.view.clear();appended.view.clear();assert.deepEqual(appended.pause,[true,false]);
if(typeof global.gc==='function'){
  for(let i=0;i<1000;i++){drawn.step(0);drawn.draw(ui);}
  global.gc();const start=process.memoryUsage().heapUsed;
  for(let i=0;i<10000;i++){drawn.step(0);drawn.draw(ui);}
  global.gc();assert.ok(process.memoryUsage().heapUsed-start<65536,'draw/step do not allocate per frame after warm-up');
}
console.log('itemGetCard: guarded key, 1.5s timer, three-item order, pause/gaps, style drawing, clear and idle GC PASS');
