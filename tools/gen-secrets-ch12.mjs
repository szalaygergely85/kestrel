// OB-152: world json no longer has secretBend/secretField/secretBank and secretRook sits in campEast - see tools/anchor-chests.mjs. Do not re-run this generator wholesale.
// US-104a (M5 sprint 3): four hidden chests for Ch1-2, each off the road but in view of it (existing chest entity + chestSmall model, no new art).
//   secretRook (behind the Rook ruin), secretBend (forest hollow N of the Bend), secretField (field edge W of the Bend), secretBank (river bank at the ford).
// Per zone a seeded search finds the first spot that passes: 8..25 m from the road centre line, >= 8 m from the route-walk lines, >= 3 m from every other placement /
// solid mesh origin, on plain ground (not path / water), flat, inside the walk bounds, terrain line of sight from the nearest road point, and a 1 m grid path from that point
// (step/solid-circle checked, like the walk). Writes entities secretRook/secretBend/secretField/secretBank into content/worlds/world_m1.world.json; re-runnable, deterministic.
// Loot tables: game/js/quest/sim/chestDefs.js (SECRET_TABLE = the chest source of content/items/loot.json: gear 8 %, arrows, potion).
// Usage: node tools/gen-secrets-ch12.mjs [--seed N] [--dry-run] [--json]   (exports buildSecrets() for the test)
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent, forwardOf } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';

const argv = process.argv.slice(2);
const argN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const SEED = argN('--seed', 20261012), dry = argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
export const SECRET_IDS = ['secretRook', 'secretBend', 'secretField', 'secretBank'];
export const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066], [985, 1040]]; // road centre (as gen-road-props.mjs) + the ford track to owPathPost (985,1040), so the Rook zone has a road
export const LINES = [ // route-walk legs + Burl's walks + the 9b bound probe west of the ford (as gen-road-props.mjs)
  [[1485.5, 1025.5], [1470, 1029], [1428, 1040]], [[1420, 1032], [1350, 1050], [1270, 1042], [1263, 1034]],
  [[1260, 1045], [1180, 1062], [1090, 1070], [1046, 1069], [1010, 1070], [993, 1077]], [[1310, 1048], [1260, 1045]],
  [[1471, 1029.1], [1462, 1031], [1452, 1034], [1443, 1037], [1436, 1040], [1431.5, 1041.5], [1426, 1034], [1418, 1026], [1410, 1018], [1404, 1010]],
  [[1008, 1075], [950, 1075]], [[1000, 1066], [985, 1040]]];
// search discs (centre, radius); the first passing seeded sample in a disc wins
const ZONES = [
  { id: 'secretRook', c: [972, 1036], r: 16, note: 'behind the Rook ruin (north side, away from the ford road)' },
  { id: 'secretBend', c: [1345, 1028], r: 14, note: 'forest hollow north of the Bend' },
  { id: 'secretField', c: [1222, 1076], r: 14, note: 'field edge south of the road west of the Bend relay' },
  { id: 'secretBank', c: [1050, 1088], r: 14, note: 'river bank south-east of the ford' },
];
const CHEST = { voxel: { anim: 'closed', loop: false, model: 'chestSmall' } };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function segNear(x, y, P) { // nearest point on a polyline + its distance
  let best = { d: Infinity, x: 0, y: 0 };
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], dx = P[i + 1][0] - ax, dy = P[i + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py); if (d < best.d) best = { d, x: px, y: py };
  }
  return best;
}
const partOver = (p, x, y, rad) => {
  if (p.shape === 'polygon') { // WM-05/D-077: exact signed distance to the polygon (<= 0 inside after the body radius)
    let inside = false, d = Infinity;
    const q = p.pts;
    for (let i = 0, n = q.length; i < n; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % n], ex = bx - ax, ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(x - ax - t * ex, y - ay - t * ey));
      if ((ay > y) !== (by > y) && x < ax + (y - ay) / (by - ay) * ex) inside = !inside;
    }
    return inside ? rad - d : d + rad;
  }
  if (p.shape === 'circle') return Math.hypot(x - p.x, y - p.y) - (p.r - rad);
  const dx = p.bx - p.ax, dy = p.by - p.ay, t = Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - p.ax - t * dx, y - p.ay - t * dy) - (p.r - rad);
};

