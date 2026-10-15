globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js'; import '../design/detail-pass.js'; import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern','lever','voxel_props','voxel_tower','voxel_world','boulder','rubble','wreckage','relay','sword','voxel_beast','chest','m3_props','far_tower','ferrum_lights','title','voxel_bear','voxel_wildlife','voxel_tower_crown']) { try { await import('../design/models/'+m+'.js'); } catch {} }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
const FILE = 'content/worlds/world_m1.world.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.structures = data.structures.filter((s) => !/^ob141/.test(s.id));
data.entities = data.entities.filter((e) => !/^(ob141|chestWest$|ruinWestNote|stonesWest)/.test(e.id));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' }); const T = w.terrain;
const g = (x, y) => { w.ensureBandFor(x, y); return T.groundAt(x, y); };
const low = (x, y, e = 0.8) => Math.min(g(x, y), g(x + e, y), g(x - e, y), g(x, y + e), g(x, y - e));
const rot = (yaw, lx, ly) => { const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c * lx - s * ly, s * lx + c * ly]; };
let n = 0;
const put = (mesh, x, y, yaw, o = {}) => {
  const st = { id: 'ob141s' + String(n++).padStart(2, '0'), mesh: 'quaternius/' + mesh, origin: { x: +x.toFixed(2), y: +y.toFixed(2), z: +(low(x, y, o.ext ?? 0.8) - 0.04 + (o.dz ?? 0)).toFixed(2) }, yawDeg: yaw };
  if (o.scale) st.scale = o.scale; if (o.noShadow) st.castShadow = false; data.structures.push(st); return st;
};
// POI 2: ruined gatehouse (Wall_Arch pattern of rprop021 / the Rook ruin) at (950,1090) with ONE chest behind the arch
const R = [950, 1090], Y = 20;
const at = (lx, ly) => { const [dx, dy] = rot(Y, lx, ly); return [R[0] + dx, R[1] + dy]; };
put('Wall_Arch', ...at(0, 0), Y + 90);
put('Wall_BottomCover', ...at(-2.2, 0), Y + 90, { noShadow: true }); put('Wall_BottomCover', ...at(2.2, 0), Y + 90, { noShadow: true });
put('Wall_UnevenBrick_Straight', ...at(-4.5, 0), Y + 90); put('Corner_Exterior_Brick', ...at(-4.5, -3), Y);
put('Floor_UnevenBrick', ...at(0, -2.5), Y, { noShadow: true, ext: 1.5 });
for (const [lx, ly, yw] of [[3.5, 1.2, 119], [-3, 2.5, 73], [1, -5, 300], [4.5, -3, 20]]) put('Prop_Brick1', ...at(lx, ly), yw, { noShadow: true, ext: 0.4 });
const [cx, cy] = [878, 1018];
data.entities.push({ id: 'chestWest', components: { voxel: { anim: 'closed', loop: false, model: 'chestSmall' } }, note: 'OB-141 the ONLY new chest: inside campSouthWest (guarded by its 4 goblins, OB-179 rule; table chestDefs.js)', type: 'prop', x: cx, y: cy, yawDeg: 180, z: 'ground' });
const [nx, ny] = at(3, 2.5);
data.entities.push({ id: 'ruinWestNote', components: { inspect: { text: 'note.westRuin' } }, note: 'OB-141 scrawl at the west gatehouse (existing inspect system)', type: 'prop', x: +nx.toFixed(1), y: +ny.toFixed(1), z: 'ground' });
// POI 3: standing stones on the west hill (ring of Rock_Medium), look-at note
const S = [870, 1100];
for (let i = 0; i < 6; i++) { const a = i * 60 + 15, [dx, dy] = rot(a, 5.5, 0); put('Rock_Medium_' + (1 + i % 3), S[0] + dx, S[1] + dy, a * 3 % 360, { scale: 1.5 + (i % 2) * 0.3, ext: 1.2 }); }
data.entities.push({ id: 'stonesWest', components: { inspect: { text: 'note.westStones' } }, note: 'OB-141 viewpoint: ring of standing stones on the west hill', type: 'prop', x: S[0], y: S[1], z: 'ground' });
// POI 4: boars grazing in the riverside meadow (existing wary-boar pattern of boarF1/F2)
for (const [i, [bx, by]] of [[1020, 1144], [1024, 1140], [1017, 1150]].entries()) data.entities.push({ id: 'ob141Boar' + (i + 1), components: { brain: { home: [bx, by], kind: 'beast', temperament: 'wary' }, targetable: { height: 0.7, radius: 0.45 }, voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' } }, note: 'OB-141 wary boars grazing in the south-west riverside meadow (existing boarF pattern)', type: 'beast', x: bx, y: by, z: 'ground' });
fs.writeFileSync(FILE, stringifyContent(data), 'utf8');
console.log('added structures', n);
