// tools/editor/quest/targets.js - ED-QUEST-03. Pure (imports model.js + flow.js only): what a click in the 3D view means
// for a quest slot. world = world json ({entities:[...]}); ctx = { sites, floorAt(x,y), areaRadius }.
// Characters = NPCs with dialogue (D-082). Objects = props (inspect posts, notes). Enemies = beasts (brain component).
import { setQuestField } from './model.js';
import { objField } from './flow.js';

export const AREA_RADIUS = 4;
export const NOT_CHARACTER = 'Pick a character, not an object';

const entityOf = (world, id) => (world.entities || []).find((e) => e.id === id) || null;

/** 'character' | 'enemy' | 'object' for a world entity record. */
export function classify(e) {
  const c = (e && e.components) || {};
  if (e && (e.type === 'npc' || c.dialogue)) return 'character';
  if (c.brain || (e && e.type === 'beast')) return 'enemy';
  return 'object';
}

/** Enemy kind = the model name of the beast (boarPlaceholder -> boar). */
export function enemyKind(e) {
  const m = ((e.components && e.components.voxel && e.components.voxel.model) || e.id).replace(/Placeholder$/, '');
  return m.replace(/\d+$/, '');
}

/** Site id that points at this entity (sites.json), else the entity id itself. */
export function siteFor(sites, entityId) {
  for (const k of Object.keys(sites || {})) if (sites[k].entity === entityId) return k;
  return entityId;
}

/** Resolve a ref to {kind,id,x,y,z}: an entity id or a site id -> character/enemy/object; null when unknown. */
export function resolveTarget(world, ref, ctx = {}) {
  const sites = ctx.sites || {};
  const id = sites[ref] && sites[ref].entity ? sites[ref].entity : ref;
  const e = entityOf(world, id);
  if (!e || !Number.isFinite(e.x)) return null;
  const z = typeof e.z === 'number' ? e.z : (ctx.floorAt ? ctx.floorAt(e.x, e.y) : 0);
  return { kind: classify(e), id: e.id, x: e.x, y: e.y, z };
}

/** A ground click -> area target, z snapped to the terrain (OB-155). */
export function groundTarget(point, ctx = {}) {
  const z = ctx.floorAt ? ctx.floorAt(point.x, point.y) : point.z;
  return { kind: 'area', id: null, x: +point.x.toFixed(2), y: +point.y.toFixed(2), z: +z.toFixed(2), radius: ctx.areaRadius || AREA_RADIUS };
}

/** Which target kind an objective step accepts: 'character' | 'area' | 'enemy' | 'object' | null. */
export function stepWants(step) {
  if (step.template) return { talk: 'character', deliver: 'character', explore: 'area', kill: 'enemy', fetch: 'object', collect: 'object', escort: 'character' }[step.template] || null;
  const t = step.when && step.when.type;
  return { area: 'area', item: 'object', deliver: 'character', talk: 'character' }[t] || null;
}

const fail = (error) => ({ cmd: null, error });

/**
 * slot = 'giver' | 'return' | { obj: index }. hit = { entityId?, point? } from the viewport.
 * Returns { cmd, error }: cmd is a model command (run it on the stack = one undo step), error is plain text or null.
 */
export function applyPick(q, slot, hit, world, ctx = {}) {
  const ent = hit.entityId ? entityOf(world, hit.entityId) : null;
  const kind = ent ? classify(ent) : (hit.point ? 'ground' : null);
  if (!kind) return fail('Nothing there to pick');
  const pack = q.kind === 'pack';
  if (slot === 'giver' || slot === 'return') {
    const okObject = slot === 'giver' && q.raw.objectGiver === true && kind === 'object';   // D-087
    if (kind !== 'character' && !okObject) return fail(NOT_CHARACTER);
    const ref = pack ? siteFor(ctx.sites, ent.id) : ent.id;
    if (slot === 'giver') {
      return pack ? { cmd: setQuestField(q, 'site', ref), error: null }
        : { cmd: setQuestField(q, 'giver', { ...(q.raw.giver || {}), npc: ref }), error: null };
    }
    return pack ? { cmd: setQuestField(q, 'turnIn', ref), error: null }
      : { cmd: setQuestField(q, 'giver', { ...(q.raw.giver || {}), turnIn: ref }), error: null };
  }
  const i = slot.obj, field = objField(q), step = q.raw[field][i];
  if (!step) return fail('No such step');
  const want = stepWants(step);
  if (!want) return fail('This step has no target to pick');
  if (kind === 'ground' ? want !== 'area' : want !== kind && !(want === 'object' && kind === 'object')) {
    return fail(want === 'character' ? NOT_CHARACTER : want === 'area' ? 'Click the ground for this step' : want === 'enemy' ? 'Pick an enemy' : 'Pick an item or object');
  }
  let next;
  if (want === 'area') {
    const g = groundTarget(hit.point, ctx), spot = { x: g.x, y: g.y, z: g.z, r: g.radius };
    next = step.template ? { ...step, params: { ...step.params, spot } } : { ...step, when: { ...step.when, ...spot, radius: g.radius } };
  } else if (want === 'character') {
    const ref = step.template ? siteFor(ctx.sites, ent.id) : ent.id;
    next = step.template ? { ...step, params: { ...step.params, to: ref } } : { ...step, when: { ...step.when, to: ref } };
  } else if (want === 'enemy') {
    const params = { ...step.params, kind: enemyKind(ent) }; delete params.ids;
    next = { ...step, params };
  } else {
    next = step.template ? { ...step, params: { ...step.params, placement: ent.id } } : { ...step, when: { ...step.when, placement: ent.id } };
  }
  const list = q.raw[field].map((o, k) => (k === i ? next : o));
  return { cmd: setQuestField(q, field, list), error: null };
}