let assetsP = null;
// cfg (US-104b): { ids, zones, path, lines, tag } = another region's chests (default = the US-104a Ch1-2 set, output unchanged).
export async function buildSecrets(data0, seed = SEED, cfg = {}) {
  const IDS = cfg.ids || SECRET_IDS, ZN = cfg.zones || ZONES, ROAD = cfg.path || PATH, LN = cfg.lines || LINES, TAG = cfg.tag || 'US-104a Ch1-2 hidden chest';
  const data = JSON.parse(JSON.stringify(data0));
  const at = data.entities.findIndex((e) => IDS.includes(e.id)); // re-insert where the old ones were (stable order next to other generators' chests)
  data.entities = data.entities.filter((e) => !IDS.includes(e.id));
  const { assets } = await (assetsP ??= loadTestAssets()); // once per process (a second load would double-register the levels)
  const world = World.load(data, assets, { physics: 'mesh' });
  const T = world.terrain;
  const gz = (x, y) => { world.ensureBandFor(x, y); return T.groundAt(x, y); };
  world.ensureBandFor(1040, 1068);
  const TYPE_PATH = T.groundTypeAt(1350, 1050), TYPE_WATER = T.groundTypeAt(1028, 1068);
  const SOFT = /Grass|Flower|Clover|Fern|Plant_|Pebble|Mushroom/;
  const solid = [], marks = []; // solid = [x,y,r] for the walk grid; marks = [x,y,minDist] separation
  for (const s of data.structures) if (s.mesh && s.origin) {
    const soft = SOFT.test(s.mesh), b = assets.mesh(s.mesh).bbox, sc = typeof s.scale === 'number' ? s.scale : 1;
    const r = /Tree|Pine/.test(s.mesh) ? 0.8 : Math.min(2.5, 0.45 * sc * Math.max(b[3] - b[0], b[4] - b[1]));
    marks.push([s.origin.x, s.origin.y, soft ? 0.5 : 3]);
    if (!soft && s.collide !== false) solid.push([s.origin.x, s.origin.y, r + 0.4]);
  }
  for (const e of data.entities) { const x = e.x ?? e.transform?.x, y = e.y ?? e.transform?.y; if (typeof x === 'number') marks.push([x, y, 3]); }
  const inBounds = (x, y) => (data.bounds.parts || [data.bounds]).some((p) => partOver(p, x, y, 1.0) <= 0);
  const free = (x, y) => { for (const [sx, sy, r] of solid) if (Math.hypot(sx - x, sy - y) < r) return false; return T.groundTypeAt(x, y) !== TYPE_WATER; };
  function losOk(ax, ay, bx, by) { // terrain line of sight: eye 1.7 m over the road point -> 0.6 m over the chest
    const za = gz(ax, ay) + 1.7, zb = gz(bx, by) + 0.6, n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let i = 1; i < n; i++) { const f = i / n; if (gz(ax + (bx - ax) * f, ay + (by - ay) * f) > za + (zb - za) * f) return false; }
    return true;
  }
  function reachable(sx, sy, tx, ty) { // 1 m grid BFS, 8-connected, step <= 0.9 m, around solids/water, within bounds
    const key = (x, y) => x * 4096 + y, rx = Math.round(sx), ry = Math.round(sy), seen = new Set([key(rx, ry)]), q = [[rx, ry]];
    for (let h = 0; h < q.length && q.length < 8000; h++) {
      const [x, y] = q[h]; if (Math.hypot(x - tx, y - ty) <= 1.5) return true;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (seen.has(k) || Math.abs(nx - sx) > 45 || Math.abs(ny - sy) > 45) continue;
        if (!inBounds(nx, ny) || !free(nx, ny) || Math.abs(gz(nx, ny) - gz(x, y)) > 0.9) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return false;
  }
  const R = rng(seed), out = [], log = [], why = {};
  const no = (k) => { why[k] = (why[k] || 0) + 1; return false; };
  for (const z of ZN) {
    let done = null;
    for (let i = 0; i < 4000 && !done; i++) {
      const a = R() * 2 * Math.PI, d = Math.sqrt(R()) * z.r, x = +(z.c[0] + Math.cos(a) * d).toFixed(1), y = +(z.c[1] + Math.sin(a) * d).toFixed(1);
      const road = segNear(x, y, ROAD); if (road.d < 8 || road.d > 25) { no('roadDist'); continue; }
      if (LN.some((P) => segNear(x, y, P).d < 8)) { no('line'); continue; }
      if (marks.some(([mx, my, md]) => Math.hypot(mx - x, my - y) < md)) { no('mark'); continue; }
      if (!inBounds(x, y) || !free(x, y) || T.groundTypeAt(x, y) === TYPE_PATH) { no('ground/bounds'); continue; }
      const g = gz(x, y); let flat = true; for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Math.abs(gz(x + ox, y + oy) - g) > 0.35) flat = false; if (!flat) { no('flat'); continue; }
      if (!losOk(road.x, road.y, x, y)) { no('los'); continue; }
      if (!reachable(road.x, road.y, x, y)) { no('reach'); continue; }
      // yaw: front faces the nearest road point (invert forwardOf by search)
      const wx = road.x - x, wy = road.y - y, f = [0, 0]; let yaw = 0, bd = -2;
      for (let yy = 0; yy < 360; yy += 5) { forwardOf(yy, f); const dd = (f[0] * wx + f[1] * wy) / road.d; if (dd > bd) { bd = dd; yaw = yy; } }
      done = { id: z.id, x, y, yaw, road };
    }
    if (!done) throw new Error('no spot for ' + z.id + ' ' + JSON.stringify(why));
    marks.push([done.x, done.y, 3]);
    out.push({ id: z.id, type: 'prop', x: done.x, y: done.y, yawDeg: done.yaw, z: 'ground', components: CHEST, note: `${TAG} (${z.note}); ${done.road.d.toFixed(1)} m from the road at (${done.road.x.toFixed(1)}, ${done.road.y.toFixed(1)}); table ${cfg.table || 'SECRET_TABLE'} in chestDefs.js` });
    log.push({ id: z.id, x: done.x, y: done.y, roadDist: +done.road.d.toFixed(1), roadPoint: [+done.road.x.toFixed(1), +done.road.y.toFixed(1)] });
  }
  if (at >= 0) data.entities.splice(at, 0, ...out); else data.entities.push(...out);
  return { data, log };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const { data, log } = await buildSecrets(JSON.parse(fs.readFileSync(FILE, 'utf8')), SEED);
  console.log(argv.includes('--json') ? JSON.stringify(log) : log.map((l) => `${l.id} (${l.x}, ${l.y}) road ${l.roadDist} m @ ${l.roadPoint}`).join('\n'));
  if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
}
