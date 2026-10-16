import assert from 'node:assert';
import { pickCliffPose, pickEntity } from './visqa-pick.mjs';

// flat ground except a 9 m cliff (ramp over 3 m) at y in [100,103], rising toward -y (north): the flat meadow around must not win
const h = (x, y) => (y > 103 ? 0 : y < 100 ? 9 : (103 - y) * 3);
const p = pickCliffPose(h, 500 - 500 + 40, 130, 60);
assert(p, 'pose found');
assert(Math.abs(p.yaw) < 5 || Math.abs(p.yaw - 360) < 5, 'faces north (uphill): ' + p.yaw);
assert(p.y > 103, 'camera stands south of the face: ' + p.y);
assert(p.pitch > 0 && p.pitch < 45, 'looks up at the face: ' + p.pitch);
assert(pickCliffPose(() => 0, 0, 0) === null, 'flat world: null');
// east-facing cliff
const he = (x) => (x < 50 ? 0 : x > 53 ? 9 : (x - 50) * 3);
const q = pickCliffPose((x, y) => he(x), 30, 0, 40);
assert(Math.abs(q.yaw - 90) < 5 && q.x < 50, 'east cliff: ' + JSON.stringify(q));

const ent = (id, comps) => ({ id, transform: { x: 0, y: 0 }, components: comps });
const list = [null, ent('s1', { voxel: { model: 'skeleton_wolf' } }), ent('b1', { brain: { species: 'boar' } }),
  ent('w1', { brain: { species: 'wolf' }, voxel: { model: 'wolf_grey' } }), ent('w2', { brain: { beastKind: 'grey_wolf' } }), ent('rook', {})];
assert.strictEqual(pickEntity(list, { kind: 'wolf' }).index, 3, 'first real wolf, skeleton skipped');
assert.strictEqual(pickEntity(list.slice(4, 5), { kind: 'wolf' }).entity.id, 'w2', 'beastKind grey_wolf');
assert.strictEqual(pickEntity(list, { id: 'rook' }).index, 5);
assert.strictEqual(pickEntity([list[1], list[2]], { kind: 'wolf' }), null, 'no wolf -> null');
assert.strictEqual(pickEntity(list, { id: 'nobody' }), null);
console.log('visqa-pick ok');

import { closeupPose } from './visqa-pick.mjs';
{ // subject facing north (yaw 0) at (100,200): camera 3.5 m north of it, looking south (yaw 180)
  const n = closeupPose({ x: 100, y: 200, z: 5, yawDeg: 0 }, null, 3.5, 0, false);
  assert(Math.abs(n.x - 100) < 1e-9 && Math.abs(n.y - 196.5) < 1e-9 && Math.abs(n.yaw - 180) < 1e-9 && n.z === 5, 'north-facing: ' + JSON.stringify(n));
  const e = closeupPose({ x: 0, y: 0, z: 0, yawDeg: 90 }, null, 4, 0, true); // faces east: camera east, looks west (270)
  assert(Math.abs(e.x - 4) < 1e-9 && Math.abs(e.y) < 1e-9 && Math.abs(e.yaw - 270) < 1e-9 && e.z === null, 'east-facing: ' + JSON.stringify(e));
  const b = closeupPose({ x: 10, y: 10, z: 1, yawDeg: 0 }, { fx: 0, fy: 2 }, 3, 0.9, false); // beast facing +y (south): sim vector beats yaw
  assert(Math.abs(b.y - 13) < 1e-9 && Math.abs(b.yaw) < 1e-9 && Math.abs(b.z - 0.1) < 1e-9, 'beast fx/fy: ' + JSON.stringify(b));
  console.log('closeupPose ok');
}
