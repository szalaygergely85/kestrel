import terrainDef from '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
import { Terrain } from '../../../engine/world/Terrain.js';
globalThis.window = globalThis.window || globalThis; terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; recipe.structures[0].ringHAt = () => 2.4;
G.util.installGeo(util);
const t = new Terrain(recipe); t.bakeFarSync();
const W = t.mapW, H = t.farHDraw, c = t.mapCell;
const mode = process.argv[2] || 'point';
function lod1(i, j) { // vertex height at global index (multiple of 4)
  if (mode === 'point') return H[i + j * W];
  let s = 0, ws = 0; const wk = (process.env.K||"1,2,3,4,3,2,1").split(",").map(Number); const R=(wk.length-1)/2;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = Math.min(W-1, Math.max(0, i+di)), jj = Math.min(W-1, Math.max(0, j+dj)); const w = wk[di+R]*wk[dj+R]; s += w*H[ii+jj*W]; ws += w; }
  return s/ws;
}
// bilinear of LOD1 at (x,y)
function surf(x, y) { const fx = (x - t.mapX0)/c - 0.5, fy = (y - t.mapY0)/c - 0.5; const gx = fx/4, gy = fy/4; let i0 = Math.floor(gx), j0 = Math.floor(gy); const tx = gx-i0, ty = gy-j0; const g=(a,b)=>lod1(Math.min(W-1-(W-1)%4, Math.max(0,a*4)), Math.min(W-1-(W-1)%4, Math.max(0,b*4))); return (g(i0,j0)*(1-tx)+g(i0+1,j0)*tx)*(1-ty)+(g(i0,j0+1)*(1-tx)+g(i0+1,j0+1)*tx)*ty; }
let maxJump = 0, maxJ8=0, sumErr=0, n=0, maxErr=0, at=null;
for (let j = 0; j < W; j += 4) for (let i = 0; i < W; i += 4) {
  const x = t.mapX0 + (i+.5)*c, y = t.mapY0 + (j+.5)*c; const sd = G.util.coastSD(x,y).sd;
  if (Math.abs(sd) > 150) continue;
  if (i+4<W) maxJump = Math.max(maxJump, Math.abs(lod1(i+4,j)-lod1(i,j)));
  if (j+4<W) maxJump = Math.max(maxJump, Math.abs(lod1(i,j+4)-lod1(i,j)));
  // error of interpolated surface vs 8 m grid at sub-cells
  for (let dj=0;dj<4;dj++) for (let di=0;di<4;di++){ if(i+di>=W||j+dj>=W) continue; const e = Math.abs(surf(t.mapX0+(i+di+.5)*c, t.mapY0+(j+dj+.5)*c)-H[i+di+(j+dj)*W]); sumErr+=e;n++; if(e>maxErr){maxErr=e;at=[x,y,sd];} }
}
for (let j = 0; j < W; j++) for (let i = 0; i < W-1; i++) { const x = (i+.5)*c, y=(j+.5)*c; if (Math.abs(G.util.coastSD(x,y).sd)<150) maxJ8=Math.max(maxJ8,Math.abs(H[i+1+j*W]-H[i+j*W])); }
console.log(mode, 'maxJump32', maxJump.toFixed(2), 'maxJump8', maxJ8.toFixed(2), 'meanErr', (sumErr/n).toFixed(3), 'maxErr', maxErr.toFixed(2), at);
let best=[0];
for (let j = 0; j < W-4; j += 4) for (let i = 0; i < W-4; i += 4) { const x=(i+.5)*c,y=(j+.5)*c; const sd=G.util.coastSD(x,y); if(Math.abs(sd.sd)>150) continue; const d=Math.abs(lod1(i+4,j)-lod1(i,j)); if(d>best[0]) best=[d,x,y,sd.sd,sd.kind,H[i+j*W],H[i+4+j*W]]; }
console.log('worst', best.map(v=>typeof v==='number'?+v.toFixed(1):v).join(' '));
// histogram of jumps >20 on beach/cliff
const hist={}; for (let j = 0; j < W-4; j += 4) for (let i = 0; i < W-4; i += 4) { const x=(i+.5)*c,y=(j+.5)*c; const sd=G.util.coastSD(x,y); if(Math.abs(sd.sd)>150) continue; const d=Math.abs(lod1(i+4,j)-lod1(i,j)); if(d>20){hist[sd.kind]=(hist[sd.kind]||0)+1;} }
console.log(hist);
let b2=[0];
for (let j = 0; j < W; j += 4) for (let i = 0; i < W; i += 4) { const x=t.mapX0+(i+.5)*c,y=t.mapY0+(j+.5)*c; const sd=G.util.coastSD(x,y); if(Math.abs(sd.sd)>150) continue;
 for (const [di,dj] of [[4,0],[0,4]]) { if(i+di>=W||j+dj>=W) continue; const d=Math.abs(lod1(i+di,j+dj)-lod1(i,j)); if(d>b2[0]) b2=[d,x,y,sd.sd,sd.kind,lod1(i,j),lod1(i+di,j+dj),di]; } }
console.log('worst2', b2.map(v=>typeof v==='number'?+v.toFixed(1):v).join(' '));
