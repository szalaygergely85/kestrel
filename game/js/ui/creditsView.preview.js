import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createCreditsView} from './creditsView.js';

const inventory=await (await fetch('../../../docs/licence-inventory.json')).json();
const canvas=document.querySelector('#screen'), status=document.querySelector('#status');
const backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const {rt,info}=await createRenderer({canvas,backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
const view=createCreditsView(inventory,{style:globalThis.ASSETS.uiStyle.menu});
function key(code) {
  const consumed=view.handleKey(code), action=view.takeAction();
  if(action)status.textContent='Back action received by preview';
  return consumed;
}
document.querySelector('#previous').addEventListener('click',()=>key('ArrowUp'));
document.querySelector('#next').addEventListener('click',()=>key('Enter'));
window.addEventListener('keydown',event=>{if(key(event.code))event.preventDefault();});
window.addEventListener('resize',()=>rt.resize());
window.__creditsPreview={rt,info,ui,view};
function frame(){rt.clear();ui.clear();view.draw(ui);rt.present();requestAnimationFrame(frame);}
frame();
