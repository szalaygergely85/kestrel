// VISQA-13: no green (moss_cap material) placements inside the 4 underground/enclosed level zones (crypt, ford cellar, goblin tunnel, bear den).
import fs from 'node:fs'; import assert from 'node:assert';
const w = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const zones = w.structures.filter((s) => s.level && /crypt|cellar|tunnel|den/i.test(s.id)).map((s) => {
  const l = JSON.parse(fs.readFileSync(`content/levels/${s.level}.level.json`, 'utf8'));
  return { id: s.id, x0: s.origin.x - 1, y0: s.origin.y - 1, x1: s.origin.x + l.size.w + 1, y1: s.origin.y + l.size.h + 1 };
});
assert.strictEqual(zones.length, 4);
const mossy = (mesh) => { const j = JSON.parse(fs.readFileSync(`content/meshes/${mesh}.mesh.json`, 'utf8'));
  return j.ranges.some((r) => { const k = r.part.split(':')[1]; const m = (j.mats && j.mats[k]) || k; return /moss|leaf|grass|bush|fern/i.test(m); }); };
let checked = 0;
for (const z of zones) for (const s of w.structures) {
  if (!s.mesh || !s.origin || s.level) continue; const o = s.origin;
  if (o.x < z.x0 || o.x > z.x1 || o.y < z.y0 || o.y > z.y1) continue;
  checked++; assert.ok(!mossy(s.mesh), `${z.id}: ${s.id} uses green mesh ${s.mesh}`);
}
assert.ok(checked > 100, 'zone placements checked: ' + checked);
console.log('interiorGreen ok', checked, 'placements, 4 zones');
