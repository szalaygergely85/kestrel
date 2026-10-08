import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createInventoryView} from './inventoryView.js';
import {ensureInventory} from './sim/inventory.js';

const A=globalThis.ASSETS, canvas=document.querySelector('#screen');
const backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const {rt,info}=await createRenderer({canvas,backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
const player={components:{health:{hp:20,max:30}}};
const ids=Object.keys(A.items.defs).filter(id=>id!=='cog' && A.items.defs[id].stackMax>0).slice(0,12);
const inv=ensureInventory(player,{pack:ids.map(id=>({id,n:1})),left:'sword',right:'spell.fireball'});
let locks=true;
const view=createInventoryView({style:A.uiStyle.inventory,items:A.items,rgb:A.palette.rgb,inventoryOf:()=>inv,
  healthOf:()=>player.components.health,isSlotDisabled:i=>locks && i>=12,isHandDisabled:hand=>locks && hand==='right'});
const pressed=new Set(),input={pressed:code=>pressed.has(code),consumePressed:()=>pressed.clear()};
view.open();
document.querySelector('#locks').addEventListener('click',()=>{locks=!locks;});
document.querySelector('#open').addEventListener('click',()=>view.open());
window.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','Enter','Escape','KeyI'].includes(event.code)) {event.preventDefault();pressed.add(event.code);view.step(0,input,true);}});
window.addEventListener('resize',()=>rt.resize());
window.__inventoryPreview={rt,info,ui,view,inv,ids,get locks(){return locks;}};
function frame(){rt.clear();ui.clear();view.step(1/60,input,true);view.draw(ui);rt.present();requestAnimationFrame(frame);}
frame();
