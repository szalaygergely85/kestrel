// WAYSTONE-01: game-owned checkpoint data in WorldState; existing vitals owns teleport/death presentation.

const KEY='waystone';
const validId=id=>typeof id==='string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id);
function validPos(p){return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.yawDeg);}
function copyPos(p){return {x:p.x,y:p.y,z:p.z,yawDeg:p.yawDeg};}

/** player is entity data with health already initialized by vitals. waystones = [{id,pos:{x,y,z,yawDeg}}]; positions are safe respawn anchors.
 * spawn is the initial no-stone fallback, not the player's current position after loading/movement.
 * Each touch calls requestSave once AFTER committing full hearts, checkpoint JSON and existing vitals save keys.
 * onDeath heals and returns a copied respawn pose; the host/vitals performs the teleport, body reset and fade.
 * snapshot is a cold/debug copy. No ticking, clocks, random values or new save envelope/version.
 */
export function createWaystone(world, player, {waystones, spawn, requestSave}) {
  if(!world || !world.state || !player || !validPos(spawn) || !Array.isArray(waystones)
    || typeof requestSave!=='function')throw new Error('waystone: invalid host/definitions');
  const points=new Map();
  for(const def of waystones) {
    if(!def || !validId(def.id) || points.has(def.id) || !validPos(def.pos))throw new Error('waystone: invalid or duplicate point');
    points.set(def.id,copyPos(def.pos));
  }
  const saved=world.state[KEY];
  if(saved!==undefined && (!saved || !(saved.waystoneId===null || validId(saved.waystoneId)) || !validPos(saved.pos)))
    throw new Error('waystone: invalid saved checkpoint');
  const state=saved ? {waystoneId:saved.waystoneId,pos:copyPos(saved.pos)} : {waystoneId:null,pos:copyPos(spawn)};
  const health=player.components && player.components.health;
  if(!health || !Number.isFinite(health.max) || health.max<=0)throw new Error('waystone: invalid health maximum');
  world.state[KEY]=state;
  function checkpoint(p) {
    world.state['save.x']=p.x;world.state['save.y']=p.y;world.state['save.z']=p.z;world.state['save.yaw']=p.yawDeg;
  }
  function heal(){health.hp=health.max;}
  return {
    touch(id) {
      const p=points.get(id);
      if(!p)return false;
      state.waystoneId=id;
      state.pos.x=p.x;state.pos.y=p.y;state.pos.z=p.z;state.pos.yawDeg=p.yawDeg;
      checkpoint(state.pos);heal();requestSave();
      return true;
    },
    onDeath(){checkpoint(state.pos);heal();return copyPos(state.pos);},
    snapshot(){return {waystoneId:state.waystoneId,pos:copyPos(state.pos)};},
  };
}
