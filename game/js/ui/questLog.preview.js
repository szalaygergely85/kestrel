import {createRenderer,createUiLayer} from '../../../engine/index.js';
import {createQuest,applyQuestEvent} from '../quest/sim/quest.js';
import {createQuestLog,createQuestLogScreen} from './questLog.js';
import {createQuestBook} from '../quest/sim/questBook.js';

const def=await (await fetch('../../../content/quests/m1.quest.json')).json();
const canvas=document.querySelector('#screen'), status=document.querySelector('#status');
const backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const {rt,info}=await createRenderer({canvas,backend,cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160}); ui.bindScene(rt.cols,rt.rows); rt.setUiLayer(ui);
// OB-097: ?view=journal shows the two-pane J journal over the real m1 + side quests; Next feeds the next main-quest event.
const journalMode=new URLSearchParams(location.search).get('view')==='journal';
const rd=async n=>(await fetch('../../../content/quests/'+n)).json();
let book=null, screen=null, jStep=0;
const jEvents=[{type:'flag:set',key:'wake',value:true},{type:'area:entered',id:'breach'},{type:'item:got',id:'sword'},{type:'area:entered',id:'towerDoor'},'accept:tower.blade','hand:tower.blade','accept:burl.boars',{type:'beast:died',id:'boar1'},{type:'beast:died',id:'boar2'},{type:'beast:died',id:'boar3'}];
function jReset(){book=createQuestBook(def,[await0[0],await0[1]]);screen=createQuestLogScreen(book);screen.open();jStep=0;}
const await0=journalMode?[await rd('tower.blade.quest.json'),await rd('burl.boars.quest.json')]:[];
function jNext(){const e=jEvents[jStep++];if(!e)return;if(typeof e==='string'){const [a,id]=e.split(':');if(a==='accept')book.accept(id);else book.handIn(id);}else book.feed(e);}
if(journalMode){jReset();window.addEventListener('keydown',e=>{if(screen.handleKey(e.code))e.preventDefault();});}
const view=createQuestLog(def); let state=createQuest(def); view.update(state);
const steps=[[{type:'flag:set',key:'wake',value:true}],[{type:'item:got',id:'lantern'}],
  [{type:'area:entered',id:'breach'}],[{type:'item:got',id:'sword'}],
  [{type:'beast:died',id:'boar1'},{type:'beast:died',id:'boar2'}],[{type:'area:entered',id:'waystone'}]];
function next() {
  const events=steps[state.completed.length];
  if(events) for(const event of events) applyQuestEvent(state,event,def);
  view.update(state);
}
document.querySelector('#next').addEventListener('click',journalMode?jNext:next);
document.querySelector('#reset').addEventListener('click',()=>{if(journalMode){jReset();return;}state=createQuest(def);view.update(state);});
window.addEventListener('resize',()=>rt.resize());
window.__questLogPreview={rt,info,ui,view,next,get state(){return state;}};
function frame() {
  rt.clear();ui.clear();if(journalMode)screen.draw(ui);else{view.drawLog(ui);view.drawHud(ui,3,2);}rt.present();
  status.textContent=journalMode?`journal: step ${jStep}/${jEvents.length}; W/S select, Next feeds the story`:`${state.completed.length}/${def.objectives.length} complete; approved objective text`;
  requestAnimationFrame(frame);
}
frame();
