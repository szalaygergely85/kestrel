// S8-C-12: cached objective HUD/log view over the shipped quest sim.
import { drawText } from '../../../engine/index.js';
import { validateQuestDefinition, questObjectives } from '../quest/sim/quest.js';

const ascii = value => value.replace(/[^\x20-\x7e]/g, '?');
function clipped(text, width) { return text.length <= width ? text : text.slice(0,width-3)+'...'; }

/** Call update on quest changes; drawHud/drawLog never format or allocate rows.
 * Approved writer copy stays in content; existing plate/foreground retained.
 */
export function createQuestLog(def, {hudWidth=60,width=72,fg='#e8e2d0',bg='#0a0b10'} = {}) {
  validateQuestDefinition(def);
  if (!Number.isInteger(hudWidth) || hudWidth < 3 || !Number.isInteger(width) || width < 12) throw new RangeError('questLog: invalid width');
  const rows = def.objectives.map(objective=>({id:objective.id,text:objective.text,status:'locked',progress:0,target:1}));
  const labels = def.objectives.map(objective=>ascii(objective.text));
  const rendered = rows.map(()=> '');
  const bounds = {x:0,y:0,w:width,h:rows.length*2+6};
  let objectiveLine = '';
  function update(state) {
    if (state.questId !== def.id) throw new Error('questLog: incompatible quest');
    questObjectives(state,def,rows);
    objectiveLine = '';
    for (let i=0;i<rows.length;i++) {
      const row = rows[i], marker = row.status === 'complete' ? '[x] ' : row.status === 'active' ? '[>] ' : '[ ] ';
      rendered[i] = clipped(marker+labels[i],width-6);
      if (row.status === 'active') objectiveLine = clipped(labels[i],hudWidth);
    }
    return objectiveLine;
  }
  function drawHud(ui,x,y) {
    for (let i=0;i<hudWidth;i++) ui.setCell(x+i,y,' ',fg,bg);
    drawText(ui,x,y,objectiveLine,fg,bg);
  }
  function drawLog(ui) {
    bounds.x=Math.floor((ui.cols-width)/2); bounds.y=Math.floor((ui.rows-bounds.h)/2);
    for (let y=0;y<bounds.h;y++) for(let x=0;x<width;x++) ui.setCell(bounds.x+x,bounds.y+y,' ',fg,bg);
    drawText(ui,bounds.x+3,bounds.y+1,'PENCIL NOTES',fg,bg);
    for (let i=0;i<rendered.length;i++) drawText(ui,bounds.x+3,bounds.y+4+i*2,rendered[i],fg,bg);
    return bounds;
  }
  return {update,drawHud,drawLog,getObjectiveLine:()=>objectiveLine,
    snapshot:()=>rows.map(row=>({...row}))};
}
