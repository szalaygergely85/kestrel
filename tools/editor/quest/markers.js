// tools/editor/quest/markers.js - ED-QUEST-04. Pure: the in-view markers of one quest (OB-156 rule).
// questMarkers(q, world, ctx) -> [{ kind:'give'|'return'|'pin'|'area', x,y,z, color, label, radius, obj? }]
//   give   = '!' over the giver, return = '?' over the return character (gold main / blue side),
//   pin    = numbered (step number) at an objective target, area = ring of `radius` on the ground.
// ctx = { sites, floorAt(x,y), topAt(entity)->model top in m (default MARK_DEFAULT_TOP), areaPos(name)->{x,y,z?,r?}|null }
// Marker height = entity base z + model top + margin (game/js/quest/markTop.js, QFIX-S3) - never the terrain/structure
// top under it, so a marker never lands on a roof; area rings sit on the terrain (floorAt).
import { MARK_MARGIN, MARK_DEFAULT_TOP, markZ } from '../../../game/js/quest/markTop.js';
import { isSide } from './flow.js';
import { resolveTarget, AREA_RADIUS } from './targets.js';

export const GOLD = '#ffd24a', BLUE = '#4aa8ff';
export const questColor = (q) => (isSide(q) ? BLUE : GOLD);

/** Area targets of one step as [{x,y,z,r}] - the ONE place that knows how areas are stored (inline spot, legacy when.x/y, or a named area via ctx.areaPos). */
export function stepAreas(step, ctx = {}) {
  const p = step.params || {}, w = step.when || {}, out = [];
  const add = (a) => { if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) out.push({ x: a.x, y: a.y, z: a.z, r: a.r ?? a.radius ?? AREA_RADIUS }); };
  if (p.spot) add(p.spot);
  if (Number.isFinite(w.x) && Number.isFinite(w.y)) add(w);
  const names = [...(p.areas || []), ...(p.area ? [p.area] : []), ...(w.type === 'area' && w.id ? [w.id] : []), ...(w.area ? [w.area] : [])];
  if (!out.length) for (const n of names) add(ctx.areaPos && ctx.areaPos(typeof n === 'string' ? n : n && n.id));
  return out;
}

/** Entity refs of one step (the thing to go to): talk/deliver `to`, kill `ids`, fetch/collect `placement`. */
export function stepRefs(step) {
  const p = step.params || {}, w = step.when || {};
  const refs = [p.to, w.to, p.placement, w.placement, ...(p.ids || [])].filter((r) => typeof r === 'string' && r);
  return [...new Set(refs)];
}

const returnRef = (q) => (q.kind === 'pack' ? q.raw.turnIn || q.raw.site : (q.raw.giver && (q.raw.giver.turnIn || q.raw.giver.npc)) || null);
const giveRef = (q) => (q.kind === 'pack' ? q.raw.site : q.raw.giver && q.raw.giver.npc) || null;

export function questMarkers(q, world, ctx = {}) {
  const color = questColor(q), out = [];
  const topOf = (ent) => (ctx.topAt ? ctx.topAt(ent) : undefined) ?? MARK_DEFAULT_TOP;
  const onEntity = (ref) => {
    const t = resolveTarget(world, ref, ctx); if (!t) return null;
    const ent = (world.entities || []).find((e) => e.id === t.id);
    return { x: t.x, y: t.y, z: markZ(t, topOf(ent)) };
  };
  const g = giveRef(q), gp = g && onEntity(g);
  if (gp) out.push({ kind: 'give', ...gp, color, label: '!', radius: 0 });
  q.objectives.forEach((step, i) => {
    for (const a of stepAreas(step, ctx)) {
      const z = a.z ?? (ctx.floorAt ? ctx.floorAt(a.x, a.y) : 0);
      out.push({ kind: 'area', x: a.x, y: a.y, z, color, label: String(i + 1), radius: a.r, obj: i });
      out.push({ kind: 'pin', x: a.x, y: a.y, z: z + MARK_MARGIN + MARK_DEFAULT_TOP, color, label: String(i + 1), radius: 0, obj: i });
    }
    const ref = stepRefs(step).map(onEntity).find(Boolean);
    if (ref) out.push({ kind: 'pin', ...ref, color, label: String(i + 1), radius: 0, obj: i });
  });
  const r = returnRef(q), rp = r && onEntity(r);
  if (rp) out.push({ kind: 'return', ...rp, color, label: '?', radius: 0 });
  return out;
}

/** Path giver -> pins in step order -> return, as [{x,y,z}] (one point per step: the first pin of each). */
export function questPath(markers) {
  const pts = [], seen = new Set();
  const g = markers.find((m) => m.kind === 'give'); if (g) pts.push(g);
  for (const m of markers) if (m.kind === 'pin' && !seen.has(m.obj)) { seen.add(m.obj); pts.push(m); }
  const r = markers.find((m) => m.kind === 'return'); if (r) pts.push(r);
  return pts.map((m) => ({ x: m.x, y: m.y, z: m.z }));
}

/** Named area -> {x,y,r} through areas.json ({areas:{name:{trigger}}}) and the world's trigger zones; the name itself also works as a trigger id. */
export function makeAreaPos(areasFile, world) {
  const areas = (areasFile && areasFile.areas) || {}, trig = (world && world.triggers) || [];
  return (name) => {
    const id = (areas[name] && areas[name].trigger) || name, t = trig.find((z) => z.id === id);
    return t && Number.isFinite(t.x) ? { x: t.x, y: t.y, r: t.r ?? t.radius } : null;
  };
}
