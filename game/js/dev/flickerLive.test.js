import assert from 'node:assert/strict';
import { POSES, POSES_ALL, stepCam, createFlickerLive } from './flickerLive.js';

assert.deepEqual(POSES.map((p) => p.slug), ['wallNear', 'wallFar', 'bushes', 'crown', 'grassFar']);
assert.deepEqual(POSES_ALL.map((p) => p.slug), ['wallNear', 'wallFar', 'bushes', 'crown', 'grassFar', 'roadWalk', 'forestWalk', 'townWalk', 'cryptWalk']);
// AA-24: the new walks are forward walks with the sword, outside avg, carrying the player; cryptWalk has an absolute eye z (underground)
for (const p of POSES_ALL.slice(6)) assert.ok(p.walk && p.sword && p.inAvg === false && p.player && p.stepM === 0.1, p.slug);
assert.ok(Math.abs(POSES_ALL[8].z - (-56.8 + 1.6)) < 1e-9);
{ const hp = createFlickerLive(), t = { x: 0, y: 0, z: 0, yawDeg: 0 }, body = { vz: -9, fallDistance: 4, peakZ: 3 }, pl = { data: { transform: t, components: { body } } };
  hp.cam = { x: 1, y: 2, z: 3.6, yawDeg: 45, pitchDeg: 0 }; hp.player = true; hp.beforeRender({}, { get: () => pl });
  assert.equal(t.z, 2); assert.equal(t.x, 1); assert.equal(body.vz, 0); assert.equal(body.fallDistance, 0); assert.equal(body.peakZ, 2); }
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
