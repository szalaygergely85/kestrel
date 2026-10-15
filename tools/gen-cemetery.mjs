// OB-191 cemetery: one fenced graveyard + sealed crypt facade on the tower side of the river (world_m1). Existing models/meshes only,
// no chest, no beasts. Deterministic, re-runnable (strips its own cem* ids first). build() returns the layout for the test.
//   node tools/gen-cemetery.mjs        writes world_m1 + content/dialogue/inspect.json
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import '../design/palette.js'; import '../design/detail-pass.js'; import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern','lever','voxel_props','voxel_tower','voxel_world','boulder','rubble','wreckage','relay','sword','voxel_beast','chest','m3_props','far_tower','ferrum_lights','title','voxel_b'])
  { try { await import('../design/models/' + m + '.js'); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { makeWalkable } from '../game/js/quest/sim/regionalBeasts.js';

export const FILE = 'content/worlds/world_m1.world.json', INSP = 'content/dialogue/inspect.json';
export const HALF_U = 12, HALF_V = 9, GATE = 1.8; // plot 24 x 18 m, gate gap 3.6 m
export const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
const G = globalThis.ASSETS.levels.world_geo; const geo = (G.util && G.util.geo) || G.geo || G;
const near = (x, y, list) => list.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), 1e9);
export const roadPoints = () => { const road = []; for (const R of geo.roads) { const p = R.pts; for (let i = 0; i + 1 < p.length; i++) { const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); for (let t = 0; t <= L; t += 4) road.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t / L, p[i][1] + (p[i + 1][1] - p[i][1]) * t / L]); } } return road; };

