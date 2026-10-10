// WAYSTONE-01: game-owned checkpoint data in WorldState; existing vitals owns teleport/death presentation.

const KEY='waystone', PTS='waystone.points';
const validId=id=>typeof id==='string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id);
function validPos(p){return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.yawDeg);}
function copyPos(p){return {x:p.x,y:p.y,z:p.z,yawDeg:p.yawDeg};}

/** player is entity data with health already initialized by vitals. waystones = [{id,pos:{x,y,z,yawDeg}}]; positions are safe respawn anchors.
 * spawn is the initial no-stone fallback, not the player's current position after loading/movement.
 * Each touch calls requestSave once AFTER committing full hearts, checkpoint JSON and existing vitals save keys.
 * onDeath heals and returns a copied respawn pose; the host/vitals performs the teleport, body reset and fade.
 * snapshot is a cold/debug copy. No ticking, clocks, random values or new save envelope/version.
 */
export function createWaystone(world, player, {waystones=[], points: defsIn=[], spawn, requestSave, canWake}) {
  if(!world || !world.state || !player || !validPos(spawn) || !Array.isArray(waystones) || !Array.isArray(defsIn)
    || typeof requestSave!=='function')throw new Error('waystone: invalid host/definitions');
  // WS1-06a: `points` = travel points from entity data [{id,label,kind:'stone'|'relay',order}] (anchor = pose at the touch).
  // `waystones` = legacy [{id,pos}] with a fixed anchor. canWake(id) = optional gate (D-062: aether crystal later).
  const points=new Map(), defs=new Map(), order=[];
  function addDef(id,label,kind,ord){
    if(!validId(id) || defs.has(id))throw new Error('waystone: invalid or duplicate point');
    const d={id,label:typeof label==='string'?label:id,kind:kind==='relay'?'relay':'stone',order:Number.isFinite(ord)?ord:1e6+defs.size};
    defs.set(id,d);order.push(d);order.sort((a,b)=>a.order-b.order);
  }
  for(const def of waystones) {
    if(!def || !validId(def.id) || points.has(def.id) || !validPos(def.pos))throw new Error('waystone: invalid or duplicate point');
    points.set(def.id,copyPos(def.pos));addDef(def.id,def.label,def.kind,def.order);
  }
  for(const def of defsIn){if(!def)throw new Error('waystone: invalid or duplicate point');addDef(def.id,def.label,def.kind,def.order);}
  const saved=world.state[KEY];
  if(saved!==undefined && (!saved || !(saved.waystoneId===null || validId(saved.waystoneId)) || !validPos(saved.pos)))
    throw new Error('waystone: invalid saved checkpoint');
  let touched=world.state[PTS];
  if(touched!==undefined){
    if(!touched || typeof touched!=='object')throw new Error('waystone: invalid saved points');
    for(const k of Object.keys(touched))if(!validId(k) || !validPos(touched[k]))throw new Error('waystone: invalid saved points');
  } else {
    touched={};
    if(saved && saved.waystoneId)touched[saved.waystoneId]=copyPos(saved.pos); // old save: seed the list with the one stone
  }
  const state=saved ? {waystoneId:saved.waystoneId,pos:copyPos(saved.pos)} : {waystoneId:null,pos:copyPos(spawn)};
  const health=player.components && player.components.health;
  if(!health || !Number.isFinite(health.max) || health.max<=0)throw new Error('waystone: invalid health maximum');
  world.state[KEY]=state;world.state[PTS]=touched;
  function checkpoint(p) {
    world.state['save.x']=p.x;world.state['save.y']=p.y;world.state['save.z']=p.z;world.state['save.yaw']=p.yawDeg;
  }
  const own=id=>Object.prototype.hasOwnProperty.call(touched,id);
  function heal(){health.hp=health.max;}
  return {
    /** pose = {x,y,z,yawDeg} anchor (player pose at the touch); optional for legacy fixed-position points. */
    touch(id,pose) {
      const fixed=points.get(id);
      const p=validPos(pose)?pose:fixed;
      if(!p || (!defs.has(id)))return false;
      const a=own(id)?touched[id]:(touched[id]={x:0,y:0,z:0,yawDeg:0});
      a.x=p.x;a.y=p.y;a.z=p.z;a.yawDeg=p.yawDeg;
      state.waystoneId=id;
      state.pos.x=p.x;state.pos.y=p.y;state.pos.z=p.z;state.pos.yawDeg=p.yawDeg;
      checkpoint(state.pos);heal();requestSave();
      return true;
    },
    has(id){return defs.has(id);},
    /** Registers a point after boot (one-off allocation). */
    register(def){addDef(def.id,def.label,def.kind,def.order);},
    isTouched(id){return own(id);},
    /** Stored travel anchor (read-only reference) or null. */
    anchor(id){return own(id)?touched[id]:null;},
    canWake(id){return defs.has(id) && (typeof canWake!=='function' || !!canWake(id));},
    /** Fills `out` (reused array of reused entries) with the defined points in `order`; returns the count. */
    list(out){
      for(let i=0;i<order.length;i++){
        const d=order[i],a=own(d.id)?touched[d.id]:null;
        const e=out[i]||(out[i]={id:'',label:'',kind:'stone',order:0,touched:false,x:0,y:0,z:0,yawDeg:0});
        e.id=d.id;e.label=d.label;e.kind=d.kind;e.order=d.order;e.touched=!!a;
        if(a){e.x=a.x;e.y=a.y;e.z=a.z;e.yawDeg=a.yawDeg;}
      }
      return order.length;
    },
    onDeath(){checkpoint(state.pos);heal();return copyPos(state.pos);},
    snapshot(){return {waystoneId:state.waystoneId,pos:copyPos(state.pos)};},
  };
}
