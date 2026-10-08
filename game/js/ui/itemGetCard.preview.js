import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createItemGetCard} from './itemGetCard.js';
const A=globalThis.ASSETS, backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const rgb=Object.fromEntries(Object.entries(A.palette.colors).map(([k,h])=>[k,[1,3,5].map(i=>parseInt(h.slice(i,i+2),16))]));
const {rt,info}=await createRenderer({canvas:document.querySelector('#screen'),backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
let paused=false, key=false, previous=null;
const view=createItemGetCard({setPaused:p=>paused=p},{style:A.uiStyle.itemGetCard,items:A.items,rgb,dev:true});
const select=document.querySelector('#item');
for(const id of A.items.iconSet){const option=document.createElement('option');option.value=id;option.textContent=A.items.defs[id].name;select.append(option);}
function three(){view.clear();view.push('shield');view.push('key.small',2);view.push('heart.piece',2);}
document.querySelector('#three').addEventListener('click',three);
document.querySelector('#single').addEventListener('click',()=>{view.clear();view.push(select.value);});
window.addEventListener('keydown',event=>{if(!event.repeat){key=true;event.preventDefault();}});
rt.canvas.addEventListener('pointerdown',()=>key=true);
window.addEventListener('resize',()=>rt.resize());
window.__itemGetCardPreview={rt,info,ui,view,three,get paused(){return paused;}};
function frame(now){
  const dt=previous===null ? 0 : Math.max(0,Math.min(0.1,(now-previous)/1000));previous=now;
  if(!document.querySelector('#freeze').checked)view.step(dt,key);
  else if(key)view.dismiss();
  key=false;rt.clear();ui.clear();view.draw(ui);rt.present();
  document.querySelector('#status').textContent=`${backend}; ${view.snapshot().id || 'idle'}; paused=${paused}; preview only`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
