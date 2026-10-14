// tools/editor/ai/spawnAreas.js - ED-AI-04. Plain-language validator for content/beasts/spawnAreas.json (painted spawn areas).
// Pure: no fs, no game/ import (check-deps), never throws; returns an array of messages.
// Shape: { "areas": [ { id, shape:'disc', x, y, r } | { id, shape:'polygon', pts:[[x,y],..] }, + kind, count, respawnSec, when } ]
export const AREA_WHEN = Object.freeze(['day', 'night', 'both']);
export const AREA_SHAPES = Object.freeze(['disc', 'polygon']);
export const AREA_MAX_COUNT = 12, AREA_MIN_RESPAWN = 30, AREA_MAX_RESPAWN = 7200, AREA_MAX_COORD = 8192;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** `kinds` (optional) = the kinds.json table; when given the kind must exist. */
export function validateSpawnAreas(file, kinds) {
  const e = [];
  if (!file || typeof file !== 'object' || Array.isArray(file) || !Array.isArray(file.areas)) return ['Spawn areas: the file must look like {"areas": [...]}.'];
  const seen = new Set();
  file.areas.forEach((a, i) => {
    const who = `Spawn area ${a && a.id ? `"${a.id}"` : '#' + (i + 1)}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) { e.push(`${who} is not an object.`); return; }
    if (typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(a.id)) e.push(`${who}: id must be lower-case letters, digits, - or _ (e.g. "east-meadow").`);
    else if (seen.has(a.id)) e.push(`${who}: id is used twice; every area needs its own id.`);
    else seen.add(a.id);
    if (!AREA_SHAPES.includes(a.shape)) e.push(`${who}: shape must be disc or polygon, but is ${JSON.stringify(a.shape)}.`);
    else if (a.shape === 'disc') {
      if (!num(a.x) || !num(a.y)) e.push(`${who}: a disc needs a centre x and y (numbers).`);
      else if (Math.abs(a.x) > AREA_MAX_COORD || Math.abs(a.y) > AREA_MAX_COORD) e.push(`${who}: the centre is outside the world (+-${AREA_MAX_COORD} m).`);
      if (!num(a.r) || a.r < 5 || a.r > 300) e.push(`${who}: radius r must be between 5 and 300 m, but is ${JSON.stringify(a.r)}.`);
    } else {
      if (!Array.isArray(a.pts) || a.pts.length < 3) e.push(`${who}: a polygon needs at least 3 corner points.`);
      else if (a.pts.some((p) => !Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1]) || Math.abs(p[0]) > AREA_MAX_COORD || Math.abs(p[1]) > AREA_MAX_COORD)) e.push(`${who}: every polygon point must be [x, y] numbers inside the world.`);
    }
    if (typeof a.kind !== 'string' || !a.kind) e.push(`${who}: kind (the beast kind, e.g. "boar") is missing.`);
    else if (kinds && !kinds[a.kind]) e.push(`${who}: kind "${a.kind}" is not a known beast kind.`);
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > AREA_MAX_COUNT) e.push(`${who}: count must be a whole number from 1 to ${AREA_MAX_COUNT}, but is ${JSON.stringify(a.count)}.`);
    if (!num(a.respawnSec) || a.respawnSec < AREA_MIN_RESPAWN || a.respawnSec > AREA_MAX_RESPAWN) e.push(`${who}: respawnSec must be between ${AREA_MIN_RESPAWN} and ${AREA_MAX_RESPAWN} seconds, but is ${JSON.stringify(a.respawnSec)}.`);
    if (!AREA_WHEN.includes(a.when)) e.push(`${who}: when must be one of ${AREA_WHEN.join(', ')}, but is ${JSON.stringify(a.when)}.`);
  });
  return e;
}
