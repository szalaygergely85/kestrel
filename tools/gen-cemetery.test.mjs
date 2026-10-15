// OB-191 cemetery: grounded, graves inside the fence, nothing on a road, plain look-at text, no chest, anchor present.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { roadPoints, rot, HALF_U, HALF_V } from './gen-cemetery.mjs';
import { World } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
const data = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const structs = data.structures.filter((s) => /^cem/.test(s.id)), ents = data.entities.filter((e) => /^cem/.test(e.id));
const anchor = ents.find((e) => e.id === 'cemetery1'); assert.ok(anchor, 'anchor cemetery1');
assert.ok(!ents.some((e) => /chest/i.test(e.id) || e.components?.chest), 'no chest');
const graves = ents.filter((e) => /^cemGrave/.test(e.id)); assert.ok(graves.length >= 15 && graves.length <= 20, 'graves ' + graves.length);
// fence frame: the Prop_MetalFence_Simple perimeter gives the centre + yaw (gate side is the missing segment)
const fences = structs.filter((s) => s.mesh.endsWith('Prop_MetalFence_Simple'));
const cx = fences.reduce((a, s) => a + s.origin.x, 0) / fences.length, cy = fences.reduce((a, s) => a + s.origin.y, 0) / fences.length;
const { assets } = await loadTestAssets(); const w = World.load(data, assets, { physics: 'mesh' });
const gz = (x, y) => { w.ensureBandFor(x, y); return w.terrain.groundAt(x, y); };
// rotate each point into the plot frame using the yaw stored on a +u fence segment (yawDeg = 0 + plot yaw)
const yaw = fences.find((s) => Math.abs(s.origin.x - cx) < 1e9 && fences.length) .yawDeg; void yaw;
const front = anchor; void front;
// graves must lie inside the fenced rectangle: test with the best-fitting plot yaw (anchor sits at the plot centre)
const fy = Math.round(structs.find((s) => s.mesh.endsWith('Wall_UnevenBrick_Door_Round')).yawDeg * 10) / 10;
for (const g of graves) {
  const [u, v] = rot(-fy, g.x - anchor.x, g.y - anchor.y);
  assert.ok(Math.abs(u) < HALF_U - 0.5 && Math.abs(v) < HALF_V - 0.5, g.id + ' outside the fence ' + u.toFixed(1) + ',' + v.toFixed(1));
  assert.ok(g.z === 'ground', g.id + ' z ground');
}
for (const s of structs) { const d = s.origin.z - gz(s.origin.x, s.origin.y); assert.ok(d > -2.5 && d < 0.5, s.id + ' grounded d=' + d.toFixed(2)); }
const road = roadPoints();
for (const p of [...structs.map((s) => [s.origin.x, s.origin.y]), ...graves.map((g) => [g.x, g.y])])
  assert.ok(road.every((r) => Math.hypot(r[0] - p[0], r[1] - p[1]) > 6), 'on a road ' + p);
const t = JSON.parse(fs.readFileSync('content/dialogue/inspect.json', 'utf8')).texts['note.cemetery.crypt'];
assert.ok(t && [t.title, t.prompt, ...t.lines].every((l) => l.length <= 56), 'crypt text');
assert.ok(ents.find((e) => e.id === 'cemeteryCryptDoor')?.components?.inspect?.text === 'note.cemetery.crypt');
console.log('gen-cemetery.test.mjs: OK');
