// S8-C-15: coarse visited-cell mask and bounded route; no browser/world dependency.
export function createMapFog(bounds, {cols=64,rows=64,bytes=null}={}) {
  const {x0,y0,x1,y1}=bounds||{}, sx=x1-x0, sy=y1-y0;
  if(![x0,y0,x1,y1,sx,sy].every(Number.isFinite)||sx<=0||sy<=0
    ||!Number.isInteger(cols)||cols<1||cols>256||!Number.isInteger(rows)||rows<1||rows>256)
    throw new Error('mapFog: invalid bounds/grid');
  const mask=new Uint8Array(Math.ceil(cols*rows/8)), route=new Uint16Array(512);
  let count=0, revision=0;
  function cell(x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<x0||y<y0||x>x1||y>y1)return -1;
    return Math.min(rows-1,Math.floor((y-y0)*rows/sy))*cols+Math.min(cols-1,Math.floor((x-x0)*cols/sx));
  }
  function explored(i){return i>=0&&!!(mask[i>>3]&(1<<(i&7)));}
  function revealCell(cx,cy){
    if(!Number.isInteger(cx)||!Number.isInteger(cy)||cx<0||cy<0||cx>=cols||cy>=rows)return false;
    const i=cy*cols+cx, bit=1<<(i&7);
    if(explored(i))return false;
    mask[i>>3]|=bit;revision++;return true;
  }
  function visitCell(cx,cy){
    if(!Number.isInteger(cx)||!Number.isInteger(cy)||cx<0||cy<0||cx>=cols||cy>=rows)return false;
    let changed=revealCell(cx,cy);
    if(!count||route[(count-1)*2]!==cx||route[(count-1)*2+1]!==cy){
      if(count>=2){
        const a=(count-2)*2,b=(count-1)*2, dx=route[b]-route[a],dy=route[b+1]-route[a+1];
        const ex=cx-route[b],ey=cy-route[b+1];
        // Collapse straight travel, preserve reversals and turns.
        if(dx*ey===dy*ex&&dx*ex+dy*ey>0)count--;
      }
      if(count===256){
        // Keep the start and latest endpoint; halve intermediate samples.
        let n=1;for(let j=2;j<255;j+=2){route[n*2]=route[j*2];route[n*2+1]=route[j*2+1];n++;}
        route[n*2]=route[510];route[n*2+1]=route[511];count=n+1;
      }
      route[count*2]=cx;route[count*2+1]=cy;count++;changed=true;
    }
    if(changed)revision++;
    return changed;
  }
  // All allocations below are explicit save/load operations, never visit/query.
  function save(){
    const out=new Uint8Array(40+mask.length+count*2), d=new DataView(out.buffer);
    out.set([77,70,1,0]);d.setUint16(4,cols,true);d.setUint16(6,rows,true);
    d.setFloat64(8,x0,true);d.setFloat64(16,y0,true);d.setFloat64(24,x1,true);d.setFloat64(32,y1,true);
    out.set(mask,40);
    for(let i=0;i<count*2;i++)out[40+mask.length+i]=route[i];
    return out;
  }
  function restore(value){
    if(!(value instanceof Uint8Array)&&(!Array.isArray(value)||!value.every(v=>Number.isInteger(v)&&v>=0&&v<=255)))throw new Error('mapFog: expected bytes');
    if(value.length<40+mask.length||value.length>40+mask.length+512)throw new Error('mapFog: invalid byte size');
    const source=Uint8Array.from(value), d=new DataView(source.buffer);
    if(source.length<40+mask.length||source[0]!==77||source[1]!==70||source[2]!==1||source[3]!==0
      ||d.getUint16(4,true)!==cols||d.getUint16(6,true)!==rows
      ||!Object.is(d.getFloat64(8,true),x0)||!Object.is(d.getFloat64(16,true),y0)
      ||!Object.is(d.getFloat64(24,true),x1)||!Object.is(d.getFloat64(32,true),y1))
      throw new Error('mapFog: incompatible bytes');
    const n=(source.length-40-mask.length)/2;
    if(!Number.isInteger(n)||n>256)throw new Error('mapFog: invalid route size');
    const unused=mask.length*8-cols*rows;
    if(unused&&(source[39+mask.length]>>(8-unused)))throw new Error('mapFog: noncanonical mask');
    for(let j=0;j<n;j++){
      const cx=source[40+mask.length+j*2],cy=source[41+mask.length+j*2],i=cy*cols+cx;
      if(cx>=cols||cy>=rows||!(source[40+(i>>3)]&(1<<(i&7))))throw new Error('mapFog: invalid route point');
    }
    mask.set(source.subarray(40,40+mask.length));route.fill(0);
    for(let i=0;i<n*2;i++)route[i]=source[40+mask.length+i];
    count=n;revision++;
  }
  const api={cols,rows,bounds:Object.freeze({x0,y0,x1,y1}),
    get revision(){return revision;},get routeCount(){return count;},
    revealCell,reveal(x,y){const i=cell(x,y);return i<0?false:revealCell(i%cols,Math.floor(i/cols));},
    visitCell,visit(x,y){const i=cell(x,y);return i<0?false:visitCell(i%cols,Math.floor(i/cols));},
    isExplored(x,y){return explored(cell(x,y));},
    routeX(i){return Number.isInteger(i)&&i>=0&&i<count?x0+(route[i*2]+.5)*sx/cols:NaN;},
    routeY(i){return Number.isInteger(i)&&i>=0&&i<count?y0+(route[i*2+1]+.5)*sy/rows:NaN;},save,restore};
  if(bytes!==null)restore(bytes);
  return api;
}
