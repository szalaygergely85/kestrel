// OB-141: POIs per km2 for every region (first-match rect rule of world_geo.regions). Pure JSON + geo data. Exports poiReport().
import fs from 'node:fs';
globalThis.window = globalThis.window || globalThis;
import '../design/palette.js'; import '../design/detail-pass.js'; import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
const G = globalThis.ASSETS.levels.world_geo;
const geo = (G.util && G.util.geo) || G.geo || G;
export function poiReport() {
  const regions = (geo.regions || (G.util && G.util.G && G.util.G.regions));
  const w = JSON.parse(fs.readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
  const camps = JSON.parse(fs.readFileSync(new URL('../content/life/goblinCamps.json', import.meta.url), 'utf8')).camps.filter((c) => c.enabled !== false);
  const base = (x, y) => { for (const R of regions) { const r = R.r; if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return R; } return regions[regions.length - 1]; };
  // the catch-all heartland straddles the river: east of x=1000 = tower side (2-3), west = far side (5-6)
  const regAt = (x, y) => { const R = base(x, y); return R.id === 'heartland' ? (x < 1000 ? { ...R, id: 'heartlandW', lv: R.lvWest } : { ...R, id: 'heartlandE' }) : R; };
  const raw = [];
  for (const c of camps) raw.push({ id: c.id, x: c.at[0], y: c.at[1], k: 'camp' });
  for (const e of w.entities) {
    if (e.type === 'player' || e.x == null) continue;
    if (e.type === 'prop' && !(e.components && (e.components.inspect || /chest/.test(e.id)))) continue;
    if (/^gob|Boar[23]$/.test(e.id)) continue;
    raw.push({ id: e.id, x: e.x, y: e.y, k: e.type === 'npc' ? 'npc' : e.type === 'beast' ? 'beasts' : /chest/i.test(e.id) ? 'chest' : 'look' });
  }
  const pts = []; // cluster: points within 25 m of an earlier kept point of a different..same cluster count once
  for (const p of raw) if (!pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 25)) pts.push(p);
  const area = {}; const cnt = {}; const list = {};
  for (let x = 5; x < 1880; x += 10) for (let y = 5; y < 2048; y += 10) { const R = regAt(x, y); if (R.lv == null) continue; area[R.id] = (area[R.id] || 0) + 100; }
  for (const p of pts) { const R = regAt(p.x, p.y); cnt[R.id] = (cnt[R.id] || 0) + 1; (list[R.id] = list[R.id] || []).push(p.id); }
  const all = [...regions, { id: 'heartlandW', lv: [5, 6] }, { id: 'heartlandE', lv: [2, 3] }];
  return all.filter((R) => area[R.id]).map((R) => ({ id: R.id, lv: R.lv, km2: area[R.id] / 1e6, n: cnt[R.id] || 0, perKm2: (cnt[R.id] || 0) / (area[R.id] / 1e6), ids: list[R.id] || [] }));
}
if (process.argv[1] && process.argv[1].endsWith('poi-regions.probe.mjs')) {
  for (const r of poiReport().sort((a, b) => a.perKm2 - b.perKm2)) console.log(r.id.padEnd(12), String(r.lv).padEnd(6), r.km2.toFixed(2).padStart(5), 'km2', String(r.n).padStart(3), 'poi', r.perKm2.toFixed(1).padStart(5), '/km2', r.ids.join(',').slice(0, 60));
}
