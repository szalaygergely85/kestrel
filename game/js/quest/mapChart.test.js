import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import '../../../design/palette.js';
import '../../../design/models/title.js';
import {createChartCard,initMapCard,stepMapCard,getMapChart,getMapPanel,isMapOpen} from './mapCard.js';

if(typeof global.gc!=='function'){
  const result=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url)],{stdio:'inherit'});
  process.exit(result.status??1);
}

const palette=globalThis.ASSETS.palette;
const chart={chartVersion:1,width:2,rows:2,bounds:{x0:0,y0:0,x1:100,y1:100},shadeLevels:16,
  categories:['grass','water'],glyphs:['01','10'],shades:['ff','00']};
const view=createChartCard(chart,palette,{width:16,rows:8,markers:[{kind:'waystone',x:0,y:0}]});
const codes=view.art.codes, rgb=view.art.rgb, position=view.position;
assert.equal(codes[17],79);
for(const [yaw,code] of [[0,94],[90,62],[180,118],[270,60],[-90,60],[720,94]]){
  assert.equal(view.updatePose(0,0,yaw),true);assert.equal(codes[17],code);
}
view.updatePose(100,100,0);assert.deepEqual(position,{x:14,y:6,code:94});assert.equal(codes[17],79);
assert.equal(view.updatePose(-1,0,0),false);assert.equal(position.code,0);
assert.equal(codes[6*16+14],46);
view.updatePose(0,100,90);assert.equal(codes[6*16+1],62);
view.updatePose(100,0,180);assert.equal(codes[30],118);
view.updatePose(0,0,NaN);assert.equal(position.code,0);assert.equal(codes[30],126);
// Setup snapshots the source planes/bounds/marker. Later content mutation cannot move it.
chart.bounds.x1=1;chart.glyphs[0]='11';
assert.equal(view.updatePose(100,100,0),true);
for(let i=0;i<10000;i++)view.updatePose(i%101,(i*7)%101,i%360);
global.gc();const heapBefore=process.memoryUsage().heapUsed;
for(let i=0;i<100000;i++)view.updatePose(i%101,(i*7)%101,i%360);
global.gc();const heapGrowth=process.memoryUsage().heapUsed-heapBefore;
assert.ok(heapGrowth<300000,`pose retained heap grew ${heapGrowth} bytes`);
assert.equal(view.art.codes,codes);assert.equal(view.art.rgb,rgb);assert.equal(view.position,position);
const production=JSON.parse(readFileSync(new URL('../../../content/chart/world_m1.chart.json',import.meta.url)));
assert.equal(createChartCard(production,palette).art.codes.length,96*40);
for(const change of [{glyphs:['99','10']},{shades:['zz','00']},{bounds:{x0:0,y0:0,x1:0,y1:10}},
  {categories:['grass','grass']},{rows:3},{chartVersion:2}]){
  assert.throws(()=>createChartCard({...chart,...change},palette),/chart:/);
}
assert.throws(()=>createChartCard(production,palette,{markers:[null]}),/chart:/);
assert.throws(()=>createChartCard(production,palette,{markers:[{kind:'unknown',x:1,y:1}]}),/chart:/);
assert.throws(()=>createChartCard(production,palette,{glyphs:{}}),/chart:/);
const assets={palette,uiStyle:globalThis.ASSETS.uiStyle,model:key=>globalThis.ASSETS.models[key]};
const transform={x:1486.5,y:1025,yawDeg:90};let player={data:{transform}};
const world={state:{'ui.mapCard.dismissed':true,'quest.endT':-1},get:()=>player};
let key='KeyM';const input={pressed:k=>key===k,anyPressed:()=>!!key,consumePressed:()=>{key='';}};
initMapCard(assets,160,60,{chart:production});
assert.equal(getMapPanel().x0,32);assert.equal(getMapPanel().y0,10);
stepMapCard(world,assets,1/60,input,100,0);assert.equal(isMapOpen(),true);
stepMapCard(world,assets,1,input,100,0);assert.equal(getMapChart().position.code,62);
player=null;stepMapCard(world,assets,1/60,input,100,0);assert.equal(getMapChart().position.code,0);
key='Escape';stepMapCard(world,assets,1/60,input,100,0);stepMapCard(world,assets,1,input,100,0);
assert.equal(isMapOpen(),false);
world.state['quest.endT']=0;key='KeyM';stepMapCard(world,assets,1,input,100,0);assert.equal(isMapOpen(),false);
initMapCard(assets,400,150);assert.equal(getMapChart(),null);
assert.equal(getMapPanel().art.w,globalThis.ASSETS.models.mapCard.size.w);
console.log('Map chart bounds, heading, marker restoration, source isolation, validation and legacy lifecycle PASS');
