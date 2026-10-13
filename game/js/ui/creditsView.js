// S8-C-04: read-only credits over the licence inventory; the host owns navigation/loading.
import {drawText} from '../../../engine/index.js';

const ascii=value=>value.replace(/[^\x20-\x7e]/g,'?');

/** Uses the supplied menu frame/colours. Inventory file paths are evidence, not inferred authors.
 * No storage, fetch, DOM, release filtering or licence decisions in this view.
 * Input/build allocate; draw reuses cached pages and bounds. Esc emits back once.
 */
export function createCreditsView(inventory,{style}={}) {
  if(!inventory || !Array.isArray(inventory.files) || !style?.hex || !style.bg)
    throw new Error('credits: inventory and menu style required');
  const seen=new Set();
  const entries=inventory.files.map(file=>{
    if(!file || typeof file.path!=='string' || !file.path || typeof file.group!=='string' || !file.group || seen.has(file.path))
      throw new Error('credits: invalid/duplicate inventory entry');
    seen.add(file.path);
    return Object.freeze({path:file.path,group:file.group});
  });
  const bounds={x:0,y:0,w:style.panel.w,h:style.panel.h};
  const width=bounds.w-8, capacity=bounds.h-12;
  if(width<12 || capacity<2)throw new Error('credits: menu panel too small');
  const lines=[];
  for(const entry of entries) {
    const text=ascii(entry.group+': '+entry.path);
    for(let i=0;i<text.length;i+=width) lines.push(text.slice(i,i+width));
  }
  if(!lines.length)lines.push('');
  const pages=[];
  for(let i=0;i<lines.length;i+=capacity)pages.push(lines.slice(i,i+capacity));
  const counts=pages.map((_,i)=>`${i+1}/${pages.length}`);
  const sticky=entries.some(entry=>entry.group==='stickybizcuit');
  const bg=style.bg.plate, fg=style.hex[style.row.normal.fg];
  const brass=style.hex[style.frame.fg], hot=style.hex[style.title.fg], hint=style.hex.uiHint;
  let page=0, action=null;
  function handleKey(code) {
    if(code==='Escape'){action='back';return true;}
    if(code==='ArrowDown' || code==='ArrowRight' || code==='PageDown' || code==='Enter') {
      page=Math.min(page+1,pages.length-1);return true;
    }
    if(code==='ArrowUp' || code==='ArrowLeft' || code==='PageUp') {
      page=Math.max(0,page-1);return true;
    }
    if(code==='Home'){page=0;return true;}
    if(code==='End'){page=pages.length-1;return true;}
    return false;
  }
  function draw(ui) {
    const {w,h}=bounds;
    const x=bounds.x=Math.floor((ui.cols-w)/2), y=bounds.y=Math.floor((ui.rows-h)/2);
    for(let r=0;r<h;r++)for(let c=0;c<w;c++)ui.setCell(x+c,y+r,' ',fg,bg);
    for(let c=1;c<w-1;c++) {
      ui.setCell(x+c,y,style.frame.h,brass,bg);ui.setCell(x+c,y+h-1,style.frame.h,brass,bg);
    }
    for(let r=1;r<h-1;r++) {
      ui.setCell(x,y+r,style.frame.v,brass,bg);ui.setCell(x+w-1,y+r,style.frame.v,brass,bg);
    }
    for(let c=0;c<2;c++)for(let r=0;r<2;r++)ui.setCell(x+c*(w-1),y+r*(h-1),style.frame.corner,style.hex[style.frame.cornerFg],bg);
    const rivets=style.frame.rivets;
    if(rivets)for(const c of rivets.cols) {
      ui.setCell(x+c,y,rivets.glyph,style.hex[rivets.fg],bg);
      ui.setCell(x+c,y+h-1,rivets.glyph,style.hex[rivets.fg],bg);
    }
    drawText(ui,x+Math.floor((w-7)/2),y+2,'CREDITS',hot,bg);
    drawText(ui,x+4,y+4,'Third-party assets',hint,bg);
    if(sticky)drawText(ui,x+4,y+5,'Voxel assets by StickyBizcuit',fg,bg);
    for(let i=0;i<pages[page].length;i++)drawText(ui,x+4,y+7+i,pages[page][i],fg,bg);
    drawText(ui,x+4,y+h-4,'Thanks for flying.',hint,bg);
    drawText(ui,x+w-4-counts[page].length,y+h-4,counts[page],hint,bg);
    return bounds;
  }
  return {draw,handleKey,takeAction(){const result=action;action=null;return result;},
    snapshot:()=>({page,pages:pages.length,stickyBizcuit:sticky,entries:entries.map(entry=>({...entry}))})};
}
