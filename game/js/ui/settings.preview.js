import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createSettingsView} from './settings.js';
const canvas=document.querySelector('#screen'),status=document.querySelector('#status');
const backend=new URLSearchParams(location.search).get('backend')||'webgpu';
const {rt,info}=await createRenderer({canvas,backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
const s=globalThis.ASSETS.uiStyle.settings;
const view=createSettingsView({quality:'high',shadows:'mid',volume:0.7},{style:s.full,controls:s.controls,quality:s.quality,rgb:ASSETS.palette.rgb});
window.addEventListener('keydown',event=>{if(view.handleKey(event.code))event.preventDefault();if(view.takeAction())status.textContent='Back action received by preview';});
window.addEventListener('resize',()=>rt.resize());
window.__settingsPreview={rt,info,ui,view};
function frame(){rt.clear();ui.clear();view.draw(ui);rt.present();requestAnimationFrame(frame);}
frame();
