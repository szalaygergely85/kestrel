import {createRenderer,createUiLayer,drawText} from '../../../engine/index.js';
import {validateItemDefs} from './sim/inventory.js';

const A=globalThis.ASSETS, items=A.items, rgb=Object.fromEntries(Object.entries(A.palette.colors).map(([key,hex])=>
  [key,[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))]));
validateItemDefs(items.defs);
const errors=items.validate(A.palette);
if(errors.length) throw new Error(errors.join('\n'));
const backend=new URLSearchParams(location.search).get('backend') || 'webgpu';
const {rt,info}=await createRenderer({canvas:document.querySelector('#screen'),backend,
  cols:400,rows:150,cpuGrid:{cols:400,rows:150},gpu:false});
const ui=createUiLayer({cols:160});ui.bindScene(rt.cols,rt.rows);rt.setUiLayer(ui);
const bg=[10,11,16], plate='#0a0b10', text='#e8e2d0', gold='#ffd24a';
const cards=items.iconSet.map((id,i)=>({def:items.defs[id],x:3+(i%3)*52,y:7+Math.floor(i/3)*12}));
window.addEventListener('resize',()=>rt.resize());
window.__itemDefsPreview={rt,ui,info,ids:items.iconSet};
document.querySelector('#status').textContent=`${backend}; 400x150; approved copy; preview only, no rewards granted`;
function frame() {
  rt.clear();ui.clear();
  drawText(ui,3,2,'ITEMS',gold,plate);
  for(const c of cards) {
    const d=c.def;
    for(let y=0;y<3;y++) for(let x=0;x<5;x++) {
      const ch=d.icon.glyphs[y].charCodeAt(x), k=items.keys[d.icon.fg[y][x]];
      if(ch!==32) ui.setCellRGB(c.x+x,c.y+y,ch-32,...rgb[k.c],...bg);
    }
    drawText(ui,c.x+8,c.y,d.name,text,plate);
    drawText(ui,c.x+8,c.y+2,d.kind,gold,plate);
    drawText(ui,c.x,c.y+5,d.desc,text,plate);
  }
  rt.present();requestAnimationFrame(frame);
}
frame();
