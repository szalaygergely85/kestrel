// OB-053c: per-structure [dx,dy,dz] metre nudges (tools/coplanar-nudges.json, found by a greedy search against tools/coplanar-lint.mjs)
// that pull free-placed prop stacks off each other's coplanar faces. Generators call applyNudges(out) on their own freshly built rows only.
import fs from 'node:fs';
const NUDGES = JSON.parse(fs.readFileSync(new URL('./coplanar-nudges.json', import.meta.url), 'utf8'));
export function applyNudges(rows) {
  for (const s of rows) { const n = NUDGES[s.id]; if (n) s.origin = { x: +(s.origin.x + n[0]).toFixed(2), y: +(s.origin.y + n[1]).toFixed(2), z: +(s.origin.z + n[2]).toFixed(2) }; }
  return rows;
}
