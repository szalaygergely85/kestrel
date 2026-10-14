// game/js/quest/worldMap.test.js (WM-10). Run: node --expose-gc game/js/quest/worldMap.test.js
import '../../../design/palette.js';
import '../../../design/ui-region-banner.js';
import '../../../design/levels/world_geo.js';
import { createWorldMapCard, worldBox, worldMapSize } from './worldMap.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const A = globalThis.ASSETS, geo = A.levels.world_geo, names = A.uiRegionBanner.names, palette = A.palette;
const PRESETS = [[240, 90], [320, 120], [400, 150], [560, 210], [160, 60]];
const mk = (seen, cols = 240, rows = 90, extra = {}) => { const box = worldBox(geo), s = worldMapSize(box, cols, rows); return { s, v: createWorldMapCard(geo, names, palette, { getSeen: () => seen, w: s.w, h: s.h, ...extra }) }; };
const text = (v) => { let t = ''; const a = v.art; for (let y = 0; y < a.h; y++) { for (let x = 0; x < a.w; x++) t += String.fromCharCode(a.codes[y * a.w + x] || 32); t += '\n'; } return t; };

// projection: every bounds vertex lands inside the panel interior, panel fits the grid, at every preset
for (const [cols, rows] of PRESETS) {
  const { s, v } = mk([], cols, rows);
  ok(`fits ${cols}x${rows}: ${s.w}x${s.h}`, s.w <= cols - 4 && s.h <= rows - 4 && s.w >= 24 && s.h >= 12);
  let inside = true;
  for (const [x, y] of geo.bounds.pts) { const i = v.index(x, y); const cx = i % s.w, cy = (i / s.w) | 0; if (i < 0 || cx < 1 || cy < 1 || cx > s.w - 2 || cy > s.h - 2) inside = false; }
  ok(`bounds polygon inside panel ${cols}x${rows}`, inside);
  const a = v.index(100, 200), b = v.index(1800, 1600);
  ok('projection monotone (east/south = right/down)', (b % s.w) > (a % s.w) && ((b / s.w) | 0) > ((a / s.w) | 0));
  ok('outside box -> -1', v.index(-500, 0) < 0 && v.index(NaN, 1) < 0);
}

// fog: unseen regions are not named, seen are
{
  const none = text(mk([]).v), some = mk(['whitecombs', 'ford']).v, t2 = text(some);
  ok('fresh save names nothing', !/Whitecombs|Crossroads|Watchtower|Northwood|Glasswater|Hollins/.test(none));
  ok('seen region named (Whitecombs)', t2.includes('The Whitecombs'));
  ok('seen region named (Crossroads)', t2.includes('The Crossroads'));
  ok('unseen region stays unnamed', !t2.includes('Northwood') && !t2.includes('Glasswater'));
  ok('roadWest seen is named (WMP-10: The West Road)', text(mk(['roadWest']).v).includes('The West Road'));
  const all = text(mk(geo.regions.map((r) => r.id)).v);
  ok('all seen: every named region appears at 240x90', Object.entries(names).filter(([id, n]) => n && id !== 'east') /* east = off-limits strip outside the walk bounds */.every(([, n]) => all.includes(n)) || (console.log('  missing:', Object.entries(names).filter(([id, n]) => n && id !== 'east' && !all.includes(n)).map((e) => e[1]).join(',')), false));
  ok('fog glyph for unseen land', none.includes('.') && !none.includes('|'));
}

// markers: relay + player + travel digits + quest
{
  const seen = ['ford']; const { v, s } = mk(seen);
  v.setMarker(1050, 1050, 'relay'); v.setChartPieces();
  const ri = v.index(1050, 1050);
  ok('relay marker placed (o)', v.art.codes[ri] === 111);
  ok('updatePose draws arrow by yaw', v.updatePose(1300, 1000, 0) && v.position.code === 94 && v.art.codes[v.index(1300, 1000)] === 94);
  v.updatePose(1300, 1000, 90); ok('yaw 90 -> >', v.position.code === 62);
  v.updatePose(1300, 1000, 180); ok('yaw 180 -> v', v.position.code === 118);
  v.updatePose(1300, 1000, 270); ok('yaw 270 -> <', v.position.code === 60);
  v.updatePose(1301, 1001, 0);
  ok('old cell restored when arrow moves', v.art.codes[v.index(1300, 1000)] !== 118 && v.art.codes[v.index(1300, 1000)] !== 60 && v.art.codes[v.index(1301, 1001)] === 94);
  ok('off-map pose hides the arrow', v.updatePose(-900, 0, 0) === false && v.position.x === -1);
  v.setTravelPoints([{ id: 'ws_a', name: 'Ford', x: 1000, y: 1050, order: 1 }, { id: 'ws_b', name: 'Bend', x: 1200, y: 1050, order: 2 }]);
  v.setChartPieces();
  ok('travel digits 1,2', v.art.codes[v.index(1000, 1050)] === 49 && v.art.codes[v.index(1200, 1050)] === 50 && v.travelIdFor(2) === 'ws_b' && v.travelIdFor(3) === null);
  ok('travel line on border', v.travelLine.includes('1 Ford') && text(v).includes('1 Ford'));
  v.setQuestMarkers([{ kind: 'quest', x: 1500, y: 1000 }, { kind: 'questReady', x: 1600, y: 1000 }]);
  ok('quest marks ! ?', v.art.codes[v.index(1500, 1000)] === 33 && v.art.codes[v.index(1600, 1000)] === 63);
  seen.push('whitecombs'); v.setChartPieces(); ok('reopen re-reads region.seen', text(v).includes('The Whitecombs'));
}

// save/load: region.seen is a plain world.state array (regionBanner owns it); a card built from a loaded state shows the same names
{
  const state = JSON.parse(JSON.stringify({ 'region.seen': ['tower', 'ford'] }));
  const t = text(mk(state['region.seen']).v);
  ok('loaded region.seen restores names', t.includes('The Watchtower') && t.includes('The Crossroads'));
}

// 0 alloc per frame: heap growth over many updatePose calls stays ~0
{
  const { v } = mk(['ford', 'tower']); v.updatePose(1200, 1000, 10);
  if (globalThis.gc) {
    for (let i = 0; i < 2000; i++) v.updatePose(1000 + (i % 400), 1000 + (i % 90), i); // warm
    globalThis.gc(); const m0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) v.updatePose(1000 + (i % 400), 1000 + (i % 90), i % 360);
    globalThis.gc(); const d = process.memoryUsage().heapUsed - m0;
    ok(`0 alloc: heap delta ${d} B over 200k frames`, d < 64 * 1024);
  } else console.log('  (skipped 0-alloc probe: run with --expose-gc)');
}

console.log(`worldMap: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
