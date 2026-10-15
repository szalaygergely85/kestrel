// OB-141 follow-up: fill the emptiest regions with look-at POIs (stone ring / ruined arch / wagon wreck). Existing meshes + inspect only,
// no chests, no beasts, no camps (nothing that shifts beast slots or the boar cap). Deterministic. Re-runnable (strips its own ob141r* first).
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js'; import '../design/detail-pass.js'; import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern','lever','voxel_props','voxel_tower','voxel_world','boulder','rubble','wreckage','relay','sword','voxel_beast','chest','m3_props','far_tower','ferrum_lights','title','voxel_bear','voxel_wildlife','voxel_tower_crown']) { try { await import('../design/models/'+m+'.js'); } catch {} }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { makeWalkable } from '../game/js/quest/sim/regionalBeasts.js';
import { poiReport } from './poi-regions.probe.mjs';
const FILE = 'content/worlds/world_m1.world.json', INSP = 'content/dialogue/inspect.json';
const G = globalThis.ASSETS.levels.world_geo; const geo = (G.util && G.util.geo) || G.geo || G;
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.structures = data.structures.filter((s) => !/^ob141r/.test(s.id));
data.entities = data.entities.filter((e) => !/^ob141r/.test(e.id));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' }); const T = w.terrain;
const g = (x, y) => { w.ensureBandFor(x, y); return T.groundAt(x, y); };
const low = (x, y, e = 0.8) => Math.min(g(x, y), g(x + e, y), g(x - e, y), g(x, y + e), g(x, y - e));
const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
const PLAN = [
  { id: 'whitecombs', r: [60, 40, 1880, 330], kinds: ['ring', 'ruin', 'wagon'] },
  { id: 'westFells', r: [20, 330, 340, 1520], kinds: ['ruin', 'ring', 'wagon'] },
  { id: 'heartlandE', r: [1000, 330, 1880, 2040], kinds: ['ring', 'wagon', 'ruin'] },
  { id: 'downs', r: [1300, 1200, 1880, 1650], kinds: ['ruin', 'wagon', 'ring'] },
  { id: 'northwood', r: [1450, 330, 1880, 880], kinds: ['ring', 'wagon'] },
];
const TEXT = {
  ring: [['A ring of stones', 'Set upright by hand, long ago.', 'The grass inside is still short.'], 'Look at the stones'],
  ruin: [['A broken arch', 'Someone scratched tally marks on the stone.', 'Forty-one, and then they stop.'], 'Read the marks'],
  wagon: [['A wrecked wagon', 'The wheels are gone and the bed is split.', 'A faded cross is chalked on the tailboard.'], 'Look at the wreck'],
};
const anchors = [];
for (const R of geo.roads) { const p = R.pts; for (let i = 0; i + 1 < p.length; i++) { const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); for (let t = 0; t < L; t += 20) anchors.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t / L, p[i][1] + (p[i + 1][1] - p[i][1]) * t / L]); } }
for (const e of data.entities) if (/^warden_/.test(e.id)) anchors.push([e.x, e.y]); // roadless regions: the warden's spot stands in for the path
for (const s of geo.sites) if (s.st === 'whitecombs') anchors.push([s.x, s.y]); // roadless Whitecombs: the planned sites stand in for a path
const walkAt = { whitecombs: makeWalkable(T, geo.bounds, 0.6), westFells: makeWalkable(T, geo.bounds, 1.0) }; const walkDef = makeWalkable(T, geo.bounds, 0.3);
const baseReg = (x, y) => { for (const R of geo.regions) { const r = R.r; if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return R.id; } return 'heartland'; };
const occupied = [];
for (const e of data.entities) if (e.type !== 'player' && e.x != null && (e.type === 'npc' || e.components?.inspect || /chest/.test(e.id))) occupied.push([e.x, e.y]);
for (const c of JSON.parse(fs.readFileSync('content/life/goblinCamps.json', 'utf8')).camps) occupied.push(c.at);
const losOk = (a, b) => { const ha = g(a[0], a[1]) + 1.7, hb = g(b[0], b[1]) + 1.5, L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 8; t < L - 4; t += 6) { const k = t / L; if (g(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k) > ha + (hb - ha) * k) return false; } return true; };
const near = (x, y, list) => list.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), 1e9);
const placed = []; let n = 0; const out = [];
for (const P of PLAN) {
  const STEP = P.id === 'westFells' ? 8 : 20; const cands = []; const why = {}; const walk = walkAt[P.id] || walkDef; const dmax = { whitecombs: 400, westFells: 300 }[P.id] || 130;
  for (let x = P.r[0]; x < P.r[2]; x += STEP) for (let y = P.r[1]; y < P.r[3]; y += STEP) {
    const bid = baseReg(x, y); if (P.id === 'heartlandE' ? (bid !== 'heartland' || x < 1000) : bid !== P.id) continue;
    if (!walk(x, y)) { why.walk = (why.walk||0)+1; continue; } if (false || !walk(x + 5, y) || !walk(x, y + 5) || !walk(x - 5, y) || !walk(x, y - 5)) continue;
    const d = near(x, y, anchors); why.d = (why.d||0)+(d<30||d>dmax?1:0); why.cell=(why.cell||0)+1; if (d < 30 || d > dmax) continue;
    if (near(x, y, occupied) < 90 || near(x, y, placed) < 90) continue;
    const a = anchors.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(b[0] - x, b[1] - y) ? p : b)); if (!losOk(a, [x, y])) continue;
    cands.push({ x, y, score: g(x, y) - 0.5 * Math.abs(d - 70) });
  }
  console.log(P.id, 'cands', cands.length, JSON.stringify(why));
  cands.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
  let k = 0;
  for (const c of cands) {
    if (k >= P.kinds.length) break; if (near(c.x, c.y, placed) < 90) continue;
    placed.push([c.x, c.y]); const kind = P.kinds[k], key = 'note.poi.' + P.id + '.' + (k + 1), yaw = (k * 97 + 31) % 360; k++;
    const put = (mesh, lx, ly, yw, o = {}) => { const [dx, dy] = rot(yaw, lx, ly), x = c.x + dx, y = c.y + dy; const st = { id: 'ob141r' + String(n++).padStart(2, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, o.ext ?? 0.8) - 0.04).toFixed(2) }, yawDeg: (yw + yaw) % 360 }; if (o.scale) st.scale = o.scale; if (o.noShadow) st.castShadow = false; data.structures.push(st); };
    if (kind === 'ring') put('Rock_Medium_1', 0, 0, 40, { scale: 0.9, ext: 1 });
    if (kind === 'ring') for (let i = 0; i < 5; i++) { const a = i * 72 + 10; put('Rock_Medium_' + (1 + i % 3), 4.5 * Math.cos(a * Math.PI / 180), 4.5 * Math.sin(a * Math.PI / 180), a * 3 % 360, { scale: 1.4 + (i % 2) * 0.3, ext: 1.2 }); }
    else if (kind === 'ruin') { put('Wall_Arch', 0, 0, 90); put('Wall_BottomCover', -2.2, 0, 90, { noShadow: true }); put('Wall_BottomCover', 2.2, 0, 90, { noShadow: true }); for (const [lx, ly, yw] of [[3.5, 1.2, 119], [-3, 2.5, 73], [1, -4, 300]]) put('Prop_Brick1', lx, ly, yw, { noShadow: true, ext: 0.4 }); }
    else { put('Prop_Wagon', 0, 0, 20, { ext: 2 }); put('Prop_Crate', 2.6, 1.4, 55, { ext: 0.6 }); put('Prop_Brick2', -2.8, -1.8, 200, { noShadow: true, ext: 0.4 }); }
    data.entities.push({ id: 'ob141r' + P.id + k, components: { inspect: { text: key } }, note: 'OB-141 follow-up look-at POI (' + kind + ') in ' + P.id, type: 'prop', x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: 'ground' });
    out.push([P.id, kind, c.x, c.y, key]);
  }
}
fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
const s = fs.readFileSync(INSP, 'utf8').split('\n').filter((l) => !/"note\.poi\./.test(l));
const i0 = s.findIndex((l) => l.includes('"note.westStones"'));
const lines = out.map((o) => { const T0 = TEXT[o[1]]; return '    ' + JSON.stringify(o[4]) + ': {"prompt": "[E] ' + T0[1] + '", "title": ' + JSON.stringify(T0[0][0]) + ', "lines": ' + JSON.stringify(T0[0].slice(1)) + '},'; });
s.splice(i0 + 1, 0, ...lines); fs.writeFileSync(INSP, s.join('\n'), 'utf8');
for (const o of out) console.log(o.join(' '));
console.log('structures', n);
// R13: the older west anchors need a visible mesh within 1 m (applied after the write above, idempotent)
{
  const d2 = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  d2.structures = d2.structures.filter((s) => s.id !== 'ob141rMeadowCart' && s.id !== 'ob141rWestStone');
  const mk = (id, mesh, x, y, yaw, sc) => { d2.structures.push({ id, mesh: 'quaternius/' + mesh, origin: { x, y, z: +(low(x, y, 1.5) - 0.04).toFixed(2) }, yawDeg: yaw, ...(sc ? { scale: sc } : {}) }); };
  mk('ob141rMeadowCart', 'Prop_Wagon', 1020, 1144, 35); mk('ob141rWestStone', 'Rock_Medium_2', 870, 1100, 80, 0.9);
  const note = d2.entities.find((e) => e.id === 'ruinWestNote'); const br = d2.structures.filter((s) => /^ob141s/.test(s.id)).reduce((b, s) => (Math.hypot(s.origin.x - note.x, s.origin.y - note.y) < Math.hypot(b.origin.x - note.x, b.origin.y - note.y) ? s : b));
  note.x = +(br.origin.x + 0.4).toFixed(1); note.y = +(br.origin.y + 0.4).toFixed(1);
  fs.writeFileSync(FILE, stringifyContent(d2), 'utf8');
}
