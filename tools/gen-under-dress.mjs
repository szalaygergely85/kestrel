// UNDER-DRESS / OB-191 (arch 38.75): dresses the three underground sites (crypt, Ford cellar, strand sea cave) with 14-16 props each
// from EXISTING meshes only (quaternius Prop_Crate/Prop_Brick*/Pebble*/Rock_Medium*/Mushroom_Common/Roof_Log) plus 1-2 level torch lights.
// Mesh structures (kind 'mesh') do not count to the grid-structure cap (6/8 unchanged). Deterministic; re-runnable (ids `dress*`);
// run AFTER tools/gen-crypt.mjs / gen-seacave.mjs (those do not touch `dress*` ids). Every prop is checked: floor cell non-solid and
// >= 0.6 m + radius away from the site's walk path (1.2 m clear corridor). The cave part runs only when strand_cave exists.
//   node tools/gen-under-dress.mjs
import fs from 'node:fs';
import { stringifyContent } from '../engine/index.js';

const r2 = (v) => Math.round(v * 100) / 100;
const FILE = 'content/worlds/world_m1.world.json', d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
d.structures = d.structures.filter((s) => !/^dress/.test(s.id));
const lvl = (name) => { const p = `content/levels/${name}.level.json`; return fs.existsSync(p) ? { p, j: JSON.parse(fs.readFileSync(p, 'utf8')) } : null; };
const distSeg = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const MR = { Prop_Crate: 0.5, Prop_Brick1: 0.3, Prop_Brick2: 0.3, Prop_Brick3: 0.3, Prop_Brick4: 0.3, Rock_Medium_1: 0.6, Rock_Medium_2: 0.6, Rock_Medium_3: 0.6, Mushroom_Common: 0.2, Roof_Log: 0.7 };

function dress(site, structId, level, path, lightsAdd, list) {
  const st = d.structures.find((s) => s.id === structId), L = level.j;
  const cell = (x, y) => { const c = Math.floor(x - st.origin.x), r = Math.floor(y - st.origin.y), ch = L.rows[r]?.[c]; return ch && L.legend[ch]; };
  let n = 0, out = [];
  for (const [m, x, y, dz, yaw, sc] of list) {
    const cl = cell(x, y); if (!cl || cl.solid || cl.terrainFloor) throw new Error(`${site}: prop ${m} at ${x},${y} is not on a floor cell`);
    const rad = (MR[m] ?? 0.4) * sc;
    for (let i = 0; i + 1 < path.length; i++) if (distSeg(x, y, path[i], path[i + 1]) < 0.6 + rad) throw new Error(`${site}: prop ${m} at ${x},${y} blocks the walk path (needs ${r2(0.6 + rad)} m)`);
    const fz = st.origin.z + cl.floorH;
    out.push({ id: `dress${site}${++n}`, mesh: 'quaternius/' + m, origin: { x, y, z: r2(fz + dz) }, scale: sc, yawDeg: yaw, castShadow: true });
  }
  if (n < 12 || n > 20) throw new Error(`${site}: ${n} props (want 12-20)`);
  const at = d.structures.reduce((a, s, i) => (s.id.startsWith(structId) || s.id.startsWith(site.toLowerCase()) ? i : a), d.structures.findIndex((s) => s.id === structId));
  d.structures.splice(at + 1, 0, ...out);
  L.lights = (L.lights || []).filter((l) => !/^dressTorch/.test(l.id)).concat(lightsAdd.map((l, i) => ({ id: `dressTorch${i + 1}`, on: true, preset: 'torch', ...l })));
  fs.writeFileSync(level.p, stringifyContent(L), 'utf8'); // canonical form (gen-crypt writes plain JSON)
  console.log(site, n, 'props,', lightsAdd.length, 'torch lights');
}

