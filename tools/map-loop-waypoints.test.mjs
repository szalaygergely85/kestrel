// WM-06: the mapLoop waypoint list is well-formed and (today's polygon) inside, or flagged. Run: node tools/map-loop-waypoints.test.mjs
import geoMod from '../design/levels/world_geo.js';
import { MAP_LOOP, mapLoopFull, mapLoopPoses, inPolygon, outsideBounds } from './map-loop-waypoints.mjs';
globalThis.window = globalThis.window || globalThis; geoMod;
const geo = globalThis.ASSETS.levels.world_geo;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
ok(MAP_LOOP.length >= 13 && new Set(MAP_LOOP.map((w) => w.n)).size === MAP_LOOP.length, 'unique named stops');
ok(mapLoopPoses().length === 6, '6 save/load poses');
const full = mapLoopFull(); ok(full[0].n === 'tower' && full[full.length - 1].n === 'tower', 'loop returns toward the tower');
for (const k of ['Glasswater', 'Northwood', 'Ash Mile', 'Downs', 'Strand', 'Reedmire', 'Signal Head', 'Heath', 'Thornwood', 'High Pastures', 'Gate']) ok(MAP_LOOP.some((w) => w.n.startsWith(k)), 'visits ' + k);
const pts = geo.bounds.pts;
ok(inPolygon(pts, 1470, 1029) && !inPolygon(pts, 5, 5), 'polygon test sane');
const out = outsideBounds(pts);
console.log('waypoints outside today\'s bounds (WM-05 widens; flagged, not failed): ' + (out.map((w) => w.n).join(', ') || 'none'));
ok(out.length <= 2, 'at most 2 stops outside today\'s polygon (' + out.length + ')');
console.log(fails ? 'FAILED ' + fails : 'map-loop-waypoints.test: all ok'); process.exit(fails ? 1 : 0);
