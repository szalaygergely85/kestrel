// OB-202 follow-up: where does the compass send the player for an item they do not hold yet? Data: content/items/sources.json (item -> source).
// world = { forEachEntity((e, id) => ..), get(id) }; entity shape e.data.{transform, components}. areaPos(areaId, out) -> bool (host: area trigger).
let wantAny = false, best, bd, wantKind, wantItem, fx, fy;
const visit = (e, id) => {
  const d = e.data; if (!d || !d.components || !d.transform) return;
  const c = d.components;
  if (wantKind) { if (!c.brain || typeof id !== 'string' || !id.startsWith(wantKind)) return; const h = c.health; if (h && h.hp <= 0 && !wantAny) return; }
  else if (!c.questPickup || c.questPickup.item !== wantItem) return;
  const t = wantAny && c.brain.home ? { x: c.brain.home[0], y: c.brain.home[1], z: d.transform.z } : d.transform, dd = (t.x - fx) ** 2 + (t.y - fy) ** 2;
  if (!best || dd < bd) { best = t; bd = dd; }
};

/** @returns {boolean} true and fills out.x/y/z when item `id` has a known place to get it (the giver case returns false: nothing to gather). */
export function resolveItemSource(sources, id, world, from, out, areaPos) {
  const s = sources && sources[id]; if (!s) return false;
  let t = null;
  if (s.beast || s.pickup) { best = null; wantKind = s.beast || ''; wantItem = id; fx = from.x; fy = from.y; world.forEachEntity(visit); t = best; best = null;
    if (!t && s.beast) { wantAny = true; world.forEachEntity(visit); t = best; best = null; wantAny = false; } } // OB-207: none alive -> the nearest beast HOME (brain.home = where authored boars and regional herds respawn; the source of truth - spawnAreas.json is unused/empty), never the corpse spot
  else if (s.entity) { const h = world.get(s.entity); t = h && h.data && h.data.transform; }
  else if (s.area) return !!areaPos && areaPos(s.area, out);
  if (!t) return false;
  out.x = t.x; out.y = t.y; out.z = t.z; return true;
}
