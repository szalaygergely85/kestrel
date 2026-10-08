// ED-MESH-01d: kind-9 draw order is not a stable structure identity.
import { worldToLocal } from '../../engine/index.js';

function triangleHit(ray, p, i) {
  const ax=p[i], ay=p[i+1], az=p[i+2], ex=p[i+3]-ax, ey=p[i+4]-ay, ez=p[i+5]-az;
  const fx=p[i+6]-ax, fy=p[i+7]-ay, fz=p[i+8]-az;
  const hx=ray.dY*fz-ray.dZ*fy, hy=ray.dZ*fx-ray.dX*fz, hz=ray.dX*fy-ray.dY*fx;
  const det=ex*hx+ey*hy+ez*hz;
  if(Math.abs(det)<1e-10)return Infinity;
  const sx=ray.x-ax, sy=ray.y-ay, sz=ray.z-az;
  const u=(sx*hx+sy*hy+sz*hz)/det;
  if(u<0||u>1)return Infinity;
  const qx=sy*ez-sz*ey, qy=sz*ex-sx*ez, qz=sx*ey-sy*ex;
  const v=(ray.dX*qx+ray.dY*qy+ray.dZ*qz)/det;
  if(v<0||u+v>1)return Infinity;
  const t=(fx*qx+fy*qy+fz*qz)/det;
  return t>0?t:Infinity;
}

/** Click-only: bbox candidates, then render-triangle distance for overlapping bounds. */
export function resolveMeshPick(world, ray, depth) {
  if(!Number.isFinite(depth)||depth<=0)return null;
  const x=ray.ox+ray.dx*depth,y=ray.oy+ray.dy*depth,z=ray.oz+ray.dz*depth;
  const candidates=world.structures.filter(s=>s.kind==='mesh' && x>=s.bbox.x0-0.05 && x<=s.bbox.x1+0.05
    && y>=s.bbox.y0-0.05 && y<=s.bbox.y1+0.05 && z>=s.bbox.z0-0.05 && z<=s.bbox.z1+0.05);
  if(candidates.length===1)return candidates[0].id;
  let best=null, bestDepth=Infinity;
  for(const s of candidates) {
    const o=worldToLocal(s.frame,ray.ox,ray.oy,ray.oz,{x:0,y:0,z:0});
    const end=worldToLocal(s.frame,ray.ox+ray.dx,ray.oy+ray.dy,ray.oz+ray.dz,{x:0,y:0,z:0});
    const k=s.scale ?? 1;
    const local={x:o.x/k,y:o.y/k,z:o.z/k,dX:(end.x-o.x)/k,dY:(end.y-o.y)/k,dZ:(end.z-o.z)/k};
    let hit=Infinity;
    for(let i=0;i<s.mesh.pos.length;i+=9)hit=Math.min(hit,triangleHit(local,s.mesh.pos,i));
    if(Math.abs(hit-depth)<=0.1 && hit<bestDepth){best=s;bestDepth=hit;}
  }
  if(best)return best.id;
  const volume=s=>(s.bbox.x1-s.bbox.x0)*(s.bbox.y1-s.bbox.y0)*(s.bbox.z1-s.bbox.z0);
  candidates.sort((a,b)=>volume(a)-volume(b));
  return candidates[0]?.id ?? null;
}
