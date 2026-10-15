import assert from 'node:assert/strict';
import { POSES, stepCam, createFlickerLive } from './flickerLive.js';

assert.deepEqual(POSES.map((p) => p.slug), ['wallNear', 'wallFar', 'bushes', 'crown', 'grassFar']);
const a = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }, b = stepCam(a); // yaw 0: fwd = (0,-1), right = (1,0)
assert.ok(Math.abs(b.x - 0.05) < 1e-12 && Math.abs(b.y + 0.05) < 1e-12);
const h = createFlickerLive(); const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
h.beforeRender(cam, null); assert.equal(cam.x, 0); // no override while idle
h.cam = { x: 5, y: 6, z: 7, yawDeg: 8, pitchDeg: 9 }; const w = { wind: { params: { speed: 3 } } }; h.beforeRender(cam, w);
assert.deepEqual(cam, h.cam); assert.equal(w.wind.params.speed, 0);
let n = 0; h.frames(2).then(() => { n = 1; });
h.afterPresent(); await new Promise((r) => setTimeout(r, 0)); assert.equal(n, 0);
h.afterPresent(); await new Promise((r) => setTimeout(r, 0)); assert.equal(n, 1);
console.log('[flickerLive.test.js] ok');
