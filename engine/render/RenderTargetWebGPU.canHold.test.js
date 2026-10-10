// GRID-MAX-01: canHoldGrid accepts the 560..800 steps on a normal device and refuses with a reason when the G-buffer or VRAM estimate does not fit.
import assert from 'node:assert/strict';
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';

const can = (limits, c, r, rays) => RenderTargetWebGPU.prototype.canHoldGrid.call({ device: { gpu: limits ? { limits } : null } }, c, r, rays);
const big = { maxTextureDimension2D: 8192 };
for (const [c, r] of [[480, 180], [560, 210], [640, 240], [720, 270], [800, 300]]) assert.ok(can(big, c, r, 4).ok, `${c}x${r} rays 4 fits`);
const small = can({ maxTextureDimension2D: 2048 }, 640, 240, 4);
assert.ok(!small.ok && /maxTextureDimension2D 2048/.test(small.reason), small.reason);
assert.ok(can({ maxTextureDimension2D: 2048 }, 480, 180, 4).ok); // 1920x720 fits a 2048 limit
console.log('RenderTargetWebGPU.canHold.test: PASS');
