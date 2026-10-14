// game/js/ui/poiDiscover.js (POI-03, OB-141, D-088): within FOUND_R metres of a POI -> one toast "Found: <plain name>" (never an id), the POI
// gets a '*' on the M map. NO counts, NO reward for finishing. State: `found` flag in poiWire's saved record (world.state['poi.v1']).
//   const pd = createPoiDiscover({ wire, say });  per sim step: pd.step(px, py);  map: pd.marks() -> [{x, y}] (live array, reused)
export const FOUND_R = 12;

export function createPoiDiscover({ wire, say, radius = FOUND_R }) {
  const r2 = radius * radius, marks = [];
  return {
    step(px, py) {
      for (const d of wire.defs) {
        if (wire.isFound(d.id)) continue;
        const dx = d.at[0] - px, dy = d.at[1] - py;
        if (dx * dx + dy * dy > r2) continue;
        wire.markFound(d.id);
        if (say) say('Found: ' + d.name);
      }
    },
    /** Found POIs for the map ({x, y} in metres); same array every call (0 alloc besides growth). */
    marks() {
      marks.length = 0;
      for (const d of wire.defs) if (wire.isFound(d.id)) marks.push({ x: d.at[0], y: d.at[1] });
      return marks;
    },
  };
}
