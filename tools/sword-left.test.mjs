// BUG-VM-001: left-hand asset mounts, all four clip families, and signed bob remain consistent.
import assert from 'node:assert/strict';
import swordMod from '../design/models/sword.js';
import { SWORD_CFG } from '../game/js/quest/swordConfig.js';
import { VoxelPool, createViewModelLayer } from '../engine/index.js';

const vm = swordMod.viewModel;
let pass = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); pass++; }
const rest = { pos: [-0.27, -0.42, -0.22], rot: [65, 8, -5] };
check(vm.rest, rest);
for (const name of ['idle', 'swingLR', 'charge']) {
  const key = vm.clips[name].keys[0];
  check({ pos: key.pos, rot: key.rot }, rest);
}
check(vm.clips.idle.keys[1], { t: 1100, pos: [-0.274, -0.42, -0.212], rot: [66.5, 8, -4] });
check(vm.clips.swingLR.keys[1], { t: 80, pos: [0.10, -0.32, -0.10], rot: [70, -0, 80] });
check(vm.clips.swingLR.keys[4], { t: 200, pos: [-0.18, -0.40, -0.25], rot: [86, -0, -50] });
check(vm.clips.charge.keys[4], { t: 400, pos: [-0.05, -0.36, -0.17], rot: [58, -0, 55] });
check(vm.clips.swingHard.keys[0], { t: 0, pos: [-0.05, -0.36, -0.17], rot: [58, -0, 55] });
check(vm.clips.swingHard.keys[1], { t: 67, pos: [0.24, -0.30, -0.04], rot: [50, 4, 95] });
check(vm.clips.swingLR.leadEdge, '-x');
check(vm.clips.swingHard.leadEdge, '-x');
check([vm.bob.x, vm.bob.z, vm.bob.rollDeg], [-0.006, 0.012, -1]);
check(SWORD_CFG.hand, 'left');
check(vm.hand, 'left');
const right = swordMod.forHand('right');
check(right.rest, { pos: [0.27, -0.42, -0.22], rot: [65, -8, 5] });
check(right.hand, 'right');
for (const name of Object.keys(vm.clips)) {
  const a = vm.clips[name], b = right.clips[name];
  check(a.keys.length, b.keys.length);
  for (let i = 0; i < a.keys.length; i++) {
    check(a.keys[i].pos, [-b.keys[i].pos[0], b.keys[i].pos[1], b.keys[i].pos[2]]);
    check(a.keys[i].rot, [b.keys[i].rot[0], -b.keys[i].rot[1], -b.keys[i].rot[2]]);
    check(a.keys[i].t, b.keys[i].t);
  }
}
check([right.bob.x, right.bob.z, right.bob.rollDeg], [0.006, 0.012, 1]);
check(right.clips.swingLR.leadEdge, '+x');
check(right.clips.swingHard.leadEdge, '+x');
assert.throws(() => swordMod.forHand('bad'), /hand/); pass++;
const another = swordMod.forHand('left');
another.rest.pos[0] = 100; another.clips.idle.keys[0].pos[0] = 100;
check(vm.rest, rest);
check(vm.clips.idle.keys[0].pos, rest.pos);
const pool = new VoxelPool();
pool.bind({ keys: () => ['swordHeld'], model: () => swordMod.swordHeld }, { idFor: () => 1 });
const layer = createViewModelLayer();
const leftH = layer.load('left', vm, pool), rightH = layer.load('right', right, pool);
const a = new Float64Array(3), b = new Float64Array(3);
for (const [clip, times] of [['idle', [0, 1100]], ['swingLR', [80, 160, 200]], ['charge', [0, 230, 400]], ['swingHard', [67, 125, 183]]]) {
  for (const time of times) for (const mount of ['tip', 'mid']) {
    layer.mountEye(leftH, layer.clipId(leftH, clip), time, layer.mountId(leftH, mount), a);
    layer.mountEye(rightH, layer.clipId(rightH, clip), time, layer.mountId(rightH, mount), b);
    assert.ok(Math.abs(a[0] + b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12 && Math.abs(a[2] - b[2]) < 1e-12,
      `${clip} ${time} ${mount}: the actual trail mount mirrors with the bound sword`);
    pass++;
  }
}
console.log(`${pass} passed, 0 failed. ALL PASS`);