export async function build(data, { write = false } = {}) {
  data.structures = data.structures.filter((s) => !/^cem/.test(s.id)); data.entities = data.entities.filter((e) => !/^cem/.test(e.id));
  const { assets } = await loadTestAssets();
  const w = World.load(data, assets, { physics: 'mesh' }); const T = w.terrain;
  const g = (x, y) => { w.ensureBandFor(x, y); return T.groundAt(x, y); };
  const low = (x, y, e = 0.8) => Math.min(g(x, y), g(x + e, y), g(x - e, y), g(x, y + e), g(x, y - e));
  const road = roadPoints();
  const avoid = []; for (const e of data.entities) if (e.type !== 'player' && e.x != null && (e.type === 'npc' || e.components?.inspect || e.components?.waystone || /chest|trade|post|waystone|relay|warden|camp/i.test(e.id))) avoid.push([e.x, e.y]);
  for (const c of JSON.parse(fs.readFileSync('content/life/goblinCamps.json', 'utf8')).camps) avoid.push(c.at);
  const strc = data.structures.map((s) => [s.origin.x, s.origin.y]);
  const walk = makeWalkable(T, geo.bounds, 0.4);
  let best = null; const why = {};
  for (let x = 1100; x < 1760; x += 8) for (let y = 820; y < 1380; y += 8) {
    const d = near(x, y, road); if (d < 28 || d > 70) { why.road = (why.road || 0) + 1; continue; }
    if (near(x, y, avoid) < 80 || near(x, y, strc) < 30 || Math.hypot(x - 1480, y - 1018) < 110) { why.avoid = (why.avoid || 0) + 1; continue; }
    let zmin = 1e9, zmax = -1e9, ok = true;
    for (let u = -14; u <= 14 && ok; u += 4) for (let v = -11; v <= 11; v += 4) { if (!walk(x + u, y + v)) { ok = false; break; } const z = g(x + u, y + v); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    if (!ok || zmax - zmin > 6.0) { why[ok ? 'slope' : 'walk'] = (why[ok ? 'slope' : 'walk'] || 0) + 1; continue; }
    const sc = (zmax - zmin) + Math.abs(d - 45) * 0.03; if (!best || sc < best.sc) best = { x, y, sc, zr: zmax - zmin };
  }
  if (!best) throw new Error('no cemetery site ' + JSON.stringify(why));
  // orient: local -v (gate side) toward the nearest road point
  let rp = road[0]; for (const p of road) if (Math.hypot(p[0] - best.x, p[1] - best.y) < Math.hypot(rp[0] - best.x, rp[1] - best.y)) rp = p;
  const ax = best.x - rp[0], ay = best.y - rp[1], al = Math.hypot(ax, ay); // away from road = +v
  const yaw = Math.round(Math.atan2(-ax / al, ay / al) * 180 / Math.PI * 10) / 10;
  const at = (lu, lv) => { const [dx, dy] = rot(yaw, lu, lv); return [best.x + dx, best.y + dy]; };
  let n = 0; const rng = (() => { let s = 191; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const put = (mesh, lu, lv, yw, o = {}) => { const [x, y] = at(lu, lv); const st = { id: 'cem' + String(n++).padStart(2, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, o.ext ?? 0.8) - 0.04).toFixed(2) }, yawDeg: +(((yw + yaw) % 360 + 360) % 360).toFixed(1) }; if (o.scale) st.scale = o.scale; if (o.noShadow) st.castShadow = false; data.structures.push(st); };
  // fence: step 2.64 m (Prop_MetalFence_Simple 1.96 m * 1.35); the front row (-v) has the gate gap
  const S = 2.64;
  for (let u = -HALF_U + S / 2; u < HALF_U; u += S) { if (Math.abs(u) > GATE) put('Prop_MetalFence_Simple', u, -HALF_V, 0, { scale: 1.35 }); put('Prop_MetalFence_Simple', u, HALF_V, 0, { scale: 1.35 }); }
  for (let v = -HALF_V + S / 2; v < HALF_V; v += S) { put('Prop_MetalFence_Simple', -HALF_U, v, 90, { scale: 1.35 }); put('Prop_MetalFence_Simple', HALF_U, v, 90, { scale: 1.35 }); }
  // crypt facade at the back (inside the fence, v = 7): wall - door wall - wall, two short side walls, closed door in the opening
  put('Wall_UnevenBrick_Straight', -2, 7, 0, { ext: 1 }); put('Wall_UnevenBrick_Door_Round', 0, 7, 0, { ext: 1 }); put('Wall_UnevenBrick_Straight', 2, 7, 0, { ext: 1 });
  put('Wall_UnevenBrick_Straight', -3, 8.1, 90, { ext: 1, noShadow: true }); put('Wall_UnevenBrick_Straight', 3, 8.1, 90, { ext: 1, noShadow: true });
  put('Door_1_Round', 0, 7.0, 0, { ext: 0.5 });
  put('Prop_Brick2', -4.2, 5.6, 40, { noShadow: true, ext: 0.4 }); put('Prop_Brick3', 4.4, 5.9, 130, { noShadow: true, ext: 0.4 });
  // two bare trees
  put('DeadTree_2', -9, 6.5, 30, { scale: 0.8, ext: 1.2 }); put('DeadTree_4', 9.5, -2, 200, { scale: 0.7, ext: 1.2 });
  // graves: 3 rows of 6/7/5, a 2.4 m path along u = 0 from the gate to the crypt
  const MODELS = ['gravestone1', 'gravestone2', 'gravestone3', 'gravestone1Weathered', 'gravestone2Weathered', 'gravestone3Weathered'];
  const rows = [[-4.5, 6], [-0.5, 7], [3.2, 5]]; const graves = [];
  for (const [v, cnt] of rows) { let k = 0;
    for (const side of [-1, 1]) for (let i = 0; i < Math.ceil(cnt / 2) && k < cnt; i++, k++) {
      const lu = side * (2.6 + i * 2.6) + (rng() - 0.5) * 0.5, lv = v + (rng() - 0.5) * 0.7;
      if (Math.abs(lu) > HALF_U - 1.6) continue;
      const [x, y] = at(lu, lv); graves.push({ id: 'cemGrave' + String(graves.length + 1).padStart(2, '0'), model: MODELS[Math.floor(rng() * MODELS.length)], x: +x.toFixed(2), y: +y.toFixed(2), yaw: +(((yaw + 180 + (rng() - 0.5) * 24) % 360 + 360) % 360).toFixed(1) }); } }
  for (const gr of graves) data.entities.push({ id: gr.id, components: { collider: { h: 0.9, r: 0.45 }, voxel: { anim: 'idle', loop: false, model: gr.model } }, note: 'OB-191 cemetery grave', type: 'prop', x: gr.x, y: gr.y, yawDeg: gr.yaw, z: 'ground' });
  const [cx, cy] = at(0, 6.4), [mx, my] = at(0, 0);
  data.entities.push({ id: 'cemeteryCryptDoor', components: { inspect: { text: 'note.cemetery.crypt' } }, note: 'OB-191 sealed crypt door (the crypt interior comes later as a cellar)', type: 'prop', x: +cx.toFixed(1), y: +cy.toFixed(1), z: 'ground' });
  data.entities.push({ id: 'cemetery1', components: {}, note: 'OB-191 skeleton spawn anchor: cemetery1 radius 15 m, night', type: 'prop', x: +mx.toFixed(1), y: +my.toFixed(1), z: 'ground' });
  const layout = { center: [best.x, best.y], yaw, halfU: HALF_U, halfV: HALF_V, roadDist: +near(best.x, best.y, road).toFixed(1), zRange: +best.zr.toFixed(2), graves: graves.length };
  if (write) fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
  return layout;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8')); const L = await build(data, { write: true });
  const s = fs.readFileSync(INSP, 'utf8').split('\n').filter((l) => !/"note\.cemetery\./.test(l));
  const i0 = s.findIndex((l) => l.includes('"note.westStones"'));
  s.splice(i0 + 1, 0, '    "note.cemetery.crypt": {"prompt": "[E] Look at the door", "title": "The crypt door", "lines": ["The crypt door is sealed.","Something scratches inside."]},');
  fs.writeFileSync(INSP, s.join('\n'), 'utf8');
  console.log(JSON.stringify(L));
}