// crypt (origin 1650,1346; floor -56.8): walls/corner clutter only; path = door -> corridor spine x 1675.2 north through the 3 rooms
const crypt = lvl('crypt');
dress('Crypt', 'crypt', crypt, [[1670.5, 1373], [1675.2, 1373], [1675.2, 1350.5]], [], [
  ['Prop_Crate', 1677.3, 1375.1, 0, 20, 0.8], ['Prop_Crate', 1677.4, 1374.0, 0, 95, 0.7], ['Pebble_Round_2', 1671.7, 1369.7, 0, 40, 1], ['Rock_Medium_1', 1672.3, 1370.4, 0, 70, 0.5],
  ['Prop_Brick2', 1677.4, 1369.8, 0, 110, 1], ['Pebble_Square_3', 1671.6, 1375.4, 0, 200, 1],
  ['Prop_Crate', 1671.9, 1359.8, 0, 10, 0.8], ['Prop_Crate', 1671.8, 1361.0, 0, 80, 0.7], ['Prop_Brick1', 1672.1, 1365.2, 0, 250, 1], ['Rock_Medium_2', 1677.4, 1359.8, 0, 140, 0.55],
  ['Pebble_Round_4', 1677.3, 1365.3, 0, 30, 1],
  ['Prop_Crate', 1677.3, 1349.7, 0, 5, 0.9], ['Prop_Crate', 1677.4, 1351.0, 0, 100, 0.75], ['Prop_Crate', 1677.3, 1349.7, 0.9, 40, 0.65], ['Rock_Medium_3', 1677.4, 1355.3, 0, 60, 0.5],
  ['Pebble_Round_1', 1671.8, 1355.3, 0, 150, 1], ['Prop_Brick4', 1672.1, 1354.0, 0, 200, 1],
]);

// Ford cellar (origin 996,1055; floor -92.5, room 998..1004 x 1057..1063): ladder (1000.5,1058.7), chests west/east/south; extra torch on the north + south walls
const cel = lvl('ford_cellar');
dress('Cellar', 'fordCellar', cel, [[1000.5, 1058.6], [1000.5, 1062.2], [999.4, 1060.5], [1002.6, 1060.5]], [{ x: 998.4 - 996, y: 1058.4 - 1055, z: 1.7 }, { x: 1003.6 - 996, y: 1062.5 - 1055, z: 1.7 }], [
  ['Prop_Crate', 998.5, 1057.5, 0, 12, 0.9], ['Prop_Crate', 998.5, 1057.5, 0.98, 50, 0.7], ['Prop_Crate', 999.3, 1057.45, 0, 190, 0.75], ['Prop_Crate', 1003.65, 1057.45, 0, 95, 0.85],
  ['Prop_Crate', 1003.6, 1058.7, 0, 340, 0.75], ['Prop_Crate', 1003.6, 1062.45, 0, 20, 0.85], ['Prop_Crate', 998.5, 1062.5, 0, 200, 0.9], ['Prop_Crate', 998.5, 1061.6, 0, 80, 0.7],
  ['Prop_Crate', 999.4, 1062.55, 0, 150, 0.65], ['Prop_Brick1', 998.6, 1059.1, 0, 30, 1], ['Prop_Brick3', 1003.6, 1059.4, 0, 120, 0.9], ['Pebble_Round_3', 999.1, 1061.9, 0, 10, 1],
  ['Pebble_Square_2', 1002.4, 1062.5, 0, 70, 1], ['Pebble_Round_5', 1002.9, 1058.2, 0, 160, 0.9],
]);

// strand sea cave (origin 1606,1700; chamber 1613..1624 x 1722..1730, mouth in the south wall at x 1616..1621)
const cave = lvl('strand_cave');
if (cave) dress('Cave', 'strandCave', cave, [[1618.5, 1731], [1618.5, 1723.5]], [{ x: 1623.2 - 1611, y: 1726.5 - 1720, z: 1.5 }], [
  ['Prop_Crate', 1622.9, 1728.6, 0, 20, 0.8], ['Prop_Crate', 1623.2, 1727.3, 0, 100, 0.7], ['Prop_Crate', 1622.9, 1728.6, 0.8, 60, 0.6], ['Mushroom_Common', 1613.9, 1728.9, 0, 0, 1],
  ['Mushroom_Common', 1614.5, 1729.2, 0, 90, 0.8], ['Mushroom_Common', 1623.2, 1723.0, 0, 40, 0.9], ['Mushroom_Common', 1622.6, 1722.8, 0, 200, 0.7], ['Pebble_Round_2', 1614.2, 1727.6, 0, 10, 1],
  ['Pebble_Square_5', 1623.4, 1725.8, 0, 130, 1], ['Rock_Medium_2', 1622.3, 1725.0, 0, 80, 0.6], ['Rock_Medium_1', 1614.6, 1728.2, 0, 300, 0.5], ['Prop_Brick1', 1623.0, 1724.1, 0, 15, 1],
  ['Roof_Log', 1622.4, 1729.6, 0, 70, 0.7], ['Pebble_Round_4', 1614.3, 1722.9, 0, 220, 1],
]); else console.log('strand_cave level not in this tree: cave part skipped (run again after merging UNDER-05)');

fs.writeFileSync(FILE, stringifyContent(d), 'utf8');
