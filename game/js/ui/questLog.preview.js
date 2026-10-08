import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createQuest,applyQuestEvent} from '../quest/sim/quest.js';
import {createQuestLog} from './questLog.js';

const def=await (await fetch('../../../content/quests/m1.quest.json')).json();
const canvas=document.querySelector('#screen'), status=document.querySelector('#status');
const backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const {rt,info}=await createRenderer({canvas,backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160}); ui.bindScene(rt.cols,rt.rows); rt.setUiLayer(ui);
const view=createQuestLog(def); let state=createQuest(def); view.update(state);
const steps=[[{type:'flag:set',key:'wake',value:true}],[{type:'item:got',id:'lantern'}],
  [{type:'area:entered',id:'breach'}],[{type:'item:got',id:'sword'}],
  [{type:'beast:died',id:'boar1'},{type:'beast:died',id:'boar2'}],[{type:'area:entered',id:'waystone'}]];
function next() {
  const events=steps[state.completed.length];
  if(events) for(const event of events) applyQuestEvent(state,event,def);
  view.update(state);
}
document.querySelector('#next').addEventListener('click',next);
document.querySelector('#reset').addEventListener('click',()=>{state=createQuest(def);view.update(state);});
window.addEventListener('resize',()=>rt.resize());
window.__questLogPreview={rt,info,ui,view,next,get state(){return state;}};
function frame() {
  rt.clear();ui.clear();view.drawLog(ui);view.drawHud(ui,3,2);rt.present();
  status.textContent=`${state.completed.length}/${def.objectives.length} complete; approved objective text`;
  requestAnimationFrame(frame);
}
frame();
