import assert from 'node:assert/strict';
import { POSES, POSES_ALL, stepCam, createFlickerLive } from './flickerLive.js';

assert.deepEqual(POSES.map((p) => p.slug), ['wallNear', 'wallFar', 'bushes', 'crown', 'grassFar']);
assert.deepEqual(POSES_ALL.map((p) => p.slug), ['wallNear', 'wallFar', 'bushes', 'crown', 'grassFar', 'roadWalk']);
const a = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }, b = stepCam(a); // yaw 0: fwd = (0,-1), right = (1,0)
assert.ok(Math.abs(b.x - 0.05) < 1e-12 && Math.abs(b.y + 0.05) < 1e-12);
const h = createFlickerLive(); const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
h.beforeRender(cam, null); assert.equal(cam.x, 0); // no override while idle
h.cam = { x: 5, y: 6, z: 7, yawDeg: 8, pitchDeg: 9 }; const w = { wind: { params: { speed: 3 } } }; h.beforeRender(cam, w);
assert.deepEqual(cam, h.cam); assert.equal(w.wind.params.speed, 0);
let n = 0; h.frames(2).then(() => { n = 1; });
h.afterPresent(); await new Promise((r) => setTimeout(r, 0)); assert.equal(n, 0);
h.afterPresent(); await new Promise((r) => setTimeout(r, 0)); assert.equal(n, 1);
{ // OB198-DUMP-DIFF-01
  const { parseFlickerDump, packDump } = await import('./flickerLive.js');
  assert.deepEqual(parseFlickerDump('wallNear:3'), { pose: 'wallNear', step: 3 }); assert.equal(parseFlickerDump('x'), null); assert.equal(parseFlickerDump(null), null);
  const fr = { GI: new Uint32Array([5, 0x00070001, 0, 0]), fg: new Uint8Array([1, 2, 3, 65]), bg: new Uint8Array([0, 0, 9, 255]) };
  const dd = packDump('p', 0, fr, fr, 1, 1); assert.deepEqual([dd.A.glyph[0], dd.A.kind[0], dd.A.mat[0], dd.A.pid[0], dd.A.fg[0], dd.A.bg[0]], [65, 1, 7, 5, 0x010203, 9]);
}
console.log('[flickerLive.test.js] ok');
