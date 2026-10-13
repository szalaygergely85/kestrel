import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {initMapCard,stepMapCard,getMapPanel,getMapChart,drawMapCard} from './mapCard.js';
import {createMapFog} from './mapFog.js';
const chart=await (await fetch('../../../content/chart/world_m1.chart.json')).json();
const {rt,info}=await createRenderer({canvas:document.querySelector('#screen'),backend:new URLSearchParams(location.search).get('backend')||'webgpu',cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
const assets={palette:ASSETS.palette,uiStyle:ASSETS.uiStyle,model:key=>ASSETS.models[key]};
// Diagnostic pose at the tower; marker coordinates are explicit host inputs.
const transform={x:1486.5,y:1025,yawDeg:0};
const world={state:{'ui.mapCard.dismissed':true,'quest.endT':-1},get:()=>({data:{transform}})};
const player={data:{transform}};world.get=()=>player;
const fog=new URLSearchParams(location.search).has('fog')?createMapFog(chart.bounds):null;
fog?.visit(transform.x,transform.y);
const keys=new Set();const input={pressed:key=>keys.has(key),anyPressed:()=>keys.size>0,consumePressed:()=>keys.clear()};
// WS1-07a fixture travel source: stone always touched; press W (card closed) to wake the relay; digit keys log the request.
const woken={relay:false};
const travel={list:()=>woken.relay?[{id:'waystone',name:'The Waystone',x:1428,y:1040,order:1},{id:'ws_roadBend',name:'Bend Relay',x:1489,y:1025,order:2}]:[{id:'waystone',name:'The Waystone',x:1428,y:1040,order:1}]};
window.addEventListener('keydown',e=>{if(e.code==='KeyW'){woken.relay=!woken.relay;getMapChart()?.refreshTravel();}});
initMapCard(assets,ui.cols,ui.rows,{chart,fog,travel,markers:[{kind:'waystone',x:1428,y:1040},{kind:'relay',x:1489,y:1025}]});
getMapChart().onTravel=id=>console.log('travel request',id);
window.addEventListener('keydown',event=>{keys.add(event.code);event.preventDefault();});
document.querySelector('#rotate').onclick=()=>{transform.yawDeg=(transform.yawDeg+90)%360;};
document.querySelector('#move').onclick=()=>{transform.x+=64;fog?.visit(transform.x,transform.y);};
document.querySelector('#walk').onclick=()=>{
  transform.yawDeg=270;
  for(let i=0;i<20;i++){transform.x-=5;fog?.visit(transform.x,transform.y);}
};
window.addEventListener('resize',()=>rt.resize());
window.__mapChartPreview={rt,info,ui,world,transform,fog,view:getMapChart(),panel:getMapPanel()};
let previous=performance.now();
function frame(now){const dt=Math.min(.1,(now-previous)/1000);previous=now;rt.clear();ui.clear();stepMapCard(world,assets,dt,input,100,0);drawMapCard(ui,now);rt.present();keys.clear();requestAnimationFrame(frame);}
requestAnimationFrame(frame);
