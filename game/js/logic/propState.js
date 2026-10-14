// ED-LOGIC-01c (arch 38.70): generic prop state, generalises doorToggle.js. A prop's state IS its voxel variant
// ('open' / 'closed' / ...). Applying a state = setVariant + World.rebuildPropColliders (the level's colliderOffVariant
// drops the collider) + nav footprint block/unblock. Saved state lives in world.state['prop.<id>.state'] (id = entity id,
// e.g. 'rook.gate'); reapply() runs on 'world:loaded'. A state that would turn the collider ON is deferred (retried every
// step via step()) while the player overlaps the footprint - the door rule: never trap the player in geometry.
export const propKey = (id) => 'prop.' + id + '.state';
const NAV_OWNER_BASE = 0x4c0000;
const PLAYER_R = 0.45;

const T = (e) => (e.data ? e.data.transform : e.transform); // EntityHandle or raw entity

/** Level prop def of an entity id ('<struct>.<prop>') or null. */
function propDef(world, id) {
  for (const s of world.structures || []) {
    if (!id.startsWith(s.id + '.')) continue;
    const key = id.slice(s.id.length + 1);
    for (const p of (s.level && s.level.def.props) || []) if (p.id === key) return p;
  }
  return null;
}

/** Conservative footprint circle {r} around the entity (largest collider extent + player radius). */
function footprintR(world, e, def) {
  const c = e.getComponent('voxel'), model = c && world.assets.model(c.model);
  const defs = def && Object.hasOwn(def, 'colliders') ? def.colliders : (model && model.colliders) || [];
  let r = 0.5;
  for (const d of defs || []) {
    if (!d || !d.c) continue;
    const ext = d.type === 'box' ? Math.hypot(d.half[0], d.half[1]) : (d.r || 0);
    r = Math.max(r, Math.hypot(d.c[0], d.c[1]) + ext);
  }
  return r * (T(e).scale || 1) + PLAYER_R;
}

/**
 * @param {import('../../../engine/index.js').World} world
 * @param {{nav?: any, player?: () => ({x:number,y:number,z:number}|null)}} [opts] nav = NavGrid-like {blockWorldRect, unblock} (optional)
 */
export function createPropStates(world, opts = {}) {
  const wantIds = []; // ids with a deferred request, request order
  const want = {};    // id -> state
  const navOwner = {}; // id -> owner int (while blocked)
  let nextOwner = 0;
  const nav = () => opts.nav || world.nav || null;
  const playerPos = () => { if (opts.player) return opts.player(); const p = world.get('player'); return p && (p.transform || (p.data && p.data.transform)) || null; };

  function entity(id) { const e = world.get(id); return e && e.getComponent && e.getComponent('voxel') ? e : null; }
  function current(id) { const e = entity(id); const c = e && e.getComponent('voxel'); return c ? (c.variant !== undefined ? c.variant : (propDef(world, id) || {}).variant || '') : ''; }

  function syncNav(id, e, def, solid) {
    const g = nav(); if (!g || !g.blockWorldRect) return;
    if (solid && navOwner[id] === undefined) {
      const r = footprintR(world, e, def) - PLAYER_R, t = T(e); navOwner[id] = NAV_OWNER_BASE + (nextOwner++);
      g.blockWorldRect(navOwner[id], t.x - r, t.y - r, t.x + r, t.y + r);
    } else if (!solid && navOwner[id] !== undefined) { g.unblock(navOwner[id]); delete navOwner[id]; }
  }

  /** Apply now (no overlap check for non-solid targets). Returns true when applied, false when deferred/unknown. */
  function apply(id, state, force) {
    const e = entity(id); if (!e) return false;
    const def = propDef(world, id), solid = !(def && def.colliderOffVariant === state);
    if (solid && !force) {
      const p = playerPos(), t = T(e);
      if (p && current(id) !== state) {
        const r = footprintR(world, e, def);
        if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= r * r && p.z > t.z - 1.2 && p.z < t.z + 3) return false; // player in the gateway
      }
    }
    const c = e.getComponent('voxel');
    if (c.variant !== state) { e.setComponent('voxel', { ...c, variant: state }); if (e.play) e.play(state, { restart: true }); }
    world.state[propKey(id)] = state;
    if (world.rebuildPropColliders) world.rebuildPropColliders();
    syncNav(id, e, def, solid);
    return true;
  }

  return {
    /** Ask for a state; applied now unless the player blocks it (then kept pending, retried by step()). */
    request(id, state) {
      if (!entity(id)) return false;
      if (current(id) === state && world.state[propKey(id)] === state) { delete want[id]; const i = wantIds.indexOf(id); if (i >= 0) wantIds.splice(i, 1); return true; }
      if (apply(id, state, false)) { delete want[id]; const i = wantIds.indexOf(id); if (i >= 0) wantIds.splice(i, 1); return true; }
      if (want[id] === undefined) wantIds.push(id);
      want[id] = state; world.state[propKey(id) + '.want'] = state;
      return false;
    },
    /** Fixed step: retry deferred requests (0 alloc when nothing is pending). */
    step() {
      for (let k = 0; k < wantIds.length; k++) {
        const id = wantIds[k];
        if (apply(id, want[id], false)) { delete want[id]; delete world.state[propKey(id) + '.want']; wantIds.splice(k, 1); k--; }
      }
    },
    /** Current state name ('' unknown prop). */
    get: current,
    /** 'world:loaded': make variant, collider and nav match the saved world.state (and resume deferred requests). */
    reapply() {
      wantIds.length = 0; for (const k of Object.keys(want)) delete want[k];
      for (const k of Object.keys(navOwner)) delete navOwner[k]; // a fresh world/nav: owners restart
      for (const key of Object.keys(world.state)) {
        if (!key.startsWith('prop.')) continue;
        if (key.endsWith('.state')) { const id = key.slice(5, -6); if (entity(id)) apply(id, world.state[key], true); }
      }
      for (const key of Object.keys(world.state)) {
        if (key.startsWith('prop.') && key.endsWith('.state.want')) { const id = key.slice(5, -11); if (entity(id)) { want[id] = world.state[key]; wantIds.push(id); } }
      }
    },
    get pending() { return wantIds.length; },
  };
}
