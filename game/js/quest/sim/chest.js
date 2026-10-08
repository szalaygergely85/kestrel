// S8-C-06: pure chest lifecycle. The host supplies poses, inventory, events and authored tables.
// No world mutation, interaction registration or render imports; wiring waits for gameHooks (D-050).
import {createRng} from '../../../../engine/index.js';
import {createLoot} from './loot.js';
import {CHEST_DEFAULTS as C} from './lootConfig.js';

const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id);
function streamSeed(seed, id) {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** defs: [{id,x,y,z,frontX,frontY,interact:{radius,facingDeg,facingCos},table:{fixed,weighted}}].
 * front is the model's local -y direction in world coordinates (supplied by the host).
 * Player pose: {x,y,z,forwardX,forwardY}; use feet/anchor z, not camera eye z.
 * openedIds() is a cold save snapshot for collectSave({openedChests}); pass restored ids at create.
 * Every chest has its own seeded roll, independent of opening/definition order and other RNG streams.
 */
export function createChests(defs, {items, inventoryOf, events, openedChests = [], seed = 1}) {
  if (!Array.isArray(defs) || !Array.isArray(openedChests) || !openedChests.every(validId)
    || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('chest: invalid definitions/save/seed');
  const restored = new Set(openedChests), records = [], byId = new Map();
  for (const def of defs) {
    const d = def && def.interact;
    if (!def || !validId(def.id) || byId.has(def.id) || !['x','y','z','frontX','frontY'].every(k=>Number.isFinite(def[k]))
      || !(def.frontX*def.frontX+def.frontY*def.frontY > 0) || !d || !Number.isFinite(d.radius) || d.radius <= 0
      || !Number.isFinite(d.facingDeg) || d.facingDeg <= 0 || d.facingDeg >= 90
      || !Number.isFinite(d.facingCos) || d.facingCos <= 0 || d.facingCos >= 1) throw new Error('chest: invalid or duplicate def');
    const r = {id:def.id, x:def.x, y:def.y, z:def.z, frontX:def.frontX, frontY:def.frontY,
      radius2:d.radius*d.radius, facingCos2:d.facingCos*d.facingCos,
      state:restored.has(def.id) ? 'open' : 'closed', time:0,
      loot:createLoot(null, events, {kind:'chest', items, table:def.table,
        rng:createRng(streamSeed(seed, def.id)), inventoryOf})};
    records.push(r); byId.set(r.id, r);
  }
  const opened = {id:''}, full = {id:''}, started = {id:''};
  function reachable(r, p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
      || !Number.isFinite(p.forwardX) || !Number.isFinite(p.forwardY)) return false;
    const dx=r.x-p.x, dy=r.y-p.y, dz=r.z-p.z, distance2=dx*dx+dy*dy;
    if (distance2+dz*dz > r.radius2 || -dx*r.frontX-dy*r.frontY <= 0) return false;
    const forward2=p.forwardX*p.forwardX+p.forwardY*p.forwardY, dot=dx*p.forwardX+dy*p.forwardY;
    return forward2 > 0 && dot > 0 && dot*dot >= distance2*forward2*r.facingCos2;
  }
  return {
    stateOf(id) { return byId.get(id)?.state ?? null; },
    canOpen(id, pose) { const r=byId.get(id); return !!r && r.state === 'closed' && reachable(r, pose); },
    open(id, pose) {
      const r=byId.get(id);
      if (!r || r.state !== 'closed' || !reachable(r, pose)) return false;
      if (!r.loot.canClaim()) { full.id=id; events.emit('inventory:full', full); return false; }
      r.state='opening'; r.time=0; started.id=id; events.emit('chest:opening', started);
      return true;
    },
    step(dt, playing = true) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('chest: invalid dt');
      if (!playing) return;
      for (let i=0;i<records.length;i++) {
        const r=records[i];
        if (r.state !== 'opening') continue;
        r.time=Math.min(C.openSeconds, r.time+dt);
        if (r.time < C.openSeconds) continue;
        if (!r.loot.claim()) {
          r.state='closed'; r.time=0; full.id=r.id; events.emit('inventory:full', full); continue;
        }
        r.state='open'; restored.add(r.id);
        r.loot.emitAdded(); opened.id=r.id; events.emit('chest:opened', opened);
      }
    },
    openedIds() { return Array.from(restored).sort(); },
  };
}
