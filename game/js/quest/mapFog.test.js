import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import '../../../design/palette.js';
import '../../../design/models/title.js';
import {World,AssetRegistry,createUiLayer} from '../../../engine/index.js';
import {createMapFog} from './mapFog.js';
import {createChartCard,initMapCard,getMapPanel,drawMapCard} from './mapCard.js';
import {collectSave,applySave,stringifyGameSave,parseGameSave} from './save/saveState.js';
if(typeof global.gc!=='function'){
  const result=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(result.status??1);
}
const bounds={x0:0,y0:0,x1:100,y1:100};
const fog=createMapFog(bounds,{cols:10,rows:10});
assert.equal(fog.isExplored(5,5),false);assert.equal(fog.visit(5,5),true);
assert.equal(fog.visit(5,5),false);assert.equal(fog.routeCount,1);
assert.equal(fog.revealCell(5,5),true);assert.equal(fog.reveal(55,55),false);
assert.equal(fog.routeCount,1,'visibility reveal does not scribble a player route');
for(let x=15;x<=95;x+=10)fog.visit(x,5);
assert.equal(fog.routeCount,2,'straight travel collapses to endpoints');
fog.visit(85,5);assert.equal(fog.routeCount,3,'reversal retained');
fog.visit(85,15);assert.equal(fog.routeCount,4,'turn retained');
assert.equal(fog.isExplored(35,5),true);assert.equal(fog.isExplored(35,15),false);
const before=fog.save();for(const p of [[-1,0],[101,0],[NaN,1],[Infinity,1]])assert.equal(fog.visit(...p),false);
assert.equal(fog.visitCell(10,0),false);assert.equal(fog.visitCell(.5,0),false);assert.deepEqual(fog.save(),before);
const dense=createMapFog(bounds,{cols:256,rows:256});
for(let i=0;i<1000;i++)dense.visitCell((i*73)%256,(i*39+Math.floor(i/5))%256);
assert.ok(dense.routeCount<=256);assert.equal(dense.routeX(0),bounds.x0+.5*100/256);
const saved=dense.save(), restored=createMapFog(bounds,{cols:256,rows:256,bytes:Array.from(saved)});
assert.deepEqual(restored.save(),saved,'byte-stable load/save');
for(let i=1000;i<1500;i++){dense.visitCell(i%256,(i*31)%256);restored.visitCell(i%256,(i*31)%256);}
assert.deepEqual(restored.save(),dense.save(),'same stream after reload has identical decimation');
for(const bytes of [saved.slice(1),saved.slice(0,41),new Uint8Array([...saved,0]),[300]]){
  const previous=restored.save();assert.throws(()=>restored.restore(bytes),/mapFog:/);assert.deepEqual(restored.save(),previous,'invalid restore atomic');
}
const incompatible=saved.slice();incompatible[2]=2;assert.throws(()=>restored.restore(incompatible));
const unused=createMapFog(bounds,{cols:3,rows:3});const invalidMask=unused.save();invalidMask[41]=128;
assert.throws(()=>unused.restore(invalidMask),/noncanonical/);
assert.throws(()=>createMapFog(bounds,{cols:257}));assert.throws(()=>createMapFog({...bounds,x1:0}));
const engineAssets=new AssetRegistry({palette:{}}),world=World.load({name:'fog_fixture',terrain:null,structures:[],entities:[]},engineAssets,{});
world.state['ui.mapFog']=Array.from(dense.save());
const text=stringifyGameSave(collectSave(world)), loaded=applySave(parseGameSave(text),engineAssets).world;
const fromWorld=createMapFog(bounds,{cols:256,rows:256,bytes:loaded.state['ui.mapFog']});
assert.deepEqual(fromWorld.save(),dense.save());assert.equal(stringifyGameSave(collectSave(loaded)),text,'existing game save envelope stable');
const palette=globalThis.ASSETS.palette, chart={chartVersion:1,width:2,rows:2,bounds,shadeLevels:16,categories:['grass'],glyphs:['00','00'],shades:['ff','ff']};
const path=createMapFog(bounds,{cols:10,rows:10});
const view=createChartCard(chart,palette,{width:16,rows:8,fog:path,markers:[{kind:'waystone',x:95,y:45}]});
assert.ok(view.art.codes.includes(32));assert.equal(view.art.codes[3*16+14],32,'unseen marker hidden');
assert.equal(String.fromCharCode(...view.art.codes.slice(4*16+4,4*16+11)),'NOTHING');
for(let x=5;x<=95;x+=10)path.visit(x,45);
view.updatePose(95,45,90);assert.ok(view.art.codes.includes(42),'pencil route visible');
view.updatePose(NaN,NaN,NaN);assert.ok(view.art.codes.includes(79),'revealed marker restored');
assert.ok(view.art.codes.includes(32),'unvisited cells remain blank');
assert.throws(()=>createChartCard(chart,palette,{fog:createMapFog({...bounds,x1:101})}),/incompatible/);
const assets={palette,uiStyle:ASSETS.uiStyle,model:key=>ASSETS.models[key]},ui=createUiLayer({cols:160});
initMapCard(assets,ui.cols,ui.rows,{chart,fog:path});const panel=getMapPanel();panel.open();panel.step(1);
drawMapCard(ui,0);for(let y=0;y<panel.art.h;y++)for(let x=0;x<panel.art.w;x++)
  assert.equal(ui.cells.bg[((panel.y0+y)*ui.cols+panel.x0+x)*4+3],255,'blank paper remains opaque');
for(let i=0;i<10000;i++)dense.visitCell(i%256,(i*31)%256);
global.gc();const heapBefore=process.memoryUsage().heapUsed;
for(let i=0;i<100000;i++){dense.visitCell(i%256,(i*31)%256);dense.isExplored(i%100,(i*7)%100);}
global.gc();assert.ok(process.memoryUsage().heapUsed-heapBefore<300000,'bounded hot-state heap');
console.log('Map fog growth, bounded/decimated route, byte codec, existing world-save round trip, opaque view and hot-state heap PASS');
