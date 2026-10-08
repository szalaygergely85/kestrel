// US-090a dev harness: memory-only slots; never writes the owner's platform saves.
import { createRenderer, createUiLayer } from '../../../engine/index.js';
import { createMemoryAdapter } from '../quest/save/saveState.js';
import { createTitleMenu } from './titleMenu.js';

const canvas = document.querySelector('#screen'), status = document.querySelector('#status');
const adapter = createMemoryAdapter();
for (const slot of [0,2]) adapter.writeSlot(slot,{saveVersion:1,world:{version:2,entities:[],structures:[]},
  game:{quest:null,openedChests:[],deadBeasts:[]},
  meta:{playerName:'Wick',place:slot===0 ? 'Watchtower' : 'Waystone',playTimeSec:slot===0 ? 3661 : 824}});
const {rt} = await createRenderer({canvas,backend:'webgpu',cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui = createUiLayer({cols:160}); ui.bindScene(rt.cols,rt.rows); rt.setUiLayer(ui);
const menu = createTitleMenu(adapter);
function draw() {
  rt.clear(); ui.clear(); menu.draw(ui); rt.present();
  const action = menu.takeAction();
  if (action) status.textContent = action.type + (action.slot === undefined ? '' : `: slot ${action.slot+1}`);
}
canvas.addEventListener('keydown',event=>{if(menu.handleKey(event.code)){event.preventDefault();draw();}});
function point(event, activate) {
  const rect = canvas.getBoundingClientRect();
  if(menu.handlePointer((event.clientX-rect.left)*ui.cols/rect.width,(event.clientY-rect.top)*ui.rows/rect.height,activate))draw();
}
canvas.addEventListener('pointermove',event=>point(event,false));
canvas.addEventListener('click',event=>{canvas.focus();point(event,true);});
window.addEventListener('resize',()=>{rt.resize();draw();});
status.textContent = 'Placeholder menu preview: keyboard or mouse; memory-only slots';
window.__titleMenuPreview = {menu,adapter,rt,ui,draw};
function frame() { draw(); requestAnimationFrame(frame); }
frame(); canvas.focus();
