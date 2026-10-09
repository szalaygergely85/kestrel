// S8-C-07: cached item-get card. Host owns input routing/pause and calls step even while gameplay is paused.
// Formatting happens at create/push; draw/step reuse the queue, layout, colours and payload-free state.
export function createItemGetCard(adapter, {style:S, items, rgb, reduceMotion=false, dev=false}) {
  const reduced=()=>typeof reduceMotion==='function'?!!reduceMotion():!!reduceMotion; // bool or live getter
  const T=S.timing, P=S.panel, F=S.frame, B=S.iconBox, info=Object.create(null), queue=[];
  if (![T.holdSec,T.fadeIn,T.fadeOut,T.gapSec].every(n=>Number.isFinite(n)&&n>0)
    || !Number.isFinite(T.keyLockSec) || T.keyLockSec<0 || T.keyLockSec>T.holdSec) throw new Error('item card: invalid timing');
  const colours=Object.create(null);
  function colour(value) {
    if (Array.isArray(value)) return value;
    const hex=S.hex[value] || S.bg[value];
    if (hex) return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    if (rgb[value]) return rgb[value];
    throw new Error('item card: unknown colour '+value);
  }
  for(const key of Object.keys(S.hex))colours[key]=colour(key);
  for(const key of Object.keys(S.bg))colours[key]=colour(key);
  const fullFg=colour(S.count.full.fg), plate=colour(P.bg), tag=S.frame.tag;
  const tagText=tag.bracket[0]+tag.text+tag.bracket[1];
  for(const id of Object.keys(items.defs)) {
    const d=items.defs[id], cells=[];
    for(let y=0;y<3;y++)for(let x=0;x<5;x++) {
      const ch=d.icon.glyphs[y].charCodeAt(x), key=items.keys[d.icon.fg[y][x]];
      if(ch!==32)cells.push({x,y,ch,fg:rgb[key.c]});
    }
    info[id]={def:d,cells,title:S.titleBar.decor[0]+d.name+S.titleBar.decor[1],
      kind:(S.kind.text[d.kind] || d.kind)+(d.hand ? S.kind.handSuffix : ''),desc:d.desc.slice(0,S.desc.w)};
  }
  let phase='idle', age=0, index=0, target=null, opacity=1;
  function paused(value){if(adapter?.setPaused)adapter.setPaused(value);}
  function dismiss(){if(phase!=='show'||age<T.keyLockSec)return false;phase='fadeOut';age=0;return true;}
  function put(x,y,ch,fg,bg) {
    target.setCellRGB(P.x+x,P.y+y,ch-32,Math.round(fg[0]*opacity),Math.round(fg[1]*opacity),Math.round(fg[2]*opacity),bg[0],bg[1],bg[2]);
  }
  function text(x,y,line,fg,bg=plate){for(let i=0;i<line.length;i++)put(x+i,y,line.charCodeAt(i),fg,bg);}
  function box(x,y,w,h,c,hg,vg,fg,bg,cornerFg=fg) {
    for(let iy=0;iy<h;iy++)for(let ix=0;ix<w;ix++) {
      const edgeX=ix===0||ix===w-1,edgeY=iy===0||iy===h-1;
      const ch=edgeX&&edgeY ? c : edgeY ? hg : edgeX ? vg : 32;
      put(x+ix,y+iy,ch,edgeX&&edgeY ? cornerFg : fg,bg);
    }
  }
  return {
    get isOpen(){return phase!=='idle';},
    push(id,n=1,{count=n,packFull=false}={}) {
      if(!info[id] || !Number.isSafeInteger(n) || n<1 || !Number.isSafeInteger(count) || count<0)throw new Error('item card: invalid reward');
      const inf=info[id], progress=S.count.progress[id];
      queue.push({id,n,info:inf,countLine:packFull ? S.count.full.text : progress ? progress.format.replace('{n}',String(count))
        : inf.def.stackMax>1 && count>=2 ? S.count.format.replace('{n}',String(count)) : '',
        countFg:packFull ? fullFg : colours[progress ? progress.fg : S.count.fg],queueLine:''});
      for(let i=0;i<queue.length;i++)queue[i].queueLine=queue.length>1 ? S.footer.queue.format.replace('{i}',String(i+1)).replace('{n}',String(queue.length)) : '';
      if(phase==='idle'){phase='show';age=0;index=0;paused(true);}
    },
    dismiss,
    clear(){queue.length=0;index=0;age=0;if(phase!=='idle'){phase='idle';paused(false);}},
    step(dt,keyPressed=false) {
      if(!Number.isFinite(dt)||dt<0)throw new RangeError('item card: invalid dt');
      if(keyPressed)dismiss();
      let left=dt;
      while(phase!=='idle') {
        const limit=phase==='show' ? T.holdSec : phase==='fadeOut' ? T.fadeOut : T.gapSec;
        const used=Math.min(left,limit-age);age+=used;left-=used;
        if(age<limit)break;
        age=0;
        if(phase==='show')phase='fadeOut';
        else if(phase==='fadeOut') {
          index++;
          if(index<queue.length)phase='gap';
          else {phase='idle';queue.length=0;index=0;paused(false);}
        } else phase='show';
        if(left<=0)break;
      }
    },
    pushDim(dim){if(phase!=='idle')dim.all*=S.sceneDim.bgMul;},
    snapshot(){return {phase,age,index,id:queue[index]?.id ?? null,length:queue.length};},
    draw(ui) {
      if(phase==='idle'||phase==='gap')return;
      target=ui;const q=queue[index], inf=q.info;
      opacity=phase==='fadeOut' ? Math.max(0,1-age/T.fadeOut) : Math.min(1,age/T.fadeIn);
      box(0,0,P.w,P.h,F.corner.charCodeAt(0),F.h.charCodeAt(0),F.v.charCodeAt(0),colours[F.fg],plate,colours[F.cornerFg]);
      for(let i=0;i<F.rivets.cols.length;i++) {
        put(F.rivets.cols[i],0,F.rivets.glyph.charCodeAt(0),colours[F.rivets.fg],plate);
        put(F.rivets.cols[i],P.h-1,F.rivets.glyph.charCodeAt(0),colours[F.rivets.fg],plate);
      }
      text((P.w-tagText.length)>>1,tag.row,tagText,colours[tag.fg]);
      const title=S.titleBar;
      for(let x=title.from;x<=title.to;x++)put(x,title.row,32,colours[title.fg],colours[title.bg]);
      const tx=(P.w-inf.title.length)>>1;
      text(tx,title.row,inf.title,colours[age<title.pop.sec&&phase==='show' ? title.pop.fg : title.fg],colours[title.bg]);
      text(tx,title.row,title.decor[0],colours[title.decorFg],colours[title.bg]);
      text(tx+title.decor[0].length+inf.def.name.length,title.row,title.decor[1],colours[title.decorFg],colours[title.bg]);
      for(let x=S.separator.from;x<=S.separator.to;x++)put(x,S.separator.row,S.separator.glyph.charCodeAt(0),colours[S.separator.fg],plate);
      const pulse=!reduced() && Math.sin(age*6.283185307179586/B.pulse.periodSec)>0.5 ? 1 : 0;
      const iconBg=colours[B.pulse.innerBg[pulse]];
      box(B.x,B.y,B.w,B.h,B.border.corner.charCodeAt(0),B.border.h.charCodeAt(0),B.border.v.charCodeAt(0),colours[B.pulse.fg[pulse]],iconBg,colours[B.cornerFg]);
      for(let i=0;i<inf.cells.length;i++){const c=inf.cells[i];put(B.x+B.icon.x+c.x,B.y+B.icon.y+c.y,c.ch,c.fg,iconBg);}
      if(!reduced())for(let i=0;i<S.sparkles.cells.length;i++) {
        const frame=(Math.floor(age/S.sparkles.stepSec)+3*i)%S.sparkles.frames.length, ch=S.sparkles.frames[frame];
        if(ch!==' ')put(S.sparkles.cells[i][0],S.sparkles.cells[i][1],ch.charCodeAt(0),colours[S.sparkles.fg[frame]],plate);
      }
      text(S.desc.x,S.desc.y,inf.desc,colours[S.desc.fg]);
      text(S.kind.x,S.kind.y,inf.kind,colours[S.kind.fg]);
      text(S.count.x,S.count.y,q.countLine,q.countFg);
      if(dev&&inf.def.pending)text(S.pending.x,S.pending.y,S.pending.text,colours[S.pending.fg]);
      text(S.footer.queue.col,S.footer.row,q.queueLine,colours[S.footer.queue.fg]);
      if(age>=T.keyLockSec||phase==='fadeOut')text(S.footer.continue.colEnd-S.footer.continue.text.length+1,S.footer.row,S.footer.continue.text,colours[S.footer.continue.fg]);
    },
  };
}
