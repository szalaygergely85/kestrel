// M4: cap1..5 are redcap questPickups with the pickupRedCap sprite; smoke1..3 are bare anchors (OB-020).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const w = JSON.parse(readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const by = (id) => w.entities.find((e) => e.id === id);
for (let i = 1; i <= 5; i++) {
  const e = by('cap' + i);
  assert.ok(e, 'cap' + i);
  assert.deepEqual(e.components.questPickup, { item: 'redcap', n: 1 });
  assert.equal(e.components.sprite.model, 'pickupRedCap');
}
for (let i = 1; i <= 3; i++) {
  const e = by('smoke' + i);
  assert.ok(e && e.type === 'prop' && !e.model, 'smoke' + i + ' is a bare anchor (OB-020: billboard removed)');
}
// OB-023: caps sit on tree trunks, never on the road (path polyline of overworld_far recipe).
const PATH = [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]];
const segDist = (px, py) => { let b = 1e9; for (let i = 1; i < PATH.length; i++) { const [ax, ay] = PATH[i - 1], dx = PATH[i][0] - ax, dy = PATH[i][1] - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); b = Math.min(b, Math.hypot(ax + dx * t - px, ay + dy * t - py)); } return b; };
const trunks = w.structures.filter((s) => /Tree|Stump|Log/.test(s.mesh) && !/^poi/.test(s.id));
for (let i = 1; i <= 5; i++) {
  const e = by('cap' + i);
  assert.ok(segDist(e.x, e.y) >= 3, 'cap' + i + ' >= 3 m off the road');
  assert.ok(trunks.some((t) => Math.hypot(t.origin.x - e.x, t.origin.y - e.y) <= 1.5), 'cap' + i + ' within 1.5 m of a trunk');
}
console.log('capPickups.test OK (5 caps, 3 smoke)');
